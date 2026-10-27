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
 * Test Suite: Verify GET /api/v1/admin/interests Read-Only & Body Handling Behavior
 */
async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Admin Interests GET Body Handling Audit Test');
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

  // 2. Clean up any prior test interests
  await Interest.deleteMany({ name: { $regex: /^TEST_/i } });

  // 3. Start server on temporary port
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));
  const testPort = server.address().port;
  console.log(`[Test Server] Running on temporary port ${testPort}\n`);

  let createdPostInterestId = null;

  try {
    // Authenticate Admin
    const loginRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/login',
      method: 'POST'
    }, {
      email: config.defaultAdmin.email,
      password: config.defaultAdmin.password
    });
    assert(loginRes.status === 200 && loginRes.body.token, 'Admin authenticated and received JWT token');
    const adminToken = loginRes.body.token;

    // Get initial interest count in DB
    const initialCount = await Interest.countDocuments({});

    // SCENARIO A: GET /api/v1/admin/interests without body
    console.log('\n--- SCENARIO A: GET without body ---');
    const getNoBodyRes = await makeRequest(server, {
      path: '/api/v1/admin/interests',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(getNoBodyRes.status === 200, 'GET without body returns HTTP 200 OK');
    assert(getNoBodyRes.body.success === true, 'Response contains success: true');
    assert(Array.isArray(getNoBodyRes.body.interests), 'Response contains interests array');

    // SCENARIO B: GET /api/v1/admin/interests with a POST-style JSON body
    console.log('\n--- SCENARIO B: GET with POST-style JSON body ---');
    const getWithBodyRes = await makeRequest(server, {
      path: '/api/v1/admin/interests',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      name: 'TEST_Fake_Created_Via_Get',
      category: 'Entertainment',
      icon: '🎵',
      isActive: true
    });

    assert(getWithBodyRes.status === 200, 'GET with JSON body returns HTTP 200 OK');
    assert(getWithBodyRes.body.success === true, 'Response contains success: true');

    // Check DB count to verify NO new record was created
    const countAfterGetWithBody = await Interest.countDocuments({});
    assert(countAfterGetWithBody === initialCount, `DB count unchanged (${countAfterGetWithBody} === ${initialCount})`);

    // Verify the body tag was NOT inserted into MongoDB
    const fakeTagCheck = await Interest.findOne({ name: 'TEST_Fake_Created_Via_Get' });
    assert(fakeTagCheck === null, 'Tag from GET body was NOT created in MongoDB');

    // SCENARIO C: POST /api/v1/admin/interests creates an interest correctly
    console.log('\n--- SCENARIO C: POST creates an interest correctly ---');
    const postRes = await makeRequest(server, {
      path: '/api/v1/admin/interests',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      name: 'TEST_Real_Post_Tag',
      category: 'Entertainment & Arts',
      icon: '🎸',
      isActive: true
    });

    assert(postRes.status === 201, 'POST returns HTTP 201 Created');
    assert(postRes.body.success === true, 'POST response contains success: true');
    assert(postRes.body.interest && postRes.body.interest.name === 'TEST_Real_Post_Tag', 'POST response returns created interest');
    createdPostInterestId = postRes.body.interest.id;

    // Verify in DB
    const postTagInDb = await Interest.findOne({ name: 'TEST_Real_Post_Tag' });
    assert(postTagInDb !== null, 'POST tag successfully persisted in MongoDB');

    // SCENARIO D: GET after POST reads the newly stored interest
    console.log('\n--- SCENARIO D: GET after POST reads stored interests ---');
    const getAfterPostRes = await makeRequest(server, {
      path: '/api/v1/admin/interests',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    assert(getAfterPostRes.status === 200, 'GET returns HTTP 200 OK');
    assert(getAfterPostRes.body.interests.some(i => i.name === 'TEST_Real_Post_Tag'), 'GET lists the newly created POST tag');
    const countAfterPost = await Interest.countDocuments({});
    assert(countAfterPost === initialCount + 1, `DB count incremented by exactly 1 (${countAfterPost} === ${initialCount + 1})`);

    // SCENARIO E: Verify GET with body does NOT create an additional interest
    console.log('\n--- SCENARIO E: Re-verify GET with body does NOT create any additional tag ---');
    const getWithBodyAgain = await makeRequest(server, {
      path: '/api/v1/admin/interests',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      name: 'TEST_Another_Fake_Tag_Via_Get',
      category: 'Gaming',
      icon: '🎮',
      isActive: true
    });

    assert(getWithBodyAgain.status === 200, 'GET returns HTTP 200 OK');
    const finalCount = await Interest.countDocuments({});
    assert(finalCount === countAfterPost, `DB count strictly preserved (${finalCount} === ${countAfterPost})`);

    const anotherFakeCheck = await Interest.findOne({ name: 'TEST_Another_Fake_Tag_Via_Get' });
    assert(anotherFakeCheck === null, 'Another fake tag from GET body was NOT created in MongoDB');

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
