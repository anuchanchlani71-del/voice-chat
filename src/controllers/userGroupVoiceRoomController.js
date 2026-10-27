const mongoose = require('mongoose');
const GroupVoiceRoom = require('../models/GroupVoiceRoom');
const User = require('../models/User');
const Block = require('../models/Block');

/**
 * Helper: Find active block relationship between two user ObjectIds
 */
async function areUsersBlocked(userAId, userBId) {
  if (!userAId || !userBId) return false;
  const block = await Block.findOne({
    $or: [
      { blockedBy: userAId, blockedUser: userBId, status: 'active' },
      { blockedBy: userBId, blockedUser: userAId, status: 'active' }
    ]
  });
  return !!block;
}

/**
 * Helper: Get array of ObjectIds for all users blocked by or who blocked the target userId
 */
async function getBlockedUserObjectIds(userMongoId) {
  const activeBlocks = await Block.find({
    $or: [
      { blockedBy: userMongoId, status: 'active' },
      { blockedUser: userMongoId, status: 'active' }
    ]
  }).select('blockedBy blockedUser');

  return activeBlocks.map((b) =>
    b.blockedBy.toString() === userMongoId.toString() ? b.blockedUser : b.blockedBy
  );
}

/**
 * Helper: Lookup room by custom string ID or Mongo ObjectId
 */
