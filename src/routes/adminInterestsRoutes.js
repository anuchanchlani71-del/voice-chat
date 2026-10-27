const { Router } = require('../utils/routerUtils');
const {
  getInterests,
  createInterest,
  updateInterest,
  deleteInterest
} = require('../controllers/adminInterestsController');
const { authenticateAdmin } = require('../middleware/authMiddleware');

const router = Router();

// All Admin Interests routes require Admin Authentication
router.use(authenticateAdmin);

// 1. GET /api/v1/admin/interests
router.get('/', getInterests);

// 2. POST /api/v1/admin/interests
router.post('/', createInterest);

// 3. PUT /api/v1/admin/interests/:id
router.put('/:id', updateInterest);

// 4. DELETE /api/v1/admin/interests/:id
router.delete('/:id', deleteInterest);

module.exports = router;
