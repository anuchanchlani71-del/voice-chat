const http = require('http');
const app = require('../src/app');
const config = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const { seedDefaultAdmin } = require('../src/seed/seedAdmin');
const User = require('../src/models/User');
const Block = require('../src/models/Block');

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
 * Main Test Runner for Admin Blocked Users APIs
 */
async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Admin Blocked Users APIs Backend Test Suite');
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
  assert(true, 'Connected to MongoDB for Blocked Users test suite');

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
  let tempBlock1 = null;
  let tempBlock2 = null;
  let tempBlock3 = null;

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
      path: '/api/v1/admin/blocked-users',
      method: 'GET'
    });
    assert(unauthRes.status === 401, 'GET /admin/blocked-users without token returns HTTP 401 Unauthorized');

    const unauthDetailRes = await makeRequest(server, {
      path: '/api/v1/admin/blocked-users/blk_12345',
      method: 'GET'
    });
    assert(unauthDetailRes.status === 401, 'GET /admin/blocked-users/:id without token returns HTTP 401 Unauthorized');

    // 6. Setup Temporary Test Users & Block Records
    console.log('\n--- TEST 4: Setup Temporary Test Data ---');
    tempUserA = new User({
      id: 'TEST_BLK_USER_01',
      username: 'test_blk_ananya',
      fullName: 'Ananya Singh',
      interests: ['Cinema'],
      accountStatus: 'active'
    });
    await tempUserA.save();

    tempUserB = new User({
      id: 'TEST_BLK_USER_02',
      username: 'test_blk_vikram',
      fullName: 'Vikram Rathore',
      interests: ['Gaming'],
      accountStatus: 'active',
      isBlocked: true
    });
    await tempUserB.save();

    tempUserC = new User({
      id: 'TEST_BLK_USER_03',
      username: 'test_blk_priya',
      fullName: 'Priya Deshmukh',
      interests: ['Books'],
      accountStatus: 'active'
    });
    await tempUserC.save();

    tempUserD = new User({
      id: 'TEST_BLK_USER_04',
      username: 'test_blk_kabir',
      fullName: 'Kabir Khan',
      interests: ['Podcasts'],
      accountStatus: 'active'
    });
    await tempUserD.save();

    // Block 1: Ananya blocks Vikram (Active - Harassment)
    tempBlock1 = new Block({
      id: 'TEST_BLK_DOC_01',
      blockedUser: tempUserB._id,
      blockedBy: tempUserA._id,
      reason: 'Harassment & abusive language during 1-to-1 voice chat',
      status: 'active',
      date: '2026-09-23 10:22'
    });
    await tempBlock1.save();

    // Block 2: Priya blocks Vikram (Active - Spam)
    tempBlock2 = new Block({
      id: 'TEST_BLK_DOC_02',
      blockedUser: tempUserB._id,
      blockedBy: tempUserC._id,
      reason: 'Unsolicited spam requests and unwanted messages',
      status: 'active',
      date: '2026-09-23 11:50'
    });
    await tempBlock2.save();

    // Block 3: Kabir blocks Ananya (Released - Preference)
    tempBlock3 = new Block({
      id: 'TEST_BLK_DOC_03',
      blockedUser: tempUserA._id,
      blockedBy: tempUserD._id,
      reason: 'Personal preference / mismatched conversation style',
      status: 'released',
      date: '2026-09-21 15:00',
      releasedAt: '2026-09-22 09:00'
    });
    await tempBlock3.save();

    assert(Boolean(tempBlock1.id) && Boolean(tempBlock2.id) && Boolean(tempBlock3.id),
      'Temporary test block records (active & released) created in MongoDB');

    // 7. GET /api/v1/admin/blocked-users (Pagination & Tab Counts)
    console.log('\n--- TEST 5: GET /api/v1/admin/blocked-users (Listing & Counts) ---');
    const listRes = await makeRequest(server, {
      path: '/api/v1/admin/blocked-users?page=1&limit=10',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(listRes.status === 200, 'GET /blocked-users returns HTTP 200');
    assert(listRes.body.success === true, 'Response contains success: true');
    assert(Array.isArray(listRes.body.blockedUsers) && listRes.body.blockedUsers.length >= 3, 'Returns blockedUsers array with >= 3 records');
    assert(listRes.body.counts && listRes.body.counts.all >= 3, 'Tab counts.all >= 3');
    assert(listRes.body.counts.active >= 2, 'Tab counts.active >= 2');
    assert(listRes.body.counts.released >= 1, 'Tab counts.released >= 1');
    assert(Boolean(listRes.body.pagination), 'Pagination metadata present');

    // 8. Filter by status: active
    console.log('\n--- TEST 6: Status Filter: active ---');
    const activeRes = await makeRequest(server, {
      path: '/api/v1/admin/blocked-users?status=active',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(activeRes.status === 200, 'Active status filter returns HTTP 200');
    assert(activeRes.body.blockedUsers.every(b => b.status === 'active'), 'All returned records have status === "active"');

    // 9. Filter by status: released
    console.log('\n--- TEST 7: Status Filter: released ---');
    const releasedRes = await makeRequest(server, {
      path: '/api/v1/admin/blocked-users?status=released',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(releasedRes.status === 200, 'Released status filter returns HTTP 200');
    assert(releasedRes.body.blockedUsers.every(b => b.status === 'released'), 'All returned records have status === "released"');

    // 10. Filter by reason
    console.log('\n--- TEST 8: Reason Filter ---');
    const reasonRes = await makeRequest(server, {
      path: '/api/v1/admin/blocked-users?reason=Harassment',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(reasonRes.status === 200, 'Reason filter returns HTTP 200');
    assert(reasonRes.body.blockedUsers.every(b => b.reason.includes('Harassment')), 'Records match Harassment reason');

    // 11. Search Filter
    console.log('\n--- TEST 9: Search Filter (by User / Reason / ID) ---');
    const searchRes = await makeRequest(server, {
      path: '/api/v1/admin/blocked-users?search=vikram',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(searchRes.status === 200, 'Search query returns HTTP 200');
    assert(searchRes.body.blockedUsers.some(b =>
      (b.blockedUser && b.blockedUser.username === 'test_blk_vikram') ||
      (b.blockedBy && b.blockedBy.username === 'test_blk_vikram')
    ), 'Search finds block relations for "vikram"');

    // 12. Date Range Filter
    console.log('\n--- TEST 10: Date Range Filtering ---');
    const todayStr = new Date().toISOString().split('T')[0];
    const dateRes = await makeRequest(server, {
      path: `/api/v1/admin/blocked-users?startDate=${todayStr}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(dateRes.status === 200, 'Date filter returns HTTP 200');
    assert(dateRes.body.blockedUsers.length >= 1, 'Returns records created on or after startDate');

    // 13. GET /api/v1/admin/blocked-users/:id (Valid ID)
    console.log('\n--- TEST 11: GET /admin/blocked-users/:id (Valid ID) ---');
    const detailRes = await makeRequest(server, {
      path: `/api/v1/admin/blocked-users/${tempBlock1.id}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(detailRes.status === 200, 'GET /admin/blocked-users/:id returns HTTP 200');
    assert(detailRes.body.success === true, 'Detail response contains success: true');
    assert(detailRes.body.blockedUser.id === tempBlock1.id, 'Block ID matches requested record');
    assert(detailRes.body.blockedUser.blockedBy.username === 'test_blk_ananya', 'blockedBy populated accurately');
    assert(detailRes.body.blockedUser.blockedUser.username === 'test_blk_vikram', 'blockedUser populated accurately');
    assert(detailRes.body.blockedUser.reason.includes('Harassment'), 'Reason populated accurately');

    // 14. GET /api/v1/admin/blocked-users/:id (Non-existent ID) -> 404
    console.log('\n--- TEST 12: GET /admin/blocked-users/:id (Non-existent ID) ---');
    const notFoundRes = await makeRequest(server, {
      path: '/api/v1/admin/blocked-users/non_existent_blk_99999',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(notFoundRes.status === 404, 'Non-existent block returns HTTP 404 Not Found');
    assert(notFoundRes.body.success === false, '404 response contains success: false');

    // 15. Credential Sanitization Audit
    console.log('\n--- TEST 13: Credential Sanitization Audit ---');
    const listRaw = JSON.stringify(listRes.body);
    const detailRaw = JSON.stringify(detailRes.body);

    assert(!listRaw.includes('passwordHash') && !listRaw.includes('salt') && !listRaw.includes('__v'),
      'List response contains zero passwordHash, salt, or __v fields');
    assert(!detailRaw.includes('passwordHash') && !detailRaw.includes('salt') && !detailRaw.includes('__v'),
      'Detail response contains zero passwordHash, salt, or __v fields');

    // 16. Regression Checks across all prior Admin modules
    console.log('\n--- TEST 14: Regression Checks (All Prior Admin Modules) ---');
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

  } finally {
    // 17. Clean up temporary test data from MongoDB
    console.log('\n--- TEST 15: Clean up Temporary Test Data ---');
    const delBlocks = await Block.deleteMany({ id: { $regex: /^TEST_BLK_/ } });
    const delUsers = await User.deleteMany({ id: { $regex: /^TEST_BLK_/ } });
    console.log(`[Cleanup] Removed ${delBlocks.deletedCount} test block(s) and ${delUsers.deletedCount} test user(s) from MongoDB.`);

    const remainingBlocks = await Block.countDocuments({ id: { $regex: /^TEST_BLK_/ } });
    const remainingUsers = await User.countDocuments({ id: { $regex: /^TEST_BLK_/ } });
    assert(remainingBlocks === 0 && remainingUsers === 0, 'Zero temporary test blocks or users remain in MongoDB');

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
