let mongoose;
try {
  mongoose = require('mongoose');
} catch (e) {
  mongoose = null;
}

let BlockModel;

if (mongoose) {
  const BlockSchema = new mongoose.Schema(
    {
      id: {
        type: String,
        unique: true,
        index: true
      },
      blockedUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Blocked user ID is required'],
        index: true
      },
      blockedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'BlockedBy user ID is required'],
        index: true
      },
      reason: {
        type: String,
        default: '',
        trim: true
      },
      notes: {
        type: String,
        default: '',
        trim: true
      },
      status: {
        type: String,
        enum: ['active', 'released'],
        default: 'active',
        index: true
      },
      date: {
        type: String,
        default: () => new Date().toISOString().replace('T', ' ').substring(0, 16)
      },
      releasedAt: {
        type: String,
        default: null
      },
      releasedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin',
        default: null
      }
    },
    {
      timestamps: true,
      collection: 'blocked_users',
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
   * Pre-validate hook: Ensure custom string ID and formatted date are populated
   */
  BlockSchema.pre('validate', function (next) {
    if (!this.id) {
      this.id = `blk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }
    if (!this.date) {
      this.date = new Date().toISOString().replace('T', ' ').substring(0, 16);
    }
    next();
  });

  /**
   * Static: Sanitize populated block document to eliminate any credential leaks
   */
  BlockSchema.statics.sanitize = function (blockDoc) {
    if (!blockDoc) return null;
    const obj = blockDoc.toObject ? blockDoc.toObject() : { ...blockDoc };
    delete obj.__v;

    if (obj._id) {
      obj.id = obj.id || obj._id.toString();
      delete obj._id;
    }

    // Sanitize populated blockedUser
    if (obj.blockedUser && typeof obj.blockedUser === 'object') {
      delete obj.blockedUser.passwordHash;
      delete obj.blockedUser.salt;
      delete obj.blockedUser.__v;
      if (obj.blockedUser._id) {
        obj.blockedUser.id = obj.blockedUser.id || obj.blockedUser._id.toString();
        delete obj.blockedUser._id;
      }
    }

    // Sanitize populated blockedBy
    if (obj.blockedBy && typeof obj.blockedBy === 'object') {
      delete obj.blockedBy.passwordHash;
      delete obj.blockedBy.salt;
      delete obj.blockedBy.__v;
      if (obj.blockedBy._id) {
        obj.blockedBy.id = obj.blockedBy.id || obj.blockedBy._id.toString();
        delete obj.blockedBy._id;
      }
    }

    // Sanitize releasedBy if populated
    if (obj.releasedBy && typeof obj.releasedBy === 'object') {
      delete obj.releasedBy.passwordHash;
      delete obj.releasedBy.salt;
      delete obj.releasedBy.__v;
      if (obj.releasedBy._id) {
        obj.releasedBy.id = obj.releasedBy.id || obj.releasedBy._id.toString();
        delete obj.releasedBy._id;
      }
    }

    return obj;
  };

  BlockModel = mongoose.models.Block || mongoose.model('Block', BlockSchema);
} else {
  BlockModel = class StandaloneBlock {
    static sanitize(doc) {
      if (!doc) return null;
      const { __v, _id, ...safe } = doc;
      safe.id = safe.id || (_id ? _id.toString() : '');
      return safe;
    }
  };
}

module.exports = BlockModel;
