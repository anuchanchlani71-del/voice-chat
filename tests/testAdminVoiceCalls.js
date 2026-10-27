const http = require('http');
const app = require('../src/app');
const config = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const { seedDefaultAdmin } = require('../src/seed/seedAdmin');
const User = require('../src/models/User');
const VoiceCall = require('../src/models/VoiceCall');

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
 * Main Test Runner for Admin Voice Calls APIs
 */
async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Admin Voice Calls APIs Backend Test Suite');
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
  assert(true, 'Connected to MongoDB for Voice Calls test suite');

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
  let tempCall1 = null;
  let tempCall2 = null;
  let tempCall3 = null;
  let tempCall4 = null;

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

    // 5. Unauthenticated GET /api/v1/admin/voice-calls -> Expect 401
    console.log('\n--- TEST 3: Unauthenticated Access Guard (401) ---');
    const unauthRes = await makeRequest(server, {
      path: '/api/v1/admin/voice-calls',
      method: 'GET'
    });
    assert(unauthRes.status === 401, 'GET /admin/voice-calls without token returns HTTP 401 Unauthorized');

    const unauthDetailRes = await makeRequest(server, {
      path: '/api/v1/admin/voice-calls/call_test_123',
      method: 'GET'
    });
    assert(unauthDetailRes.status === 401, 'GET /admin/voice-calls/:id without token returns HTTP 401 Unauthorized');

    // 6. Setup Temporary Test Users
    console.log('\n--- TEST 4: Setup Temporary Test Users & Call Records ---');
    tempUserA = new User({
      id: 'TEST_VC_USER_01',
      username: 'test_call_alex',
      fullName: 'Alex Murphy',
      interests: ['Tech', 'Voice'],
      accountStatus: 'active'
    });
    await tempUserA.save();

    tempUserB = new User({
      id: 'TEST_VC_USER_02',
      username: 'test_call_beth',
      fullName: 'Beth Harmon',
      interests: ['Chess', 'Podcasts'],
      accountStatus: 'active'
    });
    await tempUserB.save();

    tempUserC = new User({
      id: 'TEST_VC_USER_03',
      username: 'test_call_carl',
      fullName: 'Carl Sagan',
      interests: ['Cosmos', 'Science'],
      accountStatus: 'active'
    });
    await tempUserC.save();

    tempUserD = new User({
      id: 'TEST_VC_USER_04',
      username: 'test_call_diana',
      fullName: 'Diana Prince',
      interests: ['Art', 'History'],
      accountStatus: 'active'
    });
    await tempUserD.save();

    // Create Test Call 1: Alex -> Beth (Completed)
    tempCall1 = new VoiceCall({
      id: 'TEST_VC_CALL_01',
      caller: tempUserA._id,
      receiver: tempUserB._id,
      status: 'completed',
      durationSeconds: 1145,
      durationFormatted: '19m 05s',
      startedAt: '2026-09-23T10:00:00.000Z',
      connectedAt: '2026-09-23T10:00:05.000Z',
      endedAt: '2026-09-23T10:19:10.000Z',
      endReason: 'Normal Hangup by Caller',
      audioQuality: 'Excellent (Opus 48kbps, 0% packet loss)'
    });
    await tempCall1.save();

    // Create Test Call 2: Alex -> Carl (Missed)
    tempCall2 = new VoiceCall({
      id: 'TEST_VC_CALL_02',
      caller: tempUserA._id,
      receiver: tempUserC._id,
      status: 'missed',
      durationSeconds: 0,
      durationFormatted: '0m 00s',
      startedAt: '2026-09-23T11:00:00.000Z',
      endReason: 'Receiver Unanswered (Timeout 45s)',
      audioQuality: 'N/A'
    });
    await tempCall2.save();

    // Create Test Call 3: Beth -> Diana (Declined)
    tempCall3 = new VoiceCall({
      id: 'TEST_VC_CALL_03',
      caller: tempUserB._id,
      receiver: tempUserD._id,
      status: 'declined',
      durationSeconds: 0,
      durationFormatted: '0m 00s',
      startedAt: '2026-09-23T12:00:00.000Z',
      endReason: 'Declined by Receiver',
      audioQuality: 'N/A'
    });
    await tempCall3.save();

    // Create Test Call 4: Carl -> Alex (Failed)
    tempCall4 = new VoiceCall({
      id: 'TEST_VC_CALL_04',
      caller: tempUserC._id,
      receiver: tempUserA._id,
      status: 'failed',
      durationSeconds: 15,
      durationFormatted: '0m 15s',
      startedAt: '2026-09-23T13:00:00.000Z',
      endReason: 'Microphone Permission Denied / Mute Abort',
      audioQuality: 'Failed Handshake'
    });
    await tempCall4.save();

    assert(Boolean(tempCall1.id) && Boolean(tempCall2.id) && Boolean(tempCall3.id) && Boolean(tempCall4.id),
      'Temporary test voice call documents created in MongoDB');

    // 7. GET /api/v1/admin/voice-calls (Pagination & Tab Counts)
    console.log('\n--- TEST 5: GET /api/v1/admin/voice-calls (Pagination & Counts) ---');
    const listRes = await makeRequest(server, {
      path: '/api/v1/admin/voice-calls?page=1&limit=10',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(listRes.status === 200, 'GET /admin/voice-calls returns HTTP 200');
    assert(listRes.body.success === true, 'Response contains success: true');
    assert(Array.isArray(listRes.body.voiceCalls) && listRes.body.voiceCalls.length >= 4, 'Response returns voiceCalls array');
    assert(listRes.body.counts && listRes.body.counts.all >= 4, 'Counts object contains all >= 4');
    assert(listRes.body.counts.completed >= 1, 'Counts.completed >= 1');
    assert(listRes.body.counts.missed >= 1, 'Counts.missed >= 1');
    assert(listRes.body.counts.declined >= 1, 'Counts.declined >= 1');
    assert(listRes.body.counts.failed >= 1, 'Counts.failed >= 1');
    assert(listRes.body.pagination && listRes.body.pagination.totalItems >= 4, 'Pagination totalItems matches');

    // 8. Filter by status: completed
    console.log('\n--- TEST 6: Status Filter: completed ---');
    const completedRes = await makeRequest(server, {
      path: '/api/v1/admin/voice-calls?status=completed',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(completedRes.status === 200, 'Completed filter returns HTTP 200');
    assert(completedRes.body.voiceCalls.length >= 1, 'Found completed calls');
    assert(completedRes.body.voiceCalls.every(c => c.status === 'completed'), 'All returned calls have status === "completed"');

    // 9. Filter by status: missed
    console.log('\n--- TEST 7: Status Filter: missed ---');
    const missedRes = await makeRequest(server, {
      path: '/api/v1/admin/voice-calls?status=missed',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(missedRes.status === 200, 'Missed filter returns HTTP 200');
    assert(missedRes.body.voiceCalls.length >= 1, 'Found missed calls');
    assert(missedRes.body.voiceCalls.every(c => c.status === 'missed'), 'All returned calls have status === "missed"');

    // 10. Filter by status: declined
    console.log('\n--- TEST 8: Status Filter: declined ---');
    const declinedRes = await makeRequest(server, {
      path: '/api/v1/admin/voice-calls?status=declined',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(declinedRes.status === 200, 'Declined filter returns HTTP 200');
    assert(declinedRes.body.voiceCalls.every(c => c.status === 'declined'), 'All returned calls have status === "declined"');

    // 11. Filter by status: failed
    console.log('\n--- TEST 9: Status Filter: failed ---');
    const failedRes = await makeRequest(server, {
      path: '/api/v1/admin/voice-calls?status=failed',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(failedRes.status === 200, 'Failed filter returns HTTP 200');
    assert(failedRes.body.voiceCalls.every(c => c.status === 'failed'), 'All returned calls have status === "failed"');

    // 12. Search by caller/receiver username or name
    console.log('\n--- TEST 10: Search Filter (by User / Call ID) ---');
    const searchRes = await makeRequest(server, {
      path: '/api/v1/admin/voice-calls?search=beth',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(searchRes.status === 200, 'Search returns HTTP 200');
    assert(searchRes.body.voiceCalls.some(c =>
      (c.caller && c.caller.username === 'test_call_beth') ||
      (c.receiver && c.receiver.username === 'test_call_beth')
    ), 'Search finds calls involving "beth"');

    // 13. Detail lookup: GET /api/v1/admin/voice-calls/:id (Valid ID)
    console.log('\n--- TEST 11: GET /api/v1/admin/voice-calls/:id (Valid ID) ---');
    const detailRes = await makeRequest(server, {
      path: `/api/v1/admin/voice-calls/${tempCall1.id}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(detailRes.status === 200, 'GET /admin/voice-calls/:id returns HTTP 200');
    assert(detailRes.body.success === true, 'Detail response contains success: true');
    assert(detailRes.body.voiceCall.id === tempCall1.id, 'Call ID matches requested record');
    assert(detailRes.body.voiceCall.caller.username === 'test_call_alex', 'Caller profile populated accurately');
    assert(detailRes.body.voiceCall.receiver.username === 'test_call_beth', 'Receiver profile populated accurately');
    assert(detailRes.body.voiceCall.durationFormatted === '19m 05s', 'durationFormatted is populated accurately');
    assert(detailRes.body.voiceCall.audioQuality === 'Excellent (Opus 48kbps, 0% packet loss)', 'audioQuality is present');

    // 14. Detail lookup: GET /api/v1/admin/voice-calls/:id (Non-existent ID) -> 404
    console.log('\n--- TEST 12: GET /api/v1/admin/voice-calls/:id (Non-existent ID) ---');
    const notFoundRes = await makeRequest(server, {
      path: '/api/v1/admin/voice-calls/non_existent_call_99999',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(notFoundRes.status === 404, 'Non-existent call returns HTTP 404 Not Found');
    assert(notFoundRes.body.success === false, '404 response contains success: false');

    // 15. Credential Sanitization Audit
    console.log('\n--- TEST 13: Credential Sanitization Audit ---');
    const listRaw = JSON.stringify(listRes.body);
    const detailRaw = JSON.stringify(detailRes.body);

    assert(!listRaw.includes('passwordHash') && !listRaw.includes('salt') && !listRaw.includes('__v'),
      'List response contains zero passwordHash, salt, or __v fields');
    assert(!detailRaw.includes('passwordHash') && !detailRaw.includes('salt') && !detailRaw.includes('__v'),
      'Detail response contains zero passwordHash, salt, or __v fields');

    // 16. Regression Checks: Admin Auth, Users, Friendships, Interests, Friend Requests
    console.log('\n--- TEST 14: Regression Checks (All Prior Admin Modules) ---');
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

  } finally {
    // 17. Clean up temporary test data from MongoDB
    console.log('\n--- TEST 15: Clean up Temporary Test Data ---');
    const delCalls = await VoiceCall.deleteMany({ id: { $regex: /^TEST_VC_/ } });
    const delUsers = await User.deleteMany({ id: { $regex: /^TEST_VC_/ } });
    console.log(`[Cleanup] Removed ${delCalls.deletedCount} test call(s) and ${delUsers.deletedCount} test user(s) from MongoDB.`);

    const remainingCalls = await VoiceCall.countDocuments({ id: { $regex: /^TEST_VC_/ } });
    const remainingUsers = await User.countDocuments({ id: { $regex: /^TEST_VC_/ } });
    assert(remainingCalls === 0 && remainingUsers === 0, 'Zero temporary test calls or users remain in MongoDB');

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
