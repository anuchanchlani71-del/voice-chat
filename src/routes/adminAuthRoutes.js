const { Router } = require('../utils/routerUtils');
const { login, getMe, updateMe, changePassword } = require('../controllers/adminAuthController');
const { authenticateAdmin } = require('../middleware/authMiddleware');

const router = Router();

// Public route: Admin login
router.post('/login', login);

// Protected routes: Current admin profile & security
router.get('/me', authenticateAdmin, getMe);
router.put('/me', authenticateAdmin, updateMe);
router.put('/change-password', authenticateAdmin, changePassword);

module.exports = router;
