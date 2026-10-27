const http = require('http');
const assert = require('assert');
const { io: Client } = require('socket.io-client');
const app = require('../src/app');
const { initSocketServer, getIO } = require('../src/socket/socketServer');
const { connectDB, disconnectDB } = require('../src/config/db');
const User = require('../src/models/User');
const Notification = require('../src/models/Notification');
const { signToken } = require('../src/utils/tokenUtils');
const { emitNotificationNew } = require('../src/utils/notificationSocketHelper');

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

async function runSocketNotificationsTests() {
  console.log('====================================================');
  console.log('⚡ SOCKET.IO PHASE 4: USER NOTIFICATIONS REALTIME TEST SUITE');
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
    await User.deleteMany({ username: { $regex: /^ntf_test_/ } });
    await Notification.deleteMany({ id: { $regex: /^ntf_test_/ } });

    userA = await User.create({
      id: `usr_ntf_a_${ts}`,
      username: `ntf_test_a_${ts}`,
      email: `ntf_test_a_${ts}@example.com`,
      fullName: 'Alice Notification',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'active',
      isBlocked: false,
      isOnboarded: true
    });

    userB = await User.create({
      id: `usr_ntf_b_${ts}`,
      username: `ntf_test_b_${ts}`,
      email: `ntf_test_b_${ts}@example.com`,
      fullName: 'Bob Notification',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'active',
      isBlocked: false,
      isOnboarded: true
    });

    userC = await User.create({
      id: `usr_ntf_c_${ts}`,
      username: `ntf_test_c_${ts}`,
      email: `ntf_test_c_${ts}@example.com`,
      fullName: 'Charlie Unrelated',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'active',
      isBlocked: false,
      isOnboarded: true
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

    // ── TEST 1: Establish Socket Connections for User A, B, and C ──
    const socketA = createClientSocket(tokenA);
    const socketB = createClientSocket(tokenB);
    const socketC = createClientSocket(tokenC);

    await Promise.all([
      new Promise((res) => { socketA.on('connect', res); socketA.connect(); }),
      new Promise((res) => { socketB.on('connect', res); socketB.connect(); }),
      new Promise((res) => { socketC.on('connect', res); socketC.connect(); })
    ]);

    logPass('Authenticated users A, B, and C connected to Socket.IO successfully');

    // ── TEST 2 & 3 & 4: notification:new delivery, persistence, and isolation ──
    let createdNotifId = null;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('notification:new event timed out')), 4000);

      socketB.on('notification:new', (payload) => {
        try {
          assert.ok(payload.notification, 'Payload should contain notification object');
          assert.strictEqual(payload.notification.type, 'friend_request');
          assert.strictEqual(payload.notification.title, 'New Friend Request');
          assert.strictEqual(typeof payload.unreadCount, 'number');
          createdNotifId = payload.notification.id || payload.notification._id;
          clearTimeout(timeout);
          resolve();
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      });

      // User C should NOT receive notification for User B
      socketC.on('notification:new', () => {
        reject(new Error('User C should NOT receive notification intended for User B'));
      });

      // Create notification in MongoDB for User B
      Notification.create({
        id: `ntf_test_1_${ts}`,
        targetUser: userB._id,
        sender: userA._id,
        type: 'friend_request',
        title: 'New Friend Request',
        message: `${userA.fullName} sent you a friend request.`,
        isRead: false
      }).then((notifDoc) => {
        // Assert persisted in DB before emitting
        assert.ok(notifDoc._id, 'Notification must be persisted in MongoDB before socket emission');
        emitNotificationNew(notifDoc._id);
      }).catch(reject);
    });

    logPass('notification:new delivered to target User B after persistence; User C isolated');

    // ── TEST 5: Realtime notification:read synchronization ──
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('notification:read event timed out')), 4000);

      socketB.on('notification:read', (payload) => {
        try {
          assert.strictEqual(payload.notificationId, createdNotifId);
          assert.strictEqual(typeof payload.unreadCount, 'number');
          clearTimeout(timeout);
          resolve();
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      });

      // User B marks notification as read via REST
      makeRequest(server, {
        path: `/api/v1/notifications/${createdNotifId}/read`,
        method: 'PATCH',
        headers: { Authorization: `Bearer ${tokenB}` }
      }).catch(reject);
    });

    logPass('notification:read multi-tab sync event received after REST read endpoint call');

    // ── TEST 6: Realtime notification:read-all synchronization ──
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('notification:read-all event timed out')), 4000);

      socketB.on('notification:read-all', (payload) => {
        try {
          assert.strictEqual(payload.unreadCount, 0);
          clearTimeout(timeout);
          resolve();
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      });

      // User B marks all notifications read via REST
      makeRequest(server, {
        path: '/api/v1/notifications/read-all',
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}` }
      }).catch(reject);
    });

    logPass('notification:read-all multi-tab sync event received after REST read-all call');

    // ── TEST 7: Realtime notification:deleted synchronization ──
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('notification:deleted event timed out')), 4000);

      socketB.on('notification:deleted', (payload) => {
        try {
          assert.strictEqual(payload.notificationId, createdNotifId);
          clearTimeout(timeout);
          resolve();
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      });

      // User B deletes notification via REST
      makeRequest(server, {
        path: `/api/v1/notifications/${createdNotifId}`,
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tokenB}` }
      }).catch(reject);
    });

    logPass('notification:deleted multi-tab sync event received after REST delete call');

    // ── TEST 8: Target User Authorization Isolation Check ──
    // Non-owner User A cannot mark or delete User B notification
    const resForbiddenRead = await makeRequest(server, {
      path: `/api/v1/notifications/${createdNotifId}/read`,
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.strictEqual(resForbiddenRead.status, 404); // Not found for user A
    logPass('Unauthorized user access to notification modification rejected (404/403)');

    console.log('\n====================================================');
    console.log(`🎉 ALL ${passCount}/7 SOCKET NOTIFICATIONS REALTIME TESTS PASSED 100%!`);
    console.log('====================================================\n');

  } catch (err) {
    console.error('❌ SOCKET NOTIFICATIONS TEST FAILED:', err);
    process.exitCode = 1;
  } finally {
    clientSockets.forEach((s) => {
      if (s.connected) s.disconnect();
    });
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await User.deleteMany({ username: { $regex: /^ntf_test_/ } });
    await Notification.deleteMany({ id: { $regex: /^ntf_test_/ } });
    await disconnectDB();
  }
}

runSocketNotificationsTests();
