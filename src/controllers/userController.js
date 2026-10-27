const User = require('../models/User');
const Block = require('../models/Block');
const fs = require('fs');
const path = require('path');


/**
 * Controller: PATCH /api/v1/users/me/onboarding
 * Updates user interests and marks onboarding as completed.
 */
async function updateOnboarding(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    const { interests } = req.body || {};

    if (!interests || !Array.isArray(interests)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide an array of interests.'
      });
    }

    const cleanedInterests = interests
      .filter(item => typeof item === 'string' && item.trim().length > 0)
      .map(item => item.trim());

    if (cleanedInterests.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please select at least one valid interest.'
      });
    }

    const user = await User.findUserByIdOrIdentifier(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User account not found.'
      });
    }

    user.interests = cleanedInterests;
    user.isOnboarded = true;
    await user.save();

    const sanitizedUser = User.sanitize(user);

    return res.status(200).json({
      success: true,
      user: sanitizedUser
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: PATCH /api/v1/users/me
 * Updates current authenticated user profile attributes with validation.
 */
async function updateProfile(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    const body = req.body || {};
    const allowedFields = [
      'fullName',
      'bio',
      'avatar',
      'interests',
      'location',
      'languages',
      'conversationStyle',
      'preferredTime',
      'voiceStatus',
      'avatarId',
      'avatarBg'
    ];

    const fieldsProvided = allowedFields.filter(f => body[f] !== undefined);

    if (fieldsProvided.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide at least one valid profile field to update.'
      });
    }

    // 1. fullName validation
    if (body.fullName !== undefined) {
      if (typeof body.fullName !== 'string' || body.fullName.trim().length < 2) {
        return res.status(400).json({
          success: false,
          error: 'Display name must be at least 2 characters.'
        });
      }
      if (body.fullName.trim().length > 60) {
        return res.status(400).json({
          success: false,
          error: 'Display name cannot exceed 60 characters.'
        });
      }
    }

    // 2. bio validation
    if (body.bio !== undefined) {
      if (typeof body.bio !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Bio must be a string.'
        });
      }
      if (body.bio.trim().length > 300) {
        return res.status(400).json({
          success: false,
          error: 'Bio cannot exceed 300 characters.'
        });
      }
    }

    // 3. avatar validation
    if (body.avatar !== undefined) {
      if (typeof body.avatar !== 'string' || !body.avatar.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Avatar must be a non-empty string.'
        });
      }
      if (body.avatar.trim().length > 2000) {
        return res.status(400).json({
          success: false,
          error: 'Avatar cannot exceed 2000 characters.'
        });
      }
    }


    // 4. avatarId validation
    if (body.avatarId !== undefined) {
      if (typeof body.avatarId !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Avatar ID must be a string.'
        });
      }
      if (body.avatarId.trim().length > 50) {
        return res.status(400).json({
          success: false,
          error: 'Avatar ID cannot exceed 50 characters.'
        });
      }
    }

    // 5. avatarBg validation
    if (body.avatarBg !== undefined) {
      if (typeof body.avatarBg !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Avatar background must be a string.'
        });
      }
      if (body.avatarBg.trim().length > 200) {
        return res.status(400).json({
          success: false,
          error: 'Avatar background cannot exceed 200 characters.'
        });
      }
    }

    // 6. interests validation
    if (body.interests !== undefined) {
      if (!Array.isArray(body.interests)) {
        return res.status(400).json({
          success: false,
          error: 'Interests must be an array of strings.'
        });
      }
      for (const item of body.interests) {
        if (typeof item !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'Each interest must be a string.'
          });
        }
      }
    }

    // 7. location validation
    if (body.location !== undefined) {
      if (typeof body.location !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Location must be a string.'
        });
      }
      if (body.location.trim().length > 100) {
        return res.status(400).json({
          success: false,
          error: 'Location cannot exceed 100 characters.'
        });
      }
    }

    // 8. languages validation
    if (body.languages !== undefined) {
      if (!Array.isArray(body.languages)) {
        return res.status(400).json({
          success: false,
          error: 'Languages must be an array of strings.'
        });
      }
      for (const item of body.languages) {
        if (typeof item !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'Each language must be a string.'
          });
        }
      }
    }

    // 9. conversationStyle validation
    if (body.conversationStyle !== undefined) {
      if (typeof body.conversationStyle !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Conversation style must be a string.'
        });
      }
      if (body.conversationStyle.trim().length > 100) {
        return res.status(400).json({
          success: false,
          error: 'Conversation style cannot exceed 100 characters.'
        });
      }
    }

    // 10. preferredTime validation
    if (body.preferredTime !== undefined) {
      if (typeof body.preferredTime !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Preferred time must be a string.'
        });
      }
      if (body.preferredTime.trim().length > 100) {
        return res.status(400).json({
          success: false,
          error: 'Preferred time cannot exceed 100 characters.'
        });
      }
    }

    // 11. voiceStatus validation
    if (body.voiceStatus !== undefined) {
      const allowedStatuses = ['available_to_talk', 'online', 'away', 'offline'];
      if (typeof body.voiceStatus !== 'string' || !allowedStatuses.includes(body.voiceStatus.trim())) {
        return res.status(400).json({
          success: false,
          error: `Invalid voice status. Permitted values: ${allowedStatuses.join(', ')}.`
        });
      }
    }

    // Find current user in DB
    const user = await User.findUserByIdOrIdentifier(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User account not found.'
      });
    }

    // Clean up old custom uploaded avatar file if avatar is being changed to something else
    if (body.avatar !== undefined && user.avatar && user.avatar.startsWith('/uploads/avatars/') && user.avatar !== body.avatar.trim()) {
      const oldFileName = path.basename(user.avatar);
      const oldFilePath = path.join(__dirname, '../../uploads/avatars', oldFileName);
      if (fs.existsSync(oldFilePath)) {
        try {
          fs.unlinkSync(oldFilePath);
        } catch (unlinkErr) {
          console.error('Failed to delete previous custom avatar file:', unlinkErr);
        }
      }
    }

    // Apply updates
    if (body.fullName !== undefined) user.fullName = body.fullName.trim();
    if (body.bio !== undefined) user.bio = body.bio.trim();
    if (body.avatar !== undefined) user.avatar = body.avatar.trim();
    if (body.avatarId !== undefined) user.avatarId = body.avatarId.trim();
    if (body.avatarBg !== undefined) user.avatarBg = body.avatarBg.trim();
    if (body.interests !== undefined) {
      user.interests = body.interests
        .filter(item => typeof item === 'string' && item.trim().length > 0)
        .map(item => item.trim());
    }
    if (body.location !== undefined) user.location = body.location.trim();
    if (body.languages !== undefined) {
      user.languages = body.languages
        .filter(item => typeof item === 'string' && item.trim().length > 0)
        .map(item => item.trim());
    }
    if (body.conversationStyle !== undefined) user.conversationStyle = body.conversationStyle.trim();
    if (body.preferredTime !== undefined) user.preferredTime = body.preferredTime.trim();
    if (body.voiceStatus !== undefined) user.voiceStatus = body.voiceStatus.trim();

    await user.save();

    const sanitizedUser = User.sanitize(user);

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      user: sanitizedUser
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: POST /api/v1/users/upload-avatar
 * Uploads a custom user avatar photo using Multer and updates user.avatar path
 */
