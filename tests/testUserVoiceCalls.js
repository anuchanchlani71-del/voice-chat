const http = require('http');
const app = require('../src/app');
const { connectDB, disconnectDB } = require('../src/config/db');
const User = require('../src/models/User');
const Friendship = require('../src/models/Friendship');
const Block = require('../src/models/Block');
const VoiceCall = require('../src/models/VoiceCall');
const Notification = require('../src/models/Notification');
const { signToken } = require('../src/utils/tokenUtils');

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

async function runUserVoiceCallTests() {
  console.log('====================================================');
  console.log('🧪 Starting User 1-to-1 Voice Call Backend Test Suite');
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

  try {
    // 1. Setup DB Connection & Test Users
    console.log('--- TEST 1: Database Setup & Test User Creation ---');
    await connectDB();
    assert(true, 'MongoDB connected successfully');

    const ts = Date.now();
    await User.deleteMany({ username: { $regex: /^test_vcall_/ } });
    await VoiceCall.deleteMany({ id: { $regex: /^call_test_/ } });

    // User A: Active
    const userA = await User.create({
      id: `usr_vcall_a_${ts}`,
      username: `test_vcall_a_${ts}`,
      email: `test_vcall_a_${ts}@example.com`,
      fullName: 'Alice Call',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'active',
      isBlocked: false
    });

    // User B: Active (Friend of A)
    const userB = await User.create({
      id: `usr_vcall_b_${ts}`,
      username: `test_vcall_b_${ts}`,
      email: `test_vcall_b_${ts}@example.com`,
      fullName: 'Bob Call',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'active',
      isBlocked: false
    });

    // User C: Active (Stranger/non-friend of A)
    const userC = await User.create({
      id: `usr_vcall_c_${ts}`,
      username: `test_vcall_c_${ts}`,
      email: `test_vcall_c_${ts}@example.com`,
      fullName: 'Charlie Stranger',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'active',
      isBlocked: false
    });

    // User D: Blocked/Blocking User
    const userD = await User.create({
      id: `usr_vcall_d_${ts}`,
      username: `test_vcall_d_${ts}`,
      email: `test_vcall_d_${ts}@example.com`,
      fullName: 'David Blocked',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'active',
      isBlocked: false
    });

    // User E: Suspended User
    const userE = await User.create({
      id: `usr_vcall_e_${ts}`,
      username: `test_vcall_e_${ts}`,
      email: `test_vcall_e_${ts}@example.com`,
      fullName: 'Eve Suspended',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'suspended',
      isBlocked: true
    });

    // Establish mutual friendship between A and B
    const userPairKeyAB = Friendship.generateUserPairKey(userA._id, userB._id);
    await Friendship.create({
      id: `fr_vcall_ab_${ts}`,
      requester: userA._id,
      recipient: userB._id,
      userPairKey: userPairKeyAB,
      status: 'accepted'
    });

    // Establish mutual friendship between A and D, but block exists
    const userPairKeyAD = Friendship.generateUserPairKey(userA._id, userD._id);
    await Friendship.create({
      id: `fr_vcall_ad_${ts}`,
      requester: userA._id,
      recipient: userD._id,
      userPairKey: userPairKeyAD,
      status: 'accepted'
    });

    // User D blocks User A
    await Block.create({
      id: `blk_vcall_da_${ts}`,
      blockedBy: userD._id,
      blockedUser: userA._id
    });

    // Generate JWT Tokens
    const tokenA = signToken({ id: userA.id, email: userA.email });
    const tokenB = signToken({ id: userB.id, email: userB.email });
    const tokenC = signToken({ id: userC.id, email: userC.email });
    const tokenD = signToken({ id: userD.id, email: userD.email });
    const tokenE = signToken({ id: userE.id, email: userE.email });

    // Start HTTP Server
    const server = http.createServer(app.callback());
    await new Promise((res) => server.listen(0, res));

    try {
      // -------------------------------------------------------------
      // NEGATIVE TESTS: Initiation Failures
      // -------------------------------------------------------------
      console.log('\n--- TEST 2: Negative Initiation Tests ---');

      // Unauthenticated initiate call
      const resUnauth = await makeRequest(server, { path: '/api/v1/calls', method: 'POST' }, { receiverId: userB.id });
      assert(resUnauth.status === 401, 'Unauthenticated request rejected with 401');

      // Self-call
      const resSelf = await makeRequest(server, { path: '/api/v1/calls', method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } }, { receiverId: userA.id });
      assert(resSelf.status === 400 && resSelf.body.success === false, 'Self-call rejected with 400');

      // Non-friend call (A calling C)
      const resNonFriend = await makeRequest(server, { path: '/api/v1/calls', method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } }, { receiverId: userC.id });
      assert(resNonFriend.status === 403 && resNonFriend.body.success === false, 'Non-friend call rejected with 403');

      // Blocked call (A calling D)
      const resBlocked = await makeRequest(server, { path: '/api/v1/calls', method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } }, { receiverId: userD.id });
      assert(resBlocked.status === 403 && resBlocked.body.success === false, 'Blocked call rejected with 403');

      // Suspended account initiate call (E calling B)
      const resSuspended = await makeRequest(server, { path: '/api/v1/calls', method: 'POST', headers: { Authorization: `Bearer ${tokenE}` } }, { receiverId: userB.id });
      assert(resSuspended.status === 403 && resSuspended.body.success === false, 'Suspended caller rejected with 403');

      // -------------------------------------------------------------
      // POSITIVE TESTS: Call Initiation & Retrieval
      // -------------------------------------------------------------
      console.log('\n--- TEST 3: Call Initiation (A calls B) ---');

      const resInit = await makeRequest(server, { path: '/api/v1/calls', method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } }, { receiverId: userB.id });
      assert(resInit.status === 201 && resInit.body.success === true, 'Friend voice call initiated (201)');
      const createdCall = resInit.body.data;
      assert(createdCall && createdCall.id && createdCall.status === 'ringing', 'VoiceCall record created with ringing status');
      assert(createdCall.caller.id === userA.id && createdCall.receiver.id === userB.id, 'Sanitized caller and receiver present');

      // Check notification created for receiver
      const notifB = await Notification.findOne({ targetUser: userB._id, type: 'call_alert' });
      assert(!!notifB, 'Incoming call notification created for receiver');

      // -------------------------------------------------------------
      // POSITIVE TESTS: Call Details Access
      // -------------------------------------------------------------
      console.log('\n--- TEST 4: Get Call Details & Access Control ---');

      // Caller (User A) fetches call details
      const resGetA = await makeRequest(server, { path: `/api/v1/calls/${createdCall.id}`, method: 'GET', headers: { Authorization: `Bearer ${tokenA}` } });
      assert(resGetA.status === 200 && resGetA.body.data.id === createdCall.id, 'Caller can fetch call details');

      // Receiver (User B) fetches call details
      const resGetB = await makeRequest(server, { path: `/api/v1/calls/${createdCall.id}`, method: 'GET', headers: { Authorization: `Bearer ${tokenB}` } });
      assert(resGetB.status === 200 && resGetB.body.data.id === createdCall.id, 'Receiver can fetch call details');

      // Non-participant (User C) tries to fetch call details -> 403
      const resGetC = await makeRequest(server, { path: `/api/v1/calls/${createdCall.id}`, method: 'GET', headers: { Authorization: `Bearer ${tokenC}` } });
      assert(resGetC.status === 403 && resGetC.body.success === false, 'Non-participant denied call access (403)');

      // Invalid call ID -> 404
      const resInvalid = await makeRequest(server, { path: '/api/v1/calls/non_existent_id', method: 'GET', headers: { Authorization: `Bearer ${tokenA}` } });
      assert(resInvalid.status === 404 && resInvalid.body.success === false, 'Invalid call ID returns 404');

      // -------------------------------------------------------------
      // POSITIVE TESTS: Call History
      // -------------------------------------------------------------
      console.log('\n--- TEST 5: Get Call History ---');

      // Fetch history for Caller A
      const resHistA = await makeRequest(server, { path: '/api/v1/calls/history?page=1&limit=10', method: 'GET', headers: { Authorization: `Bearer ${tokenA}` } });
      assert(resHistA.status === 200 && resHistA.body.data.length >= 1, 'Caller A sees call in history');
      assert(resHistA.body.pagination && resHistA.body.pagination.totalItems >= 1, 'Pagination object returned in history');

      // Fetch history for Receiver B
      const resHistB = await makeRequest(server, { path: '/api/v1/calls/history?page=1&limit=10', method: 'GET', headers: { Authorization: `Bearer ${tokenB}` } });
      assert(resHistB.status === 200 && resHistB.body.data.length >= 1, 'Receiver B sees call in history');

      // Fetch history for User C (0 calls)
      const resHistC = await makeRequest(server, { path: '/api/v1/calls/history?page=1&limit=10', method: 'GET', headers: { Authorization: `Bearer ${tokenC}` } });
      assert(resHistC.status === 200 && resHistC.body.data.length === 0, 'User C has empty call history');

      // -------------------------------------------------------------
      // POSITIVE & NEGATIVE TESTS: Update Call Status
      // -------------------------------------------------------------
      console.log('\n--- TEST 6: Update Call Status & Duration Calculation ---');

      // Invalid status transition -> 400
      const resInvalidStatus = await makeRequest(server, { path: `/api/v1/calls/${createdCall.id}`, method: 'PATCH', headers: { Authorization: `Bearer ${tokenB}` } }, { status: 'invalid_status_name' });
      assert(resInvalidStatus.status === 400, 'Invalid call status rejected with 400');

      // Non-participant (User C) tries to update status -> 403
      const resUpdateC = await makeRequest(server, { path: `/api/v1/calls/${createdCall.id}`, method: 'PATCH', headers: { Authorization: `Bearer ${tokenC}` } }, { status: 'ongoing' });
      assert(resUpdateC.status === 403, 'Non-participant status update denied (403)');

      // Receiver (User B) accepts call -> status 'ongoing'
      const resOngoing = await makeRequest(server, { path: `/api/v1/calls/${createdCall.id}`, method: 'PATCH', headers: { Authorization: `Bearer ${tokenB}` } }, { status: 'ongoing' });
      assert(resOngoing.status === 200 && resOngoing.body.data.status === 'ongoing', 'Receiver answered call, status updated to ongoing');
      assert(!!resOngoing.body.data.connectedAt, 'connectedAt timestamp set on call answer');

      // Small delay to ensure duration > 0
      await new Promise((r) => setTimeout(r, 1100));

      // Caller (User A) completes call -> status 'completed', duration calculated
      const resComplete = await makeRequest(server, { path: `/api/v1/calls/${createdCall.id}`, method: 'PATCH', headers: { Authorization: `Bearer ${tokenA}` } }, { status: 'completed', endReason: 'user_ended' });
      assert(resComplete.status === 200 && resComplete.body.data.status === 'completed', 'Caller ended call, status updated to completed');
      assert(resComplete.body.data.endedAt && resComplete.body.data.endReason === 'user_ended', 'endedAt and endReason stored');
      assert(typeof resComplete.body.data.durationSeconds === 'number' && resComplete.body.data.durationSeconds >= 1, 'durationSeconds properly calculated');
      assert(typeof resComplete.body.data.durationFormatted === 'string', 'durationFormatted properly formatted');

      // Second Call: Initiate & Decline flow
      console.log('\n--- TEST 7: Initiate & Decline Flow ---');
      const resInit2 = await makeRequest(server, { path: '/api/v1/calls', method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } }, { receiverId: userB.id });
      const call2Id = resInit2.body.data.id;

      // Receiver B declines call
      const resDecline = await makeRequest(server, { path: `/api/v1/calls/${call2Id}`, method: 'PATCH', headers: { Authorization: `Bearer ${tokenB}` } }, { status: 'declined', endReason: 'declined' });
      assert(resDecline.status === 200 && resDecline.body.data.status === 'declined', 'Receiver declined call');
      assert(resDecline.body.data.endedAt, 'endedAt set on declined call');

    } finally {
      server.close();
    }

    // Cleanup
    await User.deleteMany({ username: { $regex: /^test_vcall_/ } });
    await VoiceCall.deleteMany({ id: { $regex: /^call_test_/ } });
    await Friendship.deleteMany({ id: { $regex: /^fr_vcall_/ } });
    await Block.deleteMany({ id: { $regex: /^blk_vcall_/ } });
    await Notification.deleteMany({ targetUser: { $in: [userA._id, userB._id, userC._id, userD._id, userE._id] } });

    await disconnectDB();

    console.log('\n====================================================');
    console.log(`📊 TEST RESULTS: ${passed} Passed, ${failed} Failed`);
    console.log('====================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Test suite crashed with error:', err);
    process.exit(1);
  }
}

runUserVoiceCallTests();
