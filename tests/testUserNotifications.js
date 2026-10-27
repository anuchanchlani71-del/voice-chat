const http = require('http');
const app = require('../src/app');
const { connectDB, disconnectDB } = require('../src/config/db');
const User = require('../src/models/User');
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

async function runUserNotificationsTests() {
  console.log('====================================================');
  console.log('🧪 Starting User Notifications Backend Test Suite');
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
    console.log('--- TEST 1: Database Setup & Test Data Creation ---');
    await connectDB();
    assert(true, 'MongoDB connected successfully');

    const ts = Date.now();
    await User.deleteMany({ username: { $regex: /^test_ntf_/ } });
    await Notification.deleteMany({ id: { $regex: /^ntf_test_/ } });

    // User A: Active
    const userA = await User.create({
      id: `usr_ntf_a_${ts}`,
      username: `test_ntf_a_${ts}`,
      email: `test_ntf_a_${ts}@example.com`,
      fullName: 'Alice Notif',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'active',
      isBlocked: false
    });

    // User B: Active
    const userB = await User.create({
      id: `usr_ntf_b_${ts}`,
      username: `test_ntf_b_${ts}`,
      email: `test_ntf_b_${ts}@example.com`,
      fullName: 'Bob Notif',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'active',
      isBlocked: false
    });

    // User C: Active (No notifications)
    const userC = await User.create({
      id: `usr_ntf_c_${ts}`,
      username: `test_ntf_c_${ts}`,
      email: `test_ntf_c_${ts}@example.com`,
      fullName: 'Charlie Clean',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'active',
      isBlocked: false
    });

    // User E: Suspended
    const userE = await User.create({
      id: `usr_ntf_e_${ts}`,
      username: `test_ntf_e_${ts}`,
      email: `test_ntf_e_${ts}@example.com`,
      fullName: 'Eve Suspended',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'suspended',
      isBlocked: true
    });

    // Create Notifications for User A
    const notifA1 = await Notification.create({
      id: `ntf_test_a1_${ts}`,
      targetUser: userA._id,
      sender: userB._id,
      type: 'friend_request',
      title: 'Friend Request',
      message: 'Bob sent you a friend request.',
      isRead: false,
      status: 'Delivered'
    });

    const notifA2 = await Notification.create({
      id: `ntf_test_a2_${ts}`,
      targetUser: userA._id,
      sender: userB._id,
      type: 'call_alert',
      title: 'Incoming Call',
      message: 'Bob called you.',
      isRead: false,
      status: 'Delivered'
    });

    // Create Notification for User B
    const notifB1 = await Notification.create({
      id: `ntf_test_b1_${ts}`,
      targetUser: userB._id,
      sender: userA._id,
      type: 'friend_accepted',
      title: 'Friend Accepted',
      message: 'Alice accepted your request.',
      isRead: false,
      status: 'Delivered'
    });

    // Tokens
    const tokenA = signToken({ id: userA.id, email: userA.email });
    const tokenB = signToken({ id: userB.id, email: userB.email });
    const tokenC = signToken({ id: userC.id, email: userC.email });
    const tokenE = signToken({ id: userE.id, email: userE.email });

    // Start HTTP Server
    const server = http.createServer(app.callback());
    await new Promise((res) => server.listen(0, res));

    try {
      // -------------------------------------------------------------
      // TEST 2: Authentication Guard
      // -------------------------------------------------------------
      console.log('\n--- TEST 2: Authentication Guard ---');
      const resUnauth = await makeRequest(server, { path: '/api/v1/notifications', method: 'GET' });
      assert(resUnauth.status === 401, 'Unauthenticated request rejected with 401');

      const resSuspended = await makeRequest(server, { path: '/api/v1/notifications', method: 'GET', headers: { Authorization: `Bearer ${tokenE}` } });
      assert(resSuspended.status === 403, 'Suspended user request rejected with 403');

      // -------------------------------------------------------------
      // TEST 3: Fetch Notifications & Isolation
      // -------------------------------------------------------------
      console.log('\n--- TEST 3: Fetch Notifications & Isolation ---');
      const resGetA = await makeRequest(server, { path: '/api/v1/notifications?page=1&limit=10', method: 'GET', headers: { Authorization: `Bearer ${tokenA}` } });
      assert(resGetA.status === 200 && resGetA.body.success === true, 'User A fetches notifications successfully (200)');
      assert(resGetA.body.notifications && resGetA.body.notifications.length === 2, 'User A receives exactly 2 notifications');
      assert(resGetA.body.unreadCount === 2, 'User A unreadCount is 2');
      assert(resGetA.body.pagination && resGetA.body.pagination.totalItems === 2, 'Pagination object included with totalItems = 2');

      // User C fetches notifications (should be empty)
      const resGetC = await makeRequest(server, { path: '/api/v1/notifications', method: 'GET', headers: { Authorization: `Bearer ${tokenC}` } });
      assert(resGetC.status === 200 && resGetC.body.notifications.length === 0, 'User C has 0 notifications');
      assert(resGetC.body.unreadCount === 0, 'User C unreadCount is 0');

      // -------------------------------------------------------------
      // TEST 4: Mark Notification As Read & Ownership Guard
      // -------------------------------------------------------------
      console.log('\n--- TEST 4: Mark Notification Read & Ownership Guard ---');

      // User A attempts to mark User B's notification as read -> 403 Forbidden
      const resForbiddenRead = await makeRequest(server, { path: `/api/v1/notifications/${notifB1.id}/read`, method: 'PATCH', headers: { Authorization: `Bearer ${tokenA}` } });
      assert(resForbiddenRead.status === 403 && resForbiddenRead.body.success === false, 'User A cannot mark User B notification as read (403)');

      // User A marks own notification as read
      const resReadA = await makeRequest(server, { path: `/api/v1/notifications/${notifA1.id}/read`, method: 'PATCH', headers: { Authorization: `Bearer ${tokenA}` } });
      assert(resReadA.status === 200 && resReadA.body.success === true, 'User A marks own notification as read (200)');
      assert(resReadA.body.notification.unread === false || resReadA.body.notification.isRead === true, 'Notification marked as read');
      assert(resReadA.body.unreadCount === 1, 'User A unreadCount decrements to 1');

      // -------------------------------------------------------------
      // TEST 5: Mark All Notifications As Read
      // -------------------------------------------------------------
      console.log('\n--- TEST 5: Mark All Notifications As Read ---');
      const resReadAllA = await makeRequest(server, { path: '/api/v1/notifications/read-all', method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } });
      assert(resReadAllA.status === 200 && resReadAllA.body.success === true, 'User A marks all notifications as read (200)');
      assert(resReadAllA.body.unreadCount === 0, 'User A unreadCount is now 0');

      // -------------------------------------------------------------
      // TEST 6: Delete Notification & Ownership Guard
      // -------------------------------------------------------------
      console.log('\n--- TEST 6: Delete Notification & Ownership Guard ---');

      // User A attempts to delete User B's notification -> 403 Forbidden
      const resForbiddenDel = await makeRequest(server, { path: `/api/v1/notifications/${notifB1.id}`, method: 'DELETE', headers: { Authorization: `Bearer ${tokenA}` } });
      assert(resForbiddenDel.status === 403 && resForbiddenDel.body.success === false, 'User A cannot delete User B notification (403)');

      // Invalid notification ID -> 404
      const resNotFoundDel = await makeRequest(server, { path: '/api/v1/notifications/non_existent_id', method: 'DELETE', headers: { Authorization: `Bearer ${tokenA}` } });
      assert(resNotFoundDel.status === 404, 'Deleting invalid notification ID returns 404');

      // User A deletes own notification
      const resDelA = await makeRequest(server, { path: `/api/v1/notifications/${notifA1.id}`, method: 'DELETE', headers: { Authorization: `Bearer ${tokenA}` } });
      assert(resDelA.status === 200 && resDelA.body.success === true, 'User A deletes own notification (200)');

      // Verify count decreased to 1
      const resGetA2 = await makeRequest(server, { path: '/api/v1/notifications', method: 'GET', headers: { Authorization: `Bearer ${tokenA}` } });
      assert(resGetA2.body.notifications.length === 1, 'User A notification list reduced to 1 document');

    } finally {
      server.close();
    }

    // Cleanup
    await User.deleteMany({ username: { $regex: /^test_ntf_/ } });
    await Notification.deleteMany({ id: { $regex: /^ntf_test_/ } });

    await disconnectDB();

    console.log('\n====================================================');
    console.log(`📊 TEST RESULTS: ${passed} Passed, ${failed} Failed`);
    console.log('====================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Test suite crashed with error:', err);
    process.exit(1);
  }
}

runUserNotificationsTests();
