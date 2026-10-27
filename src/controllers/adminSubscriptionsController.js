const Subscription = require('../models/Subscription');
const User = require('../models/User');
const Plan = require('../models/Plan');

/**
 * Controller: GET /api/v1/admin/subscriptions
 * Retrieve paginated subscription records with search, plan filter, and status filter.
 */
async function listSubscriptions(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { search, status, plan } = req.query || {};
    const filter = {};

    // 1. Status Filter
    if (status && typeof status === 'string' && status !== 'all') {
      const normStatus = status.toLowerCase().trim();
      if (['active', 'inactive', 'cancelled', 'expired'].includes(normStatus)) {
        filter.status = normStatus;
      }
    }

    // 2. Plan Filter (by plan id, mongo _id, or key)
    if (plan && typeof plan === 'string' && plan !== 'all') {
      const planDoc = await Plan.findOne({
        $or: [{ id: plan }, { key: plan.toLowerCase().trim() }]
      });
      if (planDoc) {
        filter.plan = planDoc._id;
      } else if (plan.match(/^[0-9a-fA-F]{24}$/)) {
        filter.plan = plan;
      }
    }

    // 3. Search Filter (user name, email, username or plan name/key)
    if (search && typeof search === 'string' && search.trim()) {
      const term = search.trim();
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');

      const [matchedUsers, matchedPlans] = await Promise.all([
        User.find({
          $or: [
            { username: regex },
            { fullName: regex },
            { email: regex }
          ]
        }).select('_id'),
        Plan.find({
          $or: [
            { name: regex },
            { key: regex }
          ]
        }).select('_id')
      ]);

      const userIds = matchedUsers.map((u) => u._id);
      const planIds = matchedPlans.map((p) => p._id);

      filter.$or = [
        { user: { $in: userIds } },
        { plan: { $in: planIds } },
        { id: regex }
      ];
    }

    const [rawSubs, totalItems] = await Promise.all([
      Subscription.find(filter)
        .populate('user', 'id username fullName email avatar isOnline accountStatus')
        .populate('plan', 'id key name badgeText pricing limits isDefault isActive')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Subscription.countDocuments(filter)
    ]);

    const subscriptions = rawSubs.map((s) => Subscription.sanitize(s));
    const totalPages = Math.ceil(totalItems / limit) || 1;

    return res.status(200).json({
      success: true,
      subscriptions,
      data: subscriptions,
      pagination: {
        currentPage: page,
        pageSize: limit,
        page,
        limit,
        totalItems,
        totalPages,
        total: totalItems
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: GET /api/v1/admin/subscriptions/:id
 * Retrieve a single subscription record by ID.
 */
async function getSubscription(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Subscription ID parameter is required.'
      });
    }

    const sub = await Subscription.findSubscriptionByIdOrMongoId(id);
    if (!sub) {
      return res.status(404).json({
        success: false,
        error: `Subscription not found with ID "${id}".`
      });
    }

    const sanitized = Subscription.sanitize(sub);
    return res.status(200).json({
      success: true,
      subscription: sanitized,
      data: sanitized
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: POST /api/v1/admin/subscriptions
 * Create a new user subscription assignment.
 */
async function createSubscription(req, res, next) {
  try {
    const { userId, planId, status, startDate, endDate, autoRenew } = req.body || {};

    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      return res.status(400).json({
        success: false,
        error: 'User reference (userId) is required.'
      });
    }

    if (!planId || typeof planId !== 'string' || !planId.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Plan reference (planId) is required.'
      });
    }

    // Verify User exists
    const user = await User.findUserByIdOrIdentifier(userId.trim());
    if (!user) {
      return res.status(400).json({
        success: false,
        error: `User not found with identifier "${userId}".`
      });
    }

    // Verify Plan exists
    let plan = await Plan.findPlanByIdOrMongoId(planId.trim());
    if (!plan) {
      plan = await Plan.findByKey(planId.trim());
    }
    if (!plan) {
      return res.status(400).json({
        success: false,
        error: `Subscription plan not found with identifier "${planId}".`
      });
    }

    // Validate status
    const targetStatus = status ? status.toLowerCase().trim() : 'active';
    if (!['active', 'inactive', 'cancelled', 'expired'].includes(targetStatus)) {
      return res.status(400).json({
        success: false,
        error: 'Status must be one of: active, inactive, cancelled, expired.'
      });
    }

    // Validate dates
    const parsedStart = startDate ? new Date(startDate) : new Date();
    let parsedEnd = null;
    if (endDate) {
      parsedEnd = new Date(endDate);
      if (isNaN(parsedEnd.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid end date format.'
        });
      }
      if (parsedEnd < parsedStart) {
        return res.status(400).json({
          success: false,
          error: 'End date cannot be earlier than start date.'
        });
      }
    }

    const newSub = new Subscription({
      user: user._id,
      plan: plan._id,
      planKey: plan.key,
      status: targetStatus,
      startDate: parsedStart,
      endDate: parsedEnd,
      autoRenew: Boolean(autoRenew)
    });

    await newSub.save();
    await newSub.populate('user', 'id username fullName email avatar isOnline accountStatus');
    await newSub.populate('plan', 'id key name badgeText pricing limits isDefault isActive');

    const sanitized = Subscription.sanitize(newSub);
    return res.status(201).json({
      success: true,
      message: 'Subscription created successfully',
      subscription: sanitized,
      data: sanitized
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: PUT /api/v1/admin/subscriptions/:id
 * Update an existing subscription (plan, status, start/end dates).
 */
async function updateSubscription(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Subscription ID parameter is required.'
      });
    }

    const sub = await Subscription.findSubscriptionByIdOrMongoId(id);
    if (!sub) {
      return res.status(404).json({
        success: false,
        error: `Subscription not found with ID "${id}".`
      });
    }

    const { planId, status, startDate, endDate, autoRenew } = req.body || {};

    // 1. Update plan if provided
    if (planId !== undefined && planId !== null) {
      let plan = await Plan.findPlanByIdOrMongoId(String(planId).trim());
      if (!plan) {
        plan = await Plan.findByKey(String(planId).trim());
      }
      if (!plan) {
        return res.status(400).json({
          success: false,
          error: `Subscription plan not found with identifier "${planId}".`
        });
      }
      sub.plan = plan._id;
      sub.planKey = plan.key;
    }

    // 2. Update status if provided
    if (status !== undefined && status !== null) {
      const normStatus = String(status).toLowerCase().trim();
      if (!['active', 'inactive', 'cancelled', 'expired'].includes(normStatus)) {
        return res.status(400).json({
          success: false,
          error: 'Status must be one of: active, inactive, cancelled, expired.'
        });
      }
      sub.status = normStatus;
    }

    // 3. Update dates if provided
    if (startDate !== undefined) {
      const parsedStart = new Date(startDate);
      if (isNaN(parsedStart.getTime())) {
        return res.status(400).json({ success: false, error: 'Invalid start date format.' });
      }
      sub.startDate = parsedStart;
    }

    if (endDate !== undefined) {
      if (endDate === null || endDate === '') {
        sub.endDate = null;
      } else {
        const parsedEnd = new Date(endDate);
        if (isNaN(parsedEnd.getTime())) {
          return res.status(400).json({ success: false, error: 'Invalid end date format.' });
        }
        if (sub.startDate && parsedEnd < sub.startDate) {
          return res.status(400).json({ success: false, error: 'End date cannot be earlier than start date.' });
        }
        sub.endDate = parsedEnd;
      }
    }

    if (autoRenew !== undefined) {
      sub.autoRenew = Boolean(autoRenew);
    }

    await sub.save();
    await sub.populate('user', 'id username fullName email avatar isOnline accountStatus');
    await sub.populate('plan', 'id key name badgeText pricing limits isDefault isActive');

    const sanitized = Subscription.sanitize(sub);
    return res.status(200).json({
      success: true,
      message: 'Subscription updated successfully',
      subscription: sanitized,
      data: sanitized
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: PATCH /api/v1/admin/subscriptions/:id/status
 * Update status of an existing subscription.
 */
async function updateSubscriptionStatus(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Subscription ID parameter is required.'
      });
    }

    const sub = await Subscription.findSubscriptionByIdOrMongoId(id);
    if (!sub) {
      return res.status(404).json({
        success: false,
        error: `Subscription not found with ID "${id}".`
      });
    }

    const { status } = req.body || {};
    if (!status || typeof status !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Status is required and must be one of: active, inactive, cancelled, expired.'
      });
    }

    const normStatus = status.toLowerCase().trim();
    if (!['active', 'inactive', 'cancelled', 'expired'].includes(normStatus)) {
      return res.status(400).json({
        success: false,
        error: 'Status must be one of: active, inactive, cancelled, expired.'
      });
    }

    sub.status = normStatus;
    await sub.save();
    await sub.populate('user', 'id username fullName email avatar isOnline accountStatus');
    await sub.populate('plan', 'id key name badgeText pricing limits isDefault isActive');

    const sanitized = Subscription.sanitize(sub);
    return res.status(200).json({
      success: true,
      message: `Subscription status updated to "${normStatus}"`,
      subscription: sanitized,
      data: sanitized
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: DELETE /api/v1/admin/subscriptions/:id
 * Delete an existing subscription record.
 */
async function deleteSubscription(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Subscription ID parameter is required.'
      });
    }

    const sub = await Subscription.findSubscriptionByIdOrMongoId(id);
    if (!sub) {
      return res.status(404).json({
        success: false,
        error: `Subscription not found with ID "${id}".`
      });
    }

    await Subscription.deleteOne({ _id: sub._id });

    return res.status(200).json({
      success: true,
      message: 'Subscription record deleted successfully'
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listSubscriptions,
  getSubscriptions: listSubscriptions,
  getSubscription,
  createSubscription,
  updateSubscription,
  updateSubscriptionStatus,
  deleteSubscription
};
