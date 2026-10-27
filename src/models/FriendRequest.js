let mongoose;
try {
  mongoose = require('mongoose');
} catch (e) {
  mongoose = null;
}

let FriendRequestModel;

if (mongoose) {
  const FriendRequestSchema = new mongoose.Schema(
    {
      id: {
        type: String,
        unique: true,
        index: true
      },
      requester: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
      },
      recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
      },
      status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected', 'cancelled'],
        default: 'pending',
        index: true
      },
      matchedInterests: {
        type: [String],
        default: []
      },
      personalNote: {
        type: String,
        default: '',
        trim: true
      },
      requestedAt: {
        type: String,
        default: () => new Date().toISOString()
      },
      respondedAt: {
        type: String,
        default: null
      }
    },
    {
      timestamps: true,
      collection: 'friend_requests',
      toJSON: {
        transform: function (doc, ret) {
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
   * Pre-validate hook: Ensure custom string ID is generated if absent
   */
  FriendRequestSchema.pre('validate', function (next) {
    if (!this.id) {
      this.id = `freq_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }
    next();
  });

  /**
   * Static: Sanitize populated friend request document to ensure no sensitive credentials leak
   */
  FriendRequestSchema.statics.sanitize = function (requestDoc) {
    if (!requestDoc) return null;
    const obj = requestDoc.toObject ? requestDoc.toObject() : { ...requestDoc };
    delete obj.__v;

    if (obj._id) {
      obj.id = obj.id || obj._id.toString();
      delete obj._id;
    }

    // Sanitize populated requester
    if (obj.requester && typeof obj.requester === 'object') {
      delete obj.requester.passwordHash;
      delete obj.requester.salt;
      delete obj.requester.__v;
      if (obj.requester._id) {
        obj.requester.id = obj.requester.id || obj.requester._id.toString();
        delete obj.requester._id;
      }
    }

    // Sanitize populated recipient
    if (obj.recipient && typeof obj.recipient === 'object') {
      delete obj.recipient.passwordHash;
      delete obj.recipient.salt;
      delete obj.recipient.__v;
      if (obj.recipient._id) {
        obj.recipient.id = obj.recipient.id || obj.recipient._id.toString();
        delete obj.recipient._id;
      }
    }

    return obj;
  };

  FriendRequestModel = mongoose.models.FriendRequest || mongoose.model('FriendRequest', FriendRequestSchema);
} else {
  FriendRequestModel = class StandaloneFriendRequest {
    static sanitize(doc) {
      if (!doc) return null;
      const { __v, _id, ...safe } = doc;
      safe.id = safe.id || (_id ? _id.toString() : '');
      return safe;
    }
  };
}

module.exports = FriendRequestModel;
