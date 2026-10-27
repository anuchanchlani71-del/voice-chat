const http = require('http');
const app = require('../src/app');
const config = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const { seedDefaultAdmin } = require('../src/seed/seedAdmin');
const User = require('../src/models/User');
const Report = require('../src/models/Report');
const Block = require('../src/models/Block');
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
 * Main Test Runner for Admin Safety & Moderation APIs
 */
async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Admin Safety & Moderation APIs Backend Test Suite');
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
  assert(true, 'Connected to MongoDB for Safety & Moderation test suite');

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
  let tempReport1 = null;
  let tempReport2 = null;
  let tempBlock1 = null;
  let tempNotif1 = null;

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

    // 5. Unauthorized request guards -> 401
    console.log('\n--- TEST 3: Unauthenticated Request Guards (401) ---');
    const unauthOverview = await makeRequest(server, {
      path: '/api/v1/admin/safety/overview',
      method: 'GET'
    });
    assert(unauthOverview.status === 401, 'GET /admin/safety/overview without token returns HTTP 401');

    const unauthFlagged = await makeRequest(server, {
      path: '/api/v1/admin/safety/flagged-users',
      method: 'GET'
    });
    assert(unauthFlagged.status === 401, 'GET /admin/safety/flagged-users without token returns HTTP 401');

    const unauthPatchReport = await makeRequest(server, {
      path: '/api/v1/admin/reports/rep_test_123/status',
      method: 'PATCH'
    }, { status: 'resolved' });
    assert(unauthPatchReport.status === 401, 'PATCH /admin/reports/:id/status without token returns HTTP 401');

    // 6. Setup Temporary Test Data
    console.log('\n--- TEST 4: Setup Temporary Test Data ---');
    tempUserA = new User({
      id: 'TEST_SFT_USER_01',
      username: 'test_sft_ananya',
      fullName: 'Ananya Singh',
      interests: ['Cinema'],
      accountStatus: 'active',
      reportsCount: 0
    });
    await tempUserA.save();

    tempUserB = new User({
      id: 'TEST_SFT_USER_02',
      username: 'test_sft_vikram',
      fullName: 'Vikram Rathore',
      interests: ['Gaming'],
      accountStatus: 'suspended',
      reportsCount: 4,
      isBlocked: true
    });
    await tempUserB.save();

    tempUserC = new User({
      id: 'TEST_SFT_USER_03',
      username: 'test_sft_priya',
      fullName: 'Priya Deshmukh',
      interests: ['Books'],
      accountStatus: 'active',
      reportsCount: 1
    });
    await tempUserC.save();

    // Create Report 1 (Pending)
    tempReport1 = new Report({
      id: 'TEST_SFT_REP_01',
      reporter: tempUserA._id,
      reportedUser: tempUserB._id,
      reasonCategory: 'Harassment / Verbal Abuse',
      reason: 'Abusive language during call',
      description: 'Hostile conduct during voice connection.',
      status: 'pending',
      severity: 'high',
      notes: 'Initial triage note'
    });
    await tempReport1.save();

    // Create Report 2 (Pending)
    tempReport2 = new Report({
      id: 'TEST_SFT_REP_02',
      reporter: tempUserC._id,
      reportedUser: tempUserB._id,
      reasonCategory: 'Spam / Bot Account',
      description: 'Bulk unsolicited friend requests.',
      status: 'pending',
      severity: 'medium'
    });
    await tempReport2.save();

    // Create Block 1
    tempBlock1 = new Block({
      id: 'TEST_SFT_BLK_01',
      blockedUser: tempUserB._id,
      blockedBy: tempUserA._id,
      reason: 'Harassment during call',
      status: 'active'
    });
    await tempBlock1.save();

    // Create Notification 1
    tempNotif1 = new Notification({
      id: 'TEST_SFT_NTF_01',
      targetUser: tempUserB._id,
      type: 'safety_alert',
      title: 'Safety Warning',
      message: 'Account flagged for high request rate.',
      status: 'Delivered'
    });
    await tempNotif1.save();

    assert(Boolean(tempUserA.id) && Boolean(tempReport1.id) && Boolean(tempBlock1.id) && Boolean(tempNotif1.id),
      'Temporary test users, reports, blocks, and notifications created in MongoDB');

    // 7. GET /api/v1/admin/safety/overview
    console.log('\n--- TEST 5: GET /api/v1/admin/safety/overview ---');
    const overviewRes = await makeRequest(server, {
      path: '/api/v1/admin/safety/overview',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(overviewRes.status === 200, 'GET /admin/safety/overview returns HTTP 200');
    assert(overviewRes.body.success === true, 'Response contains success: true');
    assert(Boolean(overviewRes.body.metrics), 'Response contains metrics object');
    assert(overviewRes.body.metrics.activeReportsCount >= 2, 'activeReportsCount >= 2');
    assert(overviewRes.body.metrics.criticalFlaggedUsers >= 2, 'criticalFlaggedUsers >= 2');
    assert(overviewRes.body.metrics.dailyBlockIncidents >= 1, 'dailyBlockIncidents >= 1');
    assert(overviewRes.body.metrics.suspendedUsersCount >= 1, 'suspendedUsersCount >= 1');
    assert(overviewRes.body.thresholds === undefined, 'No hardcoded thresholds returned');

    // 8. GET /api/v1/admin/safety/flagged-users
    console.log('\n--- TEST 6: GET /api/v1/admin/safety/flagged-users (Listing & Pagination) ---');
    const flaggedRes = await makeRequest(server, {
      path: '/api/v1/admin/safety/flagged-users?page=1&limit=10',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(flaggedRes.status === 200, 'GET /admin/safety/flagged-users returns HTTP 200');
    assert(flaggedRes.body.success === true, 'Response contains success: true');
    assert(Array.isArray(flaggedRes.body.flaggedUsers) && flaggedRes.body.flaggedUsers.length >= 2,
      'Returns flaggedUsers array with >= 2 users');
    assert(Boolean(flaggedRes.body.pagination), 'Response contains pagination metadata');
    assert(flaggedRes.body.flaggedUsers[0].reportsCount >= flaggedRes.body.flaggedUsers[1].reportsCount,
      'Flagged users sorted by reportsCount descending');

    // 9. Flagged users search filter
    console.log('\n--- TEST 7: GET /admin/safety/flagged-users?search=vikram ---');
    const searchFlagged = await makeRequest(server, {
      path: '/api/v1/admin/safety/flagged-users?search=vikram',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(searchFlagged.status === 200, 'Search flagged users returns HTTP 200');
    assert(searchFlagged.body.flaggedUsers.some(u => u.username === 'test_sft_vikram'),
      'Found flagged user matching "vikram"');

    // 10. Flagged users accountStatus filter
    console.log('\n--- TEST 8: GET /admin/safety/flagged-users?accountStatus=suspended ---');
    const suspendedFlagged = await makeRequest(server, {
      path: '/api/v1/admin/safety/flagged-users?accountStatus=suspended',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(suspendedFlagged.status === 200, 'Suspended filter returns HTTP 200');
    assert(suspendedFlagged.body.flaggedUsers.every(u => u.accountStatus === 'suspended'),
      'All returned flagged users have accountStatus === "suspended"');

    // 11. PATCH /api/v1/admin/reports/:id/status (Resolve Report)
    console.log('\n--- TEST 9: PATCH /admin/reports/:id/status (Resolve Report) ---');
    const resolveRes = await makeRequest(server, {
      path: `/api/v1/admin/reports/${tempReport1.id}/status`,
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      status: 'resolved',
      resolutionAction: 'Warning Notification Issued',
      notes: 'User received official warning.'
    });
    assert(resolveRes.status === 200, 'Resolve report returns HTTP 200');
    assert(resolveRes.body.success === true, 'Response contains success: true');
    assert(resolveRes.body.report.status === 'resolved', 'Report status updated to "resolved"');
    assert(resolveRes.body.report.resolutionAction === 'Warning Notification Issued', 'resolutionAction updated');
    assert(resolveRes.body.report.notes === 'User received official warning.', 'notes updated');
    assert(Boolean(resolveRes.body.report.resolvedAt), 'resolvedAt timestamp populated');
    assert(Boolean(resolveRes.body.report.resolvedBy), 'resolvedBy admin populated');

    // 12. PATCH /api/v1/admin/reports/:id/status (Dismiss Report)
    console.log('\n--- TEST 10: PATCH /admin/reports/:id/status (Dismiss Report) ---');
    const dismissRes = await makeRequest(server, {
      path: `/api/v1/admin/reports/${tempReport2.id}/status`,
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      status: 'dismissed',
      resolutionAction: 'Dismissed - No Violation Found',
      notes: 'Checked and verified.'
    });
    assert(dismissRes.status === 200, 'Dismiss report returns HTTP 200');
    assert(dismissRes.body.report.status === 'dismissed', 'Report status updated to "dismissed"');
    assert(dismissRes.body.report.resolutionAction === 'Dismissed - No Violation Found', 'resolutionAction updated');

    // 13. PATCH /api/v1/admin/reports/:id/status Validation
    console.log('\n--- TEST 11: PATCH /admin/reports/:id/status Validation ---');
    const pendingStatusRes = await makeRequest(server, {
      path: `/api/v1/admin/reports/${tempReport1.id}/status`,
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      status: 'pending'
    });
    assert(pendingStatusRes.status === 400, 'Pending status returns HTTP 400 Bad Request');

    const invalidStatusRes = await makeRequest(server, {
      path: `/api/v1/admin/reports/${tempReport1.id}/status`,
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      status: 'invalid_status_value'
    });
    assert(invalidStatusRes.status === 400, 'Invalid status returns HTTP 400 Bad Request');

    const missingStatusRes = await makeRequest(server, {
      path: `/api/v1/admin/reports/${tempReport1.id}/status`,
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {});
    assert(missingStatusRes.status === 400, 'Missing status returns HTTP 400 Bad Request');

    const notFoundRes = await makeRequest(server, {
      path: '/api/v1/admin/reports/non_existent_rep_99999/status',
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      status: 'resolved'
    });
    assert(notFoundRes.status === 404, 'Non-existent report returns HTTP 404 Not Found');

    // 14. Credential Sanitization Audit
    console.log('\n--- TEST 12: Credential Sanitization Audit ---');
    const overviewRaw = JSON.stringify(overviewRes.body);
    const flaggedRaw = JSON.stringify(flaggedRes.body);
    const resolveRaw = JSON.stringify(resolveRes.body);

    assert(!overviewRaw.includes('passwordHash') && !overviewRaw.includes('salt') && !overviewRaw.includes('__v'),
      'Overview response contains zero passwordHash, salt, or __v');
    assert(!flaggedRaw.includes('passwordHash') && !flaggedRaw.includes('salt') && !flaggedRaw.includes('__v'),
      'Flagged users response contains zero passwordHash, salt, or __v');
    assert(!resolveRaw.includes('passwordHash') && !resolveRaw.includes('salt') && !resolveRaw.includes('__v'),
      'Resolved report response contains zero passwordHash, salt, or __v');

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

    const notifsRes = await makeRequest(server, {
      path: '/api/v1/admin/notifications',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(notifsRes.status === 200, 'GET /admin/notifications still works');

  } finally {
    // 16. Clean up temporary test data from MongoDB
    console.log('\n--- TEST 14: Clean up Temporary Test Data ---');
    const delReps = await Report.deleteMany({ id: { $regex: /^TEST_SFT_/ } });
    const delBlks = await Block.deleteMany({ id: { $regex: /^TEST_SFT_/ } });
    const delNtfs = await Notification.deleteMany({ id: { $regex: /^TEST_SFT_/ } });
    const delUsers = await User.deleteMany({ id: { $regex: /^TEST_SFT_/ } });
    console.log(`[Cleanup] Removed ${delReps.deletedCount} test report(s), ${delBlks.deletedCount} test block(s), ${delNtfs.deletedCount} test notification(s), and ${delUsers.deletedCount} test user(s) from MongoDB.`);

    const remainingReps = await Report.countDocuments({ id: { $regex: /^TEST_SFT_/ } });
    const remainingUsers = await User.countDocuments({ id: { $regex: /^TEST_SFT_/ } });
    assert(remainingReps === 0 && remainingUsers === 0, 'Zero temporary test records remain in MongoDB');

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
