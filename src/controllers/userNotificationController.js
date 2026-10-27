const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');

/**
 * Helper: Find notification document by custom string ID or Mongo ObjectId
 */
async function findNotificationById(id) {
  if (!id) return null;
  const idStr = typeof id === 'string' ? id : (id.toString ? id.toString() : String(id));
  if (!idStr) return null;

  let query;
  if (mongoose && mongoose.Types.ObjectId.isValid(idStr) && idStr.length === 24) {
    query = { $or: [{ _id: idStr }, { id: idStr }] };
  } else {
    query = { id: idStr };
  }

  return await Notification.findOne(query);
}

/**
 * Controller: GET /api/v1/notifications
 * Retrieve paginated notifications for the authenticated user only.
 */
async function getUserNotifications(req, res, next) {
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
        error: 'Suspended or inactive user accounts cannot access notifications.'
      });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { category, type, status, unreadOnly } = req.query || {};

    const filter = { targetUser: currentUser._id };

    // Unread filter
    if (String(unreadOnly) === 'true' || status === 'unread' || category === 'unread') {
      filter.isRead = false;
    }

    // Type / Category filter
    if (category && category !== 'all' && category !== 'unread') {
      const catNorm = String(category).toLowerCase().trim();
      if (catNorm === 'requests') {
        filter.type = { $in: ['friend_request', 'friend_accepted'] };
      } else if (catNorm === 'messages') {
        filter.type = 'system_alert';
      } else if (catNorm === 'voice') {
        filter.type = { $in: ['call_alert', 'call_missed'] };
      } else if (catNorm === 'rooms') {
        filter.type = { $in: ['room_invite', 'room_reminder'] };
      }
    } else if (type && type !== 'all') {
      const typeNorm = String(type).toLowerCase().trim();
      const validTypes = ['call_alert', 'call_missed', 'friend_request', 'friend_accepted', 'safety_alert', 'system_alert', 'room_invite', 'room_reminder'];
      if (validTypes.includes(typeNorm)) {
        filter.type = typeNorm;
      }
    }

    const [rawNotifications, totalFiltered, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('sender', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio')
        .populate('targetUser', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio'),
      Notification.countDocuments(filter),
      Notification.countDocuments({ targetUser: currentUser._id, isRead: false })
    ]);

    const notifications = rawNotifications.map((n) => Notification.sanitize(n));
    const totalPages = Math.ceil(totalFiltered / limit) || 1;

    return res.status(200).json({
      success: true,
      notifications,
      data: notifications,
      unreadCount,
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
 * Controller: PATCH /api/v1/notifications/:id/read
 * Mark a single notification owned by the authenticated user as read.
 */
async function markNotificationAsRead(req, res, next) {
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
        error: 'Suspended or inactive user accounts cannot modify notifications.'
      });
    }

    const { id } = req.params;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Notification ID parameter is required.'
      });
    }

    const notifDoc = await findNotificationById(id.trim());

    if (!notifDoc) {
      return res.status(404).json({
        success: false,
        error: `Notification with ID "${id}" was not found.`
      });
    }

    // Ownership Check: Must belong to authenticated user
    const targetUserIdStr = notifDoc.targetUser.toString();
    const currentUserIdStr = currentUser._id.toString();

    if (targetUserIdStr !== currentUserIdStr) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You do not own this notification.'
      });
    }

    notifDoc.isRead = true;
    notifDoc.status = 'Read';
    await notifDoc.save();

    const populated = await Notification.findById(notifDoc._id)
      .populate('sender', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio')
      .populate('targetUser', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio');

    const sanitizedNotif = Notification.sanitize(populated);
    const unreadCount = await Notification.countDocuments({ targetUser: currentUser._id, isRead: false });

    // Emit notification:read socket event for multi-tab synchronization
    try {
      const { getIO } = require('../socket/socketServer');
      const io = getIO();
      if (io) {
        const payload = {
          notificationId: sanitizedNotif.id || sanitizedNotif._id,
          unreadCount
        };
        const uIdMongo = currentUser._id.toString();
        const uIdCustom = currentUser.id || uIdMongo;
        io.to(`user:${uIdMongo}`).to(`user:${uIdCustom}`).emit('notification:read', payload);
      }
    } catch (socketErr) {
      // Ignore socket errors
    }

    return res.status(200).json({
      success: true,
      message: 'Notification marked as read.',
      notification: sanitizedNotif,
      data: sanitizedNotif,
      unreadCount
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: POST /api/v1/notifications/read-all
 * Mark all notifications owned by the authenticated user as read.
 */
async function markAllNotificationsAsRead(req, res, next) {
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
        error: 'Suspended or inactive user accounts cannot modify notifications.'
      });
    }

    const result = await Notification.updateMany(
      { targetUser: currentUser._id, isRead: false },
      { $set: { isRead: true, status: 'Read' } }
    );

    // Emit notification:read-all socket event for multi-tab synchronization
    try {
      const { getIO } = require('../socket/socketServer');
      const io = getIO();
      if (io) {
        const payload = { unreadCount: 0 };
        const uIdMongo = currentUser._id.toString();
        const uIdCustom = currentUser.id || uIdMongo;
        io.to(`user:${uIdMongo}`).to(`user:${uIdCustom}`).emit('notification:read-all', payload);
      }
    } catch (socketErr) {
      // Ignore socket errors
    }

    return res.status(200).json({
      success: true,
      message: 'All notifications marked as read.',
      modifiedCount: result.modifiedCount || 0,
      unreadCount: 0
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: DELETE /api/v1/notifications/:id
 * Delete a single notification owned by the authenticated user.
 */
async function deleteNotification(req, res, next) {
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
        error: 'Suspended or inactive user accounts cannot modify notifications.'
      });
    }

    const { id } = req.params;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Notification ID parameter is required.'
      });
    }

    const notifDoc = await findNotificationById(id.trim());

    if (!notifDoc) {
      return res.status(404).json({
        success: false,
        error: `Notification with ID "${id}" was not found.`
      });
    }

    // Ownership Check: Must belong to authenticated user
    const targetUserIdStr = notifDoc.targetUser.toString();
    const currentUserIdStr = currentUser._id.toString();

    if (targetUserIdStr !== currentUserIdStr) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You do not own this notification.'
      });
    }

    await Notification.deleteOne({ _id: notifDoc._id });

    const unreadCount = await Notification.countDocuments({ targetUser: currentUser._id, isRead: false });

    // Emit notification:deleted socket event for multi-tab synchronization
    try {
      const { getIO } = require('../socket/socketServer');
      const io = getIO();
      if (io) {
        const payload = {
          notificationId: notifDoc.id || notifDoc._id.toString(),
          unreadCount
        };
        const uIdMongo = currentUser._id.toString();
        const uIdCustom = currentUser.id || uIdMongo;
        io.to(`user:${uIdMongo}`).to(`user:${uIdCustom}`).emit('notification:deleted', payload);
      }
    } catch (socketErr) {
      // Ignore socket errors
    }

    return res.status(200).json({
      success: true,
      message: 'Notification deleted successfully.',
      unreadCount
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification
};
