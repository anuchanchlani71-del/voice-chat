const http = require('http');
const app = require('../src/app');
const config = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const { seedDefaultAdmin } = require('../src/seed/seedAdmin');
const Setting = require('../src/models/Setting');

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
 * Main Test Runner for Admin Settings APIs
 */
async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Admin Settings APIs Backend Test Suite');
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
  assert(true, 'Connected to MongoDB for Settings test suite');

  // 2. Ensure Super Admin is seeded
  await seedDefaultAdmin();

  // 3. Start HTTP server on temporary port
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));
  const testPort = server.address().port;
  console.log(`[Test Server] Running on temporary port ${testPort}\n`);

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
    const unauthGet = await makeRequest(server, {
      path: '/api/v1/admin/settings',
      method: 'GET'
    });
    assert(unauthGet.status === 401, 'GET /admin/settings without token returns HTTP 401');

    const unauthPut = await makeRequest(server, {
      path: '/api/v1/admin/settings',
      method: 'PUT'
    }, { platformName: 'New Brand' });
    assert(unauthPut.status === 401, 'PUT /admin/settings without token returns HTTP 401');

    // 6. Reset settings collection to test auto-initialization of defaults
    console.log('\n--- TEST 4: Initial GET /api/v1/admin/settings (Default Creation) ---');
    await Setting.deleteMany({});

    const initialGetRes = await makeRequest(server, {
      path: '/api/v1/admin/settings',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    assert(initialGetRes.status === 200, 'GET /admin/settings returns HTTP 200');
    assert(initialGetRes.body.success === true, 'Response contains success: true');
    assert(Boolean(initialGetRes.body.settings), 'Response contains settings object');

    const s = initialGetRes.body.settings;
    assert(s.platformName === 'Voice Chat & Friends', `platformName default is "Voice Chat & Friends" (got "${s.platformName}")`);
    assert(s.tagline === 'Talk, Connect, Make Friends', `tagline default is "Talk, Connect, Make Friends" (got "${s.tagline}")`);
    assert(s.maxCallDurationMinutes === 120, `maxCallDurationMinutes default is 120 (got ${s.maxCallDurationMinutes})`);
    assert(s.requireMicPermissionBeforeCall === true, `requireMicPermissionBeforeCall default is true (got ${s.requireMicPermissionBeforeCall})`);
    assert(s.allowOnlineStatusToggle === true, `allowOnlineStatusToggle default is true (got ${s.allowOnlineStatusToggle})`);
    assert(s.minInterestsRequired === 2, `minInterestsRequired default is 2 (got ${s.minInterestsRequired})`);
    assert(s.maxInterestsAllowed === 10, `maxInterestsAllowed default is 10 (got ${s.maxInterestsAllowed})`);
    assert(s.friendRequestRateLimitPerHour === 15, `friendRequestRateLimitPerHour default is 15 (got ${s.friendRequestRateLimitPerHour})`);
    assert(s.autoFlagReportThreshold === 3, `autoFlagReportThreshold default is 3 (got ${s.autoFlagReportThreshold})`);
    assert(s.version === 'v1.0.0-MVP (Phase 1)', `version is "v1.0.0-MVP (Phase 1)" (got "${s.version}")`);
    assert(s.voiceChatModel === 'Model 7: Interest-based Discovery + Friend System + 1-to-1 Voice Chat', 'voiceChatModel default matches PRD specification');
    assert(s.defaultProfileVisibility === 'Logged-in Friends Only for Voice / Public for Discovery', 'defaultProfileVisibility default matches PRD specification');
    assert(Boolean(s.updatedAt), 'Response contains updatedAt timestamp');
    assert(s.__v === undefined && s._id === undefined, 'Internal Mongoose fields (__v, _id) are stripped');

    // 7. PUT /api/v1/admin/settings (Valid Update)
    console.log('\n--- TEST 5: PUT /api/v1/admin/settings (Valid Update) ---');
    const updatePayload = {
      platformName: 'Voice Chat & Friends Global',
      tagline: 'Connect instantly through voice and mutual passions',
      maxCallDurationMinutes: 90,
      requireMicPermissionBeforeCall: false,
      allowOnlineStatusToggle: false,
      minInterestsRequired: 3,
      maxInterestsAllowed: 12,
      friendRequestRateLimitPerHour: 25,
      autoFlagReportThreshold: 5
    };

    const putRes = await makeRequest(server, {
      path: '/api/v1/admin/settings',
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, updatePayload);

    assert(putRes.status === 200, 'PUT /admin/settings returns HTTP 200');
    assert(putRes.body.success === true, 'PUT response contains success: true');
    assert(Boolean(putRes.body.message), 'PUT response contains success message');

    const updatedS = putRes.body.settings;
    assert(updatedS.platformName === 'Voice Chat & Friends Global', 'platformName updated');
    assert(updatedS.tagline === 'Connect instantly through voice and mutual passions', 'tagline updated');
    assert(updatedS.maxCallDurationMinutes === 90, 'maxCallDurationMinutes updated to 90');
    assert(updatedS.requireMicPermissionBeforeCall === false, 'requireMicPermissionBeforeCall updated to false');
    assert(updatedS.allowOnlineStatusToggle === false, 'allowOnlineStatusToggle updated to false');
    assert(updatedS.minInterestsRequired === 3, 'minInterestsRequired updated to 3');
    assert(updatedS.maxInterestsAllowed === 12, 'maxInterestsAllowed updated to 12');
    assert(updatedS.friendRequestRateLimitPerHour === 25, 'friendRequestRateLimitPerHour updated to 25');
    assert(updatedS.autoFlagReportThreshold === 5, 'autoFlagReportThreshold updated to 5');

    // Verify persistence via subsequent GET
    console.log('\n--- TEST 6: Verify Persistence via GET ---');
    const getAfterPutRes = await makeRequest(server, {
      path: '/api/v1/admin/settings',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(getAfterPutRes.status === 200, 'GET /admin/settings after PUT returns HTTP 200');
    assert(getAfterPutRes.body.settings.platformName === 'Voice Chat & Friends Global', 'Persisted platformName verified in MongoDB');
    assert(getAfterPutRes.body.settings.maxCallDurationMinutes === 90, 'Persisted maxCallDurationMinutes verified in MongoDB');

    // 8. Strict Validation Checks (400 Bad Request)
    console.log('\n--- TEST 7: Strict Validation Checks (400 Bad Request) ---');

    // Empty body
    const emptyBodyRes = await makeRequest(server, {
      path: '/api/v1/admin/settings',
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {});
    assert(emptyBodyRes.status === 400, 'Empty PUT body returns HTTP 400');

    // Empty platformName
    const emptyNameRes = await makeRequest(server, {
      path: '/api/v1/admin/settings',
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, { platformName: '   ' });
    assert(emptyNameRes.status === 400, 'Empty platformName string returns HTTP 400');

    // Platform name too long (> 100)
    const longNameRes = await makeRequest(server, {
      path: '/api/v1/admin/settings',
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, { platformName: 'A'.repeat(101) });
    assert(longNameRes.status === 400, 'platformName > 100 chars returns HTTP 400');

    // Tagline too long (> 200)
    const longTaglineRes = await makeRequest(server, {
      path: '/api/v1/admin/settings',
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, { tagline: 'T'.repeat(201) });
    assert(longTaglineRes.status === 400, 'tagline > 200 chars returns HTTP 400');

    // maxCallDurationMinutes < 1
    const minDurationRes = await makeRequest(server, {
      path: '/api/v1/admin/settings',
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, { maxCallDurationMinutes: 0 });
    assert(minDurationRes.status === 400, 'maxCallDurationMinutes < 1 returns HTTP 400');

    // maxCallDurationMinutes > 1440
    const maxDurationRes = await makeRequest(server, {
      path: '/api/v1/admin/settings',
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, { maxCallDurationMinutes: 1441 });
    assert(maxDurationRes.status === 400, 'maxCallDurationMinutes > 1440 returns HTTP 400');

    // maxCallDurationMinutes not integer
    const floatDurationRes = await makeRequest(server, {
      path: '/api/v1/admin/settings',
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, { maxCallDurationMinutes: 12.5 });
    assert(floatDurationRes.status === 400, 'Floating point maxCallDurationMinutes returns HTTP 400');

    // Non-boolean requireMicPermissionBeforeCall
    const invalidMicRes = await makeRequest(server, {
      path: '/api/v1/admin/settings',
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, { requireMicPermissionBeforeCall: 'yes' });
    assert(invalidMicRes.status === 400, 'Non-boolean requireMicPermissionBeforeCall returns HTTP 400');

    // Non-boolean allowOnlineStatusToggle
    const invalidOnlineToggleRes = await makeRequest(server, {
      path: '/api/v1/admin/settings',
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, { allowOnlineStatusToggle: 1 });
    assert(invalidOnlineToggleRes.status === 400, 'Non-boolean allowOnlineStatusToggle returns HTTP 400');

    // minInterestsRequired < 1
    const invalidMinInterestsRes = await makeRequest(server, {
      path: '/api/v1/admin/settings',
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, { minInterestsRequired: 0 });
    assert(invalidMinInterestsRes.status === 400, 'minInterestsRequired < 1 returns HTTP 400');

    // minInterestsRequired > 20
    const exceedMinInterestsRes = await makeRequest(server, {
      path: '/api/v1/admin/settings',
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, { minInterestsRequired: 21 });
    assert(exceedMinInterestsRes.status === 400, 'minInterestsRequired > 20 returns HTTP 400');

    // maxInterestsAllowed < 1
    const invalidMaxInterestsRes = await makeRequest(server, {
      path: '/api/v1/admin/settings',
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, { maxInterestsAllowed: 0 });
    assert(invalidMaxInterestsRes.status === 400, 'maxInterestsAllowed < 1 returns HTTP 400');

    // maxInterestsAllowed > 50
    const exceedMaxInterestsRes = await makeRequest(server, {
      path: '/api/v1/admin/settings',
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, { maxInterestsAllowed: 51 });
    assert(exceedMaxInterestsRes.status === 400, 'maxInterestsAllowed > 50 returns HTTP 400');

    // minInterestsRequired > maxInterestsAllowed
    const minGreaterMaxRes = await makeRequest(server, {
      path: '/api/v1/admin/settings',
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, { minInterestsRequired: 15, maxInterestsAllowed: 10 });
    assert(minGreaterMaxRes.status === 400, 'minInterestsRequired > maxInterestsAllowed returns HTTP 400');

    // friendRequestRateLimitPerHour < 1 or > 500
    const invalidRateLimitRes = await makeRequest(server, {
      path: '/api/v1/admin/settings',
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, { friendRequestRateLimitPerHour: 501 });
    assert(invalidRateLimitRes.status === 400, 'friendRequestRateLimitPerHour > 500 returns HTTP 400');

    // autoFlagReportThreshold < 1 or > 100
    const invalidThresholdRes = await makeRequest(server, {
      path: '/api/v1/admin/settings',
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, { autoFlagReportThreshold: 101 });
    assert(invalidThresholdRes.status === 400, 'autoFlagReportThreshold > 100 returns HTTP 400');

    // 9. Read-Only Protection
    console.log('\n--- TEST 8: Read-Only Protection ---');
    const readOnlyAttackRes = await makeRequest(server, {
      path: '/api/v1/admin/settings',
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }, {
      platformName: 'Voice Chat & Friends Protected',
      version: 'v99.0.0-HACKED',
      voiceChatModel: 'Custom Video Stream',
      defaultProfileVisibility: 'Completely Public'
    });

    assert(readOnlyAttackRes.status === 200, 'PUT with read-only fields succeeds for editable fields');
    const protectedS = readOnlyAttackRes.body.settings;
    assert(protectedS.platformName === 'Voice Chat & Friends Protected', 'platformName updated');
    assert(protectedS.version === 'v1.0.0-MVP (Phase 1)', 'version was NOT altered by client');
    assert(protectedS.voiceChatModel === 'Model 7: Interest-based Discovery + Friend System + 1-to-1 Voice Chat', 'voiceChatModel was NOT altered by client');
    assert(protectedS.defaultProfileVisibility === 'Logged-in Friends Only for Voice / Public for Discovery', 'defaultProfileVisibility was NOT altered by client');

    // 10. Credential Sanitization Audit
    console.log('\n--- TEST 9: Credential Sanitization Audit ---');
    const rawSettings = JSON.stringify(protectedS);
    assert(!rawSettings.includes('passwordHash') && !rawSettings.includes('salt') && !rawSettings.includes('__v'),
      'Settings response contains zero credentials or mongoose internal fields');

    // 11. Full Regression Checks Across All 11 Other Admin Modules
    console.log('\n--- TEST 10: Full Regression Checks (All 11 Admin Modules) ---');

    const authMeRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/me',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(authMeRes.status === 200, 'GET /admin/auth/me works');

    const dashStatsRes = await makeRequest(server, {
      path: '/api/v1/admin/dashboard/stats',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(dashStatsRes.status === 200, 'GET /admin/dashboard/stats works');

    const dashChartsRes = await makeRequest(server, {
      path: '/api/v1/admin/dashboard/charts',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(dashChartsRes.status === 200, 'GET /admin/dashboard/charts works');

    const usersRes = await makeRequest(server, {
      path: '/api/v1/admin/users',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(usersRes.status === 200, 'GET /admin/users works');

    const friendshipsRes = await makeRequest(server, {
      path: '/api/v1/admin/friendships',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(friendshipsRes.status === 200, 'GET /admin/friendships works');

    const interestsRes = await makeRequest(server, {
      path: '/api/v1/admin/interests',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(interestsRes.status === 200, 'GET /admin/interests works');

    const friendReqsRes = await makeRequest(server, {
      path: '/api/v1/admin/friend-requests',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(friendReqsRes.status === 200, 'GET /admin/friend-requests works');

    const voiceCallsRes = await makeRequest(server, {
      path: '/api/v1/admin/voice-calls',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(voiceCallsRes.status === 200, 'GET /admin/voice-calls works');

    const reportsRes = await makeRequest(server, {
      path: '/api/v1/admin/reports',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(reportsRes.status === 200, 'GET /admin/reports works');

    const blockedRes = await makeRequest(server, {
      path: '/api/v1/admin/blocked-users',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(blockedRes.status === 200, 'GET /admin/blocked-users works');

    const notifsRes = await makeRequest(server, {
      path: '/api/v1/admin/notifications',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(notifsRes.status === 200, 'GET /admin/notifications works');

    const safetyOverviewRes = await makeRequest(server, {
      path: '/api/v1/admin/safety/overview',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(safetyOverviewRes.status === 200, 'GET /admin/safety/overview works');

  } finally {
    // 12. Reset settings to default values for clean state
    console.log('\n--- TEST 11: Teardown & Reset to Default Settings ---');
    await Setting.deleteMany({});
    const defaultSettingDoc = new Setting({ ...Setting.DEFAULT_SETTINGS });
    await defaultSettingDoc.save();
    console.log('[Teardown] Platform settings reset to default state.');

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
