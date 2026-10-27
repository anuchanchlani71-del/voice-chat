const GroupVoiceRoom = require('../models/GroupVoiceRoom');
const User = require('../models/User');

function getSocketIO() {
  try {
    const { getIO } = require('../socket/socketServer');
    return getIO();
  } catch (err) {
    return null;
  }
}

/**
 * Emit room:member_joined event to room channel
 */
async function emitRoomMemberJoined(roomDoc, userObj) {
  try {
    const io = getSocketIO();
    if (!io || !roomDoc || !userObj) return;

    const roomId = roomDoc.id || roomDoc._id.toString();
    const sanitizedUser = User.sanitize(userObj);

    const payload = {
      roomId,
      member: sanitizedUser,
      user: sanitizedUser,
      currentCount: roomDoc.currentCount || (roomDoc.listeners?.length || 0) + (roomDoc.speakers?.length || 0) + 1,
      speakersCount: roomDoc.speakersCount || (roomDoc.speakers?.length || 0) + 1
    };

    io.to(`room:${roomId}`).emit('room:member_joined', payload);
  } catch (err) {
    // Non-fatal socket emission error
  }
}

/**
 * Emit room:member_left event to room channel
 */
async function emitRoomMemberLeft(roomDoc, userObj) {
  try {
    const io = getSocketIO();
    if (!io || !roomDoc || !userObj) return;

    const roomId = roomDoc.id || roomDoc._id.toString();
    const sanitizedUser = User.sanitize(userObj);

    const payload = {
      roomId,
      member: sanitizedUser,
      userId: sanitizedUser.id || sanitizedUser._id,
      currentCount: roomDoc.currentCount || 1
    };

    io.to(`room:${roomId}`).emit('room:member_left', payload);
  } catch (err) {
    // Non-fatal socket emission error
  }
}

/**
 * Emit room:closed event to room channel
 */
async function emitRoomClosed(roomDoc) {
  try {
    const io = getSocketIO();
    if (!io || !roomDoc) return;

    const roomId = roomDoc.id || roomDoc._id.toString();

    const payload = {
      roomId,
      status: 'closed',
      endedAt: roomDoc.endedAt || new Date().toISOString(),
      message: 'The host has ended this group voice room session.'
    };

    io.to(`room:${roomId}`).emit('room:closed', payload);
  } catch (err) {
    // Non-fatal socket emission error
  }
}

/**
 * Emit room:hand_raised event to room channel
 */
async function emitRoomHandRaised(roomDoc, userObj, isRaised = true) {
  try {
    const io = getSocketIO();
    if (!io || !roomDoc || !userObj) return;

    const roomId = roomDoc.id || roomDoc._id.toString();
    const sanitizedUser = User.sanitize(userObj);

    const payload = {
      roomId,
      userId: sanitizedUser.id || sanitizedUser._id,
      user: sanitizedUser,
      isHandRaised: isRaised
    };

    io.to(`room:${roomId}`).emit('room:hand_raised', payload);
  } catch (err) {
    // Non-fatal socket emission error
  }
}

/**
 * Emit room:speaker_updated event to room channel
 */
async function emitRoomSpeakerUpdated(roomDoc, targetUserObj, action = 'promoted') {
  try {
    const io = getSocketIO();
    if (!io || !roomDoc || !targetUserObj) return;

    const roomId = roomDoc.id || roomDoc._id.toString();
    const sanitizedUser = User.sanitize(targetUserObj);
    const sanitizedRoom = GroupVoiceRoom.sanitize(roomDoc);

    const payload = {
      roomId,
      action, // 'promoted' or 'demoted'
      user: sanitizedUser,
      room: sanitizedRoom
    };

    io.to(`room:${roomId}`).emit('room:speaker_updated', payload);
  } catch (err) {
    // Non-fatal socket emission error
  }
}

/**
 * Cleanup room participant when a user socket disconnects
 */
async function handleUserDisconnectRoomCleanup(userId) {
  try {
    if (!userId) return;
    const userDoc = await User.findUserByIdOrIdentifier(userId);
    if (!userDoc) return;

    const mongoId = userDoc._id;

    // Find active rooms where user is listed as listener, speaker, or has hand raised
    const activeRooms = await GroupVoiceRoom.find({
      status: { $in: ['active', 'scheduled'] },
      isDeleted: false,
      $or: [{ listeners: mongoId }, { speakers: mongoId }, { raisedHands: mongoId }]
    });

    for (const room of activeRooms) {
      if (!Array.isArray(room.listeners)) room.listeners = [];
      if (!Array.isArray(room.speakers)) room.speakers = [];
      if (!Array.isArray(room.raisedHands)) room.raisedHands = [];

      const wasInRoom = room.listeners.some(id => (id?._id || id).toString() === mongoId.toString()) ||
                        room.speakers.some(id => (id?._id || id).toString() === mongoId.toString());

      room.listeners = room.listeners.filter(id => (id?._id || id).toString() !== mongoId.toString());
      room.speakers = room.speakers.filter(id => (id?._id || id).toString() !== mongoId.toString());
      room.raisedHands = room.raisedHands.filter(id => (id?._id || id).toString() !== mongoId.toString());

      if (wasInRoom) {
        room.participantCount = Math.max(0, (room.participantCount || 1) - 1);
      }
      room.currentCount = Math.max(1, (room.listeners.length + room.speakers.length + (room.host ? 1 : 0)));
      room.speakersCount = Math.max(1, room.speakers.length + 1);
      await room.save();

      if (wasInRoom) {
        await emitRoomSpeakingStopped(room, userDoc);
        await emitRoomMemberLeft(room, userDoc);
      }
    }
  } catch (err) {
    // Non-fatal disconnect cleanup error
  }
}

