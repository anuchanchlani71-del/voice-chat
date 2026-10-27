const http = require('http');
const app = require('../src/app');
const config = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const { seedDefaultAdmin } = require('../src/seed/seedAdmin');
const { seedDemoData } = require('../src/seed/demoSeed');
const User = require('../src/models/User');
const Plan = require('../src/models/Plan');
const Subscription = require('../src/models/Subscription');

/**
 * Helper to make HTTP requests against in-memory server
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
 * Main Test Runner for Admin Subscriptions APIs
 */
async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Admin Subscriptions Backend Test Suite');
  console.log(`🗄️  Target DB: ${config.mongoUri}`);
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

  // 1. Establish DB connection and run seed
  console.log('--- TEST 1: Database Handshake & Seed ---');
  await connectDB();
  assert(true, 'Connected to MongoDB for Subscriptions test suite');

  await seedDefaultAdmin();
  await seedDemoData();
  assert(true, 'Admin and demo seeds verified');

  // Verify demo user and plans exist
  const testUser = await User.findOne({ username: 'aarav_sharma' });
  const auraPlan = await Plan.findOne({ key: 'aura' });
  const freePlan = await Plan.findOne({ key: 'free' });
  assert(Boolean(testUser), 'Test user "aarav_sharma" exists');
  assert(Boolean(auraPlan && freePlan), 'Canonical plans Free and Aura exist');

  // Start server on ephemeral port
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));
  const testPort = server.address().port;
  console.log(`[Test Server] Running on ephemeral port ${testPort}\n`);

  try {
    // 2. Admin Authentication
    console.log('--- TEST 2: Admin Authentication ---');
    const loginRes = await makeRequest(
      server,
      { path: '/api/v1/admin/auth/login', method: 'POST' },
      { email: config.defaultAdmin.email, password: config.defaultAdmin.password }
    );
    assert(loginRes.status === 200 && loginRes.body.token, 'Admin authenticated and received JWT token');
    const adminToken = loginRes.body.token;
    const authHeaders = { Authorization: `Bearer ${adminToken}` };

    // 3. Unauthenticated Access Guards
    console.log('\n--- TEST 3: Unauthenticated Access Guards ---');
    const unauthGet = await makeRequest(server, { path: '/api/v1/admin/subscriptions', method: 'GET' });
    assert(unauthGet.status === 401, 'GET /admin/subscriptions without token returns HTTP 401');

    const unauthPost = await makeRequest(server, { path: '/api/v1/admin/subscriptions', method: 'POST' }, { userId: 'u1', planId: 'p1' });
    assert(unauthPost.status === 401, 'POST /admin/subscriptions without token returns HTTP 401');

    const unauthPut = await makeRequest(server, { path: '/api/v1/admin/subscriptions/sub_123', method: 'PUT' }, { status: 'active' });
    assert(unauthPut.status === 401, 'PUT /admin/subscriptions/:id without token returns HTTP 401');

    const unauthPatch = await makeRequest(server, { path: '/api/v1/admin/subscriptions/sub_123/status', method: 'PATCH' }, { status: 'cancelled' });
    assert(unauthPatch.status === 401, 'PATCH /admin/subscriptions/:id/status without token returns HTTP 401');

    const unauthDelete = await makeRequest(server, { path: '/api/v1/admin/subscriptions/sub_123', method: 'DELETE' });
    assert(unauthDelete.status === 401, 'DELETE /admin/subscriptions/:id without token returns HTTP 401');

    // Clean up test subscriptions
    await Subscription.deleteMany({ user: testUser._id });

    // 4. POST /api/v1/admin/subscriptions (Validation & Creation)
    console.log('\n--- TEST 4: POST /api/v1/admin/subscriptions (Validation & Creation) ---');

    // Missing userId
    const missingUserRes = await makeRequest(
      server,
      { path: '/api/v1/admin/subscriptions', method: 'POST', headers: authHeaders },
      { planId: auraPlan.id }
    );
    assert(missingUserRes.status === 400, 'Creation without userId returns HTTP 400');

    // Missing planId
    const missingPlanRes = await makeRequest(
      server,
      { path: '/api/v1/admin/subscriptions', method: 'POST', headers: authHeaders },
      { userId: testUser.id }
    );
    assert(missingPlanRes.status === 400, 'Creation without planId returns HTTP 400');

    // Non-existent user
    const invalidUserRes = await makeRequest(
      server,
      { path: '/api/v1/admin/subscriptions', method: 'POST', headers: authHeaders },
      { userId: 'non_existent_user_999', planId: auraPlan.id }
    );
    assert(invalidUserRes.status === 400, 'Creation with non-existent user returns HTTP 400');

    // Non-existent plan
    const invalidPlanRes = await makeRequest(
      server,
      { path: '/api/v1/admin/subscriptions', method: 'POST', headers: authHeaders },
      { userId: testUser.id, planId: 'non_existent_plan_999' }
    );
    assert(invalidPlanRes.status === 400, 'Creation with non-existent plan returns HTTP 400');

    // Invalid status
    const invalidStatusRes = await makeRequest(
      server,
      { path: '/api/v1/admin/subscriptions', method: 'POST', headers: authHeaders },
      { userId: testUser.id, planId: auraPlan.id, status: 'invalid_status' }
    );
    assert(invalidStatusRes.status === 400, 'Creation with invalid status returns HTTP 400');

    // Invalid dates (end < start)
    const invalidDatesRes = await makeRequest(
      server,
      { path: '/api/v1/admin/subscriptions', method: 'POST', headers: authHeaders },
      {
        userId: testUser.id,
        planId: auraPlan.id,
        startDate: '2026-10-15',
        endDate: '2026-10-01'
      }
    );
    assert(invalidDatesRes.status === 400, 'Creation with endDate < startDate returns HTTP 400');

    // Valid subscription creation
    const createRes = await makeRequest(
      server,
      { path: '/api/v1/admin/subscriptions', method: 'POST', headers: authHeaders },
      {
        userId: testUser.id,
        planId: auraPlan.key,
        status: 'active',
        startDate: '2026-10-01',
        endDate: '2027-10-01'
      }
    );
    assert(createRes.status === 201, 'Valid subscription creation returns HTTP 201');
    assert(createRes.body.subscription && createRes.body.subscription.id, 'Created subscription has custom string ID');
    assert(createRes.body.subscription.user && createRes.body.subscription.user.username === 'aarav_sharma', 'User populated on created record');
    assert(createRes.body.subscription.plan && createRes.body.subscription.plan.key === 'aura', 'Plan populated on created record');
    const createdSubId = createRes.body.subscription.id;

    // 5. GET /api/v1/admin/subscriptions (Listing, Filter, Search, Pagination)
    console.log('\n--- TEST 5: GET /api/v1/admin/subscriptions (List & Filters) ---');
    const listRes = await makeRequest(
      server,
      { path: '/api/v1/admin/subscriptions', method: 'GET', headers: authHeaders }
    );
    assert(listRes.status === 200, 'GET /admin/subscriptions returns HTTP 200');
    assert(Array.isArray(listRes.body.subscriptions), 'Returns subscriptions array');
    assert(listRes.body.subscriptions.length >= 1, 'Contains created subscription');
    assert(listRes.body.pagination && listRes.body.pagination.totalItems >= 1, 'Returns pagination metadata');

    // Search by user name / username
    const searchUserRes = await makeRequest(
      server,
      { path: '/api/v1/admin/subscriptions?search=aarav', method: 'GET', headers: authHeaders }
    );
    assert(searchUserRes.status === 200 && searchUserRes.body.subscriptions.length >= 1, 'Search by user "aarav" returns subscription');

    // Search by plan name
    const searchPlanRes = await makeRequest(
      server,
      { path: '/api/v1/admin/subscriptions?search=aura', method: 'GET', headers: authHeaders }
    );
    assert(searchPlanRes.status === 200 && searchPlanRes.body.subscriptions.length >= 1, 'Search by plan "aura" returns subscription');

    // Filter by status
    const statusFilterRes = await makeRequest(
      server,
      { path: '/api/v1/admin/subscriptions?status=active', method: 'GET', headers: authHeaders }
    );
    assert(statusFilterRes.status === 200 && statusFilterRes.body.subscriptions.every((s) => s.status === 'active'), 'Filter by status="active" returns active subscriptions');

    // Filter by plan
    const planFilterRes = await makeRequest(
      server,
      { path: '/api/v1/admin/subscriptions?plan=aura', method: 'GET', headers: authHeaders }
    );
    assert(planFilterRes.status === 200 && planFilterRes.body.subscriptions.length >= 1, 'Filter by plan="aura" returns matching subscriptions');

    // 6. GET /api/v1/admin/subscriptions/:id
    console.log('\n--- TEST 6: GET /api/v1/admin/subscriptions/:id ---');
    const getRes = await makeRequest(
      server,
      { path: `/api/v1/admin/subscriptions/${createdSubId}`, method: 'GET', headers: authHeaders }
    );
    assert(getRes.status === 200, 'GET subscription by custom ID returns HTTP 200');
    assert(getRes.body.subscription && getRes.body.subscription.id === createdSubId, 'Matches requested subscription ID');
    assert(getRes.body.subscription.user.fullName === 'Aarav Sharma', 'User details properly populated');

    const notFoundRes = await makeRequest(
      server,
      { path: '/api/v1/admin/subscriptions/non_existent_sub_id', method: 'GET', headers: authHeaders }
    );
    assert(notFoundRes.status === 404, 'GET non-existent subscription returns HTTP 404');

    // 7. PUT /api/v1/admin/subscriptions/:id (Update)
    console.log('\n--- TEST 7: PUT /api/v1/admin/subscriptions/:id ---');
    const updateRes = await makeRequest(
      server,
      { path: `/api/v1/admin/subscriptions/${createdSubId}`, method: 'PUT', headers: authHeaders },
      { planId: freePlan.key, status: 'inactive' }
    );
    assert(updateRes.status === 200, 'PUT subscription returns HTTP 200');
    assert(updateRes.body.subscription.plan.key === 'free', 'Plan successfully updated to Free');
    assert(updateRes.body.subscription.status === 'inactive', 'Status successfully updated to inactive');

    // 8. PATCH /api/v1/admin/subscriptions/:id/status (Status Action)
    console.log('\n--- TEST 8: PATCH /api/v1/admin/subscriptions/:id/status ---');
    const patchRes = await makeRequest(
      server,
      { path: `/api/v1/admin/subscriptions/${createdSubId}/status`, method: 'PATCH', headers: authHeaders },
      { status: 'cancelled' }
    );
    assert(patchRes.status === 200, 'PATCH status to "cancelled" returns HTTP 200');
    assert(patchRes.body.subscription.status === 'cancelled', 'Status correctly updated to cancelled');

    const invalidPatchRes = await makeRequest(
      server,
      { path: `/api/v1/admin/subscriptions/${createdSubId}/status`, method: 'PATCH', headers: authHeaders },
      { status: 'invalid_status_value' }
    );
    assert(invalidPatchRes.status === 400, 'PATCH with invalid status returns HTTP 400');

    // 9. DELETE /api/v1/admin/subscriptions/:id
    console.log('\n--- TEST 9: DELETE /api/v1/admin/subscriptions/:id ---');
    const deleteRes = await makeRequest(
      server,
      { path: `/api/v1/admin/subscriptions/${createdSubId}`, method: 'DELETE', headers: authHeaders }
    );
    assert(deleteRes.status === 200, 'DELETE subscription returns HTTP 200');

    const verifyDeleteRes = await makeRequest(
      server,
      { path: `/api/v1/admin/subscriptions/${createdSubId}`, method: 'GET', headers: authHeaders }
    );
    assert(verifyDeleteRes.status === 404, 'Deleted subscription returns HTTP 404 on GET');

    // Clean check
    const remainingCount = await Subscription.countDocuments({ user: testUser._id });
    assert(remainingCount === 0, 'No test subscriptions remaining');

  } finally {
    await new Promise((resolve) => server.close(resolve));
    await disconnectDB();
  }

  console.log('\n====================================================');
  console.log(`📊 Admin Subscriptions Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTests().catch((err) => {
    console.error('Fatal error during Admin Subscriptions test execution:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
