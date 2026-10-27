let mongoose;
try {
  mongoose = require('mongoose');
} catch (e) {
  mongoose = null;
}

let SettingModel;

const DEFAULT_SETTINGS = {
  id: 'set_default',
  platformName: 'Voice Chat & Friends',
  tagline: 'Talk, Connect, Make Friends',
  version: 'v1.0.0-MVP (Phase 1)',
  voiceChatModel: 'Model 7: Interest-based Discovery + Friend System + 1-to-1 Voice Chat',
  maxCallDurationMinutes: 120,
  requireMicPermissionBeforeCall: true,
  allowOnlineStatusToggle: true,
  minInterestsRequired: 2,
  maxInterestsAllowed: 10,
  defaultProfileVisibility: 'Logged-in Friends Only for Voice / Public for Discovery',
  friendRequestRateLimitPerHour: 15,
  autoFlagReportThreshold: 3
};

if (mongoose) {
  const SettingSchema = new mongoose.Schema(
    {
      id: {
        type: String,
        required: true,
        unique: true,
        default: 'set_default',
        index: true
      },
      // Editable fields
      platformName: {
        type: String,
        required: [true, 'Platform name is required'],
        trim: true,
        default: DEFAULT_SETTINGS.platformName
      },
      tagline: {
        type: String,
        trim: true,
        default: DEFAULT_SETTINGS.tagline
      },
      maxCallDurationMinutes: {
        type: Number,
        default: DEFAULT_SETTINGS.maxCallDurationMinutes,
        min: 1,
        max: 1440
      },
      requireMicPermissionBeforeCall: {
        type: Boolean,
        default: DEFAULT_SETTINGS.requireMicPermissionBeforeCall
      },
      allowOnlineStatusToggle: {
        type: Boolean,
        default: DEFAULT_SETTINGS.allowOnlineStatusToggle
      },
      minInterestsRequired: {
        type: Number,
        default: DEFAULT_SETTINGS.minInterestsRequired,
        min: 1,
        max: 20
      },
      maxInterestsAllowed: {
        type: Number,
        default: DEFAULT_SETTINGS.maxInterestsAllowed,
        min: 1,
        max: 50
      },
      friendRequestRateLimitPerHour: {
        type: Number,
        default: DEFAULT_SETTINGS.friendRequestRateLimitPerHour,
        min: 1,
        max: 500
      },
      autoFlagReportThreshold: {
        type: Number,
        default: DEFAULT_SETTINGS.autoFlagReportThreshold,
        min: 1,
        max: 100
      },
      // Read-only system architecture fields
      version: {
        type: String,
        default: DEFAULT_SETTINGS.version
      },
      voiceChatModel: {
        type: String,
        default: DEFAULT_SETTINGS.voiceChatModel
      },
      defaultProfileVisibility: {
        type: String,
        default: DEFAULT_SETTINGS.defaultProfileVisibility
      }
    },
    {
      timestamps: true,
      collection: 'settings',
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
   * Static: Get or create the singleton settings document
   */
  SettingSchema.statics.getSingletonSettings = async function () {
    let settings = await this.findOne({ id: 'set_default' });
    if (!settings) {
      settings = await this.findOne({});
    }
    if (!settings) {
      settings = new this({ ...DEFAULT_SETTINGS });
      await settings.save();
    }
    return settings;
  };

  /**
   * Static: Sanitize settings document
   */
  SettingSchema.statics.sanitize = function (settingsDoc) {
    if (!settingsDoc) return null;
    const obj = settingsDoc.toObject ? settingsDoc.toObject() : { ...settingsDoc };
    delete obj.__v;
    if (obj._id) {
      obj.id = obj.id || obj._id.toString();
      delete obj._id;
    }
    return obj;
  };

  SettingSchema.statics.DEFAULT_SETTINGS = DEFAULT_SETTINGS;

  SettingModel = mongoose.models.Setting || mongoose.model('Setting', SettingSchema);
} else {
  SettingModel = class StandaloneSetting {
    static async getSingletonSettings() {
      return { ...DEFAULT_SETTINGS };
    }
    static sanitize(doc) {
      if (!doc) return null;
      const { __v, _id, ...safe } = doc;
      safe.id = safe.id || (_id ? _id.toString() : 'set_default');
      return safe;
    }
  };
}

module.exports = SettingModel;
