const http = require('http');
const app = require('../src/app');
const config = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const { seedDefaultAdmin } = require('../src/seed/seedAdmin');
const { seedDemoData } = require('../src/seed/demoSeed');
const Plan = require('../src/models/Plan');

/**
 * Helper to make HTTP requests against the in-memory test server
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
 * Main Test Runner for Admin Plans APIs
 */
async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Admin Plans Backend Test Suite');
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
  assert(true, 'Connected to MongoDB for Plans test suite');

  await seedDefaultAdmin();
  await seedDemoData();
  assert(true, 'Admin and demo seeds verified');

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
    const unauthGet = await makeRequest(server, { path: '/api/v1/admin/plans', method: 'GET' });
    assert(unauthGet.status === 401, 'GET /admin/plans without token returns HTTP 401');

    const unauthPost = await makeRequest(server, { path: '/api/v1/admin/plans', method: 'POST' }, { key: 'test', name: 'Test' });
    assert(unauthPost.status === 401, 'POST /admin/plans without token returns HTTP 401');

    const unauthPut = await makeRequest(server, { path: '/api/v1/admin/plans/demo_plan_free', method: 'PUT' }, { name: 'New Free' });
    assert(unauthPut.status === 401, 'PUT /admin/plans/:id without token returns HTTP 401');

    const unauthPatch = await makeRequest(server, { path: '/api/v1/admin/plans/demo_plan_free/status', method: 'PATCH' }, { isActive: false });
    assert(unauthPatch.status === 401, 'PATCH /admin/plans/:id/status without token returns HTTP 401');

    const unauthDelete = await makeRequest(server, { path: '/api/v1/admin/plans/demo_plan_free', method: 'DELETE' });
    assert(unauthDelete.status === 401, 'DELETE /admin/plans/:id without token returns HTTP 401');

    // Clean up any stale test plans
    await Plan.deleteMany({ key: { $regex: /^test_/i } });

    // 4. GET /api/v1/admin/plans (List, Sort, Search, Filter)
    console.log('\n--- TEST 4: GET /api/v1/admin/plans (Listing & Filters) ---');
    const listRes = await makeRequest(server, { path: '/api/v1/admin/plans', method: 'GET', headers: authHeaders });
    assert(listRes.status === 200, 'GET /admin/plans returns HTTP 200');
    assert(Array.isArray(listRes.body.plans), 'Returns plans array');
    assert(listRes.body.plans.length >= 2, 'Contains at least Free and Aura plans');
    assert(listRes.body.pagination && listRes.body.pagination.totalItems >= 2, 'Returns pagination metadata');

    // Check displayOrder ascending
    const orders = listRes.body.plans.map((p) => p.displayOrder);
    const isSorted = orders.every((val, i, arr) => !i || arr[i - 1] <= val);
    assert(isSorted, 'Plans are sorted by displayOrder ascending');

    // Search filter
    const searchRes = await makeRequest(server, { path: '/api/v1/admin/plans?search=aura', method: 'GET', headers: authHeaders });
    assert(searchRes.status === 200 && searchRes.body.plans.some((p) => p.key === 'aura'), 'Search by "aura" returns Aura plan');

    // Active status filter
    const activeRes = await makeRequest(server, { path: '/api/v1/admin/plans?isActive=true', method: 'GET', headers: authHeaders });
    assert(activeRes.status === 200 && activeRes.body.plans.every((p) => p.isActive === true), 'Filter by isActive=true returns only active plans');

    // 5. GET /api/v1/admin/plans/:id
    console.log('\n--- TEST 5: GET /api/v1/admin/plans/:id (Single Plan) ---');
    const getRes = await makeRequest(server, { path: '/api/v1/admin/plans/demo_plan_free', method: 'GET', headers: authHeaders });
    assert(getRes.status === 200, 'GET plan by custom string ID returns HTTP 200');
    assert(getRes.body.plan && getRes.body.plan.key === 'free', 'Returned plan matches expected key "free"');

    const notFoundRes = await makeRequest(server, { path: '/api/v1/admin/plans/non_existent_plan_id', method: 'GET', headers: authHeaders });
    assert(notFoundRes.status === 404, 'GET non-existent plan returns HTTP 404');

    // 6. POST /api/v1/admin/plans (Creation & Validation)
    console.log('\n--- TEST 6: POST /api/v1/admin/plans (Creation & Validation) ---');

    // Missing key
    const missingKeyRes = await makeRequest(
      server,
      { path: '/api/v1/admin/plans', method: 'POST', headers: authHeaders },
      { name: 'Missing Key Tier' }
    );
    assert(missingKeyRes.status === 400, 'Creation without key returns HTTP 400');

    // Missing name
    const missingNameRes = await makeRequest(
      server,
      { path: '/api/v1/admin/plans', method: 'POST', headers: authHeaders },
      { key: 'test_no_name' }
    );
    assert(missingNameRes.status === 400, 'Creation without name returns HTTP 400');

    // Duplicate key
    const duplicateKeyRes = await makeRequest(
      server,
      { path: '/api/v1/admin/plans', method: 'POST', headers: authHeaders },
      { key: 'free', name: 'Duplicate Free Plan' }
    );
    assert(duplicateKeyRes.status === 400, 'Creation with duplicate key "free" returns HTTP 400');

    // Negative pricing
    const negPriceRes = await makeRequest(
      server,
      { path: '/api/v1/admin/plans', method: 'POST', headers: authHeaders },
      { key: 'test_neg_price', name: 'Neg Price Plan', pricing: { monthly: { amount: -50 } } }
    );
    assert(negPriceRes.status === 400, 'Creation with negative pricing returns HTTP 400');

    // Negative limits
    const negLimitRes = await makeRequest(
      server,
      { path: '/api/v1/admin/plans', method: 'POST', headers: authHeaders },
      { key: 'test_neg_limit', name: 'Neg Limit Plan', limits: { maxGroupRoomCapacity: -5 } }
    );
    assert(negLimitRes.status === 400, 'Creation with negative limits returns HTTP 400');

    // Valid plan creation
    const createRes = await makeRequest(
      server,
      { path: '/api/v1/admin/plans', method: 'POST', headers: authHeaders },
      {
        key: 'test_pro',
        name: 'Pro Tier',
        description: 'Professional tier with premium perks',
        badgeText: 'Pro',
        features: ['HD Audio', 'Unlimited Minutes'],
        limits: {
          maxDailyCallMinutes: 300,
          maxGroupRoomCapacity: 40,
          canHostGroupRooms: true,
          canCreatePrivateRooms: true,
          hasAuraGlow: true,
          hasPriorityMatching: true,
          audioBitrateKbps: 128
        },
        pricing: {
          monthly: { amount: 199, currency: 'inr' },
          yearly: { amount: 1999, currency: 'inr' }
        },
        displayOrder: 3
      }
    );
    assert(createRes.status === 201, 'Valid plan creation returns HTTP 201');
    assert(createRes.body.plan && createRes.body.plan.key === 'test_pro', 'Created plan has normalized key "test_pro"');
    assert(createRes.body.plan.pricing.monthly.currency === 'INR', 'Currency was normalized to uppercase "INR"');
    const createdPlanId = createRes.body.plan.id;

    // 7. PUT /api/v1/admin/plans/:id (Update & Preservation of Nested Values)
    console.log('\n--- TEST 7: PUT /api/v1/admin/plans/:id (Update & Nested Merging) ---');

    // Partial update: update name and description only
    const updateRes = await makeRequest(
      server,
      { path: `/api/v1/admin/plans/${createdPlanId}`, method: 'PUT', headers: authHeaders },
      { name: 'Pro Tier Updated', description: 'Updated description' }
    );
    assert(updateRes.status === 200, 'PUT plan returns HTTP 200');
    assert(updateRes.body.plan.name === 'Pro Tier Updated', 'Plan name updated');
    assert(updateRes.body.plan.limits.maxGroupRoomCapacity === 40, 'Unspecified limits preserved (capacity remained 40)');
    assert(updateRes.body.plan.pricing.monthly.amount === 199, 'Unspecified pricing preserved (monthly amount remained 199)');

    // Invalid pricing on update
    const updateNegPriceRes = await makeRequest(
      server,
      { path: `/api/v1/admin/plans/${createdPlanId}`, method: 'PUT', headers: authHeaders },
      { pricing: { yearly: { amount: -100 } } }
    );
    assert(updateNegPriceRes.status === 400, 'PUT with negative pricing returns HTTP 400');

    // 8. Default Plan Exclusivity & Safety Guard
    console.log('\n--- TEST 8: Default Plan Exclusivity & Safety Guards ---');

    // Set Aura as default
    const setAuraDefaultRes = await makeRequest(
      server,
      { path: '/api/v1/admin/plans/demo_plan_aura', method: 'PUT', headers: authHeaders },
      { isDefault: true }
    );
    assert(setAuraDefaultRes.status === 200, 'Set Aura as default returns HTTP 200');
    assert(setAuraDefaultRes.body.plan.isDefault === true, 'Aura is now default');

    // Verify Free is no longer default
    const getFreeAfterAuraDefault = await makeRequest(
      server,
      { path: '/api/v1/admin/plans/demo_plan_free', method: 'GET', headers: authHeaders },
    );
    assert(getFreeAfterAuraDefault.body.plan.isDefault === false, 'Free plan isDefault automatically became false');

    // Set Free back as default
    const setFreeDefaultRes = await makeRequest(
      server,
      { path: '/api/v1/admin/plans/demo_plan_free', method: 'PUT', headers: authHeaders },
      { isDefault: true }
    );
    assert(setFreeDefaultRes.status === 200, 'Set Free back as default returns HTTP 200');
    assert(setFreeDefaultRes.body.plan.isDefault === true, 'Free plan is now default again');

    // Attempt to unset isDefault on Free leaving 0 default plans
    const unsetDefaultRes = await makeRequest(
      server,
      { path: '/api/v1/admin/plans/demo_plan_free', method: 'PUT', headers: authHeaders },
      { isDefault: false }
    );
    assert(unsetDefaultRes.status === 400, 'Unsetting default on the only default plan returns HTTP 400');

    // Attempt to deactivate default plan via PUT
    const deactDefaultPutRes = await makeRequest(
      server,
      { path: '/api/v1/admin/plans/demo_plan_free', method: 'PUT', headers: authHeaders },
      { isActive: false }
    );
    assert(deactDefaultPutRes.status === 400, 'Deactivating default plan via PUT returns HTTP 400');

    // Attempt to deactivate default plan via PATCH
    const deactDefaultPatchRes = await makeRequest(
      server,
      { path: '/api/v1/admin/plans/demo_plan_free/status', method: 'PATCH', headers: authHeaders },
      { isActive: false }
    );
    assert(deactDefaultPatchRes.status === 400, 'Deactivating default plan via PATCH returns HTTP 400');

    // 9. PATCH /api/v1/admin/plans/:id/status (Active/Inactive Toggle)
    console.log('\n--- TEST 9: PATCH /api/v1/admin/plans/:id/status ---');
    const deactProRes = await makeRequest(
      server,
      { path: `/api/v1/admin/plans/${createdPlanId}/status`, method: 'PATCH', headers: authHeaders },
      { status: 'inactive' }
    );
    assert(deactProRes.status === 200 && deactProRes.body.plan.isActive === false, 'Deactivate Pro plan returns HTTP 200 with isActive=false');

    const actProRes = await makeRequest(
      server,
      { path: `/api/v1/admin/plans/${createdPlanId}/status`, method: 'PATCH', headers: authHeaders },
      { status: 'active' }
    );
    assert(actProRes.status === 200 && actProRes.body.plan.isActive === true, 'Reactivate Pro plan returns HTTP 200 with isActive=true');

    // 10. DELETE /api/v1/admin/plans/:id (Deletion & Safety Guard)
    console.log('\n--- TEST 10: DELETE /api/v1/admin/plans/:id (Safety Guard & Deletion) ---');

    // Attempt to delete default plan (Free)
    const deleteFreeRes = await makeRequest(
      server,
      { path: '/api/v1/admin/plans/demo_plan_free', method: 'DELETE', headers: authHeaders }
    );
    assert(deleteFreeRes.status === 400, 'Deleting default/free plan is rejected with HTTP 400');

    // Delete custom plan (Pro)
    const deleteProRes = await makeRequest(
      server,
      { path: `/api/v1/admin/plans/${createdPlanId}`, method: 'DELETE', headers: authHeaders }
    );
    assert(deleteProRes.status === 200, 'Deleting custom non-default plan returns HTTP 200');

    // Verify Pro is gone
    const verifyDeleteRes = await makeRequest(
      server,
      { path: `/api/v1/admin/plans/${createdPlanId}`, method: 'GET', headers: authHeaders }
    );
    assert(verifyDeleteRes.status === 404, 'Deleted plan returns HTTP 404 on GET');

    // 11. Final Seed Idempotency Check
    console.log('\n--- TEST 11: Demo Seed Idempotency Final Check ---');
    const summary = await seedDemoData();
    assert(summary.plans.created === 0 && summary.plans.existing === 2, 'Repeated demo seed creates 0 plans and finds 2 existing');

    const totalPlans = await Plan.countDocuments();
    assert(totalPlans === 2, 'Database contains exactly 2 plans (Free and Aura)');

  } finally {
    await new Promise((resolve) => server.close(resolve));
    await disconnectDB();
  }

  console.log('\n====================================================');
  console.log(`📊 Admin Plans Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTests().catch((err) => {
    console.error('Fatal error during Admin Plans test execution:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
