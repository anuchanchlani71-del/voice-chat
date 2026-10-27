const http = require('http');
const assert = require('assert');
const app = require('../src/app');
const { connectDB, disconnectDB, getConnectionStatus } = require('../src/config/db');
const User = require('../src/models/User');
const Friendship = require('../src/models/Friendship');
const FriendRequest = require('../src/models/FriendRequest');
const config = require('../src/config/env');

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

async function runDiscoverFlowTests() {
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
  console.log('🧪 Starting Core Discover Backend Test Suite');
  console.log('====================================================');

  const wasConnected = getConnectionStatus() === 'connected';
  if (!wasConnected) {
    await connectDB();
  }

  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));

  const uid = Math.floor(10000 + Math.random() * 90000);

  try {
    // 0. Setup: Register viewer and candidate test users sequentially
    const regViewer = await makeRequest(server, { path: '/api/v1/auth/register', method: 'POST' }, {
      fullName: 'Viewer User',
      username: `view_${uid}`,
      email: `view_${uid}@example.com`,
      password: 'Password123!'
    });

    const regAlice = await makeRequest(server, { path: '/api/v1/auth/register', method: 'POST' }, {
      fullName: 'Alice Wonder',
      username: `alice_${uid}`,
      email: `alice_${uid}@example.com`,
      password: 'Password123!'
    });

    const regBob = await makeRequest(server, { path: '/api/v1/auth/register', method: 'POST' }, {
      fullName: 'Bob Builder',
      username: `bob_${uid}`,
      email: `bob_${uid}@example.com`,
      password: 'Password123!'
    });

    const regCarol = await makeRequest(server, { path: '/api/v1/auth/register', method: 'POST' }, {
      fullName: 'Carol Inactive',
      username: `carol_${uid}`,
      email: `carol_${uid}@example.com`,
      password: 'Password123!'
    });

    const regDavid = await makeRequest(server, { path: '/api/v1/auth/register', method: 'POST' }, {
      fullName: 'David Blocked',
      username: `david_${uid}`,
      email: `david_${uid}@example.com`,
      password: 'Password123!'
    });

    const tokenViewer = regViewer.body?.token;
    const viewerUser = regViewer.body?.user;
    const aliceUser = regAlice.body?.user;
    const bobUser = regBob.body?.user;
    const carolUser = regCarol.body?.user;
    const davidUser = regDavid.body?.user;

    assert(tokenViewer && viewerUser, `Viewer registration failed: ${JSON.stringify(regViewer.body)}`);
    assert(regAlice.body?.token && aliceUser, `Alice registration failed: ${JSON.stringify(regAlice.body)}`);
    assert(regBob.body?.token && bobUser, `Bob registration failed: ${JSON.stringify(regBob.body)}`);
    assert(carolUser, `Carol registration failed: ${JSON.stringify(regCarol.body)}`);
    assert(davidUser, `David registration failed: ${JSON.stringify(regDavid.body)}`);

    // Update profile attributes for candidates
    await makeRequest(server, {
      path: '/api/v1/users/me',
      method: 'PATCH',
      headers: { Authorization: `Bearer ${regAlice.body.token}` }
    }, {
      bio: 'Curious explorer in wonderland',
      interests: ['Gaming & Esports', 'Lo-Fi Chill Beats'],
      languages: ['English (Native)', 'Spanish (Fluent)'],
      voiceStatus: 'available_to_talk',
      location: 'London, UK'
    });

    await makeRequest(server, {
      path: '/api/v1/users/me',
      method: 'PATCH',
      headers: { Authorization: `Bearer ${regBob.body.token}` }
    }, {
      bio: 'Can we build it? Yes we can!',
      interests: ['Tech & Code', 'Startups'],
      languages: ['French (Fluent)'],
      voiceStatus: 'online',
      location: 'Paris, France'
    });

    // Mark Carol suspended and David blocked in MongoDB
    await User.updateOne({ id: carolUser.id }, { $set: { accountStatus: 'suspended' } });
    await User.updateOne({ id: davidUser.id }, { $set: { isBlocked: true } });

    // 1. Authenticated discover request
    const discRes = await makeRequest(server, {
      path: '/api/v1/users/discover',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenViewer}` }
    });

    const isStep1Pass = discRes.status === 200 &&
      discRes.body.success === true &&
      Array.isArray(discRes.body.users) &&
      typeof discRes.body.totalCount === 'number' &&
      discRes.body.totalCount >= 2;

    record('1. Authenticated GET /api/v1/users/discover returns users and count', isStep1Pass, `status: ${discRes.status}, count: ${discRes.body?.totalCount}`);

    // 2. Unauthenticated discover and profile return 401
    const unauthDisc = await makeRequest(server, { path: '/api/v1/users/discover', method: 'GET' });
    const unauthProfile = await makeRequest(server, { path: `/api/v1/users/${aliceUser.id}`, method: 'GET' });

    const isStep2Pass = unauthDisc.status === 401 && unauthProfile.status === 401;
    record('2. Unauthenticated requests return 401 Unauthorized', isStep2Pass, `discover: ${unauthDisc.status}, profile: ${unauthProfile.status}`);

    // 3. Current authenticated user is excluded from discover list
    const hasSelf = discRes.body?.users?.some(u => u.id === viewerUser.id);
    record('3. Current authenticated user is excluded from discover list', !hasSelf, `viewerUser.id in users: ${hasSelf}`);

    // 4. Suspended/inactive and blocked users are excluded
    const hasSuspended = discRes.body?.users?.some(u => u.id === carolUser.id);
    const hasBlocked = discRes.body?.users?.some(u => u.id === davidUser.id);
    record('4. Suspended and blocked users are excluded from discover list', !hasSuspended && !hasBlocked, `suspended found: ${hasSuspended}, blocked found: ${hasBlocked}`);

    // 5. Search by username and fullName
    const searchNameRes = await makeRequest(server, {
      path: '/api/v1/users/discover?search=Wonder',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenViewer}` }
    });

    const searchUserRes = await makeRequest(server, {
      path: `/api/v1/users/discover?search=${bobUser.username}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenViewer}` }
    });

    const hasAliceByName = searchNameRes.body?.users?.some(u => u.id === aliceUser.id) &&
      !searchNameRes.body?.users?.some(u => u.id === bobUser.id);
    const hasBobByUser = searchUserRes.body?.users?.some(u => u.id === bobUser.id) &&
      !searchUserRes.body?.users?.some(u => u.id === aliceUser.id);

    record('5. Search filter matches username, fullName and bio', hasAliceByName && hasBobByUser, `searchName matches Alice: ${hasAliceByName}, searchUser matches Bob: ${hasBobByUser}`);

    // 6. Interest / Topic filter
    const topicRes = await makeRequest(server, {
      path: '/api/v1/users/discover?topic=Gaming',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenViewer}` }
    });

    const hasGamingAlice = topicRes.body?.users?.some(u => u.id === aliceUser.id);
    const hasGamingBob = topicRes.body?.users?.some(u => u.id === bobUser.id);
    record('6. Interest/Topic filter returns matching users', hasGamingAlice && !hasGamingBob, `Alice in Gaming: ${hasGamingAlice}, Bob in Gaming: ${hasGamingBob}`);

    // 7. Availability filter (available_to_talk vs online)
    const availRes = await makeRequest(server, {
      path: '/api/v1/users/discover?availability=available_to_talk',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenViewer}` }
    });

    const hasAvailAlice = availRes.body?.users?.some(u => u.id === aliceUser.id);
    const hasAvailBob = availRes.body?.users?.some(u => u.id === bobUser.id);
    record('7. Availability filter correctly isolates available_to_talk users', hasAvailAlice && !hasAvailBob, `Alice: ${hasAvailAlice}, Bob: ${hasAvailBob}`);

    // 8. Language filter
    const langRes = await makeRequest(server, {
      path: '/api/v1/users/discover?language=French',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenViewer}` }
    });

    const hasFrenchBob = langRes.body?.users?.some(u => u.id === bobUser.id);
    const hasFrenchAlice = langRes.body?.users?.some(u => u.id === aliceUser.id);
    record('8. Language filter matches specified spoken languages', hasFrenchBob && !hasFrenchAlice, `Bob in French: ${hasFrenchBob}, Alice in French: ${hasFrenchAlice}`);

    // 9. Pagination (page & limit)
    const pageRes = await makeRequest(server, {
      path: '/api/v1/users/discover?page=1&limit=1',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenViewer}` }
    });

    const isStep9Pass = pageRes.status === 200 &&
      pageRes.body.users.length === 1 &&
      pageRes.body.page === 1 &&
      pageRes.body.limit === 1 &&
      pageRes.body.totalPages >= 2;

    record('9. Pagination parameters limit and page return accurate page metadata', isStep9Pass, `users: ${pageRes.body?.users?.length}, totalPages: ${pageRes.body?.totalPages}`);

    // 10. Sanitized response: safe public fields only
    const sampleUser = discRes.body?.users?.[0];
    const isStep10Pass = sampleUser &&
      sampleUser.id &&
      sampleUser.username &&
      sampleUser.fullName &&
      Array.isArray(sampleUser.interests) &&
      sampleUser.passwordHash === undefined &&
      sampleUser.salt === undefined &&
      sampleUser.email === undefined &&
      sampleUser.phone === undefined &&
      sampleUser.reportsCount === undefined;

    record('10. Discover users payload is sanitized (no credentials or private fields)', !!isStep10Pass, `id: ${sampleUser?.id}, username: ${sampleUser?.username}`);

    // 11. Public profile by custom User.id
    const profileById = await makeRequest(server, {
      path: `/api/v1/users/${aliceUser.id}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenViewer}` }
    });

    const isStep11Pass = profileById.status === 200 &&
      profileById.body.success === true &&
      profileById.body.user &&
      profileById.body.user.id === aliceUser.id &&
      profileById.body.user.fullName === 'Alice Wonder' &&
      profileById.body.user.location === 'London, UK';

    record('11. Public profile lookup by custom User.id returns user data', isStep11Pass, `status: ${profileById.status}, fullName: ${profileById.body?.user?.fullName}`);

    // 12. Public profile by MongoDB _id
    const aliceDoc = await User.findOne({ id: aliceUser.id });
    const profileByMongoId = await makeRequest(server, {
      path: `/api/v1/users/${aliceDoc._id.toString()}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenViewer}` }
    });

    const isStep12Pass = profileByMongoId.status === 200 &&
      profileByMongoId.body.success === true &&
      profileByMongoId.body.user &&
      profileByMongoId.body.user.id === aliceUser.id;

    record('12. Public profile lookup by MongoDB _id resolves target user', isStep12Pass, `status: ${profileByMongoId.status}`);

    // 13. Invalid/nonexistent user returns 404
    const notFoundCustom = await makeRequest(server, {
      path: '/api/v1/users/nonexistent-user-xyz-999',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenViewer}` }
    });

    const notFoundSuspended = await makeRequest(server, {
      path: `/api/v1/users/${carolUser.id}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenViewer}` }
    });

    const isStep13Pass = notFoundCustom.status === 404 && notFoundSuspended.status === 404;
    record('13. Nonexistent and suspended profiles return 404 Not Found', isStep13Pass, `nonexistent: ${notFoundCustom.status}, suspended: ${notFoundSuspended.status}`);

    // 14. Sensitive fields never returned in profile lookup
    const profileData = profileById.body?.user;
    const isStep14Pass = profileData &&
      profileData.passwordHash === undefined &&
      profileData.salt === undefined &&
      profileData.email === undefined &&
      profileData.phone === undefined &&
      profileData.reportsCount === undefined;

    record('14. Public profile endpoint strictly omits sensitive fields (password, email, phone)', !!isStep14Pass, `email: ${profileData?.email}, phone: ${profileData?.phone}`);

    // 15. Existing Auth/Profile/Friends APIs still work
    const meUpdate = await makeRequest(server, {
      path: '/api/v1/users/me',
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenViewer}` }
    }, { fullName: 'Viewer Updated Name' });

    const meOnboard = await makeRequest(server, {
      path: '/api/v1/users/me/onboarding',
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenViewer}` }
    }, { interests: ['Tech & Code', 'Gaming & Esports'] });

    const friendReq = await makeRequest(server, {
      path: '/api/v1/friends/requests',
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenViewer}` }
    }, { recipientId: aliceUser.id, personalNote: 'Hi Alice!' });

    const isStep15Pass = meUpdate.status === 200 &&
      meOnboard.status === 200 &&
      friendReq.status === 201;

    record('15. Regression check: Existing user profile update, onboarding, and friends APIs intact', isStep15Pass, `me: ${meUpdate.status}, onboard: ${meOnboard.status}, friendReq: ${friendReq.status}`);

    // 16. Admin login and routes still work
    const adminLoginRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/login',
      method: 'POST'
    }, {
      email: (config.defaultAdmin && config.defaultAdmin.email) || 'admin@voicefriends.io',
      password: (config.defaultAdmin && config.defaultAdmin.password) || 'AdminPassword123!'
    });

    let adminUsersOk = false;
    if (adminLoginRes.body?.token) {
      const adminUsers = await makeRequest(server, {
        path: '/api/v1/admin/users',
        method: 'GET',
        headers: { Authorization: `Bearer ${adminLoginRes.body.token}` }
      });
      adminUsersOk = adminUsers.status === 200;
    }

    record('16. Admin login and existing admin routes remain 100% functional', adminUsersOk, `admin login: ${adminLoginRes.status}, admin users ok: ${adminUsersOk}`);

    console.log('\n====================================================');
    console.log(`📊 Test Summary: ${results.passed}/${results.total} Passed (${results.failed} Failed)`);
    console.log('====================================================\n');

    return results;
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (!wasConnected && require.main === module) {
      await disconnectDB();
    }
  }
}

if (require.main === module) {
  runDiscoverFlowTests()
    .then((results) => {
      if (results.failed > 0) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('Test execution error:', err);
      process.exit(1);
    });
}

module.exports = runDiscoverFlowTests;
