const http = require('http');
const app = require('../src/app');
const config = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const { seedDefaultAdmin } = require('../src/seed/seedAdmin');
const User = require('../src/models/User');
const Friendship = require('../models/Friendship');
const FriendRequest = require('../models/FriendRequest');
const VoiceCall = require('../models/VoiceCall');
const Report = require('../models/Report');
const Block = require('../models/Block');
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
 * Main Test Runner for Admin Dashboard APIs
 */
async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Admin Dashboard APIs Backend Test Suite');
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
  assert(true, 'Connected to MongoDB for Dashboard test suite');

  // 2. Ensure Super Admin is seeded
  await seedDefaultAdmin();

  // 3. Start HTTP server on temporary port
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));
  const testPort = server.address().port;
  console.log(`[Test Server] Running on temporary port ${testPort}\n`);

  const createdUserIds = [];
  const createdFriendshipIds = [];
  const createdFriendReqIds = [];
  const createdVoiceCallIds = [];
  const createdReportIds = [];
  const createdBlockIds = [];
  const createdInterestIds = [];

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

    // 5. Unauthorized request guards -> 401
    console.log('\n--- TEST 3: Unauthenticated Request Guards (401) ---');
    const unauthStats = await makeRequest(server, {
      path: '/api/v1/admin/dashboard/stats',
      method: 'GET'
    });
    assert(unauthStats.status === 401, 'GET /admin/dashboard/stats without token returns HTTP 401');

    const unauthCharts = await makeRequest(server, {
      path: '/api/v1/admin/dashboard/charts',
      method: 'GET'
    });
    assert(unauthCharts.status === 401, 'GET /admin/dashboard/charts without token returns HTTP 401');

    // 6. Setup Temporary Test Data Across Models
    console.log('\n--- TEST 4: Setup Temporary Test Data ---');
    const user1 = new User({
      id: 'TEST_DSH_USER_01',
      username: 'test_dsh_arjun',
      fullName: 'Arjun Kapoor',
      isOnline: true,
      accountStatus: 'active'
    });
    await user1.save();
    createdUserIds.push(user1.id);

    const user2 = new User({
      id: 'TEST_DSH_USER_02',
      username: 'test_dsh_neha',
      fullName: 'Neha Sharma',
      isOnline: false,
      accountStatus: 'active'
    });
    await user2.save();
    createdUserIds.push(user2.id);

    const user3 = new User({
      id: 'TEST_DSH_USER_03',
      username: 'test_dsh_rohit',
      fullName: 'Rohit Verma',
      isOnline: true,
      accountStatus: 'suspended'
    });
    await user3.save();
    createdUserIds.push(user3.id);

    // Friendships
    const friendship1 = new Friendship({
      id: 'TEST_DSH_FR_01',
      requester: user1._id,
      recipient: user2._id,
      status: 'accepted'
    });
    await friendship1.save();
    createdFriendshipIds.push(friendship1.id);

    // Friend Request
    const friendReq1 = new FriendRequest({
      id: 'TEST_DSH_FREQ_01',
      requester: user1._id,
      recipient: user3._id,
      status: 'pending'
    });
    await friendReq1.save();
    createdFriendReqIds.push(friendReq1.id);

    // Voice Calls (Today)
    const callDateToday1 = new Date();
    callDateToday1.setHours(14, 30, 0, 0); // 14:00 bucket

    const call1 = new VoiceCall({
      id: 'TEST_DSH_CALL_01',
      caller: user1._id,
      receiver: user2._id,
      status: 'completed',
      durationSeconds: 300, // 5 mins
      createdAt: callDateToday1
    });
    await call1.save();
    createdVoiceCallIds.push(call1.id);

    const callDateToday2 = new Date();
    callDateToday2.setHours(21, 15, 0, 0); // 21:00 bucket

    const call2 = new VoiceCall({
      id: 'TEST_DSH_CALL_02',
      caller: user2._id,
      receiver: user3._id,
      status: 'completed',
      durationSeconds: 900, // 15 mins
      createdAt: callDateToday2
    });
    await call2.save();
    createdVoiceCallIds.push(call2.id);

    const callDateToday3 = new Date();
    callDateToday3.setHours(21, 45, 0, 0); // 21:00 bucket (making 21:00 peak)

    const call3 = new VoiceCall({
      id: 'TEST_DSH_CALL_03',
      caller: user1._id,
      receiver: user3._id,
      status: 'completed',
      durationSeconds: 600, // 10 mins
      createdAt: callDateToday3
    });
    await call3.save();
    createdVoiceCallIds.push(call3.id);

    // Reports
    const rep1 = new Report({
      id: 'TEST_DSH_REP_01',
      reporter: user1._id,
      reportedUser: user3._id,
      reasonCategory: 'Spam',
      status: 'pending'
    });
    await rep1.save();
    createdReportIds.push(rep1.id);

    // Blocks
    const blk1 = new Block({
      id: 'TEST_DSH_BLK_01',
      blockedUser: user3._id,
      blockedBy: user1._id,
      status: 'active'
    });
    await blk1.save();
    createdBlockIds.push(blk1.id);

    // Interests
    const int1 = new Interest({
      id: 'TEST_DSH_INT_01',
      name: 'Test Dashboard Indie Rock',
      category: 'Music',
      icon: '🎸'
    });
    await int1.save();
    createdInterestIds.push(int1.id);

    assert(createdUserIds.length === 3 && createdVoiceCallIds.length === 3,
      'Test dataset seeded across Users, Friendships, FriendRequests, VoiceCalls, Reports, Blocks, Interests');

    // 7. GET /api/v1/admin/dashboard/stats
    console.log('\n--- TEST 5: GET /api/v1/admin/dashboard/stats ---');
    const statsRes = await makeRequest(server, {
      path: '/api/v1/admin/dashboard/stats',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    assert(statsRes.status === 200, 'GET /admin/dashboard/stats returns HTTP 200');
    assert(statsRes.body.success === true, 'Response contains success: true');
    assert(Boolean(statsRes.body.stats), 'Response contains stats object');

    const stats = statsRes.body.stats;
    assert(typeof stats.totalUsers === 'number' && stats.totalUsers >= 3, `totalUsers is number (>= 3): ${stats.totalUsers}`);
    assert(typeof stats.onlineUsers === 'number' && stats.onlineUsers >= 2, `onlineUsers is number (>= 2): ${stats.onlineUsers}`);
    assert(typeof stats.activeFriendships === 'number' && stats.activeFriendships >= 1, `activeFriendships is number (>= 1): ${stats.activeFriendships}`);
    assert(typeof stats.pendingFriendRequests === 'number' && stats.pendingFriendRequests >= 1, `pendingFriendRequests is number (>= 1): ${stats.pendingFriendRequests}`);
    assert(typeof stats.voiceCallsToday === 'number' && stats.voiceCallsToday >= 3, `voiceCallsToday is number (>= 3): ${stats.voiceCallsToday}`);
    assert(typeof stats.voiceMinutesToday === 'number' && stats.voiceMinutesToday >= 30, `voiceMinutesToday is number (>= 30 mins): ${stats.voiceMinutesToday}`);
    assert(typeof stats.averageCallDuration === 'string' && stats.averageCallDuration.includes('m') && stats.averageCallDuration.includes('s'),
      `averageCallDuration is formatted string: "${stats.averageCallDuration}"`);
    assert(typeof stats.totalReports === 'number' && stats.totalReports >= 1, `totalReports is number (>= 1): ${stats.totalReports}`);
    assert(typeof stats.pendingReports === 'number' && stats.pendingReports >= 1, `pendingReports is number (>= 1): ${stats.pendingReports}`);
    assert(typeof stats.blockedUsers === 'number' && stats.blockedUsers >= 1, `blockedUsers is number (>= 1): ${stats.blockedUsers}`);
    assert(typeof stats.totalInterests === 'number' && stats.totalInterests >= 1, `totalInterests is number (>= 1): ${stats.totalInterests}`);

    // 8. GET /api/v1/admin/dashboard/charts
    console.log('\n--- TEST 6: GET /api/v1/admin/dashboard/charts ---');
    const chartsRes = await makeRequest(server, {
      path: '/api/v1/admin/dashboard/charts',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    assert(chartsRes.status === 200, 'GET /admin/dashboard/charts returns HTTP 200');
    assert(chartsRes.body.success === true, 'Response contains success: true');
    assert(Boolean(chartsRes.body.chart), 'Response contains chart object');

    const chart = chartsRes.body.chart;
    assert(Array.isArray(chart.callVolume), 'chart.callVolume is an array');
    assert(chart.callVolume.length === 24, `chart.callVolume contains exactly 24 hourly buckets (got ${chart.callVolume.length})`);
    assert(chart.callVolume[0].hour === '00:00' && chart.callVolume[23].hour === '23:00',
      'First bucket is "00:00" and 24th bucket is "23:00"');

    // Bucket verification
    const bucket14 = chart.callVolume.find((b) => b.hour === '14:00');
    const bucket21 = chart.callVolume.find((b) => b.hour === '21:00');
    assert(bucket14 && bucket14.calls >= 1, `Bucket 14:00 has >= 1 call (got ${bucket14 ? bucket14.calls : 'missing'})`);
    assert(bucket21 && bucket21.calls >= 2, `Bucket 21:00 has >= 2 calls (got ${bucket21 ? bucket21.calls : 'missing'})`);

    assert(typeof chart.peakHour === 'string' && chart.peakHour.match(/^\d{2}:00$/), `peakHour is formatted string (e.g. "${chart.peakHour}")`);
    assert(typeof chart.totalVoiceMinutes === 'number' && chart.totalVoiceMinutes >= 30, `totalVoiceMinutes is number (>= 30 mins): ${chart.totalVoiceMinutes}`);

    // 9. Credential Sanitization Audit
    console.log('\n--- TEST 7: Credential Sanitization Audit ---');
    const rawStats = JSON.stringify(statsRes.body);
    const rawCharts = JSON.stringify(chartsRes.body);
    assert(!rawStats.includes('passwordHash') && !rawStats.includes('salt') && !rawStats.includes('__v'),
      'Stats payload contains zero credentials or mongoose internal fields');
    assert(!rawCharts.includes('passwordHash') && !rawCharts.includes('salt') && !rawCharts.includes('__v'),
      'Charts payload contains zero credentials or mongoose internal fields');

    // 10. Regression Checks across all 10 Admin modules
    console.log('\n--- TEST 8: Full Regression Suite (All Admin Modules) ---');
    const meRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/me',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(meRes.status === 200, 'GET /admin/auth/me operates normally');

    const usersRes = await makeRequest(server, {
      path: '/api/v1/admin/users',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(usersRes.status === 200, 'GET /admin/users operates normally');

    const friendshipsRes = await makeRequest(server, {
      path: '/api/v1/admin/friendships',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(friendshipsRes.status === 200, 'GET /admin/friendships operates normally');

    const interestsRes = await makeRequest(server, {
      path: '/api/v1/admin/interests',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(interestsRes.status === 200, 'GET /admin/interests operates normally');

    const friendReqsRes = await makeRequest(server, {
      path: '/api/v1/admin/friend-requests',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(friendReqsRes.status === 200, 'GET /admin/friend-requests operates normally');

    const voiceCallsRes = await makeRequest(server, {
      path: '/api/v1/admin/voice-calls',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(voiceCallsRes.status === 200, 'GET /admin/voice-calls operates normally');

    const reportsRes = await makeRequest(server, {
      path: '/api/v1/admin/reports',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(reportsRes.status === 200, 'GET /admin/reports operates normally');

    const blockedRes = await makeRequest(server, {
      path: '/api/v1/admin/blocked-users',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(blockedRes.status === 200, 'GET /admin/blocked-users operates normally');

    const notifsRes = await makeRequest(server, {
      path: '/api/v1/admin/notifications',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(notifsRes.status === 200, 'GET /admin/notifications operates normally');

    const safetyOverviewRes = await makeRequest(server, {
      path: '/api/v1/admin/safety/overview',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(safetyOverviewRes.status === 200, 'GET /admin/safety/overview operates normally');

  } finally {
    // 11. Cleanup temporary test data from MongoDB
    console.log('\n--- TEST 9: Clean up Temporary Test Data ---');
    const delCalls = await VoiceCall.deleteMany({ id: { $regex: /^TEST_DSH_/ } });
    const delReqs = await FriendRequest.deleteMany({ id: { $regex: /^TEST_DSH_/ } });
    const delFrs = await Friendship.deleteMany({ id: { $regex: /^TEST_DSH_/ } });
    const delReps = await Report.deleteMany({ id: { $regex: /^TEST_DSH_/ } });
    const delBlks = await Block.deleteMany({ id: { $regex: /^TEST_DSH_/ } });
    const delInts = await Interest.deleteMany({ id: { $regex: /^TEST_DSH_/ } });
    const delUsers = await User.deleteMany({ id: { $regex: /^TEST_DSH_/ } });

    console.log(`[Cleanup] Removed ${delCalls.deletedCount} call(s), ${delReqs.deletedCount} req(s), ${delFrs.deletedCount} friendship(s), ${delReps.deletedCount} report(s), ${delBlks.deletedCount} block(s), ${delInts.deletedCount} interest(s), and ${delUsers.deletedCount} user(s).`);

    const remCalls = await VoiceCall.countDocuments({ id: { $regex: /^TEST_DSH_/ } });
    const remUsers = await User.countDocuments({ id: { $regex: /^TEST_DSH_/ } });
    assert(remCalls === 0 && remUsers === 0, 'Zero temporary test records remain in MongoDB');

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
