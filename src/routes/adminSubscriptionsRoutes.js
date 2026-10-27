const { Router } = require('../utils/routerUtils');
const {
  listSubscriptions,
  getSubscription,
  createSubscription,
  updateSubscription,
  updateSubscriptionStatus,
  deleteSubscription
} = require('../controllers/adminSubscriptionsController');
const { authenticateAdmin } = require('../middleware/authMiddleware');

const router = Router();

// All Admin Subscriptions routes require Admin Authentication
router.use(authenticateAdmin);

// 1. GET /api/v1/admin/subscriptions
router.get('/', listSubscriptions);

// 2. GET /api/v1/admin/subscriptions/:id
router.get('/:id', getSubscription);

// 3. POST /api/v1/admin/subscriptions
router.post('/', createSubscription);

// 4. PUT /api/v1/admin/subscriptions/:id
router.put('/:id', updateSubscription);

// 5. PATCH /api/v1/admin/subscriptions/:id/status
router.patch('/:id/status', updateSubscriptionStatus);

// 6. DELETE /api/v1/admin/subscriptions/:id
router.delete('/:id', deleteSubscription);

module.exports = router;
