let mongoose;
try {
  mongoose = require('mongoose');
} catch (e) {
  mongoose = null;
}

let InterestModel;

if (mongoose) {
  const InterestSchema = new mongoose.Schema(
    {
      id: {
        type: String,
        unique: true,
        index: true
      },
      name: {
        type: String,
        required: [true, 'Interest tag name is required'],
        unique: true,
        trim: true,
        index: true
      },
      category: {
        type: String,
        required: [true, 'Category group is required'],
        trim: true,
        default: 'Entertainment & Arts',
        index: true
      },
      icon: {
        type: String,
        default: '✨',
        trim: true
      },
      userCount: {
        type: Number,
        default: 0
      },
      isActive: {
        type: Boolean,
        default: true,
        index: true
      }
    },
    {
      timestamps: true,
      collection: 'interests',
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
   * Pre-save hook: Ensure custom ID is generated if not set
   */
  InterestSchema.pre('validate', function (next) {
    if (!this.id) {
      this.id = `int_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }
    next();
  });

  /**
   * Static: Find Interest by custom ID or MongoDB _id
   */
  InterestSchema.statics.findInterestByIdOrMongoId = async function (id) {
    if (!id) return null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      const byMongoId = await this.findById(id);
      if (byMongoId) return byMongoId;
    }
    return this.findOne({ id });
  };

  /**
   * Static: Find Interest by name (case-insensitive)
   */
  InterestSchema.statics.findByName = async function (name) {
    if (!name) return null;
    const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.findOne({ name: new RegExp(`^${escaped}$`, 'i') });
  };

  /**
   * Static: Sanitize interest document
   */
  InterestSchema.statics.sanitize = function (interestDoc) {
    if (!interestDoc) return null;
    const obj = interestDoc.toObject ? interestDoc.toObject() : { ...interestDoc };
    delete obj.__v;
    if (obj._id) {
      obj.id = obj.id || obj._id.toString();
      delete obj._id;
    }
    return obj;
  };

  InterestModel = mongoose.models.Interest || mongoose.model('Interest', InterestSchema);
} else {
  InterestModel = class StandaloneInterest {
    static sanitize(doc) {
      if (!doc) return null;
      const { __v, _id, ...safe } = doc;
      safe.id = safe.id || (_id ? _id.toString() : '');
      return safe;
    }
  };
}

module.exports = InterestModel;
