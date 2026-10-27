const { Router } = require('../utils/routerUtils');
const { getFriendRequests, getFriendRequestById } = require('../controllers/adminFriendRequestsController');
const { authenticateAdmin } = require('../middleware/authMiddleware');

const router = Router();

// All Admin Friend Requests routes require Admin Authentication
router.use(authenticateAdmin);

// 1. GET /api/v1/admin/friend-requests
router.get('/', getFriendRequests);

// 2. GET /api/v1/admin/friend-requests/:id
router.get('/:id', getFriendRequestById);

module.exports = router;
