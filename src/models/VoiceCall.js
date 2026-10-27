let mongoose;
try {
  mongoose = require('mongoose');
} catch (e) {
  mongoose = null;
}

let VoiceCallModel;

/**
 * Format duration in seconds to "Xm Ys" (e.g., "19m 05s")
 */
function formatDuration(seconds) {
  const s = Math.max(0, parseInt(seconds, 10) || 0);
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

if (mongoose) {
  const VoiceCallSchema = new mongoose.Schema(
    {
      id: {
        type: String,
        unique: true,
        index: true
      },
      caller: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Caller user ID is required'],
        index: true
      },
      receiver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Receiver user ID is required'],
        index: true
      },
      status: {
        type: String,
        enum: ['completed', 'missed', 'declined', 'failed', 'ongoing', 'ringing'],
        default: 'completed',
        index: true
      },
      durationSeconds: {
        type: Number,
        default: 0,
        min: 0
      },
      durationFormatted: {
        type: String,
        default: '0m 00s'
      },
      startedAt: {
        type: String,
        default: () => new Date().toISOString()
      },
      connectedAt: {
        type: String,
        default: null
      },
      endedAt: {
        type: String,
        default: null
      },
      endReason: {
        type: String,
        default: ''
      },
      audioQuality: {
        type: String,
        default: ''
      }
    },
    {
      timestamps: true,
      collection: 'voice_calls',
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
   * Pre-validate hook: Ensure custom string ID and formatted duration are populated
   */
  VoiceCallSchema.pre('validate', function (next) {
    if (!this.id) {
      this.id = `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }
    if (!this.durationFormatted || this.durationFormatted === '0m 00s') {
      this.durationFormatted = formatDuration(this.durationSeconds);
    }
    next();
  });

  /**
   * Static: Sanitize populated voice call document to eliminate any credential leaks
   */
  VoiceCallSchema.statics.sanitize = function (callDoc) {
    if (!callDoc) return null;
    const obj = callDoc.toObject ? callDoc.toObject() : { ...callDoc };
    delete obj.__v;

    if (obj._id) {
      obj.id = obj.id || obj._id.toString();
      delete obj._id;
    }

    if (!obj.durationFormatted) {
      obj.durationFormatted = formatDuration(obj.durationSeconds);
    }

    // Sanitize populated caller
    if (obj.caller && typeof obj.caller === 'object') {
      delete obj.caller.passwordHash;
      delete obj.caller.salt;
      delete obj.caller.__v;
      if (obj.caller._id) {
        obj.caller.id = obj.caller.id || obj.caller._id.toString();
        delete obj.caller._id;
      }
    }

    // Sanitize populated receiver
    if (obj.receiver && typeof obj.receiver === 'object') {
      delete obj.receiver.passwordHash;
      delete obj.receiver.salt;
      delete obj.receiver.__v;
      if (obj.receiver._id) {
        obj.receiver.id = obj.receiver.id || obj.receiver._id.toString();
        delete obj.receiver._id;
      }
    }

    return obj;
  };

  VoiceCallSchema.statics.formatDuration = formatDuration;

  VoiceCallModel = mongoose.models.VoiceCall || mongoose.model('VoiceCall', VoiceCallSchema);
} else {
  VoiceCallModel = class StandaloneVoiceCall {
    static sanitize(doc) {
      if (!doc) return null;
      const { __v, _id, ...safe } = doc;
      safe.id = safe.id || (_id ? _id.toString() : '');
      return safe;
    }
    static formatDuration(seconds) {
      return formatDuration(seconds);
    }
  };
}

module.exports = VoiceCallModel;
