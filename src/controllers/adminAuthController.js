const Admin = require('../models/Admin');
const { signToken } = require('../utils/tokenUtils');
const { hashPassword } = require('../utils/passwordUtils');

/**
 * Controller: POST /api/v1/admin/auth/login
 * Authenticates admin credentials against MongoDB and returns a signed JWT.
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};

    // Input validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Please provide both email and password.'
      });
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid email or password format.'
      });
    }

    // Lookup admin in MongoDB
    const admin = await Admin.findByEmail(email);
    if (!admin) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials. Please check your email and password.'
      });
    }

    // Compare cryptographic password hash
    const isMatch = await Admin.comparePassword(admin, password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials. Please check your email and password.'
      });
    }

    // Generate token
    const token = signToken({
      id: admin.id || (admin._id ? admin._id.toString() : ''),
      email: admin.email,
      role: admin.role
    });

    const sanitizedAdmin = Admin.sanitize(admin);

    return res.status(200).json({
      success: true,
      message: 'Admin authenticated successfully',
      token,
      admin: sanitizedAdmin
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: GET /api/v1/admin/auth/me
 * Returns profile information of the currently authenticated admin.
 */
async function getMe(req, res, next) {
  try {
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    return res.status(200).json({
      success: true,
      admin: req.admin
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: PUT /api/v1/admin/auth/me
 * Updates profile (name, email) of the currently authenticated admin.
 */
async function updateMe(req, res, next) {
  try {
    if (!req.admin || !req.admin.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    const { name, email } = req.body || {};

    if (name === undefined && email === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Please provide at least name or email to update.'
      });
    }

    // Lookup authenticated admin in MongoDB
    const admin = await Admin.findAdminById(req.admin.id);
    if (!admin) {
      return res.status(404).json({
        success: false,
        error: 'Admin account not found.'
      });
    }

    // 1. Validate and update name
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Name must be a non-empty string.'
        });
      }
      admin.name = name.trim();
      // Recalculate initials using project convention
      admin.initials = admin.name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'AD';
    }

    // 2. Validate and update email
    if (email !== undefined) {
      if (typeof email !== 'string' || email.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Email must be a non-empty string.'
        });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(normalizedEmail)) {
        return res.status(400).json({
          success: false,
          error: 'Please provide a valid email address.'
        });
      }

      // Check for duplicate email across other admins
      if (normalizedEmail !== admin.email) {
        const existing = await Admin.findByEmail(normalizedEmail);
        if (existing && (existing.id !== admin.id && existing._id?.toString() !== admin._id?.toString())) {
          return res.status(409).json({
            success: false,
            error: 'An admin with this email address already exists.'
          });
        }
        admin.email = normalizedEmail;
      }
    }

    // Protected fields (role, passwordHash, salt, id) are intentionally untouched
    await admin.save();

    const sanitizedAdmin = Admin.sanitize(admin);

    return res.status(200).json({
      success: true,
      message: 'Admin profile updated successfully',
      admin: sanitizedAdmin
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: PUT /api/v1/admin/auth/change-password
 * Safely changes the password for the currently authenticated admin.
 */
async function changePassword(req, res, next) {
  try {
    if (!req.admin || !req.admin.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Please provide both current password and new password.'
      });
    }

    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid password format.'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 6 characters long.'
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        error: 'New password must be different from current password.'
      });
    }

    // Lookup authenticated admin in MongoDB
    const admin = await Admin.findAdminById(req.admin.id);
    if (!admin) {
      return res.status(404).json({
        success: false,
        error: 'Admin account not found.'
      });
    }

    // Verify current password against cryptographic hash in database
    const isMatch = await Admin.comparePassword(admin, currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        error: 'Current password is incorrect.'
      });
    }

    // Hash the new password securely
    const { salt, hash } = await hashPassword(newPassword);
    admin.passwordHash = hash;
    admin.salt = salt;

    await admin.save();

    return res.status(200).json({
      success: true,
      message: 'Password updated successfully.'
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  login,
  getMe,
  updateMe,
  changePassword
};
