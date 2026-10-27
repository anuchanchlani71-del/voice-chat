const mongoose = require('mongoose');
const VoiceCall = require('../models/VoiceCall');
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const Block = require('../models/Block');
const Notification = require('../models/Notification');

/**
 * Helper: Check active block relationship between two user ObjectIds
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
 * Helper: Verify if two users are accepted mutual friends
 */
async function areUsersFriends(userAId, userBId) {
  if (!userAId || !userBId) return false;
  const userPairKey = Friendship.generateUserPairKey(userAId, userBId);
  const friendship = await Friendship.findOne({ userPairKey, status: 'accepted' });
  return !!friendship;
}

/**
 * Helper: Find voice call document by custom string ID or Mongo ObjectId
 */
async function findCallById(id) {
  if (!id) return null;
  const idStr = typeof id === 'string' ? id : (id.toString ? id.toString() : String(id));
  if (!idStr) return null;

  let query;
  if (mongoose && mongoose.Types.ObjectId.isValid(idStr) && idStr.length === 24) {
    query = { $or: [{ _id: idStr }, { id: idStr }] };
  } else {
    query = { id: idStr };
  }

  return await VoiceCall.findOne(query)
    .populate('caller', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio')
    .populate('receiver', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio');
}

/**
 * Controller: POST /api/v1/calls
 * Create / Initiate a 1-to-1 voice call record between accepted mutual friends.
 */
async function initiateCall(req, res, next) {
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
        error: 'Suspended or inactive user accounts cannot initiate voice calls.'
      });
    }

    const body = req.body || {};
    const targetUserIdInput = body.recipientId || body.targetUserId || body.receiverId || body.userId;

    if (!targetUserIdInput || typeof targetUserIdInput !== 'string' || !targetUserIdInput.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Recipient user ID is required to initiate a call.'
      });
    }

    const targetUser = await User.findUserByIdOrIdentifier(targetUserIdInput.trim());

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: `Target user with ID "${targetUserIdInput}" was not found.`
      });
    }

    // 1. Prevent self call
    if (currentUser._id.equals(targetUser._id) || currentUser.id === targetUser.id) {
      return res.status(400).json({
        success: false,
        error: 'You cannot call yourself.'
      });
    }

    // 2. Suspended target check
    if (targetUser.accountStatus !== 'active' || targetUser.isBlocked === true) {
      return res.status(403).json({
        success: false,
        error: 'Cannot call an inactive or suspended user account.'
      });
    }

    // 3. Block check
    if (await areUsersBlocked(currentUser._id, targetUser._id)) {
      return res.status(403).json({
        success: false,
        error: 'Voice call unavailable due to safety/block settings.'
      });
    }

    // 4. Friendship check: Must be accepted mutual friends
    const isFriend = await areUsersFriends(currentUser._id, targetUser._id);
    if (!isFriend) {
      return res.status(403).json({
        success: false,
        error: '1-to-1 voice calling is strictly restricted to accepted mutual friends.'
      });
    }

    const nowIso = new Date().toISOString();
    const { expireStaleRingingCalls, emitCallIncoming, emitCallAccepted, emitCallDeclined, emitCallBusy, emitCallEnded } = require('../utils/callSocketHelper');

    // 5. Expire any stale ringing calls older than 45 seconds before checking busy status
    await expireStaleRingingCalls();


    // Check if target user is currently busy on another active call
    const activeTargetCall = await VoiceCall.findOne({
      $or: [{ caller: targetUser._id }, { receiver: targetUser._id }],
      status: { $in: ['ringing', 'ongoing'] }
    });

    if (activeTargetCall) {

      const busyCallDoc = await VoiceCall.create({
        caller: currentUser._id,
        receiver: targetUser._id,
        status: 'declined',
        startedAt: nowIso,
        endedAt: nowIso,
        endReason: 'user_busy',
        audioQuality: body.audioQuality || 'Good'
      });

      const populatedBusy = await findCallById(busyCallDoc._id);
      const sanitizedBusy = VoiceCall.sanitize(populatedBusy);
      emitCallBusy(populatedBusy);

      return res.status(409).json({
        success: false,
        error: 'Target user is currently busy on another call.',
        isBusy: true,
        voiceCall: sanitizedBusy,
        call: sanitizedBusy,
        data: sanitizedBusy
      });
    }

    // Validate initial status if explicitly supplied
    const validStatuses = ['ringing', 'ongoing', 'completed'];
    let initialStatus = 'ringing';
    if (body.status && validStatuses.includes(String(body.status).toLowerCase())) {
      initialStatus = String(body.status).toLowerCase();
    }

    const newCallDoc = await VoiceCall.create({
      caller: currentUser._id,
      receiver: targetUser._id,
      status: initialStatus,
      startedAt: nowIso,
      connectedAt: initialStatus === 'ongoing' || initialStatus === 'completed' ? nowIso : null,
      endedAt: initialStatus === 'completed' ? nowIso : null,
      audioQuality: body.audioQuality || 'Good'
    });

    const populatedCall = await findCallById(newCallDoc._id);
    const sanitizedCall = VoiceCall.sanitize(populatedCall);

    // Emit real-time call socket event
    if (initialStatus === 'ringing') {
      emitCallIncoming(populatedCall);
    } else if (initialStatus === 'ongoing') {
      emitCallAccepted(populatedCall);
    } else if (initialStatus === 'completed') {
      emitCallEnded(populatedCall);
    }

    // Create incoming call notification for receiver
    try {
      const newNotif = await Notification.create({
        targetUser: targetUser._id,
        sender: currentUser._id,
        type: 'call_alert',
        title: 'Incoming Voice Call',
        message: `${currentUser.fullName || currentUser.username} is calling you.`,
        metadata: { callId: newCallDoc.id || newCallDoc._id.toString() },
        iconColor: 'text-green-500'
      });
      const { emitNotificationNew } = require('../utils/notificationSocketHelper');
      emitNotificationNew(newNotif._id);
    } catch (notifErr) {
      console.warn('Non-fatal: Failed to create call notification:', notifErr.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Voice call initiated successfully.',
      voiceCall: sanitizedCall,
      call: sanitizedCall,
      data: sanitizedCall
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: GET /api/v1/calls/history
 * List paginated call history for the authenticated user (as caller or receiver).
 */
async function getCallHistory(req, res, next) {
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
        error: 'Suspended or inactive user accounts cannot access call history.'
      });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { status } = req.query || {};

    // Blocked users list filter
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
      $or: [{ caller: currentUser._id }, { receiver: currentUser._id }],
      caller: { $nin: blockedUserObjectIds },
      receiver: { $nin: blockedUserObjectIds }
    };

    if (status && status !== 'all') {
      const normStatus = String(status).toLowerCase().trim();
      const validStatuses = ['completed', 'missed', 'declined', 'failed', 'ongoing', 'ringing'];
      if (validStatuses.includes(normStatus)) {
        filter.status = normStatus;
      }
    }

    const [rawCalls, totalFiltered] = await Promise.all([
      VoiceCall.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('caller', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio')
        .populate('receiver', 'id username fullName avatar avatarId avatarBg accountStatus isOnline isBlocked voiceStatus bio'),
      VoiceCall.countDocuments(filter)
    ]);

    const voiceCalls = rawCalls.map((c) => VoiceCall.sanitize(c));
    const totalPages = Math.ceil(totalFiltered / limit) || 1;

    return res.status(200).json({
      success: true,
      voiceCalls,
      calls: voiceCalls,
      data: voiceCalls,
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
 * Controller: GET /api/v1/calls/:id
 * Retrieve details for a specific voice call record (Caller or Receiver only).
 */
async function getCallById(req, res, next) {
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
        error: 'Suspended or inactive user accounts cannot access call records.'
      });
    }

    const { id } = req.params;
    const callDoc = await findCallById(id);

    if (!callDoc) {
      return res.status(404).json({
        success: false,
        error: `Voice call record with ID "${id}" was not found.`
      });
    }

    // Authorization check: User must be caller or receiver
    const callerIdStr = (callDoc.caller?._id || callDoc.caller).toString();
    const receiverIdStr = (callDoc.receiver?._id || callDoc.receiver).toString();
    const currentIdStr = currentUser._id.toString();

    if (currentIdStr !== callerIdStr && currentIdStr !== receiverIdStr) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You are not a participant in this voice call.'
      });
    }

    // Safety block check between participants
    const otherParticipantId = currentIdStr === callerIdStr ? callDoc.receiver?._id || callDoc.receiver : callDoc.caller?._id || callDoc.caller;
    if (await areUsersBlocked(currentUser._id, otherParticipantId)) {
      return res.status(403).json({
        success: false,
        error: 'Voice call record unavailable due to safety/block settings.'
      });
    }

    const sanitizedCall = VoiceCall.sanitize(callDoc);

    return res.status(200).json({
      success: true,
      voiceCall: sanitizedCall,
      call: sanitizedCall,
      data: sanitizedCall
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: PATCH /api/v1/calls/:id
 * Update status, duration, or end reason for a voice call record (Participant only).
 */
async function updateCallStatus(req, res, next) {
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
        error: 'Suspended or inactive user accounts cannot modify call records.'
      });
    }

    const { id } = req.params;
    const body = req.body || {};

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Voice call ID is required.'
      });
    }

    const idStr = id.trim();
    let query;
    if (mongoose && mongoose.Types.ObjectId.isValid(idStr) && idStr.length === 24) {
      query = { $or: [{ _id: idStr }, { id: idStr }] };
    } else {
      query = { id: idStr };
    }

    const callDoc = await VoiceCall.findOne(query);

    if (!callDoc) {
      return res.status(404).json({
        success: false,
        error: `Voice call record with ID "${id}" was not found.`
      });
    }

    // Authorization check
    const callerIdStr = callDoc.caller.toString();
    const receiverIdStr = callDoc.receiver.toString();
    const currentIdStr = currentUser._id.toString();

    if (currentIdStr !== callerIdStr && currentIdStr !== receiverIdStr) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You cannot modify this voice call record.'
      });
    }

    // Validate new status
    const validStatuses = ['completed', 'missed', 'declined', 'failed', 'ongoing', 'ringing'];
    const newStatus = body.status ? String(body.status).toLowerCase().trim() : callDoc.status;

    if (!validStatuses.includes(newStatus)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status "${body.status}". Allowed statuses: ${validStatuses.join(', ')}.`
      });
    }

    const nowIso = new Date().toISOString();

    // Transition logic
    if (newStatus === 'ongoing' && !callDoc.connectedAt) {
      callDoc.connectedAt = nowIso;
    }

    if (['completed', 'missed', 'declined', 'failed'].includes(newStatus)) {
      if (!callDoc.endedAt) {
        callDoc.endedAt = nowIso;
      }

      if (body.endReason && typeof body.endReason === 'string') {
        callDoc.endReason = body.endReason.trim();
      }

      if (body.durationSeconds !== undefined && body.durationSeconds !== null) {
        callDoc.durationSeconds = Math.max(0, parseInt(body.durationSeconds, 10) || 0);
      } else if (newStatus === 'completed' && callDoc.connectedAt) {
        const startMs = new Date(callDoc.connectedAt).getTime();
        const endMs = new Date(callDoc.endedAt).getTime();
        callDoc.durationSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
      }

      callDoc.durationFormatted = VoiceCall.formatDuration(callDoc.durationSeconds);
    }

    if (body.audioQuality && typeof body.audioQuality === 'string') {
      callDoc.audioQuality = body.audioQuality.trim();
    }

    const populatedCall = await findCallById(callDoc._id);
    const sanitizedCall = VoiceCall.sanitize(populatedCall);

    // Emit real-time call status update socket events
    const { emitCallAccepted, emitCallDeclined, emitCallEnded } = require('../utils/callSocketHelper');
    if (newStatus === 'ongoing') {
      emitCallAccepted(populatedCall);
    } else if (newStatus === 'declined') {
      emitCallDeclined(populatedCall, body.endReason || 'user_declined');
    } else if (['completed', 'missed', 'failed'].includes(newStatus)) {
      emitCallEnded(populatedCall, body.endReason || 'user_ended');
    }

    return res.status(200).json({
      success: true,
      message: 'Voice call record updated successfully.',
      voiceCall: sanitizedCall,
      call: sanitizedCall,
      data: sanitizedCall
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  initiateCall,
  getCallHistory,
  getCallById,
  updateCallStatus
};
