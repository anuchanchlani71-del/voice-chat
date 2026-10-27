const { Router } = require('../utils/routerUtils');
const {
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification
} = require('../controllers/userNotificationController');
const { authenticateUser } = require('../middleware/authMiddleware');

const router = Router();

// All user notification routes require authentication
router.use(authenticateUser);

// 1. GET /api/v1/notifications - Get authenticated user's notifications
router.get('/', getUserNotifications);

// 2. POST /api/v1/notifications/read-all - Mark all notifications for user as read (MUST come before /:id)
router.post('/read-all', markAllNotificationsAsRead);

// 3. PATCH / PUT /api/v1/notifications/:id/read - Mark single notification as read
router.patch('/:id/read', markNotificationAsRead);
router.put('/:id/read', markNotificationAsRead);

// 4. DELETE /api/v1/notifications/:id - Delete single notification
router.delete('/:id', deleteNotification);

module.exports = router;
