const http = require('http');
const app = require('../src/app');
const config = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const { seedDefaultAdmin } = require('../src/seed/seedAdmin');
const User = require('../models/User');
const Friendship = require('../models/Friendship');

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
 * Main Test Runner for Admin Friendships APIs
 */
async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Admin Friendships APIs Backend Test Suite');
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
  assert(true, 'Connected to MongoDB for Friendships test suite');

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
  let tempFriendship1 = null;
  let tempFriendship2 = null;

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

    // 5. Unauthenticated GET /api/v1/admin/friendships -> Expect 401
    console.log('\n--- TEST 3: Unauthenticated Access Guard ---');
    const unauthRes = await makeRequest(server, {
      path: '/api/v1/admin/friendships',
      method: 'GET'
    });
    assert(unauthRes.status === 401, 'GET /friendships without token returns HTTP 401 Unauthorized');

    // 6. Setup Temporary Test Users & Friendships
    console.log('\n--- TEST 4: Setup Temporary Test Data ---');
    tempUserA = new User({
      id: 'TEST_FR_USER_01',
      username: 'test_friend_alice',
      fullName: 'Alice Johnson',
      interests: ['Books', 'Music'],
      accountStatus: 'active'
    });
    await tempUserA.save();

    tempUserB = new User({
      id: 'TEST_FR_USER_02',
      username: 'test_friend_bob',
      fullName: 'Bob Smith',
      interests: ['Gaming', 'Tech'],
      accountStatus: 'active'
    });
    await tempUserB.save();

    tempUserC = new User({
      id: 'TEST_FR_USER_03',
      username: 'test_friend_charlie',
      fullName: 'Charlie Davis',
      interests: ['Music', 'Gaming'],
      accountStatus: 'active'
    });
    await tempUserC.save();

    // Create Friendship 1: Alice <-> Bob (Accepted)
    tempFriendship1 = new Friendship({
      id: 'TEST_FR_REL_01',
      requester: tempUserA._id,
      recipient: tempUserB._id,
      status: 'accepted',
      matchedInterests: ['Music'],
      requestedAt: '2026-09-23 10:00',
      acceptedAt: '2026-09-23 10:15',
      voiceCallsCount: 8
    });
    await tempFriendship1.save();

    // Create Friendship 2: Alice <-> Charlie (Pending)
    tempFriendship2 = new Friendship({
      id: 'TEST_FR_REL_02',
      requester: tempUserA._id,
      recipient: tempUserC._id,
      status: 'pending',
      matchedInterests: ['Music'],
      requestedAt: '2026-09-23 11:30',
      acceptedAt: null,
      voiceCallsCount: 0
    });
    await tempFriendship2.save();

    assert(Boolean(tempFriendship1.id) && Boolean(tempFriendship2.id), 'Temporary test friendships created in MongoDB');

    // 7. Test Canonical Duplicate Prevention (Insert reverse pair Bob -> Alice)
    console.log('\n--- TEST 5: Canonical Duplicate Prevention ---');
    let duplicateErrorThrown = false;
    try {
      const duplicateFriendship = new Friendship({
        id: 'TEST_FR_REL_DUP',
        requester: tempUserB._id,
        recipient: tempUserA._id,
        status: 'accepted'
      });
      await duplicateFriendship.save();
    } catch (err) {
      duplicateErrorThrown = true;
      assert(err.code === 11000 || err.message.includes('duplicate') || err.message.includes('E11000'),
        'Duplicate reverse friendship User B -> User A correctly blocked by canonical userPairKey index');
    }
    assert(duplicateErrorThrown, 'Attempting to insert reverse friendship threw duplicate key error');

    // 8. GET /api/v1/admin/friendships with pagination
    console.log('\n--- TEST 6: GET /api/v1/admin/friendships (Pagination & List) ---');
    const listRes = await makeRequest(server, {
      path: '/api/v1/admin/friendships?page=1&limit=10',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(listRes.status === 200, 'GET /friendships returns HTTP 200');
    assert(listRes.body.success === true, 'Response contains success: true');
    assert(Array.isArray(listRes.body.friendships) && listRes.body.friendships.length >= 2, 'Response returns friendships array');
    assert(listRes.body.counts && listRes.body.counts.all >= 2, 'Response includes tab counts object');
    assert(listRes.body.pagination && listRes.body.pagination.totalItems >= 2, 'Response includes pagination metadata');

    // 9. GET /api/v1/admin/friendships?status=accepted
    console.log('\n--- TEST 7: GET /api/v1/admin/friendships?status=accepted ---');
    const acceptedRes = await makeRequest(server, {
      path: '/api/v1/admin/friendships?status=accepted',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(acceptedRes.status === 200, 'Accepted filter returns HTTP 200');
    assert(acceptedRes.body.friendships.every(f => f.status === 'accepted'), 'All returned records have status === "accepted"');

    // 10. GET /api/v1/admin/friendships?status=pending
    console.log('\n--- TEST 8: GET /api/v1/admin/friendships?status=pending ---');
    const pendingRes = await makeRequest(server, {
      path: '/api/v1/admin/friendships?status=pending',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(pendingRes.status === 200, 'Pending filter returns HTTP 200');
    assert(pendingRes.body.friendships.every(f => f.status === 'pending'), 'All returned records have status === "pending"');

    // 11. GET /api/v1/admin/friendships with search
    console.log('\n--- TEST 9: GET /api/v1/admin/friendships?search=charlie ---');
    const searchRes = await makeRequest(server, {
      path: '/api/v1/admin/friendships?search=charlie',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(searchRes.status === 200, 'Search returns HTTP 200');
    assert(searchRes.body.friendships.some(f => f.recipient && f.recipient.username === 'test_friend_charlie'),
      'Search finds friendship matching "charlie"');

    // 12. GET /api/v1/admin/friendships/:id (Existing Friendship)
    console.log('\n--- TEST 10: GET /api/v1/admin/friendships/:id (Existing ID) ---');
    const detailRes = await makeRequest(server, {
      path: `/api/v1/admin/friendships/${tempFriendship1.id}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(detailRes.status === 200, 'GET /friendships/:id returns HTTP 200');
    assert(detailRes.body.success === true, 'Response contains success: true');
    assert(detailRes.body.friendship.id === tempFriendship1.id, 'Friendship details match requested record');
    assert(detailRes.body.friendship.requester.username === 'test_friend_alice', 'Requester populated correctly');
    assert(detailRes.body.friendship.recipient.username === 'test_friend_bob', 'Recipient populated correctly');

    // 13. GET /api/v1/admin/friendships/:id (Non-existent ID) -> Expect 404
    console.log('\n--- TEST 11: GET /api/v1/admin/friendships/:id (Non-existent ID) ---');
    const notFoundRes = await makeRequest(server, {
      path: '/api/v1/admin/friendships/non_existent_fr_99999',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(notFoundRes.status === 404, 'Non-existent friendship returns HTTP 404 Not Found');
    assert(notFoundRes.body.success === false, 'Response contains success: false');

    // 14. Security Audit: No sensitive fields exposed
    console.log('\n--- TEST 12: Security & Sanitization Audit ---');
    const listRaw = JSON.stringify(listRes.body);
    const detailRaw = JSON.stringify(detailRes.body);

    assert(!listRaw.includes('passwordHash') && !listRaw.includes('salt') && !listRaw.includes('__v'),
      'List response contains zero passwordHash, salt, or __v fields');
    assert(!detailRaw.includes('passwordHash') && !detailRaw.includes('salt') && !detailRaw.includes('__v'),
      'Detail response contains zero passwordHash, salt, or __v fields');

    // 15. Regression Check: Admin Auth & Users APIs still work
    console.log('\n--- TEST 13: Regression Checks (Admin Auth & Admin Users) ---');
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

  } finally {
    // 16. Clean up temporary test data from MongoDB
    console.log('\n--- TEST 14: Clean up Temporary Test Data ---');
    const delRel = await Friendship.deleteMany({ id: { $regex: /^TEST_FR_/ } });
    const delUsers = await User.deleteMany({ id: { $regex: /^TEST_FR_/ } });
    console.log(`[Cleanup] Removed ${delRel.deletedCount} test friendship(s) and ${delUsers.deletedCount} test user(s) from MongoDB.`);

    const remainingRel = await Friendship.countDocuments({ id: { $regex: /^TEST_FR_/ } });
    const remainingUsers = await User.countDocuments({ id: { $regex: /^TEST_FR_/ } });
    assert(remainingRel === 0 && remainingUsers === 0, 'Zero temporary test friendships or users remain in MongoDB');

    server.close();
    await disconnectDB();
  }

  console.log('\n====================================================');
  console.log(`📊 Test Results: ${testsPassed} Passed, ${testsFailed} Failed`);
  console.log('====================================================');
}

if (require.main === module) {
  runTests().catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
