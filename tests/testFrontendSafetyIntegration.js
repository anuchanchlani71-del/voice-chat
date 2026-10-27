const http = require('http');
const assert = require('assert');
const app = require('../src/app');
const { connectDB, disconnectDB, getConnectionStatus } = require('../src/config/db');
const User = require('../src/models/User');
const Block = require('../src/models/Block');
const Report = require('../src/models/Report');

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

async function runFrontendSafetyIntegrationTest() {
  console.log('====================================================');
  console.log('🧪 Starting Frontend Safety Integration Test');
  console.log('====================================================');

  const wasConnected = getConnectionStatus() === 'connected';
  if (!wasConnected) {
    await connectDB();
  }

  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));

  const uid = Math.floor(10000 + Math.random() * 90000);

  try {
    // Register User A and User B
    const regA = await makeRequest(server, { path: '/api/v1/auth/register', method: 'POST' }, {
      fullName: 'Account A',
      username: `account_a_${uid}`,
      email: `account_a_${uid}@example.com`,
      password: 'Password123!'
    });
    const tokenA = regA.body.token;
    const userA = regA.body.user;

    const regB = await makeRequest(server, { path: '/api/v1/auth/register', method: 'POST' }, {
      fullName: 'Account B',
      username: `account_b_${uid}`,
      email: `account_b_${uid}@example.com`,
      password: 'Password123!'
    });
    const tokenB = regB.body.token;
    const userB = regB.body.user;

    assert(tokenA && tokenB, 'Users registered');

    // 1. Initial discover: User B visible in A's discover
    const discInitial = await makeRequest(
      server,
      { path: '/api/v1/users/discover', method: 'GET', headers: { Authorization: `Bearer ${tokenA}` } }
    );
    const bInDiscoverBefore = discInitial.body?.users?.some(u => u.id === userB.id);
    assert(bInDiscoverBefore, 'User B is initially visible in Discover');
    console.log('  ✅ [PASS] 1. Account B is visible in Account A Discover lounge');

    // 2. Account A blocks Account B via POST /api/v1/users/block
    const blockRes = await makeRequest(
      server,
      { path: '/api/v1/users/block', method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } },
      { blockedUserId: userB.id, reason: 'Testing frontend safety flow' }
    );
    assert(blockRes.status === 200 && blockRes.body.success === true, 'Block endpoint returns 200');
    console.log('  ✅ [PASS] 2. Account A blocks Account B successfully (POST /users/block)');

    // 3. Verify Account B is excluded from Discover
    const discPostBlock = await makeRequest(
      server,
      { path: '/api/v1/users/discover', method: 'GET', headers: { Authorization: `Bearer ${tokenA}` } }
    );
    const bInDiscoverAfter = discPostBlock.body?.users?.some(u => u.id === userB.id);
    assert(!bInDiscoverAfter, 'Account B is excluded from Discover after block');
    console.log('  ✅ [PASS] 3. Account B immediately disappears from Discover lounge');

    // 4. GET /api/v1/users/blocked returns Account B in blocked list
    const getBlockedRes = await makeRequest(
      server,
      { path: '/api/v1/users/blocked', method: 'GET', headers: { Authorization: `Bearer ${tokenA}` } }
    );
    const foundBlockedB = getBlockedRes.body?.blockedUsers?.some(u => u.id === userB.id);
    assert(foundBlockedB, 'Account B is in blocked users list');
    console.log('  ✅ [PASS] 4. GET /users/blocked returns Account B in real blocked users list');

    // 5. Account A reports Account B via POST /api/v1/users/report
    const reportRes = await makeRequest(
      server,
      { path: '/api/v1/users/report', method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } },
      { reportedUserId: userB.id, reasonCategory: 'Harassment or Bullying', description: 'Testing report flow' }
    );
    assert(reportRes.status === 201 && reportRes.body.success === true, 'Report endpoint returns 201');
    console.log('  ✅ [PASS] 5. Account A reports Account B successfully (POST /users/report)');

    // 6. Account A unblocks Account B via POST /api/v1/users/unblock
    const unblockRes = await makeRequest(
      server,
      { path: '/api/v1/users/unblock', method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } },
      { blockedUserId: userB.id }
    );
    assert(unblockRes.status === 200 && unblockRes.body.success === true, 'Unblock endpoint returns 200');
    console.log('  ✅ [PASS] 6. Account A unblocks Account B successfully (POST /users/unblock)');

    // 7. Verify Account B reappears in Discover
    const discPostUnblock = await makeRequest(
      server,
      { path: '/api/v1/users/discover', method: 'GET', headers: { Authorization: `Bearer ${tokenA}` } }
    );
    const bInDiscoverFinal = discPostUnblock.body?.users?.some(u => u.id === userB.id);
    assert(bInDiscoverFinal, 'Account B reappears in Discover after unblock');
    console.log('  ✅ [PASS] 7. Account B reappears in Discover lounge after unblock');

    console.log('====================================================');
    console.log('📊 Integration Test Summary: 7/7 Passed');
    console.log('====================================================');

    // Cleanup
    await User.deleteMany({ username: { $regex: /^account_[ab]_/ } });
    await Block.deleteMany({ reason: 'Testing frontend safety flow' });
    await Report.deleteMany({ description: 'Testing report flow' });

  } catch (err) {
    console.error('Integration test failure:', err);
    process.exitCode = 1;
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (!wasConnected) {
      await disconnectDB();
    }
  }
}

if (require.main === module) {
  runFrontendSafetyIntegrationTest();
}
