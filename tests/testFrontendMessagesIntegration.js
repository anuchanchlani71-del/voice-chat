const http = require('http');
const assert = require('assert');
const app = require('../src/app');
const { connectDB, disconnectDB } = require('../src/config/db');
const User = require('../src/models/User');
const Friendship = require('../src/models/Friendship');
const Block = require('../src/models/Block');
const Conversation = require('../src/models/Conversation');
const Message = require('../src/models/Message');

let serverInstance = null;
let dynamicPort = 5000;

async function apiCall(endpoint, method = 'GET', token = null, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: dynamicPort,
      path: `/api/v1${endpoint}`,
      method,
      agent: false,
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'close',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runFrontendMessagesIntegration() {
  console.log('====================================================');
  console.log('🧪 Starting Frontend Messages REST Integration Test Suite');
  console.log('====================================================\n');

  await connectDB();
  await Conversation.deleteMany({});
  await Message.deleteMany({});
  serverInstance = http.createServer(app.callback());
  await new Promise((resolve) => serverInstance.listen(0, resolve));
  const port = serverInstance.address().port;
  dynamicPort = port;

  const ts = Date.now();
  const userAData = {
    fullName: 'Alex User A',
    username: `fe_msg_a_${ts}`,
    email: `fe_msg_a_${ts}@example.com`,
    password: 'Password123!'
  };

  const userBData = {
    fullName: 'Zoe Friend B',
    username: `fe_msg_b_${ts}`,
    email: `fe_msg_b_${ts}@example.com`,
    password: 'Password123!'
  };

  const userCData = {
    fullName: 'Stranger User C',
    username: `fe_msg_c_${ts}`,
    email: `fe_msg_c_${ts}@example.com`,
    password: 'Password123!'
  };

  let passed = 0;
  let failed = 0;

  function assertTest(condition, message) {
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      failed++;
    }
  }

  try {
    // 1. Register User A, B, and C
    const regA = await apiCall('/auth/register', 'POST', null, userAData);
    const regB = await apiCall('/auth/register', 'POST', null, userBData);
    const regC = await apiCall('/auth/register', 'POST', null, userCData);

    const tokenA = regA.body.token;
    const tokenB = regB.body.token;
    const tokenC = regC.body.token;

    const userA = regA.body.user;
    const userB = regB.body.user;
    const userC = regC.body.user;

    assertTest(tokenA && tokenB && tokenC, '1. Test Users A, B, and C registered successfully');

    // 2. Establish Friendship between User A and User B
    const userDocA = await User.findOne({ username: userAData.username });
    const userDocB = await User.findOne({ username: userBData.username });
    const userDocC = await User.findOne({ username: userCData.username });

    const userPairKeyAB = Friendship.generateUserPairKey(userDocA._id, userDocB._id);
    await Friendship.create({
      userPairKey: userPairKeyAB,
      requester: userDocA._id,
      recipient: userDocB._id,
      status: 'accepted'
    });
    assertTest(true, '2. Friendship established between User A and User B');

    // 3. User A fetches empty conversations list (GET /api/v1/messages/conversations)
    const emptyConvsRes = await apiCall('/messages/conversations', 'GET', tokenA);
    assertTest(emptyConvsRes.status === 200 && emptyConvsRes.body.conversations.length === 0, '3. Initial GET /messages/conversations returns empty array');

    // 4. User A creates/initializes conversation with Friend User B (POST /api/v1/messages/conversations)
    const createConvRes = await apiCall('/messages/conversations', 'POST', tokenA, {
      targetUserId: userB.id
    });
    assertTest(createConvRes.status === 200 || createConvRes.status === 201, '4. User A creates 1-on-1 conversation with Friend User B');
    const convId = createConvRes.body.conversation.id;
    assertTest(!!convId, '4b. Conversation created with valid custom ID');

    // 5. User A sends message to User B (POST /api/v1/messages/conversations/:id/messages)
    const msg1Res = await apiCall(`/messages/conversations/${convId}/messages`, 'POST', tokenA, {
      text: 'Hey Zoe! Are you free for an audio lounge tonight?'
    });
    assertTest(msg1Res.status === 201 && msg1Res.body.success, '5. User A sends message 1 via POST /messages/conversations/:id/messages');
    const msg1Id = (msg1Res.body.data || msg1Res.body.messageData).id;

    // 6. User B sends reply message to User A (POST /api/v1/messages/conversations/:id/messages)
    const msg2Res = await apiCall(`/messages/conversations/${convId}/messages`, 'POST', tokenB, {
      text: 'Hey Alex! Yes, count me in for late night talks!'
    });
    assertTest(msg2Res.status === 201 && msg2Res.body.success, '6. User B sends message 2 reply');
    const msg2Id = (msg2Res.body.data || msg2Res.body.messageData).id;

    // 7. User A fetches conversation details & paginated messages (GET /api/v1/messages/conversations/:id)
    const detailsRes = await apiCall(`/messages/conversations/${convId}?page=1&limit=20`, 'GET', tokenA);
    assertTest(detailsRes.status === 200 && detailsRes.body.messages.length === 2, '7. GET /messages/conversations/:id returns 2 messages');
    assertTest(detailsRes.body.pagination.totalItems === 2, '7b. Pagination metadata returns totalItems = 2');

    // 8. User A fetches conversations list (GET /api/v1/messages/conversations)
    const convsListRes = await apiCall('/messages/conversations', 'GET', tokenA);
    assertTest(convsListRes.status === 200 && convsListRes.body.conversations.length === 1, '8. GET /messages/conversations returns 1 active conversation');
    assertTest(convsListRes.body.conversations[0].unreadCount === 1, '8b. Unread count for User A is 1');

    // 9. User A marks conversation as read (POST /api/v1/messages/conversations/:id/read)
    const readRes = await apiCall(`/messages/conversations/${convId}/read`, 'POST', tokenA);
    assertTest(readRes.status === 200 && readRes.body.success, '9. User A marks conversation as read');

    const convsListAfterRead = await apiCall('/messages/conversations', 'GET', tokenA);
    assertTest(convsListAfterRead.body.conversations[0].unreadCount === 0, '9b. Unread count reset to 0 after read');

    // 10. User A edits message 1 (PATCH /api/v1/messages/:messageId)
    const editRes = await apiCall(`/messages/${msg1Id}`, 'PATCH', tokenA, {
      text: 'Hey Zoe! Are you free for an acoustic audio lounge tonight?'
    });
    assertTest(editRes.status === 200 && editRes.body.data.isEdited === true, '10. Sender User A edits message 1 (isEdited = true)');

    // 11. User A deletes message 1 (DELETE /api/v1/messages/:messageId)
    const deleteMsgRes = await apiCall(`/messages/${msg1Id}`, 'DELETE', tokenA);
    assertTest(deleteMsgRes.status === 200 && deleteMsgRes.body.success, '11. Sender User A deletes message 1');

    const detailsAfterDelete = await apiCall(`/messages/conversations/${convId}`, 'GET', tokenA);
    assertTest(detailsAfterDelete.body.messages.length === 1, '11b. Deleted message filtered out from active conversation thread');

    // 12. Non-friend User C attempts to send message to User A -> 403 Forbidden
    const nonFriendConvRes = await apiCall('/messages/conversations', 'POST', tokenC, {
      targetUserId: userA.id
    });
    assertTest(nonFriendConvRes.status === 403, '12. Non-friend User C conversation attempt rejected with 403 Forbidden');

    // 13. Blocked User Safety Guard
    await Block.create({
      blockedBy: userDocA._id,
      blockedUser: userDocB._id,
      status: 'active'
    });

    const blockedMsgRes = await apiCall(`/messages/conversations/${convId}/messages`, 'POST', tokenA, {
      text: 'This message should be rejected due to block'
    });
    assertTest(blockedMsgRes.status === 403, '13. Message sending between blocked users rejected with 403 Forbidden');

    // Remove block for conversation clear cleanup test
    await Block.deleteMany({ blockedBy: userDocA._id });

    // 14. User A clears conversation history (DELETE /api/v1/messages/conversations/:id)
    const clearConvRes = await apiCall(`/messages/conversations/${convId}`, 'DELETE', tokenA);
    assertTest(clearConvRes.status === 200 && clearConvRes.body.success, '14. User A clears conversation via DELETE /messages/conversations/:id');

    const convsListAfterClear = await apiCall('/messages/conversations', 'GET', tokenA);
    assertTest(convsListAfterClear.body.conversations.length === 0, '14b. Cleared conversation hidden from User A list');

    // Clean up test records
    await User.deleteMany({ username: { $regex: /^fe_msg_/ } });
    await Friendship.deleteMany({ userPairKey: userPairKeyAB });
    await Conversation.deleteMany({ id: convId });
    await Message.deleteMany({ conversationId: convId });

    if (serverInstance) serverInstance.close();
    await disconnectDB();

    console.log('\n====================================================');
    console.log(`📊 Frontend Integration Results: ${passed} Passed, ${failed} Failed`);
    console.log('====================================================\n');

    if (failed > 0) process.exit(1);
  } catch (err) {
    if (serverInstance) serverInstance.close();
    await disconnectDB();
    console.error('❌ Frontend integration test error:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  runFrontendMessagesIntegration();
}

module.exports = runFrontendMessagesIntegration;
