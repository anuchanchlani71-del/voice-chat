const { Router } = require('../utils/routerUtils');
const {
  updateOnboarding,
  updateProfile,
  uploadUserAvatar,
  getDiscoverUsers,
  getUserProfileById
} = require('../controllers/userController');
const {
  blockUser,
  unblockUser,
  getBlockedUsers,
  reportUser
} = require('../controllers/userSafetyController');
const { authenticateUser } = require('../middleware/authMiddleware');
const { handleAvatarUpload } = require('../middleware/uploadMiddleware');

const router = Router();

// GET /api/v1/users/discover
router.get('/discover', authenticateUser, getDiscoverUsers);

// Blocked users list
router.get('/blocked', authenticateUser, getBlockedUsers);
router.get('/blocks', authenticateUser, getBlockedUsers);

// Block user
router.post('/block', authenticateUser, blockUser);
router.post('/blocks', authenticateUser, blockUser);
router.post('/:id/block', authenticateUser, blockUser);

// Unblock user
router.post('/unblock', authenticateUser, unblockUser);
router.delete('/block/:blockedUserId', authenticateUser, unblockUser);
router.delete('/blocks/:blockedUserId', authenticateUser, unblockUser);
router.delete('/unblock/:blockedUserId', authenticateUser, unblockUser);

// Report user
router.post('/report', authenticateUser, reportUser);
router.post('/reports', authenticateUser, reportUser);
router.post('/:id/report', authenticateUser, reportUser);

// Profile updates
router.patch('/me', authenticateUser, updateProfile);
router.patch('/me/onboarding', authenticateUser, updateOnboarding);
router.post('/upload-avatar', authenticateUser, handleAvatarUpload, uploadUserAvatar);
router.post('/me/avatar', authenticateUser, handleAvatarUpload, uploadUserAvatar);

// GET /api/v1/users/:id (Public profile - MUST BE LAST)
router.get('/:id', authenticateUser, getUserProfileById);

module.exports = router;


