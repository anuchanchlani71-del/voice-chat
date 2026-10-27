const { Router } = require('../utils/routerUtils');
const {
  listIcebreakerPrompts,
  getIcebreakerPrompt,
  createIcebreakerPrompt,
  updateIcebreakerPrompt,
  updateIcebreakerPromptStatus,
  deleteIcebreakerPrompt
} = require('../controllers/adminIcebreakerPromptsController');
const { authenticateAdmin } = require('../middleware/authMiddleware');

const router = Router();

// All Admin Icebreaker Prompts routes require Admin Authentication
router.use(authenticateAdmin);

// 1. GET /api/v1/admin/icebreaker-prompts
router.get('/', listIcebreakerPrompts);

// 2. POST /api/v1/admin/icebreaker-prompts
router.post('/', createIcebreakerPrompt);

// 3. GET /api/v1/admin/icebreaker-prompts/:id
router.get('/:id', getIcebreakerPrompt);

// 4. PUT /api/v1/admin/icebreaker-prompts/:id
router.put('/:id', updateIcebreakerPrompt);

// 5. PATCH /api/v1/admin/icebreaker-prompts/:id/status
router.patch('/:id/status', updateIcebreakerPromptStatus);

// 6. DELETE /api/v1/admin/icebreaker-prompts/:id
router.delete('/:id', deleteIcebreakerPrompt);

module.exports = router;
