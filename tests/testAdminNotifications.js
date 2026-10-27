const http = require('http');
const app = require('../src/app');
const config = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const { seedDefaultAdmin } = require('../src/seed/seedAdmin');
const User = require('../src/models/User');
const Notification = require('../src/models/Notification');

/**
 * Helper to make HTTP requests against in-memory test server
 */
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

/**
 * Main Test Runner for Admin Notifications APIs
 */
async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Admin Notifications APIs Backend Test Suite');
  console.log(`🗄️  Target DB: ${config.mongoUri}`);
  console.log('====================================================\n');

  let testsPassed = 0;
  let testsFailed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      testsPassed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      testsFailed++;
    }
  }

  // 1. Establish MongoDB connection
  console.log('--- TEST 1: Database Connection ---');
  await connectDB();
  assert(true, 'Connected to MongoDB for Notifications test suite');

  // 2. Ensure Super Admin is seeded
  await seedDefaultAdmin();

  // 3. Start HTTP server on temporary port
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));
  const testPort = server.address().port;
  console.log(`[Test Server] Running on temporary port ${testPort}\n`);

  let tempUserA = null;
  let tempUserB = null;
  let tempUserC = null;
  let tempNotif1 = null;
  let tempNotif2 = null;
  let tempNotif3 = null;
  let tempNotif4 = null;

  try {
    // 4. Authenticate Admin to get Bearer Token
    console.log('--- TEST 2: Admin Authentication Handshake ---');
    const loginRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/login',
      method: 'POST'
    }, {
      email: config.defaultAdmin.email,
      password: config.defaultAdmin.password
    });
    assert(loginRes.status === 200 && loginRes.body.token, 'Admin authenticated and received JWT token');
    const adminToken = loginRes.body.token;

    // 5. Unauthorized request guard -> 401
    console.log('\n--- TEST 3: Unauthenticated Request Guard (401) ---');
    const unauthRes = await makeRequest(server, {
      path: '/api/v1/admin/notifications',
      method: 'GET'
    });
    assert(unauthRes.status === 401, 'GET /admin/notifications without token returns HTTP 401 Unauthorized');

    const unauthDetailRes = await makeRequest(server, {
      path: '/api/v1/admin/notifications/ntf_12345',
      method: 'GET'
    });
    assert(unauthDetailRes.status === 401, 'GET /admin/notifications/:id without token returns HTTP 401 Unauthorized');

    // 6. Setup Temporary Test Users & Notifications
    console.log('\n--- TEST 4: Setup Temporary Test Data ---');
    tempUserA = new User({
      id: 'TEST_NTF_USER_01',
      username: 'test_ntf_aarav',
      fullName: 'Aarav Sharma',
      interests: ['Music', 'Guitar'],
      accountStatus: 'active'
    });
    await tempUserA.save();

    tempUserB = new User({
      id: 'TEST_NTF_USER_02',
      username: 'test_ntf_priya',
      fullName: 'Priya Deshmukh',
      interests: ['Books', 'Tea'],
      accountStatus: 'active'
    });
    await tempUserB.save();

    tempUserC = new User({
      id: 'TEST_NTF_USER_03',
      username: 'test_ntf_vikram',
      fullName: 'Vikram Rathore',
      interests: ['Gaming'],
      accountStatus: 'active'
    });
    await tempUserC.save();

    // Notif 1: Call Alert (Delivered)
    tempNotif1 = new Notification({
      id: 'TEST_NTF_DOC_01',
      targetUser: tempUserB._id,
      sender: tempUserA._id,
      type: 'call_alert',
      title: 'Incoming Voice Call',
      message: 'Aarav Sharma initiated a 1-to-1 voice chat with Priya Deshmukh.',
      status: 'Delivered',
      isRead: false,
      date: '2026-09-25 10:10'
    });
    await tempNotif1.save();

    // Notif 2: Friend Request (Delivered)
    tempNotif2 = new Notification({
      id: 'TEST_NTF_DOC_02',
      targetUser: tempUserA._id,
      sender: tempUserB._id,
      type: 'friend_request',
      title: 'New Friend Request',
      message: 'Priya Deshmukh sent a friend request based on mutual interests.',
      status: 'Delivered',
      isRead: false,
      date: '2026-09-25 10:30'
    });
    await tempNotif2.save();

    // Notif 3: Friend Accepted (Read)
    tempNotif3 = new Notification({
      id: 'TEST_NTF_DOC_03',
      targetUser: tempUserB._id,
      sender: tempUserA._id,
      type: 'friend_accepted',
      title: 'Friend Request Accepted',
      message: 'Aarav Sharma accepted your friend request. Voice Chat unlocked!',
      status: 'Read',
      isRead: true,
      date: '2026-09-24 14:15'
    });
    await tempNotif3.save();

    // Notif 4: Safety Advisory (Delivered)
    tempNotif4 = new Notification({
      id: 'TEST_NTF_DOC_04',
      targetUser: tempUserC._id,
      type: 'safety_alert',
      title: 'Safety Advisory Notice',
      message: 'Account flagged for high request rate. Please adhere to guidelines.',
      status: 'Delivered',
      isRead: false,
      date: '2026-09-24 18:00'
    });
    await tempNotif4.save();

    assert(Boolean(tempNotif1.id) && Boolean(tempNotif2.id) && Boolean(tempNotif3.id) && Boolean(tempNotif4.id),
      'Temporary test notification records created in MongoDB');

    // 7. GET /api/v1/admin/notifications (Listing & Tab Counts)
    console.log('\n--- TEST 5: GET /api/v1/admin/notifications (Listing & Counts) ---');
    const listRes = await makeRequest(server, {
      path: '/api/v1/admin/notifications?page=1&limit=10',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(listRes.status === 200, 'GET /notifications returns HTTP 200');
    assert(listRes.body.success === true, 'Response contains success: true');
    assert(Array.isArray(listRes.body.notifications) && listRes.body.notifications.length >= 4, 'Returns notifications array with >= 4 records');
    assert(listRes.body.counts && listRes.body.counts.all >= 4, 'Tab counts.all >= 4');
    assert(listRes.body.counts.delivered >= 3, 'Tab counts.delivered >= 3');
    assert(listRes.body.counts.read >= 1, 'Tab counts.read >= 1');
    assert(Boolean(listRes.body.pagination), 'Pagination metadata present');

    // 8. Filter by status: read
    console.log('\n--- TEST 6: Status Filter: read ---');
    const readRes = await makeRequest(server, {
      path: '/api/v1/admin/notifications?status=read',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(readRes.status === 200, 'Read status filter returns HTTP 200');
    assert(readRes.body.notifications.every(n => n.status.toLowerCase() === 'read' || n.isRead === true), 'All returned records are read');

    // 9. Filter by type: safety_alert
    console.log('\n--- TEST 7: Type Filter: safety_alert ---');
    const safetyRes = await makeRequest(server, {
      path: '/api/v1/admin/notifications?type=safety_alert',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(safetyRes.status === 200, 'Safety alert filter returns HTTP 200');
    assert(safetyRes.body.notifications.every(n => n.type === 'safety_alert'), 'All returned records have type === "safety_alert"');

    // 10. Search Filter
    console.log('\n--- TEST 8: Search Filter (by message or user) ---');
    const searchRes = await makeRequest(server, {
      path: '/api/v1/admin/notifications?search=priya',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(searchRes.status === 200, 'Search query returns HTTP 200');
    assert(searchRes.body.notifications.some(n =>
      (n.targetUser && n.targetUser.username === 'test_ntf_priya') ||
      (n.sender && n.sender.username === 'test_ntf_priya') ||
      (n.message && n.message.includes('Priya'))
    ), 'Search finds notifications associated with "priya"');

    // 11. Date Range Filter
    console.log('\n--- TEST 9: Date Range Filtering ---');
    const todayStr = new Date().toISOString().split('T')[0];
    const dateRes = await makeRequest(server, {
      path: `/api/v1/admin/notifications?startDate=${todayStr}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(dateRes.status === 200, 'Date filter returns HTTP 200');
    assert(dateRes.body.notifications.length >= 1, 'Returns records created on or after startDate');

    // 12. GET /api/v1/admin/notifications/:id (Valid ID)
    console.log('\n--- TEST 10: GET /admin/notifications/:id (Valid ID) ---');
    const detailRes = await makeRequest(server, {
      path: `/api/v1/admin/notifications/${tempNotif1.id}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(detailRes.status === 200, 'GET /admin/notifications/:id returns HTTP 200');
    assert(detailRes.body.success === true, 'Detail response contains success: true');
    assert(detailRes.body.notification.id === tempNotif1.id, 'Notification ID matches requested record');
    assert(detailRes.body.notification.targetUser.username === 'test_ntf_priya', 'targetUser populated accurately');
    assert(detailRes.body.notification.sender.username === 'test_ntf_aarav', 'sender populated accurately');
    assert(detailRes.body.notification.title === 'Incoming Voice Call', 'Title matches');

    // 13. GET /api/v1/admin/notifications/:id (Non-existent ID) -> 404
    console.log('\n--- TEST 11: GET /admin/notifications/:id (Non-existent ID) ---');
    const notFoundRes = await makeRequest(server, {
      path: '/api/v1/admin/notifications/non_existent_ntf_99999',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(notFoundRes.status === 404, 'Non-existent notification returns HTTP 404 Not Found');
    assert(notFoundRes.body.success === false, '404 response contains success: false');

    // 14. Credential Sanitization Audit
    console.log('\n--- TEST 12: Credential Sanitization Audit ---');
    const listRaw = JSON.stringify(listRes.body);
    const detailRaw = JSON.stringify(detailRes.body);

    assert(!listRaw.includes('passwordHash') && !listRaw.includes('salt') && !listRaw.includes('__v'),
      'List response contains zero passwordHash, salt, or __v fields');
    assert(!detailRaw.includes('passwordHash') && !detailRaw.includes('salt') && !detailRaw.includes('__v'),
      'Detail response contains zero passwordHash, salt, or __v fields');

    // 15. Regression Checks across all prior Admin modules
    console.log('\n--- TEST 13: Regression Checks (All Prior Admin Modules) ---');
    const meRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/me',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(meRes.status === 200, 'GET /admin/auth/me still works');

    const usersRes = await makeRequest(server, {
      path: '/api/v1/admin/users',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(usersRes.status === 200, 'GET /admin/users still works');

    const friendshipsRes = await makeRequest(server, {
      path: '/api/v1/admin/friendships',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(friendshipsRes.status === 200, 'GET /admin/friendships still works');

    const interestsRes = await makeRequest(server, {
      path: '/api/v1/admin/interests',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(interestsRes.status === 200, 'GET /admin/interests still works');

    const friendReqsRes = await makeRequest(server, {
      path: '/api/v1/admin/friend-requests',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(friendReqsRes.status === 200, 'GET /admin/friend-requests still works');

    const voiceCallsRes = await makeRequest(server, {
      path: '/api/v1/admin/voice-calls',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(voiceCallsRes.status === 200, 'GET /admin/voice-calls still works');

    const reportsRes = await makeRequest(server, {
      path: '/api/v1/admin/reports',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(reportsRes.status === 200, 'GET /admin/reports still works');

    const blockedRes = await makeRequest(server, {
      path: '/api/v1/admin/blocked-users',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(blockedRes.status === 200, 'GET /admin/blocked-users still works');

  } finally {
    // 16. Clean up temporary test data from MongoDB
    console.log('\n--- TEST 14: Clean up Temporary Test Data ---');
    const delNotifs = await Notification.deleteMany({ id: { $regex: /^TEST_NTF_/ } });
    const delUsers = await User.deleteMany({ id: { $regex: /^TEST_NTF_/ } });
    console.log(`[Cleanup] Removed ${delNotifs.deletedCount} test notification(s) and ${delUsers.deletedCount} test user(s) from MongoDB.`);

    const remainingNotifs = await Notification.countDocuments({ id: { $regex: /^TEST_NTF_/ } });
    const remainingUsers = await User.countDocuments({ id: { $regex: /^TEST_NTF_/ } });
    assert(remainingNotifs === 0 && remainingUsers === 0, 'Zero temporary test notifications or users remain in MongoDB');

    server.close();
    await disconnectDB();
  }

  console.log('\n====================================================');
  console.log(`📊 Test Results: ${testsPassed} Passed, ${testsFailed} Failed`);
  console.log('====================================================');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTests().catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
