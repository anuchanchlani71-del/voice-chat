const { verifyToken } = require('../utils/tokenUtils');
const Admin = require('../models/Admin');
const User = require('../models/User');

/**
 * Admin JWT Authentication Middleware
 * Protects admin routes by verifying Bearer JWT tokens against MongoDB.
 */
async function authenticateAdmin(req, res, next) {
  try {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];

    if (!authHeader || typeof authHeader !== 'string') {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. No Authorization header provided.'
      });
    }

    const parts = authHeader.trim().split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
      return res.status(401).json({
        success: false,
        error: 'Invalid authorization format. Format must be "Bearer <token>".'
      });
    }

    const token = parts[1];
    const result = verifyToken(token);

    if (!result.valid) {
      if (result.expired) {
        return res.status(401).json({
          success: false,
          error: 'Admin session has expired. Please log in again.'
        });
      }
      return res.status(401).json({
        success: false,
        error: 'Invalid or tampered authentication token.'
      });
    }

    const admin = await Admin.findAdminById(result.payload.id);
    if (!admin) {
      return res.status(401).json({
        success: false,
        error: 'Admin account not found or access has been revoked.'
      });
    }

    // Attach sanitized admin object to request
    req.admin = Admin.sanitize(admin);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * User JWT Authentication Middleware
 * Protects user-side routes by verifying Bearer JWT tokens against MongoDB.
 */
async function authenticateUser(req, res, next) {
  try {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];

    if (!authHeader || typeof authHeader !== 'string') {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. No Authorization header provided.'
      });
    }

    const parts = authHeader.trim().split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
      return res.status(401).json({
        success: false,
        error: 'Invalid authorization format. Format must be "Bearer <token>".'
      });
    }

    const token = parts[1];
    const result = verifyToken(token);

    if (!result.valid) {
      if (result.expired) {
        return res.status(401).json({
          success: false,
          error: 'User session has expired. Please log in again.'
        });
      }
      return res.status(401).json({
        success: false,
        error: 'Invalid or tampered authentication token.'
      });
    }

    if (!result.payload || !result.payload.id) {
      return res.status(401).json({
        success: false,
        error: 'Invalid authentication token payload.'
      });
    }

    const user = await User.findUserByIdOrIdentifier(result.payload.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User account not found or access has been revoked.'
      });
    }

    if (user.accountStatus === 'suspended') {
      return res.status(403).json({
        success: false,
        error: 'Account has been suspended due to community guideline violations.'
      });
    }

    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        error: 'Account has been blocked.'
      });
    }

    // Attach sanitized user object to request
    req.user = User.sanitize(user);
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  authenticateAdmin,
  authenticateUser
};
