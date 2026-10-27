const mongoose = require('mongoose');
const FriendRequest = require('../models/FriendRequest');
const User = require('../models/User');

/**
 * Controller: GET /api/v1/admin/friend-requests
 * Retrieve paginated friend requests for the Admin Panel with search and status filtering.
 */
async function getFriendRequests(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { search, status } = req.query || {};

    const filter = {};

    // 1. Status Filter
    if (status && status !== 'all') {
      const normStatus = String(status).toLowerCase().trim();
      if (normStatus === 'rejected_cancelled') {
        filter.status = { $in: ['rejected', 'cancelled'] };
      } else if (['pending', 'accepted', 'rejected', 'cancelled'].includes(normStatus)) {
        filter.status = normStatus;
      }
    }

    // 2. Search by requester/recipient username, fullName, or request ID
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
        { recipient: { $in: userMongoIds } },
        { id: regex }
      ];
    }

    // Parallel fetch: Filtered records + Status counts for tabs
    const [rawRequests, totalFiltered, totalAll, totalPending, totalAccepted, totalRejectedCancelled] = await Promise.all([
      FriendRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('requester', 'id username fullName avatar')
        .populate('recipient', 'id username fullName avatar'),
      FriendRequest.countDocuments(filter),
      FriendRequest.countDocuments({}),
      FriendRequest.countDocuments({ status: 'pending' }),
      FriendRequest.countDocuments({ status: 'accepted' }),
      FriendRequest.countDocuments({ status: { $in: ['rejected', 'cancelled'] } })
    ]);

    const friendRequests = rawRequests.map((r) => FriendRequest.sanitize(r));
    const totalPages = Math.ceil(totalFiltered / limit) || 1;

    return res.status(200).json({
      success: true,
      friendRequests,
      counts: {
        all: totalAll,
        pending: totalPending,
        accepted: totalAccepted,
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
 * Controller: GET /api/v1/admin/friend-requests/:id
 * Retrieve full details of a specific friend request.
 */
async function getFriendRequestById(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Friend request ID parameter is required.'
      });
    }

    let requestDoc = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      requestDoc = await FriendRequest.findById(id)
        .populate('requester', 'id username fullName avatar bio interests email phone')
        .populate('recipient', 'id username fullName avatar bio interests email phone');
    }

    if (!requestDoc) {
      requestDoc = await FriendRequest.findOne({ id })
        .populate('requester', 'id username fullName avatar bio interests email phone')
        .populate('recipient', 'id username fullName avatar bio interests email phone');
    }

    if (!requestDoc) {
      return res.status(404).json({
        success: false,
        error: `Friend request record not found with ID "${id}".`
      });
    }

    return res.status(200).json({
      success: true,
      friendRequest: FriendRequest.sanitize(requestDoc)
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getFriendRequests,
  getFriendRequestById
};
