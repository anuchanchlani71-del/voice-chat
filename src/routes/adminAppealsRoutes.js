const { Router } = require('../utils/routerUtils');
const {
  getAppeals,
  getAppealDetail,
  updateAppealStatus
} = require('../controllers/adminAppealsController');
const { authenticateAdmin } = require('../middleware/authMiddleware');

const router = Router();

// All Admin Appeals routes require Admin Authentication
router.use(authenticateAdmin);

// 1. GET /api/v1/admin/appeals
router.get('/', getAppeals);

// 2. GET /api/v1/admin/appeals/:id
router.get('/:id', getAppealDetail);

// 3. PATCH /api/v1/admin/appeals/:id/status
router.patch('/:id/status', updateAppealStatus);

module.exports = router;
