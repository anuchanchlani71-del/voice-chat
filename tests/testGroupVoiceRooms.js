const http = require('http');
const app = require('../src/app');
const config = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const { seedDefaultAdmin } = require('../src/seed/seedAdmin');
const { seedDemoData } = require('../src/seed/demoSeed');
const GroupVoiceRoom = require('../src/models/GroupVoiceRoom');
const User = require('../src/models/User');
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

async function runGroupVoiceRoomTests() {
  console.log('====================================================');
  console.log('🧪 Starting Group Voice Rooms Backend Independent Test Suite');
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
    // 1. Database Connection
    console.log('--- TEST 1: MongoDB Connection & Seeding ---');
    await connectDB();
    assert(true, 'MongoDB connected successfully');

    const admin = await seedDefaultAdmin();
    assert(admin && admin.email, 'Admin verified');
    const adminToken = signToken({ id: admin.id, email: admin.email, role: admin.role });

    // Seed demo data to have users & rooms
    await seedDemoData();
    assert(true, 'Demo seed executed with Group Voice Rooms');

    // 2. Start HTTP server on ephemeral port
    const server = http.createServer(app.callback());
    await new Promise((resolve) => server.listen(0, resolve));
    const authHeaders = { Authorization: `Bearer ${adminToken}` };

    console.log('\n--- TEST 2: Authentication & Authorization Guard ---');
    // Unauthenticated request should fail (401)
    const unauthRes = await makeRequest(server, {
      path: '/api/v1/admin/group-voice-rooms',
      method: 'GET'
    });
    assert(unauthRes.status === 401, 'Unauthenticated request rejected with HTTP 401');

    // Malformed token should fail (401)
    const malformedRes = await makeRequest(server, {
      path: '/api/v1/admin/group-voice-rooms',
      method: 'GET',
      headers: { Authorization: 'Bearer invalid_token_123' }
    });
    assert(malformedRes.status === 401, 'Malformed token request rejected with HTTP 401');

    console.log('\n--- TEST 3: GET /api/v1/admin/group-voice-rooms (List & Metrics) ---');
    const listRes = await makeRequest(server, {
      path: '/api/v1/admin/group-voice-rooms',
      method: 'GET',
      headers: authHeaders
    });
    assert(listRes.status === 200, 'GET rooms returns HTTP 200');
    assert(listRes.body.success === true, 'Response success is true');
    assert(Array.isArray(listRes.body.groupVoiceRooms), 'Returns groupVoiceRooms array');
    assert(listRes.body.pagination && listRes.body.pagination.totalItems > 0, 'Pagination metadata returned with totalItems > 0');
    assert(listRes.body.counts && typeof listRes.body.counts.total === 'number', 'Returns aggregate counts (total, active, anyone, inviteOnly)');
    assert(listRes.body.counts.anyone > 0, 'Counts include "anyone" rooms');
    assert(listRes.body.counts.inviteOnly > 0, 'Counts include "inviteOnly" rooms');

    console.log('\n--- TEST 4: Search Filtering (Title / Topic / Host) ---');
    const searchRes = await makeRequest(server, {
      path: '/api/v1/admin/group-voice-rooms?search=Guitar',
      method: 'GET',
      headers: authHeaders
    });
    assert(searchRes.status === 200, 'Search by title keyword returns 200');
    assert(searchRes.body.groupVoiceRooms.some(r => r.title.includes('Guitar')), 'Search result contains matching room title');

    console.log('\n--- TEST 5: Access Type Filtering (Strictly Anyone vs Invite Only) ---');
    // Anyone filter
    const anyoneRes = await makeRequest(server, {
      path: '/api/v1/admin/group-voice-rooms?accessType=anyone',
      method: 'GET',
      headers: authHeaders
    });
    assert(anyoneRes.status === 200, 'AccessType "anyone" filter returns 200');
    assert(anyoneRes.body.groupVoiceRooms.every(r => r.accessType === 'anyone'), 'All returned rooms have accessType="anyone"');

    // Invite Only filter
    const inviteRes = await makeRequest(server, {
      path: '/api/v1/admin/group-voice-rooms?accessType=invite_only',
      method: 'GET',
      headers: authHeaders
    });
    assert(inviteRes.status === 200, 'AccessType "invite_only" filter returns 200');
    assert(inviteRes.body.groupVoiceRooms.every(r => r.accessType === 'invite_only'), 'All returned rooms have accessType="invite_only"');

    console.log('\n--- TEST 6: Status Filtering (active / scheduled / ended / closed) ---');
    const activeRes = await makeRequest(server, {
      path: '/api/v1/admin/group-voice-rooms?status=active',
      method: 'GET',
      headers: authHeaders
    });
    assert(activeRes.status === 200, 'Status "active" filter returns 200');
    assert(activeRes.body.groupVoiceRooms.every(r => r.status === 'active'), 'All returned rooms are active');

    console.log('\n--- TEST 7: GET /api/v1/admin/group-voice-rooms/:id (Room Details) ---');
    const targetRoom = listRes.body.groupVoiceRooms[0];
    const detailRes = await makeRequest(server, {
      path: `/api/v1/admin/group-voice-rooms/${targetRoom.id}`,
      method: 'GET',
      headers: authHeaders
    });
    assert(detailRes.status === 200, 'GET room details returns 200');
    assert(detailRes.body.groupVoiceRoom && detailRes.body.groupVoiceRoom.id === targetRoom.id, 'Returns matching room detail');
    assert(detailRes.body.groupVoiceRoom.host && detailRes.body.groupVoiceRoom.host.fullName, 'Host populated with user details');

    // Non-existent ID returns 404
    const notFoundRes = await makeRequest(server, {
      path: '/api/v1/admin/group-voice-rooms/gvr_non_existent_999',
      method: 'GET',
      headers: authHeaders
    });
    assert(notFoundRes.status === 404, 'Non-existent room ID returns HTTP 404');

    console.log('\n--- TEST 8: PATCH /api/v1/admin/group-voice-rooms/:id/status (Moderation Close/Disable) ---');
    const patchRes = await makeRequest(server, {
      path: `/api/v1/admin/group-voice-rooms/${targetRoom.id}/status`,
      method: 'PATCH',
      headers: authHeaders
    }, { status: 'closed' });

    assert(patchRes.status === 200, 'PATCH status to "closed" returns 200');
    assert(patchRes.body.groupVoiceRoom && patchRes.body.groupVoiceRoom.status === 'closed', 'Room status updated to closed in DB');
    assert(patchRes.body.groupVoiceRoom.participantCount === 0, 'Participant count reset to 0 upon room closure');

    // Rejecting invalid status
    const invalidStatusRes = await makeRequest(server, {
      path: `/api/v1/admin/group-voice-rooms/${targetRoom.id}/status`,
      method: 'PATCH',
      headers: authHeaders
    }, { status: 'invalid_status_xyz' });
    assert(invalidStatusRes.status === 400, 'Invalid status update rejected with HTTP 400');

    console.log('\n--- TEST 9: DELETE /api/v1/admin/group-voice-rooms/:id (Removal Safety Rules) ---');
    // 1. Try to delete an active room without closing first -> should reject with 400
    const activeRoom = listRes.body.groupVoiceRooms.find(r => r.id !== targetRoom.id && r.status === 'active');
    if (activeRoom) {
      const deleteActiveRes = await makeRequest(server, {
        path: `/api/v1/admin/group-voice-rooms/${activeRoom.id}`,
        method: 'DELETE',
        headers: authHeaders
      });
      assert(deleteActiveRes.status === 400, 'Direct deletion of ACTIVE room rejected with HTTP 400 (safety rule)');
    }

    // 2. Delete the closed room -> should succeed with 200 (soft delete)
    const deleteClosedRes = await makeRequest(server, {
      path: `/api/v1/admin/group-voice-rooms/${targetRoom.id}`,
      method: 'DELETE',
      headers: authHeaders
    });
    assert(deleteClosedRes.status === 200, 'Deleting closed room returns HTTP 200');

    // 3. Verifying room is no longer returned in active list
    const postDeleteRes = await makeRequest(server, {
      path: `/api/v1/admin/group-voice-rooms/${targetRoom.id}`,
      method: 'GET',
      headers: authHeaders
    });
    assert(postDeleteRes.status === 404, 'Deleted room is not found in active listings (soft delete persistent)');

    console.log('\n--- TEST 10: MongoDB Direct Schema Validation Tests ---');
    // Ensure accessType cannot be anything other than 'anyone' or 'invite_only' (e.g. friends_only must fail validation)
    let schemaErrorCaught = false;
    try {
      const invalidRoom = new GroupVoiceRoom({
        title: 'Test Invalid Access Type',
        host: targetRoom.host._id || targetRoom.host.id,
        accessType: 'friends_only' // STRICTLY PROHIBITED
      });
      await invalidRoom.validate();
    } catch (err) {
      schemaErrorCaught = true;
    }
    assert(schemaErrorCaught === true, 'Mongoose Schema rejects prohibited "friends_only" accessType');

    // Close server and disconnect DB
    server.close();
    await disconnectDB();

    console.log('\n====================================================');
    console.log(`📊 Test Results: ${passed} Passed, ${failed} Failed`);
    console.log('====================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Test suite encountered fatal error:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  runGroupVoiceRoomTests();
}

module.exports = { runGroupVoiceRoomTests };
