const { Router } = require('../utils/routerUtils');
const { getSettings, updateSettings } = require('../controllers/adminSettingsController');
const { authenticateAdmin } = require('../middleware/authMiddleware');

const router = Router();

// All Admin Settings routes require Admin Authentication
router.use(authenticateAdmin);

// 1. GET /api/v1/admin/settings
router.get('/', getSettings);

// 2. PUT /api/v1/admin/settings
router.put('/', updateSettings);

module.exports = router;
