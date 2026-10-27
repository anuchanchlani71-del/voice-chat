const Notification = require('../models/Notification');

/**
 * Helper: Emit notification:new socket event after persistence in MongoDB
 * @param {string|object} notificationDocOrId - Mongoose document or ID of the created notification
 */
async function emitNotificationNew(notificationDocOrId) {
  try {
    const { getIO } = require('../socket/socketServer');
    const io = getIO();
    if (!io) return;

    let notifId = notificationDocOrId;
    if (typeof notificationDocOrId === 'object' && notificationDocOrId) {
      notifId = notificationDocOrId._id || notificationDocOrId.id;
    }

    if (!notifId) return;

    const populated = await Notification.findById(notifId)
      .populate('sender', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio')
      .populate('targetUser', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio');

    if (!populated) return;

    const sanitized = Notification.sanitize(populated);
    const targetMongoId = (populated.targetUser._id || populated.targetUser).toString();
    const targetCustomId = populated.targetUser.id || targetMongoId;

    const unreadCount = await Notification.countDocuments({
      targetUser: populated.targetUser._id || populated.targetUser,
      isRead: false
    });

    const payload = {
      notification: sanitized,
      unreadCount
    };

    io.to(`user:${targetMongoId}`).to(`user:${targetCustomId}`).emit('notification:new', payload);
  } catch (err) {
    // Socket emit failure should never block application execution
  }
}

module.exports = {
  emitNotificationNew
};
