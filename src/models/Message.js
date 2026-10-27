let mongoose;
try {
  mongoose = require('mongoose');
} catch (e) {
  mongoose = null;
}

let MessageModel;

if (mongoose) {
  const MessageSchema = new mongoose.Schema(
    {
      id: {
        type: String,
        unique: true,
        index: true
      },
      conversation: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Conversation',
        required: [true, 'Conversation reference is required'],
        index: true
      },
      conversationId: {
        type: String,
        required: [true, 'Conversation ID is required'],
        index: true
      },
      sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Sender user reference is required'],
        index: true
      },
      receiver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Receiver user reference is required'],
        index: true
      },
      text: {
        type: String,
        required: [true, 'Message text is required'],
        trim: true,
        maxlength: [2000, 'Message text cannot exceed 2000 characters']
      },
      isRead: {
        type: Boolean,
        default: false,
        index: true
      },
      readAt: {
        type: Date,
        default: null
      },
      isEdited: {
        type: Boolean,
        default: false
      },
      editedAt: {
        type: Date,
        default: null
      },
      isDeleted: {
        type: Boolean,
        default: false,
        index: true
      },
      deletedAt: {
        type: Date,
        default: null
      },
      deletedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
      }
    },
    {
      timestamps: true,
      collection: 'messages',
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
   * Pre-validate hook: Ensure custom string ID is generated if missing
   */
  MessageSchema.pre('validate', function (next) {
    if (!this.id) {
      this.id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }
    next();
  });

  /**
   * Static: Sanitize populated Message document
   */
  MessageSchema.statics.sanitize = function (msgDoc) {
    if (!msgDoc) return null;
    const obj = msgDoc.toObject ? msgDoc.toObject() : { ...msgDoc };
    delete obj.__v;

    if (obj._id) {
      obj.id = obj.id || obj._id.toString();
      delete obj._id;
    }

    // Sanitize populated sender
    if (obj.sender && typeof obj.sender === 'object') {
      delete obj.sender.passwordHash;
      delete obj.sender.salt;
      delete obj.sender.email;
      delete obj.sender.phone;
      delete obj.sender.reportsCount;
      delete obj.sender.__v;
      if (obj.sender._id) {
        obj.sender.id = obj.sender.id || obj.sender._id.toString();
        delete obj.sender._id;
      }
    }

    // Sanitize populated receiver
    if (obj.receiver && typeof obj.receiver === 'object') {
      delete obj.receiver.passwordHash;
      delete obj.receiver.salt;
      delete obj.receiver.email;
      delete obj.receiver.phone;
      delete obj.receiver.reportsCount;
      delete obj.receiver.__v;
      if (obj.receiver._id) {
        obj.receiver.id = obj.receiver.id || obj.receiver._id.toString();
        delete obj.receiver._id;
      }
    }

    return obj;
  };

  MessageModel = mongoose.models.Message || mongoose.model('Message', MessageSchema);
} else {
  MessageModel = class StandaloneMessage {
    static sanitize(doc) {
      if (!doc) return null;
      const { __v, _id, ...safe } = doc;
      safe.id = safe.id || (_id ? _id.toString() : '');
      return safe;
    }
  };
}

module.exports = MessageModel;
