let mongoose;
try {
  mongoose = require('mongoose');
} catch (e) {
  mongoose = null;
}

let ReportModel;

if (mongoose) {
  const ReportSchema = new mongoose.Schema(
    {
      id: {
        type: String,
        unique: true,
        index: true
      },
      reporter: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Reporter user ID is required'],
        index: true
      },
      reportedUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Reported user ID is required'],
        index: true
      },
      reasonCategory: {
        type: String,
        required: [true, 'Reason category is required'],
        trim: true,
        index: true
      },
      reason: {
        type: String,
        default: '',
        trim: true
      },
      description: {
        type: String,
        default: '',
        trim: true
      },
      status: {
        type: String,
        enum: ['pending', 'resolved', 'dismissed'],
        default: 'pending',
        index: true
      },
      severity: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        default: 'medium',
        index: true
      },
      notes: {
        type: String,
        default: '',
        trim: true
      },
      date: {
        type: String,
        default: () => new Date().toISOString().replace('T', ' ').substring(0, 16)
      },
      resolvedAt: {
        type: String,
        default: null
      },
      resolvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin',
        default: null
      },
      resolutionAction: {
        type: String,
        default: null
      }
    },
    {
      timestamps: true,
      collection: 'reports',
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
   * Pre-validate hook: Ensure custom string ID and date are populated
   */
  ReportSchema.pre('validate', function (next) {
    if (!this.id) {
      this.id = `rep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }
    if (!this.date) {
      this.date = new Date().toISOString().replace('T', ' ').substring(0, 16);
    }
    next();
  });

  /**
   * Static: Sanitize populated report document to eliminate any credential leaks
   */
  ReportSchema.statics.sanitize = function (reportDoc) {
    if (!reportDoc) return null;
    const obj = reportDoc.toObject ? reportDoc.toObject() : { ...reportDoc };
    delete obj.__v;

    if (obj._id) {
      obj.id = obj.id || obj._id.toString();
      delete obj._id;
    }

    // Sanitize populated reporter
    if (obj.reporter && typeof obj.reporter === 'object') {
      delete obj.reporter.passwordHash;
      delete obj.reporter.salt;
      delete obj.reporter.__v;
      if (obj.reporter._id) {
        obj.reporter.id = obj.reporter.id || obj.reporter._id.toString();
        delete obj.reporter._id;
      }
    }

    // Sanitize populated reportedUser
    if (obj.reportedUser && typeof obj.reportedUser === 'object') {
      delete obj.reportedUser.passwordHash;
      delete obj.reportedUser.salt;
      delete obj.reportedUser.__v;
      if (obj.reportedUser._id) {
        obj.reportedUser.id = obj.reportedUser.id || obj.reportedUser._id.toString();
        delete obj.reportedUser._id;
      }
    }

    // Sanitize resolvedBy if populated
    if (obj.resolvedBy && typeof obj.resolvedBy === 'object') {
      delete obj.resolvedBy.passwordHash;
      delete obj.resolvedBy.salt;
      delete obj.resolvedBy.__v;
      if (obj.resolvedBy._id) {
        obj.resolvedBy.id = obj.resolvedBy.id || obj.resolvedBy._id.toString();
        delete obj.resolvedBy._id;
      }
    }

    return obj;
  };

  ReportModel = mongoose.models.Report || mongoose.model('Report', ReportSchema);
} else {
  ReportModel = class StandaloneReport {
    static sanitize(doc) {
      if (!doc) return null;
      const { __v, _id, ...safe } = doc;
      safe.id = safe.id || (_id ? _id.toString() : '');
      return safe;
    }
  };
}

module.exports = ReportModel;
