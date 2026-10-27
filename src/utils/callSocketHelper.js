const VoiceCall = require('../models/VoiceCall');
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
 * Helper: Emit call:incoming event to target receiver's personal rooms
 */
async function emitCallIncoming(callDoc) {
  try {
    const io = getSocketIO();
    if (!io || !callDoc) return;

    const sanitizedCall = VoiceCall.sanitize(callDoc);
    const receiverMongoId = (callDoc.receiver?._id || callDoc.receiver).toString();
    const receiverCustomId = callDoc.receiver?.id || receiverMongoId;

    const payload = {
      callId: sanitizedCall.id || sanitizedCall._id,
      call: sanitizedCall,
      caller: sanitizedCall.caller,
      receiver: sanitizedCall.receiver,
      startedAt: sanitizedCall.startedAt
    };

    io.to(`user:${receiverMongoId}`).to(`user:${receiverCustomId}`).emit('call:incoming', payload);
  } catch (err) {
    // Non-fatal socket emission error
  }
}

/**
 * Helper: Emit call:accepted event to caller and receiver personal rooms
 */
async function emitCallAccepted(callDoc) {
  try {
    const io = getSocketIO();
    if (!io || !callDoc) return;

    const sanitizedCall = VoiceCall.sanitize(callDoc);
    const callerMongoId = (callDoc.caller?._id || callDoc.caller).toString();
    const callerCustomId = callDoc.caller?.id || callerMongoId;
    const receiverMongoId = (callDoc.receiver?._id || callDoc.receiver).toString();
    const receiverCustomId = callDoc.receiver?.id || receiverMongoId;

    const payload = {
      callId: sanitizedCall.id || sanitizedCall._id,
      call: sanitizedCall,
      status: 'ongoing',
      connectedAt: sanitizedCall.connectedAt
    };

    io.to(`user:${callerMongoId}`).to(`user:${callerCustomId}`).emit('call:accepted', payload);
    io.to(`user:${receiverMongoId}`).to(`user:${receiverCustomId}`).emit('call:accepted', payload);
  } catch (err) {
    // Non-fatal socket emission error
  }
}

/**
 * Helper: Emit call:declined event to caller and receiver personal rooms
 */
async function emitCallDeclined(callDoc, endReason = 'user_declined') {
  try {
    const io = getSocketIO();
    if (!io || !callDoc) return;

    const sanitizedCall = VoiceCall.sanitize(callDoc);
    const callerMongoId = (callDoc.caller?._id || callDoc.caller).toString();
    const callerCustomId = callDoc.caller?.id || callerMongoId;
    const receiverMongoId = (callDoc.receiver?._id || callDoc.receiver).toString();
    const receiverCustomId = callDoc.receiver?.id || receiverMongoId;

    const payload = {
      callId: sanitizedCall.id || sanitizedCall._id,
      call: sanitizedCall,
      status: 'declined',
      endedAt: sanitizedCall.endedAt,
      endReason: sanitizedCall.endReason || endReason
    };

    io.to(`user:${callerMongoId}`).to(`user:${callerCustomId}`).emit('call:declined', payload);
    io.to(`user:${receiverMongoId}`).to(`user:${receiverCustomId}`).emit('call:declined', payload);
  } catch (err) {
    // Non-fatal socket emission error
  }
}

/**
 * Helper: Emit call:busy event to caller personal room
 */
async function emitCallBusy(callDoc) {
  try {
    const io = getSocketIO();
    if (!io || !callDoc) return;

    const sanitizedCall = VoiceCall.sanitize(callDoc);
    const callerMongoId = (callDoc.caller?._id || callDoc.caller).toString();
    const callerCustomId = callDoc.caller?.id || callerMongoId;

    const payload = {
      callId: sanitizedCall.id || sanitizedCall._id,
      call: sanitizedCall,
      status: 'declined',
      endReason: 'user_busy'
    };

    io.to(`user:${callerMongoId}`).to(`user:${callerCustomId}`).emit('call:busy', payload);
  } catch (err) {
    // Non-fatal socket emission error
  }
}

/**
 * Helper: Emit call:ended event to both participants
 */
async function emitCallEnded(callDoc, endReason = 'user_ended') {
  try {
    const io = getSocketIO();
    if (!io || !callDoc) return;

    const sanitizedCall = VoiceCall.sanitize(callDoc);
    const callerMongoId = (callDoc.caller?._id || callDoc.caller).toString();
    const callerCustomId = callDoc.caller?.id || callerMongoId;
    const receiverMongoId = (callDoc.receiver?._id || callDoc.receiver).toString();
    const receiverCustomId = callDoc.receiver?.id || receiverMongoId;

    const payload = {
      callId: sanitizedCall.id || sanitizedCall._id,
      call: sanitizedCall,
      status: sanitizedCall.status,
      endedAt: sanitizedCall.endedAt,
      durationSeconds: sanitizedCall.durationSeconds || 0,
      endReason: sanitizedCall.endReason || endReason
    };

    io.to(`user:${callerMongoId}`).to(`user:${callerCustomId}`).emit('call:ended', payload);
    io.to(`user:${receiverMongoId}`).to(`user:${receiverCustomId}`).emit('call:ended', payload);
  } catch (err) {
    // Non-fatal socket emission error
  }
}

