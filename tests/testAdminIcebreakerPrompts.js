const http = require('http');
const app = require('../src/app');
const config = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const { seedDefaultAdmin } = require('../src/seed/seedAdmin');
const IcebreakerPrompt = require('../src/models/IcebreakerPrompt');

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
 * Main Test Runner for Admin Icebreaker Prompts APIs
 */
async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Admin Icebreaker Prompts Backend Test Suite');
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

  // 1. Establish DB connection
  console.log('--- TEST 1: Database Handshake ---');
  await connectDB();
  assert(true, 'Connected to MongoDB for Icebreaker Prompts test suite');

  // 2. Ensure Super Admin is seeded
  await seedDefaultAdmin();

  // 3. Start server on temporary port
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));
  const testPort = server.address().port;
  console.log(`[Test Server] Running on temporary port ${testPort}\n`);

  let createdPromptId = null;
  let generalPromptId = null;

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
    console.log('\n--- TEST 3: Unauthenticated Access Guards ---');
    const unauthGet = await makeRequest(server, { path: '/api/v1/admin/icebreaker-prompts', method: 'GET' });
    assert(unauthGet.status === 401, 'GET /admin/icebreaker-prompts without token returns HTTP 401');

    const unauthPost = await makeRequest(server, { path: '/api/v1/admin/icebreaker-prompts', method: 'POST' }, { interest: 'Movies', prompt: 'Fav movie?' });
    assert(unauthPost.status === 401, 'POST /admin/icebreaker-prompts without token returns HTTP 401');

    // Clean any previous test prompts
    await IcebreakerPrompt.deleteMany({ prompt: { $regex: /^TEST_/i } });

    // 6. GET list with empty / existing collection
    console.log('\n--- TEST 4: GET /api/v1/admin/icebreaker-prompts (List Prompts) ---');
    const emptyListRes = await makeRequest(server, {
      path: '/api/v1/admin/icebreaker-prompts',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(emptyListRes.status === 200, 'GET /admin/icebreaker-prompts returns HTTP 200');
    assert(emptyListRes.body.success === true, 'Response contains success: true');
    assert(Array.isArray(emptyListRes.body.data), 'Response contains data array');
    assert(emptyListRes.body.pagination && typeof emptyListRes.body.pagination.total === 'number', 'Response contains pagination object with total');

    // 7. POST valid Interest-based prompt
    console.log('\n--- TEST 5: POST /api/v1/admin/icebreaker-prompts (Create Interest-based Prompt) ---');
    const createRes = await makeRequest(server, {
      path: '/api/v1/admin/icebreaker-prompts',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      interest: 'Movies',
      prompt: "TEST_What's your all-time favourite film genre and movie?",
      status: 'active'
    });

    assert(createRes.status === 201, 'POST /admin/icebreaker-prompts returns HTTP 201 Created');
    assert(createRes.body.success === true, 'Create response contains success: true');
    assert(createRes.body.data && createRes.body.data.id && createRes.body.data.id.startsWith('prompt_'), 'Created prompt has valid custom ID (prompt_...)');
    assert(createRes.body.data.interest === 'Movies', 'Created prompt has interest: "Movies"');
    assert(createRes.body.data.status === 'active', 'Created prompt has status: "active"');
    createdPromptId = createRes.body.data.id;

    // 8. POST valid General / Fallback prompt
    console.log('\n--- TEST 6: POST /api/v1/admin/icebreaker-prompts (Create General/Fallback Prompt) ---');
    const createGenRes = await makeRequest(server, {
      path: '/api/v1/admin/icebreaker-prompts',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      interest: 'General',
      prompt: "TEST_What is something fun you have done recently?",
      status: 'active'
    });

    assert(createGenRes.status === 201, 'POST General fallback prompt returns HTTP 201');
    assert(createGenRes.body.data && createGenRes.body.data.interest === 'General', 'Created fallback prompt has interest: "General"');
    generalPromptId = createGenRes.body.data.id;

    // 9. POST Validation - Missing Interest
    console.log('\n--- TEST 7: POST Validation - Missing Interest ---');
    const missingInterestRes = await makeRequest(server, {
      path: '/api/v1/admin/icebreaker-prompts',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      prompt: 'TEST_Prompt without interest'
    });
    assert(missingInterestRes.status === 400, 'POST missing interest returns HTTP 400');
    assert(missingInterestRes.body.success === false, 'Error response returned for missing interest');

    // 10. POST Validation - Missing Prompt
    console.log('\n--- TEST 8: POST Validation - Missing Prompt ---');
    const missingPromptRes = await makeRequest(server, {
      path: '/api/v1/admin/icebreaker-prompts',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      interest: 'Gaming'
    });
    assert(missingPromptRes.status === 400, 'POST missing prompt returns HTTP 400');

    // 11. POST Validation - Invalid Status
    console.log('\n--- TEST 9: POST Validation - Invalid Status ---');
    const invalidStatusRes = await makeRequest(server, {
      path: '/api/v1/admin/icebreaker-prompts',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      interest: 'Gaming',
      prompt: 'TEST_What game are you playing?',
      status: 'archived_invalid'
    });
    assert(invalidStatusRes.status === 400, 'POST invalid status returns HTTP 400');

    // 12. GET single existing prompt
    console.log('\n--- TEST 10: GET /api/v1/admin/icebreaker-prompts/:id (Get Single Prompt) ---');
    const getSingleRes = await makeRequest(server, {
      path: `/api/v1/admin/icebreaker-prompts/${createdPromptId}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(getSingleRes.status === 200, 'GET /admin/icebreaker-prompts/:id returns HTTP 200');
    assert(getSingleRes.body.success === true, 'Response contains success: true');
    assert(getSingleRes.body.data && getSingleRes.body.data.id === createdPromptId, 'Returned prompt matches requested ID');

    // 13. GET single non-existent prompt -> 404
    console.log('\n--- TEST 11: GET /api/v1/admin/icebreaker-prompts/:id (Non-existent ID) ---');
    const get404Res = await makeRequest(server, {
      path: '/api/v1/admin/icebreaker-prompts/prompt_nonexistent_99999',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(get404Res.status === 404, 'GET non-existent prompt returns HTTP 404');
    assert(get404Res.body.success === false, 'Response has success: false');

    // 14. GET list with Search
    console.log('\n--- TEST 12: GET /api/v1/admin/icebreaker-prompts?search=favourite ---');
    const searchRes = await makeRequest(server, {
      path: '/api/v1/admin/icebreaker-prompts?search=favourite',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(searchRes.status === 200, 'Search query returns HTTP 200');
    assert(searchRes.body.data.some(p => p.id === createdPromptId), 'Search returns the matching prompt');

    // 15. GET list with Interest Filter
    console.log('\n--- TEST 13: GET /api/v1/admin/icebreaker-prompts?interest=General ---');
    const interestFilterRes = await makeRequest(server, {
      path: '/api/v1/admin/icebreaker-prompts?interest=General',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(interestFilterRes.status === 200, 'Interest filter returns HTTP 200');
    assert(interestFilterRes.body.data.every(p => p.interest.toLowerCase() === 'general'), 'All returned prompts match interest "General"');

    // 16. GET list with Pagination
    console.log('\n--- TEST 14: GET /api/v1/admin/icebreaker-prompts?page=1&limit=1 ---');
    const pageRes = await makeRequest(server, {
      path: '/api/v1/admin/icebreaker-prompts?page=1&limit=1',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(pageRes.status === 200, 'Pagination query returns HTTP 200');
    assert(pageRes.body.data.length <= 1, 'Page size respects limit=1');
    assert(pageRes.body.pagination.page === 1 && pageRes.body.pagination.limit === 1, 'Pagination metadata matches requested query');

    // 17. PUT /api/v1/admin/icebreaker-prompts/:id (Update Prompt)
    console.log('\n--- TEST 15: PUT /api/v1/admin/icebreaker-prompts/:id (Update Prompt) ---');
    const updateRes = await makeRequest(server, {
      path: `/api/v1/admin/icebreaker-prompts/${createdPromptId}`,
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      interest: 'Cinema & Movies',
      prompt: "TEST_What's your all-time favorite movie or director?",
      status: 'active'
    });
    assert(updateRes.status === 200, 'PUT /admin/icebreaker-prompts/:id returns HTTP 200');
    assert(updateRes.body.success === true, 'Update returns success: true');
    assert(updateRes.body.data.interest === 'Cinema & Movies', 'Prompt interest successfully updated');
    assert(updateRes.body.data.prompt.includes('favorite movie or director'), 'Prompt text successfully updated');

    // 18. PUT Non-existent ID -> 404
    console.log('\n--- TEST 16: PUT Non-existent ID ---');
    const update404Res = await makeRequest(server, {
      path: '/api/v1/admin/icebreaker-prompts/prompt_nonexistent_99999',
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      prompt: 'TEST_Something'
    });
    assert(update404Res.status === 404, 'PUT non-existent prompt returns HTTP 404');

    // 19. PATCH /api/v1/admin/icebreaker-prompts/:id/status (Deactivate)
    console.log('\n--- TEST 17: PATCH /api/v1/admin/icebreaker-prompts/:id/status (Set Inactive) ---');
    const patchInactiveRes = await makeRequest(server, {
      path: `/api/v1/admin/icebreaker-prompts/${createdPromptId}/status`,
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      status: 'inactive'
    });
    assert(patchInactiveRes.status === 200, 'PATCH status inactive returns HTTP 200');
    assert(patchInactiveRes.body.data.status === 'inactive', 'Prompt status successfully updated to "inactive"');

    // 20. GET list with Status Filter (status=inactive)
    console.log('\n--- TEST 18: GET /api/v1/admin/icebreaker-prompts?status=inactive ---');
    const statusFilterRes = await makeRequest(server, {
      path: '/api/v1/admin/icebreaker-prompts?status=inactive',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(statusFilterRes.status === 200, 'Status filter query returns HTTP 200');
    assert(statusFilterRes.body.data.some(p => p.id === createdPromptId), 'Inactive filter includes the deactivated prompt');

    // 21. PATCH status active
    console.log('\n--- TEST 19: PATCH status back to active ---');
    const patchActiveRes = await makeRequest(server, {
      path: `/api/v1/admin/icebreaker-prompts/${createdPromptId}/status`,
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      status: 'active'
    });
    assert(patchActiveRes.status === 200, 'PATCH status active returns HTTP 200');
    assert(patchActiveRes.body.data.status === 'active', 'Prompt status successfully restored to "active"');

    // 22. PATCH Invalid Status Validation
    console.log('\n--- TEST 20: PATCH Invalid Status Validation ---');
    const patchInvalidRes = await makeRequest(server, {
      path: `/api/v1/admin/icebreaker-prompts/${createdPromptId}/status`,
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      status: 'pending' // invalid status
    });
    assert(patchInvalidRes.status === 400, 'PATCH invalid status returns HTTP 400');

    // 23. DELETE /api/v1/admin/icebreaker-prompts/:id (Delete Prompt)
    console.log('\n--- TEST 21: DELETE /api/v1/admin/icebreaker-prompts/:id ---');
    const deleteRes = await makeRequest(server, {
      path: `/api/v1/admin/icebreaker-prompts/${createdPromptId}`,
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(deleteRes.status === 200, 'DELETE /admin/icebreaker-prompts/:id returns HTTP 200');
    assert(deleteRes.body.success === true, 'Delete response contains success: true');

    // Verify deletion in DB
    const checkDeleted = await IcebreakerPrompt.findOne({ id: createdPromptId });
    assert(checkDeleted === null, 'Prompt confirmed deleted from database');

    // 24. DELETE Non-existent ID -> 404
    console.log('\n--- TEST 22: DELETE Non-existent ID ---');
    const delete404Res = await makeRequest(server, {
      path: '/api/v1/admin/icebreaker-prompts/prompt_nonexistent_99999',
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(delete404Res.status === 404, 'DELETE non-existent prompt returns HTTP 404');

    // Delete general prompt as well
    if (generalPromptId) {
      await makeRequest(server, {
        path: `/api/v1/admin/icebreaker-prompts/${generalPromptId}`,
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
    }

  } finally {
    // 25. Cleanup
    console.log('\n--- TEST 23: Cleanup Test Data ---');
    const delCount = await IcebreakerPrompt.deleteMany({ prompt: { $regex: /^TEST_/i } });
    console.log(`[Cleanup] Removed ${delCount.deletedCount} temporary test prompt record(s).`);

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
