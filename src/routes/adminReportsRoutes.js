const { Router } = require('../utils/routerUtils');
const { getReports, getReportById, updateReportStatus } = require('../controllers/adminReportsController');
const { authenticateAdmin } = require('../middleware/authMiddleware');

const router = Router();

// All Admin Reports routes require Admin Authentication
router.use(authenticateAdmin);

// 1. GET /api/v1/admin/reports
router.get('/', getReports);

// 2. GET /api/v1/admin/reports/:id
router.get('/:id', getReportById);

// 3. PATCH /api/v1/admin/reports/:id/status
router.patch('/:id/status', updateReportStatus);

module.exports = router;
