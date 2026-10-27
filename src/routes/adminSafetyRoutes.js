const { Router } = require('../utils/routerUtils');
const { getSafetyOverview, getFlaggedUsers } = require('../controllers/adminSafetyController');
const {
  getRepeatOffenders,
  getRepeatOffenderDetail
} = require('../controllers/adminRepeatOffenderController');
const { authenticateAdmin } = require('../middleware/authMiddleware');

const router = Router();

// All Admin Safety routes require Admin Authentication
router.use(authenticateAdmin);

// 1. GET /api/v1/admin/safety/overview
router.get('/overview', getSafetyOverview);

// 2. GET /api/v1/admin/safety/flagged-users
router.get('/flagged-users', getFlaggedUsers);

// 3. GET /api/v1/admin/safety/repeat-offenders
router.get('/repeat-offenders', getRepeatOffenders);

// 4. GET /api/v1/admin/safety/repeat-offenders/:userId
router.get('/repeat-offenders/:userId', getRepeatOffenderDetail);

module.exports = router;
