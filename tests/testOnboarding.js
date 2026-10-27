const http = require('http');
const assert = require('assert');
const app = require('../src/app');
const config = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const User = require('../src/models/User');

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

async function runOnboardingTests() {
  console.log('🧪 Starting Onboarding API & Auth Flow Tests');
  const checks = [];

  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));

  const uniqueId = Date.now();
  const testUser = {
    fullName: 'Test Onboarding User',
    username: `onboard_${uniqueId}`,
    email: `onboard_${uniqueId}@example.com`,
    password: 'password123'
  };

  try {
    // 1. Register new user
    const regRes = await makeRequest(server, {
      path: '/api/v1/auth/register',
      method: 'POST'
    }, testUser);

    assert.strictEqual(regRes.status, 201, 'Registration should return 201');
    assert(regRes.body.token, 'Should return JWT token');
    assert.strictEqual(regRes.body.user.isOnboarded, false, 'New user isOnboarded should be false');
    checks.push('1. Register new user: user.isOnboarded === false (PASS)');

    const token = regRes.body.token;

    // 2. Test unauthenticated PATCH /api/v1/users/me/onboarding
    const unauthRes = await makeRequest(server, {
      path: '/api/v1/users/me/onboarding',
      method: 'PATCH'
    }, { interests: ['Gaming', 'Lo-Fi Chill Beats'] });

    assert.strictEqual(unauthRes.status, 401, 'Unauthenticated request should return 401');
    checks.push('2. Unauthenticated PATCH /api/v1/users/me/onboarding returns 401 (PASS)');

    // 3. Test invalid interests payload (empty array)
    const invalidRes = await makeRequest(server, {
      path: '/api/v1/users/me/onboarding',
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` }
    }, { interests: [] });

    assert.strictEqual(invalidRes.status, 400, 'Empty interests should return 400');
    checks.push('3. Empty interests array returns 400 validation error (PASS)');

    // 4. Test successful PATCH /api/v1/users/me/onboarding
    const onboardRes = await makeRequest(server, {
      path: '/api/v1/users/me/onboarding',
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` }
    }, { interests: ['Gaming & Esports', 'Lo-Fi Chill Beats', 'Deep Night Talks'] });

    assert.strictEqual(onboardRes.status, 200, 'Valid onboarding should return 200');
    assert.strictEqual(onboardRes.body.user.isOnboarded, true, 'User isOnboarded should be true');
    assert.deepStrictEqual(onboardRes.body.user.interests, ['Gaming & Esports', 'Lo-Fi Chill Beats', 'Deep Night Talks']);
    checks.push('4. PATCH /api/v1/users/me/onboarding updates interests & sets isOnboarded = true (PASS)');

    // 5. Test GET /api/v1/auth/me returns isOnboarded: true
    const meRes = await makeRequest(server, {
      path: '/api/v1/auth/me',
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });

    assert.strictEqual(meRes.status, 200, 'GET /auth/me should return 200');
    assert.strictEqual(meRes.body.user.isOnboarded, true, 'GET /auth/me must return isOnboarded = true');
    checks.push('5. GET /api/v1/auth/me returns isOnboarded === true (PASS)');

    // 6. Test POST /api/v1/auth/login returns isOnboarded: true
    const loginRes = await makeRequest(server, {
      path: '/api/v1/auth/login',
      method: 'POST'
    }, {
      identifier: testUser.username,
      password: testUser.password
    });

    assert.strictEqual(loginRes.status, 200, 'Login should return 200');
    assert.strictEqual(loginRes.body.user.isOnboarded, true, 'Login must return isOnboarded = true');
    checks.push('6. POST /api/v1/auth/login returns isOnboarded === true for returning user (PASS)');

    // 7. Verify directly in MongoDB User model
    const dbUser = await User.findOne({ username: testUser.username });
    assert(dbUser, 'User must exist in MongoDB');
    assert.strictEqual(dbUser.isOnboarded, true, 'MongoDB document isOnboarded must be true');
    assert.strictEqual(dbUser.interests.length, 3, 'MongoDB interests must have 3 items');
    checks.push(`7. Direct MongoDB doc verified: username="${dbUser.username}", isOnboarded=${dbUser.isOnboarded}, interests=[${dbUser.interests.join(', ')}] (PASS)`);

    // 8. Admin login regression check
    const adminLoginRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/login',
      method: 'POST'
    }, {
      identifier: 'admin',
      password: 'admin'
    });
    assert(adminLoginRes.status === 200 || adminLoginRes.status === 401, 'Admin auth endpoint should respond normally');
    checks.push(`8. Admin auth login regression check: HTTP ${adminLoginRes.status} (PASS)`);

    // Cleanup test user
    await User.deleteOne({ username: testUser.username });

    return {
      status: 'ALL_PASSED',
      testsCount: checks.length,
      checks
    };
  } finally {
    server.close();
  }
}

if (require.main === module) {
  connectDB().then(() => runOnboardingTests())
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Test failed:', err);
      process.exit(1);
    });
}

module.exports = { runOnboardingTests };
