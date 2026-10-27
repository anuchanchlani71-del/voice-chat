const User = require('../models/User');
const Block = require('../models/Block');
const Report = require('../models/Report');
const Friendship = require('../models/Friendship');
const FriendRequest = require('../models/FriendRequest');

/**
 * Controller: POST /api/v1/users/block
 * Block another user. Prevents duplicate and self-blocks.
 * Automatically removes active friendship and cancels pending friend requests.
 */
async function blockUser(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    const body = req.body || {};
    const targetUserIdInput = body.blockedUserId || body.targetUserId || body.userId || req.params.id;
    const { reason, notes } = body;

    if (!targetUserIdInput || typeof targetUserIdInput !== 'string' || !targetUserIdInput.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid user ID to block.'
      });
    }

    const targetUserIdStr = targetUserIdInput.trim();

    const [currentUser, targetUser] = await Promise.all([
      User.findUserByIdOrIdentifier(req.user.id),
      User.findUserByIdOrIdentifier(targetUserIdStr)
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

    // 1. Prevent self-block
    if (currentUser._id.toString() === targetUser._id.toString()) {
      return res.status(400).json({
        success: false,
        error: 'You cannot block yourself.'
      });
    }

    // 2. Check existing block record
    let blockDoc = await Block.findOne({
      blockedBy: currentUser._id,
      blockedUser: targetUser._id
    });

    if (blockDoc && blockDoc.status === 'active') {
      return res.status(400).json({
        success: false,
        error: 'This user is already blocked.'
      });
    }

    if (blockDoc) {
      blockDoc.status = 'active';
      blockDoc.reason = typeof reason === 'string' ? reason.trim() : (blockDoc.reason || '');
      blockDoc.notes = typeof notes === 'string' ? notes.trim() : (blockDoc.notes || '');
      blockDoc.date = new Date().toISOString().replace('T', ' ').substring(0, 16);
      blockDoc.releasedAt = null;
      blockDoc.releasedBy = null;
      await blockDoc.save();
    } else {
      blockDoc = await Block.create({
        blockedBy: currentUser._id,
        blockedUser: targetUser._id,
        reason: typeof reason === 'string' ? reason.trim() : '',
        notes: typeof notes === 'string' ? notes.trim() : '',
        status: 'active'
      });
    }

    // 3. Remove existing friendship if active
    const userPairKey = Friendship.generateUserPairKey(currentUser._id, targetUser._id);
    const existingFriendship = await Friendship.findOne({ userPairKey, status: 'accepted' });

    if (existingFriendship) {
      await Friendship.deleteOne({ _id: existingFriendship._id });

      // Decrement friendsCount for both users safely
      await Promise.all([
        User.updateOne({ _id: currentUser._id, friendsCount: { $gt: 0 } }, { $inc: { friendsCount: -1 } }),
        User.updateOne({ _id: targetUser._id, friendsCount: { $gt: 0 } }, { $inc: { friendsCount: -1 } })
      ]);
    }

    // 4. Cancel any pending or active friend requests between them
    await FriendRequest.updateMany(
      {
        $or: [
          { requester: currentUser._id, recipient: targetUser._id },
          { requester: targetUser._id, recipient: currentUser._id }
        ],
        status: { $in: ['pending', 'accepted'] }
      },
      {
        status: 'cancelled',
        respondedAt: new Date().toISOString()
      }
    );

    return res.status(200).json({
      success: true,
      message: 'User blocked successfully.',
      block: Block.sanitize(blockDoc)
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: POST/DELETE /api/v1/users/unblock
 * Unblock a previously blocked user.
 */
async function unblockUser(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    const body = req.body || {};
    const targetUserIdInput = body.blockedUserId || body.targetUserId || body.userId || req.params.blockedUserId || req.params.id;

    if (!targetUserIdInput || typeof targetUserIdInput !== 'string' || !targetUserIdInput.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid user ID to unblock.'
      });
    }

    const targetUserIdStr = targetUserIdInput.trim();

    const [currentUser, targetUser] = await Promise.all([
      User.findUserByIdOrIdentifier(req.user.id),
      User.findUserByIdOrIdentifier(targetUserIdStr)
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

    const blockDoc = await Block.findOne({
      blockedBy: currentUser._id,
      blockedUser: targetUser._id,
      status: 'active'
    });

    if (!blockDoc) {
      return res.status(404).json({
        success: false,
        error: 'No active block record found for this user.'
      });
    }

    blockDoc.status = 'released';
    blockDoc.releasedAt = new Date().toISOString();
    await blockDoc.save();

    return res.status(200).json({
      success: true,
      message: 'User unblocked successfully.'
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: GET /api/v1/users/blocked
 * Fetch authenticated user's list of active blocked users.
 */
async function getBlockedUsers(req, res, next) {
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

    const rawBlocks = await Block.find({
      blockedBy: currentUser._id,
      status: 'active'
    })
      .sort({ createdAt: -1 })
      .populate('blockedUser', 'id username fullName avatar avatarId avatarBg bio location voiceStatus isOnline');

    const blockedUsers = rawBlocks
      .filter(b => b.blockedUser)
      .map(b => {
        const u = User.sanitize(b.blockedUser);
        return {
          id: u.id,
          fullName: u.fullName,
          username: u.username,
          avatar: u.avatar,
          avatarId: u.avatarId,
          avatarBg: u.avatarBg,
          blockedAt: b.date || b.createdAt,
          reason: b.reason || '',
          blockId: b.id
        };
      });

    return res.status(200).json({
      success: true,
      blockedUsers,
      count: blockedUsers.length
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: POST /api/v1/users/report
 * Report another user for moderation review.
 */
async function reportUser(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    const body = req.body || {};
    const targetUserIdInput = body.reportedUserId || body.targetUserId || body.userId || req.params.id;
    const reasonCategory = body.reasonCategory || body.reason || 'Other';
    const reasonStr = body.reason || reasonCategory || '';
    const descriptionStr = body.description || body.details || '';

    if (!targetUserIdInput || typeof targetUserIdInput !== 'string' || !targetUserIdInput.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid user ID to report.'
      });
    }

    const targetUserIdStr = targetUserIdInput.trim();

    const [currentUser, targetUser] = await Promise.all([
      User.findUserByIdOrIdentifier(req.user.id),
      User.findUserByIdOrIdentifier(targetUserIdStr)
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

    // Prevent self-report
    if (currentUser._id.toString() === targetUser._id.toString()) {
      return res.status(400).json({
        success: false,
        error: 'You cannot report yourself.'
      });
    }

    if (!reasonCategory || typeof reasonCategory !== 'string' || !reasonCategory.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Please select a valid reason for reporting this user.'
      });
    }

    const newReport = await Report.create({
      reporter: currentUser._id,
      reportedUser: targetUser._id,
      reasonCategory: reasonCategory.trim(),
      reason: typeof reasonStr === 'string' ? reasonStr.trim() : reasonCategory.trim(),
      description: typeof descriptionStr === 'string' ? descriptionStr.trim().slice(0, 500) : '',
      status: 'pending',
      severity: 'medium'
    });

    // Increment reportsCount on target user
    await User.updateOne({ _id: targetUser._id }, { $inc: { reportsCount: 1 } });

    return res.status(201).json({
      success: true,
      message: 'Report submitted successfully. Thank you for keeping our community safe.',
      report: Report.sanitize(newReport)
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  blockUser,
  unblockUser,
  getBlockedUsers,
  reportUser
};
