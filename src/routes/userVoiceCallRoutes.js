const { Router } = require('../utils/routerUtils');
const {
  initiateCall,
  getCallHistory,
  getCallById,
  updateCallStatus
} = require('../controllers/userVoiceCallController');
const { authenticateUser } = require('../middleware/authMiddleware');

const router = Router();

// All user call routes require authentication
router.use(authenticateUser);

// 1. POST /api/v1/calls - Initiate a 1-to-1 voice call
router.post('/', initiateCall);

// 2. GET /api/v1/calls/history - Get authenticated user's call history
router.get('/history', getCallHistory);

// 3. PATCH / PUT /api/v1/calls/:id - Update call status (completed, declined, missed, failed, ongoing, ringing)
router.patch('/:id', updateCallStatus);
router.put('/:id', updateCallStatus);

// 4. GET /api/v1/calls/:id - Get call details (caller or receiver only)
router.get('/:id', getCallById);

module.exports = router;
