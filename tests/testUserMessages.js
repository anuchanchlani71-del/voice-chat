const http = require('http');
const app = require('../src/app');
const { connectDB, disconnectDB } = require('../src/config/db');
const User = require('../src/models/User');
const Friendship = require('../src/models/Friendship');
const Block = require('../src/models/Block');
const Conversation = require('../src/models/Conversation');
const Message = require('../src/models/Message');
const Notification = require('../src/models/Notification');
const { signToken } = require('../src/utils/tokenUtils');

function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let resData = '';
      res.on('data', (chunk) => {
        resData += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(resData);
          resolve({ status: res.statusCode, body: parsed, raw: resData });
        } catch (e) {
          resolve({ status: res.statusCode, body: resData, raw: resData });
        }
      });
    });

    req.on('error', (err) => reject(err));

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runUserMessagesTests() {
  console.log('====================================================');
  console.log('🧪 Starting User Messages & Conversations Backend Test Suite');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Setup DB Connection & Test Users
    console.log('--- TEST 1: Database Setup & Test User Creation ---');
    await connectDB();
    assert(true, 'MongoDB connected successfully');

    // Clean test collections
    const ts = Date.now();
    await User.deleteMany({ username: { $regex: /^test_msg_/ } });
    await Conversation.deleteMany({});
    await Message.deleteMany({});

    // Create Test Users
    const userA = await User.create({
      id: `usr_msg_a_${ts}`,
      username: `test_msg_a_${ts}`,
      email: `test_msg_a_${ts}@example.com`,
      fullName: 'Alice Test',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'active',
      isBlocked: false
    });

    const userB = await User.create({
      id: `usr_msg_b_${ts}`,
      username: `test_msg_b_${ts}`,
      email: `test_msg_b_${ts}@example.com`,
      fullName: 'Bob Test',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'active',
      isBlocked: false
    });

    const userC = await User.create({
      id: `usr_msg_c_${ts}`,
      username: `test_msg_c_${ts}`,
      email: `test_msg_c_${ts}@example.com`,
      fullName: 'Charlie NonFriend',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'active',
      isBlocked: false
    });

    const userSuspended = await User.create({
      id: `usr_msg_susp_${ts}`,
      username: `test_msg_susp_${ts}`,
      email: `test_msg_susp_${ts}@example.com`,
      fullName: 'Suspended User',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'suspended',
      isBlocked: true
    });

    // Setup Friendship between User A and User B
    const userPairKeyAB = Friendship.generateUserPairKey(userA._id, userB._id);
    await Friendship.create({
      requester: userA._id,
      recipient: userB._id,
      userPairKey: userPairKeyAB,
      status: 'accepted'
    });
    assert(true, 'Friendship created between User A and User B');

    const tokenA = signToken({ id: userA.id, email: userA.email });
    const tokenB = signToken({ id: userB.id, email: userB.email });
    const tokenC = signToken({ id: userC.id, email: userC.email });
    const tokenSuspended = signToken({ id: userSuspended.id, email: userSuspended.email });

    const headersA = { Authorization: `Bearer ${tokenA}` };
    const headersB = { Authorization: `Bearer ${tokenB}` };
    const headersC = { Authorization: `Bearer ${tokenC}` };
    const headersSuspended = { Authorization: `Bearer ${tokenSuspended}` };

    // 2. Start HTTP Server
    const server = http.createServer(app.callback());
    await new Promise((resolve) => server.listen(0, resolve));

    console.log('\n--- TEST 2: Authentication Guard ---');
    const unauthRes = await makeRequest(server, { path: '/api/v1/messages/conversations', method: 'GET' });
    assert(unauthRes.status === 401, 'Unauthenticated request to GET /conversations returns 401');

    const malformedRes = await makeRequest(server, {
      path: '/api/v1/messages/conversations',
      method: 'GET',
      headers: { Authorization: 'Bearer bad_token_999' }
    });
    assert(malformedRes.status === 401, 'Malformed token returns 401');

    console.log('\n--- TEST 3: Friend-Only & Self Messaging Restrictions ---');
    // Self-message rejection
    const selfConvRes = await makeRequest(server, {
      path: '/api/v1/messages/conversations',
      method: 'POST',
      headers: headersA
    }, { recipientId: userA.id });
    assert(selfConvRes.status === 400, 'Self-conversation attempt returns 400 Bad Request');

    // Non-friend messaging rejection (User A -> User C)
    const nonFriendRes = await makeRequest(server, {
      path: '/api/v1/messages/conversations',
      method: 'POST',
      headers: headersA
    }, { recipientId: userC.id });
    assert(nonFriendRes.status === 403, 'Non-friend conversation creation returns 403 Forbidden');

    console.log('\n--- TEST 4: Create / Initialize Conversation ---');
    const createConvRes = await makeRequest(server, {
      path: '/api/v1/messages/conversations',
      method: 'POST',
      headers: headersA
    }, { recipientId: userB.id });

    assert(createConvRes.status === 201 || createConvRes.status === 200, 'User A creates conversation with Friend User B (201/200)');
    assert(createConvRes.body.conversation && createConvRes.body.conversation.id, 'Returns valid conversation object with ID');
    const convId = createConvRes.body.conversation.id;

    console.log('\n--- TEST 5: Send Message Validation & Delivery ---');
    // Empty message text -> 400
    const emptyMsgRes = await makeRequest(server, {
      path: `/api/v1/messages/conversations/${convId}/messages`,
      method: 'POST',
      headers: headersA
    }, { text: '   ' });
    assert(emptyMsgRes.status === 400, 'Empty message text rejected with 400');

    // Oversized message text (> 2000 chars) -> 400
    const bigText = 'a'.repeat(2005);
    const bigMsgRes = await makeRequest(server, {
      path: `/api/v1/messages/conversations/${convId}/messages`,
      method: 'POST',
      headers: headersA
    }, { text: bigText });
    assert(bigMsgRes.status === 400, 'Oversized message text (>2000 chars) rejected with 400');

    // Valid Message 1 (User A -> User B)
    const sendMsg1Res = await makeRequest(server, {
      path: `/api/v1/messages/conversations/${convId}/messages`,
      method: 'POST',
      headers: headersA
    }, { text: 'Hello Bob! How are you doing today?' });

    assert(sendMsg1Res.status === 201, 'User A sends message 1 returns 201 Created');
    assert(sendMsg1Res.body.data && sendMsg1Res.body.data.text === 'Hello Bob! How are you doing today?', 'Message text saved correctly');
    const msg1Id = sendMsg1Res.body.data.id;

    // Valid Message 2 (User B -> User A)
    const sendMsg2Res = await makeRequest(server, {
      path: `/api/v1/messages/conversations/${convId}/messages`,
      method: 'POST',
      headers: headersB
    }, { text: 'Hey Alice! Doing great, excited to chat.' });

    assert(sendMsg2Res.status === 201, 'User B sends message 2 returns 201 Created');
    const msg2Id = sendMsg2Res.body.data.id;

    console.log('\n--- TEST 6: Get Conversations List ---');
    const convsListARes = await makeRequest(server, {
      path: '/api/v1/messages/conversations',
      method: 'GET',
      headers: headersA
    });

    assert(convsListARes.status === 200, 'GET /conversations for User A returns 200');
    assert(Array.isArray(convsListARes.body.conversations) && convsListARes.body.conversations.length === 1, 'Returns 1 active conversation for User A');
    assert(convsListARes.body.conversations[0].lastMessage === 'Hey Alice! Doing great, excited to chat.', 'Last message preview updated');
    assert(convsListARes.body.conversations[0].unreadCount === 1, 'Unread count for User A is 1');

    console.log('\n--- TEST 7: Get Conversation Details & Messages Pagination ---');
    const getConvRes = await makeRequest(server, {
      path: `/api/v1/messages/conversations/${convId}?page=1&limit=10`,
      method: 'GET',
      headers: headersA
    });

    assert(getConvRes.status === 200, 'GET /conversations/:id returns 200');
    assert(Array.isArray(getConvRes.body.messages) && getConvRes.body.messages.length === 2, 'Returns 2 messages in conversation');
    assert(getConvRes.body.pagination && getConvRes.body.pagination.totalItems === 2, 'Pagination metadata returned with totalItems = 2');

    console.log('\n--- TEST 8: Mark Conversation As Read ---');
    const markReadRes = await makeRequest(server, {
      path: `/api/v1/messages/conversations/${convId}/read`,
      method: 'POST',
      headers: headersA
    });

    assert(markReadRes.status === 200, 'POST /conversations/:id/read returns 200');

    const convsListAAfterRead = await makeRequest(server, {
      path: '/api/v1/messages/conversations',
      method: 'GET',
      headers: headersA
    });
    assert(convsListAAfterRead.body.conversations[0].unreadCount === 0, 'Unread count reset to 0 after marking read');

    console.log('\n--- TEST 9: Edit Message (Sender Only) ---');
    // Non-sender User B tries to edit User A's message -> 403
    const unauthEditRes = await makeRequest(server, {
      path: `/api/v1/messages/messages/${msg1Id}`,
      method: 'PATCH',
      headers: headersB
    }, { text: 'Hacked Text' });
    assert(unauthEditRes.status === 403, 'Non-sender edit attempt rejected with 403 Forbidden');

    // Sender User A edits message 1 -> 200
    const editRes = await makeRequest(server, {
      path: `/api/v1/messages/messages/${msg1Id}`,
      method: 'PATCH',
      headers: headersA
    }, { text: 'Hello Bob! How are you doing today? (Edited)' });

    assert(editRes.status === 200, 'Sender edit message returns 200');
    assert(editRes.body.data.isEdited === true, 'isEdited flag set to true');
    assert(editRes.body.data.text.includes('(Edited)'), 'Message text updated in DB');

    console.log('\n--- TEST 10: Delete Message ---');
    const deleteMsgRes = await makeRequest(server, {
      path: `/api/v1/messages/messages/${msg1Id}`,
      method: 'DELETE',
      headers: headersA
    });

    assert(deleteMsgRes.status === 200, 'DELETE /messages/:id returns 200');

    // Deleted message does not appear in active messages query
    const getConvAfterDelete = await makeRequest(server, {
      path: `/api/v1/messages/conversations/${convId}`,
      method: 'GET',
      headers: headersA
    });
    assert(getConvAfterDelete.body.messages.length === 1, 'Deleted message filtered out from conversation messages');

    console.log('\n--- TEST 11: Unauthorized Conversation Access ---');
    const unauthConvRes = await makeRequest(server, {
      path: `/api/v1/messages/conversations/${convId}`,
      method: 'GET',
      headers: headersC
    });
    assert(unauthConvRes.status === 403, 'Non-participant User C access attempt rejected with 403 Forbidden');

    console.log('\n--- TEST 12: Block Safety Restrictions ---');
    // User A blocks User B
    await Block.create({
      blockedBy: userA._id,
      blockedUser: userB._id,
      status: 'active',
      reason: 'Testing messaging block safety'
    });

    // Blocked user messaging attempt (User A -> User B) -> 403
    const sendBlockedRes = await makeRequest(server, {
      path: `/api/v1/messages/conversations/${convId}/messages`,
      method: 'POST',
      headers: headersA
    }, { text: 'Blocked message attempt' });
    assert(sendBlockedRes.status === 403, 'Message sending between blocked users rejected with 403 Forbidden');

    // Blocked conversation access -> 403
    const getBlockedConvRes = await makeRequest(server, {
      path: `/api/v1/messages/conversations/${convId}`,
      method: 'GET',
      headers: headersA
    });
    assert(getBlockedConvRes.status === 403, 'Conversation access between blocked users rejected with 403 Forbidden');

    // Release block
    await Block.updateOne({ blockedBy: userA._id, blockedUser: userB._id }, { status: 'released' });

    console.log('\n--- TEST 13: Suspended Account Restriction ---');
    const suspendedMsgRes = await makeRequest(server, {
      path: `/api/v1/messages/conversations/${convId}/messages`,
      method: 'POST',
      headers: headersSuspended
    }, { text: 'Suspended attempt' });
    assert(suspendedMsgRes.status === 403, 'Suspended account messaging rejected with 403 Forbidden');

    console.log('\n--- TEST 14: Clear / Delete Conversation ---');
    const clearConvRes = await makeRequest(server, {
      path: `/api/v1/messages/conversations/${convId}`,
      method: 'DELETE',
      headers: headersA
    });
    assert(clearConvRes.status === 200, 'DELETE /conversations/:id returns 200 OK');

    const convsListAfterClear = await makeRequest(server, {
      path: '/api/v1/messages/conversations',
      method: 'GET',
      headers: headersA
    });
    assert(convsListAfterClear.body.conversations.length === 0, 'Cleared conversation hidden from User A list');

    console.log('\n--- TEST 15: Notification Generation on Message Delivery ---');
    const notif = await Notification.findOne({ targetUser: userB._id, sender: userA._id });
    assert(notif && notif.title.includes('New message'), 'Notification generated for recipient on new message');

    // Clean up test data
    await User.deleteMany({ username: { $regex: /^test_msg_/ } });
    await Friendship.deleteMany({ userPairKey: userPairKeyAB });
    await Block.deleteMany({ blockedBy: userA._id });
    await Conversation.deleteMany({ id: convId });
    await Message.deleteMany({ conversationId: convId });

    server.close();
    await disconnectDB();

    console.log('\n====================================================');
    console.log(`📊 User Messages Test Results: ${passed} Passed, ${failed} Failed`);
    console.log('====================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Test suite failed with error:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  runUserMessagesTests();
}

module.exports = { runUserMessagesTests };
