const http = require('http');
const assert = require('assert');
const app = require('../src/app');
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

async function runProfileUpdateTests() {
  console.log('🧪 Starting Profile Update API Tests (PATCH /api/v1/users/me)');
  await connectDB();
  const checks = [];

  const server = http.createServer(app.callback());

  await new Promise((resolve) => server.listen(0, resolve));

  const uniqueId = Date.now();
  const testUser = {
    fullName: 'Original User',
    username: `profuser_${uniqueId}`,
    email: `profuser_${uniqueId}@example.com`,
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
    const token = regRes.body.token;
    checks.push('1. User registered successfully and token received (PASS)');

    // 2. Unauthenticated PATCH /api/v1/users/me -> 401
    const unauthRes = await makeRequest(server, {
      path: '/api/v1/users/me',
      method: 'PATCH'
    }, { fullName: 'Hacker Name' });

    assert.strictEqual(unauthRes.status, 401, 'Unauthenticated PATCH /users/me should return 401');
    checks.push('2. Unauthenticated PATCH /api/v1/users/me returns 401 (PASS)');

    // 3. Empty body -> 400
    const emptyRes = await makeRequest(server, {
      path: '/api/v1/users/me',
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` }
    }, {});

    assert.strictEqual(emptyRes.status, 400, 'Empty update payload should return 400');
    checks.push('3. Empty payload returns 400 validation error (PASS)');

    // 4. Invalid fullName (too short) -> 400
    const shortNameRes = await makeRequest(server, {
      path: '/api/v1/users/me',
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` }
    }, { fullName: 'A' });

    assert.strictEqual(shortNameRes.status, 400, 'Short fullName should return 400');
    checks.push('4. Short fullName (<2 chars) returns 400 (PASS)');

    // 5. Invalid bio (too long) -> 400
    const longBio = 'x'.repeat(301);
    const longBioRes = await makeRequest(server, {
      path: '/api/v1/users/me',
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` }
    }, { bio: longBio });

    assert.strictEqual(longBioRes.status, 400, 'Long bio should return 400');
    checks.push('5. Excessively long bio (>300 chars) returns 400 (PASS)');

    // 6. Invalid voiceStatus -> 400
    const invalidStatusRes = await makeRequest(server, {
      path: '/api/v1/users/me',
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` }
    }, { voiceStatus: 'non_existent_status' });

    assert.strictEqual(invalidStatusRes.status, 400, 'Invalid voiceStatus should return 400');
    checks.push('6. Invalid voiceStatus returns 400 (PASS)');

    // 7. Successful full profile update
    const updatePayload = {
      fullName: 'Anita Chanchlani',
      bio: 'Podcaster, gamer and voice room host 🎙️',
      avatar: '🎧',
      avatarId: 'av-2',
      avatarBg: 'linear-gradient(135deg, #00F5D4, #7B2CBF)',
      interests: ['Gaming & Esports', 'Lo-Fi Chill Beats', 'Podcasts'],
      location: 'Mumbai, India',
      languages: ['English (Fluent)', 'Hindi (Native)'],
      conversationStyle: 'Casual chill & late night talks',
      preferredTime: 'Evenings & Weekends',
      voiceStatus: 'available_to_talk'
    };

    const updateRes = await makeRequest(server, {
      path: '/api/v1/users/me',
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` }
    }, updatePayload);

    assert.strictEqual(updateRes.status, 200, 'Profile update should return 200');
    assert.strictEqual(updateRes.body.success, true, 'success should be true');
    assert(updateRes.body.user, 'Should return updated user');
    assert.strictEqual(updateRes.body.user.fullName, 'Anita Chanchlani');
    assert.strictEqual(updateRes.body.user.bio, updatePayload.bio);
    assert.strictEqual(updateRes.body.user.avatar, '🎧');
    assert.strictEqual(updateRes.body.user.avatarId, 'av-2');
    assert.strictEqual(updateRes.body.user.location, 'Mumbai, India');
    assert.strictEqual(updateRes.body.user.conversationStyle, 'Casual chill & late night talks');
    assert.strictEqual(updateRes.body.user.preferredTime, 'Evenings & Weekends');
    assert.strictEqual(updateRes.body.user.voiceStatus, 'available_to_talk');
    assert.deepStrictEqual(updateRes.body.user.languages, ['English (Fluent)', 'Hindi (Native)']);
    assert.deepStrictEqual(updateRes.body.user.interests, ['Gaming & Esports', 'Lo-Fi Chill Beats', 'Podcasts']);
    assert.strictEqual(updateRes.body.user.passwordHash, undefined, 'passwordHash must be omitted');
    assert.strictEqual(updateRes.body.user.salt, undefined, 'salt must be omitted');
    checks.push('7. Successful PATCH /api/v1/users/me with all supported fields (PASS)');

    // 8. Verify persistence with GET /api/v1/auth/me
    const getMeRes = await makeRequest(server, {
      path: '/api/v1/auth/me',
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });

    assert.strictEqual(getMeRes.status, 200, 'GET /auth/me should return 200');
    assert.strictEqual(getMeRes.body.user.fullName, 'Anita Chanchlani');
    assert.strictEqual(getMeRes.body.user.location, 'Mumbai, India');
    assert.strictEqual(getMeRes.body.user.voiceStatus, 'available_to_talk');
    assert.strictEqual(getMeRes.body.user.avatarId, 'av-2');
    checks.push('8. Verified persistence via GET /api/v1/auth/me (PASS)');

    // 9. Verify existing onboarding PATCH /api/v1/users/me/onboarding still works
    const onboardRes = await makeRequest(server, {
      path: '/api/v1/users/me/onboarding',
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` }
    }, { interests: ['Coding & Dev', 'Deep Night Talks'] });

    assert.strictEqual(onboardRes.status, 200, 'Onboarding endpoint should return 200');
    assert.strictEqual(onboardRes.body.user.isOnboarded, true, 'isOnboarded should be true');
    assert.deepStrictEqual(onboardRes.body.user.interests, ['Coding & Dev', 'Deep Night Talks']);
    checks.push('9. Existing PATCH /api/v1/users/me/onboarding endpoint remains 100% operational (PASS)');

    console.log('\n--- ALL TEST CHECKS PASSED ---');
    checks.forEach(c => console.log('  ✓', c));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await disconnectDB();
  }
}

if (require.main === module) {
  runProfileUpdateTests()
    .then(() => {
      console.log('\n🎉 ALL PROFILE UPDATE TESTS COMPLETED SUCCESSFULLY.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n❌ TEST FAILED:', err);
      process.exit(1);
    });
}

module.exports = runProfileUpdateTests;