async function findRoomById(id) {
  if (!id) return null;
  const idStr = typeof id === 'string' ? id : (id.toString ? id.toString() : String(id));

  let query;
  if (mongoose && mongoose.Types.ObjectId.isValid(idStr) && idStr.length === 24) {
    query = { $or: [{ _id: idStr }, { id: idStr }] };
  } else {
    query = { id: idStr };
  }

  return await GroupVoiceRoom.findOne({ ...query, isDeleted: false })
    .populate('host', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio')
    .populate('invitedUsers', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio')
    .populate('speakers', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio')
    .populate('listeners', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio')
    .populate('raisedHands', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio');
}

/**
 * Controller: GET /api/v1/rooms
 * List discoverable Group Voice Rooms for authenticated user.
 */
async function getGroupVoiceRooms(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    const currentUser = await User.findUserByIdOrIdentifier(req.user.id);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: 'Authenticated user account not found.'
      });
    }

    if (currentUser.accountStatus !== 'active' || currentUser.isBlocked === true) {
      return res.status(403).json({
        success: false,
        error: 'Suspended or inactive user accounts cannot access room services.'
      });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { search, topic, category, accessType, status } = req.query || {};

    // Validate accessType parameter if explicitly provided
    if (accessType && accessType !== 'all') {
      const normAccess = String(accessType).toLowerCase().trim();
      if (normAccess !== 'anyone' && normAccess !== 'invite_only') {
        return res.status(400).json({
          success: false,
          error: 'Access type filter must be strictly "anyone" or "invite_only".'
        });
      }
    }

    // Get blocked users list for safety filtering
    const blockedUserObjectIds = await getBlockedUserObjectIds(currentUser._id);

    // Build base filter
    const filter = {
      isDeleted: false,
      host: { $nin: blockedUserObjectIds }
    };

    // Status filter (Default: active and scheduled)
    if (status && status !== 'all') {
      const normStatus = String(status).toLowerCase().trim();
      const validStatuses = ['active', 'scheduled', 'ended', 'closed'];
      if (!validStatuses.includes(normStatus)) {
        return res.status(400).json({
          success: false,
          error: `Invalid status parameter. Allowed values: ${validStatuses.join(', ')}`
        });
      }
      filter.status = normStatus;
    } else {
      filter.status = { $in: ['active', 'scheduled'] };
    }

    // Access Type filter (STRICT: only 'anyone' or 'invite_only')
    const andConditions = [];

    if (accessType && accessType !== 'all') {
      const normAccess = String(accessType).toLowerCase().trim();
      andConditions.push({ accessType: normAccess });
    }

    // Access permissions logic: User can view 'anyone' rooms OR invite_only rooms where they are host or invited
    andConditions.push({
      $or: [
        { accessType: 'anyone' },
        { host: currentUser._id },
        { invitedUsers: currentUser._id }
      ]
    });

    // Search filter (title, description, topic)
    if (search && typeof search === 'string' && search.trim()) {
      const term = search.trim();
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      andConditions.push({
        $or: [
          { title: regex },
          { description: regex },
          { topic: regex }
        ]
      });
    }

    // Topic / Category filter
    const topicParam = topic || category;
    if (topicParam && typeof topicParam === 'string' && topicParam.trim() && topicParam.trim() !== 'all') {
      const escaped = topicParam.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      andConditions.push({
        topic: new RegExp(escaped, 'i')
      });
    }

    if (andConditions.length > 0) {
      filter.$and = andConditions;
    }

    const [rawRooms, totalFiltered] = await Promise.all([
      GroupVoiceRoom.find(filter)
        .sort({ status: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('host', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio')
        .populate('invitedUsers', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio'),
      GroupVoiceRoom.countDocuments(filter)
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
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: GET /api/v1/rooms/:id
 * Retrieve details for a single Group Voice Room.
 */
async function getGroupVoiceRoomById(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    const currentUser = await User.findUserByIdOrIdentifier(req.user.id);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: 'Authenticated user account not found.'
      });
    }

    if (currentUser.accountStatus !== 'active' || currentUser.isBlocked === true) {
      return res.status(403).json({
        success: false,
        error: 'Suspended or inactive user accounts cannot access room services.'
      });
    }

    const { id } = req.params;
    const room = await findRoomById(id);

    if (!room) {
      return res.status(404).json({
        success: false,
        error: `Group Voice Room with ID "${id}" was not found.`
      });
    }

    // Safety check: Blocked relationship between current user and host
    if (await areUsersBlocked(currentUser._id, room.host._id)) {
      return res.status(403).json({
        success: false,
        error: 'You cannot access this room due to safety/block settings.'
      });
    }

    // Access permission check for invite_only rooms
    if (room.accessType === 'invite_only') {
      const isHost = room.host._id.toString() === currentUser._id.toString();
      const isInvited = Array.isArray(room.invitedUsers) && room.invitedUsers.some(
        (u) => (u._id || u).toString() === currentUser._id.toString()
      );

      if (!isHost && !isInvited) {
        return res.status(403).json({
          success: false,
          error: 'This room is invite-only. You must be invited by the host to access it.'
        });
      }
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
 * Controller: POST /api/v1/rooms
 * Create a new Group Voice Room.
 */
async function createGroupVoiceRoom(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    const currentUser = await User.findUserByIdOrIdentifier(req.user.id);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: 'Authenticated user account not found.'
      });
    }

    if (currentUser.accountStatus !== 'active' || currentUser.isBlocked === true) {
      return res.status(403).json({
        success: false,
        error: 'Suspended or inactive user accounts cannot create rooms.'
      });
    }

    const body = req.body || {};
    const { title, description, topic, capacity, accessType, status, invitedUsers } = body;

    // 1. Title Validation
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Room title is required.'
      });
    }
    if (title.trim().length > 150) {
      return res.status(400).json({
        success: false,
        error: 'Room title cannot exceed 150 characters.'
      });
    }

    // 2. Description & Topic Validation
    if (description !== undefined && typeof description === 'string' && description.trim().length > 1000) {
      return res.status(400).json({
        success: false,
        error: 'Room description cannot exceed 1000 characters.'
      });
    }

    if (topic !== undefined && typeof topic === 'string' && topic.trim().length > 150) {
      return res.status(400).json({
        success: false,
        error: 'Room topic cannot exceed 150 characters.'
      });
    }

    // 3. Capacity Validation (Min 2, Max 100)
    let parsedCapacity = 20;
    if (capacity !== undefined) {
      parsedCapacity = parseInt(capacity, 10);
      if (isNaN(parsedCapacity) || parsedCapacity < 2 || parsedCapacity > 100) {
        return res.status(400).json({
          success: false,
          error: 'Room capacity must be a valid number between 2 and 100.'
        });
      }
    }

    // 4. Access Type Validation (STRICT: only 'anyone' or 'invite_only')
    let normAccess = 'anyone';
    if (accessType !== undefined) {
      if (typeof accessType !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Access type must be strictly "anyone" or "invite_only".'
        });
      }
      normAccess = accessType.toLowerCase().trim();
      if (normAccess !== 'anyone' && normAccess !== 'invite_only') {
        return res.status(400).json({
          success: false,
          error: 'Access type must be strictly "anyone" or "invite_only". Other room types are not allowed.'
        });
      }
    }

    // 5. Status Validation (STRICT: only 'active' or 'scheduled')
    let normStatus = 'active';
    if (status !== undefined) {
      if (typeof status !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Status must be a string ("active" or "scheduled").'
        });
      }
      normStatus = status.toLowerCase().trim();
      if (normStatus !== 'active' && normStatus !== 'scheduled') {
        return res.status(400).json({
          success: false,
          error: 'Initial room status must be "active" or "scheduled".'
        });
      }
    }

    // 6. Handle initial invitedUsers list if provided
    const validInvitedUserObjectIds = [];
    if (Array.isArray(invitedUsers) && invitedUsers.length > 0) {
      for (const invId of invitedUsers) {
        if (invId && typeof invId === 'string') {
          const invUser = await User.findUserByIdOrIdentifier(invId.trim());
          if (invUser && invUser._id.toString() !== currentUser._id.toString()) {
            if (invUser.accountStatus === 'active' && !invUser.isBlocked) {
              const blocked = await areUsersBlocked(currentUser._id, invUser._id);
              if (!blocked && !validInvitedUserObjectIds.some((id) => id.toString() === invUser._id.toString())) {
                validInvitedUserObjectIds.push(invUser._id);
              }
            }
          }
        }
      }
    }

    // Initial participant count: Host joins active room
    const initialParticipantCount = normStatus === 'active' ? 1 : 0;

    const newRoomDoc = await GroupVoiceRoom.create({
      title: title.trim(),
      description: typeof description === 'string' ? description.trim() : '',
      topic: typeof topic === 'string' && topic.trim() ? topic.trim() : 'Casual Hangout & Chit-Chat',
      host: currentUser._id,
      capacity: parsedCapacity,
      accessType: normAccess,
      invitedUsers: validInvitedUserObjectIds,
      speakers: [],
      listeners: [],
      raisedHands: [],
      status: normStatus,
      participantCount: initialParticipantCount
    });

    const populatedRoom = await GroupVoiceRoom.findById(newRoomDoc._id)
      .populate('host', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio')
      .populate('invitedUsers', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio')
      .populate('speakers', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio')
      .populate('listeners', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio')
      .populate('raisedHands', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio');

    return res.status(201).json({
      success: true,
      message: 'Group Voice Room created successfully.',
      groupVoiceRoom: GroupVoiceRoom.sanitize(populatedRoom)
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: PATCH /api/v1/rooms/:id
 * Host-only update for allowed Group Voice Room fields.
 */
async function updateGroupVoiceRoom(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    const currentUser = await User.findUserByIdOrIdentifier(req.user.id);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: 'Authenticated user account not found.'
      });
    }

    if (currentUser.accountStatus !== 'active' || currentUser.isBlocked === true) {
      return res.status(403).json({
        success: false,
        error: 'Suspended or inactive user accounts cannot manage rooms.'
      });
    }

    const { id } = req.params;
    const room = await findRoomById(id);

    if (!room) {
      return res.status(404).json({
        success: false,
        error: `Group Voice Room with ID "${id}" was not found.`
      });
    }

    // Host permission check
    if (room.host._id.toString() !== currentUser._id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Only the room host can edit room details.'
      });
    }

    // Status restriction
    if (room.status === 'ended' || room.status === 'closed') {
      return res.status(400).json({
        success: false,
        error: `Cannot update a room that has been ${room.status}.`
      });
    }

    const body = req.body || {};
    const { title, description, topic, capacity, accessType, status } = body;

    // Title update
    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Room title cannot be empty.'
        });
      }
      if (title.trim().length > 150) {
        return res.status(400).json({
          success: false,
          error: 'Room title cannot exceed 150 characters.'
        });
      }
      room.title = title.trim();
    }

    // Description update
    if (description !== undefined) {
      if (typeof description !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Room description must be a string.'
        });
      }
      if (description.trim().length > 1000) {
        return res.status(400).json({
          success: false,
          error: 'Room description cannot exceed 1000 characters.'
        });
      }
      room.description = description.trim();
    }

    // Topic update
    if (topic !== undefined) {
      if (typeof topic !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Room topic must be a string.'
        });
      }
      if (topic.trim().length > 150) {
        return res.status(400).json({
          success: false,
          error: 'Room topic cannot exceed 150 characters.'
        });
      }
      room.topic = topic.trim();
    }

    // Capacity update
    if (capacity !== undefined) {
      const parsedCapacity = parseInt(capacity, 10);
      if (isNaN(parsedCapacity) || parsedCapacity < 2 || parsedCapacity > 100) {
        return res.status(400).json({
          success: false,
          error: 'Room capacity must be between 2 and 100.'
        });
      }
      if (parsedCapacity < room.participantCount) {
        return res.status(400).json({
          success: false,
          error: `Capacity (${parsedCapacity}) cannot be lower than current active participants (${room.participantCount}).`
        });
      }
      room.capacity = parsedCapacity;
    }

    // Access Type update (STRICT: only 'anyone' or 'invite_only')
    if (accessType !== undefined) {
      if (typeof accessType !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Access type must be strictly "anyone" or "invite_only".'
        });
      }
      const normAccess = accessType.toLowerCase().trim();
      if (normAccess !== 'anyone' && normAccess !== 'invite_only') {
        return res.status(400).json({
          success: false,
          error: 'Access type must be strictly "anyone" or "invite_only".'
        });
      }
      room.accessType = normAccess;
    }

    // Status update
    if (status !== undefined) {
      if (typeof status !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Status must be a valid string.'
        });
      }
      const normStatus = status.toLowerCase().trim();
      const validStatuses = ['active', 'scheduled', 'ended', 'closed'];
      if (!validStatuses.includes(normStatus)) {
        return res.status(400).json({
          success: false,
          error: `Invalid status "${status}". Allowed values: ${validStatuses.join(', ')}`
        });
      }
      room.status = normStatus;
      if (normStatus === 'ended' || normStatus === 'closed') {
        room.participantCount = 0;
        room.closedAt = new Date();
      }
    }

    await room.save();

    const updatedRoom = await findRoomById(room._id);

    return res.status(200).json({
      success: true,
      message: 'Group Voice Room updated successfully.',
      groupVoiceRoom: GroupVoiceRoom.sanitize(updatedRoom)
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: POST /api/v1/rooms/:id/join
 * Authenticated user joins a Group Voice Room.
 */
async function joinGroupVoiceRoom(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    const currentUser = await User.findUserByIdOrIdentifier(req.user.id);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: 'Authenticated user account not found.'
      });
    }

    if (currentUser.accountStatus !== 'active' || currentUser.isBlocked === true) {
      return res.status(403).json({
        success: false,
        error: 'Suspended or inactive user accounts cannot join rooms.'
      });
    }

    const { id } = req.params;
    const room = await findRoomById(id);

    if (!room) {
      return res.status(404).json({
        success: false,
        error: `Group Voice Room with ID "${id}" was not found.`
      });
    }

    // Status check
    if (room.status === 'ended' || room.status === 'closed') {
      return res.status(400).json({
        success: false,
        error: `Cannot join room. The room has been ${room.status}.`
      });
    }

    // Safety check: Block relationship between current user and host
    if (await areUsersBlocked(currentUser._id, room.host._id)) {
      return res.status(403).json({
        success: false,
        error: 'You cannot join this room due to safety/block settings.'
      });
    }

    const isHost = room.host._id.toString() === currentUser._id.toString();

    // Access Type check for invite_only rooms
    if (room.accessType === 'invite_only') {
      const isInvited = Array.isArray(room.invitedUsers) && room.invitedUsers.some(
        (u) => (u._id || u).toString() === currentUser._id.toString()
      );

      if (!isHost && !isInvited) {
        return res.status(403).json({
          success: false,
          error: 'This room is invite-only. You must be invited by the host to join.'
        });
      }
    }

    // Capacity overflow check
    if (room.participantCount >= room.capacity) {
      return res.status(400).json({
        success: false,
        error: `Room capacity limit reached (${room.capacity}/${room.capacity}). Cannot join.`
      });
    }

    // Ensure role arrays exist
    if (!Array.isArray(room.listeners)) room.listeners = [];
    if (!Array.isArray(room.speakers)) room.speakers = [];
    if (!Array.isArray(room.raisedHands)) room.raisedHands = [];

    const currentUserIdStr = currentUser._id.toString();

    const isAlreadyListener = room.listeners.some((u) => (u?._id || u).toString() === currentUserIdStr);
    const isAlreadySpeaker = room.speakers.some((u) => (u?._id || u).toString() === currentUserIdStr);
    const isAlreadyParticipant = isHost || isAlreadyListener || isAlreadySpeaker;

    // Normal users join listeners list without duplicates
    if (!isHost && !isAlreadyParticipant) {
      room.listeners.push(currentUser._id);
    }

    // Transition scheduled room to active upon join if needed
    if (room.status === 'scheduled') {
      room.status = 'active';
    }

    // Increment participant count only if this is a newly joining participant
    if (!isAlreadyParticipant) {
      room.participantCount = Math.min(room.capacity, (room.participantCount || 0) + 1);
    }
    await room.save();

    const updatedRoom = await findRoomById(room._id);

    try {
      const { emitRoomMemberJoined } = require('../utils/roomSocketHelper');
      emitRoomMemberJoined(updatedRoom, currentUser);
    } catch (socketErr) {
      // Non-fatal socket error
    }

    return res.status(200).json({
      success: true,
      message: 'Successfully joined room.',
      groupVoiceRoom: GroupVoiceRoom.sanitize(updatedRoom)
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: POST /api/v1/rooms/:id/leave
 * Authenticated user leaves a Group Voice Room.
 */
async function leaveGroupVoiceRoom(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    const currentUser = await User.findUserByIdOrIdentifier(req.user.id);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: 'Authenticated user account not found.'
      });
    }

    const { id } = req.params;
    const room = await findRoomById(id);

    if (!room) {
      return res.status(404).json({
        success: false,
        error: `Group Voice Room with ID "${id}" was not found.`
      });
    }

    // Safely remove participant from all role arrays
    if (!Array.isArray(room.listeners)) room.listeners = [];
    if (!Array.isArray(room.speakers)) room.speakers = [];
    if (!Array.isArray(room.raisedHands)) room.raisedHands = [];

    const currentUserIdStr = currentUser._id.toString();
    const wasListener = room.listeners.some((u) => (u?._id || u).toString() === currentUserIdStr);
    const wasSpeaker = room.speakers.some((u) => (u?._id || u).toString() === currentUserIdStr);

    room.listeners = room.listeners.filter((u) => (u?._id || u).toString() !== currentUserIdStr);
    room.speakers = room.speakers.filter((u) => (u?._id || u).toString() !== currentUserIdStr);
    room.raisedHands = room.raisedHands.filter((u) => (u?._id || u).toString() !== currentUserIdStr);

    // Decrement participant count safely
    if (wasListener || wasSpeaker) {
      room.participantCount = Math.max(0, (room.participantCount || 1) - 1);
    } else {
      room.participantCount = Math.max(0, (room.participantCount || 0) - 1);
    }
    await room.save();

    const updatedRoom = await findRoomById(room._id);

    try {
      const { emitRoomMemberLeft } = require('../utils/roomSocketHelper');
      emitRoomMemberLeft(updatedRoom || room, currentUser);
    } catch (socketErr) {
      // Non-fatal socket error
    }

    return res.status(200).json({
      success: true,
      message: 'Successfully left room.',
      groupVoiceRoom: GroupVoiceRoom.sanitize(updatedRoom || room)
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: POST /api/v1/rooms/:id/end or /close
 * Host ends or closes a Group Voice Room.
 */
async function closeGroupVoiceRoom(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    const currentUser = await User.findUserByIdOrIdentifier(req.user.id);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: 'Authenticated user account not found.'
      });
    }

    const { id } = req.params;
    const room = await findRoomById(id);

    if (!room) {
      return res.status(404).json({
        success: false,
        error: `Group Voice Room with ID "${id}" was not found.`
      });
    }

    // Host check
    if (room.host._id.toString() !== currentUser._id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Only the room host can end or close this room.'
      });
    }

    const reqUrlStr = req.path || req.url || '';
    const targetStatus = reqUrlStr.includes('/end') ? 'ended' : 'closed';
    room.status = targetStatus;
    room.participantCount = 0;
    room.endedAt = new Date().toISOString();
    room.closedAt = new Date();
    await room.save();

    const updatedRoom = await findRoomById(room._id);

    try {
      const { emitRoomClosed } = require('../utils/roomSocketHelper');
      emitRoomClosed(updatedRoom || room);
    } catch (socketErr) {
      // Non-fatal socket error
    }

    return res.status(200).json({
      success: true,
      message: `Room ${targetStatus} successfully.`,
      groupVoiceRoom: GroupVoiceRoom.sanitize(updatedRoom || room)
    });

  } catch (err) {
    next(err);
  }
}

