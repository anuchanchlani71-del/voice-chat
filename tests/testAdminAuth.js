const http = require('http');
const app = require('../src/app');
const config = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const { seedDefaultAdmin } = require('../src/seed/seedAdmin');
const Admin = require('../models/Admin');
const { signToken } = require('../src/utils/tokenUtils');

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
 * Main Test Runner
 */
async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Admin MongoDB Backend Test Suite');
  console.log(`🗄️  Target: ${config.mongoUri}`);
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

  // 1. Establish connection to local MongoDB
  console.log('--- TEST 1: MongoDB Database Handshake ---');
  try {
    await connectDB();
    assert(true, `Successfully connected to local MongoDB (${config.mongoUri})`);
  } catch (err) {
    assert(false, `MongoDB connection failed: ${err.message}`);
    console.error('\n❌ Ensure MongoDB daemon is running locally: mongod --dbpath <data_dir>');
    return;
  }

  // 2. Test Idempotent Seeding
  console.log('\n--- TEST 2: Idempotent Super Admin Seeding in MongoDB ---');
  const seed1 = await seedDefaultAdmin();
  assert(seed1 && seed1.email === config.defaultAdmin.email.toLowerCase(), 'First seed creates Super Admin');

  const seed2 = await seedDefaultAdmin();
  assert(seed2 && seed2.email === config.defaultAdmin.email.toLowerCase(), 'Second seed returns existing Super Admin without duplicating');

  if (Admin.countDocuments) {
    const adminCount = await Admin.countDocuments({ email: config.defaultAdmin.email.toLowerCase() });
    assert(adminCount === 1, 'Exactly 1 Super Admin document exists in MongoDB');
  }

  // 3. Start server on ephemeral port (port 0)
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));
  const testPort = server.address().port;
  console.log(`\n[Test Server] Running on temporary port ${testPort}`);

  try {
    // TEST 3: Healthcheck
    console.log('\n--- TEST 3: Backend Service Health ---');
    const healthRes = await makeRequest(server, { path: '/health', method: 'GET' });
    assert(healthRes.status === 200, 'Health endpoint returns HTTP 200');
    assert(healthRes.body.status === 'online', 'Service status is "online"');

    // TEST 4: Successful Admin Login via MongoDB
    console.log('\n--- TEST 4: Successful Admin Login (MongoDB Auth) ---');
    const validLoginRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/login',
      method: 'POST'
    }, {
      email: config.defaultAdmin.email,
      password: config.defaultAdmin.password
    });

    assert(validLoginRes.status === 200, 'Valid credentials return HTTP 200');
    assert(validLoginRes.body.success === true, 'Response contains success: true');
    assert(typeof validLoginRes.body.token === 'string' && validLoginRes.body.token.length > 20, 'Response returns signed JWT token');
    assert(validLoginRes.body.admin.email === config.defaultAdmin.email.toLowerCase(), 'Response returns correct admin email from MongoDB');
    assert(validLoginRes.body.admin.role === config.defaultAdmin.role, 'Response returns correct admin role');

    const adminToken = validLoginRes.body.token;

    // TEST 5: Login with Invalid Password
    console.log('\n--- TEST 5: Login with Invalid Password ---');
    const invalidPwRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/login',
      method: 'POST'
    }, {
      email: config.defaultAdmin.email,
      password: 'WrongPassword999!'
    });

    assert(invalidPwRes.status === 401, 'Wrong password returns HTTP 401 Unauthorized');
    assert(invalidPwRes.body.success === false, 'Response contains success: false');

    // TEST 6: Login with Non-existent Email
    console.log('\n--- TEST 6: Login with Non-existent Email ---');
    const invalidEmailRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/login',
      method: 'POST'
    }, {
      email: 'nonexistent_admin@voicefriends.io',
      password: 'SomePassword123!'
    });

    assert(invalidEmailRes.status === 401, 'Non-existent admin returns HTTP 401 Unauthorized');
    assert(invalidEmailRes.body.success === false, 'Response contains success: false');

    // TEST 7: Login with Missing Fields (Validation)
    console.log('\n--- TEST 7: Login with Missing / Invalid Fields ---');
    const missingFieldsRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/login',
      method: 'POST'
    }, {
      email: 'admin@voicefriends.io'
    });

    assert(missingFieldsRes.status === 400, 'Missing password returns HTTP 400 Bad Request');
    assert(missingFieldsRes.body.success === false, 'Response contains success: false');

    // TEST 8: Authenticated GET /api/v1/admin/auth/me
    console.log('\n--- TEST 8: Authenticated GET /api/v1/admin/auth/me ---');
    const meRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/me',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    });

    assert(meRes.status === 200, 'Authenticated request to /me returns HTTP 200');
    assert(meRes.body.success === true, 'Response contains success: true');
    assert(meRes.body.admin.email === config.defaultAdmin.email.toLowerCase(), 'Profile matches authenticated admin email');
    assert(meRes.body.admin.name === config.defaultAdmin.name, 'Profile matches authenticated admin name');

    // TEST 9: Unauthenticated GET /api/v1/admin/auth/me
    console.log('\n--- TEST 9: Unauthenticated GET /api/v1/admin/auth/me (No Token) ---');
    const unauthMeRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/me',
      method: 'GET'
    });

    assert(unauthMeRes.status === 401, 'Request without Authorization header returns HTTP 401 Unauthorized');
    assert(unauthMeRes.body.success === false, 'Response contains success: false');

    // TEST 10: GET /api/v1/admin/auth/me with Tampered Token
    console.log('\n--- TEST 10: Tampered Token Verification ---');
    const tamperedRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/me',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.tamperedpayload.invalidsig'
      }
    });

    assert(tamperedRes.status === 401, 'Tampered token returns HTTP 401 Unauthorized');
    assert(tamperedRes.body.success === false, 'Response contains success: false');

    // TEST 11: GET /api/v1/admin/auth/me with Expired Token
    console.log('\n--- TEST 11: Expired Token Verification ---');
    const expiredToken = signToken({ id: validLoginRes.body.admin.id, email: config.defaultAdmin.email }, -10);
    const expiredRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/me',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${expiredToken}`
      }
    });

    assert(expiredRes.status === 401, 'Expired token returns HTTP 401 Unauthorized');
    assert(expiredRes.body.error.toLowerCase().includes('expired'), 'Error message indicates token expiration');

    // TEST 12: Security Audit — No Passwords or Hashes Exposed
    console.log('\n--- TEST 12: Security Audit: No Password / Hash Exposure ---');
    const loginJson = JSON.stringify(validLoginRes.body);
    const meJson = JSON.stringify(meRes.body);

    assert(!loginJson.includes('passwordHash') && !loginJson.includes('salt') && !loginJson.includes('AdminPassword'),
      'Login response contains ZERO password, salt, or passwordHash fields');
    assert(!meJson.includes('passwordHash') && !meJson.includes('salt') && !meJson.includes('AdminPassword'),
      '/me response contains ZERO password, salt, or passwordHash fields');

    // TEST 13: Change Password Validation (Wrong Current Password)
    console.log('\n--- TEST 13: Change Password with Incorrect Current Password ---');
    const wrongCurrentPwRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/change-password',
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    }, {
      currentPassword: 'WrongCurrentPassword123!',
      newPassword: 'NewSecurePassword456!'
    });

    assert(wrongCurrentPwRes.status === 400, 'Incorrect current password returns HTTP 400 Bad Request');
    assert(wrongCurrentPwRes.body.success === false, 'Response contains success: false');

    // TEST 14: Change Password Validation (Identical Current and New Password)
    console.log('\n--- TEST 14: Change Password with Same Current and New Password ---');
    const samePwRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/change-password',
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    }, {
      currentPassword: config.defaultAdmin.password,
      newPassword: config.defaultAdmin.password
    });

    assert(samePwRes.status === 400, 'Same current and new password returns HTTP 400 Bad Request');
    assert(samePwRes.body.success === false, 'Response contains success: false');

    // TEST 15: Successful Change Password & Login with New Password
    console.log('\n--- TEST 15: Successful Change Password & Re-authentication ---');
    const tempNewPassword = 'UpdatedAdminSecret999!';
    const changeSuccessRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/change-password',
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    }, {
      currentPassword: config.defaultAdmin.password,
      newPassword: tempNewPassword
    });

    assert(changeSuccessRes.status === 200, 'Valid change password returns HTTP 200 OK');
    assert(changeSuccessRes.body.success === true, 'Response contains success: true');

    // Verify old password fails
    const oldLoginRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/login',
      method: 'POST'
    }, {
      email: config.defaultAdmin.email,
      password: config.defaultAdmin.password
    });
    assert(oldLoginRes.status === 401, 'Old password is no longer accepted after change');

    // Verify new password succeeds
    const newLoginRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/login',
      method: 'POST'
    }, {
      email: config.defaultAdmin.email,
      password: tempNewPassword
    });
    assert(newLoginRes.status === 200, 'New password successfully authenticates admin');
    assert(newLoginRes.body.success === true, 'Response contains success: true');

    // Restore original password
    const restoreRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/change-password',
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${newLoginRes.body.token}`
      }
    }, {
      currentPassword: tempNewPassword,
      newPassword: config.defaultAdmin.password
    });
    assert(restoreRes.status === 200, 'Original password restored cleanly for dev/testing');

  } finally {
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
