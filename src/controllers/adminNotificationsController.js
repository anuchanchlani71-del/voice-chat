const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');

/**
 * Controller: GET /api/v1/admin/notifications
 * Retrieve paginated notifications for the Admin Panel with search, type filtering, status filtering, and date range support.
 */
async function getNotifications(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { search, type, status, startDate, endDate, from, to } = req.query || {};

    const filter = {};

    // 1. Type Filter
    if (type && type !== 'all') {
      const normType = String(type).toLowerCase().trim();
      const validTypes = ['call_alert', 'call_missed', 'friend_request', 'friend_accepted', 'safety_alert', 'system_alert'];
      if (validTypes.includes(normType)) {
        filter.type = normType;
      }
    }

    // 2. Status / Read Filter
    if (status && status !== 'all') {
      const normStatus = String(status).toLowerCase().trim();
      if (normStatus === 'read') {
        filter.$or = [{ status: { $regex: /^read$/i } }, { isRead: true }];
      } else if (normStatus === 'delivered') {
        filter.$or = [{ status: { $regex: /^delivered$/i } }, { status: 'Delivered' }];
      } else if (normStatus === 'pending') {
        filter.$or = [{ status: { $regex: /^pending$/i } }, { status: 'Pending' }];
      }
    }

    // 3. Search Filter (by title, message, targetUser username/fullName/ID, or notification ID)
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
        { targetUser: { $in: userMongoIds } },
        { sender: { $in: userMongoIds } },
        { title: regex },
        { message: regex },
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
      rawNotifications,
      totalFiltered,
      totalAll,
      totalDelivered,
      totalRead,
      totalPending
    ] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('targetUser', 'id username fullName avatar accountStatus isOnline')
        .populate('sender', 'id username fullName avatar accountStatus isOnline'),
      Notification.countDocuments(filter),
      Notification.countDocuments({}),
      Notification.countDocuments({ $or: [{ status: { $regex: /^delivered$/i } }, { status: 'Delivered' }] }),
      Notification.countDocuments({ $or: [{ status: { $regex: /^read$/i } }, { isRead: true }] }),
      Notification.countDocuments({ $or: [{ status: { $regex: /^pending$/i } }, { status: 'Pending' }] })
    ]);

    const notifications = rawNotifications.map((n) => Notification.sanitize(n));
    const totalPages = Math.ceil(totalFiltered / limit) || 1;

    return res.status(200).json({
      success: true,
      notifications,
      counts: {
        all: totalAll,
        delivered: totalDelivered,
        read: totalRead,
        pending: totalPending
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
 * Controller: GET /api/v1/admin/notifications/:id
 * Retrieve full details of a specific notification record.
 */
async function getNotificationById(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Notification ID parameter is required.'
      });
    }

    let notifDoc = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      notifDoc = await Notification.findById(id)
        .populate('targetUser', 'id username fullName avatar bio interests email phone accountStatus isOnline lastSeen')
        .populate('sender', 'id username fullName avatar bio interests email phone accountStatus isOnline lastSeen');
    }

    if (!notifDoc) {
      notifDoc = await Notification.findOne({ id })
        .populate('targetUser', 'id username fullName avatar bio interests email phone accountStatus isOnline lastSeen')
        .populate('sender', 'id username fullName avatar bio interests email phone accountStatus isOnline lastSeen');
    }

    if (!notifDoc) {
      return res.status(404).json({
        success: false,
        error: `Notification record not found with ID "${id}".`
      });
    }

    return res.status(200).json({
      success: true,
      notification: Notification.sanitize(notifDoc)
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getNotifications,
  getNotificationById
};
