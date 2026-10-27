let mongoose;
try {
  mongoose = require('mongoose');
} catch (e) {
  mongoose = null;
}

let UserModel;

if (mongoose) {
  const UserSchema = new mongoose.Schema(
    {
      id: {
        type: String,
        unique: true,
        index: true
      },
      username: {
        type: String,
        required: [true, 'Username is required'],
        unique: true,
        lowercase: true,
        trim: true,
        index: true
      },
      fullName: {
        type: String,
        required: [true, 'Full name is required'],
        trim: true
      },
      avatar: {
        type: String,
        default: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80'
      },
      bio: {
        type: String,
        default: '',
        trim: true
      },
      interests: {
        type: [String],
        default: [],
        index: true
      },
      avatarId: {
        type: String,
        default: 'av-1',
        trim: true
      },
      avatarBg: {
        type: String,
        default: 'linear-gradient(135deg, #FF3385, #8B2FC9)',
        trim: true
      },
      location: {
        type: String,
        default: '',
        trim: true
      },
      languages: {
        type: [String],
        default: ['English (Fluent)']
      },
      conversationStyle: {
        type: String,
        default: '',
        trim: true
      },
      preferredTime: {
        type: String,
        default: '',
        trim: true
      },
      voiceStatus: {
        type: String,
        enum: ['available_to_talk', 'online', 'away', 'offline'],
        default: 'available_to_talk',
        index: true
      },
      isOnboarded: {
        type: Boolean,
        default: false,
        index: true
      },
      isOnline: {
        type: Boolean,
        default: false,
        index: true
      },
      lastSeen: {
        type: String,
        default: 'Just now'
      },
      accountStatus: {
        type: String,
        enum: ['active', 'suspended'],
        default: 'active',
        index: true
      },
      joinedDate: {
        type: String,
        default: () => new Date().toISOString().split('T')[0]
      },
      friendsCount: {
        type: Number,
        default: 0
      },
      voiceCallsCount: {
        type: Number,
        default: 0
      },
      totalVoiceMinutes: {
        type: Number,
        default: 0
      },
      reportsCount: {
        type: Number,
        default: 0
      },
      isBlocked: {
        type: Boolean,
        default: false
      },
      email: {
        type: String,
        lowercase: true,
        trim: true,
        default: ''
      },
      phone: {
        type: String,
        trim: true,
        default: ''
      },
      passwordHash: {
        type: String,
        select: false
      },
      salt: {
        type: String,
        select: false
      }
    },
    {
      timestamps: true,
      collection: 'users',
      toJSON: {
        transform: function (doc, ret) {
          delete ret.passwordHash;
          delete ret.salt;
          delete ret.__v;
          if (ret._id) {
            ret.id = ret.id || ret._id.toString();
            delete ret._id;
          }
          return ret;
        }
      }
    }
  );

  /**
   * Static: Find user by custom string ID, MongoDB _id, or username
   */
  UserSchema.statics.findUserByIdOrIdentifier = async function (identifier) {
    if (!identifier) return null;
    if (mongoose.Types.ObjectId.isValid(identifier)) {
      const byMongoId = await this.findById(identifier);
      if (byMongoId) return byMongoId;
    }
    return this.findOne({
      $or: [
        { id: identifier },
        { username: identifier.toLowerCase() }
      ]
    });
  };

  /**
   * Static: Sanitize user object to ensure sensitive credentials are NEVER returned
   */
  UserSchema.statics.sanitize = function (userDoc) {
    if (!userDoc) return null;
    const obj = userDoc.toObject ? userDoc.toObject() : { ...userDoc };
    delete obj.passwordHash;
    delete obj.salt;
    delete obj.__v;
    if (obj._id) {
      obj.id = obj.id || obj._id.toString();
      delete obj._id;
    }
    return obj;
  };

  UserModel = mongoose.models.User || mongoose.model('User', UserSchema);
} else {
  UserModel = class StandaloneUser {
    static sanitize(doc) {
      if (!doc) return null;
      const { passwordHash, salt, __v, _id, ...safe } = doc;
      safe.id = safe.id || (_id ? _id.toString() : '');
      return safe;
    }
  };
}

module.exports = UserModel;
