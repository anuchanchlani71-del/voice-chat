const http = require('http');
const app = require('../src/app');
const config = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const { seedDefaultAdmin } = require('../src/seed/seedAdmin');
const User = require('../src/models/User');
const { signToken } = require('../src/utils/tokenUtils');
const { hashPassword } = require('../src/utils/passwordUtils');

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
 * Main User Auth Test Runner
 */
async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting User Authentication Integration Tests');
  console.log(`🗄️  Target MongoDB: ${config.mongoUri}`);
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

  // Ensure DB connected and Admin seeded
  await connectDB();
  await seedDefaultAdmin();

  // Create ephemeral HTTP test server
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));

  const testUserTimestamp = Date.now();
  const testUserData = {
    fullName: 'Test User Alpha',
    username: `testuser_${testUserTimestamp}`,
    email: `testuser_${testUserTimestamp}@example.com`,
    password: 'SecurePassword123!'
  };

  let registeredUserId = null;
  let registeredToken = null;
  let suspendedUserId = null;
  let blockedUserId = null;

  try {
    // ─────────────────────────────────────────────────────────────
    // 1. REGISTRATION TESTS (POST /api/v1/auth/register)
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 1. Testing User Registration ---');

    // 1.1 Valid registration
    const regRes = await makeRequest(server, {
      path: '/api/v1/auth/register',
      method: 'POST'
    }, testUserData);

    assert(regRes.status === 201, `Valid registration returns 201 Created (got ${regRes.status})`);
    assert(regRes.body.success === true, 'Response contains success: true');
    assert(typeof regRes.body.token === 'string' && regRes.body.token.length > 20, 'Response contains valid JWT token');
    assert(regRes.body.user && regRes.body.user.username === testUserData.username, 'Response user.username matches');
    assert(regRes.body.user.email === testUserData.email, 'Response user.email matches');
    assert(regRes.body.user.passwordHash === undefined, 'SECURITY: user.passwordHash is NOT exposed');
    assert(regRes.body.user.salt === undefined, 'SECURITY: user.salt is NOT exposed');

    registeredUserId = regRes.body.user?.id;
    registeredToken = regRes.body.token;

    // 1.2 Missing required fields (e.g. missing password)
    const missingFieldRes = await makeRequest(server, {
      path: '/api/v1/auth/register',
      method: 'POST'
    }, {
      fullName: 'No Password User',
      username: `nopass_${testUserTimestamp}`,
      email: `nopass_${testUserTimestamp}@example.com`
    });
    assert(missingFieldRes.status === 400, `Missing password returns 400 (got ${missingFieldRes.status})`);

    // 1.3 Invalid username (contains special characters / spaces)
    const invalidUsernameRes = await makeRequest(server, {
      path: '/api/v1/auth/register',
      method: 'POST'
    }, {
      fullName: 'Invalid User',
      username: 'user with spaces!',
      email: `invalid_${testUserTimestamp}@example.com`,
      password: 'password123'
    });
    assert(invalidUsernameRes.status === 400, `Invalid username format returns 400 (got ${invalidUsernameRes.status})`);

    // 1.4 Invalid email format
    const invalidEmailRes = await makeRequest(server, {
      path: '/api/v1/auth/register',
      method: 'POST'
    }, {
      fullName: 'Invalid Email User',
      username: `invemail_${testUserTimestamp}`,
      email: 'not-an-email-address',
      password: 'password123'
    });
    assert(invalidEmailRes.status === 400, `Invalid email format returns 400 (got ${invalidEmailRes.status})`);

    // 1.5 Short password (< 6 chars)
    const shortPwdRes = await makeRequest(server, {
      path: '/api/v1/auth/register',
      method: 'POST'
    }, {
      fullName: 'Short Pwd User',
      username: `shortpwd_${testUserTimestamp}`,
      email: `shortpwd_${testUserTimestamp}@example.com`,
      password: '123'
    });
    assert(shortPwdRes.status === 400, `Short password (<6 chars) returns 400 (got ${shortPwdRes.status})`);

    // 1.6 Duplicate username
    const dupUsernameRes = await makeRequest(server, {
      path: '/api/v1/auth/register',
      method: 'POST'
    }, {
      fullName: 'Duplicate Username User',
      username: testUserData.username, // duplicate
      email: `different_email_${testUserTimestamp}@example.com`,
      password: 'password123'
    });
    assert(dupUsernameRes.status === 409, `Duplicate username returns 409 Conflict (got ${dupUsernameRes.status})`);

    // 1.7 Duplicate email
    const dupEmailRes = await makeRequest(server, {
      path: '/api/v1/auth/register',
      method: 'POST'
    }, {
      fullName: 'Duplicate Email User',
      username: `unique_usr_${testUserTimestamp}`,
      email: testUserData.email, // duplicate
      password: 'password123'
    });
    assert(dupEmailRes.status === 409, `Duplicate email returns 409 Conflict (got ${dupEmailRes.status})`);

    // ─────────────────────────────────────────────────────────────
    // 2. LOGIN TESTS (POST /api/v1/auth/login)
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 2. Testing User Login ---');

    // 2.1 Login via email
    const loginEmailRes = await makeRequest(server, {
      path: '/api/v1/auth/login',
      method: 'POST'
    }, {
      identifier: testUserData.email,
      password: testUserData.password
    });
    assert(loginEmailRes.status === 200, `Login via email returns 200 OK (got ${loginEmailRes.status})`);
    assert(loginEmailRes.body.success === true, 'Response contains success: true');
    assert(typeof loginEmailRes.body.token === 'string', 'Login returns valid token');
    assert(loginEmailRes.body.user.passwordHash === undefined, 'SECURITY: Login user.passwordHash is NOT exposed');
    assert(loginEmailRes.body.user.salt === undefined, 'SECURITY: Login user.salt is NOT exposed');

    // 2.2 Login via username
    const loginUsernameRes = await makeRequest(server, {
      path: '/api/v1/auth/login',
      method: 'POST'
    }, {
      identifier: testUserData.username,
      password: testUserData.password
    });
    assert(loginUsernameRes.status === 200, `Login via username returns 200 OK (got ${loginUsernameRes.status})`);
    assert(loginUsernameRes.body.user.username === testUserData.username, 'Login user object matches username');

    // 2.3 Login with wrong password
    const wrongPwdRes = await makeRequest(server, {
      path: '/api/v1/auth/login',
      method: 'POST'
    }, {
      identifier: testUserData.email,
      password: 'WrongPassword999!'
    });
    assert(wrongPwdRes.status === 401, `Wrong password returns 401 Unauthorized (got ${wrongPwdRes.status})`);
    assert(wrongPwdRes.body.success === false, 'Wrong password returns success: false');

    // 2.4 Login with unknown identifier
    const unknownUserRes = await makeRequest(server, {
      path: '/api/v1/auth/login',
      method: 'POST'
    }, {
      identifier: `nonexistent_user_${testUserTimestamp}@example.com`,
      password: 'password123'
    });
    assert(unknownUserRes.status === 401, `Unknown identifier returns 401 Unauthorized (got ${unknownUserRes.status})`);

    // 2.5 Suspended user login check
    const { salt: suspSalt, hash: suspHash } = await hashPassword('password123');
    suspendedUserId = `usr_susp_${testUserTimestamp}`;
    await User.create({
      id: suspendedUserId,
      username: `susp_${testUserTimestamp}`,
      fullName: 'Suspended User',
      email: `susp_${testUserTimestamp}@example.com`,
      passwordHash: suspHash,
      salt: suspSalt,
      accountStatus: 'suspended',
      isBlocked: false
    });

    const suspLoginRes = await makeRequest(server, {
      path: '/api/v1/auth/login',
      method: 'POST'
    }, {
      identifier: `susp_${testUserTimestamp}`,
      password: 'password123'
    });
    assert(suspLoginRes.status === 403, `Suspended user login returns 403 Forbidden (got ${suspLoginRes.status})`);

    // 2.6 Blocked user login check
    blockedUserId = `usr_blk_${testUserTimestamp}`;
    await User.create({
      id: blockedUserId,
      username: `blk_${testUserTimestamp}`,
      fullName: 'Blocked User',
      email: `blk_${testUserTimestamp}@example.com`,
      passwordHash: suspHash,
      salt: suspSalt,
      accountStatus: 'active',
      isBlocked: true
    });

    const blkLoginRes = await makeRequest(server, {
      path: '/api/v1/auth/login',
      method: 'POST'
    }, {
      identifier: `blk_${testUserTimestamp}`,
      password: 'password123'
    });
    assert(blkLoginRes.status === 403, `Blocked user login returns 403 Forbidden (got ${blkLoginRes.status})`);

    // ─────────────────────────────────────────────────────────────
    // 3. CURRENT USER TESTS (GET /api/v1/auth/me)
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 3. Testing Current User (/me) & authenticateUser ---');

    // 3.1 Valid Bearer token
    const meRes = await makeRequest(server, {
      path: '/api/v1/auth/me',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${registeredToken}`
      }
    });
    assert(meRes.status === 200, `Valid token returns 200 OK (got ${meRes.status})`);
    assert(meRes.body.success === true, 'Response contains success: true');
    assert(meRes.body.user && meRes.body.user.id === registeredUserId, 'User ID matches authenticated user');
    assert(meRes.body.user.passwordHash === undefined, 'SECURITY: /me does NOT expose passwordHash');
    assert(meRes.body.user.salt === undefined, 'SECURITY: /me does NOT expose salt');

    // 3.2 Missing authorization header
    const noTokenRes = await makeRequest(server, {
      path: '/api/v1/auth/me',
      method: 'GET'
    });
    assert(noTokenRes.status === 401, `Missing token returns 401 Unauthorized (got ${noTokenRes.status})`);

    // 3.3 Invalid authorization format
    const badFormatRes = await makeRequest(server, {
      path: '/api/v1/auth/me',
      method: 'GET',
      headers: {
        'Authorization': 'Basic 12345678'
      }
    });
    assert(badFormatRes.status === 401, `Invalid authorization format returns 401 (got ${badFormatRes.status})`);

    // 3.4 Tampered / invalid token signature
    const tamperedTokenRes = await makeRequest(server, {
      path: '/api/v1/auth/me',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${registeredToken.slice(0, -6)}tamper`
      }
    });
    assert(tamperedTokenRes.status === 401, `Tampered token returns 401 (got ${tamperedTokenRes.status})`);

    // 3.5 Expired token
    const expiredToken = signToken({ id: registeredUserId, username: testUserData.username, role: 'user' }, -100);
    const expiredRes = await makeRequest(server, {
      path: '/api/v1/auth/me',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${expiredToken}`
      }
    });
    assert(expiredRes.status === 401, `Expired token returns 401 (got ${expiredRes.status})`);

    // 3.6 Non-existent user ID token
    const ghostToken = signToken({ id: 'usr_ghost_nonexistent_99999', username: 'ghost', role: 'user' }, 3600);
    const ghostRes = await makeRequest(server, {
      path: '/api/v1/auth/me',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ghostToken}`
      }
    });
    assert(ghostRes.status === 401, `Non-existent user token returns 401 (got ${ghostRes.status})`);

    // ─────────────────────────────────────────────────────────────
    // 4. ADMIN AUTH REGRESSION TESTS
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 4. Testing Admin Authentication Regression ---');

    // 4.1 Admin login
    const adminLoginRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/login',
      method: 'POST'
    }, {
      email: config.defaultAdmin.email,
      password: config.defaultAdmin.password
    });
    assert(adminLoginRes.status === 200, `Admin login returns 200 OK (got ${adminLoginRes.status})`);
    assert(typeof adminLoginRes.body.token === 'string', 'Admin login returns valid admin token');

    // 4.2 Admin /me
    const adminMeRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/me',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${adminLoginRes.body.token}`
      }
    });
    assert(adminMeRes.status === 200, `Admin /me returns 200 OK (got ${adminMeRes.status})`);
    assert(adminMeRes.body.admin && adminMeRes.body.admin.email === config.defaultAdmin.email.toLowerCase(), 'Admin /me returns correct admin identity');

  } finally {
    // ─────────────────────────────────────────────────────────────
    // 5. CLEANUP: Strictly remove only the test users created above
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 5. Cleaning up test-created records ---');
    if (registeredUserId) {
      await User.deleteOne({ id: registeredUserId });
    }
    if (suspendedUserId) {
      await User.deleteOne({ id: suspendedUserId });
    }
    if (blockedUserId) {
      await User.deleteOne({ id: blockedUserId });
    }
    console.log('  🧹 Cleaned up temporary test users only (existing database records untouched).');

    server.close();
    await disconnectDB();
  }

  console.log('\n====================================================');
  console.log(`📊 Final Results: ${testsPassed} Passed, ${testsFailed} Failed`);
  console.log('====================================================\n');

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
