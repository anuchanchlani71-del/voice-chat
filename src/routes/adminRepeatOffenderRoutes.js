const { Router } = require('../utils/routerUtils');
const {
  getRepeatOffenders,
  getRepeatOffenderDetail
} = require('../controllers/adminRepeatOffenderController');
const { authenticateAdmin } = require('../middleware/authMiddleware');

const router = Router();

// All Admin Repeat Offender routes require Admin Authentication
router.use(authenticateAdmin);

// 1. GET /api/v1/admin/safety/repeat-offenders
router.get('/', getRepeatOffenders);

// 2. GET /api/v1/admin/safety/repeat-offenders/:userId
router.get('/:userId', getRepeatOffenderDetail);

module.exports = router;
