const { Router } = require('../utils/routerUtils');
const { getUsers, getUserById, updateUserStatus } = require('../controllers/adminUsersController');
const { authenticateAdmin } = require('../middleware/authMiddleware');

const router = Router();

// All Admin Users routes require Admin Authentication
router.use(authenticateAdmin);

// 1. GET /api/v1/admin/users
router.get('/', getUsers);

// 2. GET /api/v1/admin/users/:id
router.get('/:id', getUserById);

// 3. PATCH /api/v1/admin/users/:id/status
router.patch('/:id/status', updateUserStatus);

module.exports = router;
