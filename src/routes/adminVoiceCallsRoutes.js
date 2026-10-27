const { Router } = require('../utils/routerUtils');
const { getVoiceCalls, getVoiceCallById } = require('../controllers/adminVoiceCallsController');
const { authenticateAdmin } = require('../middleware/authMiddleware');

const router = Router();

// All Admin Voice Calls routes require Admin Authentication
router.use(authenticateAdmin);

// 1. GET /api/v1/admin/voice-calls
router.get('/', getVoiceCalls);

// 2. GET /api/v1/admin/voice-calls/:id
router.get('/:id', getVoiceCallById);

module.exports = router;