async function uploadUserAvatar(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
      return res.status(401).json({
        success: false,
        error: 'Unauthorized access. Authentication required.'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file uploaded.'
      });
    }

    const user = await User.findUserByIdOrIdentifier(req.user.id);
    if (!user) {
      if (req.file.path && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
      return res.status(404).json({
        success: false,
        error: 'User account not found.'
      });
    }

    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    // Delete old custom avatar file if present
    if (user.avatar && user.avatar.startsWith('/uploads/avatars/')) {
      const oldFileName = path.basename(user.avatar);
      const oldFilePath = path.join(__dirname, '../../uploads/avatars', oldFileName);
      if (fs.existsSync(oldFilePath) && oldFilePath !== req.file.path) {
        try {
          fs.unlinkSync(oldFilePath);
        } catch (unlinkErr) {
          console.error('Failed to clean up old custom avatar:', unlinkErr);
        }
      }
    }

    user.avatar = avatarUrl;
    user.avatarId = 'custom';
    user.updatedAt = new Date();
    await user.save();

    const sanitizedUser = User.sanitize(user);

    return res.status(200).json({
      success: true,
      message: 'Profile photo updated successfully.',
      avatarUrl,
      user: sanitizedUser
    });
  } catch (err) {
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    next(err);
  }
}


/**
 * Helper: Sanitize public profile document to strictly eliminate credentials & private contact info
 */
