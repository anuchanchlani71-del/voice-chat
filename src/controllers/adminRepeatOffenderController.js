const mongoose = require('mongoose');
const Report = require('../models/Report');
const User = require('../models/User');

/**
 * Helper: Calculate highest severity from an array of severity strings.
 * Precedence: critical > high > medium > low
 */
function calculateHighestSeverity(severities) {
  if (!severities || !Array.isArray(severities) || severities.length === 0) {
    return 'medium';
  }
  const norm = severities.map((s) => String(s).toLowerCase().trim());
  if (norm.includes('critical')) return 'critical';
  if (norm.includes('high')) return 'high';
  if (norm.includes('medium')) return 'medium';
  return 'low';
}

/**
 * Helper: Calculate priority from distinct reporter count and highest severity.
 * Rule:
 *  - 3+ distinct reporters OR highestSeverity === 'critical' => 'high'
 *  - 2 distinct reporters => 'medium'
 */
function calculatePriority(distinctReportersCount, highestSeverity) {
  if (distinctReportersCount >= 3 || highestSeverity === 'critical') {
    return 'high';
  }
  return 'medium';
}

/**
 * Helper: Derive pattern moderation status from report status counts.
 * Rule:
 *  - If pendingReports > 0 => 'requires_review'
 *  - If pendingReports === 0 and (account is suspended or flagged) => 'monitoring'
 *  - If all reports are resolved/dismissed => 'resolved'
 */
function calculatePatternStatus(pendingReports, userAccountStatus, isBlocked) {
  if (pendingReports > 0) {
    return 'requires_review';
  }
  if (userAccountStatus === 'suspended' || isBlocked) {
    return 'monitoring';
  }
  return 'resolved';
}

/**
 * Controller: GET /api/v1/admin/safety/repeat-offenders
 * Dynamically aggregates repeat-report patterns using MongoDB aggregation.
 * Only users with at least 2 DISTINCT reporters are returned.
 */
