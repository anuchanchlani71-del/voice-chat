const { Router } = require('../utils/routerUtils');
const {
  sendFriendRequest,
  getFriendRequests,
  acceptFriendRequest,
  rejectFriendRequest,
  cancelFriendRequest,
  getFriends,
  removeFriend,
  getFriendshipStatus
} = require('../controllers/friendController');
const { authenticateUser } = require('../middleware/authMiddleware');

const router = Router();

// Protect all friend routes with authenticateUser
router.use(authenticateUser);

// Friend Requests
router.post('/requests', sendFriendRequest);
router.get('/requests', getFriendRequests);
router.patch('/requests/:id/accept', acceptFriendRequest);
router.patch('/requests/:id/reject', rejectFriendRequest);
router.delete('/requests/:id', cancelFriendRequest);

// Friendship Status
router.get('/status/:targetUserId', getFriendshipStatus);

// Active Friends & Unfriend
router.get('/', getFriends);
router.delete('/:friendId', removeFriend);

module.exports = router;
