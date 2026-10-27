let mongoose;
try {
  mongoose = require('mongoose');
} catch (e) {
  mongoose = null;
}

let PlanModel;

if (mongoose) {
  const PlanSchema = new mongoose.Schema(
    {
      id: {
        type: String,
        unique: true,
        index: true
      },
      key: {
        type: String,
        required: [true, 'Plan key is required'],
        unique: true,
        lowercase: true,
        trim: true,
        index: true
      },
      name: {
        type: String,
        required: [true, 'Plan name is required'],
        trim: true
      },
      description: {
        type: String,
        default: '',
        trim: true
      },
      badgeText: {
        type: String,
        default: '',
        trim: true
      },
      features: {
        type: [String],
        default: []
      },
      limits: {
        maxDailyCallMinutes: {
          type: Number,
          default: 0,
          min: [0, 'maxDailyCallMinutes cannot be negative']
        },
        maxGroupRoomCapacity: {
          type: Number,
          default: 10,
          min: [0, 'maxGroupRoomCapacity cannot be negative']
        },
        canHostGroupRooms: {
          type: Boolean,
          default: true
        },
        canCreatePrivateRooms: {
          type: Boolean,
          default: false
        },
        hasAuraGlow: {
          type: Boolean,
          default: false
        },
        hasPriorityMatching: {
          type: Boolean,
          default: false
        },
        audioBitrateKbps: {
          type: Number,
          default: 64,
          min: [0, 'audioBitrateKbps cannot be negative']
        }
      },
      pricing: {
        monthly: {
          amount: {
            type: Number,
            default: 0,
            min: [0, 'Monthly price cannot be negative']
          },
          currency: {
            type: String,
            default: 'INR',
            trim: true,
            uppercase: true
          }
        },
        yearly: {
          amount: {
            type: Number,
            default: 0,
            min: [0, 'Yearly price cannot be negative']
          },
          currency: {
            type: String,
            default: 'INR',
            trim: true,
            uppercase: true
          }
        }
      },
      isDefault: {
        type: Boolean,
        default: false
      },
      isActive: {
        type: Boolean,
        default: true,
        index: true
      },
      displayOrder: {
        type: Number,
        default: 0,
        index: true
      }
    },
    {
      timestamps: true,
      collection: 'plans',
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
   * Pre-validate hook: Ensure custom ID is generated if not set & normalize key
   */
  PlanSchema.pre('validate', function (next) {
    if (!this.id) {
      this.id = `plan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }
    if (this.key && typeof this.key === 'string') {
      this.key = this.key.toLowerCase().trim();
    }
    next();
  });

  /**
   * Static: Find Plan by custom string ID or MongoDB _id
   */
  PlanSchema.statics.findPlanByIdOrMongoId = async function (id) {
    if (!id) return null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      const byMongoId = await this.findById(id);
      if (byMongoId) return byMongoId;
    }
    return this.findOne({ id });
  };

  /**
   * Static: Find Plan by key (case-insensitive)
   */
  PlanSchema.statics.findByKey = async function (key) {
    if (!key || typeof key !== 'string') return null;
    const trimmed = key.trim().toLowerCase();
    return this.findOne({ key: trimmed });
  };

  /**
   * Static: Sanitize plan document
   */
  PlanSchema.statics.sanitize = function (planDoc) {
    if (!planDoc) return null;
    const obj = planDoc.toObject ? planDoc.toObject() : { ...planDoc };
    delete obj.__v;
    if (obj._id) {
      obj.id = obj.id || obj._id.toString();
      delete obj._id;
    }
    return obj;
  };

  PlanModel = mongoose.models.Plan || mongoose.model('Plan', PlanSchema);
} else {
  PlanModel = class StandalonePlan {
    static sanitize(doc) {
      if (!doc) return null;
      const { __v, _id, ...safe } = doc;
      safe.id = safe.id || (_id ? _id.toString() : '');
      return safe;
    }
  };
}

module.exports = PlanModel;
