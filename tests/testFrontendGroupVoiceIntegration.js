const http = require('http');
const app = require('../src/app');
const { connectDB, disconnectDB } = require('../src/config/db');

let serverInstance = null;
let dynamicPort = 5000;

async function apiCall(endpoint, method = 'GET', token = null, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: dynamicPort,
      path: `/api/v1${endpoint}`,
      method,
      agent: false,
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'close',
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

async function runFrontendGroupVoiceIntegration() {
  console.log('====================================================');
  console.log('🧪 Starting Frontend Group Voice Rooms Integration Test');
  console.log('====================================================\n');

  await connectDB();
  serverInstance = http.createServer(app.callback());
  await new Promise((resolve) => serverInstance.listen(0, resolve));
  const port = serverInstance.address().port;
  dynamicPort = port;

  const ts = Date.now();
  const userAData = {
    fullName: 'Host User A',
    username: `fe_gvr_a_${ts}`,
    email: `fe_gvr_a_${ts}@example.com`,
    password: 'Password123!'
  };

  const userBData = {
    fullName: 'Guest User B',
    username: `fe_gvr_b_${ts}`,
    email: `fe_gvr_b_${ts}@example.com`,
    password: 'Password123!'
  };

  const userCData = {
    fullName: 'Guest User C',
    username: `fe_gvr_c_${ts}`,
    email: `fe_gvr_c_${ts}@example.com`,
    password: 'Password123!'
  };

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      failed++;
    }
  }

  try {
    // 1. Register User A, B, C
    const regA = await apiCall('/auth/register', 'POST', null, userAData);
    const regB = await apiCall('/auth/register', 'POST', null, userBData);
    const regC = await apiCall('/auth/register', 'POST', null, userCData);

    const tokenA = regA.body.token;
    const tokenB = regB.body.token;
    const tokenC = regC.body.token;
    const userA = regA.body.user;
    const userB = regB.body.user;
    const userC = regC.body.user;

    assert(tokenA && tokenB && tokenC, '1. User A, B, and C registered successfully');

    // 2. User A creates an "anyone" Group Voice Room (POST /api/v1/rooms)
    const createRes = await apiCall('/rooms', 'POST', tokenA, {
      title: 'Frontend Open Stage Lounge',
      description: 'Public community voice hangout for frontend integration test',
      topic: 'Tech & Code',
      capacity: 10,
      accessType: 'anyone',
      status: 'active'
    });

    assert(createRes.status === 201 && createRes.body.success, '2. User A creates room successfully via POST /rooms');
    const roomId = createRes.body.groupVoiceRoom.id;
    assert(roomId && createRes.body.groupVoiceRoom.accessType === 'anyone', 'Room created with valid custom ID and accessType="anyone"');

    // 3. User B lists rooms (GET /api/v1/rooms)
    const listRes = await apiCall('/rooms', 'GET', tokenB);
    assert(listRes.status === 200 && Array.isArray(listRes.body.groupVoiceRooms), '3. User B lists available rooms via GET /rooms');
    const foundInList = listRes.body.groupVoiceRooms.some(r => r.id === roomId);
    assert(foundInList, 'Newly created room is discoverable in User B lounge listing');

    // 4. User B gets room details (GET /api/v1/rooms/:id)
    const detailRes = await apiCall(`/rooms/${roomId}`, 'GET', tokenB);
    assert(detailRes.status === 200 && detailRes.body.groupVoiceRoom.id === roomId, '4. User B retrieves room details via GET /rooms/:id');
    assert(detailRes.body.groupVoiceRoom.host.username === userA.username, 'Room host matches User A username');

    // 5. User B joins room (POST /api/v1/rooms/:id/join)
    const joinRes = await apiCall(`/rooms/${roomId}/join`, 'POST', tokenB);
    assert(joinRes.status === 200 && joinRes.body.success, '5. User B joins room stage via POST /rooms/:id/join');
    assert(joinRes.body.groupVoiceRoom.participantCount >= 2, 'Participant count incremented');

    // 6. User A (host) updates room details (PATCH /api/v1/rooms/:id)
    const updateRes = await apiCall(`/rooms/${roomId}`, 'PATCH', tokenA, {
      title: 'Updated Tech Lounge Stage',
      topic: 'AI & Web Dev'
    });
    assert(updateRes.status === 200 && updateRes.body.groupVoiceRoom.title === 'Updated Tech Lounge Stage', '6. Host User A updates room details via PATCH /rooms/:id');

    // 7. User B leaves room (POST /api/v1/rooms/:id/leave)
    const leaveRes = await apiCall(`/rooms/${roomId}/leave`, 'POST', tokenB);
    assert(leaveRes.status === 200 && leaveRes.body.success, '7. User B leaves room via POST /rooms/:id/leave');

    // 8. User A creates an invite_only room and invites User B (POST /api/v1/rooms & /invite)
    const privateRoomRes = await apiCall('/rooms', 'POST', tokenA, {
      title: 'Private VIP Lounge',
      accessType: 'invite_only',
      capacity: 5
    });
    const privateRoomId = privateRoomRes.body.groupVoiceRoom.id;

    // User C (uninvited) tries to join -> 403
    const unauthJoin = await apiCall(`/rooms/${privateRoomId}/join`, 'POST', tokenC);
    assert(unauthJoin.status === 403, '8a. Uninvited User C join attempt rejected with 403 Forbidden');

    // Host invites User B
    const inviteRes = await apiCall(`/rooms/${privateRoomId}/invite`, 'POST', tokenA, {
      targetUserId: userB.id
    });
    assert(inviteRes.status === 200 && inviteRes.body.success, '8b. Host User A invites User B via POST /rooms/:id/invite');

    // User B joins private room
    const privateJoinRes = await apiCall(`/rooms/${privateRoomId}/join`, 'POST', tokenB);
    assert(privateJoinRes.status === 200, '8c. Invited User B joins private room successfully');

    // 9. Fetch members (GET /api/v1/rooms/:id/members)
    const membersRes = await apiCall(`/rooms/${privateRoomId}/members`, 'GET', tokenB);
    assert(membersRes.status === 200 && membersRes.body.members, '9. GET /rooms/:id/members returns room members');
    assert(membersRes.body.members.host.username === userA.username, 'Members payload contains sanitized host info');

    // 10. Host User A closes room (POST /api/v1/rooms/:id/close)
    const closeRes = await apiCall(`/rooms/${privateRoomId}/close`, 'POST', tokenA);
    assert(closeRes.status === 200 && closeRes.body.groupVoiceRoom.status === 'closed', '10. Host User A closes room via POST /rooms/:id/close');

    console.log('\n====================================================');
    console.log(`📊 Frontend Integration Results: ${passed} Passed, ${failed} Failed`);
    console.log('====================================================\n');

    if (serverInstance) serverInstance.close();
    await disconnectDB();

    if (failed > 0) process.exit(1);
  } catch (err) {
    if (serverInstance) serverInstance.close();
    await disconnectDB();
    console.error('❌ Integration test error:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  runFrontendGroupVoiceIntegration();
}

module.exports = runFrontendGroupVoiceIntegration;
