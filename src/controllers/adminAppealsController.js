const mongoose = require('mongoose');
const Appeal = require('../models/Appeal');
const User = require('../models/User');
const Report = require('../models/Report');

/**
 * Controller: GET /api/v1/admin/appeals
 * Retrieve paginated user appeals against account restrictions with search and filtering.
 */
async function getAppeals(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { search, status, actionType } = req.query || {};

    const filter = {};

    // 1. Status filter (pending, under_review, approved, rejected)
    if (status && status !== 'all') {
      const normStatus = String(status).toLowerCase().trim();
      const validStatuses = ['pending', 'under_review', 'approved', 'rejected'];
      if (validStatuses.includes(normStatus)) {
        filter.status = normStatus;
      }
    }

    // 2. Action Type filter (suspended, blocked, restricted)
    if (actionType && actionType !== 'all') {
      const normAction = String(actionType).toLowerCase().trim();
      const validActions = ['suspended', 'blocked', 'restricted'];
      if (validActions.includes(normAction)) {
        filter.actionType = normAction;
      }
    }

    // 3. Search filter (by username, fullName, user ID, appeal ID, or reason)
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
        { user: { $in: userMongoIds } },
        { id: regex },
        { originalReason: regex },
        { appealMessage: regex }
      ];
    }

    // Parallel fetch: Filtered records + Total count
    const [rawAppeals, totalItems] = await Promise.all([
      Appeal.find(filter)
        .populate('user', 'id username fullName avatar accountStatus isBlocked reportsCount joinedDate')
        .populate('reviewedBy', 'id username name email role'),
      Appeal.countDocuments(filter)
    ]);

    // Recommended ordering: pending first, then under_review, then approved/rejected, with newest first
    const statusWeights = { pending: 1, under_review: 2, approved: 3, rejected: 4 };
    rawAppeals.sort((a, b) => {
      const weightA = statusWeights[a.status] || 5;
      const weightB = statusWeights[b.status] || 5;
      if (weightA !== weightB) return weightA - weightB;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    const paginatedSlice = rawAppeals.slice(skip, skip + limit);
    const appeals = paginatedSlice.map((a) => Appeal.sanitize(a));
    const totalPages = Math.ceil(totalItems / limit) || (totalItems === 0 ? 0 : 1);

    return res.status(200).json({
      success: true,
      data: appeals,
      appeals,
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
 * Controller: GET /api/v1/admin/appeals/:id
 * Retrieve complete appeal record with user profile, moderation context, and related reports.
 */
async function getAppealDetail(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Appeal ID parameter is required.'
      });
    }

    let appealDoc = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      appealDoc = await Appeal.findById(id)
        .populate('user', 'id username fullName avatar accountStatus isBlocked reportsCount joinedDate bio')
        .populate('reviewedBy', 'id username name email role');
    }

    if (!appealDoc) {
      appealDoc = await Appeal.findOne({ id })
        .populate('user', 'id username fullName avatar accountStatus isBlocked reportsCount joinedDate bio')
        .populate('reviewedBy', 'id username name email role');
    }

    if (!appealDoc) {
      return res.status(404).json({
        success: false,
        error: `Appeal request not found with ID "${id}".`
      });
    }

    // Fetch related reports safely for moderation context
    let relatedReports = [];
    if (appealDoc.user && appealDoc.user._id) {
      const rawReports = await Report.find({ reportedUser: appealDoc.user._id })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('id reasonCategory description severity status createdAt date resolvedAt resolutionAction');

      relatedReports = rawReports.map((r) => ({
        id: r.id || r._id.toString(),
        reasonCategory: r.reasonCategory,
        description: r.description,
        severity: r.severity,
        status: r.status,
        date: r.date || (r.createdAt ? new Date(r.createdAt).toISOString().replace('T', ' ').substring(0, 16) : null),
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt,
        resolutionAction: r.resolutionAction
      }));
    }

    const sanitized = Appeal.sanitize(appealDoc);
    const detailData = {
      ...sanitized,
      relatedReports,
      relatedReportCount: typeof appealDoc.relatedReportCount === 'number' && appealDoc.relatedReportCount > 0
        ? appealDoc.relatedReportCount
        : relatedReports.length
    };

    return res.status(200).json({
      success: true,
      data: detailData,
      appeal: detailData
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: PATCH /api/v1/admin/appeals/:id/status
 * Update the review status of an appeal (pending, under_review, approved, rejected) and add admin notes.
 * NOTE: This updates ONLY the Appeal document. It does NOT automatically mutate User or Report records.
 */
async function updateAppealStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body || {};

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Appeal ID parameter is required.'
      });
    }

    if (!status || typeof status !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Status is required. Allowed values are "pending", "under_review", "approved", or "rejected".'
      });
    }

    const normStatus = status.toLowerCase().trim();
    const validStatuses = ['pending', 'under_review', 'approved', 'rejected'];
    if (!validStatuses.includes(normStatus)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status "${status}". Allowed values are "pending", "under_review", "approved", or "rejected".`
      });
    }

    let appealDoc = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      appealDoc = await Appeal.findById(id);
    }

    if (!appealDoc) {
      appealDoc = await Appeal.findOne({ id });
    }

    if (!appealDoc) {
      return res.status(404).json({
        success: false,
        error: `Appeal request not found with ID "${id}".`
      });
    }

    // Update appeal status and metadata
    appealDoc.status = normStatus;

    if (adminNotes !== undefined) {
      appealDoc.adminNotes = typeof adminNotes === 'string' ? adminNotes.trim() : adminNotes;
    }

    if (['approved', 'rejected', 'under_review'].includes(normStatus)) {
      appealDoc.reviewedAt = new Date().toISOString();
      if (req.admin && req.admin._id) {
        appealDoc.reviewedBy = req.admin._id;
      }
    }

    await appealDoc.save();

    // Populate for response
    const populated = await Appeal.findById(appealDoc._id)
      .populate('user', 'id username fullName avatar accountStatus isBlocked reportsCount joinedDate')
      .populate('reviewedBy', 'id username name email role');

    const sanitized = Appeal.sanitize(populated);

    return res.status(200).json({
      success: true,
      message: `Appeal status successfully updated to "${normStatus}".`,
      data: sanitized,
      appeal: sanitized
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAppeals,
  getAppealDetail,
  updateAppealStatus
};
