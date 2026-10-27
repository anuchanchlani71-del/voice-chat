let mongoose;
try {
  mongoose = require('mongoose');
} catch (e) {
  mongoose = null;
}

let AppealModel;

if (mongoose) {
  const AppealSchema = new mongoose.Schema(
    {
      id: {
        type: String,
        unique: true,
        index: true
      },
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'User ID is required'],
        index: true
      },
      actionType: {
        type: String,
        enum: ['suspended', 'blocked', 'restricted'],
        required: [true, 'Action type is required'],
        lowercase: true,
        trim: true,
        index: true
      },
      originalReason: {
        type: String,
        default: '',
        trim: true
      },
      appealMessage: {
        type: String,
        required: [true, 'Appeal message is required'],
        trim: true
      },
      submittedAt: {
        type: String,
        default: () => new Date().toISOString()
      },
      status: {
        type: String,
        enum: ['pending', 'under_review', 'approved', 'rejected'],
        default: 'pending',
        lowercase: true,
        trim: true,
        index: true
      },
      adminNotes: {
        type: String,
        default: '',
        trim: true
      },
      reviewedAt: {
        type: String,
        default: null
      },
      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin',
        default: null
      },
      relatedReportCount: {
        type: Number,
        default: 0
      }
    },
    {
      timestamps: true,
      collection: 'appeals',
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
   * Pre-validate hook: Ensure custom string ID and submittedAt are populated
   */
  AppealSchema.pre('validate', function (next) {
    if (!this.id) {
      this.id = `appeal_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }
    if (!this.submittedAt) {
      this.submittedAt = new Date().toISOString();
    }
    next();
  });

  /**
   * Static: Find Appeal by custom ID or MongoDB _id
   */
  AppealSchema.statics.findAppealByIdOrMongoId = async function (id) {
    if (!id) return null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      const byMongoId = await this.findById(id);
      if (byMongoId) return byMongoId;
    }
    return this.findOne({ id });
  };

  /**
   * Static: Sanitize populated appeal document to ensure no sensitive credentials leak
   */
  AppealSchema.statics.sanitize = function (appealDoc) {
    if (!appealDoc) return null;
    const obj = appealDoc.toObject ? appealDoc.toObject() : { ...appealDoc };
    delete obj.__v;

    if (obj._id) {
      obj.id = obj.id || obj._id.toString();
      delete obj._id;
    }

    // Sanitize user
    if (obj.user && typeof obj.user === 'object') {
      delete obj.user.passwordHash;
      delete obj.user.salt;
      delete obj.user.__v;
      delete obj.user.email;
      delete obj.user.phone;
      if (obj.user._id) {
        obj.user.id = obj.user.id || obj.user._id.toString();
        delete obj.user._id;
      }
    }

    // Sanitize reviewedBy admin
    if (obj.reviewedBy && typeof obj.reviewedBy === 'object') {
      delete obj.reviewedBy.passwordHash;
      delete obj.reviewedBy.salt;
      delete obj.reviewedBy.__v;
      if (obj.reviewedBy._id) {
        obj.reviewedBy.id = obj.reviewedBy.id || obj.reviewedBy._id.toString();
        delete obj.reviewedBy._id;
      }
    }

    return obj;
  };

  AppealModel = mongoose.models.Appeal || mongoose.model('Appeal', AppealSchema);
} else {
  AppealModel = class StandaloneAppeal {
    static sanitize(doc) {
      if (!doc) return null;
      const { __v, _id, ...safe } = doc;
      safe.id = safe.id || (_id ? _id.toString() : '');
      return safe;
    }
  };
}

module.exports = AppealModel;
