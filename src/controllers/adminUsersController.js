const User = require('../models/User');

/**
 * Controller: GET /api/v1/admin/users
 * Retrieve paginated user accounts with search and filtering for the Admin Panel.
 */
async function getUsers(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { search, online, isOnline, status, accountStatus, interest } = req.query || {};

    const filter = {};

    // 1. Search filter (username, fullName, bio)
    if (search && typeof search === 'string' && search.trim()) {
      const term = search.trim();
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [
        { username: regex },
        { fullName: regex },
        { bio: regex }
      ];
    }

    // 2. Online presence filter
    const onlineParam = (isOnline !== undefined ? isOnline : online);
    if (onlineParam && onlineParam !== 'all') {
      const normOnline = String(onlineParam).toLowerCase();
      if (normOnline === 'online' || normOnline === 'true') {
        filter.isOnline = true;
      } else if (normOnline === 'offline' || normOnline === 'false') {
        filter.isOnline = false;
      }
    }

    // 3. Account status filter
    const statusParam = (accountStatus !== undefined ? accountStatus : status);
    if (statusParam && statusParam !== 'all') {
      const normStatus = String(statusParam).toLowerCase().trim();
      if (['active', 'suspended'].includes(normStatus)) {
        filter.accountStatus = normStatus;
      }
    }

    // 4. Interest filter
    if (interest && typeof interest === 'string' && interest !== 'all') {
      filter.interests = interest.trim();
    }

    // Execute queries in parallel
    const [rawUsers, totalItems] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter)
    ]);

    const users = rawUsers.map((u) => User.sanitize(u));
    const totalPages = Math.ceil(totalItems / limit) || 1;

    return res.status(200).json({
      success: true,
      users,
      pagination: {
        currentPage: page,
        pageSize: limit,
        totalItems,
        totalPages
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: GET /api/v1/admin/users/:id
 * Retrieve full details of a specific user for the Admin Details Modal.
 */
async function getUserById(req, res, next) {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'User ID parameter is required.'
      });
    }

    const user = await User.findUserByIdOrIdentifier(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: `User not found with ID or username "${id}".`
      });
    }

    return res.status(200).json({
      success: true,
      user: User.sanitize(user)
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: PATCH /api/v1/admin/users/:id/status
 * Update user account status (active | suspended).
 */
async function updateUserStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { accountStatus, status } = req.body || {};

    const rawStatus = accountStatus || status;

    if (!rawStatus || typeof rawStatus !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing required field "accountStatus". Must be "active" or "suspended".'
      });
    }

    const normalizedStatus = rawStatus.toLowerCase().trim();

    if (!['active', 'suspended'].includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        error: `Invalid accountStatus "${rawStatus}". Permitted values are "active" or "suspended".`
      });
    }

    const user = await User.findUserByIdOrIdentifier(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: `User not found with ID or username "${id}".`
      });
    }

    user.accountStatus = normalizedStatus;
    await user.save();

    return res.status(200).json({
      success: true,
      message: `User account status successfully updated to "${normalizedStatus}".`,
      user: User.sanitize(user)
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getUsers,
  getUserById,
  updateUserStatus
};
