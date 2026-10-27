let mongoose;
try {
  mongoose = require('mongoose');
} catch (e) {
  mongoose = null;
}

let FriendshipModel;

if (mongoose) {
  const FriendshipSchema = new mongoose.Schema(
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
      // Canonical user pair key: [idA, idB].sort().join(':')
      // Guaranteed bidirectional uniqueness at MongoDB index level
      userPairKey: {
        type: String,
        required: true,
        unique: true,
        index: true
      },
      status: {
        type: String,
        enum: ['accepted', 'pending', 'rejected', 'cancelled'],
        default: 'accepted',
        index: true
      },
      matchedInterests: {
        type: [String],
        default: []
      },
      requestedAt: {
        type: String,
        default: () => new Date().toISOString()
      },
      acceptedAt: {
        type: String,
        default: null
      },
      voiceCallsCount: {
        type: Number,
        default: 0
      }
    },
    {
      timestamps: true,
      collection: 'friendships',
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
   * Helper: Generate a canonical bidirectional pair key
   */
  FriendshipSchema.statics.generateUserPairKey = function (userAId, userBId) {
    if (!userAId || !userBId) {
      throw new Error('Both user IDs are required to generate userPairKey.');
    }
    const strA = userAId.toString();
    const strB = userBId.toString();
    return [strA, strB].sort().join(':');
  };

  /**
   * Pre-save hook: Ensure canonical userPairKey is always populated
   */
  FriendshipSchema.pre('validate', function (next) {
    if (this.requester && this.recipient) {
      const reqStr = this.requester._id ? this.requester._id.toString() : this.requester.toString();
      const recStr = this.recipient._id ? this.recipient._id.toString() : this.recipient.toString();
      this.userPairKey = [reqStr, recStr].sort().join(':');
    }
    if (!this.id) {
      this.id = `fr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }
    next();
  });

  /**
   * Static: Sanitize populated friendship document
   */
  FriendshipSchema.statics.sanitize = function (friendshipDoc) {
    if (!friendshipDoc) return null;
    const obj = friendshipDoc.toObject ? friendshipDoc.toObject() : { ...friendshipDoc };
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

  FriendshipModel = mongoose.models.Friendship || mongoose.model('Friendship', FriendshipSchema);
} else {
  FriendshipModel = class StandaloneFriendship {
    static sanitize(doc) {
      if (!doc) return null;
      const { __v, _id, ...safe } = doc;
      safe.id = safe.id || (_id ? _id.toString() : '');
      return safe;
    }
  };
}

module.exports = FriendshipModel;
