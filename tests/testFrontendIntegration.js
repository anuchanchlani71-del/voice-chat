const http = require('http');
const assert = require('assert');

// Test the frontend friendApi endpoints against the live backend
const BASE_URL = 'http://localhost:5000/api/v1';

async function apiCall(endpoint, method = 'GET', token = null, body = null) {
  const url = new URL(`${BASE_URL}${endpoint}`);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runFrontendFlowVerification() {
  console.log('====================================================');
  console.log('🧪 Running Frontend API & Integration Flow Verification');
  console.log('====================================================\n');

  const ts = Date.now();
  const userAData = {
    fullName: 'Frontend User A',
    username: `fe_user_a_${ts}`,
    email: `fe_user_a_${ts}@example.com`,
    password: 'Password123!'
  };

  const userBData = {
    fullName: 'Frontend User B',
    username: `fe_user_b_${ts}`,
    email: `fe_user_b_${ts}@example.com`,
    password: 'Password123!'
  };

  const userCData = {
    fullName: 'Frontend User C',
    username: `fe_user_c_${ts}`,
    email: `fe_user_c_${ts}@example.com`,
    password: 'Password123!'
  };

  const results = [];
  function check(label, pass, details = '') {
    if (pass) {
      console.log(`  ✅ [PASS] ${label}`);
      results.push({ label, status: 'PASS', details });
    } else {
      console.error(`  ❌ [FAIL] ${label}: ${details}`);
      results.push({ label, status: 'FAIL', details });
    }
  }

  // 1. Register User A, B, C
  const [regA, regB, regC] = await Promise.all([
    apiCall('/auth/register', 'POST', null, userAData),
    apiCall('/auth/register', 'POST', null, userBData),
    apiCall('/auth/register', 'POST', null, userCData)
  ]);

  const tokenA = regA.body.token;
  const tokenB = regB.body.token;
  const tokenC = regC.body.token;
  const userA = regA.body.user;
  const userB = regB.body.user;
  const userC = regC.body.user;

  check('1. User A, B, and C registered successfully', tokenA && tokenB && tokenC);

  // 2. User A sends request to User B with personalNote
  const sendRes = await apiCall('/friends/requests', 'POST', tokenA, {
    recipientId: userB.id,
    personalNote: 'Hey Bob! Let us connect for late night chats.'
  });

  const reqIdAB = sendRes.body?.request?.id;
  check('2. User A sends request to User B (sendFriendRequest)', sendRes.status === 201 && reqIdAB, `reqId: ${reqIdAB}`);

  // 3. User A simulates page refresh: calls getFriendRequests
  const sentListA = await apiCall('/friends/requests', 'GET', tokenA);
  const inSentA = sentListA.body?.sent?.some(r => r.id === reqIdAB && r.user.id === userB.id);
  check('3. Refresh simulation User A: sent request persists', inSentA, `sent count: ${sentListA.body?.sent?.length}`);

  // 4. User B logs in & opens Requests: calls getFriendRequests
  const incListB = await apiCall('/friends/requests', 'GET', tokenB);
  const foundInB = incListB.body?.incoming?.find(r => r.id === reqIdAB);
  check('4. User B incoming requests list contains User A request with personalNote',
    foundInB && foundInB.personalNote.includes('late night chats') && foundInB.user.id === userA.id,
    `personalNote: "${foundInB?.personalNote}"`
  );

  // 5. Header incoming count badge for User B
  const incomingCountB = incListB.body?.incomingCount;
  check('5. Header incoming request badge for User B shows count = 1', incomingCountB === 1, `count: ${incomingCountB}`);

  // 6. User B accepts the request
  const acceptRes = await apiCall(`/friends/requests/${reqIdAB}/accept`, 'PATCH', tokenB);
  check('6. User B accepts request (acceptFriendRequest)', acceptRes.status === 200 && acceptRes.body?.success, `status: ${acceptRes.status}`);

  // 7. Request disappears from pending incoming for User B
  const incListAfterAcceptB = await apiCall('/friends/requests', 'GET', tokenB);
  check('7. Request disappears from incoming pending list for User B', incListAfterAcceptB.body?.incomingCount === 0);

  // 8. User B calls getFriends: User A appears as friend
  const friendsListB = await apiCall('/friends', 'GET', tokenB);
  const friendAInB = friendsListB.body?.friends?.find(f => f.id === userA.id);
  check('8. User B friends list (/friends) contains User A with complete safe fields',
    friendAInB && friendAInB.id === userA.id && friendAInB.passwordHash === undefined && friendAInB.email === undefined
  );

  // 9. User A calls getFriends after refresh: User B appears as friend
  const friendsListA = await apiCall('/friends', 'GET', tokenA);
  const friendBInA = friendsListA.body?.friends?.find(f => f.id === userB.id);
  check('9. User A friends list (/friends) contains User B after refresh',
    friendBInA && friendBInA.id === userB.id
  );

  // 10. Status between User A and User B is 'friends'
  const statusAB = await apiCall(`/friends/status/${userB.id}`, 'GET', tokenA);
  check('10. Status check (getFriendStatus) returns "friends"', statusAB.body?.status === 'friends');

  // 11. Test Reject: User A sends to User C
  const sendAC = await apiCall('/friends/requests', 'POST', tokenA, { recipientId: userC.id });
  const reqIdAC = sendAC.body?.request?.id;
  const rejectRes = await apiCall(`/friends/requests/${reqIdAC}/reject`, 'PATCH', tokenC);
  const statusAC = await apiCall(`/friends/status/${userC.id}`, 'GET', tokenA);
  check('11. Reject flow: User C rejects and status reverts to "none"',
    rejectRes.status === 200 && statusAC.body?.status === 'none'
  );

  // 12. Test Cancel: User C sends to User A
  const sendCA = await apiCall('/friends/requests', 'POST', tokenC, { recipientId: userA.id });
  const reqIdCA = sendCA.body?.request?.id;
  const cancelRes = await apiCall(`/friends/requests/${reqIdCA}`, 'DELETE', tokenC);
  const statusCA = await apiCall(`/friends/status/${userA.id}`, 'GET', tokenC);
  check('12. Cancel flow: User C cancels and status reverts to "none"',
    cancelRes.status === 200 && statusCA.body?.status === 'none'
  );

  // 13. Test Remove Friend: User A unfriends User B
  const removeRes = await apiCall(`/friends/${userB.id}`, 'DELETE', tokenA);
  const [fListAAfterRemove, fListBAfterRemove] = await Promise.all([
    apiCall('/friends', 'GET', tokenA),
    apiCall('/friends', 'GET', tokenB)
  ]);
  check('13. Remove friend works: both users friends list now empty',
    removeRes.status === 200 && fListAAfterRemove.body?.count === 0 && fListBAfterRemove.body?.count === 0
  );

  // 14. Status returns to 'none' after unfriend
  const statusAfterRemove = await apiCall(`/friends/status/${userB.id}`, 'GET', tokenA);
  check('14. Status check returns "none" after unfriend', statusAfterRemove.body?.status === 'none');

  // 15. Header incoming count badge after unfriend
  const incBAfter = await apiCall('/friends/requests', 'GET', tokenB);
  check('15. Header incoming badge accurately zero when no pending requests', incBAfter.body?.incomingCount === 0);

  const passedCount = results.filter(r => r.status === 'PASS').length;
  console.log('\n====================================================');
  console.log(`📊 Verification Summary: ${passedCount}/${results.length} PASSED`);
  console.log('====================================================\n');

  return {
    total: results.length,
    passed: passedCount,
    failed: results.length - passedCount,
    results
  };
}

if (require.main === module) {
  runFrontendFlowVerification()
    .then(res => process.exit(res.failed > 0 ? 1 : 0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = runFrontendFlowVerification;
