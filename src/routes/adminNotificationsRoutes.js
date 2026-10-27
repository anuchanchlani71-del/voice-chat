const { Router } = require('../utils/routerUtils');
const { getNotifications, getNotificationById } = require('../controllers/adminNotificationsController');
const { authenticateAdmin } = require('../middleware/authMiddleware');

const router = Router();

// All Admin Notifications routes require Admin Authentication
router.use(authenticateAdmin);

// 1. GET /api/v1/admin/notifications
router.get('/', getNotifications);

// 2. GET /api/v1/admin/notifications/:id
router.get('/:id', getNotificationById);

module.exports = router;
