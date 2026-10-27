const http = require('http');
const app = require('../src/app');
const config = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const { seedDefaultAdmin } = require('../src/seed/seedAdmin');
const User = require('../src/models/User');
const FriendRequest = require('../src/models/FriendRequest');

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
 * Main Test Runner for Admin Friend Requests APIs
 */
async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Admin Friend Requests APIs Backend Test Suite');
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
  assert(true, 'Connected to MongoDB for Friend Requests test suite');

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
  let tempUserD = null;
  let tempReq1 = null;
  let tempReq2 = null;
  let tempReq3 = null;
  let tempReq4 = null;

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

    // 5. Unauthenticated GET /api/v1/admin/friend-requests -> Expect 401
    console.log('\n--- TEST 3: Unauthenticated Access Guard ---');
    const unauthRes = await makeRequest(server, {
      path: '/api/v1/admin/friend-requests',
      method: 'GET'
    });
    assert(unauthRes.status === 401, 'GET /admin/friend-requests without token returns HTTP 401 Unauthorized');

    const unauthDetailRes = await makeRequest(server, {
      path: '/api/v1/admin/friend-requests/freq_12345',
      method: 'GET'
    });
    assert(unauthDetailRes.status === 401, 'GET /admin/friend-requests/:id without token returns HTTP 401 Unauthorized');

    // 6. Setup Temporary Test Users & Friend Requests
    console.log('\n--- TEST 4: Setup Temporary Test Data ---');
    tempUserA = new User({
      id: 'TEST_FREQ_USER_01',
      username: 'test_freq_alice',
      fullName: 'Alice Walker',
      interests: ['Photography', 'Music'],
      accountStatus: 'active'
    });
    await tempUserA.save();

    tempUserB = new User({
      id: 'TEST_FREQ_USER_02',
      username: 'test_freq_bob',
      fullName: 'Bob Martinez',
      interests: ['Gaming', 'Photography'],
      accountStatus: 'active'
    });
    await tempUserB.save();

    tempUserC = new User({
      id: 'TEST_FREQ_USER_03',
      username: 'test_freq_clara',
      fullName: 'Clara Oswald',
      interests: ['Travel', 'Art'],
      accountStatus: 'active'
    });
    await tempUserC.save();

    tempUserD = new User({
      id: 'TEST_FREQ_USER_04',
      username: 'test_freq_david',
      fullName: 'David Tennant',
      interests: ['Cinema', 'Music'],
      accountStatus: 'active'
    });
    await tempUserD.save();

    // Create Friend Request 1: Alice -> Bob (Pending)
    tempReq1 = new FriendRequest({
      id: 'TEST_FREQ_DOC_01',
      requester: tempUserA._id,
      recipient: tempUserB._id,
      status: 'pending',
      matchedInterests: ['Photography'],
      requestedAt: '2026-09-23 10:00:00'
    });
    await tempReq1.save();

    // Create Friend Request 2: Alice -> Clara (Accepted)
    tempReq2 = new FriendRequest({
      id: 'TEST_FREQ_DOC_02',
      requester: tempUserA._id,
      recipient: tempUserC._id,
      status: 'accepted',
      matchedInterests: ['Music'],
      requestedAt: '2026-09-23 10:30:00',
      respondedAt: '2026-09-23 10:45:00'
    });
    await tempReq2.save();

    // Create Friend Request 3: Bob -> Clara (Rejected)
    tempReq3 = new FriendRequest({
      id: 'TEST_FREQ_DOC_03',
      requester: tempUserB._id,
      recipient: tempUserC._id,
      status: 'rejected',
      matchedInterests: [],
      requestedAt: '2026-09-23 11:00:00',
      respondedAt: '2026-09-23 11:10:00'
    });
    await tempReq3.save();

    // Create Friend Request 4: David -> Bob (Cancelled)
    tempReq4 = new FriendRequest({
      id: 'TEST_FREQ_DOC_04',
      requester: tempUserD._id,
      recipient: tempUserB._id,
      status: 'cancelled',
      matchedInterests: ['Gaming'],
      requestedAt: '2026-09-23 12:00:00',
      respondedAt: '2026-09-23 12:05:00'
    });
    await tempReq4.save();

    assert(Boolean(tempReq1.id) && Boolean(tempReq2.id) && Boolean(tempReq3.id) && Boolean(tempReq4.id),
      'Temporary test friend requests (pending, accepted, rejected, cancelled) created in MongoDB');

    // 7. GET /api/v1/admin/friend-requests with pagination & tab counts
    console.log('\n--- TEST 5: GET /api/v1/admin/friend-requests (Pagination & Tab Counts) ---');
    const listRes = await makeRequest(server, {
      path: '/api/v1/admin/friend-requests?page=1&limit=10',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(listRes.status === 200, 'GET /friend-requests returns HTTP 200');
    assert(listRes.body.success === true, 'Response contains success: true');
    assert(Array.isArray(listRes.body.friendRequests) && listRes.body.friendRequests.length >= 4, 'Response returns friendRequests array');
    assert(listRes.body.counts && listRes.body.counts.all >= 4, 'Response includes tab counts.all >= 4');
    assert(listRes.body.counts.pending >= 1, 'Response counts.pending >= 1');
    assert(listRes.body.counts.accepted >= 1, 'Response counts.accepted >= 1');
    assert(listRes.body.counts.rejected_cancelled >= 2, 'Response counts.rejected_cancelled >= 2');
    assert(listRes.body.pagination && listRes.body.pagination.totalItems >= 4, 'Response includes pagination metadata');

    // 8. GET /api/v1/admin/friend-requests?status=pending
    console.log('\n--- TEST 6: Status Filter: pending ---');
    const pendingRes = await makeRequest(server, {
      path: '/api/v1/admin/friend-requests?status=pending',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(pendingRes.status === 200, 'Pending filter returns HTTP 200');
    assert(pendingRes.body.friendRequests.length >= 1, 'Found pending friend requests');
    assert(pendingRes.body.friendRequests.every(r => r.status === 'pending'), 'All returned records have status === "pending"');

    // 9. GET /api/v1/admin/friend-requests?status=accepted
    console.log('\n--- TEST 7: Status Filter: accepted ---');
    const acceptedRes = await makeRequest(server, {
      path: '/api/v1/admin/friend-requests?status=accepted',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(acceptedRes.status === 200, 'Accepted filter returns HTTP 200');
    assert(acceptedRes.body.friendRequests.length >= 1, 'Found accepted friend requests');
    assert(acceptedRes.body.friendRequests.every(r => r.status === 'accepted'), 'All returned records have status === "accepted"');

    // 10. GET /api/v1/admin/friend-requests?status=rejected_cancelled
    console.log('\n--- TEST 8: Status Filter: rejected_cancelled ---');
    const rejectedCancelledRes = await makeRequest(server, {
      path: '/api/v1/admin/friend-requests?status=rejected_cancelled',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(rejectedCancelledRes.status === 200, 'rejected_cancelled filter returns HTTP 200');
    assert(rejectedCancelledRes.body.friendRequests.length >= 2, 'Found rejected and cancelled friend requests');
    assert(rejectedCancelledRes.body.friendRequests.every(r => ['rejected', 'cancelled'].includes(r.status)),
      'All returned records have status in ["rejected", "cancelled"]');

    // 11. GET /api/v1/admin/friend-requests with search
    console.log('\n--- TEST 9: Search by User / Username ---');
    const searchRes = await makeRequest(server, {
      path: '/api/v1/admin/friend-requests?search=clara',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(searchRes.status === 200, 'Search query returns HTTP 200');
    assert(searchRes.body.friendRequests.some(r => r.recipient && r.recipient.username === 'test_freq_clara'),
      'Search finds friend request involving "clara"');

    // 12. GET /api/v1/admin/friend-requests/:id (Existing ID)
    console.log('\n--- TEST 10: GET /api/v1/admin/friend-requests/:id (Existing ID) ---');
    const detailRes = await makeRequest(server, {
      path: `/api/v1/admin/friend-requests/${tempReq1.id}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(detailRes.status === 200, 'GET /friend-requests/:id returns HTTP 200');
    assert(detailRes.body.success === true, 'Detail response contains success: true');
    assert(detailRes.body.friendRequest.id === tempReq1.id, 'Friend request details match requested record');
    assert(detailRes.body.friendRequest.requester.username === 'test_freq_alice', 'Requester populated correctly');
    assert(detailRes.body.friendRequest.recipient.username === 'test_freq_bob', 'Recipient populated correctly');

    // 13. GET /api/v1/admin/friend-requests/:id (Non-existent ID) -> Expect 404
    console.log('\n--- TEST 11: GET /api/v1/admin/friend-requests/:id (Non-existent ID) ---');
    const notFoundRes = await makeRequest(server, {
      path: '/api/v1/admin/friend-requests/non_existent_freq_99999',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(notFoundRes.status === 404, 'Non-existent friend request returns HTTP 404 Not Found');
    assert(notFoundRes.body.success === false, 'Response contains success: false');

    // 14. Security & Sanitization Audit
    console.log('\n--- TEST 12: Security & Credential Sanitization Audit ---');
    const listRaw = JSON.stringify(listRes.body);
    const detailRaw = JSON.stringify(detailRes.body);

    assert(!listRaw.includes('passwordHash') && !listRaw.includes('salt') && !listRaw.includes('__v'),
      'List response contains zero passwordHash, salt, or __v fields');
    assert(!detailRaw.includes('passwordHash') && !detailRaw.includes('salt') && !detailRaw.includes('__v'),
      'Detail response contains zero passwordHash, salt, or __v fields');

    // 15. Regression Checks: Admin Auth, Users, Friendships, and Interests APIs
    console.log('\n--- TEST 13: Regression Checks (Admin Auth, Users, Friendships, Interests) ---');
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

  } finally {
    // 16. Clean up temporary test data from MongoDB
    console.log('\n--- TEST 14: Clean up Temporary Test Data ---');
    const delReqs = await FriendRequest.deleteMany({ id: { $regex: /^TEST_FREQ_/ } });
    const delUsers = await User.deleteMany({ id: { $regex: /^TEST_FREQ_/ } });
    console.log(`[Cleanup] Removed ${delReqs.deletedCount} test friend request(s) and ${delUsers.deletedCount} test user(s) from MongoDB.`);

    const remainingReqs = await FriendRequest.countDocuments({ id: { $regex: /^TEST_FREQ_/ } });
    const remainingUsers = await User.countDocuments({ id: { $regex: /^TEST_FREQ_/ } });
    assert(remainingReqs === 0 && remainingUsers === 0, 'Zero temporary test friend requests or users remain in MongoDB');

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
