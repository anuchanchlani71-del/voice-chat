let mongoose;
try {
  mongoose = require('mongoose');
} catch (e) {
  mongoose = null;
}

let ConversationModel;

if (mongoose) {
  const ConversationSchema = new mongoose.Schema(
    {
      id: {
        type: String,
        unique: true,
        index: true
      },
      participants: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true
        }
      ],
      userPairKey: {
        type: String,
        unique: true,
        index: true,
        required: true
      },
      lastMessage: {
        type: String,
        default: '',
        trim: true
      },
      lastMessageAt: {
        type: Date,
        default: Date.now,
        index: true
      },
      lastSender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
      },
      unreadCounts: {
        type: Map,
        of: Number,
        default: {}
      },
      isDeleted: {
        type: Boolean,
        default: false,
        index: true
      },
      clearedBy: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        }
      ]
    },
    {
      timestamps: true,
      collection: 'conversations',
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
  ConversationSchema.pre('validate', function (next) {
    if (!this.id) {
      this.id = `cnv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }
    next();
  });

  /**
   * Static: Generate deterministic user pair key for 1-to-1 conversation
   */
  ConversationSchema.statics.generateUserPairKey = function (userAId, userBId) {
    if (!userAId || !userBId) return '';
    const strA = userAId.toString();
    const strB = userBId.toString();
    return strA < strB ? `${strA}_${strB}` : `${strB}_${strA}`;
  };

  /**
   * Static: Sanitize populated Conversation document
   */
  ConversationSchema.statics.sanitize = function (convDoc) {
    if (!convDoc) return null;
    const obj = convDoc.toObject ? convDoc.toObject() : { ...convDoc };
    delete obj.__v;

    if (obj._id) {
      obj.id = obj.id || obj._id.toString();
      delete obj._id;
    }

    // Sanitize populated participants
    if (Array.isArray(obj.participants)) {
      obj.participants = obj.participants.map((u) => {
        if (u && typeof u === 'object') {
          delete u.passwordHash;
          delete u.salt;
          delete u.email;
          delete u.phone;
          delete u.reportsCount;
          delete u.__v;
          if (u._id) {
            u.id = u.id || u._id.toString();
            delete u._id;
          }
          return u;
        }
        return u;
      });
    }

    // Sanitize populated lastSender
    if (obj.lastSender && typeof obj.lastSender === 'object') {
      delete obj.lastSender.passwordHash;
      delete obj.lastSender.salt;
      delete obj.lastSender.email;
      delete obj.lastSender.phone;
      delete obj.lastSender.__v;
      if (obj.lastSender._id) {
        obj.lastSender.id = obj.lastSender.id || obj.lastSender._id.toString();
        delete obj.lastSender._id;
      }
    }

    return obj;
  };

  ConversationModel = mongoose.models.Conversation || mongoose.model('Conversation', ConversationSchema);
} else {
  ConversationModel = class StandaloneConversation {
    static sanitize(doc) {
      if (!doc) return null;
      const { __v, _id, ...safe } = doc;
      safe.id = safe.id || (_id ? _id.toString() : '');
      return safe;
    }
    static generateUserPairKey(a, b) {
      const strA = String(a);
      const strB = String(b);
      return strA < strB ? `${strA}_${strB}` : `${strB}_${strA}`;
    }
  };
}

module.exports = ConversationModel;
