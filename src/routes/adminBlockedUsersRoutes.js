const { Router } = require('../utils/routerUtils');
const { getBlockedUsers, getBlockedUserById } = require('../controllers/adminBlockedUsersController');
const { authenticateAdmin } = require('../middleware/authMiddleware');

const router = Router();

// All Admin Blocked Users routes require Admin Authentication
router.use(authenticateAdmin);

// 1. GET /api/v1/admin/blocked-users
router.get('/', getBlockedUsers);

// 2. GET /api/v1/admin/blocked-users/:id
router.get('/:id', getBlockedUserById);

module.exports = router;
