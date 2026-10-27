const Plan = require('../models/Plan');

/**
 * Controller: GET /api/v1/admin/plans
 * Retrieve plans with sorting by displayOrder ascending, search, active filter, and pagination.
 */
async function listPlans(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const { search, isActive, status } = req.query || {};
    const filter = {};

    // 1. Search Filter (by name or key or description)
    if (search && typeof search === 'string' && search.trim()) {
      const term = search.trim();
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [
        { name: regex },
        { key: regex },
        { description: regex }
      ];
    }

    // 2. Active status filter
    const activeParam = (isActive !== undefined ? isActive : status);
    if (activeParam !== undefined && activeParam !== 'all') {
      const norm = String(activeParam).toLowerCase().trim();
      if (norm === 'true' || norm === 'active') {
        filter.isActive = true;
      } else if (norm === 'false' || norm === 'inactive') {
        filter.isActive = false;
      }
    }

    // Fetch records and total count
    const [rawPlans, totalItems] = await Promise.all([
      Plan.find(filter)
        .sort({ displayOrder: 1, createdAt: 1 })
        .skip(skip)
        .limit(limit),
      Plan.countDocuments(filter)
    ]);

    const plans = rawPlans.map((p) => Plan.sanitize(p));
    const totalPages = Math.ceil(totalItems / limit) || 1;

    return res.status(200).json({
      success: true,
      plans,
      data: plans,
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
 * Controller: GET /api/v1/admin/plans/:id
 * Retrieve a single plan by custom string ID or MongoDB ObjectId.
 */
async function getPlan(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Plan ID parameter is required.'
      });
    }

    const plan = await Plan.findPlanByIdOrMongoId(id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        error: `Plan not found with ID "${id}".`
      });
    }

    const sanitized = Plan.sanitize(plan);
    return res.status(200).json({
      success: true,
      plan: sanitized,
      data: sanitized
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: POST /api/v1/admin/plans
 * Create a new subscription plan with validation and duplicate prevention.
 */
async function createPlan(req, res, next) {
  try {
    const {
      key,
      name,
      description,
      badgeText,
      features,
      limits,
      pricing,
      isDefault,
      isActive,
      displayOrder
    } = req.body || {};

    // 1. Validate required key
    if (!key || typeof key !== 'string' || !key.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Plan key is required and cannot be empty.'
      });
    }

    const normalizedKey = key.trim().toLowerCase();
    if (!/^[a-z0-9_-]+$/.test(normalizedKey)) {
      return res.status(400).json({
        success: false,
        error: 'Plan key must contain only lowercase alphanumeric characters, dashes, or underscores.'
      });
    }

    // 2. Validate required name
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Plan name is required and cannot be empty.'
      });
    }
    const trimmedName = name.trim();

    // 3. Enforce unique key
    const existingKey = await Plan.findByKey(normalizedKey);
    if (existingKey) {
      return res.status(400).json({
        success: false,
        error: `A plan with key "${normalizedKey}" already exists.`
      });
    }

    // 4. Validate features array
    if (features !== undefined) {
      if (!Array.isArray(features)) {
        return res.status(400).json({
          success: false,
          error: 'Features must be an array of strings.'
        });
      }
      for (const feat of features) {
        if (typeof feat !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'Each feature item must be a string.'
          });
        }
      }
    }

    // 5. Validate pricing
    if (pricing !== undefined) {
      if (typeof pricing !== 'object' || pricing === null) {
        return res.status(400).json({
          success: false,
          error: 'Pricing must be an object with monthly and yearly configurations.'
        });
      }

      if (pricing.monthly !== undefined) {
        if (pricing.monthly.amount !== undefined) {
          if (typeof pricing.monthly.amount !== 'number' || isNaN(pricing.monthly.amount) || pricing.monthly.amount < 0) {
            return res.status(400).json({
              success: false,
              error: 'Monthly price amount cannot be negative.'
            });
          }
        }
      }

      if (pricing.yearly !== undefined) {
        if (pricing.yearly.amount !== undefined) {
          if (typeof pricing.yearly.amount !== 'number' || isNaN(pricing.yearly.amount) || pricing.yearly.amount < 0) {
            return res.status(400).json({
              success: false,
              error: 'Yearly price amount cannot be negative.'
            });
          }
        }
      }
    }

    // 6. Validate limits
    if (limits !== undefined) {
      if (typeof limits !== 'object' || limits === null) {
        return res.status(400).json({
          success: false,
          error: 'Limits must be an object.'
        });
      }

      const numericLimitKeys = ['maxDailyCallMinutes', 'maxGroupRoomCapacity', 'audioBitrateKbps'];
      for (const numKey of numericLimitKeys) {
        if (limits[numKey] !== undefined) {
          if (typeof limits[numKey] !== 'number' || isNaN(limits[numKey]) || limits[numKey] < 0) {
            return res.status(400).json({
              success: false,
              error: `Limit "${numKey}" cannot be negative.`
            });
          }
        }
      }

      const boolLimitKeys = ['canHostGroupRooms', 'canCreatePrivateRooms', 'hasAuraGlow', 'hasPriorityMatching'];
      for (const boolKey of boolLimitKeys) {
        if (limits[boolKey] !== undefined && typeof limits[boolKey] !== 'boolean') {
          return res.status(400).json({
            success: false,
            error: `Limit "${boolKey}" must be a boolean.`
          });
        }
      }
    }

    // 7. Validate displayOrder
    if (displayOrder !== undefined) {
      if (typeof displayOrder !== 'number' || isNaN(displayOrder) || displayOrder < 0) {
        return res.status(400).json({
          success: false,
          error: 'Display order must be a valid non-negative number.'
        });
      }
    }

    // 8. Handle default plan exclusivity
    const targetIsDefault = Boolean(isDefault);
    if (targetIsDefault) {
      await Plan.updateMany({ isDefault: true }, { $set: { isDefault: false } });
    }

    // 9. Construct and save new Plan
    const newPlan = new Plan({
      key: normalizedKey,
      name: trimmedName,
      description: typeof description === 'string' ? description.trim() : '',
      badgeText: typeof badgeText === 'string' ? badgeText.trim() : '',
      features: Array.isArray(features) ? features.map((f) => f.trim()).filter(Boolean) : [],
      limits: {
        maxDailyCallMinutes: limits?.maxDailyCallMinutes !== undefined ? limits.maxDailyCallMinutes : 0,
        maxGroupRoomCapacity: limits?.maxGroupRoomCapacity !== undefined ? limits.maxGroupRoomCapacity : 10,
        canHostGroupRooms: limits?.canHostGroupRooms !== undefined ? limits.canHostGroupRooms : true,
        canCreatePrivateRooms: limits?.canCreatePrivateRooms !== undefined ? limits.canCreatePrivateRooms : false,
        hasAuraGlow: limits?.hasAuraGlow !== undefined ? limits.hasAuraGlow : false,
        hasPriorityMatching: limits?.hasPriorityMatching !== undefined ? limits.hasPriorityMatching : false,
        audioBitrateKbps: limits?.audioBitrateKbps !== undefined ? limits.audioBitrateKbps : 64
      },
      pricing: {
        monthly: {
          amount: pricing?.monthly?.amount !== undefined ? pricing.monthly.amount : 0,
          currency: (pricing?.monthly?.currency && typeof pricing.monthly.currency === 'string')
            ? pricing.monthly.currency.trim().toUpperCase()
            : 'INR'
        },
        yearly: {
          amount: pricing?.yearly?.amount !== undefined ? pricing.yearly.amount : 0,
          currency: (pricing?.yearly?.currency && typeof pricing.yearly.currency === 'string')
            ? pricing.yearly.currency.trim().toUpperCase()
            : 'INR'
        }
      },
      isDefault: targetIsDefault,
      isActive: isActive !== undefined ? Boolean(isActive) : true,
      displayOrder: displayOrder !== undefined ? Number(displayOrder) : 0
    });

    await newPlan.save();
    const sanitized = Plan.sanitize(newPlan);

    return res.status(201).json({
      success: true,
      message: 'Plan created successfully',
      plan: sanitized,
      data: sanitized
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'A plan with this key already exists.'
      });
    }
    next(err);
  }
}

