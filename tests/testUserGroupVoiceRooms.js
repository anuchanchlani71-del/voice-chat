const http = require('http');
const app = require('../src/app');
const { connectDB, disconnectDB } = require('../src/config/db');
const User = require('../src/models/User');
const GroupVoiceRoom = require('../src/models/GroupVoiceRoom');
const Block = require('../src/models/Block');
const { signToken } = require('../src/utils/tokenUtils');

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

async function runUserGroupVoiceRoomsTests() {
  console.log('====================================================');
  console.log('🧪 Starting User Group Voice Rooms Backend Test Suite');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Setup DB Connection & Test Users
    console.log('--- TEST 1: Database Setup & Test User Creation ---');
    await connectDB();
    assert(true, 'MongoDB connected successfully');

    // Clean test collections
    await User.deleteMany({ username: { $regex: /^test_gvr_/ } });
    await GroupVoiceRoom.deleteMany({ title: { $regex: /^Test GVR / } });

    // Create Test Users
    const userHostDoc = await User.create({
      id: `usr_${Date.now()}_host`,
      username: 'test_gvr_host',
      email: 'test_gvr_host@example.com',
      fullName: 'Host User',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'active',
      isBlocked: false,
      interests: ['Music', 'Tech']
    });

    const userGuestDoc = await User.create({
      id: `usr_${Date.now()}_guest`,
      username: 'test_gvr_guest',
      email: 'test_gvr_guest@example.com',
      fullName: 'Guest User',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'active',
      isBlocked: false
    });

    const userInvitedDoc = await User.create({
      id: `usr_${Date.now()}_invited`,
      username: 'test_gvr_invited',
      email: 'test_gvr_invited@example.com',
      fullName: 'Invited User',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'active',
      isBlocked: false
    });

    const userBlockedDoc = await User.create({
      id: `usr_${Date.now()}_blocked`,
      username: 'test_gvr_blocked',
      email: 'test_gvr_blocked@example.com',
      fullName: 'Blocked User',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'active',
      isBlocked: false
    });

    const userSuspendedDoc = await User.create({
      id: `usr_${Date.now()}_suspended`,
      username: 'test_gvr_suspended',
      email: 'test_gvr_suspended@example.com',
      fullName: 'Suspended User',
      passwordHash: 'hash123',
      salt: 'salt123',
      accountStatus: 'suspended',
      isBlocked: true
    });

    // Create block relationship between Host and Blocked User
    await Block.deleteMany({
      $or: [
        { blockedBy: userHostDoc._id },
        { blockedUser: userHostDoc._id }
      ]
    });
    await Block.create({
      blockedBy: userHostDoc._id,
      blockedUser: userBlockedDoc._id,
      status: 'active',
      reason: 'Testing block behavior in rooms'
    });

    const hostToken = signToken({ id: userHostDoc.id, email: userHostDoc.email });
    const guestToken = signToken({ id: userGuestDoc.id, email: userGuestDoc.email });
    const invitedToken = signToken({ id: userInvitedDoc.id, email: userInvitedDoc.email });
    const blockedToken = signToken({ id: userBlockedDoc.id, email: userBlockedDoc.email });
    const suspendedToken = signToken({ id: userSuspendedDoc.id, email: userSuspendedDoc.email });

    const hostHeaders = { Authorization: `Bearer ${hostToken}` };
    const guestHeaders = { Authorization: `Bearer ${guestToken}` };
    const invitedHeaders = { Authorization: `Bearer ${invitedToken}` };
    const blockedHeaders = { Authorization: `Bearer ${blockedToken}` };
    const suspendedHeaders = { Authorization: `Bearer ${suspendedToken}` };

    // 2. Start HTTP Server
    const server = http.createServer(app.callback());
    await new Promise((resolve) => server.listen(0, resolve));

    console.log('\n--- TEST 2: Authentication Guard ---');
    const unauthRes = await makeRequest(server, { path: '/api/v1/rooms', method: 'GET' });
    assert(unauthRes.status === 401, 'Unauthenticated request to GET /rooms returns 401');

    const malformedRes = await makeRequest(server, {
      path: '/api/v1/rooms',
      method: 'GET',
      headers: { Authorization: 'Bearer bad_token_999' }
    });
    assert(malformedRes.status === 401, 'Malformed token returns 401');

    console.log('\n--- TEST 3: Validation Errors on Room Creation ---');
    // Missing Title
    const noTitleRes = await makeRequest(server, {
      path: '/api/v1/rooms',
      method: 'POST',
      headers: hostHeaders
    }, { topic: 'Music' });
    assert(noTitleRes.status === 400, 'Missing title returns 400');

    // Invalid accessType (e.g. friends_only)
    const invalidAccessRes = await makeRequest(server, {
      path: '/api/v1/rooms',
      method: 'POST',
      headers: hostHeaders
    }, { title: 'Test GVR Invalid Access', accessType: 'friends_only' });
    assert(invalidAccessRes.status === 400, 'Prohibited accessType "friends_only" returns 400 validation error');

    // Invalid Capacity (< 2)
    const lowCapRes = await makeRequest(server, {
      path: '/api/v1/rooms',
      method: 'POST',
      headers: hostHeaders
    }, { title: 'Test GVR Low Cap', capacity: 1 });
    assert(lowCapRes.status === 400, 'Capacity < 2 returns 400 validation error');

    // Invalid Capacity (> 100)
    const highCapRes = await makeRequest(server, {
      path: '/api/v1/rooms',
      method: 'POST',
      headers: hostHeaders
    }, { title: 'Test GVR High Cap', capacity: 150 });
    assert(highCapRes.status === 400, 'Capacity > 100 returns 400 validation error');

    console.log('\n--- TEST 4: Create Anyone Room ---');
    const anyoneRoomRes = await makeRequest(server, {
      path: '/api/v1/rooms',
      method: 'POST',
      headers: hostHeaders
    }, {
      title: 'Test GVR Open Jam Session',
      description: 'Jamming with friends and anyone interested',
      topic: 'Music & Jamming',
      accessType: 'anyone',
      capacity: 5
    });

    assert(anyoneRoomRes.status === 201, 'Create "anyone" room returns 201');
    assert(anyoneRoomRes.body.groupVoiceRoom && anyoneRoomRes.body.groupVoiceRoom.accessType === 'anyone', 'Room created with accessType="anyone"');
    const anyoneRoomId = anyoneRoomRes.body.groupVoiceRoom.id;

    console.log('\n--- TEST 5: Create Invite-Only Room ---');
    const inviteRoomRes = await makeRequest(server, {
      path: '/api/v1/rooms',
      method: 'POST',
      headers: hostHeaders
    }, {
      title: 'Test GVR VIP Secret Room',
      description: 'Private hangout for invited guests',
      topic: 'Private Talk',
      accessType: 'invite_only',
      capacity: 3,
      invitedUsers: [userInvitedDoc.id]
    });

    assert(inviteRoomRes.status === 201, 'Create "invite_only" room returns 201');
    assert(inviteRoomRes.body.groupVoiceRoom && inviteRoomRes.body.groupVoiceRoom.accessType === 'invite_only', 'Room created with accessType="invite_only"');
    const inviteRoomId = inviteRoomRes.body.groupVoiceRoom.id;

    console.log('\n--- TEST 6: Room Discovery & Listing ---');
    const guestListRes = await makeRequest(server, {
      path: '/api/v1/rooms',
      method: 'GET',
      headers: guestHeaders
    });
    assert(guestListRes.status === 200, 'Guest list rooms returns 200');
    const visibleRoomIds = guestListRes.body.groupVoiceRooms.map(r => r.id);
    assert(visibleRoomIds.includes(anyoneRoomId), 'Guest can see "anyone" room in discovery');
    assert(!visibleRoomIds.includes(inviteRoomId), 'Guest CANNOT see un-invited "invite_only" room in discovery');

    // Invited user list rooms
    const invitedListRes = await makeRequest(server, {
      path: '/api/v1/rooms',
      method: 'GET',
      headers: invitedHeaders
    });
    const invitedVisibleRoomIds = invitedListRes.body.groupVoiceRooms.map(r => r.id);
    assert(invitedVisibleRoomIds.includes(inviteRoomId), 'Invited user CAN see "invite_only" room in discovery');

    console.log('\n--- TEST 7: Single Room Details (/rooms/:id & /rooms/room/:id) ---');
    const roomDetailRes = await makeRequest(server, {
      path: `/api/v1/rooms/${anyoneRoomId}`,
      method: 'GET',
      headers: guestHeaders
    });
    assert(roomDetailRes.status === 200, 'GET /rooms/:id returns 200');
    assert(roomDetailRes.body.groupVoiceRoom.id === anyoneRoomId, 'Returns matching room data');

    const altDetailRes = await makeRequest(server, {
      path: `/api/v1/rooms/room/${anyoneRoomId}`,
      method: 'GET',
      headers: guestHeaders
    });
    assert(altDetailRes.status === 200, 'GET /rooms/room/:id returns 200');

    console.log('\n--- TEST 8: Join Anyone Room ---');
    const joinAnyoneRes = await makeRequest(server, {
      path: `/api/v1/rooms/${anyoneRoomId}/join`,
      method: 'POST',
      headers: guestHeaders
    });
    assert(joinAnyoneRes.status === 200, 'Guest joins "anyone" room returns 200');
    assert(joinAnyoneRes.body.groupVoiceRoom.participantCount >= 2, 'Participant count incremented');

    console.log('\n--- TEST 9: Join Invite-Only Room (Authorization Check) ---');
    // Unauthorized guest attempt
    const unauthJoinRes = await makeRequest(server, {
      path: `/api/v1/rooms/${inviteRoomId}/join`,
      method: 'POST',
      headers: guestHeaders
    });
    assert(unauthJoinRes.status === 403, 'Uninvited guest join attempt rejected with 403');

    // Invited user attempt
    const invitedJoinRes = await makeRequest(server, {
      path: `/api/v1/rooms/${inviteRoomId}/join`,
      method: 'POST',
      headers: invitedHeaders
    });
    assert(invitedJoinRes.status === 200, 'Invited user join attempt succeeds with 200');

    console.log('\n--- TEST 10: Capacity Overflow Handling ---');
    // Create room with capacity = 2
    const smallRoomRes = await makeRequest(server, {
      path: '/api/v1/rooms',
      method: 'POST',
      headers: hostHeaders
    }, {
      title: 'Test GVR Tiny Room',
      capacity: 2,
      accessType: 'anyone'
    });
    const smallRoomId = smallRoomRes.body.groupVoiceRoom.id;

    // Join guest 1 (capacity filled: host=1, guest1=1 -> 2)
    await makeRequest(server, {
      path: `/api/v1/rooms/${smallRoomId}/join`,
      method: 'POST',
      headers: guestHeaders
    });

    // Try joining guest 2 (invitedUser) when room is full (capacity=2)
    const overflowRes = await makeRequest(server, {
      path: `/api/v1/rooms/${smallRoomId}/join`,
      method: 'POST',
      headers: invitedHeaders
    });
    assert(overflowRes.status === 400, 'Join full room rejected with 400 capacity overflow error');

    console.log('\n--- TEST 11: Leave Room ---');
    const leaveRes = await makeRequest(server, {
      path: `/api/v1/rooms/${anyoneRoomId}/leave`,
      method: 'POST',
      headers: guestHeaders
    });
    assert(leaveRes.status === 200, 'Leave room returns 200');

    console.log('\n--- TEST 12: Host Update Permissions & Status Restrictions ---');
    // Non-host edit attempt -> 403
    const nonHostEditRes = await makeRequest(server, {
      path: `/api/v1/rooms/${anyoneRoomId}`,
      method: 'PATCH',
      headers: guestHeaders
    }, { title: 'Hacked Title' });
    assert(nonHostEditRes.status === 403, 'Non-host room update rejected with 403');

    // Host edit -> 200
    const hostEditRes = await makeRequest(server, {
      path: `/api/v1/rooms/${anyoneRoomId}`,
      method: 'PATCH',
      headers: hostHeaders
    }, { title: 'Test GVR Updated Title', topic: 'Updated Topic' });
    assert(hostEditRes.status === 200, 'Host room update returns 200');
    assert(hostEditRes.body.groupVoiceRoom.title === 'Test GVR Updated Title', 'Room title updated in DB');

    console.log('\n--- TEST 13: Host Invite Users API ---');
    // Host invites guest user to invite_only room
    const inviteApiRes = await makeRequest(server, {
      path: `/api/v1/rooms/${inviteRoomId}/invite`,
      method: 'POST',
      headers: hostHeaders
    }, { targetUserId: userGuestDoc.id });
    assert(inviteApiRes.status === 200, 'Host invite user returns 200');

    // Now guest user can join
    const guestNowJoinsRes = await makeRequest(server, {
      path: `/api/v1/rooms/${inviteRoomId}/join`,
      method: 'POST',
      headers: guestHeaders
    });
    assert(guestNowJoinsRes.status === 200, 'Newly invited guest can join room');

    console.log('\n--- TEST 14: Room Members / Participants API ---');
    const membersRes = await makeRequest(server, {
      path: `/api/v1/rooms/${inviteRoomId}/members`,
      method: 'GET',
      headers: hostHeaders
    });
    assert(membersRes.status === 200, 'GET room members returns 200');
    assert(membersRes.body.members && membersRes.body.members.host.username === 'test_gvr_host', 'Host info included in members');
    assert(membersRes.body.members.host.passwordHash === undefined, 'Host passwordHash is sanitized');
    assert(membersRes.body.members.host.email === undefined, 'Private email is sanitized');

    console.log('\n--- TEST 15: End / Close Room ---');
    // Non-host end attempt -> 403
    const nonHostEndRes = await makeRequest(server, {
      path: `/api/v1/rooms/${anyoneRoomId}/close`,
      method: 'POST',
      headers: guestHeaders
    });
    assert(nonHostEndRes.status === 403, 'Non-host close attempt rejected with 403');

    // Host end room -> 200
    const hostEndRes = await makeRequest(server, {
      path: `/api/v1/rooms/${anyoneRoomId}/close`,
      method: 'POST',
      headers: hostHeaders
    });
    assert(hostEndRes.status === 200, 'Host close room returns 200');
    assert(hostEndRes.body.groupVoiceRoom.status === 'closed', 'Room status updated to "closed"');

    // Cannot join closed room -> 400
    const joinClosedRes = await makeRequest(server, {
      path: `/api/v1/rooms/${anyoneRoomId}/join`,
      method: 'POST',
      headers: guestHeaders
    });
    assert(joinClosedRes.status === 400, 'Joining closed room rejected with 400');

    console.log('\n--- TEST 16: Blocked User Restrictions ---');
    // Blocked user tries to list/get host's room -> Blocked user cannot access or view
    const blockedGetRes = await makeRequest(server, {
      path: `/api/v1/rooms/${inviteRoomId}`,
      method: 'GET',
      headers: blockedHeaders
    });
    assert(blockedGetRes.status === 403, 'Blocked user cannot access host room (HTTP 403)');

    // Host tries to invite blocked user -> Blocked user filtered out
    const inviteBlockedRes = await makeRequest(server, {
      path: `/api/v1/rooms/${inviteRoomId}/invite`,
      method: 'POST',
      headers: hostHeaders
    }, { targetUserId: userBlockedDoc.id });
    assert(inviteBlockedRes.body.invitedUsers.length === 0, 'Blocked user is NOT added to room invites');

    console.log('\n--- TEST 17: Suspended / Inactive User Restrictions ---');
    // Suspended user tries to create room -> 403
    const suspendedCreateRes = await makeRequest(server, {
      path: '/api/v1/rooms',
      method: 'POST',
      headers: suspendedHeaders
    }, { title: 'Suspended User Room' });
    assert(suspendedCreateRes.status === 403, 'Suspended user cannot create room (HTTP 403)');

    // Suspended user tries to join room -> 403
    const suspendedJoinRes = await makeRequest(server, {
      path: `/api/v1/rooms/${inviteRoomId}/join`,
      method: 'POST',
      headers: suspendedHeaders
    });
    assert(suspendedJoinRes.status === 403, 'Suspended user cannot join room (HTTP 403)');

    // Clean up test data
    await User.deleteMany({ username: { $regex: /^test_gvr_/ } });
    await GroupVoiceRoom.deleteMany({ title: { $regex: /^Test GVR / } });

    server.close();
    await disconnectDB();

    console.log('\n====================================================');
    console.log(`📊 User Group Voice Rooms Test Results: ${passed} Passed, ${failed} Failed`);
    console.log('====================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Test suite failed with error:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  runUserGroupVoiceRoomsTests();
}

module.exports = { runUserGroupVoiceRoomsTests };
