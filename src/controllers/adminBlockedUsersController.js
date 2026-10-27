const mongoose = require('mongoose');
const Block = require('../models/Block');
const User = require('../models/User');

/**
 * Controller: GET /api/v1/admin/blocked-users
 * Retrieve paginated blocked user relationships for the Admin Panel with search, status filtering, and date range support.
 */
async function getBlockedUsers(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { search, status, reason, startDate, endDate, from, to } = req.query || {};

    const filter = {};

    // 1. Status Filter (active, released, all)
    if (status && status !== 'all') {
      const normStatus = String(status).toLowerCase().trim();
      if (['active', 'released'].includes(normStatus)) {
        filter.status = normStatus;
      }
    }

    // 2. Reason Filter
    if (reason && typeof reason === 'string' && reason.trim()) {
      const reasonTerm = reason.trim();
      const escapedReason = reasonTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.reason = new RegExp(escapedReason, 'i');
    }

    // 3. Search Filter (by blockedUser/blockedBy username, fullName, user ID, reason, or block ID)
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
        { blockedUser: { $in: userMongoIds } },
        { blockedBy: { $in: userMongoIds } },
        { reason: regex },
        { id: regex }
      ];
    }

    // 4. Date Range Filter
    const dateStart = startDate || from;
    const dateEnd = endDate || to;
    if (dateStart || dateEnd) {
      filter.createdAt = {};
      if (dateStart && !isNaN(new Date(dateStart).getTime())) {
        filter.createdAt.$gte = new Date(dateStart);
      }
      if (dateEnd && !isNaN(new Date(dateEnd).getTime())) {
        const endD = new Date(dateEnd);
        if (dateEnd.length <= 10) {
          endD.setHours(23, 59, 59, 999);
        }
        filter.createdAt.$lte = endD;
      }
      if (Object.keys(filter.createdAt).length === 0) {
        delete filter.createdAt;
      }
    }

    // Parallel fetch: Filtered records + Status counts
    const [
      rawBlocks,
      totalFiltered,
      totalAll,
      totalActive,
      totalReleased
    ] = await Promise.all([
      Block.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('blockedUser', 'id username fullName avatar accountStatus isOnline reportsCount isBlocked')
        .populate('blockedBy', 'id username fullName avatar accountStatus isOnline'),
      Block.countDocuments(filter),
      Block.countDocuments({}),
      Block.countDocuments({ status: 'active' }),
      Block.countDocuments({ status: 'released' })
    ]);

    const blockedUsers = rawBlocks.map((b) => Block.sanitize(b));
    const totalPages = Math.ceil(totalFiltered / limit) || 1;

    return res.status(200).json({
      success: true,
      blockedUsers,
      counts: {
        all: totalAll,
        active: totalActive,
        released: totalReleased
      },
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
 * Controller: GET /api/v1/admin/blocked-users/:id
 * Retrieve full details of a specific blocked user relationship.
 */
async function getBlockedUserById(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Block ID parameter is required.'
      });
    }

    let blockDoc = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      blockDoc = await Block.findById(id)
        .populate('blockedUser', 'id username fullName avatar bio interests email phone accountStatus isOnline lastSeen reportsCount isBlocked')
        .populate('blockedBy', 'id username fullName avatar bio interests email phone accountStatus isOnline lastSeen')
        .populate('releasedBy', 'id username name email role');
    }

    if (!blockDoc) {
      blockDoc = await Block.findOne({ id })
        .populate('blockedUser', 'id username fullName avatar bio interests email phone accountStatus isOnline lastSeen reportsCount isBlocked')
        .populate('blockedBy', 'id username fullName avatar bio interests email phone accountStatus isOnline lastSeen')
        .populate('releasedBy', 'id username name email role');
    }

    if (!blockDoc) {
      return res.status(404).json({
        success: false,
        error: `Blocked user record not found with ID "${id}".`
      });
    }

    return res.status(200).json({
      success: true,
      blockedUser: Block.sanitize(blockDoc)
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getBlockedUsers,
  getBlockedUserById
};
