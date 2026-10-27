const { Router } = require('../utils/routerUtils');
const { getDashboardStats, getDashboardCharts } = require('../controllers/adminDashboardController');
const { authenticateAdmin } = require('../middleware/authMiddleware');

const router = Router();

// All Admin Dashboard routes require Admin Authentication
router.use(authenticateAdmin);

// 1. GET /api/v1/admin/dashboard/stats
router.get('/stats', getDashboardStats);

// 2. GET /api/v1/admin/dashboard/charts
router.get('/charts', getDashboardCharts);

module.exports = router;
