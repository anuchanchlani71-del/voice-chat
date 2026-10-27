const { Router } = require('../utils/routerUtils');
const {
  getGroupVoiceRooms,
  getGroupVoiceRoomById,
  createGroupVoiceRoom,
  updateGroupVoiceRoom,
  joinGroupVoiceRoom,
  leaveGroupVoiceRoom,
  closeGroupVoiceRoom,
  inviteUsersToRoom,
  getRoomMembers
} = require('../controllers/userGroupVoiceRoomController');
const { authenticateUser } = require('../middleware/authMiddleware');

const router = Router();

// All user room routes require authentication
router.use(authenticateUser);

// 1. GET /api/v1/rooms - Discover/list rooms
router.get('/', getGroupVoiceRooms);

// 2. GET /api/v1/rooms/room/:id & GET /api/v1/rooms/:id - Get single room
router.get('/room/:id', getGroupVoiceRoomById);

// 3. POST /api/v1/rooms - Create a new room
router.post('/', createGroupVoiceRoom);

// 4. PATCH / PUT /api/v1/rooms/:id - Update room (Host only)
router.patch('/:id', updateGroupVoiceRoom);
router.put('/:id', updateGroupVoiceRoom);

// 5. POST /api/v1/rooms/:id/join - Join room
router.post('/:id/join', joinGroupVoiceRoom);

// 6. POST /api/v1/rooms/:id/leave - Leave room
router.post('/:id/leave', leaveGroupVoiceRoom);

// 7. POST /api/v1/rooms/:id/end & /close - End/close room (Host only)
router.post('/:id/end', closeGroupVoiceRoom);
router.post('/:id/close', closeGroupVoiceRoom);

// 8. POST /api/v1/rooms/:id/invite - Invite users to room (Host only)
router.post('/:id/invite', inviteUsersToRoom);
router.post('/:id/invites', inviteUsersToRoom);

// 9. GET /api/v1/rooms/:id/members & /participants - Room members/participants
router.get('/:id/members', getRoomMembers);
router.get('/:id/participants', getRoomMembers);

// 10. GET /api/v1/rooms/:id - Get single room (MUST BE LAST to avoid matching subpaths)
router.get('/:id', getGroupVoiceRoomById);

module.exports = router;
