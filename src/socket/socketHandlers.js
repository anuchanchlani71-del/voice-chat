const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
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
 * Helper: Find conversation by custom ID, ObjectId, or target user ID
 */
async function findConversation(idOrUserId, currentUserId) {
  if (!idOrUserId) return null;
  const idStr = typeof idOrUserId === 'string' ? idOrUserId : idOrUserId.toString();

  let conv;
  if (mongoose && mongoose.Types.ObjectId.isValid(idStr) && idStr.length === 24) {
    conv = await Conversation.findOne({ $or: [{ _id: idStr }, { id: idStr }], isDeleted: false });
  } else {
    conv = await Conversation.findOne({ id: idStr, isDeleted: false });
  }

  if (!conv && currentUserId) {
    const targetUser = await User.findUserByIdOrIdentifier(idStr);
    if (targetUser) {
      const userPairKey = Conversation.generateUserPairKey(currentUserId, targetUser._id);
      conv = await Conversation.findOne({ userPairKey, isDeleted: false });
    }
  }

  return conv;
}

/**
 * Register transient real-time socket handlers for direct messaging
 * @param {object} io - Socket.IO server instance
 * @param {object} socket - Authenticated client socket instance
 */
function registerSocketHandlers(io, socket) {
  if (!socket || !socket.user) return;

  const userObj = socket.user;
  const mongoIdStr = (userObj._id || '').toString();
  const customIdStr = (userObj.id || mongoIdStr).toString();

  // ── 1. TYPING START EVENT ──────────────────────────────────────────
  socket.on('typing:start', async (data) => {
    try {
      const { conversationId } = data || {};
      if (!conversationId || typeof conversationId !== 'string') return;

      const conv = await findConversation(conversationId, mongoIdStr || customIdStr);
      if (!conv) return;

      // Authorization check: Must be a participant
      const isParticipant = Array.isArray(conv.participants) && conv.participants.some((p) => {
        const pStr = (p._id || p).toString();
        const pCustom = p.id || pStr;
        return pStr === mongoIdStr || pStr === customIdStr || pCustom === mongoIdStr || pCustom === customIdStr;
      });

      if (!isParticipant) return;

      // Find other participant
      const otherParticipant = conv.participants.find((p) => {
        const pStr = (p._id || p).toString();
        const pCustom = p.id || pStr;
        return pStr !== mongoIdStr && pStr !== customIdStr && pCustom !== mongoIdStr && pCustom !== customIdStr;
      });

      if (!otherParticipant) return;

      const otherIdStr = (otherParticipant._id || otherParticipant).toString();

      // Check block safety
      if (await areUsersBlocked(mongoIdStr, otherIdStr)) return;

      const otherUser = await User.findById(otherIdStr);
      const otherCustomId = otherUser ? (otherUser.id || otherIdStr) : otherIdStr;

      const payload = {
        conversationId: conv.id || conv._id.toString(),
        userId: customIdStr,
        username: socket.user.username
      };

      // Emit typing:start to other participant's personal room
      io.to(`user:${otherIdStr}`).to(`user:${otherCustomId}`).emit('typing:start', payload);
    } catch (err) {
      // Ignore transient typing errors silently
    }
  });

  // ── 2. TYPING STOP EVENT ───────────────────────────────────────────
  socket.on('typing:stop', async (data) => {
    try {
      const { conversationId } = data || {};
      if (!conversationId || typeof conversationId !== 'string') return;

      const conv = await findConversation(conversationId, mongoIdStr || customIdStr);
      if (!conv) return;

      const isParticipant = Array.isArray(conv.participants) && conv.participants.some((p) => {
        const pStr = (p._id || p).toString();
        const pCustom = p.id || pStr;
        return pStr === mongoIdStr || pStr === customIdStr || pCustom === mongoIdStr || pCustom === customIdStr;
      });

      if (!isParticipant) return;

      const otherParticipant = conv.participants.find((p) => {
        const pStr = (p._id || p).toString();
        const pCustom = p.id || pStr;
        return pStr !== mongoIdStr && pStr !== customIdStr && pCustom !== mongoIdStr && pCustom !== customIdStr;
      });

      if (!otherParticipant) return;

      const otherIdStr = (otherParticipant._id || otherParticipant).toString();

      const otherUser = await User.findById(otherIdStr);
      const otherCustomId = otherUser ? (otherUser.id || otherIdStr) : otherIdStr;

      const payload = {
        conversationId: conv.id || conv._id.toString(),
        userId: customIdStr,
        username: socket.user.username
      };

      io.to(`user:${otherIdStr}`).to(`user:${otherCustomId}`).emit('typing:stop', payload);
    } catch (err) {
      // Ignore transient typing errors silently
    }
  });

  // ── 3. CALL REALTIME SIGNALING HANDLERS ───────────────────────────
  const VoiceCall = require('../models/VoiceCall');
  const Friendship = require('../models/Friendship');
  const { expireStaleRingingCalls, emitCallIncoming, emitCallAccepted, emitCallDeclined, emitCallBusy, emitCallEnded } = require('../utils/callSocketHelper');

  // helper: find call document by id
  async function findCall(callId) {
    if (!callId) return null;
    const idStr = typeof callId === 'string' ? callId : callId.toString();
    if (mongoose.Types.ObjectId.isValid(idStr) && idStr.length === 24) {
      return await VoiceCall.findOne({ $or: [{ _id: idStr }, { id: idStr }] }).populate('caller receiver');
    }
    return await VoiceCall.findOne({ id: idStr }).populate('caller receiver');
  }

  // call:initiate
  socket.on('call:initiate', async (data) => {
    try {
      const { recipientId } = data || {};
      if (!recipientId || typeof recipientId !== 'string') return;

      const targetUser = await User.findUserByIdOrIdentifier(recipientId.trim());
      if (!targetUser) return;

      // Check self call
      if (userObj._id.toString() === targetUser._id.toString()) return;

      // Check blocks
      if (await areUsersBlocked(userObj._id, targetUser._id)) return;

      // Check friendship
      const userPairKey = Friendship.generateUserPairKey(userObj._id, targetUser._id);
      const isFriend = await Friendship.findOne({ userPairKey, status: 'accepted' });
      if (!isFriend) return;

      // Expire any stale ringing calls older than 45 seconds before checking busy status
      await expireStaleRingingCalls();

      // Check target busy status
      const activeCall = await VoiceCall.findOne({
        $or: [{ caller: targetUser._id }, { receiver: targetUser._id }],
        status: { $in: ['ringing', 'ongoing'] }
      });


      const nowIso = new Date().toISOString();
      if (activeCall) {
        const busyDoc = await VoiceCall.create({
          caller: userObj._id,
          receiver: targetUser._id,
          status: 'declined',
          startedAt: nowIso,
          endedAt: nowIso,
          endReason: 'user_busy'
        });
        const populatedBusy = await findCall(busyDoc._id);
        emitCallBusy(populatedBusy);
        return;
      }

      const newCallDoc = await VoiceCall.create({
        caller: userObj._id,
        receiver: targetUser._id,
        status: 'ringing',
        startedAt: nowIso
      });

      const populatedCall = await findCall(newCallDoc._id);
      emitCallIncoming(populatedCall);
    } catch (err) {
      // Non-fatal socket error
    }
  });

  // call:accept
  socket.on('call:accept', async (data) => {
    try {
      const { callId } = data || {};
      const callDoc = await findCall(callId);
      if (!callDoc) return;

      const currentIdStr = mongoIdStr;
      const receiverIdStr = (callDoc.receiver?._id || callDoc.receiver).toString();

      // Authorization: Receiver only
      if (currentIdStr !== receiverIdStr && customIdStr !== callDoc.receiver?.id) return;

      const nowIso = new Date().toISOString();
      callDoc.status = 'ongoing';
      if (!callDoc.connectedAt) callDoc.connectedAt = nowIso;
      await callDoc.save();

      const populated = await findCall(callDoc._id);
      emitCallAccepted(populated);
    } catch (err) {
      // Non-fatal socket error
    }
  });

  // call:decline
  socket.on('call:decline', async (data) => {
    try {
      const { callId, endReason } = data || {};
      const callDoc = await findCall(callId);
      if (!callDoc) return;

      const currentIdStr = mongoIdStr;
      const callerIdStr = (callDoc.caller?._id || callDoc.caller).toString();
      const receiverIdStr = (callDoc.receiver?._id || callDoc.receiver).toString();

      if (currentIdStr !== callerIdStr && currentIdStr !== receiverIdStr && customIdStr !== callDoc.caller?.id && customIdStr !== callDoc.receiver?.id) {
        return;
      }

      const nowIso = new Date().toISOString();
      callDoc.status = 'declined';
      if (!callDoc.endedAt) callDoc.endedAt = nowIso;
      callDoc.endReason = endReason || 'user_declined';
      await callDoc.save();

      const populated = await findCall(callDoc._id);
      emitCallDeclined(populated, callDoc.endReason);
    } catch (err) {
      // Non-fatal socket error
    }
  });

  // call:end
  socket.on('call:end', async (data) => {
    try {
      const { callId, durationSeconds, endReason } = data || {};
      const callDoc = await findCall(callId);
      if (!callDoc) return;

      const currentIdStr = mongoIdStr;
      const callerIdStr = (callDoc.caller?._id || callDoc.caller).toString();
      const receiverIdStr = (callDoc.receiver?._id || callDoc.receiver).toString();

      if (currentIdStr !== callerIdStr && currentIdStr !== receiverIdStr && customIdStr !== callDoc.caller?.id && customIdStr !== callDoc.receiver?.id) {
        return;
      }

      const nowIso = new Date().toISOString();
      callDoc.status = 'completed';
      if (!callDoc.endedAt) callDoc.endedAt = nowIso;
      if (endReason) callDoc.endReason = endReason;
      if (durationSeconds !== undefined) callDoc.durationSeconds = Math.max(0, parseInt(durationSeconds, 10) || 0);

      await callDoc.save();

      const populated = await findCall(callDoc._id);

      emitCallEnded(populated, callDoc.endReason || 'user_ended');
    } catch (err) {
      // Non-fatal socket error
    }
  });

  const { emitWebRTCOffer, emitWebRTCAnswer, emitWebRTCIceCandidate } = require('../utils/callSocketHelper');

  // webrtc:offer
  socket.on('webrtc:offer', async (data) => {
    try {
      const { targetUserId, sdp, callId } = data || {};
      if (!targetUserId || !sdp) return;
      emitWebRTCOffer(targetUserId, {
        senderUserId: customIdStr || mongoIdStr,
        sdp,
        callId
      });
    } catch (err) {
      // Non-fatal WebRTC offer error
    }
  });

  // webrtc:answer
  socket.on('webrtc:answer', async (data) => {
    try {
      const { targetUserId, sdp, callId } = data || {};
      if (!targetUserId || !sdp) return;
      emitWebRTCAnswer(targetUserId, {
        senderUserId: customIdStr || mongoIdStr,
        sdp,
        callId
      });
    } catch (err) {
      // Non-fatal WebRTC answer error
    }
  });

  // webrtc:ice_candidate
  socket.on('webrtc:ice_candidate', async (data) => {
    try {
      const { targetUserId, candidate, callId } = data || {};
      if (!targetUserId || !candidate) return;
      emitWebRTCIceCandidate(targetUserId, {
        senderUserId: customIdStr || mongoIdStr,
        candidate,
        callId
      });
    } catch (err) {
      // Non-fatal WebRTC ICE candidate error
    }
  });


  // ── 4. GROUP VOICE ROOMS REALTIME SIGNALING HANDLERS ───────────────
  const GroupVoiceRoom = require('../models/GroupVoiceRoom');
  const {
    emitRoomHandRaised,
    emitRoomSpeakerUpdated,
    emitRoomMemberLeft,
    emitRoomWebRTCOffer,
    emitRoomWebRTCAnswer,
    emitRoomWebRTCIceCandidate,
    emitRoomSpeakingStarted,
    emitRoomSpeakingStopped
  } = require('../utils/roomSocketHelper');

  // room:join
  socket.on('room:join', async (data) => {
    try {
      const { roomId } = data || {};
      if (!roomId || typeof roomId !== 'string') return;

      const roomStr = roomId.trim();
      let roomDoc;
      if (mongoose.Types.ObjectId.isValid(roomStr) && roomStr.length === 24) {
        roomDoc = await GroupVoiceRoom.findOne({ $or: [{ _id: roomStr }, { id: roomStr }], isDeleted: false });
      } else {
        roomDoc = await GroupVoiceRoom.findOne({ id: roomStr, isDeleted: false });
      }

      if (!roomDoc) return;
      const targetChannel = `room:${roomDoc.id || roomDoc._id.toString()}`;
      socket.join(targetChannel);
    } catch (err) {
      // Non-fatal socket error
    }
  });

  // room:leave
  socket.on('room:leave', async (data) => {
    try {
      const { roomId } = data || {};
      if (!roomId || typeof roomId !== 'string') return;

      const roomStr = roomId.trim();
      let roomDoc;
      if (mongoose.Types.ObjectId.isValid(roomStr) && roomStr.length === 24) {
        roomDoc = await GroupVoiceRoom.findOne({ $or: [{ _id: roomStr }, { id: roomStr }], isDeleted: false });
      } else {
        roomDoc = await GroupVoiceRoom.findOne({ id: roomStr, isDeleted: false });
      }

      if (!roomDoc) return;
      const targetChannel = `room:${roomDoc.id || roomDoc._id.toString()}`;
      socket.leave(targetChannel);

      const userMongoId = userObj._id;
      await GroupVoiceRoom.updateOne(
        { _id: roomDoc._id },
        {
          $pull: {
            listeners: userMongoId,
            speakers: userMongoId,
            raisedHands: userMongoId
          }
        }
      );
      emitRoomMemberLeft(roomDoc, socket.user);
    } catch (err) {
      // Non-fatal socket error
    }
  });

  // room:raise_hand
  socket.on('room:raise_hand', async (data) => {
    try {
      const { roomId, isHandRaised, raised } = data || {};
      if (!roomId || typeof roomId !== 'string') return;

      const roomStr = roomId.trim();
      let roomDoc;
      if (mongoose.Types.ObjectId.isValid(roomStr) && roomStr.length === 24) {
        roomDoc = await GroupVoiceRoom.findOne({ $or: [{ _id: roomStr }, { id: roomStr }], isDeleted: false });
      } else {
        roomDoc = await GroupVoiceRoom.findOne({ id: roomStr, isDeleted: false });
      }

      if (!roomDoc) return;

      // Ensure arrays exist
      if (!Array.isArray(roomDoc.listeners)) roomDoc.listeners = [];
      if (!Array.isArray(roomDoc.speakers)) roomDoc.speakers = [];
      if (!Array.isArray(roomDoc.raisedHands)) roomDoc.raisedHands = [];

      const userMongoIdStr = (userObj._id || '').toString();
      const shouldRaise = isHandRaised !== undefined ? Boolean(isHandRaised) : (raised !== undefined ? Boolean(raised) : true);

      // Only active room listeners or participants can raise hand (host/speakers do not raise hands)
      const isSpeaker = roomDoc.speakers.some((id) => (id?._id || id).toString() === userMongoIdStr);
      const isHost = (roomDoc.host?._id || roomDoc.host).toString() === userMongoIdStr;

      if (!isSpeaker && !isHost) {
        if (shouldRaise) {
          await GroupVoiceRoom.updateOne(
            { _id: roomDoc._id },
            { $addToSet: { raisedHands: userObj._id } }
          );
        } else {
          await GroupVoiceRoom.updateOne(
            { _id: roomDoc._id },
            { $pull: { raisedHands: userObj._id } }
          );
        }
      }

      emitRoomHandRaised(roomDoc, socket.user, shouldRaise);
    } catch (err) {
      // Non-fatal socket error
    }
  });

  // room:update_speaker (Host Only)
  socket.on('room:update_speaker', async (data) => {
    try {
      const { roomId, targetUserId, action, isSpeaker } = data || {};
      if (!roomId || !targetUserId || typeof roomId !== 'string') return;

      const roomStr = roomId.trim();
      let roomDoc;
      if (mongoose.Types.ObjectId.isValid(roomStr) && roomStr.length === 24) {
        roomDoc = await GroupVoiceRoom.findOne({ $or: [{ _id: roomStr }, { id: roomStr }], isDeleted: false });
      } else {
        roomDoc = await GroupVoiceRoom.findOne({ id: roomStr, isDeleted: false });
      }

      if (!roomDoc) return;

      // Host permission check
      const hostIdStr = (roomDoc.host?._id || roomDoc.host).toString();
      if (hostIdStr !== mongoIdStr && hostIdStr !== customIdStr) return;

      const targetUser = await User.findUserByIdOrIdentifier(targetUserId);
      if (!targetUser) return;

      const targetMongoId = targetUser._id;
      const targetMongoIdStr = targetMongoId.toString();

      // Ensure arrays exist safely
      if (!Array.isArray(roomDoc.listeners)) roomDoc.listeners = [];
      if (!Array.isArray(roomDoc.speakers)) roomDoc.speakers = [];
      if (!Array.isArray(roomDoc.raisedHands)) roomDoc.raisedHands = [];

      const effectiveAction = action || (isSpeaker === true ? 'promote' : (isSpeaker === false ? 'demote' : null));

      if (effectiveAction === 'promote' || effectiveAction === 'speaker') {
        if (!roomDoc.speakers.some((id) => (id?._id || id).toString() === targetMongoIdStr)) {
          roomDoc.speakers.push(targetMongoId);
        }
        roomDoc.listeners = roomDoc.listeners.filter((id) => (id?._id || id).toString() !== targetMongoIdStr);
        roomDoc.raisedHands = roomDoc.raisedHands.filter((id) => (id?._id || id).toString() !== targetMongoIdStr);
        roomDoc.speakersCount = roomDoc.speakers.length + 1;
        await roomDoc.save();

        emitRoomSpeakerUpdated(roomDoc, targetUser, 'promoted');
      } else if (effectiveAction === 'demote' || effectiveAction === 'listener') {
        roomDoc.speakers = roomDoc.speakers.filter((id) => (id?._id || id).toString() !== targetMongoIdStr);
        if (!roomDoc.listeners.some((id) => (id?._id || id).toString() === targetMongoIdStr)) {
          roomDoc.listeners.push(targetMongoId);
        }
        roomDoc.speakersCount = Math.max(1, roomDoc.speakers.length + 1);
        await roomDoc.save();

        emitRoomSpeakerUpdated(roomDoc, targetUser, 'demoted');
      }
    } catch (err) {
      // Non-fatal socket error
    }
  });

  // ── Helper functions for Group WebRTC Room Authorization ───────────
  async function findActiveRoomDoc(roomId) {
    if (!roomId || typeof roomId !== 'string' || !roomId.trim()) return null;
    const roomStr = roomId.trim();
    let roomDoc;
    if (mongoose.Types.ObjectId.isValid(roomStr) && roomStr.length === 24) {
      roomDoc = await GroupVoiceRoom.findOne({ $or: [{ _id: roomStr }, { id: roomStr }], isDeleted: false });
    } else {
      roomDoc = await GroupVoiceRoom.findOne({ id: roomStr, isDeleted: false });
    }
    if (!roomDoc || roomDoc.status !== 'active') return null;
    return roomDoc;
  }

  function isMemberOfRoom(roomDoc, userMongoIdStr) {
    if (!roomDoc || !userMongoIdStr) return false;
    const hostId = (roomDoc.host?._id || roomDoc.host).toString();
    if (hostId === userMongoIdStr) return true;
    const isSpeaker = Array.isArray(roomDoc.speakers) && roomDoc.speakers.some((u) => (u?._id || u).toString() === userMongoIdStr);
    if (isSpeaker) return true;
    const isListener = Array.isArray(roomDoc.listeners) && roomDoc.listeners.some((u) => (u?._id || u).toString() === userMongoIdStr);
    return isListener;
  }

  function isHostOrSpeaker(roomDoc, userMongoIdStr) {
    if (!roomDoc || !userMongoIdStr) return false;
    const hostId = (roomDoc.host?._id || roomDoc.host).toString();
    if (hostId === userMongoIdStr) return true;
    const isSpeaker = Array.isArray(roomDoc.speakers) && roomDoc.speakers.some((u) => (u?._id || u).toString() === userMongoIdStr);
    return isSpeaker;
  }

  // ── 5. GROUP WEBRTC SIGNALING HANDLERS ─────────────────────────────

  // room:webrtc_offer (Host / Approved Speaker -> Target Room Participant)
  socket.on('room:webrtc_offer', async (data) => {
    try {
      const { roomId, targetUserId, offer, sdp } = data || {};
      const offerPayload = offer || sdp;

      // 1. Payload validation
      if (!roomId || typeof roomId !== 'string' || !targetUserId || typeof targetUserId !== 'string' || !offerPayload) {
        return;
      }
      if (typeof offerPayload !== 'object' && typeof offerPayload !== 'string') {
        return;
      }

      // 2. Active room validation (rejects closed/ended/deleted rooms)
      const roomDoc = await findActiveRoomDoc(roomId);
      if (!roomDoc) {
        return;
      }

      // 3. Sender authorization: must be host or approved speaker to publish audio
      if (!isHostOrSpeaker(roomDoc, mongoIdStr)) {
        return;
      }

      // 4. Target validation: cannot target self
      const targetUser = await User.findUserByIdOrIdentifier(targetUserId.trim());
      if (!targetUser) {
        return;
      }
      const targetMongoIdStr = targetUser._id.toString();
      if (targetMongoIdStr === mongoIdStr) {
        return;
      }

      // 5. Target must belong to the SAME room
      if (!isMemberOfRoom(roomDoc, targetMongoIdStr)) {
        return;
      }

      // 6. Targeted relay to target user with server-authoritative sender identity
      const normalizedPayload = {
        roomId: roomDoc.id || roomDoc._id.toString(),
        fromUserId: customIdStr || mongoIdStr,
        offer: offerPayload,
        sdp: offerPayload
      };

      emitRoomWebRTCOffer(targetUserId, normalizedPayload);
    } catch (err) {
      console.error('[WebRTC Offer Error in socketHandler]:', err);
    }
  });

  // room:webrtc_answer (Participant -> Host / Approved Speaker)
  socket.on('room:webrtc_answer', async (data) => {
    try {
      const { roomId, targetUserId, answer, sdp } = data || {};
      const answerPayload = answer || sdp;

      // 1. Payload validation
      if (!roomId || typeof roomId !== 'string' || !targetUserId || typeof targetUserId !== 'string' || !answerPayload) {
        return;
      }
      if (typeof answerPayload !== 'object' && typeof answerPayload !== 'string') {
        return;
      }

      // 2. Active room validation
      const roomDoc = await findActiveRoomDoc(roomId);
      if (!roomDoc) return;

      // 3. Sender authorization: must be a member of the room
      if (!isMemberOfRoom(roomDoc, mongoIdStr)) {
        return;
      }

      // 4. Target validation: cannot target self
      const targetUser = await User.findUserByIdOrIdentifier(targetUserId.trim());
      if (!targetUser) return;
      const targetMongoIdStr = targetUser._id.toString();
      if (targetMongoIdStr === mongoIdStr) {
        return;
      }

      // 5. Target must belong to the SAME room
      if (!isMemberOfRoom(roomDoc, targetMongoIdStr)) {
        return;
      }

      // 6. Target must be Host or Speaker (answers are returned to offering publisher)
      if (!isHostOrSpeaker(roomDoc, targetMongoIdStr)) {
        return;
      }

      // 7. Targeted relay to target user with server-authoritative sender identity
      const normalizedPayload = {
        roomId: roomDoc.id || roomDoc._id.toString(),
        fromUserId: customIdStr || mongoIdStr,
        answer: answerPayload,
        sdp: answerPayload
      };

      emitRoomWebRTCAnswer(targetUserId, normalizedPayload);
    } catch (err) {
      // Non-fatal socket error
    }
  });

  // room:webrtc_ice_candidate (Bidirectional between authorized room peers)
  socket.on('room:webrtc_ice_candidate', async (data) => {
    try {
      const { roomId, targetUserId, candidate } = data || {};

      // 1. Payload validation
      if (!roomId || typeof roomId !== 'string' || !targetUserId || typeof targetUserId !== 'string' || !candidate) {
        return;
      }
      if (typeof candidate !== 'object' && typeof candidate !== 'string') {
        return;
      }

      // 2. Active room validation
      const roomDoc = await findActiveRoomDoc(roomId);
      if (!roomDoc) return;

      // 3. Sender authorization: must be member of room
      if (!isMemberOfRoom(roomDoc, mongoIdStr)) {
        return;
      }

      // 4. Target validation: cannot target self
      const targetUser = await User.findUserByIdOrIdentifier(targetUserId.trim());
      if (!targetUser) return;
      const targetMongoIdStr = targetUser._id.toString();
      if (targetMongoIdStr === mongoIdStr) {
        return;
      }

      // 5. Target must belong to the SAME room
      if (!isMemberOfRoom(roomDoc, targetMongoIdStr)) {
        return;
      }

      // 6. At least one party must be Host or Speaker (preventing random listener-to-listener signaling)
      if (!isHostOrSpeaker(roomDoc, mongoIdStr) && !isHostOrSpeaker(roomDoc, targetMongoIdStr)) {
        return;
      }

      // 7. Targeted relay to target user with server-authoritative sender identity
      const normalizedPayload = {
        roomId: roomDoc.id || roomDoc._id.toString(),
        fromUserId: customIdStr || mongoIdStr,
        candidate
      };

      emitRoomWebRTCIceCandidate(targetUserId, normalizedPayload);
    } catch (err) {
      // Non-fatal socket error
    }
  });

  // ── 6. GROUP VOICE ROOM SPEAKING STATE SIGNALING (Phase 3E) ────────
  // room:speaking_started
  socket.on('room:speaking_started', async (data) => {
    try {
      const { roomId } = data || {};
      if (!roomId || typeof roomId !== 'string' || !roomId.trim()) return;

      const roomDoc = await findActiveRoomDoc(roomId);
      if (!roomDoc) return;

      // Sender must belong to the room and must be Host or Speaker to publish speaking state
      if (!isHostOrSpeaker(roomDoc, mongoIdStr)) return;

      await emitRoomSpeakingStarted(roomDoc, userObj);
    } catch (err) {
      // Non-fatal socket error
    }
  });

  // room:speaking_stopped
  socket.on('room:speaking_stopped', async (data) => {
    try {
      const { roomId } = data || {};
      if (!roomId || typeof roomId !== 'string' || !roomId.trim()) return;

      const roomDoc = await findActiveRoomDoc(roomId);
      if (!roomDoc) return;

      // Sender must belong to the room and must be Host or Speaker
      if (!isHostOrSpeaker(roomDoc, mongoIdStr)) return;

      await emitRoomSpeakingStopped(roomDoc, userObj);
    } catch (err) {
      // Non-fatal socket error
    }
  });
}

module.exports = {
  registerSocketHandlers
};