/**
 * Relay Group WebRTC offer to target user's personal room
 */
async function emitRoomWebRTCOffer(targetUserId, payload) {
  try {
    const io = getSocketIO();
    if (!io || !targetUserId || !payload) return;

    const userDoc = await User.findUserByIdOrIdentifier(targetUserId);
    const targetMongoId = userDoc ? userDoc._id.toString() : targetUserId;
    const targetCustomId = userDoc ? (userDoc.id || targetMongoId) : targetUserId;

    io.to(`user:${targetMongoId}`).to(`user:${targetCustomId}`).emit('room:webrtc_offer', payload);
  } catch (err) {
    // Non-fatal socket emission error
  }
}

/**
 * Relay Group WebRTC answer to target user's personal room
 */
async function emitRoomWebRTCAnswer(targetUserId, payload) {
  try {
    const io = getSocketIO();
    if (!io || !targetUserId || !payload) return;

    const userDoc = await User.findUserByIdOrIdentifier(targetUserId);
    const targetMongoId = userDoc ? userDoc._id.toString() : targetUserId;
    const targetCustomId = userDoc ? (userDoc.id || targetMongoId) : targetUserId;

    io.to(`user:${targetMongoId}`).to(`user:${targetCustomId}`).emit('room:webrtc_answer', payload);
  } catch (err) {
    // Non-fatal socket emission error
  }
}

/**
 * Relay Group WebRTC ICE candidate to target user's personal room
 */
async function emitRoomWebRTCIceCandidate(targetUserId, payload) {
  try {
    const io = getSocketIO();
    if (!io || !targetUserId || !payload) return;

    const userDoc = await User.findUserByIdOrIdentifier(targetUserId);
    const targetMongoId = userDoc ? userDoc._id.toString() : targetUserId;
    const targetCustomId = userDoc ? (userDoc.id || targetMongoId) : targetUserId;

    io.to(`user:${targetMongoId}`).to(`user:${targetCustomId}`).emit('room:webrtc_ice_candidate', payload);
  } catch (err) {
    // Non-fatal socket emission error
  }
}

/**
 * Emit room:speaking_started event to room channel
 */
async function emitRoomSpeakingStarted(roomDoc, userObj) {
  try {
    const io = getSocketIO();
    if (!io || !roomDoc || !userObj) return;

    const roomId = roomDoc.id || roomDoc._id.toString();
    const userId = (userObj.id || userObj._id?.toString() || '').toString();
    const userMongoId = (userObj._id || '').toString();

    const payload = {
      roomId,
      userId,
      userMongoId,
      username: userObj.username
    };

    io.to(`room:${roomId}`).emit('room:speaking_started', payload);
    if (roomDoc.id && roomDoc._id && roomDoc.id !== roomDoc._id.toString()) {
      io.to(`room:${roomDoc._id.toString()}`).emit('room:speaking_started', payload);
    }
  } catch (err) {
    // Non-fatal socket emission error
  }
}

/**
 * Emit room:speaking_stopped event to room channel
 */
async function emitRoomSpeakingStopped(roomDoc, userObj) {
  try {
    const io = getSocketIO();
    if (!io || !roomDoc || !userObj) return;

    const roomId = roomDoc.id || roomDoc._id.toString();
    const userId = (userObj.id || userObj._id?.toString() || '').toString();
    const userMongoId = (userObj._id || '').toString();

    const payload = {
      roomId,
      userId,
      userMongoId,
      username: userObj.username
    };

    io.to(`room:${roomId}`).emit('room:speaking_stopped', payload);
    if (roomDoc.id && roomDoc._id && roomDoc.id !== roomDoc._id.toString()) {
      io.to(`room:${roomDoc._id.toString()}`).emit('room:speaking_stopped', payload);
    }
  } catch (err) {
    // Non-fatal socket emission error
  }
}

module.exports = {
  emitRoomMemberJoined,
  emitRoomMemberLeft,
  emitRoomClosed,
  emitRoomHandRaised,
  emitRoomSpeakerUpdated,
  handleUserDisconnectRoomCleanup,
  emitRoomWebRTCOffer,
  emitRoomWebRTCAnswer,
  emitRoomWebRTCIceCandidate,
  emitRoomSpeakingStarted,
  emitRoomSpeakingStopped
};