/**
 * Cleanup active voice call records when a user abruptly disconnects
 */
async function handleUserDisconnectCallCleanup(userId) {
  try {
    if (!userId) return;
    const userDoc = await User.findUserByIdOrIdentifier(userId);
    if (!userDoc) return;

    const mongoId = userDoc._id;

    // Find active calls (ringing or ongoing) involving this user
    const activeCalls = await VoiceCall.find({
      $or: [{ caller: mongoId }, { receiver: mongoId }],
      status: { $in: ['ringing', 'ongoing'] }
    }).populate('caller receiver');

    for (const call of activeCalls) {
      const nowIso = new Date().toISOString();
      call.endedAt = nowIso;
      call.status = 'failed';
      call.endReason = 'disconnect';
      await call.save();

      await emitCallEnded(call, 'disconnect');
    }
  } catch (err) {
    // Non-fatal disconnect error
  }
}

/**
 * Auto-expire stale ringing calls older than timeoutMs (default 45 seconds).
 * Set status to 'missed', endReason to 'timeout', and endedAt to current ISO timestamp.
 */
async function expireStaleRingingCalls(targetUserId = null, timeoutMs = 45000) {
  try {
    const cutoffTime = Date.now() - timeoutMs;
    const cutoffIso = new Date(cutoffTime).toISOString();

    const query = {
      status: 'ringing',
      $or: [
        { startedAt: { $lt: cutoffIso } },
        { startedAt: { $lt: new Date(cutoffTime) } }
      ]
    };

    if (targetUserId) {
      const userDoc = await User.findUserByIdOrIdentifier(targetUserId);
      if (userDoc) {
        query.$and = [
          { $or: [{ caller: userDoc._id }, { receiver: userDoc._id }] }
        ];
      }
    }

    const staleCalls = await VoiceCall.find(query).populate('caller receiver');
    for (const call of staleCalls) {
      const startMs = new Date(call.startedAt).getTime();
      if (startMs && startMs > cutoffTime) continue;

      const nowIso = new Date().toISOString();
      call.status = 'missed';
      call.endReason = 'timeout';
      call.endedAt = nowIso;
      await call.save();

      await emitCallEnded(call, 'timeout');
    }
  } catch (err) {
    // Non-fatal stale call expiration error
  }
}

module.exports = {
  emitCallIncoming,
  emitCallAccepted,
  emitCallDeclined,
  emitCallBusy,
  emitCallEnded,
  handleUserDisconnectCallCleanup,
  expireStaleRingingCalls,
  emitWebRTCOffer,
  emitWebRTCAnswer,
  emitWebRTCIceCandidate
};

/**
 * Helper: Relay WebRTC offer signal to target user's personal room
 */
async function emitWebRTCOffer(targetUserId, payload) {
  try {
    const io = getSocketIO();
    if (!io || !targetUserId || !payload) return;

    const userDoc = await User.findUserByIdOrIdentifier(targetUserId);
    const targetMongoId = userDoc ? userDoc._id.toString() : targetUserId;
    const targetCustomId = userDoc ? (userDoc.id || targetMongoId) : targetUserId;

    io.to(`user:${targetMongoId}`).to(`user:${targetCustomId}`).emit('webrtc:offer', payload);
  } catch (err) {
    // Non-fatal socket emission error
  }
}

/**
 * Helper: Relay WebRTC answer signal to target user's personal room
 */
async function emitWebRTCAnswer(targetUserId, payload) {
  try {
    const io = getSocketIO();
    if (!io || !targetUserId || !payload) return;

    const userDoc = await User.findUserByIdOrIdentifier(targetUserId);
    const targetMongoId = userDoc ? userDoc._id.toString() : targetUserId;
    const targetCustomId = userDoc ? (userDoc.id || targetMongoId) : targetUserId;

    io.to(`user:${targetMongoId}`).to(`user:${targetCustomId}`).emit('webrtc:answer', payload);
  } catch (err) {
    // Non-fatal socket emission error
  }
}

/**
 * Helper: Relay WebRTC ICE candidate signal to target user's personal room
 */
async function emitWebRTCIceCandidate(targetUserId, payload) {
  try {
    const io = getSocketIO();
    if (!io || !targetUserId || !payload) return;

    const userDoc = await User.findUserByIdOrIdentifier(targetUserId);
    const targetMongoId = userDoc ? userDoc._id.toString() : targetUserId;
    const targetCustomId = userDoc ? (userDoc.id || targetMongoId) : targetUserId;

    io.to(`user:${targetMongoId}`).to(`user:${targetCustomId}`).emit('webrtc:ice_candidate', payload);
  } catch (err) {
    // Non-fatal socket emission error
  }
}


