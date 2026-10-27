const { Router } = require('../utils/routerUtils');
const {
  getConversations,
  getConversationById,
  createOrGetConversation,
  sendMessage,
  editMessage,
  deleteMessage,
  markConversationAsRead,
  deleteConversation
} = require('../controllers/userMessageController');
const { authenticateUser } = require('../middleware/authMiddleware');

const router = Router();

// All user messaging routes require authentication
router.use(authenticateUser);

// 1. Conversation Listings & Creation
router.get('/conversations', getConversations);
router.get('/', getConversations);

router.post('/conversations', createOrGetConversation);
router.post('/', createOrGetConversation);

// 2. Conversation Messages & Actions (Placed BEFORE generic :messageId routes)
router.get('/conversations/:conversationId', getConversationById);
router.post('/conversations/:conversationId/messages', sendMessage);
router.post('/conversations/:conversationId/read', markConversationAsRead);
router.delete('/conversations/:conversationId', deleteConversation);

// 3. Direct Message Modifications
router.post('/messages', sendMessage);
router.patch('/messages/:messageId', editMessage);
router.delete('/messages/:messageId', deleteMessage);

// 4. Sub-path fallbacks without '/conversations' prefix
router.get('/:conversationId', getConversationById);
router.post('/:conversationId/messages', sendMessage);
router.post('/:conversationId/read', markConversationAsRead);
router.patch('/:messageId', editMessage);
router.delete('/:messageId', deleteMessage);

module.exports = router;
