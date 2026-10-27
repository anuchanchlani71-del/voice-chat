const http = require('http');
const app = require('../src/app');
const config = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const { seedDefaultAdmin } = require('../src/seed/seedAdmin');
const User = require('../src/models/User');
const Report = require('../src/models/Report');

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
 * Main Test Runner for Admin Moderation Reports APIs
 */
async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Admin Reports APIs Backend Test Suite');
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
  assert(true, 'Connected to MongoDB for Reports test suite');

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
  let tempRep1 = null;
  let tempRep2 = null;
  let tempRep3 = null;
  let tempRep4 = null;

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

    // 5. Scenario J: Unauthorized request -> 401
    console.log('\n--- TEST 3: Scenario J - Unauthorized Request Guard (401) ---');
    const unauthRes = await makeRequest(server, {
      path: '/api/v1/admin/reports',
      method: 'GET'
    });
    assert(unauthRes.status === 401, 'GET /admin/reports without token returns HTTP 401 Unauthorized');

    const unauthDetailRes = await makeRequest(server, {
      path: '/api/v1/admin/reports/rep_12345',
      method: 'GET'
    });
    assert(unauthDetailRes.status === 401, 'GET /admin/reports/:id without token returns HTTP 401 Unauthorized');

    // 6. Scenario A: GET reports with empty database / before test records
    console.log('\n--- TEST 4: Scenario A - GET reports structure validation ---');
    const initialRes = await makeRequest(server, {
      path: '/api/v1/admin/reports',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(initialRes.status === 200, 'GET /admin/reports returns HTTP 200');
    assert(Array.isArray(initialRes.body.reports), 'reports is an array');
    assert(Boolean(initialRes.body.counts) && typeof initialRes.body.counts.all === 'number', 'counts object is provided');
    assert(Boolean(initialRes.body.pagination), 'pagination metadata is provided');

    // 7. Setup Temporary Test Users & Moderation Reports
    console.log('\n--- TEST 5: Setup Temporary Test Data ---');
    tempUserA = new User({
      id: 'TEST_REP_USER_01',
      username: 'test_rep_ananya',
      fullName: 'Ananya Singh',
      interests: ['Cinema', 'Anime'],
      accountStatus: 'active'
    });
    await tempUserA.save();

    tempUserB = new User({
      id: 'TEST_REP_USER_02',
      username: 'test_rep_vikram',
      fullName: 'Vikram Rathore',
      interests: ['Gaming'],
      accountStatus: 'active',
      reportsCount: 3,
      isBlocked: true
    });
    await tempUserB.save();

    tempUserC = new User({
      id: 'TEST_REP_USER_03',
      username: 'test_rep_priya',
      fullName: 'Priya Deshmukh',
      interests: ['Books', 'Philosophy'],
      accountStatus: 'active'
    });
    await tempUserC.save();

    tempUserD = new User({
      id: 'TEST_REP_USER_04',
      username: 'test_rep_rohan',
      fullName: 'Rohan Verma',
      interests: ['Tech'],
      accountStatus: 'active'
    });
    await tempUserD.save();

    // Report 1: Ananya reports Vikram (Harassment / Verbal Abuse - Pending)
    tempRep1 = new Report({
      id: 'TEST_REP_DOC_01',
      reporter: tempUserA._id,
      reportedUser: tempUserB._id,
      reasonCategory: 'Harassment / Verbal Abuse',
      reason: 'Abusive language during call',
      description: 'User made threatening and aggressive remarks immediately after connecting voice call.',
      status: 'pending',
      severity: 'high',
      notes: 'Requires immediate action. User already has prior flags.',
      date: '2026-09-23 10:20'
    });
    await tempRep1.save();

    // Report 2: Priya reports Vikram (Spam / Bot Account - Pending)
    tempRep2 = new Report({
      id: 'TEST_REP_DOC_02',
      reporter: tempUserC._id,
      reportedUser: tempUserB._id,
      reasonCategory: 'Spam / Bot Account',
      reason: 'Unsolicited spam requests',
      description: 'Sent copy-pasted suspicious external links and unsolicited requests.',
      status: 'pending',
      severity: 'medium',
      notes: 'Automated spam heuristic caught multiple outgoing requests.',
      date: '2026-09-23 11:45'
    });
    await tempRep2.save();

    // Report 3: Rohan reports Ananya (Mic Spam / Noise Distortion - Resolved)
    tempRep3 = new Report({
      id: 'TEST_REP_DOC_03',
      reporter: tempUserD._id,
      reportedUser: tempUserA._id,
      reasonCategory: 'Mic Spam / Noise Distortion',
      reason: 'Excessive loud music feedback',
      description: 'Loud music feedback during 1-to-1 conversation.',
      status: 'resolved',
      severity: 'low',
      notes: 'User warned to adjust microphone input settings.',
      date: '2026-09-22 14:30',
      resolvedAt: '2026-09-22 15:00',
      resolutionAction: 'Warning Notification Issued'
    });
    await tempRep3.save();

    // Report 4: Priya reports Rohan (Inappropriate Bio / Profile Info - Dismissed)
    tempRep4 = new Report({
      id: 'TEST_REP_DOC_04',
      reporter: tempUserC._id,
      reportedUser: tempUserD._id,
      reasonCategory: 'Inappropriate Bio / Profile Info',
      reason: 'Reported profile bio description',
      description: 'Reported profile bio for non-standard terminology.',
      status: 'dismissed',
      severity: 'low',
      notes: 'Checked by moderator and verified within acceptable guidelines.',
      date: '2026-09-21 09:15',
      resolvedAt: '2026-09-21 09:30',
      resolutionAction: 'Dismissed - No Violation'
    });
    await tempRep4.save();

    assert(Boolean(tempRep1.id) && Boolean(tempRep2.id) && Boolean(tempRep3.id) && Boolean(tempRep4.id),
      'Temporary test moderation reports (pending, resolved, dismissed) created in MongoDB');

    // 8. Scenario B: GET reports with report records & Tab Counts
    console.log('\n--- TEST 6: Scenario B - GET reports with Records & Tab Counts ---');
    const listRes = await makeRequest(server, {
      path: '/api/v1/admin/reports?page=1&limit=10',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(listRes.status === 200, 'GET /reports returns HTTP 200');
    assert(listRes.body.success === true, 'Response contains success: true');
    assert(Array.isArray(listRes.body.reports) && listRes.body.reports.length >= 4, 'Returns reports array with >= 4 records');
    assert(listRes.body.counts && listRes.body.counts.all >= 4, 'Tab counts.all >= 4');
    assert(listRes.body.counts.pending >= 2, 'Tab counts.pending >= 2');
    assert(listRes.body.counts.resolved >= 1, 'Tab counts.resolved >= 1');
    assert(listRes.body.counts.dismissed >= 1, 'Tab counts.dismissed >= 1');

    // 9. Scenario C: Pagination
    console.log('\n--- TEST 7: Scenario C - Pagination ---');
    const pagRes = await makeRequest(server, {
      path: '/api/v1/admin/reports?page=1&limit=2',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(pagRes.status === 200, 'Pagination request returns HTTP 200');
    assert(pagRes.body.reports.length === 2, 'Page size 2 returns exactly 2 records');
    assert(pagRes.body.pagination.currentPage === 1, 'currentPage is 1');
    assert(pagRes.body.pagination.pageSize === 2, 'pageSize is 2');
    assert(pagRes.body.pagination.totalPages >= 2, 'totalPages calculated correctly');

    // 10. Scenario D: Status Filtering
    console.log('\n--- TEST 8: Scenario D - Status Filtering (pending, resolved, dismissed) ---');
    const pendingRes = await makeRequest(server, {
      path: '/api/v1/admin/reports?status=pending',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(pendingRes.status === 200, 'Pending filter returns HTTP 200');
    assert(pendingRes.body.reports.every(r => r.status === 'pending'), 'All records have status === "pending"');

    const resolvedRes = await makeRequest(server, {
      path: '/api/v1/admin/reports?status=resolved',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(resolvedRes.status === 200, 'Resolved filter returns HTTP 200');
    assert(resolvedRes.body.reports.every(r => r.status === 'resolved'), 'All records have status === "resolved"');

    const dismissedRes = await makeRequest(server, {
      path: '/api/v1/admin/reports?status=dismissed',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(dismissedRes.status === 200, 'Dismissed filter returns HTTP 200');
    assert(dismissedRes.body.reports.every(r => r.status === 'dismissed'), 'All records have status === "dismissed"');

    // 11. Scenario E: Type / Category Filtering
    console.log('\n--- TEST 9: Scenario E - Type / Category Filtering ---');
    const catRes = await makeRequest(server, {
      path: '/api/v1/admin/reports?type=Harassment',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(catRes.status === 200, 'Category filter returns HTTP 200');
    assert(catRes.body.reports.every(r => r.reasonCategory.includes('Harassment')), 'All records match Harassment category');

    // 12. Scenario F: Search Filter
    console.log('\n--- TEST 10: Scenario F - Search Filter ---');
    const searchRes = await makeRequest(server, {
      path: '/api/v1/admin/reports?search=vikram',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(searchRes.status === 200, 'Search filter returns HTTP 200');
    assert(searchRes.body.reports.some(r =>
      (r.reportedUser && r.reportedUser.username === 'test_rep_vikram') ||
      (r.reporter && r.reporter.username === 'test_rep_vikram')
    ), 'Search finds reports associated with "vikram"');

    // 13. Scenario G: Date Range Filtering
    console.log('\n--- TEST 11: Scenario G - Date Range Filtering ---');
    const todayStr = new Date().toISOString().split('T')[0];
    const dateRes = await makeRequest(server, {
      path: `/api/v1/admin/reports?startDate=${todayStr}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(dateRes.status === 200, 'Date filter returns HTTP 200');
    assert(dateRes.body.reports.length >= 1, 'Returns records created on or after startDate');

    // 14. Scenario H: GET report by valid ID
    console.log('\n--- TEST 12: Scenario H - GET Report by Valid ID ---');
    const detailRes = await makeRequest(server, {
      path: `/api/v1/admin/reports/${tempRep1.id}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(detailRes.status === 200, 'GET /admin/reports/:id returns HTTP 200');
    assert(detailRes.body.success === true, 'Response contains success: true');
    assert(detailRes.body.report.id === tempRep1.id, 'Report ID matches requested record');
    assert(detailRes.body.report.reporter.username === 'test_rep_ananya', 'Reporter profile populated correctly');
    assert(detailRes.body.report.reportedUser.username === 'test_rep_vikram', 'Reported user profile populated correctly');
    assert(detailRes.body.report.reportedUser.isBlocked === true, 'Reported user isBlocked field is populated');
    assert(detailRes.body.report.severity === 'high', 'Severity populated correctly');
    assert(detailRes.body.report.description.includes('threatening'), 'Description populated correctly');

    // 15. Scenario I: GET report by invalid/non-existing ID -> 404
    console.log('\n--- TEST 13: Scenario I - Non-existent ID (404) ---');
    const notFoundRes = await makeRequest(server, {
      path: '/api/v1/admin/reports/non_existent_rep_99999',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(notFoundRes.status === 404, 'Non-existent report returns HTTP 404 Not Found');
    assert(notFoundRes.body.success === false, '404 response contains success: false');

    // 16. Scenario K: Sensitive-field leakage check
    console.log('\n--- TEST 14: Scenario K - Credential Sanitization Audit ---');
    const listRaw = JSON.stringify(listRes.body);
    const detailRaw = JSON.stringify(detailRes.body);

    assert(!listRaw.includes('passwordHash') && !listRaw.includes('salt') && !listRaw.includes('__v'),
      'List response contains zero passwordHash, salt, or __v fields');
    assert(!detailRaw.includes('passwordHash') && !detailRaw.includes('salt') && !detailRaw.includes('__v'),
      'Detail response contains zero passwordHash, salt, or __v fields');

    // 17. Scenario L: Regression checks across all prior Admin modules
    console.log('\n--- TEST 15: Scenario L - Regression Checks (All Prior Admin Modules) ---');
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

  } finally {
    // 18. Clean up temporary test data from MongoDB
    console.log('\n--- TEST 16: Clean up Temporary Test Data ---');
    const delReps = await Report.deleteMany({ id: { $regex: /^TEST_REP_/ } });
    const delUsers = await User.deleteMany({ id: { $regex: /^TEST_REP_/ } });
    console.log(`[Cleanup] Removed ${delReps.deletedCount} test report(s) and ${delUsers.deletedCount} test user(s) from MongoDB.`);

    const remainingReps = await Report.countDocuments({ id: { $regex: /^TEST_REP_/ } });
    const remainingUsers = await User.countDocuments({ id: { $regex: /^TEST_REP_/ } });
    assert(remainingReps === 0 && remainingUsers === 0, 'Zero temporary test reports or users remain in MongoDB');

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
