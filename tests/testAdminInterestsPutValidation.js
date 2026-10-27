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

    if (body !== null) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Test Runner for PUT Empty Body Validation
 */
async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Admin Interests PUT Empty-Body Validation Test');
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

  // 1. Establish DB Connection & Seed Admin
  await connectDB();
  await seedDefaultAdmin();

  // 2. Setup a base test interest in MongoDB
  await Interest.deleteMany({ name: { $regex: /^TEST_/i } });
  const testTag = new Interest({
    id: 'int_TEST_ORIGINAL_01',
    name: 'TEST_Original_Tag',
    category: 'Entertainment & Arts',
    icon: '🎵',
    isActive: true,
    userCount: 10
  });
  await testTag.save();

  // 3. Start server on temporary port
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));
  const testPort = server.address().port;
  console.log(`[Test Server] Running on temporary port ${testPort}\n`);

  try {
    // 4. Authenticate Admin
    const loginRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/login',
      method: 'POST'
    }, {
      email: config.defaultAdmin.email,
      password: config.defaultAdmin.password
    });
    assert(loginRes.status === 200 && loginRes.body.token, 'Admin authenticated successfully');
    const adminToken = loginRes.body.token;

    // SCENARIO A: PUT with no body
    console.log('\n--- SCENARIO A: PUT with no body ---');
    const noBodyRes = await makeRequest(server, {
      path: `/api/v1/admin/interests/${testTag.id}`,
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, null);

    assert(noBodyRes.status === 400, 'PUT with no body returns HTTP 400 Bad Request');
    assert(noBodyRes.body.success === false, 'Response has success: false');
    assert(noBodyRes.body.error === 'At least one field is required to update the interest.',
      'Error message states: "At least one field is required to update the interest."');

    // SCENARIO B: PUT with empty JSON body {}
    console.log('\n--- SCENARIO B: PUT with empty body {} ---');
    const emptyBodyRes = await makeRequest(server, {
      path: `/api/v1/admin/interests/${testTag.id}`,
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {});

    assert(emptyBodyRes.status === 400, 'PUT with {} returns HTTP 400 Bad Request');
    assert(emptyBodyRes.body.success === false, 'Response has success: false');
    assert(emptyBodyRes.body.error === 'At least one field is required to update the interest.',
      'Error message states: "At least one field is required to update the interest."');

    // SCENARIO C: PUT with unsupported fields only
    console.log('\n--- SCENARIO C: PUT with unsupported fields only ---');
    const unsupportedRes = await makeRequest(server, {
      path: `/api/v1/admin/interests/${testTag.id}`,
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      unknownField123: 'someValue',
      fakeProperty: true
    });

    assert(unsupportedRes.status === 400, 'PUT with unsupported fields returns HTTP 400 Bad Request');
    assert(unsupportedRes.body.success === false, 'Response has success: false');
    assert(unsupportedRes.body.error === 'At least one field is required to update the interest.',
      'Error message states: "At least one field is required to update the interest."');

    // SCENARIO F1: Verify invalid requests did NOT modify MongoDB
    console.log('\n--- SCENARIO F1: Verify invalid requests did NOT modify MongoDB ---');
    const dbDocBeforeValid = await Interest.findOne({ id: testTag.id });
    assert(dbDocBeforeValid.name === 'TEST_Original_Tag', 'Document name remained untouched');
    assert(dbDocBeforeValid.category === 'Entertainment & Arts', 'Document category remained untouched');
    assert(dbDocBeforeValid.icon === '🎵', 'Document icon remained untouched');
    assert(dbDocBeforeValid.isActive === true, 'Document isActive remained untouched');

    // SCENARIO D: PUT with one valid field (e.g. only name)
    console.log('\n--- SCENARIO D: PUT with one valid field (partial update) ---');
    const partialRes = await makeRequest(server, {
      path: `/api/v1/admin/interests/${testTag.id}`,
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      name: 'TEST_Single_Field_Updated'
    });

    assert(partialRes.status === 200, 'PUT with one valid field returns HTTP 200 OK');
    assert(partialRes.body.success === true, 'Response has success: true');
    assert(partialRes.body.interest.name === 'TEST_Single_Field_Updated', 'Interest name was updated');
    assert(partialRes.body.interest.category === 'Entertainment & Arts', 'Unmodified category was preserved');

    // SCENARIO E: PUT with multiple valid fields
    console.log('\n--- SCENARIO E: PUT with multiple valid fields ---');
    const multiRes = await makeRequest(server, {
      path: `/api/v1/admin/interests/${testTag.id}`,
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      name: 'TEST_Multi_Field_Updated',
      category: 'Gaming & Tech',
      icon: '🎮',
      isActive: false
    });

    assert(multiRes.status === 200, 'PUT with multiple valid fields returns HTTP 200 OK');
    assert(multiRes.body.interest.name === 'TEST_Multi_Field_Updated', 'Name updated');
    assert(multiRes.body.interest.category === 'Gaming & Tech', 'Category updated');
    assert(multiRes.body.interest.icon === '🎮', 'Icon updated');
    assert(multiRes.body.interest.isActive === false, 'isActive updated to false');

    // SCENARIO G: Regression checks for GET, POST, DELETE
    console.log('\n--- SCENARIO G: Regression Checks on GET, POST, and DELETE ---');
    // 1. GET
    const getRes = await makeRequest(server, {
      path: '/api/v1/admin/interests',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(getRes.status === 200 && Array.isArray(getRes.body.interests), 'GET /admin/interests still works');

    // 2. POST
    const postRes = await makeRequest(server, {
      path: '/api/v1/admin/interests',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      name: 'TEST_Regression_Post_Tag',
      category: 'Health & Lifestyle',
      icon: '🏃'
    });
    assert(postRes.status === 201 && postRes.body.interest, 'POST /admin/interests still works');

    // 3. DELETE
    const deleteRes = await makeRequest(server, {
      path: `/api/v1/admin/interests/${postRes.body.interest.id}`,
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(deleteRes.status === 200 && deleteRes.body.success === true, 'DELETE /admin/interests/:id still works');

  } finally {
    // Cleanup temporary test records
    await Interest.deleteMany({ name: { $regex: /^TEST_/i } });
    console.log('\n[Cleanup] All test interest records removed.');
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
