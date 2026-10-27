const { Router } = require('../utils/routerUtils');
const { register, login, getMe } = require('../controllers/authController');
const { updateOnboarding, updateProfile } = require('../controllers/userController');
const { authenticateUser } = require('../middleware/authMiddleware');

const router = Router();

// Public routes
router.post('/register', register);
router.post('/login', login);

// Protected routes
router.get('/me', authenticateUser, getMe);
router.patch('/me', authenticateUser, updateProfile);
router.patch('/me/onboarding', authenticateUser, updateOnboarding);
router.patch('/onboarding', authenticateUser, updateOnboarding);

module.exports = router;
