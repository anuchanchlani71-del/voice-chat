const User = require('../models/User');
const Friendship = require('../models/Friendship');
const FriendRequest = require('../models/FriendRequest');
const VoiceCall = require('../models/VoiceCall');
const Report = require('../models/Report');
const Block = require('../models/Block');
const Interest = require('../models/Interest');

/**
 * Helper to format duration in seconds to "Xm Ys" (e.g. "13m 20s", "0m 0s")
 */
function formatAverageDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds) || 0);
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}m ${secs}s`;
}

/**
 * Controller: GET /api/v1/admin/dashboard/stats
 * Retrieve comprehensive DB-backed KPI metrics for the Admin Dashboard.
 */
async function getDashboardStats(req, res, next) {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const [
      totalUsers,
      onlineUsers,
      activeFriendships,
      pendingFriendRequests,
      voiceCallsToday,
      todayCallsAgg,
      allCallsAgg,
      totalReports,
      pendingReports,
      blockedUsers,
      totalInterests
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ isOnline: true }),
      Friendship.countDocuments({ status: 'accepted' }),
      FriendRequest.countDocuments({ status: 'pending' }),
      VoiceCall.countDocuments({ createdAt: { $gte: startOfDay, $lte: endOfDay } }),
      VoiceCall.aggregate([
        {
          $match: {
            createdAt: { $gte: startOfDay, $lte: endOfDay }
          }
        },
        {
          $group: {
            _id: null,
            totalSeconds: { $sum: '$durationSeconds' }
          }
        }
      ]),
      VoiceCall.aggregate([
        {
          $group: {
            _id: null,
            avgSeconds: { $avg: '$durationSeconds' },
            totalCalls: { $sum: 1 }
          }
        }
      ]),
      Report.countDocuments({}),
      Report.countDocuments({ status: 'pending' }),
      Block.countDocuments({ status: 'active' }),
      Interest.countDocuments({})
    ]);

    const todaySeconds = todayCallsAgg.length > 0 ? (todayCallsAgg[0].totalSeconds || 0) : 0;
    const voiceMinutesToday = Math.round(todaySeconds / 60);

    const avgSeconds = allCallsAgg.length > 0 ? (allCallsAgg[0].avgSeconds || 0) : 0;
    const averageCallDuration = formatAverageDuration(avgSeconds);

    return res.status(200).json({
      success: true,
      stats: {
        totalUsers,
        onlineUsers,
        activeFriendships,
        pendingFriendRequests,
        voiceCallsToday,
        voiceMinutesToday,
        averageCallDuration,
        totalReports,
        pendingReports,
        blockedUsers,
        totalInterests
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: GET /api/v1/admin/dashboard/charts
 * Retrieve 24-hour call volume distribution, peak hour, and total voice minutes streamed today.
 */
async function getDashboardCharts(req, res, next) {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // Initialize 24 hourly buckets: "00:00" to "23:00"
    const callVolume = Array.from({ length: 24 }, (_, i) => {
      const h = String(i).padStart(2, '0');
      return { hour: `${h}:00`, calls: 0 };
    });

    const callsToday = await VoiceCall.find({
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    }).select('createdAt durationSeconds');

    let totalSecondsToday = 0;

    for (const call of callsToday) {
      const callDate = new Date(call.createdAt);
      const hour = callDate.getHours();
      if (hour >= 0 && hour < 24) {
        callVolume[hour].calls += 1;
      }
      totalSecondsToday += (call.durationSeconds || 0);
    }

    const totalVoiceMinutes = Math.round(totalSecondsToday / 60);

    // Identify peak hour (hour with maximum call volume)
    let peakHour = '00:00';
    let maxCalls = 0;
    for (const item of callVolume) {
      if (item.calls > maxCalls) {
        maxCalls = item.calls;
        peakHour = item.hour;
      }
    }

    return res.status(200).json({
      success: true,
      chart: {
        callVolume,
        peakHour,
        totalVoiceMinutes
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getDashboardStats,
  getDashboardCharts
};
