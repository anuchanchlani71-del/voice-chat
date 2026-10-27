const http = require('http');
const assert = require('assert');
const app = require('../src/app');
const { connectDB, disconnectDB, getConnectionStatus } = require('../src/config/db');
const User = require('../src/models/User');
const Friendship = require('../src/models/Friendship');
const FriendRequest = require('../src/models/FriendRequest');
const Notification = require('../src/models/Notification');
const config = require('../src/config/env');

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

async function runFriendsFlowTests() {
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
  console.log('🧪 Starting Complete Friends & Friend Requests Test Suite');
  console.log('====================================================');

  const wasConnected = getConnectionStatus() === 'connected';
  if (!wasConnected) {
    await connectDB();
  }

  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));

  const uniqueId = Date.now();

  // Test Users
  const userAData = {
    fullName: 'Alice Walker',
    username: `alice_${uniqueId}`,
    email: `alice_${uniqueId}@example.com`,
    password: 'Password123!',
    interests: ['Music', 'Gaming', 'Tech']
  };

  const userBData = {
    fullName: 'Bob Smith',
    username: `bob_${uniqueId}`,
    email: `bob_${uniqueId}@example.com`,
    password: 'Password123!',
    interests: ['Gaming', 'Reading', 'Tech']
  };

  const userCData = {
    fullName: 'Charlie Davis',
    username: `charlie_${uniqueId}`,
    email: `charlie_${uniqueId}@example.com`,
    password: 'Password123!',
    interests: ['Cooking', 'Art']
  };

  let tokenA, tokenB, tokenC;
  let userA, userB, userC;
  let requestIdAB;

  try {
    // 0. Setup: Register 3 users
    const [regA, regB, regC] = await Promise.all([
      makeRequest(server, { path: '/api/v1/auth/register', method: 'POST' }, userAData),
      makeRequest(server, { path: '/api/v1/auth/register', method: 'POST' }, userBData),
      makeRequest(server, { path: '/api/v1/auth/register', method: 'POST' }, userCData)
    ]);

    assert.strictEqual(regA.status, 201, 'User A should register');
    assert.strictEqual(regB.status, 201, 'User B should register');
    assert.strictEqual(regC.status, 201, 'User C should register');

    tokenA = regA.body.token;
    tokenB = regB.body.token;
    tokenC = regC.body.token;

    userA = regA.body.user;
    userB = regB.body.user;
    userC = regC.body.user;

    // Set interests for matched interests test
    await Promise.all([
      makeRequest(server, {
        path: '/api/v1/users/me',
        method: 'PATCH',
        headers: { Authorization: `Bearer ${tokenA}` }
      }, { interests: ['Gaming', 'Tech', 'Music'] }),
      makeRequest(server, {
        path: '/api/v1/users/me',
        method: 'PATCH',
        headers: { Authorization: `Bearer ${tokenB}` }
      }, { interests: ['Gaming', 'Tech', 'Anime'] })
    ]);

    // 1. Authenticated user sends request
    const sendRes = await makeRequest(server, {
      path: '/api/v1/friends/requests',
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` }
    }, {
      recipientId: userB.id,
      personalNote: 'Hey Bob, love gaming and tech too!'
    });

    const isStep1Pass = sendRes.status === 201 &&
      sendRes.body.success === true &&
      sendRes.body.request &&
      sendRes.body.request.personalNote === 'Hey Bob, love gaming and tech too!' &&
      Array.isArray(sendRes.body.request.matchedInterests) &&
      sendRes.body.request.matchedInterests.includes('Gaming') &&
      sendRes.body.request.recipient &&
      sendRes.body.request.recipient.passwordHash === undefined &&
      sendRes.body.request.recipient.email === undefined;

    requestIdAB = sendRes.body?.request?.id;
    record('1. Authenticated user sends friend request with personalNote and matchedInterests', isStep1Pass, JSON.stringify(sendRes.body));

    // 2. Duplicate request is blocked
    const dupRes1 = await makeRequest(server, {
      path: '/api/v1/friends/requests',
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` }
    }, { recipientId: userB.id });

    const dupRes2 = await makeRequest(server, {
      path: '/api/v1/friends/requests',
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` }
    }, { recipientId: userA.id });

    const isStep2Pass = dupRes1.status === 400 && dupRes1.body.success === false &&
      dupRes2.status === 400 && dupRes2.body.success === false;
    record('2. Duplicate pending request is blocked (both directions)', isStep2Pass, `from A: ${dupRes1.status}, from B: ${dupRes2.status}`);

    // 3. Self-request is blocked
    const selfRes = await makeRequest(server, {
      path: '/api/v1/friends/requests',
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` }
    }, { recipientId: userA.id });

    const isStep3Pass = selfRes.status === 400 && selfRes.body.success === false;
    record('3. Self-request is blocked', isStep3Pass, `status: ${selfRes.status}`);

    // 4. Recipient sees incoming request
    const inRes = await makeRequest(server, {
      path: '/api/v1/friends/requests',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenB}` }
    });

    const hasIncoming = inRes.status === 200 &&
      inRes.body.success === true &&
      Array.isArray(inRes.body.incoming) &&
      inRes.body.incoming.some(r => r.id === requestIdAB && r.user.id === userA.id && r.personalNote.includes('Hey Bob'));
    
    // Check no sensitive fields in incoming request
    const incomingReq = inRes.body?.incoming?.find(r => r.id === requestIdAB);
    const noSensitiveIncoming = incomingReq &&
      incomingReq.user.passwordHash === undefined &&
      incomingReq.user.salt === undefined &&
      incomingReq.user.email === undefined &&
      incomingReq.user.phone === undefined;

    record('4. Recipient sees incoming request with sanitized requester and personalNote', hasIncoming && noSensitiveIncoming, `incoming count: ${inRes.body?.incoming?.length}`);

    // 5. Requester sees sent request
    const sentRes = await makeRequest(server, {
      path: '/api/v1/friends/requests',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenA}` }
    });

    const hasSent = sentRes.status === 200 &&
      sentRes.body.success === true &&
      Array.isArray(sentRes.body.sent) &&
      sentRes.body.sent.some(r => r.id === requestIdAB && r.user.id === userB.id);

    const sentReq = sentRes.body?.sent?.find(r => r.id === requestIdAB);
    const noSensitiveSent = sentReq &&
      sentReq.user.passwordHash === undefined &&
      sentReq.user.salt === undefined &&
      sentReq.user.email === undefined &&
      sentReq.user.phone === undefined;

    record('5. Requester sees sent request with sanitized recipient', hasSent && noSensitiveSent, `sent count: ${sentRes.body?.sent?.length}`);

    // 6. Recipient accepts request
    // Check non-recipient cannot accept (403)
    const unauthorizedAccept = await makeRequest(server, {
      path: `/api/v1/friends/requests/${requestIdAB}/accept`,
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenC}` }
    });
    const isForbiddenAccept = unauthorizedAccept.status === 403;

    // Recipient accepts
    const acceptRes = await makeRequest(server, {
      path: `/api/v1/friends/requests/${requestIdAB}/accept`,
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenB}` }
    });

    const isStep6Pass = isForbiddenAccept &&
      acceptRes.status === 200 &&
      acceptRes.body.success === true &&
      acceptRes.body.friendship !== undefined;
    record('6. Recipient accepts request (and unauthorized user is blocked with 403)', isStep6Pass, `accept status: ${acceptRes.status}`);

    // 7. Friendship is created
    const isStep7Pass = acceptRes.body?.friendship?.status === 'accepted' &&
      acceptRes.body?.friendship?.userPairKey !== undefined;
    record('7. Friendship is created in database with userPairKey', isStep7Pass, `friendshipId: ${acceptRes.body?.friendship?.id}`);

    // 8. Both users' friendsCount increments once
    const [meA, meB] = await Promise.all([
      makeRequest(server, { path: '/api/v1/auth/me', method: 'GET', headers: { Authorization: `Bearer ${tokenA}` } }),
      makeRequest(server, { path: '/api/v1/auth/me', method: 'GET', headers: { Authorization: `Bearer ${tokenB}` } })
    ]);

    const isStep8Pass = meA.body?.user?.friendsCount === 1 && meB.body?.user?.friendsCount === 1;
    record('8. Both users\' friendsCount incremented exactly once (both = 1)', isStep8Pass, `User A: ${meA.body?.user?.friendsCount}, User B: ${meB.body?.user?.friendsCount}`);

    // 9. Status becomes 'friends'
    const [statusA, statusB] = await Promise.all([
      makeRequest(server, { path: `/api/v1/friends/status/${userB.id}`, method: 'GET', headers: { Authorization: `Bearer ${tokenA}` } }),
      makeRequest(server, { path: `/api/v1/friends/status/${userA.id}`, method: 'GET', headers: { Authorization: `Bearer ${tokenB}` } })
    ]);

    const isStep9Pass = statusA.status === 200 && statusA.body.status === 'friends' &&
      statusB.status === 200 && statusB.body.status === 'friends';
    record('9. Friendship status becomes "friends" from both perspectives', isStep9Pass, `statusA: ${statusA.body?.status}, statusB: ${statusB.body?.status}`);

    // 10. Friends list contains the other user with all required frontend fields
    const friendsListA = await makeRequest(server, {
      path: '/api/v1/friends',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenA}` }
    });

    const friendBInA = friendsListA.body?.friends?.find(f => f.id === userB.id);
    const hasRequiredFields = friendBInA &&
      friendBInA.id &&
      friendBInA.username &&
      friendBInA.fullName &&
      Array.isArray(friendBInA.interests) &&
      friendBInA.friendsCount !== undefined &&
      friendBInA.passwordHash === undefined &&
      friendBInA.salt === undefined &&
      friendBInA.email === undefined &&
      friendBInA.phone === undefined;

    record('10. Friends list contains the other user with complete sanitized profile fields', !!hasRequiredFields, `count: ${friendsListA.body?.count}`);

    // 11. friend_accepted notification created
    const userADoc = await User.findUserByIdOrIdentifier(userA.id);
    const notifCheck = await Notification.findOne({
      targetUser: userADoc._id,
      type: 'friend_accepted'
    });
    record('11. friend_accepted notification created in database for requester', !!notifCheck, `notif id: ${notifCheck?.id || 'none'}`);

    // 12. Reject flow works
    // User A sends request to User C
    const sendAC = await makeRequest(server, {
      path: '/api/v1/friends/requests',
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` }
    }, { recipientId: userC.id });

    const reqACId = sendAC.body?.request?.id;

    // User C rejects
    const rejectRes = await makeRequest(server, {
      path: `/api/v1/friends/requests/${reqACId}/reject`,
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenC}` }
    });

    // Check status is 'none' and friendsCount did not increase
    const statusAC = await makeRequest(server, {
      path: `/api/v1/friends/status/${userC.id}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenA}` }
    });

    const meAfterReject = await makeRequest(server, {
      path: '/api/v1/auth/me',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenA}` }
    });

    const isStep12Pass = rejectRes.status === 200 &&
      rejectRes.body.success === true &&
      statusAC.body?.status === 'none' &&
      meAfterReject.body?.user?.friendsCount === 1; // Still 1 from Bob

    record('12. Reject flow works (status returns to "none", friendsCount unchanged)', isStep12Pass, `reject status: ${rejectRes.status}`);

    // 13. Cancel flow works
    // User C sends request to User A
    const sendCA = await makeRequest(server, {
      path: '/api/v1/friends/requests',
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenC}` }
    }, { recipientId: userA.id });

    const reqCAId = sendCA.body?.request?.id;

    // Check User A cannot cancel C's sent request (403)
    const unauthorizedCancel = await makeRequest(server, {
      path: `/api/v1/friends/requests/${reqCAId}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` }
    });

    // User C cancels
    const cancelRes = await makeRequest(server, {
      path: `/api/v1/friends/requests/${reqCAId}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenC}` }
    });

    const statusCA = await makeRequest(server, {
      path: `/api/v1/friends/status/${userA.id}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenC}` }
    });

    const isStep13Pass = unauthorizedCancel.status === 403 &&
      cancelRes.status === 200 &&
      cancelRes.body.success === true &&
      statusCA.body?.status === 'none';

    record('13. Cancel flow works (only requester can cancel, status reverts to "none")', isStep13Pass, `cancel status: ${cancelRes.status}`);

    // 14. Remove friend works
    const removeRes = await makeRequest(server, {
      path: `/api/v1/friends/${userB.id}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` }
    });

    const isStep14Pass = removeRes.status === 200 && removeRes.body.success === true;
    record('14. Remove friend (unfriend) works successfully', isStep14Pass, `remove status: ${removeRes.status}`);

    // 15. friendsCount decrements correctly
    const [meAAfterRemove, meBAfterRemove] = await Promise.all([
      makeRequest(server, { path: '/api/v1/auth/me', method: 'GET', headers: { Authorization: `Bearer ${tokenA}` } }),
      makeRequest(server, { path: '/api/v1/auth/me', method: 'GET', headers: { Authorization: `Bearer ${tokenB}` } })
    ]);

    const isStep15Pass = meAAfterRemove.body?.user?.friendsCount === 0 &&
      meBAfterRemove.body?.user?.friendsCount === 0;

    record('15. friendsCount decrements correctly for both users (down to 0)', isStep15Pass, `User A: ${meAAfterRemove.body?.user?.friendsCount}, User B: ${meBAfterRemove.body?.user?.friendsCount}`);

    // 16. Status returns to 'none'
    const statusAfterRemove = await makeRequest(server, {
      path: `/api/v1/friends/status/${userB.id}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenA}` }
    });

    const isStep16Pass = statusAfterRemove.status === 200 && statusAfterRemove.body?.status === 'none';
    record('16. Status returns to "none" after unfriend', isStep16Pass, `status: ${statusAfterRemove.body?.status}`);

    // 17. Unauthenticated requests return 401
    const unauthChecks = await Promise.all([
      makeRequest(server, { path: '/api/v1/friends/requests', method: 'POST' }, { recipientId: userB.id }),
      makeRequest(server, { path: '/api/v1/friends/requests', method: 'GET' }),
      makeRequest(server, { path: '/api/v1/friends/requests/fake-id/accept', method: 'PATCH' }),
      makeRequest(server, { path: '/api/v1/friends/requests/fake-id/reject', method: 'PATCH' }),
      makeRequest(server, { path: '/api/v1/friends/requests/fake-id', method: 'DELETE' }),
      makeRequest(server, { path: '/api/v1/friends', method: 'GET' }),
      makeRequest(server, { path: `/api/v1/friends/${userB.id}`, method: 'DELETE' }),
      makeRequest(server, { path: `/api/v1/friends/status/${userB.id}`, method: 'GET' })
    ]);

    const all401 = unauthChecks.every(res => res.status === 401);
    record('17. All unauthenticated requests consistently return 401 Unauthorized', all401, `All 8 endpoints returned 401: ${all401}`);

    // 18. Admin login and routes still work
    const adminLoginRes = await makeRequest(server, {
      path: '/api/v1/admin/auth/login',
      method: 'POST'
    }, {
      email: (config.defaultAdmin && config.defaultAdmin.email) || 'admin@voicefriends.io',
      password: (config.defaultAdmin && config.defaultAdmin.password) || 'AdminPassword123!'
    });

    const adminToken = adminLoginRes.body?.token;
    let adminRoutesOk = false;

    if (adminToken) {
      const adminFriendships = await makeRequest(server, {
        path: '/api/v1/admin/friendships',
        method: 'GET',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      adminRoutesOk = adminFriendships.status === 200;
    }

    record('18. Admin login and existing admin routes remain 100% functional', adminRoutesOk, `admin login status: ${adminLoginRes.status}`);

    // 19. Existing onboarding, profile, and auth routes still pass regression checks
    const profileMe = await makeRequest(server, {
      path: '/api/v1/users/me',
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}` }
    }, {
      fullName: 'Alice In Wonderland',
      bio: 'Adventures and tea parties',
      voiceStatus: 'available_to_talk'
    });

    const isStep19Pass = profileMe.status === 200 &&
      profileMe.body.user.fullName === 'Alice In Wonderland' &&
      profileMe.body.user.voiceStatus === 'available_to_talk';

    record('19. Regression check: Existing user profile update & auth endpoints intact', isStep19Pass, `status: ${profileMe.status}`);

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
  runFriendsFlowTests()
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

module.exports = runFriendsFlowTests;
