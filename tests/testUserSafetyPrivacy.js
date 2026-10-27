const http = require('http');
const assert = require('assert');
const app = require('../src/app');
const { connectDB, disconnectDB, getConnectionStatus } = require('../src/config/db');
const User = require('../src/models/User');
const Block = require('../src/models/Block');
const Report = require('../src/models/Report');
const Friendship = require('../src/models/Friendship');
const FriendRequest = require('../src/models/FriendRequest');

function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path: options.path,
      method: options.method || 'GET',
      agent: false,
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'close',
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
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body: resData });
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

async function runSafetyPrivacyTests() {
  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    steps: []
  };

  function record(name, pass, details = '') {
    results.total++;
    if (pass) {
      results.passed++;
      results.steps.push({ name, status: 'PASS', details });
      console.log(`  ✅ [PASS] ${name}`);
    } else {
      results.failed++;
      results.steps.push({ name, status: 'FAIL', details });
      console.error(`  ❌ [FAIL] ${name}: ${details}`);
    }
  }

  console.log('====================================================');
  console.log('🧪 Starting User Safety & Privacy Backend Test Suite');
  console.log('====================================================');

  const wasConnected = getConnectionStatus() === 'connected';
  if (!wasConnected) {
    await connectDB();
  }

  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));

  const uid = Math.floor(10000 + Math.random() * 90000);

  let tokenA = null;
  let userA = null;
  let tokenB = null;
  let userB = null;
  let tokenC = null;
  let userC = null;

  try {
    // 0. Setup: Register test users
    const regA = await makeRequest(server, { path: '/api/v1/auth/register', method: 'POST' }, {
      fullName: 'Safety Blocker A',
      username: `sft_a_${uid}`,
      email: `sft_a_${uid}@example.com`,
      password: 'Password123!'
    });
    tokenA = regA.body.token;
    userA = regA.body.user;

    const regB = await makeRequest(server, { path: '/api/v1/auth/register', method: 'POST' }, {
      fullName: 'Safety Target B',
      username: `sft_b_${uid}`,
      email: `sft_b_${uid}@example.com`,
      password: 'Password123!'
    });
    tokenB = regB.body.token;
    userB = regB.body.user;

    const regC = await makeRequest(server, { path: '/api/v1/auth/register', method: 'POST' }, {
      fullName: 'Safety User C',
      username: `sft_c_${uid}`,
      email: `sft_c_${uid}@example.com`,
      password: 'Password123!'
    });
    tokenC = regC.body.token;
    userC = regC.body.user;

    assert(tokenA && tokenB && tokenC, 'Test users registered');

    // 1. Self-block prevention check (User A blocks User A)
    const selfBlockRes = await makeRequest(
      server,
      { path: '/api/v1/users/block', method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } },
      { blockedUserId: userA.id }
    );
    record('1. Self-block is prevented with 400 Bad Request', selfBlockRes.status === 400, `status: ${selfBlockRes.status}`);

    // 2. Setup friendship between A and B, then block B
    const sendReqRes = await makeRequest(
      server,
      { path: '/api/v1/friends/requests', method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } },
      { recipientId: userB.id }
    );
    const requestId = sendReqRes.body.request.id;

    const acceptRes = await makeRequest(
      server,
      { path: `/api/v1/friends/requests/${requestId}/accept`, method: 'PATCH', headers: { Authorization: `Bearer ${tokenB}` } }
    );
    record('2. Setup friendship A & B before block', acceptRes.status === 200, `status: ${acceptRes.status}`);

    // 3. User A blocks User B
    const blockRes = await makeRequest(
      server,
      { path: '/api/v1/users/block', method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } },
      { blockedUserId: userB.id, reason: 'Spam and inappropriate behavior' }
    );
    record('3. POST /api/v1/users/block succeeds with 200 OK', blockRes.status === 200 && blockRes.body.success === true, `status: ${blockRes.status}`);

    // 4. Verify friendship & requests between A and B were removed upon block
    const getFriendsARes = await makeRequest(
      server,
      { path: '/api/v1/friends', method: 'GET', headers: { Authorization: `Bearer ${tokenA}` } }
    );
    const hasFriendB = getFriendsARes.body?.friends?.some(f => f.id === userB.id);
    record('4. Block automatically removes active friendship from friends list', !hasFriendB, `friend B present: ${hasFriendB}`);

    // 5. Duplicate block prevention check
    const dupBlockRes = await makeRequest(
      server,
      { path: '/api/v1/users/block', method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } },
      { blockedUserId: userB.id }
    );
    record('5. Duplicate active block returns 400 Bad Request', dupBlockRes.status === 400, `status: ${dupBlockRes.status}`);

    // 6. Discover filtering check: Blocked user B must NOT appear in A's Discover, and A must NOT appear in B's Discover
    const discARes = await makeRequest(
      server,
      { path: '/api/v1/users/discover', method: 'GET', headers: { Authorization: `Bearer ${tokenA}` } }
    );
    const hasBInADiscover = discARes.body?.users?.some(u => u.id === userB.id);

    const discBRes = await makeRequest(
      server,
      { path: '/api/v1/users/discover', method: 'GET', headers: { Authorization: `Bearer ${tokenB}` } }
    );
    const hasAInBDiscover = discBRes.body?.users?.some(u => u.id === userA.id);

    record(
      '6. Blocked user is excluded from Discover list for both blocker and blockee',
      !hasBInADiscover && !hasAInBDiscover,
      `B in A's discover: ${hasBInADiscover}, A in B's discover: ${hasAInBDiscover}`
    );

    // 7. Friend Request prevention check when blocked
    const blockFriendReqRes = await makeRequest(
      server,
      { path: '/api/v1/friends/requests', method: 'POST', headers: { Authorization: `Bearer ${tokenB}` } },
      { recipientId: userA.id }
    );
    record('7. Friend request to/from blocked user is prevented (400)', blockFriendReqRes.status === 400, `status: ${blockFriendReqRes.status}`);

    // 8. GET /api/v1/users/blocked returns list of active blocked users
    const getBlockedRes = await makeRequest(
      server,
      { path: '/api/v1/users/blocked', method: 'GET', headers: { Authorization: `Bearer ${tokenA}` } }
    );
    const blockedItem = getBlockedRes.body?.blockedUsers?.find(u => u.id === userB.id);
    record(
      '8. GET /api/v1/users/blocked returns active blocked user list',
      getBlockedRes.status === 200 && Boolean(blockedItem),
      `count: ${getBlockedRes.body?.count}`
    );

    // 9. Unblock user B
    const unblockRes = await makeRequest(
      server,
      { path: '/api/v1/users/unblock', method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } },
      { blockedUserId: userB.id }
    );
    record('9. POST /api/v1/users/unblock succeeds with 200 OK', unblockRes.status === 200 && unblockRes.body.success === true, `status: ${unblockRes.status}`);

    // 10. Verify unblocked user B reappears in Discover
    const discPostUnblockRes = await makeRequest(
      server,
      { path: '/api/v1/users/discover', method: 'GET', headers: { Authorization: `Bearer ${tokenA}` } }
    );
    const hasBPostUnblock = discPostUnblockRes.body?.users?.some(u => u.id === userB.id);
    record('10. Unblocked user reappears in Discover list', hasBPostUnblock === true, `found B: ${hasBPostUnblock}`);

    // 11. Self-report prevention check
    const selfReportRes = await makeRequest(
      server,
      { path: '/api/v1/users/report', method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } },
      { reportedUserId: userA.id, reasonCategory: 'Harassment or Bullying' }
    );
    record('11. Self-report is prevented with 400 Bad Request', selfReportRes.status === 400, `status: ${selfReportRes.status}`);

    // 12. Report user C
    const reportRes = await makeRequest(
      server,
      { path: '/api/v1/users/report', method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } },
      {
        reportedUserId: userC.id,
        reasonCategory: 'Harassment or Bullying',
        description: 'Sent inappropriate messages in voice room.'
      }
    );
    record(
      '12. POST /api/v1/users/report succeeds with 201 Created',
      reportRes.status === 201 && reportRes.body.success === true && Boolean(reportRes.body.report),
      `status: ${reportRes.status}`
    );

    // 13. Verify reportsCount on User C incremented in DB
    const userCDoc = await User.findUserByIdOrIdentifier(userC.id);
    record('13. Reported user reportsCount incremented to >= 1', userCDoc && userCDoc.reportsCount >= 1, `reportsCount: ${userCDoc?.reportsCount}`);

  } catch (err) {
    console.error('Test execution error:', err);
    record('Suite execution without crash', false, err.message);
  } finally {
    // Cleanup test data
    try {
      await User.deleteMany({ username: { $regex: /^sft_/ } });
      await Block.deleteMany({ date: { $regex: /^2026/ } });
      await Report.deleteMany({ description: /voice room/ });
    } catch (cleanErr) {
      // ignore
    }

    await new Promise((resolve) => server.close(resolve));
    if (!wasConnected) {
      await disconnectDB();
    }
  }

  console.log('====================================================');
  console.log(`📊 Test Results: ${results.passed}/${results.total} Passed (${results.failed} Failed)`);
  console.log('====================================================');

  if (results.failed > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runSafetyPrivacyTests();
}

module.exports = runSafetyPrivacyTests;
