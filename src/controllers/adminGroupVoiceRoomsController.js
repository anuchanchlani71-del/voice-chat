const mongoose = require('mongoose');
const GroupVoiceRoom = require('../models/GroupVoiceRoom');
const User = require('../models/User');

/**
 * Controller: GET /api/v1/admin/group-voice-rooms
 * Retrieve paginated Group Voice Rooms with search, accessType filter, status filter, and live metrics.
 */
async function getGroupVoiceRooms(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { search, accessType, status } = req.query || {};

    const filter = { isDeleted: false };

    // 1. Status Filter
    if (status && status !== 'all') {
      const normStatus = String(status).toLowerCase().trim();
      const validStatuses = ['active', 'scheduled', 'ended', 'closed'];
      if (validStatuses.includes(normStatus)) {
        filter.status = normStatus;
      }
    }

    // 2. Access Type Filter (STRICT: only 'anyone' or 'invite_only')
    if (accessType && accessType !== 'all') {
      const normAccess = String(accessType).toLowerCase().trim();
      if (normAccess === 'anyone' || normAccess === 'invite_only') {
        filter.accessType = normAccess;
      }
    }

    // 3. Search by title, topic, or host username/fullName/id
    if (search && typeof search === 'string' && search.trim()) {
      const term = search.trim();
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');

      const matchedUsers = await User.find({
        $or: [
          { username: regex },
          { fullName: regex },
          { id: regex }
        ]
      }).select('_id id');

      const userMongoIds = matchedUsers.map((u) => u._id);

      filter.$or = [
        { title: regex },
        { topic: regex },
        { id: regex },
        { host: { $in: userMongoIds } }
      ];
    }

    // Parallel fetch: Filtered rooms + Total + Status & Access Breakdown Counts
    const [
      rawRooms,
      totalFiltered,
      totalRooms,
      activeRooms,
      anyoneRooms,
      inviteOnlyRooms
    ] = await Promise.all([
      GroupVoiceRoom.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('host', 'id username fullName avatar accountStatus isOnline email')
        .populate('invitedUsers', 'id username fullName avatar accountStatus isOnline'),
      GroupVoiceRoom.countDocuments(filter),
      GroupVoiceRoom.countDocuments({ isDeleted: false }),
      GroupVoiceRoom.countDocuments({ isDeleted: false, status: 'active' }),
      GroupVoiceRoom.countDocuments({ isDeleted: false, accessType: 'anyone' }),
      GroupVoiceRoom.countDocuments({ isDeleted: false, accessType: 'invite_only' })
    ]);

    const groupVoiceRooms = rawRooms.map((r) => GroupVoiceRoom.sanitize(r));
    const totalPages = Math.ceil(totalFiltered / limit) || 1;

    return res.status(200).json({
      success: true,
      groupVoiceRooms,
      pagination: {
        currentPage: page,
        pageSize: limit,
        totalItems: totalFiltered,
        totalPages
      },
      counts: {
        total: totalRooms,
        active: activeRooms,
        anyone: anyoneRooms,
        inviteOnly: inviteOnlyRooms
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: GET /api/v1/admin/group-voice-rooms/:id
 * Retrieve detailed information for a specific Group Voice Room.
 */
async function getGroupVoiceRoomById(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing Group Voice Room identifier.'
      });
    }

    let query;
    if (mongoose && mongoose.Types.ObjectId.isValid(id) && id.length === 24) {
      query = { $or: [{ _id: id }, { id: id }] };
    } else {
      query = { id: id };
    }

    const room = await GroupVoiceRoom.findOne({ ...query, isDeleted: false })
      .populate('host', 'id username fullName avatar accountStatus isOnline email bio')
      .populate('invitedUsers', 'id username fullName avatar accountStatus isOnline bio email');

    if (!room) {
      return res.status(404).json({
        success: false,
        error: `Group Voice Room with ID "${id}" was not found or has been removed.`
      });
    }

    return res.status(200).json({
      success: true,
      groupVoiceRoom: GroupVoiceRoom.sanitize(room)
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: PATCH /api/v1/admin/group-voice-rooms/:id/status
 * Admin moderation: Close / Disable an active voice room.
 * STRICT: Admin CANNOT modify user-owned room configurations (title, topic, host, capacity, accessType, invitedUsers).
 */
async function updateGroupVoiceRoomStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing Group Voice Room identifier.'
      });
    }

    if (!status || typeof status !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Status is required for moderation action (e.g. "closed" or "ended").'
      });
    }

    const normStatus = status.toLowerCase().trim();
    const allowedAdminStatuses = ['closed', 'ended', 'active'];
    if (!allowedAdminStatuses.includes(normStatus)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status "${status}". Allowed moderation statuses: ${allowedAdminStatuses.join(', ')}.`
      });
    }

    let query;
    if (mongoose && mongoose.Types.ObjectId.isValid(id) && id.length === 24) {
      query = { $or: [{ _id: id }, { id: id }] };
    } else {
      query = { id: id };
    }

    const room = await GroupVoiceRoom.findOne({ ...query, isDeleted: false });

    if (!room) {
      return res.status(404).json({
        success: false,
        error: `Group Voice Room "${id}" was not found.`
      });
    }

    // Apply status update
    room.status = normStatus;
    if (normStatus === 'closed' || normStatus === 'ended') {
      room.participantCount = 0;
      room.closedAt = new Date();
    }
    await room.save();

    const populated = await GroupVoiceRoom.findById(room._id)
      .populate('host', 'id username fullName avatar accountStatus isOnline email')
      .populate('invitedUsers', 'id username fullName avatar accountStatus isOnline');

    return res.status(200).json({
      success: true,
      message: `Group Voice Room "${room.title}" status updated to "${normStatus}".`,
      groupVoiceRoom: GroupVoiceRoom.sanitize(populated)
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: DELETE /api/v1/admin/group-voice-rooms/:id
 * Admin moderation: Remove room record (Safe soft-delete or remove).
 * Active or scheduled rooms cannot be removed directly without closing first.
 */
async function deleteGroupVoiceRoom(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing Group Voice Room identifier.'
      });
    }

    let query;
    if (mongoose && mongoose.Types.ObjectId.isValid(id) && id.length === 24) {
      query = { $or: [{ _id: id }, { id: id }] };
    } else {
      query = { id: id };
    }

    const room = await GroupVoiceRoom.findOne({ ...query, isDeleted: false });

    if (!room) {
      return res.status(404).json({
        success: false,
        error: `Group Voice Room "${id}" was not found or has already been removed.`
      });
    }

    // Safety rule: If room is active or scheduled, it must be closed before removal
    if (room.status === 'active' || room.status === 'scheduled') {
      return res.status(400).json({
        success: false,
        error: `Cannot remove an ${room.status.toUpperCase()} room directly. Please close/disable the voice room first.`
      });
    }

    // Perform safe soft-delete
    room.isDeleted = true;
    room.closedAt = room.closedAt || new Date();
    await room.save();

    return res.status(200).json({
      success: true,
      message: `Group Voice Room "${room.title}" record removed successfully.`
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getGroupVoiceRooms,
  getGroupVoiceRoomById,
  updateGroupVoiceRoomStatus,
  deleteGroupVoiceRoom
};