/**
 * Controller: PUT /api/v1/admin/plans/:id
 * Update an existing plan with partial field support and nested value preservation.
 */
async function updatePlan(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Plan ID parameter is required.'
      });
    }

    const plan = await Plan.findPlanByIdOrMongoId(id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        error: `Plan not found with ID "${id}".`
      });
    }

    const {
      name,
      description,
      badgeText,
      features,
      limits,
      pricing,
      displayOrder,
      isActive,
      isDefault
    } = req.body || {};

    // 1. Validate name if supplied
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Plan name cannot be empty.'
        });
      }
      plan.name = name.trim();
    }

    // 2. Update description if supplied
    if (description !== undefined) {
      if (typeof description !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Description must be a string.'
        });
      }
      plan.description = description.trim();
    }

    // 3. Update badgeText if supplied
    if (badgeText !== undefined) {
      if (typeof badgeText !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Badge text must be a string.'
        });
      }
      plan.badgeText = badgeText.trim();
    }

    // 4. Update features if supplied
    if (features !== undefined) {
      if (!Array.isArray(features)) {
        return res.status(400).json({
          success: false,
          error: 'Features must be an array of strings.'
        });
      }
      for (const feat of features) {
        if (typeof feat !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'Each feature item must be a string.'
          });
        }
      }
      plan.features = features.map((f) => f.trim()).filter(Boolean);
    }

    // 5. Update limits (preserving unspecified nested values)
    if (limits !== undefined) {
      if (typeof limits !== 'object' || limits === null) {
        return res.status(400).json({
          success: false,
          error: 'Limits must be an object.'
        });
      }

      const numericLimitKeys = ['maxDailyCallMinutes', 'maxGroupRoomCapacity', 'audioBitrateKbps'];
      for (const numKey of numericLimitKeys) {
        if (limits[numKey] !== undefined) {
          if (typeof limits[numKey] !== 'number' || isNaN(limits[numKey]) || limits[numKey] < 0) {
            return res.status(400).json({
              success: false,
              error: `Limit "${numKey}" cannot be negative.`
            });
          }
          plan.limits[numKey] = limits[numKey];
        }
      }

      const boolLimitKeys = ['canHostGroupRooms', 'canCreatePrivateRooms', 'hasAuraGlow', 'hasPriorityMatching'];
      for (const boolKey of boolLimitKeys) {
        if (limits[boolKey] !== undefined) {
          if (typeof limits[boolKey] !== 'boolean') {
            return res.status(400).json({
              success: false,
              error: `Limit "${boolKey}" must be a boolean.`
            });
          }
          plan.limits[boolKey] = limits[boolKey];
        }
      }
    }

    // 6. Update pricing (preserving unspecified nested values)
    if (pricing !== undefined) {
      if (typeof pricing !== 'object' || pricing === null) {
        return res.status(400).json({
          success: false,
          error: 'Pricing must be an object.'
        });
      }

      if (pricing.monthly !== undefined) {
        if (pricing.monthly.amount !== undefined) {
          if (typeof pricing.monthly.amount !== 'number' || isNaN(pricing.monthly.amount) || pricing.monthly.amount < 0) {
            return res.status(400).json({
              success: false,
              error: 'Monthly price amount cannot be negative.'
            });
          }
          plan.pricing.monthly.amount = pricing.monthly.amount;
        }
        if (pricing.monthly.currency !== undefined) {
          if (typeof pricing.monthly.currency !== 'string') {
            return res.status(400).json({
              success: false,
              error: 'Monthly currency must be a string.'
            });
          }
          plan.pricing.monthly.currency = pricing.monthly.currency.trim().toUpperCase();
        }
      }

      if (pricing.yearly !== undefined) {
        if (pricing.yearly.amount !== undefined) {
          if (typeof pricing.yearly.amount !== 'number' || isNaN(pricing.yearly.amount) || pricing.yearly.amount < 0) {
            return res.status(400).json({
              success: false,
              error: 'Yearly price amount cannot be negative.'
            });
          }
          plan.pricing.yearly.amount = pricing.yearly.amount;
        }
        if (pricing.yearly.currency !== undefined) {
          if (typeof pricing.yearly.currency !== 'string') {
            return res.status(400).json({
              success: false,
              error: 'Yearly currency must be a string.'
            });
          }
          plan.pricing.yearly.currency = pricing.yearly.currency.trim().toUpperCase();
        }
      }
    }

    // 7. Update displayOrder
    if (displayOrder !== undefined) {
      if (typeof displayOrder !== 'number' || isNaN(displayOrder) || displayOrder < 0) {
        return res.status(400).json({
          success: false,
          error: 'Display order must be a valid non-negative number.'
        });
      }
      plan.displayOrder = displayOrder;
    }

    // 8. Handle default plan safety
    if (isDefault !== undefined) {
      const wantDefault = Boolean(isDefault);
      if (wantDefault && !plan.isDefault) {
        // Switching this plan to default: unset on all others
        await Plan.updateMany(
          { _id: { $ne: plan._id }, isDefault: true },
          { $set: { isDefault: false } }
        );
        plan.isDefault = true;
        // Ensure default plan is also active
        plan.isActive = true;
      } else if (!wantDefault && plan.isDefault) {
        // Attempting to unset default on the current default plan
        const otherDefault = await Plan.findOne({
          _id: { $ne: plan._id },
          isDefault: true
        });
        if (!otherDefault) {
          return res.status(400).json({
            success: false,
            error: 'Cannot unset default plan. Exactly one plan must be set as default. Set another plan as default first.'
          });
        }
        plan.isDefault = false;
      }
    }

    // 9. Handle isActive update & safety guard
    if (isActive !== undefined) {
      const wantActive = Boolean(isActive);
      if (!wantActive && plan.isDefault) {
        return res.status(400).json({
          success: false,
          error: 'Cannot deactivate the default plan. Please set another active plan as default first.'
        });
      }
      plan.isActive = wantActive;
    }

    await plan.save();
    const sanitized = Plan.sanitize(plan);

    return res.status(200).json({
      success: true,
      message: 'Plan updated successfully',
      plan: sanitized,
      data: sanitized
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'A plan with this key already exists.'
      });
    }
    next(err);
  }
}

