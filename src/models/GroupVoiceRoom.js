let mongoose;
try {
  mongoose = require('mongoose');
} catch (e) {
  mongoose = null;
}

let GroupVoiceRoomModel;

if (mongoose) {
  const GroupVoiceRoomSchema = new mongoose.Schema(
    {
      id: {
        type: String,
        unique: true,
        index: true
      },
      title: {
        type: String,
        required: [true, 'Room title is required'],
        trim: true,
        maxlength: [150, 'Room title cannot exceed 150 characters']
      },
      description: {
        type: String,
        default: '',
        trim: true,
        maxlength: [1000, 'Room description cannot exceed 1000 characters']
      },
      topic: {
        type: String,
        default: 'Casual Hangout & Chit-Chat',
        trim: true,
        index: true
      },
      host: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Host user reference is required'],
        index: true
      },
      capacity: {
        type: Number,
        default: 20,
        min: [2, 'Room capacity must be at least 2'],
        max: [100, 'Room capacity cannot exceed 100']
      },
      // STRICT PRODUCT DECISION: Only two access types ('anyone' | 'invite_only')
      accessType: {
        type: String,
        enum: {
          values: ['anyone', 'invite_only'],
          message: 'Access type must be strictly "anyone" or "invite_only"'
        },
        default: 'anyone',
        index: true
      },
      invitedUsers: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        }
      ],
      speakers: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        }
      ],
      listeners: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        }
      ],
      raisedHands: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        }
      ],
      status: {
        type: String,
        enum: {
          values: ['active', 'scheduled', 'ended', 'closed'],
          message: 'Status must be one of: active, scheduled, ended, closed'
        },
        default: 'active',
        index: true
      },
      participantCount: {
        type: Number,
        default: 0,
        min: 0
      },
      isDeleted: {
        type: Boolean,
        default: false,
        index: true
      },
      closedAt: {
        type: Date,
        default: null
      }
    },
    {
      timestamps: true,
      collection: 'group_voice_rooms',
      suppressReservedKeysWarning: true,
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
   * Pre-validate hook: Ensure string ID is generated if missing
   */
  GroupVoiceRoomSchema.pre('validate', function (next) {
    if (!this.id) {
      this.id = `gvr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }
    if (!Array.isArray(this.speakers)) {
      this.speakers = [];
    }
    if (!Array.isArray(this.listeners)) {
      this.listeners = [];
    }
    if (!Array.isArray(this.raisedHands)) {
      this.raisedHands = [];
    }
    next();
  });

  /**
   * Helper: Sanitize array of user references or populated objects
   */
  function sanitizeUserArray(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map((u) => {
      if (u && typeof u === 'object') {
        const item = u.toObject ? u.toObject() : { ...u };
        delete item.passwordHash;
        delete item.salt;
        delete item.__v;
        if (item._id) {
          item.id = item.id || item._id.toString();
          delete item._id;
        }
        return item;
      }
      return u;
    });
  }

  /**
   * Static: Sanitize populated GroupVoiceRoom document
   */
  GroupVoiceRoomSchema.statics.sanitize = function (roomDoc) {
    if (!roomDoc) return null;
    const obj = roomDoc.toObject ? roomDoc.toObject() : { ...roomDoc };
    delete obj.__v;

    if (obj._id) {
      obj.id = obj.id || obj._id.toString();
      delete obj._id;
    }

    // Sanitize populated host
    if (obj.host && typeof obj.host === 'object') {
      delete obj.host.passwordHash;
      delete obj.host.salt;
      delete obj.host.__v;
      if (obj.host._id) {
        obj.host.id = obj.host.id || obj.host._id.toString();
        delete obj.host._id;
      }
    }

    // Sanitize arrays safely with backward-compatibility fallbacks
    obj.invitedUsers = sanitizeUserArray(obj.invitedUsers);
    obj.speakers = sanitizeUserArray(obj.speakers);
    obj.listeners = sanitizeUserArray(obj.listeners);
    obj.raisedHands = sanitizeUserArray(obj.raisedHands);

    return obj;
  };

  GroupVoiceRoomModel = mongoose.models.GroupVoiceRoom || mongoose.model('GroupVoiceRoom', GroupVoiceRoomSchema);
} else {
  GroupVoiceRoomModel = class StandaloneGroupVoiceRoom {
    static sanitize(doc) {
      if (!doc) return null;
      const { __v, _id, ...safe } = doc;
      safe.id = safe.id || (_id ? _id.toString() : '');
      safe.speakers = safe.speakers || [];
      safe.listeners = safe.listeners || [];
      safe.raisedHands = safe.raisedHands || [];
      return safe;
    }
  };
}

module.exports = GroupVoiceRoomModel;
