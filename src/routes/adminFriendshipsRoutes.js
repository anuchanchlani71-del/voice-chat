const { Router } = require('../utils/routerUtils');
const { getFriendships, getFriendshipById } = require('../controllers/adminFriendshipsController');
const { authenticateAdmin } = require('../middleware/authMiddleware');

const router = Router();

// All Admin Friendships routes require Admin Authentication
router.use(authenticateAdmin);

// 1. GET /api/v1/admin/friendships
router.get('/', getFriendships);

// 2. GET /api/v1/admin/friendships/:id
router.get('/:id', getFriendshipById);

module.exports = router;
