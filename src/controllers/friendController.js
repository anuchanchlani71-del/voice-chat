const mongoose = require('mongoose');
const User = require('../models/User');
const FriendRequest = require('../models/FriendRequest');
const Friendship = require('../models/Friendship');
const Notification = require('../models/Notification');
const Block = require('../models/Block');


/**
 * Controller: POST /api/v1/friends/requests
 * Send a new friend request to target recipient.
 */
async function sendFriendRequest(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    const { recipientId, personalNote } = req.body || {};

    if (!recipientId || typeof recipientId !== 'string' || !recipientId.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid recipientId.'
      });
    }

    // Resolve current user and recipient user
    const [currentUser, recipientUser] = await Promise.all([
      User.findUserByIdOrIdentifier(req.user.id),
      User.findUserByIdOrIdentifier(recipientId.trim())
    ]);

    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: 'Authenticated user account not found.'
      });
    }

    if (!recipientUser) {
      return res.status(404).json({
        success: false,
        error: 'Recipient user account not found.'
      });
    }

    // 1. Prevent self-request
    if (currentUser._id.toString() === recipientUser._id.toString()) {
      return res.status(400).json({
        success: false,
        error: 'You cannot send a friend request to yourself.'
      });
    }

    // 1.5 Prevent request if either user has blocked the other
    const activeBlock = await Block.findOne({
      $or: [
        { blockedBy: currentUser._id, blockedUser: recipientUser._id, status: 'active' },
        { blockedBy: recipientUser._id, blockedUser: currentUser._id, status: 'active' }
      ]
    });

    if (activeBlock) {
      return res.status(400).json({
        success: false,
        error: 'Cannot send friend request to this user.'
      });
    }


    // 2. Prevent request if already friends
    const userPairKey = Friendship.generateUserPairKey(currentUser._id, recipientUser._id);
    const existingFriendship = await Friendship.findOne({
      userPairKey,
      status: 'accepted'
    });

    if (existingFriendship) {
      return res.status(400).json({
        success: false,
        error: 'You are already friends with this user.'
      });
    }

    // 3. Prevent duplicate pending request
    const existingPending = await FriendRequest.findOne({
      $or: [
        { requester: currentUser._id, recipient: recipientUser._id },
        { requester: recipientUser._id, recipient: currentUser._id }
      ],
      status: 'pending'
    });

    if (existingPending) {
      if (existingPending.requester.toString() === currentUser._id.toString()) {
        return res.status(400).json({
          success: false,
          error: 'You have already sent a friend request to this user.'
        });
      }
      return res.status(400).json({
        success: false,
        error: 'This user has already sent you a friend request. Please check your incoming requests.'
      });
    }

    // 4. Calculate matched interests
    const currentInterests = currentUser.interests || [];
    const recipientInterests = recipientUser.interests || [];
    const matchedInterests = currentInterests.filter(ci =>
      recipientInterests.some(ri => ri.toLowerCase() === ci.toLowerCase())
    );

    // 5. Create new friend request
    const note = typeof personalNote === 'string' ? personalNote.trim().slice(0, 300) : '';

    const newRequest = await FriendRequest.create({
      requester: currentUser._id,
      recipient: recipientUser._id,
      status: 'pending',
      matchedInterests,
      personalNote: note,
      requestedAt: new Date().toISOString()
    });

    // 6. Non-blocking Notification creation
    try {
      const newNotif = await Notification.create({
        targetUser: recipientUser._id,
        sender: currentUser._id,
        type: 'friend_request',
        title: 'New Friend Request',
        message: `${currentUser.fullName} sent you a friend request.`,
        metadata: {
          requestId: newRequest.id,
          requesterId: currentUser.id
        }
      });
      const { emitNotificationNew } = require('../utils/notificationSocketHelper');
      emitNotificationNew(newNotif._id);
    } catch (notifErr) {
      // Non-blocking
    }

    // Populate for response
    await newRequest.populate(
      'recipient',
      'id username fullName avatar avatarId avatarBg bio location conversationStyle preferredTime voiceStatus interests isOnline lastSeen friendsCount'
    );

    const sanitizedRecipient = User.sanitize(newRequest.recipient);

    return res.status(201).json({
      success: true,
      message: 'Friend request sent successfully.',
      request: {
        id: newRequest.id,
        status: newRequest.status,
        personalNote: newRequest.personalNote,
        matchedInterests: newRequest.matchedInterests,
        requestedAt: newRequest.requestedAt,
        recipient: sanitizedRecipient
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: GET /api/v1/friends/requests
 * Fetch authenticated user's incoming and outgoing pending requests.
 */
async function getFriendRequests(req, res, next) {
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
        error: 'Authenticated user not found.'
      });
    }

    const userProfileFields =
      'id username fullName avatar avatarId avatarBg bio location conversationStyle preferredTime voiceStatus interests isOnline lastSeen friendsCount';

    // Fetch incoming and sent pending requests in parallel
    const [rawIncoming, rawSent] = await Promise.all([
      FriendRequest.find({
        recipient: currentUser._id,
        status: 'pending'
      })
        .sort({ createdAt: -1 })
        .populate('requester', userProfileFields),

      FriendRequest.find({
        requester: currentUser._id,
        status: 'pending'
      })
        .sort({ createdAt: -1 })
        .populate('recipient', userProfileFields)
    ]);

    // Filter out requests from/to blocked users
    const activeBlocks = await Block.find({
      $or: [
        { blockedBy: currentUser._id, status: 'active' },
        { blockedUser: currentUser._id, status: 'active' }
      ]
    }).select('blockedBy blockedUser');

    const blockedUserIdsSet = new Set(
      activeBlocks.map(b =>
        b.blockedBy.toString() === currentUser._id.toString()
          ? b.blockedUser.toString()
          : b.blockedBy.toString()
      )
    );

    const incoming = rawIncoming
      .filter(r => r.requester && !blockedUserIdsSet.has(r.requester._id.toString()))
      .map(r => ({
        id: r.id,
        user: User.sanitize(r.requester),
        matchedInterests: r.matchedInterests || [],
        personalNote: r.personalNote || '',
        requestedAt: r.requestedAt,
        createdAt: r.createdAt
      }));

    const sent = rawSent
      .filter(r => r.recipient && !blockedUserIdsSet.has(r.recipient._id.toString()))
      .map(r => ({
        id: r.id,
        user: User.sanitize(r.recipient),
        matchedInterests: r.matchedInterests || [],
        personalNote: r.personalNote || '',
        requestedAt: r.requestedAt,
        createdAt: r.createdAt,
        status: r.status
      }));


    return res.status(200).json({
      success: true,
      incoming,
      sent,
      incomingCount: incoming.length,
      sentCount: sent.length
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: PATCH /api/v1/friends/requests/:id/accept
 * Recipient accepts an incoming pending friend request.
 */
async function acceptFriendRequest(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    const { id } = req.params;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Friend request ID is required.'
      });
    }

    const currentUser = await User.findUserByIdOrIdentifier(req.user.id);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: 'Authenticated user not found.'
      });
    }

    // Resolve request by custom id OR Mongo _id
    const query = {
      $or: [{ id: id.trim() }]
    };
    if (mongoose.Types.ObjectId.isValid(id.trim())) {
      query.$or.push({ _id: id.trim() });
    }

    const request = await FriendRequest.findOne(query);
    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Friend request not found.'
      });
    }

    // Authorization: Only recipient can accept
    if (request.recipient.toString() !== currentUser._id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Only the recipient can accept this friend request.'
      });
    }

    // Validate pending status
    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: `Cannot accept friend request with status "${request.status}".`
      });
    }

    // Mark request as accepted
    request.status = 'accepted';
    request.respondedAt = new Date().toISOString();
    await request.save();

    // Create or activate Friendship
    const userPairKey = Friendship.generateUserPairKey(request.requester, request.recipient);
    let friendship = await Friendship.findOne({ userPairKey });

    if (!friendship) {
      friendship = await Friendship.create({
        requester: request.requester,
        recipient: request.recipient,
        userPairKey,
        status: 'accepted',
        matchedInterests: request.matchedInterests,
        requestedAt: request.requestedAt,
        acceptedAt: new Date().toISOString()
      });

      // Increment friendsCount exactly once for both users
      await Promise.all([
        User.updateOne({ _id: request.requester }, { $inc: { friendsCount: 1 } }),
        User.updateOne({ _id: request.recipient }, { $inc: { friendsCount: 1 } })
      ]);
    } else if (friendship.status !== 'accepted') {
      friendship.status = 'accepted';
      friendship.acceptedAt = new Date().toISOString();
      await friendship.save();

      await Promise.all([
        User.updateOne({ _id: request.requester }, { $inc: { friendsCount: 1 } }),
        User.updateOne({ _id: request.recipient }, { $inc: { friendsCount: 1 } })
      ]);
    }

    // Non-blocking notification to the original requester
    try {
      const newNotif = await Notification.create({
        targetUser: request.requester,
        sender: currentUser._id,
        type: 'friend_accepted',
        title: 'Friend Request Accepted',
        message: `${currentUser.fullName} accepted your friend request.`,
        metadata: {
          friendId: currentUser.id
        }
      });
      const { emitNotificationNew } = require('../utils/notificationSocketHelper');
      emitNotificationNew(newNotif._id);
    } catch (notifErr) {
      // Non-blocking
    }

    return res.status(200).json({
      success: true,
      message: 'Friend request accepted successfully.',
      friendship: Friendship.sanitize(friendship)
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: PATCH /api/v1/friends/requests/:id/reject
 * Recipient rejects an incoming pending friend request.
 */
async function rejectFriendRequest(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    const { id } = req.params;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Friend request ID is required.'
      });
    }

    const currentUser = await User.findUserByIdOrIdentifier(req.user.id);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: 'Authenticated user not found.'
      });
    }

    const query = {
      $or: [{ id: id.trim() }]
    };
    if (mongoose.Types.ObjectId.isValid(id.trim())) {
      query.$or.push({ _id: id.trim() });
    }

    const request = await FriendRequest.findOne(query);
    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Friend request not found.'
      });
    }

    // Authorization: Only recipient can reject
    if (request.recipient.toString() !== currentUser._id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Only the recipient can reject this friend request.'
      });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: `Cannot reject friend request with status "${request.status}".`
      });
    }

    request.status = 'rejected';
    request.respondedAt = new Date().toISOString();
    await request.save();

    return res.status(200).json({
      success: true,
      message: 'Friend request declined successfully.'
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: DELETE /api/v1/friends/requests/:id
 * Requester cancels an outgoing pending friend request.
 */
async function cancelFriendRequest(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    const { id } = req.params;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Friend request ID is required.'
      });
    }

    const currentUser = await User.findUserByIdOrIdentifier(req.user.id);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: 'Authenticated user not found.'
      });
    }

    const query = {
      $or: [{ id: id.trim() }]
    };
    if (mongoose.Types.ObjectId.isValid(id.trim())) {
      query.$or.push({ _id: id.trim() });
    }

    const request = await FriendRequest.findOne(query);
    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Friend request not found.'
      });
    }

    // Authorization: Only requester can cancel
    if (request.requester.toString() !== currentUser._id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Only the sender can cancel this friend request.'
      });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: `Cannot cancel friend request with status "${request.status}".`
      });
    }

    request.status = 'cancelled';
    request.respondedAt = new Date().toISOString();
    await request.save();

    return res.status(200).json({
      success: true,
      message: 'Friend request cancelled successfully.'
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: GET /api/v1/friends
 * Fetch authenticated user's active accepted friendships.
 */
async function getFriends(req, res, next) {
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
        error: 'Authenticated user not found.'
      });
    }

    const userProfileFields =
      'id username fullName avatar avatarId avatarBg bio interests isOnline lastSeen voiceStatus location languages conversationStyle preferredTime friendsCount';

    const friendships = await Friendship.find({
      $or: [
        { requester: currentUser._id },
        { recipient: currentUser._id }
      ],
      status: 'accepted'
    })
      .sort({ updatedAt: -1 })
      .populate('requester', userProfileFields)
      .populate('recipient', userProfileFields);

    // Exclude friendships with blocked users
    const activeBlocks = await Block.find({
      $or: [
        { blockedBy: currentUser._id, status: 'active' },
        { blockedUser: currentUser._id, status: 'active' }
      ]
    }).select('blockedBy blockedUser');

    const blockedUserIdsSet = new Set(
      activeBlocks.map(b =>
        b.blockedBy.toString() === currentUser._id.toString()
          ? b.blockedUser.toString()
          : b.blockedBy.toString()
      )
    );

    const friends = friendships
      .filter(fr => fr.requester && fr.recipient)
      .filter(fr => {
        const isRequester = fr.requester._id.toString() === currentUser._id.toString();
        const otherUserDoc = isRequester ? fr.recipient : fr.requester;
        return !blockedUserIdsSet.has(otherUserDoc._id.toString());
      })
      .map(fr => {
        const isRequester = fr.requester._id.toString() === currentUser._id.toString();
        const otherUserDoc = isRequester ? fr.recipient : fr.requester;
        const sanitizedOther = User.sanitize(otherUserDoc);

        return {
          ...sanitizedOther,
          friendshipId: fr.id,
          friendshipAcceptedAt: fr.acceptedAt,
          voiceCallsCount: fr.voiceCallsCount || 0
        };
      });


    return res.status(200).json({
      success: true,
      friends,
      count: friends.length
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: DELETE /api/v1/friends/:friendId
 * Remove/unfriend an active friend connection safely.
 */
async function removeFriend(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    const { friendId } = req.params;
    if (!friendId || typeof friendId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Friend ID parameter is required.'
      });
    }

    const [currentUser, targetUser] = await Promise.all([
      User.findUserByIdOrIdentifier(req.user.id),
      User.findUserByIdOrIdentifier(friendId.trim())
    ]);

    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: 'Authenticated user not found.'
      });
    }

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: 'Target friend user account not found.'
      });
    }

    if (currentUser._id.toString() === targetUser._id.toString()) {
      return res.status(400).json({
        success: false,
        error: 'Invalid friend removal target.'
      });
    }

    const userPairKey = Friendship.generateUserPairKey(currentUser._id, targetUser._id);
    const friendship = await Friendship.findOne({
      userPairKey,
      status: 'accepted'
    });

    if (!friendship) {
      return res.status(404).json({
        success: false,
        error: 'Active friendship not found between these users.'
      });
    }

    // Safely remove the friendship record
    await Friendship.deleteOne({ _id: friendship._id });

    // Decrement friendsCount safely for both users (prevent negative numbers)
    await Promise.all([
      User.updateOne({ _id: currentUser._id, friendsCount: { $gt: 0 } }, { $inc: { friendsCount: -1 } }),
      User.updateOne({ _id: targetUser._id, friendsCount: { $gt: 0 } }, { $inc: { friendsCount: -1 } })
    ]);

    // Archive any old accepted friend requests between them
    await FriendRequest.updateMany(
      {
        $or: [
          { requester: currentUser._id, recipient: targetUser._id },
          { requester: targetUser._id, recipient: currentUser._id }
        ],
        status: 'accepted'
      },
      {
        status: 'cancelled',
        respondedAt: new Date().toISOString()
      }
    );

    return res.status(200).json({
      success: true,
      message: 'Friend removed successfully.'
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: GET /api/v1/friends/status/:targetUserId
 * Retrieve friendship status with a specific user ('none' | 'pending_sent' | 'pending_received' | 'friends').
 */
async function getFriendshipStatus(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    const { targetUserId } = req.params;
    if (!targetUserId || typeof targetUserId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Target user ID parameter is required.'
      });
    }

    const [currentUser, targetUser] = await Promise.all([
      User.findUserByIdOrIdentifier(req.user.id),
      User.findUserByIdOrIdentifier(targetUserId.trim())
    ]);

    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: 'Authenticated user not found.'
      });
    }

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: 'Target user account not found.'
      });
    }

    // Self check
    if (currentUser._id.toString() === targetUser._id.toString()) {
      return res.status(200).json({
        success: true,
        status: 'none',
        isSelf: true
      });
    }

    // 1. Check if active friends
    const userPairKey = Friendship.generateUserPairKey(currentUser._id, targetUser._id);
    const activeFriendship = await Friendship.findOne({
      userPairKey,
      status: 'accepted'
    });

    if (activeFriendship) {
      return res.status(200).json({
        success: true,
        status: 'friends',
        friendshipId: activeFriendship.id
      });
    }

    // 2. Check pending friend request
    const pendingRequest = await FriendRequest.findOne({
      $or: [
        { requester: currentUser._id, recipient: targetUser._id },
        { requester: targetUser._id, recipient: currentUser._id }
      ],
      status: 'pending'
    });

    if (pendingRequest) {
      const isRequester = pendingRequest.requester.toString() === currentUser._id.toString();
      return res.status(200).json({
        success: true,
        status: isRequester ? 'pending_sent' : 'pending_received',
        requestId: pendingRequest.id
      });
    }

    // 3. Default: No relationship
    return res.status(200).json({
      success: true,
      status: 'none'
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  sendFriendRequest,
  getFriendRequests,
  acceptFriendRequest,
  rejectFriendRequest,
  cancelFriendRequest,
  getFriends,
  removeFriend,
  getFriendshipStatus
};