/**
 * Controller: POST /api/v1/rooms/:id/invite
 * Host invites users to an invite_only or active room.
 */
async function inviteUsersToRoom(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    const currentUser = await User.findUserByIdOrIdentifier(req.user.id);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: 'Authenticated user account not found.'
      });
    }

    if (currentUser.accountStatus !== 'active' || currentUser.isBlocked === true) {
      return res.status(403).json({
        success: false,
        error: 'Suspended or inactive user accounts cannot invite users to rooms.'
      });
    }

    const { id } = req.params;
    const room = await findRoomById(id);

    if (!room) {
      return res.status(404).json({
        success: false,
        error: `Group Voice Room with ID "${id}" was not found.`
      });
    }

    // Host check
    if (room.host._id.toString() !== currentUser._id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Only the room host can invite users.'
      });
    }

    // Status check
    if (room.status === 'ended' || room.status === 'closed') {
      return res.status(400).json({
        success: false,
        error: `Cannot invite users to an ${room.status} room.`
      });
    }

    const body = req.body || {};
    const inputIds = body.userIds || body.userId || body.targetUserId || body.invitedUsers;

    if (!inputIds) {
      return res.status(400).json({
        success: false,
        error: 'Please provide user ID(s) to invite.'
      });
    }

    const idList = Array.isArray(inputIds) ? inputIds : [inputIds];
    const newlyInvited = [];

    for (const rawId of idList) {
      if (rawId && typeof rawId === 'string' && rawId.trim()) {
        const invUser = await User.findUserByIdOrIdentifier(rawId.trim());
        if (invUser && invUser._id.toString() !== currentUser._id.toString()) {
          // Check active user status
          if (invUser.accountStatus === 'active' && !invUser.isBlocked) {
            // Check block status
            const isBlocked = await areUsersBlocked(currentUser._id, invUser._id);
            if (!isBlocked) {
              const alreadyInvited = Array.isArray(room.invitedUsers) && room.invitedUsers.some(
                (u) => (u._id || u).toString() === invUser._id.toString()
              );
              if (!alreadyInvited) {
                room.invitedUsers.push(invUser._id);
                newlyInvited.push(User.sanitize(invUser));
              }
            }
          }
        }
      }
    }

    await room.save();

    const updatedRoom = await findRoomById(room._id);

    return res.status(200).json({
      success: true,
      message: `${newlyInvited.length} user(s) invited successfully.`,
      groupVoiceRoom: GroupVoiceRoom.sanitize(updatedRoom),
      invitedUsers: newlyInvited
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: GET /api/v1/rooms/:id/members
 * Retrieve sanitized public user information for room members/participants.
 */
async function getRoomMembers(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    const currentUser = await User.findUserByIdOrIdentifier(req.user.id);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: 'Authenticated user account not found.'
      });
    }

    const { id } = req.params;
    const room = await findRoomById(id);

    if (!room) {
      return res.status(404).json({
        success: false,
        error: `Group Voice Room with ID "${id}" was not found.`
      });
    }

    // Safety check: Block relationship
    if (await areUsersBlocked(currentUser._id, room.host._id)) {
      return res.status(403).json({
        success: false,
        error: 'You cannot view members of this room due to safety/block settings.'
      });
    }

    // Access check for invite_only rooms
    if (room.accessType === 'invite_only') {
      const isHost = room.host._id.toString() === currentUser._id.toString();
      const isInvited = Array.isArray(room.invitedUsers) && room.invitedUsers.some(
        (u) => (u._id || u).toString() === currentUser._id.toString()
      );

      if (!isHost && !isInvited) {
        return res.status(403).json({
          success: false,
          error: 'This room is invite-only.'
        });
      }
    }

    const sanitizedHost = User.sanitize(room.host);
    const sanitizedInvitedUsers = Array.isArray(room.invitedUsers)
      ? room.invitedUsers.map((u) => User.sanitize(u))
      : [];
    const sanitizedSpeakers = Array.isArray(room.speakers)
      ? room.speakers.map((u) => User.sanitize(u))
      : [];
    const sanitizedListeners = Array.isArray(room.listeners)
      ? room.listeners.map((u) => User.sanitize(u))
      : [];
    const sanitizedRaisedHands = Array.isArray(room.raisedHands)
      ? room.raisedHands.map((u) => User.sanitize(u))
      : [];

    return res.status(200).json({
      success: true,
      members: {
        host: sanitizedHost,
        invitedUsers: sanitizedInvitedUsers,
        speakers: sanitizedSpeakers,
        listeners: sanitizedListeners,
        raisedHands: sanitizedRaisedHands,
        totalInvited: sanitizedInvitedUsers.length,
        participantCount: room.participantCount
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getGroupVoiceRooms,
  getGroupVoiceRoomById,
  createGroupVoiceRoom,
  updateGroupVoiceRoom,
  joinGroupVoiceRoom,
  leaveGroupVoiceRoom,
  closeGroupVoiceRoom,
  inviteUsersToRoom,
  getRoomMembers
};
