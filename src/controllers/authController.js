const User = require('../models/User');
const { hashPassword, verifyPassword } = require('../utils/passwordUtils');
const { signToken } = require('../utils/tokenUtils');

/**
 * Controller: POST /api/v1/auth/register
 * Creates a new user account, hashes password securely, and returns a signed JWT.
 */
async function register(req, res, next) {
  try {
    const { fullName, username, email, password } = req.body || {};

    // 1. Validate presence of required fields
    if (!fullName || !username || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Please provide fullName, username, email, and password.'
      });
    }

    if (
      typeof fullName !== 'string' ||
      typeof username !== 'string' ||
      typeof email !== 'string' ||
      typeof password !== 'string'
    ) {
      return res.status(400).json({
        success: false,
        error: 'All fields must be valid strings.'
      });
    }

    const trimmedFullName = fullName.trim();
    const trimmedUsername = username.trim().toLowerCase();
    const trimmedEmail = email.trim().toLowerCase();

    // 2. Validate field lengths and formats
    if (trimmedFullName.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Full name is required.'
      });
    }

    // Username: 3-25 alphanumeric and underscore characters
    const usernameRegex = /^[a-zA-Z0-9_]{3,25}$/;
    if (!usernameRegex.test(trimmedUsername)) {
      return res.status(400).json({
        success: false,
        error: 'Username must be between 3 and 25 characters and contain only letters, numbers, and underscores.'
      });
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid email address.'
      });
    }

    // Password length validation
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long.'
      });
    }

    // 3. Check for existing username or email duplicates
    const existingUsername = await User.findOne({ username: trimmedUsername });
    if (existingUsername) {
      return res.status(409).json({
        success: false,
        error: 'Username is already taken. Please choose another username.'
      });
    }

    const existingEmail = await User.findOne({ email: trimmedEmail });
    if (existingEmail) {
      return res.status(409).json({
        success: false,
        error: 'Email is already registered. Please log in or use another email.'
      });
    }

    // 4. Secure cryptographic password hashing (PBKDF2 SHA-512)
    const { salt, hash } = await hashPassword(password);

    // 5. Generate unique custom user ID
    const customId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // 6. Persist user document in MongoDB
    const newUser = await User.create({
      id: customId,
      username: trimmedUsername,
      fullName: trimmedFullName,
      email: trimmedEmail,
      passwordHash: hash,
      salt: salt,
      isOnboarded: false,
      accountStatus: 'active',
      isBlocked: false,
      joinedDate: new Date().toISOString().split('T')[0]
    });

    // 7. Generate RFC 7519 compliant JWT
    const token = signToken({
      id: newUser.id,
      username: newUser.username,
      role: 'user'
    });

    const sanitizedUser = User.sanitize(newUser);

    return res.status(201).json({
      success: true,
      token,
      user: sanitizedUser
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: POST /api/v1/auth/login
 * Authenticates user credentials (by email or username) and returns a signed JWT.
 */
async function login(req, res, next) {
  try {
    const { identifier, password } = req.body || {};

    // 1. Validate presence of credentials
    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        error: 'Please provide both email/username and password.'
      });
    }

    if (typeof identifier !== 'string' || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid identifier or password format.'
      });
    }

    const normalizedIdentifier = identifier.trim().toLowerCase();

    // 2. Query user by username or email, including passwordHash and salt
    const user = await User.findOne({
      $or: [
        { username: normalizedIdentifier },
        { email: normalizedIdentifier }
      ]
    }).select('+passwordHash +salt');

    // Generic error to avoid account enumeration
    if (!user || !user.passwordHash || !user.salt) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials. Please check your username/email and password.'
      });
    }

    // 3. Verify password hash using timing-safe PBKDF2 comparison
    const isMatch = await verifyPassword(password, user.salt, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials. Please check your username/email and password.'
      });
    }

    // 4. Check account status (suspended or blocked)
    if (user.accountStatus === 'suspended') {
      return res.status(403).json({
        success: false,
        error: 'Your account has been suspended due to community guideline violations.'
      });
    }

    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        error: 'Your account has been blocked.'
      });
    }

    // 5. Generate signed JWT token
    const token = signToken({
      id: user.id,
      username: user.username,
      role: 'user'
    });

    const sanitizedUser = User.sanitize(user);

    return res.status(200).json({
      success: true,
      token,
      user: sanitizedUser
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Controller: GET /api/v1/auth/me
 * Returns profile information of the currently authenticated user.
 */
async function getMe(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Authentication required.'
      });
    }

    return res.status(200).json({
      success: true,
      user: req.user
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  register,
  login,
  getMe
};
