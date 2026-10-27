let mongoose;
try {
  mongoose = require('mongoose');
} catch (e) {
  mongoose = null;
}

let NotificationModel;

if (mongoose) {
  const NotificationSchema = new mongoose.Schema(
    {
      id: {
        type: String,
        unique: true,
        index: true
      },
      targetUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Target user ID is required'],
        index: true
      },
      sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
      },
      type: {
        type: String,
        enum: ['call_alert', 'call_missed', 'friend_request', 'friend_accepted', 'safety_alert', 'system_alert'],
        default: 'system_alert',
        index: true
      },
      title: {
        type: String,
        required: [true, 'Notification title is required'],
        trim: true
      },
      message: {
        type: String,
        required: [true, 'Notification message is required'],
        trim: true
      },
      status: {
        type: String,
        default: 'Delivered',
        index: true
      },
      isRead: {
        type: Boolean,
        default: false,
        index: true
      },
      iconColor: {
        type: String,
        default: 'text-indigo-600'
      },
      metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
      },
      date: {
        type: String,
        default: () => new Date().toISOString().replace('T', ' ').substring(0, 16)
      }
    },
    {
      timestamps: true,
      collection: 'notifications',
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
  NotificationSchema.pre('validate', function (next) {
    if (!this.id) {
      this.id = `ntf_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }
    if (!this.date) {
      this.date = new Date().toISOString().replace('T', ' ').substring(0, 16);
    }
    next();
  });

  /**
   * Static: Sanitize populated notification document to eliminate any credential leaks
   */
  NotificationSchema.statics.sanitize = function (notifDoc) {
    if (!notifDoc) return null;
    const obj = notifDoc.toObject ? notifDoc.toObject() : { ...notifDoc };
    delete obj.__v;

    if (obj._id) {
      obj.id = obj.id || obj._id.toString();
      delete obj._id;
    }

    // Sanitize populated targetUser
    if (obj.targetUser && typeof obj.targetUser === 'object') {
      delete obj.targetUser.passwordHash;
      delete obj.targetUser.salt;
      delete obj.targetUser.__v;
      if (obj.targetUser._id) {
        obj.targetUser.id = obj.targetUser.id || obj.targetUser._id.toString();
        delete obj.targetUser._id;
      }
    }

    // Sanitize populated sender if present
    if (obj.sender && typeof obj.sender === 'object') {
      delete obj.sender.passwordHash;
      delete obj.sender.salt;
      delete obj.sender.__v;
      if (obj.sender._id) {
        obj.sender.id = obj.sender.id || obj.sender._id.toString();
        delete obj.sender._id;
      }
    }

    return obj;
  };

  NotificationModel = mongoose.models.Notification || mongoose.model('Notification', NotificationSchema);
} else {
  NotificationModel = class StandaloneNotification {
    static sanitize(doc) {
      if (!doc) return null;
      const { __v, _id, ...safe } = doc;
      safe.id = safe.id || (_id ? _id.toString() : '');
      return safe;
    }
  };
}

module.exports = NotificationModel;
