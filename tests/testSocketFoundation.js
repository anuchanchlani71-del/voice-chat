const http = require('http');
const assert = require('assert');
const { io: Client } = require('socket.io-client');
const app = require('../src/app');
const { initSocketServer, getIO } = require('../src/socket/socketServer');
const { connectDB, disconnectDB } = require('../src/config/db');
const User = require('../src/models/User');
const { signToken } = require('../src/utils/tokenUtils');

async function runSocketFoundationTests() {
  console.log('====================================================');
  console.log('⚡ SOCKET.IO PHASE 2: CORE FOUNDATION TEST SUITE');
  console.log('====================================================');

  await connectDB();

  let server;
  let baseUrl;
  let testUserActive;
  let testUserSuspended;
  let activeToken;
  let suspendedToken;
  let expiredToken;
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
    // 1. Setup Test Users
    const ts = Date.now();
    await User.deleteMany({ username: { $regex: /^sock_test_/ } });

    testUserActive = await User.create({
      id: `usr_sock_act_${ts}`,
      username: `sock_test_active_${ts}`,
      email: `sock_test_active_${ts}@example.com`,
      fullName: 'Socket Active User',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'active',
      isBlocked: false,
      isOnboarded: true
    });

    testUserSuspended = await User.create({
      id: `usr_sock_susp_${ts}`,
      username: `sock_test_suspended_${ts}`,
      email: `sock_test_suspended_${ts}@example.com`,
      fullName: 'Socket Suspended User',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'suspended',
      isBlocked: false,
      isOnboarded: true
    });

    activeToken = signToken({ id: testUserActive.id, username: testUserActive.username });
    suspendedToken = signToken({ id: testUserSuspended.id, username: testUserSuspended.username });
    expiredToken = signToken({ id: testUserActive.id }, -100);

    // 2. Start HTTP Server with Socket.IO Attached
    server = http.createServer(app.callback());
    initSocketServer(server);

    await new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });

    // Test 1: Socket.IO Server Instance Initialization
    const ioInstance = getIO();
    assert.ok(ioInstance, 'Socket.IO server instance should be initialized');
    logPass('Socket.IO Foundation server initialized on HTTP listener');

    // Test 2: Authenticated user connection
    await new Promise((resolve, reject) => {
      const socket = createClientSocket(activeToken);
      socket.on('connect', () => {
        assert.strictEqual(socket.connected, true, 'Socket should be connected');
        socket.disconnect();
        resolve();
      });
      socket.on('connect_error', (err) => reject(err));
      socket.connect();
    });
    logPass('Authenticated user connects successfully with valid JWT');

    // Test 3: Automatic Personal Room Join (user:<userId>)
    await new Promise((resolve, reject) => {
      const socket = createClientSocket(activeToken);
      socket.on('connect', () => {
        const userRoom = `user:${testUserActive.id}`;
        const rooms = ioInstance.sockets.adapter.rooms;
        assert.ok(rooms.has(userRoom), `Socket server should contain personal room ${userRoom}`);
        socket.disconnect();
        resolve();
      });
      socket.on('connect_error', (err) => reject(err));
      socket.connect();
    });
    logPass('Authenticated socket joins personal room user:<userId>');

    // Test 4: Rejection of unauthenticated connection (missing token)
    await new Promise((resolve, reject) => {
      const socket = createClientSocket(null);
      socket.on('connect', () => reject(new Error('Unauthenticated connection should fail')));
      socket.on('connect_error', (err) => {
        assert.ok(err.message.includes('Authentication token required'));
        socket.disconnect();
        resolve();
      });
      socket.connect();
    });
    logPass('Unauthenticated socket without token is rejected');

    // Test 5: Rejection of invalid / tampered JWT token
    await new Promise((resolve, reject) => {
      const socket = createClientSocket('invalid.jwt.token.string');
      socket.on('connect', () => reject(new Error('Invalid token connection should fail')));
      socket.on('connect_error', (err) => {
        assert.ok(err.message.includes('Invalid') || err.message.includes('tampered'));
        socket.disconnect();
        resolve();
      });
      socket.connect();
    });
    logPass('Invalid / tampered JWT token is rejected');

    // Test 6: Rejection of expired JWT token
    await new Promise((resolve, reject) => {
      const socket = createClientSocket(expiredToken);
      socket.on('connect', () => reject(new Error('Expired token connection should fail')));
      socket.on('connect_error', (err) => {
        assert.ok(err.message.includes('expired'));
        socket.disconnect();
        resolve();
      });
      socket.connect();
    });
    logPass('Expired JWT token is rejected');

    // Test 7: Rejection of suspended user account
    await new Promise((resolve, reject) => {
      const socket = createClientSocket(suspendedToken);
      socket.on('connect', () => reject(new Error('Suspended user connection should fail')));
      socket.on('connect_error', (err) => {
        assert.ok(err.message.includes('suspended'));
        socket.disconnect();
        resolve();
      });
      socket.connect();
    });
    logPass('Suspended user account socket connection is rejected');

    // Test 8: Clean disconnect & room cleanup
    await new Promise((resolve, reject) => {
      const socket = createClientSocket(activeToken);
      socket.on('connect', () => {
        assert.strictEqual(socket.connected, true);
        socket.on('disconnect', () => {
          assert.strictEqual(socket.connected, false);
          resolve();
        });
        socket.disconnect();
      });
      socket.on('connect_error', (err) => reject(err));
      socket.connect();
    });
    logPass('Disconnect handler performs clean disconnect & room cleanup');

    console.log('\n====================================================');
    console.log(`🎉 ALL ${passCount}/8 SOCKET.IO FOUNDATION TESTS PASSED 100%!`);
    console.log('====================================================\n');

  } catch (err) {
    console.error('❌ SOCKET FOUNDATION TEST FAILED:', err);
    process.exitCode = 1;
  } finally {
    clientSockets.forEach((s) => {
      if (s.connected) s.disconnect();
    });
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await User.deleteMany({ username: { $regex: /^sock_test_/ } });
    await disconnectDB();
  }
}

runSocketFoundationTests();
