const mongoose = require('mongoose');
const VoiceCall = require('../models/VoiceCall');
const User = require('../models/User');

/**
 * Controller: GET /api/v1/admin/voice-calls
 * Retrieve paginated 1-to-1 voice calls for the Admin Panel with search, status filtering, and date range support.
 */
async function getVoiceCalls(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { search, status, startDate, endDate, from, to } = req.query || {};

    const filter = {};

    // 1. Status Filter
    if (status && status !== 'all') {
      const normStatus = String(status).toLowerCase().trim();
      const validStatuses = ['completed', 'missed', 'declined', 'failed', 'ongoing', 'ringing'];
      if (validStatuses.includes(normStatus)) {
        filter.status = normStatus;
      }
    }

    // 2. Search by caller/receiver username, fullName, user ID, or call ID
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
        { caller: { $in: userMongoIds } },
        { receiver: { $in: userMongoIds } },
        { id: regex }
      ];
    }

    // 3. Date / Time Range Filtering (supports startDate/endDate or from/to)
    const dateStart = startDate || from;
    const dateEnd = endDate || to;
    if (dateStart || dateEnd) {
      filter.createdAt = {};
      if (dateStart && !isNaN(new Date(dateStart).getTime())) {
        filter.createdAt.$gte = new Date(dateStart);
      }
      if (dateEnd && !isNaN(new Date(dateEnd).getTime())) {
        const endD = new Date(dateEnd);
        // If date-only string provided (e.g. YYYY-MM-DD), set to end of day
        if (dateEnd.length <= 10) {
          endD.setHours(23, 59, 59, 999);
        }
        filter.createdAt.$lte = endD;
      }
      if (Object.keys(filter.createdAt).length === 0) {
        delete filter.createdAt;
      }
    }

    // Parallel fetch: Filtered list + Status counts
    const [
      rawCalls,
      totalFiltered,
      totalAll,
      totalCompleted,
      totalMissed,
      totalDeclined,
      totalFailed
    ] = await Promise.all([
      VoiceCall.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('caller', 'id username fullName avatar accountStatus isOnline')
        .populate('receiver', 'id username fullName avatar accountStatus isOnline'),
      VoiceCall.countDocuments(filter),
      VoiceCall.countDocuments({}),
      VoiceCall.countDocuments({ status: 'completed' }),
      VoiceCall.countDocuments({ status: 'missed' }),
      VoiceCall.countDocuments({ status: 'declined' }),
      VoiceCall.countDocuments({ status: 'failed' })
    ]);

    const voiceCalls = rawCalls.map((c) => VoiceCall.sanitize(c));
    const totalPages = Math.ceil(totalFiltered / limit) || 1;

    return res.status(200).json({
      success: true,
      voiceCalls,
      counts: {
        all: totalAll,
        completed: totalCompleted,
        missed: totalMissed,
        declined: totalDeclined,
        failed: totalFailed
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
 * Controller: GET /api/v1/admin/voice-calls/:id
 * Retrieve full details and telemetry of a specific 1-to-1 voice call.
 */
async function getVoiceCallById(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Voice call ID parameter is required.'
      });
    }

    let callDoc = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      callDoc = await VoiceCall.findById(id)
        .populate('caller', 'id username fullName avatar bio interests email phone accountStatus isOnline lastSeen')
        .populate('receiver', 'id username fullName avatar bio interests email phone accountStatus isOnline lastSeen');
    }

    if (!callDoc) {
      callDoc = await VoiceCall.findOne({ id })
        .populate('caller', 'id username fullName avatar bio interests email phone accountStatus isOnline lastSeen')
        .populate('receiver', 'id username fullName avatar bio interests email phone accountStatus isOnline lastSeen');
    }

    if (!callDoc) {
      return res.status(404).json({
        success: false,
        error: `Voice call record not found with ID "${id}".`
      });
    }

    return res.status(200).json({
      success: true,
      voiceCall: VoiceCall.sanitize(callDoc)
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getVoiceCalls,
  getVoiceCallById
};