function sanitizePublicProfile(userDoc) {
  if (!userDoc) return null;
  const obj = userDoc.toObject ? userDoc.toObject() : { ...userDoc };
  delete obj.passwordHash;
  delete obj.salt;
  delete obj.email;
  delete obj.phone;
  delete obj.reportsCount;
  delete obj.isBlocked;
  delete obj.__v;
  if (obj._id) {
    obj.id = obj.id || obj._id.toString();
    delete obj._id;
  }
  return obj;
}

/**
 * Controller: GET /api/v1/users/discover
 * Retrieve discoverable platform members with search, category, availability & language filters.
 */
async function getDiscoverUsers(req, res, next) {
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

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const {
      search,
      category,
      topic,
      availability,
      language
    } = req.query || {};

    const andConditions = [];

    // 1. Search text filter (username, fullName, bio, interests)
    if (search && typeof search === 'string' && search.trim()) {
      const term = search.trim();
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      andConditions.push({
        $or: [
          { username: regex },
          { fullName: regex },
          { bio: regex },
          { interests: regex }
        ]
      });
    }

    // 2. Interest / Category / Topic filter
    const topicParam = (topic || category);
    if (topicParam && typeof topicParam === 'string' && topicParam.trim() && topicParam.trim() !== 'all') {
      const escaped = topicParam.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      andConditions.push({
        interests: new RegExp(escaped, 'i')
      });
    }

    // 3. Availability / Online presence filter
    if (availability && typeof availability === 'string' && availability.trim() && availability.trim() !== 'all') {
      const avail = availability.trim().toLowerCase();
      if (avail === 'available' || avail === 'available_to_talk') {
        andConditions.push({ voiceStatus: 'available_to_talk' });
      } else if (avail === 'online') {
        andConditions.push({ isOnline: true });
      }
    }

    // 4. Language filter
    if (language && typeof language === 'string' && language.trim() && language.trim() !== 'all') {
      const escaped = language.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      andConditions.push({
        languages: new RegExp(escaped, 'i')
      });
    }

    // 5. Exclude blocked users (where currentUser blocked target OR target blocked currentUser)
    const activeBlocks = await Block.find({
      $or: [
        { blockedBy: currentUser._id, status: 'active' },
        { blockedUser: currentUser._id, status: 'active' }
      ]
    }).select('blockedBy blockedUser');

    const blockedUserObjectIds = activeBlocks.map(b =>
      b.blockedBy.toString() === currentUser._id.toString() ? b.blockedUser : b.blockedBy
    );

    const excludedUserIds = [currentUser._id, ...blockedUserObjectIds];

    // Construct final composite filter
    const filter = {
      _id: { $nin: excludedUserIds },
      accountStatus: 'active',
      isBlocked: { $ne: true }
    };


    if (andConditions.length > 0) {
      filter.$and = andConditions;
    }

    // Execute query with sorting: online & active first, then most recently created
    const [rawUsers, totalCount] = await Promise.all([
      User.find(filter)
        .sort({ isOnline: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(filter)
    ]);

    const users = rawUsers.map(sanitizePublicProfile);

    return res.status(200).json({
      success: true,
      users,
      totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit) || 1
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: GET /api/v1/users/:id
 * Retrieve public profile for a specific user by custom ID or MongoDB _id.
 */
async function getUserProfileById(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    const { id } = req.params;
    if (!id || typeof id !== 'string' || !id.trim()) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required.'
      });
    }

    const targetUser = await User.findUserByIdOrIdentifier(id.trim());
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found.'
      });
    }

    if (targetUser.accountStatus === 'suspended') {
      return res.status(404).json({
        success: false,
        error: 'User profile is unavailable.'
      });
    }

    // Check if an active block exists between current user and target user
    const currentUserDoc = await User.findUserByIdOrIdentifier(req.user.id);
    if (currentUserDoc) {
      const activeBlock = await Block.findOne({
        $or: [
          { blockedBy: currentUserDoc._id, blockedUser: targetUser._id, status: 'active' },
          { blockedBy: targetUser._id, blockedUser: currentUserDoc._id, status: 'active' }
        ]
      });

      if (activeBlock) {
        return res.status(404).json({
          success: false,
          error: 'User profile is unavailable.'
        });
      }
    }


    const user = sanitizePublicProfile(targetUser);

    return res.status(200).json({
      success: true,
      user
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  updateOnboarding,
  updateProfile,
  uploadUserAvatar,
  getDiscoverUsers,
  getUserProfileById,
  sanitizePublicProfile
};

