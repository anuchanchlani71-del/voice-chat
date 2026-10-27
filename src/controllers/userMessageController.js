const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const Block = require('../models/Block');
const Notification = require('../models/Notification');

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
 * Helper: Verify if two users are accepted friends
 */
async function areUsersFriends(userAId, userBId) {
  if (!userAId || !userBId) return false;
  const userPairKey = Friendship.generateUserPairKey(userAId, userBId);
  const friendship = await Friendship.findOne({ userPairKey, status: 'accepted' });
  return !!friendship;
}

/**
 * Helper: Lookup conversation by custom string ID or Mongo ObjectId
 */
async function findConversationById(id) {
  if (!id) return null;
  const idStr = typeof id === 'string' ? id : (id.toString ? id.toString() : String(id));
  if (!idStr) return null;

  let query;
  if (mongoose && mongoose.Types.ObjectId.isValid(idStr) && idStr.length === 24) {
    query = { $or: [{ _id: idStr }, { id: idStr }] };
  } else {
    query = { id: idStr };
  }

  return await Conversation.findOne({ ...query, isDeleted: false })
    .populate('participants', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio')
    .populate('lastSender', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio');
}

/**
 * Controller: GET /api/v1/messages/conversations
 * List all conversations for the authenticated user.
 */
async function getConversations(req, res, next) {
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
        error: 'Suspended or inactive user accounts cannot access messaging services.'
      });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    // Get active blocks to filter out blocked user conversations
    const activeBlocks = await Block.find({
      $or: [
        { blockedBy: currentUser._id, status: 'active' },
        { blockedUser: currentUser._id, status: 'active' }
      ]
    }).select('blockedBy blockedUser');

    const blockedUserObjectIds = activeBlocks.map((b) =>
      b.blockedBy.toString() === currentUser._id.toString() ? b.blockedUser : b.blockedBy
    );

    const filter = {
      participants: currentUser._id,
      isDeleted: false,
      clearedBy: { $ne: currentUser._id },
      participants: { $nin: blockedUserObjectIds }
    };

    const [rawConvs, totalFiltered] = await Promise.all([
      Conversation.find(filter)
        .sort({ lastMessageAt: -1, updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('participants', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio')
        .populate('lastSender', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio'),
      Conversation.countDocuments(filter)
    ]);

    let totalUnreadCount = 0;
    const conversations = rawConvs.map((c) => {
      const sanitized = Conversation.sanitize(c);
      const currentUserIdStr = currentUser._id.toString();

      // Extract unread count for current user
      let unread = 0;
      if (c.unreadCounts) {
        if (typeof c.unreadCounts.get === 'function') {
          unread = c.unreadCounts.get(currentUserIdStr) || 0;
        } else if (typeof c.unreadCounts === 'object') {
          unread = c.unreadCounts[currentUserIdStr] || 0;
        }
      }
      sanitized.unreadCount = unread;
      totalUnreadCount += unread;

      // Identify friend participant
      const friend = Array.isArray(sanitized.participants)
        ? sanitized.participants.find((p) => p.id !== currentUser.id && p.id !== currentUserIdStr)
        : null;
      sanitized.friend = friend || null;
      sanitized.friendId = friend ? friend.id : null;

      return sanitized;
    });

    const totalPages = Math.ceil(totalFiltered / limit) || 1;

    return res.status(200).json({
      success: true,
      conversations,
      totalUnreadCount,
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
 * Controller: GET /api/v1/messages/conversations/:conversationId
 * Retrieve detailed messages for a specific conversation with pagination.
 */
async function getConversationById(req, res, next) {
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
        error: 'Suspended or inactive user accounts cannot access messaging services.'
      });
    }

    const { conversationId } = req.params;
    let conv = await findConversationById(conversationId);

    if (!conv) {
      const targetUser = await User.findUserByIdOrIdentifier(conversationId);
      if (targetUser) {
        const userPairKey = Conversation.generateUserPairKey(currentUser._id, targetUser._id);
        conv = await Conversation.findOne({ userPairKey, isDeleted: false })
          .populate('participants', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio')
          .populate('lastSender', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio');
      }
    }

    if (!conv) {
      return res.status(404).json({
        success: false,
        error: `Conversation with ID "${conversationId}" was not found.`
      });
    }

    // Authorization check: User must be a participant
    const isParticipant = Array.isArray(conv.participants) && conv.participants.some(
      (p) => (p._id || p).toString() === currentUser._id.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You are not a participant in this conversation.'
      });
    }

    // Safety block check with the other participant
    const otherParticipant = conv.participants.find(
      (p) => (p._id || p).toString() !== currentUser._id.toString()
    );

    if (otherParticipant && await areUsersBlocked(currentUser._id, otherParticipant._id || otherParticipant)) {
      return res.status(403).json({
        success: false,
        error: 'Messaging unavailable due to safety/block settings.'
      });
    }

    // Pagination for messages
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const skip = (page - 1) * limit;

    const messageFilter = {
      conversation: conv._id,
      isDeleted: false
    };

    const [rawMessages, totalMessages] = await Promise.all([
      Message.find(messageFilter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('sender', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio')
        .populate('receiver', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio'),
      Message.countDocuments(messageFilter)
    ]);

    // Reverse array to return chronological order (oldest to newest for chat view)
    const messages = rawMessages.map((m) => Message.sanitize(m)).reverse();
    const totalPages = Math.ceil(totalMessages / limit) || 1;

    const sanitizedConv = Conversation.sanitize(conv);
    const friend = Array.isArray(sanitizedConv.participants)
      ? sanitizedConv.participants.find((p) => p.id !== currentUser.id && p.id !== currentUser._id.toString())
      : null;
    sanitizedConv.friend = friend || null;
    sanitizedConv.friendId = friend ? friend.id : null;

    return res.status(200).json({
      success: true,
      conversation: sanitizedConv,
      messages,
      pagination: {
        currentPage: page,
        pageSize: limit,
        totalItems: totalMessages,
        totalPages
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: POST /api/v1/messages/conversations
 * Get or create a 1-to-1 conversation with a friend.
 */
async function createOrGetConversation(req, res, next) {
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
        error: 'Suspended or inactive user accounts cannot initiate conversations.'
      });
    }

    const body = req.body || {};
    const targetUserIdInput = body.recipientId || body.targetUserId || body.userId || body.friendId;

    if (!targetUserIdInput || typeof targetUserIdInput !== 'string' || !targetUserIdInput.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid friend or target user ID.'
      });
    }

    const targetUser = await User.findUserByIdOrIdentifier(targetUserIdInput.trim());

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: 'Target user account not found.'
      });
    }

    // 1. Self-conversation restriction
    if (currentUser._id.toString() === targetUser._id.toString()) {
      return res.status(400).json({
        success: false,
        error: 'You cannot start a conversation with yourself.'
      });
    }

    // 2. Suspended target check
    if (targetUser.accountStatus !== 'active' || targetUser.isBlocked === true) {
      return res.status(403).json({
        success: false,
        error: 'Cannot message an inactive or suspended user account.'
      });
    }

    // 3. Block check
    if (await areUsersBlocked(currentUser._id, targetUser._id)) {
      return res.status(403).json({
        success: false,
        error: 'Messaging unavailable due to safety/block settings.'
      });
    }

    // 4. Friendship check: Must be accepted friends
    const isFriend = await areUsersFriends(currentUser._id, targetUser._id);
    if (!isFriend) {
      return res.status(403).json({
        success: false,
        error: 'Messaging is restricted to accepted friends.'
      });
    }

    const userPairKey = Conversation.generateUserPairKey(currentUser._id, targetUser._id);

    let conv = await Conversation.findOne({ userPairKey, isDeleted: false });

    if (conv) {
      // Remove current user from clearedBy if present
      if (Array.isArray(conv.clearedBy) && conv.clearedBy.some((id) => id.toString() === currentUser._id.toString())) {
        conv.clearedBy = conv.clearedBy.filter((id) => id.toString() !== currentUser._id.toString());
        await conv.save();
      }

      const populatedConv = await findConversationById(conv._id);
      const sanitizedConv = Conversation.sanitize(populatedConv);
      const friend = Array.isArray(sanitizedConv.participants)
        ? sanitizedConv.participants.find((p) => p.id !== currentUser.id && p.id !== currentUser._id.toString())
        : null;
      sanitizedConv.friend = friend || null;
      sanitizedConv.friendId = friend ? friend.id : null;

      return res.status(200).json({
        success: true,
        conversation: sanitizedConv
      });
    }

    // Create new conversation
    const newConvDoc = await Conversation.create({
      participants: [currentUser._id, targetUser._id],
      userPairKey,
      lastMessage: '',
      lastMessageAt: new Date(),
      lastSender: currentUser._id,
      unreadCounts: {}
    });

    const populatedConv = await findConversationById(newConvDoc._id);
    const sanitizedConv = Conversation.sanitize(populatedConv);
    const friend = Array.isArray(sanitizedConv.participants)
      ? sanitizedConv.participants.find((p) => p.id !== currentUser.id && p.id !== currentUser._id.toString())
      : null;
    sanitizedConv.friend = friend || null;
    sanitizedConv.friendId = friend ? friend.id : null;

    return res.status(201).json({
      success: true,
      message: 'Conversation initialized successfully.',
      conversation: sanitizedConv
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: POST /api/v1/messages/conversations/:conversationId/messages
 * Send a message in a conversation.
 */
async function sendMessage(req, res, next) {
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
        error: 'Suspended or inactive user accounts cannot send messages.'
      });
    }

    const body = req.body || {};
    const conversationIdParam = req.params.conversationId || body.conversationId;
    const { text } = body;

    if (!conversationIdParam || typeof conversationIdParam !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Conversation ID is required.'
      });
    }

    const conv = await findConversationById(conversationIdParam);

    if (!conv) {
      return res.status(404).json({
        success: false,
        error: `Conversation with ID "${conversationIdParam}" was not found.`
      });
    }

    // Authorization check: User must be a participant
    const isParticipant = Array.isArray(conv.participants) && conv.participants.some(
      (p) => (p._id || p).toString() === currentUser._id.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You are not a participant in this conversation.'
      });
    }

    // Determine receiver
    const receiver = conv.participants.find(
      (p) => (p._id || p).toString() !== currentUser._id.toString()
    );

    if (!receiver) {
      return res.status(400).json({
        success: false,
        error: 'Conversation receiver not found.'
      });
    }

    const receiverId = receiver._id || receiver;

    // Safety Block check
    if (await areUsersBlocked(currentUser._id, receiverId)) {
      return res.status(403).json({
        success: false,
        error: 'Cannot send message due to safety/block settings.'
      });
    }

    // Friendship check
    const isFriend = await areUsersFriends(currentUser._id, receiverId);
    if (!isFriend) {
      return res.status(403).json({
        success: false,
        error: 'Messaging is restricted to accepted friends.'
      });
    }

    // Message text validation
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Message text cannot be empty.'
      });
    }

    if (text.trim().length > 2000) {
      return res.status(400).json({
        success: false,
        error: 'Message text cannot exceed 2000 characters.'
      });
    }

    const trimmedText = text.trim();

    // Create Message document
    const newMessageDoc = await Message.create({
      conversation: conv._id,
      conversationId: conv.id,
      sender: currentUser._id,
      receiver: receiverId,
      text: trimmedText,
      isRead: false
    });

    // Update Conversation metadata
    conv.lastMessage = trimmedText;
    conv.lastMessageAt = new Date();
    conv.lastSender = currentUser._id;
    conv.clearedBy = [];

    // Increment unread count for receiver
    const receiverIdStr = receiverId.toString();
    const currentUnread = conv.unreadCounts ? (conv.unreadCounts.get ? (conv.unreadCounts.get(receiverIdStr) || 0) : (conv.unreadCounts[receiverIdStr] || 0)) : 0;
    
    if (conv.unreadCounts && typeof conv.unreadCounts.set === 'function') {
      conv.unreadCounts.set(receiverIdStr, currentUnread + 1);
    } else {
      conv.unreadCounts = conv.unreadCounts || {};
      conv.unreadCounts[receiverIdStr] = currentUnread + 1;
    }

    await conv.save();

    // Create Notification for receiver
    try {
      const newNotif = await Notification.create({
        targetUser: receiverId,
        sender: currentUser._id,
        type: 'system_alert',
        title: `New message from ${currentUser.fullName || currentUser.username}`,
        message: trimmedText.length > 80 ? `${trimmedText.slice(0, 77)}...` : trimmedText,
        metadata: {
          conversationId: conv.id,
          senderId: currentUser.id || currentUser._id.toString()
        }
      });
      const { emitNotificationNew } = require('../utils/notificationSocketHelper');
      emitNotificationNew(newNotif._id);
    } catch (notifErr) {
      // Notification errors should not block message delivery
    }

    const populatedMsg = await Message.findById(newMessageDoc._id)
      .populate('sender', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio')
      .populate('receiver', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio');

    const sanitizedMsgData = Message.sanitize(populatedMsg);

    // Socket.IO Realtime Delivery to Recipient & Sender Rooms
    try {
      const { getIO } = require('../socket/socketServer');
      const io = getIO();
      if (io) {
        const payload = {
          message: sanitizedMsgData,
          conversationId: conv.id || conv._id.toString()
        };

        const rIdStr = receiverId.toString();
        const sIdStr = currentUser._id.toString();

        io.to(`user:${rIdStr}`).to(`user:${sIdStr}`).emit('message:new', payload);

        if (receiver && receiver.id) {
          io.to(`user:${receiver.id}`).emit('message:new', payload);
        }
        if (currentUser && currentUser.id) {
          io.to(`user:${currentUser.id}`).emit('message:new', payload);
        }
      }
    } catch (socketErr) {
      // Ignore socket emit errors so REST response is never blocked
    }

    return res.status(201).json({
      success: true,
      message: 'Message sent successfully.',
      data: sanitizedMsgData,
      messageData: sanitizedMsgData
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: PATCH /api/v1/messages/:messageId
 * Edit a sent message (Sender only).
 */
async function editMessage(req, res, next) {
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
        error: 'Suspended or inactive user accounts cannot edit messages.'
      });
    }

    const { messageId } = req.params;
    const { text } = req.body || {};

    if (!messageId || typeof messageId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Message ID is required.'
      });
    }

    let query;
    if (mongoose && mongoose.Types.ObjectId.isValid(messageId) && messageId.length === 24) {
      query = { $or: [{ _id: messageId }, { id: messageId }] };
    } else {
      query = { id: messageId };
    }

    const msg = await Message.findOne(query);

    if (!msg) {
      return res.status(404).json({
        success: false,
        error: `Message with ID "${messageId}" was not found.`
      });
    }

    // Sender permission check
    if (msg.sender.toString() !== currentUser._id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Only the message sender can edit this message.'
      });
    }

    // Deleted message check
    if (msg.isDeleted) {
      return res.status(400).json({
        success: false,
        error: 'Cannot edit a deleted message.'
      });
    }

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Updated message text cannot be empty.'
      });
    }

    if (text.trim().length > 2000) {
      return res.status(400).json({
        success: false,
        error: 'Message text cannot exceed 2000 characters.'
      });
    }

    msg.text = text.trim();
    msg.isEdited = true;
    msg.editedAt = new Date();
    await msg.save();

    const populatedMsg = await Message.findById(msg._id)
      .populate('sender', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio')
      .populate('receiver', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio');

    return res.status(200).json({
      success: true,
      message: 'Message updated successfully.',
      data: Message.sanitize(populatedMsg)
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: DELETE /api/v1/messages/:messageId
 * Delete a message (Sender or receiver).
 */
async function deleteMessage(req, res, next) {
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

    const { messageId } = req.params;

    if (!messageId || typeof messageId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Message ID is required.'
      });
    }

    let query;
    if (mongoose && mongoose.Types.ObjectId.isValid(messageId) && messageId.length === 24) {
      query = { $or: [{ _id: messageId }, { id: messageId }] };
    } else {
      query = { id: messageId };
    }

    const msg = await Message.findOne(query);

    if (!msg) {
      return res.status(404).json({
        success: false,
        error: `Message with ID "${messageId}" was not found.`
      });
    }

    const isSender = msg.sender.toString() === currentUser._id.toString();
    const isReceiver = msg.receiver.toString() === currentUser._id.toString();

    if (!isSender && !isReceiver) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You cannot delete this message.'
      });
    }

    msg.isDeleted = true;
    msg.deletedAt = new Date();
    msg.deletedBy = currentUser._id;
    await msg.save();

    // Socket.IO Realtime Delete Notification
    try {
      const { getIO } = require('../socket/socketServer');
      const io = getIO();
      if (io) {
        const deletePayload = {
          messageId: msg.id || msg._id.toString(),
          conversationId: msg.conversationId || (msg.conversation ? msg.conversation.toString() : '')
        };
        const sIdStr = msg.sender.toString();
        const rIdStr = msg.receiver.toString();
        io.to(`user:${sIdStr}`).to(`user:${rIdStr}`).emit('message:deleted', deletePayload);

        const populatedMsg = await Message.findById(msg._id).populate('sender receiver', 'id');
        if (populatedMsg) {
          if (populatedMsg.sender && populatedMsg.sender.id) {
            io.to(`user:${populatedMsg.sender.id}`).emit('message:deleted', deletePayload);
          }
          if (populatedMsg.receiver && populatedMsg.receiver.id) {
            io.to(`user:${populatedMsg.receiver.id}`).emit('message:deleted', deletePayload);
          }
        }
      }
    } catch (socketErr) {
      // Ignore socket errors
    }

    return res.status(200).json({
      success: true,
      message: 'Message deleted successfully.'
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: POST /api/v1/messages/conversations/:conversationId/read
 * Mark all messages in conversation as read for current user.
 */
async function markConversationAsRead(req, res, next) {
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

    const { conversationId } = req.params;
    let conv = await findConversationById(conversationId);

    if (!conv) {
      const targetUser = await User.findUserByIdOrIdentifier(conversationId);
      if (targetUser) {
        const userPairKey = Conversation.generateUserPairKey(currentUser._id, targetUser._id);
        conv = await Conversation.findOne({ userPairKey, isDeleted: false });
      }
    }

    if (!conv) {
      return res.status(404).json({
        success: false,
        error: `Conversation with ID "${conversationId}" was not found.`
      });
    }

    // Authorization check
    const isParticipant = Array.isArray(conv.participants) && conv.participants.some(
      (p) => (p._id || p).toString() === currentUser._id.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You are not a participant in this conversation.'
      });
    }

    // Mark unread messages received by currentUser as read
    await Message.updateMany(
      {
        conversation: conv._id,
        receiver: currentUser._id,
        isRead: false
      },
      {
        isRead: true,
        readAt: new Date()
      }
    );

    // Reset unread count for current user in conversation
    const currentUserIdStr = currentUser._id.toString();
    if (conv.unreadCounts && typeof conv.unreadCounts.set === 'function') {
      conv.unreadCounts.set(currentUserIdStr, 0);
    } else if (conv.unreadCounts) {
      conv.unreadCounts[currentUserIdStr] = 0;
    }
    await conv.save();

    // Socket.IO Realtime Read Notification
    try {
      const { getIO } = require('../socket/socketServer');
      const io = getIO();
      if (io) {
        const otherParticipant = conv.participants.find(
          (p) => (p._id || p).toString() !== currentUser._id.toString()
        );
        if (otherParticipant) {
          const otherIdStr = (otherParticipant._id || otherParticipant).toString();
          const otherIdPill = otherParticipant.id || otherIdStr;
          const readPayload = {
            conversationId: conv.id || conv._id.toString(),
            readerId: currentUser.id || currentUser._id.toString()
          };
          io.to(`user:${otherIdStr}`).to(`user:${otherIdPill}`).emit('message:read', readPayload);
        }
      }
    } catch (socketErr) {
      // Ignore socket errors
    }

    return res.status(200).json({
      success: true,
      message: 'Conversation marked as read.'
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: DELETE /api/v1/messages/conversations/:conversationId
 * Clear/delete conversation for the authenticated user.
 */
async function deleteConversation(req, res, next) {
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

    const { conversationId } = req.params;
    let conv = await findConversationById(conversationId);

    if (!conv) {
      const targetUser = await User.findUserByIdOrIdentifier(conversationId);
      if (targetUser) {
        const userPairKey = Conversation.generateUserPairKey(currentUser._id, targetUser._id);
        conv = await Conversation.findOne({ userPairKey, isDeleted: false });
      }
    }

    if (!conv) {
      return res.status(404).json({
        success: false,
        error: `Conversation with ID "${conversationId}" was not found.`
      });
    }

    // Authorization check
    const isParticipant = Array.isArray(conv.participants) && conv.participants.some(
      (p) => (p._id || p).toString() === currentUser._id.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You are not a participant in this conversation.'
      });
    }

    // Add currentUser to clearedBy list
    if (!Array.isArray(conv.clearedBy)) {
      conv.clearedBy = [];
    }

    if (!conv.clearedBy.some((id) => id.toString() === currentUser._id.toString())) {
      conv.clearedBy.push(currentUser._id);
    }

    // Reset unread count for currentUser
    const currentUserIdStr = currentUser._id.toString();
    if (conv.unreadCounts && typeof conv.unreadCounts.set === 'function') {
      conv.unreadCounts.set(currentUserIdStr, 0);
    } else if (conv.unreadCounts) {
      conv.unreadCounts[currentUserIdStr] = 0;
    }

    await conv.save();

    return res.status(200).json({
      success: true,
      message: 'Conversation cleared successfully.'
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getConversations,
  getConversationById,
  createOrGetConversation,
  sendMessage,
  editMessage,
  deleteMessage,
  markConversationAsRead,
  deleteConversation
};
