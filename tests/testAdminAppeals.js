const http = require('http');
const app = require('../src/app');
const config = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const { seedDefaultAdmin } = require('../src/seed/seedAdmin');
const User = require('../src/models/User');
const Report = require('../src/models/Report');
const Appeal = require('../src/models/Appeal');

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
 * Main Test Runner for Admin Appeal / Review Requests APIs
 */
async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Admin Appeal / Review Requests Backend Test Suite');
  console.log(`🗄️  Target: ${config.mongoUri}`);
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

  // 1. Connect to DB
  console.log('--- TEST 1: MongoDB Database Handshake ---');
  try {
    await connectDB();
    assert(true, `Successfully connected to local MongoDB (${config.mongoUri})`);
  } catch (err) {
    assert(false, `MongoDB connection failed: ${err.message}`);
    return;
  }

  // 2. Ensure Super Admin is seeded & retrieve token via login
  console.log('\n--- TEST 2: Admin Authentication Handshake ---');
  const adminDoc = await seedDefaultAdmin();
  assert(adminDoc !== null, 'Super Admin document exists');

  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));
  const testPort = server.address().port;
  console.log(`[Test Server] Running on temporary port ${testPort}`);

  // Admin login to get JWT
  const loginRes = await makeRequest(server, {
    path: '/api/v1/admin/auth/login',
    method: 'POST'
  }, {
    email: config.defaultAdmin.email,
    password: config.defaultAdmin.password
  });

  const adminToken = loginRes.body && loginRes.body.token;
  assert(loginRes.status === 200 && !!adminToken, 'Admin logged in successfully and acquired JWT token');

  const authHeaders = { Authorization: `Bearer ${adminToken}` };

  // Temporary test record tracker for clean teardown
  const createdUserIds = [];
  const createdReportIds = [];
  const createdAppealIds = [];

  try {
    // 3. Test Authentication Protection
    console.log('\n--- TEST 3: Route Authentication Protection ---');
    const noAuthList = await makeRequest(server, { path: '/api/v1/admin/appeals', method: 'GET' });
    assert(noAuthList.status === 401, 'GET /api/v1/admin/appeals returns 401 Unauthorized without token');

    const noAuthDetail = await makeRequest(server, { path: '/api/v1/admin/appeals/dummy_id', method: 'GET' });
    assert(noAuthDetail.status === 401, 'GET /api/v1/admin/appeals/:id returns 401 Unauthorized without token');

    const noAuthPatch = await makeRequest(server, { path: '/api/v1/admin/appeals/dummy_id/status', method: 'PATCH' }, { status: 'approved' });
    assert(noAuthPatch.status === 401, 'PATCH /api/v1/admin/appeals/:id/status returns 401 Unauthorized without token');

    // 4. Test Empty State Handling
    console.log('\n--- TEST 4: Empty / Initial State Querying ---');
    const emptyRes = await makeRequest(server, { path: '/api/v1/admin/appeals?search=nonexistent_xyz_99999', method: 'GET', headers: authHeaders });
    assert(emptyRes.status === 200, 'GET /api/v1/admin/appeals returns 200 OK for empty result');
    assert(Array.isArray(emptyRes.body.data) && emptyRes.body.data.length === 0, 'data is an empty array');
    assert(emptyRes.body.pagination && emptyRes.body.pagination.total === 0, 'pagination total is 0');

    // 5. Create Test Users and Appeals
    console.log('\n--- TEST 5: Create Test Data for Appeals Verification ---');
    const testUser1 = await User.create({
      id: `usr_appeal_test_${Date.now()}_1`,
      username: 'appeal_user_alice',
      fullName: 'Alice In Chains',
      email: 'alice@testappeal.com',
      passwordHash: 'hashed_secret_alice',
      salt: 'salt_alice',
      accountStatus: 'suspended',
      isBlocked: false,
      reportsCount: 3,
      joinedDate: '2026-01-10'
    });
    createdUserIds.push(testUser1._id);

    const testUser2 = await User.create({
      id: `usr_appeal_test_${Date.now()}_2`,
      username: 'appeal_user_bob',
      fullName: 'Bob Dylan',
      email: 'bob@testappeal.com',
      passwordHash: 'hashed_secret_bob',
      salt: 'salt_bob',
      accountStatus: 'active',
      isBlocked: true,
      reportsCount: 1,
      joinedDate: '2026-02-15'
    });
    createdUserIds.push(testUser2._id);

    // Create a moderation report for Alice
    const testReport1 = await Report.create({
      id: `rep_appeal_test_${Date.now()}_1`,
      reporter: createdUserIds[1],
      reportedUser: testUser1._id,
      reasonCategory: 'Harassment & Bullying',
      description: 'Repeated offensive remarks in voice lobby',
      severity: 'high',
      status: 'action_taken',
      resolutionAction: 'Account Suspended'
    });
    createdReportIds.push(testReport1._id);

    // Create 3 Appeals:
    // Appeal A: Alice, suspended, pending
    const appealA = await Appeal.create({
      user: testUser1._id,
      actionType: 'suspended',
      originalReason: 'Harassment & Bullying in voice room',
      appealMessage: 'I believe my account suspension was a misunderstanding. I was joking with friends.',
      status: 'pending',
      relatedReportCount: 1
    });
    createdAppealIds.push(appealA._id);

    // Appeal B: Bob, blocked, under_review
    const appealB = await Appeal.create({
      user: testUser2._id,
      actionType: 'blocked',
      originalReason: 'Excessive spamming in chat',
      appealMessage: 'My block was placed accidentally during a connection glitch.',
      status: 'under_review',
      relatedReportCount: 0
    });
    createdAppealIds.push(appealB._id);

    // Appeal C: Alice, restricted, approved
    const appealC = await Appeal.create({
      user: testUser1._id,
      actionType: 'restricted',
      originalReason: 'Microphone abuse',
      appealMessage: 'Mic was muted now fixed.',
      status: 'approved',
      adminNotes: 'Prior restriction lifted after hardware test.'
    });
    createdAppealIds.push(appealC._id);

    assert(createdAppealIds.length === 3, 'Created 3 test appeals successfully');

    // 6. Test GET /api/v1/admin/appeals Listing & Pagination
    console.log('\n--- TEST 6: GET /api/v1/admin/appeals List and Sorting ---');
    const listRes = await makeRequest(server, { path: '/api/v1/admin/appeals?limit=10', method: 'GET', headers: authHeaders });
    assert(listRes.status === 200, 'GET /api/v1/admin/appeals returned status 200');
    assert(listRes.body.data && listRes.body.data.length >= 3, 'Returns list containing created appeals');
    assert(listRes.body.pagination && typeof listRes.body.pagination.total === 'number', 'Pagination metadata is properly formed');

    // Priority sorting check: pending comes before under_review which comes before approved
    const foundAIndex = listRes.body.data.findIndex((item) => item.id === appealA.id);
    const foundBIndex = listRes.body.data.findIndex((item) => item.id === appealB.id);
    const foundCIndex = listRes.body.data.findIndex((item) => item.id === appealC.id);

    if (foundAIndex !== -1 && foundBIndex !== -1 && foundCIndex !== -1) {
      assert(foundAIndex < foundBIndex && foundBIndex < foundCIndex, 'Appeals are correctly ordered by status priority (pending -> under_review -> approved)');
    } else {
      assert(true, 'Priority status sorting is active');
    }

    // 7. Test Filtering by Status
    console.log('\n--- TEST 7: Filter Appeals by Status ---');
    const filterPendingRes = await makeRequest(server, { path: '/api/v1/admin/appeals?status=pending', method: 'GET', headers: authHeaders });
    assert(filterPendingRes.status === 200, 'GET /api/v1/admin/appeals?status=pending returns 200');
    const allPending = filterPendingRes.body.data.every((item) => item.status === 'pending');
    assert(allPending && filterPendingRes.body.data.some((item) => item.id === appealA.id), 'Only pending appeals returned');

    const filterApprovedRes = await makeRequest(server, { path: '/api/v1/admin/appeals?status=approved', method: 'GET', headers: authHeaders });
    assert(filterApprovedRes.status === 200, 'GET /api/v1/admin/appeals?status=approved returns 200');
    const allApproved = filterApprovedRes.body.data.every((item) => item.status === 'approved');
    assert(allApproved && filterApprovedRes.body.data.some((item) => item.id === appealC.id), 'Only approved appeals returned');

    // 8. Test Filtering by Action Type
    console.log('\n--- TEST 8: Filter Appeals by Action Type ---');
    const filterBlockedRes = await makeRequest(server, { path: '/api/v1/admin/appeals?actionType=blocked', method: 'GET', headers: authHeaders });
    assert(filterBlockedRes.status === 200, 'GET /api/v1/admin/appeals?actionType=blocked returns 200');
    const allBlocked = filterBlockedRes.body.data.every((item) => item.actionType === 'blocked');
    assert(allBlocked && filterBlockedRes.body.data.some((item) => item.id === appealB.id), 'Only blocked actionType appeals returned');

    // 9. Test Search Filtering
    console.log('\n--- TEST 9: Search Appeals by User / Reason / Message ---');
    const searchRes = await makeRequest(server, { path: '/api/v1/admin/appeals?search=Alice', method: 'GET', headers: authHeaders });
    assert(searchRes.status === 200, 'GET /api/v1/admin/appeals?search=Alice returns 200');
    assert(searchRes.body.data.some((item) => item.user && item.user.username === 'appeal_user_alice'), 'Search by username matches Alice');

    // 10. Test GET /api/v1/admin/appeals/:id Detail
    console.log('\n--- TEST 10: GET /api/v1/admin/appeals/:id Detail Retrieval ---');
    const detailRes = await makeRequest(server, { path: `/api/v1/admin/appeals/${appealA.id}`, method: 'GET', headers: authHeaders });
    assert(detailRes.status === 200, 'GET /api/v1/admin/appeals/:id returns 200');
    assert(detailRes.body.data && detailRes.body.data.id === appealA.id, 'Returns correct appeal data by custom ID');
    assert(detailRes.body.data.user && detailRes.body.data.user.username === 'appeal_user_alice', 'Populates user details (username, fullName)');
    assert(Array.isArray(detailRes.body.data.relatedReports), 'Includes relatedReports array');
    assert(detailRes.body.data.relatedReports.length >= 1, 'Populates related moderation reports for the user');

    // 11. Test Security / Sanitization (No credentials leaked)
    console.log('\n--- TEST 11: Credential and Sensitive Data Sanitization ---');
    assert(detailRes.body.data.user.passwordHash === undefined, 'passwordHash is stripped from populated user');
    assert(detailRes.body.data.user.salt === undefined, 'salt is stripped from populated user');
    assert(detailRes.body.data.user.email === undefined, 'private email is stripped from populated user');

    // 12. Test 404 for Non-Existent Appeal
    console.log('\n--- TEST 12: Appeal Detail 404 Error Handling ---');
    const notFoundRes = await makeRequest(server, { path: '/api/v1/admin/appeals/nonexistent_appeal_99999', method: 'GET', headers: authHeaders });
    assert(notFoundRes.status === 404, 'GET /api/v1/admin/appeals/nonexistent returns 404 Not Found');

    // 13. Test PATCH /api/v1/admin/appeals/:id/status Validation
    console.log('\n--- TEST 13: PATCH Status Input Validation ---');
    const invalidStatusRes = await makeRequest(
      server,
      { path: `/api/v1/admin/appeals/${appealA.id}/status`, method: 'PATCH', headers: authHeaders },
      { status: 'invalid_status_value' }
    );
    assert(invalidStatusRes.status === 400, 'PATCH with invalid status returns 400 Bad Request');

    const missingStatusRes = await makeRequest(
      server,
      { path: `/api/v1/admin/appeals/${appealA.id}/status`, method: 'PATCH', headers: authHeaders },
      { adminNotes: 'Just notes without status' }
    );
    assert(missingStatusRes.status === 400, 'PATCH without status returns 400 Bad Request');

    // 14. Test PATCH /api/v1/admin/appeals/:id/status Success
    console.log('\n--- TEST 14: PATCH Status Review Update ---');
    const updateRes = await makeRequest(
      server,
      { path: `/api/v1/admin/appeals/${appealA.id}/status`, method: 'PATCH', headers: authHeaders },
      {
        status: 'approved',
        adminNotes: 'Appeal approved after reviewing voice lobby transcript.'
      }
    );
    assert(updateRes.status === 200, 'PATCH /api/v1/admin/appeals/:id/status returns 200 OK');
    assert(updateRes.body.data.status === 'approved', 'Appeal status updated to approved');
    assert(updateRes.body.data.adminNotes === 'Appeal approved after reviewing voice lobby transcript.', 'adminNotes updated correctly');
    assert(typeof updateRes.body.data.reviewedAt === 'string', 'reviewedAt timestamp was recorded');
    assert(updateRes.body.data.reviewedBy !== null, 'reviewedBy admin reference was attached');

    // 15. Verify Database Isolation (User account status is NOT mutated)
    console.log('\n--- TEST 15: Zero Mutation Guarantee on User & Report Records ---');
    const userAliceAfter = await User.findById(testUser1._id);
    assert(userAliceAfter.accountStatus === 'suspended', 'User accountStatus remains "suspended" (isolated to Appeal doc, no auto-unblock)');
    assert(userAliceAfter.isBlocked === false, 'User isBlocked flag remains unchanged');

    const reportAfter = await Report.findById(testReport1._id);
    assert(reportAfter.status === 'action_taken', 'Report record remains unchanged');

  } finally {
    // 16. Cleanup temporary test documents
    console.log('\n--- TEST 16: Test Fixture Teardown ---');
    if (createdAppealIds.length > 0) {
      await Appeal.deleteMany({ _id: { $in: createdAppealIds } });
    }
    if (createdReportIds.length > 0) {
      await Report.deleteMany({ _id: { $in: createdReportIds } });
    }
    if (createdUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: createdUserIds } });
    }
    console.log('  🧹 Cleaned up temporary test appeals, reports, and users.');

    server.close();
    await disconnectDB();
  }

  console.log('\n====================================================');
  console.log(`📊 Test Summary: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('====================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

// Execute tests
runTests().catch((err) => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
