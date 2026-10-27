let mongoose;
try {
  mongoose = require('mongoose');
} catch (e) {
  mongoose = null;
}

let SubscriptionModel;

if (mongoose) {
  const SubscriptionSchema = new mongoose.Schema(
    {
      id: {
        type: String,
        unique: true,
        index: true
      },
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'User reference is required'],
        index: true
      },
      plan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Plan',
        required: [true, 'Plan reference is required'],
        index: true
      },
      planKey: {
        type: String,
        lowercase: true,
        trim: true,
        index: true
      },
      status: {
        type: String,
        enum: ['active', 'inactive', 'cancelled', 'expired'],
        default: 'active',
        index: true
      },
      startDate: {
        type: Date,
        default: Date.now
      },
      endDate: {
        type: Date,
        default: null
      },
      autoRenew: {
        type: Boolean,
        default: false
      },
      metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
      }
    },
    {
      timestamps: true,
      collection: 'subscriptions',
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
   * Pre-validate hook: generate custom string id if not set
   */
  SubscriptionSchema.pre('validate', function (next) {
    if (!this.id) {
      this.id = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }
    next();
  });

  /**
   * Static: Find Subscription by custom string ID or MongoDB _id
   */
  SubscriptionSchema.statics.findSubscriptionByIdOrMongoId = async function (id) {
    if (!id) return null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      const byMongoId = await this.findById(id).populate('user', 'id username fullName email avatar').populate('plan');
      if (byMongoId) return byMongoId;
    }
    return this.findOne({ id }).populate('user', 'id username fullName email avatar').populate('plan');
  };

  /**
   * Static: Sanitize subscription document
   */
  SubscriptionSchema.statics.sanitize = function (subDoc) {
    if (!subDoc) return null;
    const obj = subDoc.toObject ? subDoc.toObject() : { ...subDoc };
    delete obj.__v;
    if (obj._id) {
      obj.id = obj.id || obj._id.toString();
      delete obj._id;
    }
    return obj;
  };

  SubscriptionModel = mongoose.models.Subscription || mongoose.model('Subscription', SubscriptionSchema);
} else {
  SubscriptionModel = class StandaloneSubscription {
    static sanitize(doc) {
      if (!doc) return null;
      const { __v, _id, ...safe } = doc;
      safe.id = safe.id || (_id ? _id.toString() : '');
      return safe;
    }
  };
}

module.exports = SubscriptionModel;
