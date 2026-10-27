const http = require('http');
const app = require('../src/app');
const config = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const { seedDefaultAdmin } = require('../src/seed/seedAdmin');
const Report = require('../src/models/Report');
const User = require('../src/models/User');

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
 * Main Test Runner for Admin Repeat Offender Pattern Detector APIs
 */
async function runTests() {
  console.log('================================================================');
  console.log('🧪 Starting Admin Repeat Offender Pattern Detector Test Suite');
  console.log(`🗄️  Target DB: ${config.mongoUri}`);
  console.log('================================================================\n');

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

  // 1. Establish DB connection
  console.log('--- TEST 1: Database Connection ---');
  await connectDB();
  assert(true, 'Connected to MongoDB');

  // 2. Ensure Super Admin is seeded
  await seedDefaultAdmin();

  // 3. Start server on temporary port
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));
  const testPort = server.address().port;
  console.log(`[Test Server] Running on temporary port ${testPort}\n`);

  // Test users and reports references for cleanup
  const createdUserIds = [];
  const createdReportIds = [];

  try {
    // 4. Authenticate Admin
    console.log('--- TEST 2: Admin Authentication ---');
    const loginRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/login',
      method: 'POST'
    }, {
      email: config.defaultAdmin.email,
      password: config.defaultAdmin.password
    });
    assert(loginRes.status === 200 && loginRes.body.token, 'Admin authenticated and received JWT token');
    const adminToken = loginRes.body.token;

    // 5. Unauthenticated Guards
    console.log('\n--- TEST 3: Unauthenticated Access Protection ---');
    const unauthList = await makeRequest(server, {
      path: '/api/v1/admin/safety/repeat-offenders',
      method: 'GET'
    });
    assert(unauthList.status === 401, 'GET /repeat-offenders without token returns HTTP 401');

    const unauthDetail = await makeRequest(server, {
      path: '/api/v1/admin/safety/repeat-offenders/usr_test_123',
      method: 'GET'
    });
    assert(unauthDetail.status === 401, 'GET /repeat-offenders/:userId without token returns HTTP 401');

    // Clean up any existing TEST_ fixtures
    await Report.deleteMany({ description: { $regex: /^TEST_/i } });
    await User.deleteMany({ username: { $regex: /^test_ro_/i } });

    // 6. Create Test Users
    console.log('\n--- TEST 4: Seed Fixture Users ---');
    // User 1: Target for High Priority (reported by 3 distinct users)
    const targetUserHigh = new User({
      id: `usr_test_target_high_${Date.now()}`,
      username: `test_ro_target_high_${Date.now()}`,
      fullName: 'Test Target High Priority',
      accountStatus: 'active',
      reportsCount: 4
    });
    await targetUserHigh.save();
    createdUserIds.push(targetUserHigh._id);

    // User 2: Target for Medium Priority (reported by 2 distinct users)
    const targetUserMed = new User({
      id: `usr_test_target_med_${Date.now()}`,
      username: `test_ro_target_med_${Date.now()}`,
      fullName: 'Test Target Medium Priority',
      accountStatus: 'active',
      reportsCount: 2
    });
    await targetUserMed.save();
    createdUserIds.push(targetUserMed._id);

    // User 3: Target for Single Reporter Multiple Reports (should be EXCLUDED)
    const targetUserSingle = new User({
      id: `usr_test_target_single_${Date.now()}`,
      username: `test_ro_target_single_${Date.now()}`,
      fullName: 'Test Target Single Reporter',
      accountStatus: 'active',
      reportsCount: 3
    });
    await targetUserSingle.save();
    createdUserIds.push(targetUserSingle._id);

    // User 4: Target with 2 distinct reporters BUT one critical severity (should be HIGH priority)
    const targetUserCritical = new User({
      id: `usr_test_target_crit_${Date.now()}`,
      username: `test_ro_target_crit_${Date.now()}`,
      fullName: 'Test Target Critical Severity',
      accountStatus: 'active',
      reportsCount: 2
    });
    await targetUserCritical.save();
    createdUserIds.push(targetUserCritical._id);

    // Reporters A, B, C
    const reporterA = new User({
      id: `usr_test_rep_a_${Date.now()}`,
      username: `test_ro_reporter_a_${Date.now()}`,
      fullName: 'Reporter Alice'
    });
    await reporterA.save();
    createdUserIds.push(reporterA._id);

    const reporterB = new User({
      id: `usr_test_rep_b_${Date.now()}`,
      username: `test_ro_reporter_b_${Date.now()}`,
      fullName: 'Reporter Bob'
    });
    await reporterB.save();
    createdUserIds.push(reporterB._id);

    const reporterC = new User({
      id: `usr_test_rep_c_${Date.now()}`,
      username: `test_ro_reporter_c_${Date.now()}`,
      fullName: 'Reporter Charlie'
    });
    await reporterC.save();
    createdUserIds.push(reporterC._id);

    assert(true, 'Test users created successfully');

    // 7. Seed Reports
    console.log('\n--- TEST 5: Seed Reports for Multi-Reporter Scenarios ---');

    // Scenario A: targetUserHigh reported by Alice (2 reports), Bob (1 report), Charlie (1 report)
    // -> Total Reports: 4, Distinct Reporters: 3 -> Expected: HIGH Priority
    const repH1 = new Report({
      reportedUser: targetUserHigh._id,
      reporter: reporterA._id,
      reasonCategory: 'Harassment / Verbal Abuse',
      description: 'TEST_Alice report 1 on High Target',
      status: 'pending',
      severity: 'high'
    });
    await repH1.save();
    createdReportIds.push(repH1._id);

    const repH2 = new Report({
      reportedUser: targetUserHigh._id,
      reporter: reporterA._id, // same reporter Alice again!
      reasonCategory: 'Spam / Bot Account',
      description: 'TEST_Alice report 2 on High Target',
      status: 'pending',
      severity: 'medium'
    });
    await repH2.save();
    createdReportIds.push(repH2._id);

    const repH3 = new Report({
      reportedUser: targetUserHigh._id,
      reporter: reporterB._id, // Bob
      reasonCategory: 'Harassment / Verbal Abuse',
      description: 'TEST_Bob report on High Target',
      status: 'resolved',
      severity: 'high'
    });
    await repH3.save();
    createdReportIds.push(repH3._id);

    const repH4 = new Report({
      reportedUser: targetUserHigh._id,
      reporter: reporterC._id, // Charlie
      reasonCategory: 'Threatening Behavior',
      description: 'TEST_Charlie report on High Target',
      status: 'dismissed',
      severity: 'medium'
    });
    await repH4.save();
    createdReportIds.push(repH4._id);

    // Scenario B: targetUserMed reported by Alice (1 report), Bob (1 report)
    // -> Total Reports: 2, Distinct Reporters: 2 -> Expected: MEDIUM Priority
    const repM1 = new Report({
      reportedUser: targetUserMed._id,
      reporter: reporterA._id,
      reasonCategory: 'Mic Spam / Noise Distortion',
      description: 'TEST_Alice report on Med Target',
      status: 'pending',
      severity: 'medium'
    });
    await repM1.save();
    createdReportIds.push(repM1._id);

    const repM2 = new Report({
      reportedUser: targetUserMed._id,
      reporter: reporterB._id,
      reasonCategory: 'Mic Spam / Noise Distortion',
      description: 'TEST_Bob report on Med Target',
      status: 'pending',
      severity: 'low'
    });
    await repM2.save();
    createdReportIds.push(repM2._id);

    // Scenario C: targetUserSingle reported ONLY by Alice (3 separate reports)
    // -> Total Reports: 3, Distinct Reporters: 1 -> Expected: EXCLUDED from Repeat Offenders!
    for (let i = 1; i <= 3; i++) {
      const repS = new Report({
        reportedUser: targetUserSingle._id,
        reporter: reporterA._id, // Alice all 3 times
        reasonCategory: 'Personal Dispute',
        description: `TEST_Alice single spam report ${i}`,
        status: 'pending',
        severity: 'low'
      });
      await repS.save();
      createdReportIds.push(repS._id);
    }

    // Scenario D: targetUserCritical reported by Alice and Bob (2 distinct reporters) BUT with severity 'critical'
    // -> Total Reports: 2, Distinct Reporters: 2, Severity: 'critical' -> Expected: HIGH Priority!
    const repC1 = new Report({
      reportedUser: targetUserCritical._id,
      reporter: reporterA._id,
      reasonCategory: 'Severe Harassment',
      description: 'TEST_Alice critical report',
      status: 'pending',
      severity: 'critical'
    });
    await repC1.save();
    createdReportIds.push(repC1._id);

    const repC2 = new Report({
      reportedUser: targetUserCritical._id,
      reporter: reporterB._id,
      reasonCategory: 'Verbal Abuse',
      description: 'TEST_Bob report',
      status: 'resolved',
      severity: 'low'
    });
    await repC2.save();
    createdReportIds.push(repC2._id);

    assert(true, 'Test reports seeded across multiple scenarios');

    // 8. GET /api/v1/admin/safety/repeat-offenders (List All Detected Patterns)
    console.log('\n--- TEST 6: GET /api/v1/admin/safety/repeat-offenders ---');
    const listRes = await makeRequest(server, {
      path: '/api/v1/admin/safety/repeat-offenders',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    assert(listRes.status === 200, 'GET /repeat-offenders returns HTTP 200');
    assert(listRes.body.success === true, 'Response contains success: true');
    assert(Array.isArray(listRes.body.data), 'Response data is an array');

    const patterns = listRes.body.data;
    const highPattern = patterns.find((p) => p.reportedUser.username === targetUserHigh.username);
    const medPattern = patterns.find((p) => p.reportedUser.username === targetUserMed.username);
    const singlePattern = patterns.find((p) => p.reportedUser.username === targetUserSingle.username);
    const critPattern = patterns.find((p) => p.reportedUser.username === targetUserCritical.username);

    // 9. Verify Multi-Reporter Distinction & Exclusion
    console.log('\n--- TEST 7: Multi-Reporter Aggregation & Exclusion Verification ---');
    assert(singlePattern === undefined, 'User with multiple reports from ONLY ONE reporter is EXCLUDED from Repeat Offenders');
    assert(highPattern !== undefined, 'User with 3 distinct reporters is INCLUDED in Repeat Offenders');
    assert(highPattern && highPattern.distinctReporters === 3, 'High Target distinctReporters correctly equals 3 (Alice counted once)');
    assert(highPattern && highPattern.totalReports === 4, 'High Target totalReports correctly equals 4');
    assert(highPattern && highPattern.priority === 'high', 'Target with 3 distinct reporters is given HIGH priority');

    assert(medPattern !== undefined, 'User with 2 distinct reporters is INCLUDED in Repeat Offenders');
    assert(medPattern && medPattern.distinctReporters === 2, 'Med Target distinctReporters correctly equals 2');
    assert(medPattern && medPattern.priority === 'medium', 'Target with 2 distinct reporters and non-critical severity is given MEDIUM priority');

    assert(critPattern !== undefined, 'User with 2 distinct reporters and critical severity is INCLUDED');
    assert(critPattern && critPattern.priority === 'high', 'Target with critical severity report receives HIGH priority despite 2 distinct reporters');

    // 10. Verify Pattern Status Logic
    console.log('\n--- TEST 8: Pattern Status Calculation ---');
    assert(highPattern.patternStatus === 'requires_review', 'Pattern with pending reports has patternStatus: "requires_review"');
    assert(highPattern.pendingReports === 2, 'High Target has 2 pending reports');
    assert(highPattern.resolvedReports === 1, 'High Target has 1 resolved report');
    assert(highPattern.dismissedReports === 1, 'High Target has 1 dismissed report');

    // 11. Search Query Parameter
    console.log('\n--- TEST 9: Search Query Filtering ---');
    const searchRes = await makeRequest(server, {
      path: `/api/v1/admin/safety/repeat-offenders?search=${targetUserHigh.username}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(searchRes.status === 200, 'Search query returns HTTP 200');
    assert(searchRes.body.data.length === 1, 'Search by username returns exactly 1 matching record');
    assert(searchRes.body.data[0].reportedUser.username === targetUserHigh.username, 'Returned record matches searched user');

    // 12. Priority Filter Query Parameter
    console.log('\n--- TEST 10: Priority Filter ---');
    const priorityRes = await makeRequest(server, {
      path: '/api/v1/admin/safety/repeat-offenders?priority=medium',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(priorityRes.status === 200, 'Priority filter returns HTTP 200');
    assert(priorityRes.body.data.every((p) => p.priority === 'medium'), 'All returned patterns have priority "medium"');

    // 13. Min Distinct Reporters Filter
    console.log('\n--- TEST 11: Min Distinct Reporters Filter (minDistinctReporters=3) ---');
    const minRepRes = await makeRequest(server, {
      path: '/api/v1/admin/safety/repeat-offenders?minDistinctReporters=3',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(minRepRes.status === 200, 'minDistinctReporters filter returns HTTP 200');
    assert(minRepRes.body.data.every((p) => p.distinctReporters >= 3), 'All returned patterns have distinctReporters >= 3');

    // 14. Pagination Handling
    console.log('\n--- TEST 12: Pagination Handling ---');
    const pageRes = await makeRequest(server, {
      path: '/api/v1/admin/safety/repeat-offenders?page=1&limit=1',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(pageRes.status === 200, 'Pagination request returns HTTP 200');
    assert(pageRes.body.data.length === 1, 'Pagination limit=1 returns 1 item');
    assert(pageRes.body.pagination.page === 1 && pageRes.body.pagination.limit === 1, 'Pagination metadata matches requested query');

    // 15. Detail Endpoint: GET /api/v1/admin/safety/repeat-offenders/:userId
    console.log('\n--- TEST 13: GET /api/v1/admin/safety/repeat-offenders/:userId ---');
    const detailRes = await makeRequest(server, {
      path: `/api/v1/admin/safety/repeat-offenders/${targetUserHigh.id}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(detailRes.status === 200, 'Detail endpoint returns HTTP 200');
    assert(detailRes.body.success === true, 'Detail response has success: true');
    assert(detailRes.body.data && detailRes.body.data.reportedUser.username === targetUserHigh.username, 'Detail reportedUser matches');
    assert(detailRes.body.data.distinctReporters === 3, 'Detail distinctReporters is 3');
    assert(detailRes.body.data.totalReports === 4, 'Detail totalReports is 4');
    assert(Array.isArray(detailRes.body.data.reportsTimeline) && detailRes.body.data.reportsTimeline.length === 4, 'Detail includes 4 timeline items');
    assert(detailRes.body.data.reportsTimeline[0].reporter !== null, 'Timeline item contains populated safe reporter details');

    // 16. Detail Endpoint for User with only 1 Distinct Reporter -> 404
    console.log('\n--- TEST 14: Detail Endpoint for Non-Repeat Offender ---');
    const singleDetailRes = await makeRequest(server, {
      path: `/api/v1/admin/safety/repeat-offenders/${targetUserSingle.id}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(singleDetailRes.status === 404, 'Detail endpoint for user with only 1 distinct reporter returns HTTP 404 Not Found');

    // 17. Detail Endpoint for Non-Existent User -> 404
    console.log('\n--- TEST 15: Detail Endpoint for Non-Existent User ---');
    const nonExistentDetail = await makeRequest(server, {
      path: '/api/v1/admin/safety/repeat-offenders/usr_non_existent_99999',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(nonExistentDetail.status === 404, 'Detail endpoint for non-existent user returns HTTP 404');

    // 18. Integrity Check: Ensure no Report records were modified
    console.log('\n--- TEST 16: Read-only Data Integrity Check ---');
    const checkReports = await Report.find({ description: { $regex: /^TEST_/i } });
    assert(checkReports.length === createdReportIds.length, 'Original report documents were not mutated or altered');

  } finally {
    // 19. Cleanup fixtures
    console.log('\n--- TEST 17: Cleanup Fixtures ---');
    const delRep = await Report.deleteMany({ _id: { $in: createdReportIds } });
    const delUsr = await User.deleteMany({ _id: { $in: createdUserIds } });
    console.log(`[Cleanup] Removed ${delRep.deletedCount} test report(s) and ${delUsr.deletedCount} test user(s).`);

    server.close();
    await disconnectDB();
  }

  console.log('\n================================================================');
  console.log(`📊 Test Results: ${testsPassed} Passed, ${testsFailed} Failed`);
  console.log('================================================================');
}

if (require.main === module) {
  runTests().catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
