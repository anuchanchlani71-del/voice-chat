const { Router } = require('../utils/routerUtils');
const {
  listPlans,
  getPlan,
  createPlan,
  updatePlan,
  updatePlanStatus,
  deletePlan
} = require('../controllers/adminPlansController');
const { authenticateAdmin } = require('../middleware/authMiddleware');

const router = Router();

// All Admin Plans routes require Admin Authentication
router.use(authenticateAdmin);

// 1. GET /api/v1/admin/plans
router.get('/', listPlans);

// 2. GET /api/v1/admin/plans/:id
router.get('/:id', getPlan);

// 3. POST /api/v1/admin/plans
router.post('/', createPlan);

// 4. PUT /api/v1/admin/plans/:id
router.put('/:id', updatePlan);

// 5. PATCH /api/v1/admin/plans/:id/status
router.patch('/:id/status', updatePlanStatus);

// 6. DELETE /api/v1/admin/plans/:id
router.delete('/:id', deletePlan);

module.exports = router;
