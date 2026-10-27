const http = require('http');
const assert = require('assert');
const { io: Client } = require('socket.io-client');
const app = require('../src/app');
const { initSocketServer, getIO } = require('../src/socket/socketServer');
const { connectDB, disconnectDB } = require('../src/config/db');
const User = require('../src/models/User');
const Conversation = require('../src/models/Conversation');
const Message = require('../src/models/Message');
const Friendship = require('../src/models/Friendship');
const Block = require('../src/models/Block');
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
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body: resData });
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

async function runSocketMessagesTests() {
  console.log('====================================================');
  console.log('⚡ SOCKET.IO PHASE 3: DIRECT MESSAGES REALTIME TEST SUITE');
  console.log('====================================================');

  await connectDB();

  let server;
  let baseUrl;
  let userA, userB, userC;
  let tokenA, tokenB, tokenC;
  let clientSockets = [];

  function createClientSocket(token) {
    const socket = Client(baseUrl, {
      auth: { token },
      autoConnect: false,
      reconnection: false,
      transports: ['websocket', 'polling']
    });
    clientSockets.push(socket);
    return socket;
  }

  let passCount = 0;
  function logPass(testName) {
    passCount++;
    console.log(`  ✅ PASS ${passCount}: ${testName}`);
  }

  try {
    const ts = Date.now();
    await User.deleteMany({ username: { $regex: /^msg_test_/ } });

    userA = await User.create({
      id: `usr_msg_a_${ts}`,
      username: `msg_test_a_${ts}`,
      email: `msg_test_a_${ts}@example.com`,
      fullName: 'Alice Realtime',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'active',
      isBlocked: false,
      isOnboarded: true
    });

    userB = await User.create({
      id: `usr_msg_b_${ts}`,
      username: `msg_test_b_${ts}`,
      email: `msg_test_b_${ts}@example.com`,
      fullName: 'Bob Realtime',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'active',
      isBlocked: false,
      isOnboarded: true
    });

    userC = await User.create({
      id: `usr_msg_c_${ts}`,
      username: `msg_test_c_${ts}`,
      email: `msg_test_c_${ts}@example.com`,
      fullName: 'Charlie Outsider',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'active',
      isBlocked: false,
      isOnboarded: true
    });

    // Create mutual accepted friendship between A & B
    await Friendship.create({
      requester: userA._id,
      recipient: userB._id,
      userPairKey: Friendship.generateUserPairKey(userA._id, userB._id),
      status: 'accepted',
      acceptedAt: new Date()
    });

    tokenA = signToken({ id: userA.id, username: userA.username });
    tokenB = signToken({ id: userB.id, username: userB.username });
    tokenC = signToken({ id: userC.id, username: userC.username });

    // Start HTTP Server with Socket.IO Attached
    server = http.createServer(app.callback());
    initSocketServer(server);

    await new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });

    // ── TEST 1: Establish Socket Connections for User A, User B, and User C ──
    const socketA = createClientSocket(tokenA);
    const socketB = createClientSocket(tokenB);
    const socketC = createClientSocket(tokenC);

    await Promise.all([
      new Promise((res) => { socketA.on('connect', res); socketA.connect(); }),
      new Promise((res) => { socketB.on('connect', res); socketB.connect(); }),
      new Promise((res) => { socketC.on('connect', res); socketC.connect(); })
    ]);

    logPass('Users A, B, and C connected to Socket.IO foundation successfully');

    // ── TEST 2: Initialize Conversation between A & B via REST ──
    const convRes = await makeRequest(server, {
      path: '/api/v1/messages/conversations',
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` }
    }, { recipientId: userB.id });

    assert.strictEqual(convRes.status, 201);
    const conversationId = convRes.body.conversation.id;
    assert.ok(conversationId);
    logPass('Conversation initialized between A & B via REST');

    // ── TEST 3: Realtime message:new event delivery on REST POST /messages ──
    let createdMessageId = null;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('message:new event timed out')), 4000);

      let eventReceivedCount = 0;
      const handleNewMsg = (payload) => {
        try {
          assert.ok(payload.message, 'Payload should contain message object');
          assert.strictEqual(payload.conversationId, conversationId);
          assert.strictEqual(payload.message.text, 'Hello Bob! This is realtime.');
          createdMessageId = payload.message.id || payload.message._id;
          eventReceivedCount++;
          if (eventReceivedCount === 1) {
            clearTimeout(timeout);
            resolve();
          }
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      };

      socketB.on('message:new', handleNewMsg);

      // Trigger REST send message from User A to User B
      makeRequest(server, {
        path: `/api/v1/messages/conversations/${conversationId}/messages`,
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}` }
      }, { text: 'Hello Bob! This is realtime.' }).catch(reject);
    });

    logPass('message:new realtime event received by recipient when message sent via REST');

    // ── TEST 4: Non-participant User C does NOT receive A & B message ──
    let userCReceivedMsg = false;
    socketC.on('message:new', () => { userCReceivedMsg = true; });

    await makeRequest(server, {
      path: `/api/v1/messages/conversations/${conversationId}/messages`,
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` }
    }, { text: 'Second message for B only' });

    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(userCReceivedMsg, false, 'User C should not receive messages between A and B');
    logPass('Non-participant User C isolated from A & B messaging events');

    // ── TEST 5: Realtime message:read event on REST POST /read ──
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('message:read event timed out')), 4000);

      socketA.on('message:read', (payload) => {
        try {
          assert.strictEqual(payload.conversationId, conversationId);
          assert.strictEqual(payload.readerId, userB.id);
          clearTimeout(timeout);
          resolve();
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      });

      // User B marks conversation as read via REST
      makeRequest(server, {
        path: `/api/v1/messages/conversations/${conversationId}/read`,
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}` }
      }).catch(reject);
    });

    logPass('message:read realtime event received by sender when recipient reads messages');

    // ── TEST 6: Realtime message:deleted event on REST DELETE /messages/:id ──
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('message:deleted event timed out')), 4000);

      socketB.on('message:deleted', (payload) => {
        try {
          assert.strictEqual(payload.messageId, createdMessageId);
          clearTimeout(timeout);
          resolve();
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      });

      // User A deletes message via REST
      makeRequest(server, {
        path: `/api/v1/messages/${createdMessageId}`,
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tokenA}` }
      }).catch(reject);
    });

    logPass('message:deleted realtime event received when message is deleted via REST');

    // ── TEST 7: Transient typing:start and typing:stop events ──
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('typing:start event timed out')), 4000);

      socketB.on('typing:start', (payload) => {
        try {
          assert.strictEqual(payload.conversationId, conversationId);
          assert.strictEqual(payload.userId, userA.id);
          assert.strictEqual(payload.username, userA.username);
          clearTimeout(timeout);
          resolve();
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      });

      socketA.emit('typing:start', { conversationId });
    });

    logPass('typing:start event delivered to conversation recipient');

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('typing:stop event timed out')), 4000);

      socketB.on('typing:stop', (payload) => {
        try {
          assert.strictEqual(payload.conversationId, conversationId);
          assert.strictEqual(payload.userId, userA.id);
          clearTimeout(timeout);
          resolve();
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      });

      socketA.emit('typing:stop', { conversationId });
    });

    logPass('typing:stop event delivered to conversation recipient');

    // ── TEST 8: Blocked user typing isolation ──
    await Block.create({
      blockedBy: userB._id,
      blockedUser: userA._id,
      status: 'active'
    });

    let blockedTypingReceived = false;
    socketB.on('typing:start', () => { blockedTypingReceived = true; });

    socketA.emit('typing:start', { conversationId });
    await new Promise((r) => setTimeout(r, 200));

    assert.strictEqual(blockedTypingReceived, false, 'Blocked user typing event should be ignored');
    logPass('Blocked user typing events properly isolated and ignored');

    console.log('\n====================================================');
    console.log(`🎉 ALL ${passCount}/8 SOCKET MESSAGES REALTIME TESTS PASSED 100%!`);
    console.log('====================================================\n');

  } catch (err) {
    console.error('❌ SOCKET MESSAGES REALTIME TEST FAILED:', err);
    process.exitCode = 1;
  } finally {
    clientSockets.forEach((s) => {
      if (s.connected) s.disconnect();
    });
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await User.deleteMany({ username: { $regex: /^msg_test_/ } });
    await Block.deleteMany({});
    await Friendship.deleteMany({});
    await Conversation.deleteMany({});
    await Message.deleteMany({});
    await disconnectDB();
  }
}

runSocketMessagesTests();