async function getRepeatOffenders(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { search, priority, patternStatus, minDistinctReporters } = req.query || {};

    const minReporters = Math.max(2, parseInt(minDistinctReporters, 10) || 2);

    // MongoDB Aggregation Pipeline
    const aggregationPipeline = [
      // 1. Group by reportedUser and collect metrics
      {
        $group: {
          _id: '$reportedUser',
          totalReports: { $sum: 1 },
          distinctReportersList: { $addToSet: '$reporter' },
          reportReasonsList: { $addToSet: '$reasonCategory' },
          severitiesList: { $push: '$severity' },
          earliestReportAt: { $min: '$createdAt' },
          latestReportAt: { $max: '$createdAt' },
          pendingReports: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          },
          resolvedReports: {
            $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] }
          },
          dismissedReports: {
            $sum: { $cond: [{ $eq: ['$status', 'dismissed'] }, 1, 0] }
          }
        }
      },
      // 2. Compute distinctReporters count
      {
        $addFields: {
          distinctReporters: { $size: '$distinctReportersList' }
        }
      },
      // 3. Filter only users with at least minReporters (>= 2)
      {
        $match: {
          distinctReporters: { $gte: minReporters }
        }
      },
      // 4. Lookup reported user profile from 'users' collection
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'reportedUserDetails'
        }
      },
      {
        $unwind: {
          path: '$reportedUserDetails',
          preserveNullAndEmptyArrays: true
        }
      }
    ];

    const rawAggregated = await Report.aggregate(aggregationPipeline);

    // Format and derive calculated fields
    let formattedPatterns = rawAggregated.map((item) => {
      const u = item.reportedUserDetails || {};
      const highestSeverity = calculateHighestSeverity(item.severitiesList);
      const computedPriority = calculatePriority(item.distinctReporters, highestSeverity);
      const computedStatus = calculatePatternStatus(
        item.pendingReports,
        u.accountStatus,
        u.isBlocked
      );

      return {
        reportedUser: {
          id: u.id || (item._id ? item._id.toString() : ''),
          fullName: u.fullName || 'Unknown User',
          username: u.username || 'unknown',
          avatar: u.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
          accountStatus: u.accountStatus || 'active',
          isBlocked: Boolean(u.isBlocked),
          reportsCount: typeof u.reportsCount === 'number' ? u.reportsCount : item.totalReports
        },
        totalReports: item.totalReports,
        distinctReporters: item.distinctReporters,
        reportReasons: (item.reportReasonsList || []).filter(Boolean),
        highestSeverity,
        earliestReportAt: item.earliestReportAt || null,
        latestReportAt: item.latestReportAt || null,
        pendingReports: item.pendingReports,
        resolvedReports: item.resolvedReports,
        dismissedReports: item.dismissedReports,
        priority: computedPriority,
        patternStatus: computedStatus
      };
    });

    // 5. Apply In-Memory / Post-Aggregation Filters (search, priority, patternStatus)
    if (priority && priority !== 'all') {
      const normPriority = String(priority).toLowerCase().trim();
      formattedPatterns = formattedPatterns.filter((p) => p.priority === normPriority);
    }

    if (patternStatus && patternStatus !== 'all') {
      const normStatus = String(patternStatus).toLowerCase().trim();
      formattedPatterns = formattedPatterns.filter((p) => p.patternStatus === normStatus);
    }

    if (search && typeof search === 'string' && search.trim()) {
      const term = search.trim().toLowerCase();
      formattedPatterns = formattedPatterns.filter((p) => {
        const matchesUsername = p.reportedUser.username.toLowerCase().includes(term);
        const matchesName = p.reportedUser.fullName.toLowerCase().includes(term);
        const matchesId = p.reportedUser.id.toLowerCase().includes(term);
        const matchesReason = p.reportReasons.some((r) => r.toLowerCase().includes(term));
        return matchesUsername || matchesName || matchesId || matchesReason;
      });
    }

    // 6. Sort patterns: high priority first, then most distinct reporters, then newest report
    formattedPatterns.sort((a, b) => {
      if (a.priority === 'high' && b.priority !== 'high') return -1;
      if (a.priority !== 'high' && b.priority === 'high') return 1;
      if (b.distinctReporters !== a.distinctReporters) {
        return b.distinctReporters - a.distinctReporters;
      }
      return new Date(b.latestReportAt || 0) - new Date(a.latestReportAt || 0);
    });

    const totalItems = formattedPatterns.length;
    const totalPages = Math.ceil(totalItems / limit) || 1;
    const paginatedData = formattedPatterns.slice(skip, skip + limit);

    return res.status(200).json({
      success: true,
      data: paginatedData,
      patterns: paginatedData,
      pagination: {
        page,
        limit,
        total: totalItems,
        totalPages,
        currentPage: page,
        pageSize: limit,
        totalItems
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: GET /api/v1/admin/safety/repeat-offenders/:userId
 * Retrieves complete repeat-report pattern detail and chronological report timeline for one user.
 */
async function getRepeatOffenderDetail(req, res, next) {
  try {
    const { userId } = req.params;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'User ID parameter is required.'
      });
    }

    // 1. Find reported user by custom ID, MongoDB _id, or username
    const userDoc = await User.findUserByIdOrIdentifier(userId);
    if (!userDoc) {
      return res.status(404).json({
        success: false,
        error: `User not found with identifier "${userId}".`
      });
    }

    // 2. Query all reports filed against this user
    const reports = await Report.find({ reportedUser: userDoc._id })
      .sort({ createdAt: -1 })
      .populate('reporter', 'id username fullName avatar accountStatus createdAt joinedDate')
      .populate('resolvedBy', 'id username name email role');

    if (!reports || reports.length === 0) {
      return res.status(404).json({
        success: false,
        error: `No report records found for user "${userDoc.username}".`
      });
    }

    // 3. Calculate distinct reporters
    const reporterIdsSet = new Set();
    const reasonsSet = new Set();
    const severitiesList = [];
    let pendingCount = 0;
    let resolvedCount = 0;
    let dismissedCount = 0;

    const reportsTimeline = reports.map((r) => {
      const reporterObj = r.reporter;
      const reporterIdStr = reporterObj
        ? (reporterObj.id || (reporterObj._id ? reporterObj._id.toString() : ''))
        : (r.reporter ? r.reporter.toString() : 'unknown');

      reporterIdsSet.add(reporterIdStr);

      if (r.reasonCategory) {
        reasonsSet.add(r.reasonCategory);
      }
      if (r.severity) {
        severitiesList.push(r.severity);
      }

      if (r.status === 'pending') pendingCount++;
      else if (r.status === 'resolved') resolvedCount++;
      else if (r.status === 'dismissed') dismissedCount++;

      return {
        id: r.id || r._id.toString(),
        reporter: reporterObj && typeof reporterObj === 'object'
          ? {
              id: reporterObj.id || (reporterObj._id ? reporterObj._id.toString() : ''),
              fullName: reporterObj.fullName,
              username: reporterObj.username,
              avatar: reporterObj.avatar,
              accountStatus: reporterObj.accountStatus,
              joinedDate: reporterObj.joinedDate || (reporterObj.createdAt ? new Date(reporterObj.createdAt).toISOString().split('T')[0] : '')
            }
          : null,
        reasonCategory: r.reasonCategory,
        reason: r.reason,
        description: r.description,
        severity: r.severity,
        status: r.status,
        notes: r.notes,
        date: r.date,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt,
        resolutionAction: r.resolutionAction
      };
    });

    const distinctReportersCount = reporterIdsSet.size;

    // Must have at least 2 distinct reporters to be considered a repeat offender pattern
    if (distinctReportersCount < 2) {
      return res.status(404).json({
        success: false,
        error: `User "${userDoc.username}" has ${reports.length} report(s) from only ${distinctReportersCount} distinct reporter. Multi-reporter repeat pattern threshold (2+) not met.`
      });
    }

    const highestSeverity = calculateHighestSeverity(severitiesList);
    const priority = calculatePriority(distinctReportersCount, highestSeverity);
    const patternStatus = calculatePatternStatus(
      pendingCount,
      userDoc.accountStatus,
      userDoc.isBlocked
    );

    const earliestReportAt = reports.length > 0 ? reports[reports.length - 1].createdAt : null;
    const latestReportAt = reports.length > 0 ? reports[0].createdAt : null;

    return res.status(200).json({
      success: true,
      data: {
        reportedUser: {
          id: userDoc.id || userDoc._id.toString(),
          fullName: userDoc.fullName,
          username: userDoc.username,
          avatar: userDoc.avatar,
          accountStatus: userDoc.accountStatus,
          isBlocked: Boolean(userDoc.isBlocked),
          reportsCount: userDoc.reportsCount,
          bio: userDoc.bio,
          joinedDate: userDoc.joinedDate
        },
        totalReports: reports.length,
        distinctReporters: distinctReportersCount,
        reportReasons: Array.from(reasonsSet),
        highestSeverity,
        earliestReportAt,
        latestReportAt,
        pendingReports: pendingCount,
        resolvedReports: resolvedCount,
        dismissedReports: dismissedCount,
        priority,
        patternStatus,
        reportsTimeline
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getRepeatOffenders,
  getRepeatOffenderDetail,
  calculateHighestSeverity,
  calculatePriority,
  calculatePatternStatus
};
