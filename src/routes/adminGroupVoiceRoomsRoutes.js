const { Router } = require('../utils/routerUtils');
const {
  getGroupVoiceRooms,
  getGroupVoiceRoomById,
  updateGroupVoiceRoomStatus,
  deleteGroupVoiceRoom
} = require('../controllers/adminGroupVoiceRoomsController');
const { authenticateAdmin } = require('../middleware/authMiddleware');

const router = Router();

// All Admin Group Voice Room endpoints require Admin Authentication
router.use(authenticateAdmin);

// 1. GET /api/v1/admin/group-voice-rooms
router.get('/', getGroupVoiceRooms);

// 2. GET /api/v1/admin/group-voice-rooms/:id
router.get('/:id', getGroupVoiceRoomById);

// 3. PATCH /api/v1/admin/group-voice-rooms/:id/status (Close/Disable room)
router.patch('/:id/status', updateGroupVoiceRoomStatus);

// 4. DELETE /api/v1/admin/group-voice-rooms/:id (Remove record)
router.delete('/:id', deleteGroupVoiceRoom);

module.exports = router;
