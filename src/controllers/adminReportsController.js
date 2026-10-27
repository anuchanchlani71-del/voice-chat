const mongoose = require('mongoose');
const Report = require('../models/Report');
const User = require('../models/User');

/**
 * Controller: GET /api/v1/admin/reports
 * Retrieve paginated user moderation reports for the Admin Panel with search, status filtering, category filtering, and date range support.
 */
async function getReports(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { search, status, type, reasonCategory, startDate, endDate, from, to } = req.query || {};

    const filter = {};

    // 1. Status Filter (tabs: all, pending, resolved, dismissed)
    if (status && status !== 'all') {
      const normStatus = String(status).toLowerCase().trim();
      if (['pending', 'resolved', 'dismissed'].includes(normStatus)) {
        filter.status = normStatus;
      }
    }

    // 2. Reason Category / Type Filter
    const categoryFilter = type || reasonCategory;
    if (categoryFilter && typeof categoryFilter === 'string' && categoryFilter.trim()) {
      const catTerm = categoryFilter.trim();
      const escapedCat = catTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.reasonCategory = new RegExp(escapedCat, 'i');
    }

    // 3. Search Filter (by reportedUser/reporter username, fullName, user ID, reasonCategory, or report ID)
    if (search && typeof search === 'string' && search.trim()) {
      const term = search.trim();
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');

      const matchedUsers = await User.find({
        $or: [
          { username: regex },
          { fullName: regex },
          { id: regex }
        ]
      }).select('_id id');

      const userMongoIds = matchedUsers.map((u) => u._id);

      filter.$or = [
        { reportedUser: { $in: userMongoIds } },
        { reporter: { $in: userMongoIds } },
        { reasonCategory: regex },
        { id: regex }
      ];
    }

    // 4. Date Range Filter
    const dateStart = startDate || from;
    const dateEnd = endDate || to;
    if (dateStart || dateEnd) {
      filter.createdAt = {};
      if (dateStart && !isNaN(new Date(dateStart).getTime())) {
        filter.createdAt.$gte = new Date(dateStart);
      }
      if (dateEnd && !isNaN(new Date(dateEnd).getTime())) {
        const endD = new Date(dateEnd);
        if (dateEnd.length <= 10) {
          endD.setHours(23, 59, 59, 999);
        }
        filter.createdAt.$lte = endD;
      }
      if (Object.keys(filter.createdAt).length === 0) {
        delete filter.createdAt;
      }
    }

    // Parallel fetch: Filtered records + Status counts for tabs
    const [
      rawReports,
      totalFiltered,
      totalAll,
      totalPending,
      totalResolved,
      totalDismissed
    ] = await Promise.all([
      Report.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('reporter', 'id username fullName avatar accountStatus isOnline')
        .populate('reportedUser', 'id username fullName avatar accountStatus isOnline reportsCount isBlocked'),
      Report.countDocuments(filter),
      Report.countDocuments({}),
      Report.countDocuments({ status: 'pending' }),
      Report.countDocuments({ status: 'resolved' }),
      Report.countDocuments({ status: 'dismissed' })
    ]);

    const reports = rawReports.map((r) => Report.sanitize(r));
    const totalPages = Math.ceil(totalFiltered / limit) || 1;

    return res.status(200).json({
      success: true,
      reports,
      counts: {
        all: totalAll,
        pending: totalPending,
        resolved: totalResolved,
        dismissed: totalDismissed
      },
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

/**
 * Controller: GET /api/v1/admin/reports/:id
 * Retrieve full details of a specific moderation report.
 */
async function getReportById(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Report ID parameter is required.'
      });
    }

    let reportDoc = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      reportDoc = await Report.findById(id)
        .populate('reporter', 'id username fullName avatar bio interests email phone accountStatus isOnline lastSeen')
        .populate('reportedUser', 'id username fullName avatar bio interests email phone accountStatus isOnline lastSeen reportsCount isBlocked')
        .populate('resolvedBy', 'id username name email role');
    }

    if (!reportDoc) {
      reportDoc = await Report.findOne({ id })
        .populate('reporter', 'id username fullName avatar bio interests email phone accountStatus isOnline lastSeen')
        .populate('reportedUser', 'id username fullName avatar bio interests email phone accountStatus isOnline lastSeen reportsCount isBlocked')
        .populate('resolvedBy', 'id username name email role');
    }

    if (!reportDoc) {
      return res.status(404).json({
        success: false,
        error: `Moderation report record not found with ID "${id}".`
      });
    }

    return res.status(200).json({
      success: true,
      report: Report.sanitize(reportDoc)
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: PATCH /api/v1/admin/reports/:id/status
 * Update moderation report status (resolved | dismissed | pending) with resolution actions and moderator notes.
 */
async function updateReportStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status, resolutionAction, notes } = req.body || {};

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Report ID parameter is required.'
      });
    }

    if (!status || typeof status !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing required field "status". Permitted values are "resolved" or "dismissed".'
      });
    }

    const normalizedStatus = status.toLowerCase().trim();
    if (!['resolved', 'dismissed'].includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status "${status}". Permitted values are "resolved" or "dismissed".`
      });
    }

    let reportDoc = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      reportDoc = await Report.findById(id);
    }

    if (!reportDoc) {
      reportDoc = await Report.findOne({ id });
    }

    if (!reportDoc) {
      return res.status(404).json({
        success: false,
        error: `Moderation report record not found with ID "${id}".`
      });
    }

    reportDoc.status = normalizedStatus;
    reportDoc.resolvedAt = new Date().toISOString();

    if (req.admin && req.admin._id) {
      reportDoc.resolvedBy = req.admin._id;
    }

    if (resolutionAction !== undefined) {
      reportDoc.resolutionAction = typeof resolutionAction === 'string' ? resolutionAction.trim() : resolutionAction;
    }

    if (notes !== undefined) {
      reportDoc.notes = typeof notes === 'string' ? notes.trim() : notes;
    }

    await reportDoc.save();

    // Populate for response
    const populated = await Report.findById(reportDoc._id)
      .populate('reporter', 'id username fullName avatar bio interests email phone accountStatus isOnline lastSeen')
      .populate('reportedUser', 'id username fullName avatar bio interests email phone accountStatus isOnline lastSeen reportsCount isBlocked')
      .populate('resolvedBy', 'id username name email role');

    return res.status(200).json({
      success: true,
      message: `Report status successfully updated to "${normalizedStatus}".`,
      report: Report.sanitize(populated)
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getReports,
  getReportById,
  updateReportStatus
};
