const http = require('http');
const app = require('../src/app');
const config = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const { seedDefaultAdmin } = require('../src/seed/seedAdmin');
const Interest = require('../models/Interest');

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
 * Main Test Runner for Admin Interests APIs
 */
async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Admin Interests APIs Backend Test Suite');
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
  assert(true, 'Connected to MongoDB for Interests test suite');

  // 2. Ensure Super Admin is seeded
  await seedDefaultAdmin();

  // 3. Start server on temporary port
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));
  const testPort = server.address().port;
  console.log(`[Test Server] Running on temporary port ${testPort}\n`);

  let createdInterestId = null;

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
    const unauthGet = await makeRequest(server, { path: '/api/v1/admin/interests', method: 'GET' });
    assert(unauthGet.status === 401, 'GET /admin/interests without token returns HTTP 401');

    const unauthPost = await makeRequest(server, { path: '/api/v1/admin/interests', method: 'POST' }, { name: 'Test' });
    assert(unauthPost.status === 401, 'POST /admin/interests without token returns HTTP 401');

    // 6. POST /api/v1/admin/interests (Create New Interest)
    console.log('\n--- TEST 4: POST /api/v1/admin/interests (Create Tag) ---');
    const createRes = await makeRequest(server, {
      path: '/api/v1/admin/interests',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      name: 'TEST_Astronomy_Tag',
      category: 'Education & Skills',
      icon: '🔭',
      isActive: true
    });

    assert(createRes.status === 201, 'POST /admin/interests returns HTTP 201 Created');
    assert(createRes.body.success === true, 'Response contains success: true');
    assert(createRes.body.interest && createRes.body.interest.name === 'TEST_Astronomy_Tag', 'Created interest contains correct name');
    assert(createRes.body.interest.icon === '🔭', 'Created interest contains correct icon');
    createdInterestId = createRes.body.interest.id;

    // 7. POST Duplicate Name Validation
    console.log('\n--- TEST 5: Duplicate Interest Name Prevention ---');
    const duplicateRes = await makeRequest(server, {
      path: '/api/v1/admin/interests',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      name: 'test_astronomy_tag', // case-insensitive duplicate
      category: 'Education & Skills'
    });
    assert(duplicateRes.status === 400, 'Duplicate interest name returns HTTP 400 Bad Request');
    assert(duplicateRes.body.success === false, 'Duplicate error message returned');

    // 8. POST Missing Name Validation
    console.log('\n--- TEST 6: Missing Name Validation ---');
    const missingNameRes = await makeRequest(server, {
      path: '/api/v1/admin/interests',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      category: 'Education & Skills'
    });
    assert(missingNameRes.status === 400, 'Missing name returns HTTP 400 Bad Request');

    // 9. GET /api/v1/admin/interests (List & Filters)
    console.log('\n--- TEST 7: GET /api/v1/admin/interests (List & Categories) ---');
    const listRes = await makeRequest(server, {
      path: '/api/v1/admin/interests',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(listRes.status === 200, 'GET /admin/interests returns HTTP 200');
    assert(listRes.body.success === true, 'Response contains success: true');
    assert(Array.isArray(listRes.body.interests), 'Response contains interests array');
    assert(Array.isArray(listRes.body.categories) && listRes.body.categories.includes('Education & Skills'),
      'Response includes distinct categories array');
    assert(listRes.body.pagination && listRes.body.pagination.totalItems >= 1, 'Response includes pagination metadata');

    // 10. GET with Search
    console.log('\n--- TEST 8: GET /api/v1/admin/interests?search=Astronomy ---');
    const searchRes = await makeRequest(server, {
      path: '/api/v1/admin/interests?search=Astronomy',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(searchRes.status === 200, 'Search query returns HTTP 200');
    assert(searchRes.body.interests.some(i => i.name === 'TEST_Astronomy_Tag'), 'Search correctly finds the tag');

    // 11. PUT /api/v1/admin/interests/:id (Update Tag)
    console.log('\n--- TEST 9: PUT /api/v1/admin/interests/:id (Update Metadata) ---');
    const updateRes = await makeRequest(server, {
      path: `/api/v1/admin/interests/${createdInterestId}`,
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      name: 'TEST_Astrophysics_Tag',
      category: 'Science & Education',
      icon: '🌌',
      isActive: true
    });

    assert(updateRes.status === 200, 'PUT /admin/interests/:id returns HTTP 200');
    assert(updateRes.body.success === true, 'Update response contains success: true');
    assert(updateRes.body.interest.name === 'TEST_Astrophysics_Tag', 'Tag name successfully updated to "TEST_Astrophysics_Tag"');
    assert(updateRes.body.interest.icon === '🌌', 'Tag icon successfully updated');

    // 12. PUT Non-existent ID -> Expect 404
    console.log('\n--- TEST 10: PUT Non-existent Interest ID ---');
    const update404 = await makeRequest(server, {
      path: '/api/v1/admin/interests/non_existent_int_99999',
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      name: 'Non Existent'
    });
    assert(update404.status === 404, 'Updating non-existent interest returns HTTP 404 Not Found');

    // 13. DELETE /api/v1/admin/interests/:id (Delete Tag)
    console.log('\n--- TEST 11: DELETE /api/v1/admin/interests/:id ---');
    const deleteRes = await makeRequest(server, {
      path: `/api/v1/admin/interests/${createdInterestId}`,
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(deleteRes.status === 200, 'DELETE /admin/interests/:id returns HTTP 200');
    assert(deleteRes.body.success === true, 'Delete response contains success: true');

    // Verify deletion in DB
    const checkDeleted = await Interest.findOne({ id: createdInterestId });
    assert(checkDeleted === null, 'Interest tag confirmed deleted from MongoDB');

    // 14. DELETE Non-existent ID -> Expect 404
    console.log('\n--- TEST 12: DELETE Non-existent Interest ID ---');
    const delete404 = await makeRequest(server, {
      path: '/api/v1/admin/interests/non_existent_int_99999',
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(delete404.status === 404, 'Deleting non-existent interest returns HTTP 404 Not Found');

    // 15. Regression Check: Admin Auth, Users, and Friendships
    console.log('\n--- TEST 13: Regression Checks ---');
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

    const frRes = await makeRequest(server, {
      path: '/api/v1/admin/friendships',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(frRes.status === 200, 'GET /admin/friendships still works');

  } finally {
    // 16. Cleanup any test interests
    console.log('\n--- TEST 14: Cleanup Test Data ---');
    const delCount = await Interest.deleteMany({ name: { $regex: /^TEST_/i } });
    console.log(`[Cleanup] Removed ${delCount.deletedCount} temporary test interest record(s).`);

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
