const http = require('http');
const app = require('../src/app');
const config = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const { seedDefaultAdmin } = require('../src/seed/seedAdmin');
const Admin = require('../models/Admin');
const User = require('../models/User');

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
 * Main Test Runner for Admin Users APIs
 */
async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Admin Users APIs Backend Test Suite');
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
  assert(true, 'Connected to MongoDB for Users test suite');

  // 2. Ensure Super Admin is seeded
  await seedDefaultAdmin();

  // 3. Start HTTP server on temporary port
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));
  const testPort = server.address().port;
  console.log(`[Test Server] Running on temporary port ${testPort}\n`);

  let tempTestUserId = null;

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
    assert(loginRes.status === 200 && loginRes.body.token, 'Admin logged in and received JWT token');
    const adminToken = loginRes.body.token;

    // 5. Unauthenticated GET /api/v1/admin/users -> Expect 401
    console.log('\n--- TEST 3: Unauthenticated Access Guard ---');
    const unauthRes = await makeRequest(server, {
      path: '/api/v1/admin/users',
      method: 'GET'
    });
    assert(unauthRes.status === 401, 'GET /users without token returns HTTP 401 Unauthorized');

    // 6. Create temporary test user for API verification
    console.log('\n--- TEST 4: Setup Temporary Test User ---');
    const tempUserDoc = new User({
      id: 'TEST_USER_ONLY_usr_999',
      username: 'test_guitarist_dev',
      fullName: 'Test Guitarist Dev',
      bio: 'Temporary test user for API verification',
      interests: ['Music', 'Guitar', 'Indie Pop'],
      isOnline: true,
      lastSeen: 'Just now',
      accountStatus: 'active',
      joinedDate: '2026-09-23',
      friendsCount: 5,
      voiceCallsCount: 12,
      totalVoiceMinutes: 180,
      reportsCount: 0,
      email: 'test_dev@voicefriends.io',
      phone: '+91 99999 00000'
    });
    await tempUserDoc.save();
    tempTestUserId = tempUserDoc.id;
    assert(Boolean(tempTestUserId), `Temporary test user created with ID: ${tempTestUserId}`);

    // 7. GET /api/v1/admin/users with pagination
    console.log('\n--- TEST 5: GET /api/v1/admin/users (Pagination & List) ---');
    const listRes = await makeRequest(server, {
      path: '/api/v1/admin/users?page=1&limit=10',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(listRes.status === 200, 'GET /users returns HTTP 200');
    assert(listRes.body.success === true, 'Response contains success: true');
    assert(Array.isArray(listRes.body.users) && listRes.body.users.length > 0, 'Response contains users array');
    assert(listRes.body.pagination && listRes.body.pagination.totalItems >= 1, 'Pagination object returned with totalItems');

    // 8. GET /api/v1/admin/users with search
    console.log('\n--- TEST 6: GET /api/v1/admin/users?search=guitarist ---');
    const searchRes = await makeRequest(server, {
      path: '/api/v1/admin/users?search=guitarist',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(searchRes.status === 200, 'Search query returns HTTP 200');
    assert(searchRes.body.users.some(u => u.username === 'test_guitarist_dev'), 'Search finds the matching test user');

    // 9. GET /api/v1/admin/users with online presence filter
    console.log('\n--- TEST 7: GET /api/v1/admin/users?isOnline=online ---');
    const onlineRes = await makeRequest(server, {
      path: '/api/v1/admin/users?isOnline=online',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(onlineRes.status === 200, 'Online filter returns HTTP 200');
    assert(onlineRes.body.users.every(u => u.isOnline === true), 'All returned users have isOnline === true');

    // 10. GET /api/v1/admin/users with status filter
    console.log('\n--- TEST 8: GET /api/v1/admin/users?accountStatus=active ---');
    const statusRes = await makeRequest(server, {
      path: '/api/v1/admin/users?accountStatus=active',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(statusRes.status === 200, 'Account status filter returns HTTP 200');
    assert(statusRes.body.users.every(u => u.accountStatus === 'active'), 'All returned users have accountStatus === active');

    // 11. GET /api/v1/admin/users with interest filter
    console.log('\n--- TEST 9: GET /api/v1/admin/users?interest=Guitar ---');
    const interestRes = await makeRequest(server, {
      path: '/api/v1/admin/users?interest=Guitar',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(interestRes.status === 200, 'Interest filter returns HTTP 200');
    assert(interestRes.body.users.some(u => u.interests.includes('Guitar')), 'Returned users include the specified interest tag');

    // 12. GET /api/v1/admin/users/:id (Existing User)
    console.log('\n--- TEST 10: GET /api/v1/admin/users/:id (Existing User) ---');
    const userDetailRes = await makeRequest(server, {
      path: `/api/v1/admin/users/${tempTestUserId}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(userDetailRes.status === 200, 'GET /users/:id returns HTTP 200');
    assert(userDetailRes.body.success === true, 'Response contains success: true');
    assert(userDetailRes.body.user.username === 'test_guitarist_dev', 'User details match requested user profile');
    assert(userDetailRes.body.user.email === 'test_dev@voicefriends.io', 'User details include private email for admin inspection');

    // 13. GET /api/v1/admin/users/:id (Non-existent User) -> Expect 404
    console.log('\n--- TEST 11: GET /api/v1/admin/users/:id (Non-existent User) ---');
    const notFoundRes = await makeRequest(server, {
      path: '/api/v1/admin/users/non_existent_usr_99999',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(notFoundRes.status === 404, 'Non-existent user returns HTTP 404 Not Found');
    assert(notFoundRes.body.success === false, 'Response contains success: false');

    // 14. PATCH /api/v1/admin/users/:id/status (Valid update to suspended)
    console.log('\n--- TEST 12: PATCH /api/v1/admin/users/:id/status (Suspend User) ---');
    const patchRes = await makeRequest(server, {
      path: `/api/v1/admin/users/${tempTestUserId}/status`,
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      accountStatus: 'suspended'
    });
    assert(patchRes.status === 200, 'PATCH /users/:id/status returns HTTP 200');
    assert(patchRes.body.success === true, 'Response contains success: true');
    assert(patchRes.body.user.accountStatus === 'suspended', 'User accountStatus successfully mutated to "suspended" in response');

    // Verify change in MongoDB
    const updatedInDb = await User.findOne({ id: tempTestUserId });
    assert(updatedInDb && updatedInDb.accountStatus === 'suspended', 'MongoDB document accurately reflects "suspended" state');

    // 15. PATCH /api/v1/admin/users/:id/status (Invalid status value) -> Expect 400
    console.log('\n--- TEST 13: PATCH /api/v1/admin/users/:id/status (Invalid Status Validation) ---');
    const invalidStatusRes = await makeRequest(server, {
      path: `/api/v1/admin/users/${tempTestUserId}/status`,
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      accountStatus: 'banned_permanent_fake'
    });
    assert(invalidStatusRes.status === 400, 'Invalid status returns HTTP 400 Bad Request');
    assert(invalidStatusRes.body.success === false, 'Response contains success: false with validation error');

    // 16. PATCH /api/v1/admin/users/:id/status (Non-existent User) -> Expect 404
    console.log('\n--- TEST 14: PATCH /api/v1/admin/users/:id/status (Non-existent User) ---');
    const patchNotFoundRes = await makeRequest(server, {
      path: '/api/v1/admin/users/non_existent_usr_99999/status',
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      accountStatus: 'active'
    });
    assert(patchNotFoundRes.status === 404, 'Patch non-existent user returns HTTP 404 Not Found');

    // 17. Security Audit: No sensitive fields exposed in API responses
    console.log('\n--- TEST 15: Security & Sanitization Audit ---');
    const listRaw = JSON.stringify(listRes.body);
    const detailRaw = JSON.stringify(userDetailRes.body);
    const patchRaw = JSON.stringify(patchRes.body);

    assert(!listRaw.includes('passwordHash') && !listRaw.includes('salt') && !listRaw.includes('__v'),
      'List response contains zero passwordHash, salt, or __v fields');
    assert(!detailRaw.includes('passwordHash') && !detailRaw.includes('salt') && !detailRaw.includes('__v'),
      'Detail response contains zero passwordHash, salt, or __v fields');
    assert(!patchRaw.includes('passwordHash') && !patchRaw.includes('salt') && !patchRaw.includes('__v'),
      'Patch response contains zero passwordHash, salt, or __v fields');

  } finally {
    // 18. Clean up temporary test data from MongoDB
    console.log('\n--- TEST 16: Clean up Temporary Test Data ---');
    if (tempTestUserId) {
      const deleteResult = await User.deleteMany({ id: { $regex: /^TEST_USER_ONLY_/ } });
      console.log(`[Cleanup] Removed ${deleteResult.deletedCount} temporary test user document(s) from MongoDB.`);
    }

    const remainingTestUsers = await User.countDocuments({ id: { $regex: /^TEST_USER_ONLY_/ } });
    assert(remainingTestUsers === 0, 'Zero temporary test users remain in MongoDB');

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
