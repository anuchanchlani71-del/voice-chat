const { Router } = require('../utils/routerUtils');
const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const friendRoutes = require('./friendRoutes');
const userGroupVoiceRoomRoutes = require('./userGroupVoiceRoomRoutes');
const userVoiceCallRoutes = require('./userVoiceCallRoutes');
const userMessageRoutes = require('./userMessageRoutes');
const userNotificationRoutes = require('./userNotificationRoutes');
const adminAuthRoutes = require('./adminAuthRoutes');
const adminUsersRoutes = require('./adminUsersRoutes');
const adminFriendshipsRoutes = require('./adminFriendshipsRoutes');
const adminInterestsRoutes = require('./adminInterestsRoutes');
const adminFriendRequestsRoutes = require('./adminFriendRequestsRoutes');
const adminVoiceCallsRoutes = require('./adminVoiceCallsRoutes');
const adminReportsRoutes = require('./adminReportsRoutes');
const adminBlockedUsersRoutes = require('./adminBlockedUsersRoutes');
const adminNotificationsRoutes = require('./adminNotificationsRoutes');
const adminSafetyRoutes = require('./adminSafetyRoutes');
const adminDashboardRoutes = require('./adminDashboardRoutes');
const adminSettingsRoutes = require('./adminSettingsRoutes');
const adminIcebreakerPromptsRoutes = require('./adminIcebreakerPromptsRoutes');
const adminAppealsRoutes = require('./adminAppealsRoutes');
const adminGroupVoiceRoomsRoutes = require('./adminGroupVoiceRoomsRoutes');
const adminPlansRoutes = require('./adminPlansRoutes');
const adminSubscriptionsRoutes = require('./adminSubscriptionsRoutes');

const apiRouter = Router();

// Mount User Auth Routes at /auth
apiRouter.use('/auth', authRoutes);

// Mount User Routes at /users
apiRouter.use('/users', userRoutes);

// Mount User Friend Routes at /friends
apiRouter.use('/friends', friendRoutes);

// Mount User Voice Calls Routes at /calls and /voice-calls
apiRouter.use('/calls', userVoiceCallRoutes);
apiRouter.use('/voice-calls', userVoiceCallRoutes);

// Mount User Group Voice Rooms Routes at /rooms and /group-voice-rooms
apiRouter.use('/rooms', userGroupVoiceRoomRoutes);
apiRouter.use('/group-voice-rooms', userGroupVoiceRoomRoutes);

// Mount User Messages & Conversations Routes at /messages
apiRouter.use('/messages', userMessageRoutes);

// Mount User Notifications Routes at /notifications
apiRouter.use('/notifications', userNotificationRoutes);

// Mount Admin Auth Routes at /admin/auth
apiRouter.use('/admin/auth', adminAuthRoutes);

// Mount Admin Dashboard Routes at /admin/dashboard
apiRouter.use('/admin/dashboard', adminDashboardRoutes);

// Mount Admin Settings Routes at /admin/settings
apiRouter.use('/admin/settings', adminSettingsRoutes);

// Mount Admin Users Routes at /admin/users
apiRouter.use('/admin/users', adminUsersRoutes);

// Mount Admin Friendships Routes at /admin/friendships
apiRouter.use('/admin/friendships', adminFriendshipsRoutes);

// Mount Admin Interests Routes at /admin/interests
apiRouter.use('/admin/interests', adminInterestsRoutes);

// Mount Admin Icebreaker Prompts Routes at /admin/icebreaker-prompts
apiRouter.use('/admin/icebreaker-prompts', adminIcebreakerPromptsRoutes);

// Mount Admin Friend Requests Routes at /admin/friend-requests
apiRouter.use('/admin/friend-requests', adminFriendRequestsRoutes);

// Mount Admin Voice Calls Routes at /admin/voice-calls
apiRouter.use('/admin/voice-calls', adminVoiceCallsRoutes);

// Mount Admin Reports Routes at /admin/reports
apiRouter.use('/admin/reports', adminReportsRoutes);

// Mount Admin Blocked Users Routes at /admin/blocked-users
apiRouter.use('/admin/blocked-users', adminBlockedUsersRoutes);

// Mount Admin Notifications Routes at /admin/notifications
apiRouter.use('/admin/notifications', adminNotificationsRoutes);

// Mount Admin Safety & Moderation Routes at /admin/safety
apiRouter.use('/admin/safety', adminSafetyRoutes);

// Mount Admin Appeals Routes at /admin/appeals
apiRouter.use('/admin/appeals', adminAppealsRoutes);

// Mount Admin Group Voice Rooms Routes at /admin/group-voice-rooms
apiRouter.use('/admin/group-voice-rooms', adminGroupVoiceRoomsRoutes);

// Mount Admin Plans Routes at /admin/plans
apiRouter.use('/admin/plans', adminPlansRoutes);

// Mount Admin Subscriptions Routes at /admin/subscriptions
apiRouter.use('/admin/subscriptions', adminSubscriptionsRoutes);

module.exports = apiRouter;