/**
 * Controller: PATCH /api/v1/admin/plans/:id/status
 * Toggle or update the active status of a plan.
 */
async function updatePlanStatus(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Plan ID parameter is required.'
      });
    }

    const plan = await Plan.findPlanByIdOrMongoId(id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        error: `Plan not found with ID "${id}".`
      });
    }

    let targetActive;
    if (req.body?.isActive !== undefined) {
      targetActive = Boolean(req.body.isActive);
    } else if (req.body?.status !== undefined) {
      const s = String(req.body.status).toLowerCase().trim();
      if (s === 'active') targetActive = true;
      else if (s === 'inactive') targetActive = false;
      else {
        return res.status(400).json({
          success: false,
          error: 'Status must be either "active" or "inactive".'
        });
      }
    } else {
      // Toggle
      targetActive = !plan.isActive;
    }

    // Prevent deactivating the default plan
    if (!targetActive && plan.isDefault) {
      return res.status(400).json({
        success: false,
        error: 'Cannot deactivate the default plan. Please set another active plan as default first.'
      });
    }

    plan.isActive = targetActive;
    await plan.save();

    const sanitized = Plan.sanitize(plan);
    return res.status(200).json({
      success: true,
      message: `Plan status updated successfully to ${targetActive ? 'active' : 'inactive'}`,
      plan: sanitized,
      data: sanitized
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: DELETE /api/v1/admin/plans/:id
 * Delete a plan with safety guard protecting the default plan.
 */
async function deletePlan(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Plan ID parameter is required.'
      });
    }

    const plan = await Plan.findPlanByIdOrMongoId(id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        error: `Plan not found with ID "${id}".`
      });
    }

    // Default plan safety guard: do not delete the default plan or base free plan
    if (plan.isDefault || plan.key === 'free') {
      return res.status(400).json({
        success: false,
        error: `Cannot delete the default plan ("${plan.name}"). Assign another plan as default first before deleting.`
      });
    }

    await Plan.deleteOne({ _id: plan._id });

    return res.status(200).json({
      success: true,
      message: 'Plan deleted successfully'
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listPlans,
  getPlans: listPlans,
  getPlan,
  createPlan,
  updatePlan,
  updatePlanStatus,
  deletePlan
};
