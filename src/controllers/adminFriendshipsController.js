const mongoose = require('mongoose');
const Friendship = require('../models/Friendship');
const User = require('../models/User');

/**
 * Controller: GET /api/v1/admin/friendships
 * Retrieve paginated friendships and connection requests for the Admin Panel.
 */
async function getFriendships(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { search, status } = req.query || {};

    const filter = {};

    // 1. Status Filter matching Admin Panel Tabs
    if (status && status !== 'all') {
      const normStatus = String(status).toLowerCase().trim();
      if (normStatus === 'accepted') {
        filter.status = 'accepted';
      } else if (normStatus === 'pending') {
        filter.status = 'pending';
      } else if (normStatus === 'rejected_cancelled') {
        filter.status = { $in: ['rejected', 'cancelled'] };
      } else if (['rejected', 'cancelled'].includes(normStatus)) {
        filter.status = normStatus;
      }
    }

    // 2. Search by Requester or Recipient username / fullName
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
        { requester: { $in: userMongoIds } },
        { recipient: { $in: userMongoIds } }
      ];
    }

    // Parallel fetch: Filtered records + Total counts for tab statistics
    const [rawFriendships, totalFiltered, totalAll, totalAccepted, totalPending, totalRejectedCancelled] = await Promise.all([
      Friendship.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('requester', 'id username fullName avatar')
        .populate('recipient', 'id username fullName avatar'),
      Friendship.countDocuments(filter),
      Friendship.countDocuments({}),
      Friendship.countDocuments({ status: 'accepted' }),
      Friendship.countDocuments({ status: 'pending' }),
      Friendship.countDocuments({ status: { $in: ['rejected', 'cancelled'] } })
    ]);

    const friendships = rawFriendships.map((f) => Friendship.sanitize(f));
    const totalPages = Math.ceil(totalFiltered / limit) || 1;

    return res.status(200).json({
      success: true,
      friendships,
      counts: {
        all: totalAll,
        accepted: totalAccepted,
        pending: totalPending,
        rejected_cancelled: totalRejectedCancelled
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
 * Controller: GET /api/v1/admin/friendships/:id
 * Retrieve specific friendship details for the Admin Panel.
 */
async function getFriendshipById(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Friendship ID parameter is required.'
      });
    }

    let friendship = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      friendship = await Friendship.findById(id)
        .populate('requester', 'id username fullName avatar bio interests email phone')
        .populate('recipient', 'id username fullName avatar bio interests email phone');
    }

    if (!friendship) {
      friendship = await Friendship.findOne({ id })
        .populate('requester', 'id username fullName avatar bio interests email phone')
        .populate('recipient', 'id username fullName avatar bio interests email phone');
    }

    if (!friendship) {
      return res.status(404).json({
        success: false,
        error: `Friendship record not found with ID "${id}".`
      });
    }

    return res.status(200).json({
      success: true,
      friendship: Friendship.sanitize(friendship)
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getFriendships,
  getFriendshipById
};
