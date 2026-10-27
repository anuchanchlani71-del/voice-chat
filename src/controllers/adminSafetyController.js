const Report = require('../models/Report');
const User = require('../models/User');
const Block = require('../models/Block');
const Notification = require('../models/Notification');

/**
 * Controller: GET /api/v1/admin/safety/overview
 * Retrieve real-time safety metrics, active moderation alerts, and system rate-limiting rules.
 */
async function getSafetyOverview(req, res, next) {
  try {
    const [
      activeReportsCount,
      criticalFlaggedUsers,
      dailyBlockIncidents,
      suspendedUsersCount,
      totalReports,
      totalBlocks,
      safetyAlertsCount
    ] = await Promise.all([
      Report.countDocuments({ status: 'pending' }),
      User.countDocuments({
        $or: [
          { reportsCount: { $gt: 0 } },
          { isBlocked: true },
          { accountStatus: 'suspended' }
        ]
      }),
      Block.countDocuments({ status: 'active' }),
      User.countDocuments({ accountStatus: 'suspended' }),
      Report.countDocuments({}),
      Block.countDocuments({}),
      Notification.countDocuments({ type: 'safety_alert' })
    ]);

    return res.status(200).json({
      success: true,
      metrics: {
        activeReportsCount,
        criticalFlaggedUsers,
        dailyBlockIncidents,
        suspendedUsersCount,
        totalReports,
        totalBlocks,
        safetyAlertsCount
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: GET /api/v1/admin/safety/flagged-users
 * Retrieve paginated high-risk accounts requiring moderation (reports against, blocked, or suspended).
 */
async function getFlaggedUsers(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { search, accountStatus, status } = req.query || {};

    const baseCondition = {
      $or: [
        { reportsCount: { $gt: 0 } },
        { isBlocked: true },
        { accountStatus: 'suspended' }
      ]
    };

    const filter = { ...baseCondition };

    // 1. Account status filter
    const statusParam = accountStatus || status;
    if (statusParam && statusParam !== 'all') {
      const normStatus = String(statusParam).toLowerCase().trim();
      if (['active', 'suspended'].includes(normStatus)) {
        filter.accountStatus = normStatus;
      }
    }

    // 2. Search filter (username, fullName, bio, id)
    if (search && typeof search === 'string' && search.trim()) {
      const term = search.trim();
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');

      filter.$and = [
        baseCondition,
        {
          $or: [
            { username: regex },
            { fullName: regex },
            { bio: regex },
            { id: regex }
          ]
        }
      ];
      delete filter.$or;
    }

    const [rawUsers, totalFiltered] = await Promise.all([
      User.find(filter)
        .sort({ reportsCount: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(filter)
    ]);

    const flaggedUsers = rawUsers.map((u) => User.sanitize(u));
    const totalPages = Math.ceil(totalFiltered / limit) || 1;

    return res.status(200).json({
      success: true,
      flaggedUsers,
      pagination: {
        currentPage: page,
        pageSize: limit,
        totalItems: totalFiltered,
        totalPages
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSafetyOverview,
  getFlaggedUsers
};
