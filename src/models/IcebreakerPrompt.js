let mongoose;
try {
  mongoose = require('mongoose');
} catch (e) {
  mongoose = null;
}

let IcebreakerPromptModel;

if (mongoose) {
  const IcebreakerPromptSchema = new mongoose.Schema(
    {
      id: {
        type: String,
        unique: true,
        index: true
      },
      interest: {
        type: String,
        required: [true, 'Interest is required'],
        trim: true,
        index: true
      },
      prompt: {
        type: String,
        required: [true, 'Prompt text is required'],
        trim: true
      },
      status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active',
        index: true
      }
    },
    {
      timestamps: true,
      collection: 'icebreaker_prompts',
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
  IcebreakerPromptSchema.pre('validate', function (next) {
    if (!this.id) {
      this.id = `prompt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }
    next();
  });

  /**
   * Static: Find Icebreaker Prompt by custom ID or MongoDB _id
   */
  IcebreakerPromptSchema.statics.findPromptByIdOrMongoId = async function (id) {
    if (!id) return null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      const byMongoId = await this.findById(id);
      if (byMongoId) return byMongoId;
    }
    return this.findOne({ id });
  };

  /**
   * Static: Sanitize prompt document
   */
  IcebreakerPromptSchema.statics.sanitize = function (promptDoc) {
    if (!promptDoc) return null;
    const obj = promptDoc.toObject ? promptDoc.toObject() : { ...promptDoc };
    delete obj.__v;
    if (obj._id) {
      obj.id = obj.id || obj._id.toString();
      delete obj._id;
    }
    return obj;
  };

  IcebreakerPromptModel = mongoose.models.IcebreakerPrompt || mongoose.model('IcebreakerPrompt', IcebreakerPromptSchema);
} else {
  IcebreakerPromptModel = class StandaloneIcebreakerPrompt {
    static sanitize(doc) {
      if (!doc) return null;
      const { __v, _id, ...safe } = doc;
      safe.id = safe.id || (_id ? _id.toString() : '');
      return safe;
    }
  };
}

module.exports = IcebreakerPromptModel;
