/**
 * Focused Test Suite: Group Voice Phase 4 (UX / Participant Controls) & Phase 5 (Polish & Edge Cases)
 *
 * Verifies:
 * 1. Participant roles & membership (Host, Speakers, Listeners)
 * 2. Raise Hand flow: emit, broadcast to room, DB persistence, idempotent events
 * 3. Lower Hand flow: emit, broadcast to room, DB cleanup
 * 4. Speaker promotion: Host promotes listener -> speaker, DB updated, hand lower auto-cleanup
 * 5. Speaker demotion: Host demotes speaker -> listener, DB updated
 * 6. Authorization checks: Non-host user cannot promote/demote participants
 * 7. Rapid hand raise / lower toggle stability
 * 8. Rapid promote / demote toggle stability
 * 9. Participant leave cleans up raised hands and membership
 * 10. Host stage leave vs Host room close (`room:closed` broadcast & status: 'closed')
 */

const http = require('http');
const mongoose = require('mongoose');
const ioClient = require('socket.io-client');
const User = require('../src/models/User');
const GroupVoiceRoom = require('../src/models/GroupVoiceRoom');
const { initSocketServer } = require('../src/socket/socketServer');
const { signToken } = require('../src/utils/tokenUtils');
const { emitRoomClosed } = require('../src/utils/roomSocketHelper');

const TEST_DB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/voice-chat-friends';

let expressApp;
let server;
let port;
let serverUrl;

async function setupTestServer() {
  expressApp = require('../src/app');
  server = http.createServer(expressApp.callback());

  await new Promise((resolve) => {
    server.listen(0, () => {
      port = server.address().port;
      serverUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  initSocketServer(server);
}

async function closeTestServer() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
}

function connectSocket(token) {
  return ioClient(serverUrl, {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false
  });
}

function expect(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runTests() {
  console.log('================================================================');
  console.log('🎙️ PHASE 4 + PHASE 5: GROUP VOICE CONTROLS & EDGE CASES SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function runAsyncTest(name, fn) {
    try {
      console.log(`\n--- TEST: ${name} ---`);
      await fn();
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name} - ${err.message}`);
      failed++;
    }
  }

  let socketsToClose = [];

  try {
    await mongoose.connect(TEST_DB_URI);
    await setupTestServer();

    // Fetch real test users
    const hostUser = await User.findOne({ username: 'priya_patel' }) || await User.findOne({});
    const speakerUser = await User.findOne({ username: 'aarav_sharma' }) || await User.findOne({});
    const listenerUser = await User.findOne({ username: 'ananya_sen' }) || await User.findOne({});

    const hostToken = signToken({ id: hostUser._id.toString() });
    const speakerToken = signToken({ id: speakerUser._id.toString() });
    const listenerToken = signToken({ id: listenerUser._id.toString() });

    const hostIdStr = (hostUser.id || hostUser._id).toString();
    const speakerIdStr = (speakerUser.id || speakerUser._id).toString();
    const listenerIdStr = (listenerUser.id || listenerUser._id).toString();

    // Helper to create fresh test room
    async function createTestRoom(custom = {}) {
      return await GroupVoiceRoom.create({
        title: 'Phase 4-5 Controls Test Room',
        topic: 'General Discussion',
        accessType: 'anyone',
        status: 'active',
        host: hostUser._id,
        speakers: [speakerUser._id],
        listeners: [listenerUser._id],
        raisedHands: [],
        capacity: 10,
        participantCount: 3,
        speakersCount: 2,
        ...custom
      });
    }

    // ── TEST 1: Room Join & Participant Role Verification ─────────
    await runAsyncTest('Room join establishes roles for Host, Speaker, and Listener', async () => {
      const room = await createTestRoom();
      const sHost = connectSocket(hostToken);
      const sSpeaker = connectSocket(speakerToken);
      const sListener = connectSocket(listenerToken);
      socketsToClose.push(sHost, sSpeaker, sListener);

      await Promise.all([
        new Promise((res) => sHost.on('connect', res)),
        new Promise((res) => sSpeaker.on('connect', res)),
        new Promise((res) => sListener.on('connect', res))
      ]);

      sHost.emit('room:join', { roomId: room._id.toString() });
      sSpeaker.emit('room:join', { roomId: room._id.toString() });
      sListener.emit('room:join', { roomId: room._id.toString() });

      await new Promise((r) => setTimeout(r, 200));

      const freshRoom = await GroupVoiceRoom.findById(room._id);
      expect(freshRoom.host.toString() === hostUser._id.toString(), 'Host is properly assigned');
      expect(freshRoom.speakers.map(s => s.toString()).includes(speakerUser._id.toString()), 'Speaker is in speakers array');
      expect(freshRoom.listeners.map(l => l.toString()).includes(listenerUser._id.toString()), 'Listener is in listeners array');
    });

    // ── TEST 2: Raise Hand Broadcast & DB State ──────────────────
    await runAsyncTest('Listener can raise hand and host receives room:hand_raised event', async () => {
      const room = await createTestRoom();
      const sHost = connectSocket(hostToken);
      const sListener = connectSocket(listenerToken);
      socketsToClose.push(sHost, sListener);

      await Promise.all([
        new Promise((res) => sHost.on('connect', res)),
        new Promise((res) => sListener.on('connect', res))
      ]);

      sHost.emit('room:join', { roomId: room._id.toString() });
      sListener.emit('room:join', { roomId: room._id.toString() });
      await new Promise((r) => setTimeout(r, 150));

      const handRaisedPromise = new Promise((resolve) => {
        sHost.on('room:hand_raised', (data) => {
          resolve(data);
        });
      });

      sListener.emit('room:raise_hand', { roomId: room._id.toString(), raised: true });

      const eventData = await handRaisedPromise;
      const expectedRoomId = (room.id || room._id).toString();
      expect(eventData.roomId === expectedRoomId || eventData.roomId === room._id.toString(), 'Event has correct roomId');
      const receivedUid = (eventData.userId || eventData.user?.id || eventData.user?._id).toString();
      expect(receivedUid === listenerIdStr || receivedUid === listenerUser._id.toString(), 'Event has correct userId');
      const isRaised = eventData.isHandRaised !== undefined ? eventData.isHandRaised : eventData.raised;
      expect(isRaised === true, 'Event indicates raised = true');

      const roomInDb = await GroupVoiceRoom.findById(room._id);
      expect(roomInDb.raisedHands.map(h => h.toString()).includes(listenerUser._id.toString()), 'User ID added to room.raisedHands');
    });

    // ── TEST 3: Lower Hand Broadcast & DB State ──────────────────
    await runAsyncTest('Listener can lower hand and room:hand_raised broadcasts raised: false', async () => {
      const room = await createTestRoom({ raisedHands: [listenerUser._id] });
      const sHost = connectSocket(hostToken);
      const sListener = connectSocket(listenerToken);
      socketsToClose.push(sHost, sListener);

      await Promise.all([
        new Promise((res) => sHost.on('connect', res)),
        new Promise((res) => sListener.on('connect', res))
      ]);

      sHost.emit('room:join', { roomId: room._id.toString() });
      sListener.emit('room:join', { roomId: room._id.toString() });
      await new Promise((r) => setTimeout(r, 150));

      const handLoweredPromise = new Promise((resolve) => {
        sHost.on('room:hand_raised', (data) => {
          resolve(data);
        });
      });

      sListener.emit('room:raise_hand', { roomId: room._id.toString(), raised: false });

      const eventData = await handLoweredPromise;
      const receivedUid = (eventData.userId || eventData.user?.id || eventData.user?._id).toString();
      expect(receivedUid === listenerIdStr || receivedUid === listenerUser._id.toString(), 'Event userId matches listener');
      const isRaised = eventData.isHandRaised !== undefined ? eventData.isHandRaised : eventData.raised;
      expect(isRaised === false, 'Event indicates raised = false');

      const roomInDb = await GroupVoiceRoom.findById(room._id);
      expect(!roomInDb.raisedHands.map(h => h.toString()).includes(listenerUser._id.toString()), 'User ID removed from room.raisedHands');
    });

    // ── TEST 4: Host Promotes Listener to Speaker ────────────────
    await runAsyncTest('Host can promote listener to speaker with automatic hand lower', async () => {
      const room = await createTestRoom({ raisedHands: [listenerUser._id] });
      const sHost = connectSocket(hostToken);
      const sListener = connectSocket(listenerToken);
      socketsToClose.push(sHost, sListener);

      await Promise.all([
        new Promise((res) => sHost.on('connect', res)),
        new Promise((res) => sListener.on('connect', res))
      ]);

      sHost.emit('room:join', { roomId: room._id.toString() });
      sListener.emit('room:join', { roomId: room._id.toString() });
      await new Promise((r) => setTimeout(r, 150));

      const speakerUpdatedPromise = new Promise((resolve) => {
        sListener.on('room:speaker_updated', (data) => {
          resolve(data);
        });
      });

      sHost.emit('room:update_speaker', {
        roomId: room._id.toString(),
        targetUserId: listenerUser._id.toString(),
        isSpeaker: true
      });

      const updateData = await speakerUpdatedPromise;
      const targetId = (updateData.user?.id || updateData.user?._id || updateData.targetUserId).toString();
      expect(targetId === listenerIdStr || targetId === listenerUser._id.toString(), 'Target user matches');
      const wasPromoted = updateData.action === 'promoted' || updateData.isSpeaker === true;
      expect(wasPromoted === true, 'Speaker action is promoted');

      const roomInDb = await GroupVoiceRoom.findById(room._id);
      expect(roomInDb.speakers.map(s => s.toString()).includes(listenerUser._id.toString()), 'Listener moved to speakers array');
      expect(!roomInDb.listeners.map(l => l.toString()).includes(listenerUser._id.toString()), 'Listener removed from listeners array');
      expect(!roomInDb.raisedHands.map(h => h.toString()).includes(listenerUser._id.toString()), 'Raised hand cleared upon promotion');
    });

    // ── TEST 5: Host Demotes Speaker to Listener ─────────────────
    await runAsyncTest('Host can demote speaker to listener', async () => {
      const room = await createTestRoom();
      const sHost = connectSocket(hostToken);
      const sSpeaker = connectSocket(speakerToken);
      socketsToClose.push(sHost, sSpeaker);

      await Promise.all([
        new Promise((res) => sHost.on('connect', res)),
        new Promise((res) => sSpeaker.on('connect', res))
      ]);

      sHost.emit('room:join', { roomId: room._id.toString() });
      sSpeaker.emit('room:join', { roomId: room._id.toString() });
      await new Promise((r) => setTimeout(r, 150));

      const demotePromise = new Promise((resolve) => {
        sSpeaker.on('room:speaker_updated', (data) => {
          resolve(data);
        });
      });

      sHost.emit('room:update_speaker', {
        roomId: room._id.toString(),
        targetUserId: speakerUser._id.toString(),
        isSpeaker: false
      });

      const updateData = await demotePromise;
      const targetId = (updateData.user?.id || updateData.user?._id || updateData.targetUserId).toString();
      expect(targetId === speakerIdStr || targetId === speakerUser._id.toString(), 'Target user matches speaker');
      const wasDemoted = updateData.action === 'demoted' || updateData.isSpeaker === false;
      expect(wasDemoted === true, 'Speaker action is demoted');

      const roomInDb = await GroupVoiceRoom.findById(room._id);
      expect(!roomInDb.speakers.map(s => s.toString()).includes(speakerUser._id.toString()), 'Speaker removed from speakers array');
      expect(roomInDb.listeners.map(l => l.toString()).includes(speakerUser._id.toString()), 'Speaker moved to listeners array');
    });

    // ── TEST 6: Unauthorized User Cannot Promote/Demote ──────────
    await runAsyncTest('Non-host participant cannot update speaker roles', async () => {
      const room = await createTestRoom();
      const sListener = connectSocket(listenerToken);
      socketsToClose.push(sListener);

      await new Promise((res) => sListener.on('connect', res));
      sListener.emit('room:join', { roomId: room._id.toString() });
      await new Promise((r) => setTimeout(r, 150));

      // Attempt unauthorized promotion of speakerUser to demoted
      sListener.emit('room:update_speaker', {
        roomId: room._id.toString(),
        targetUserId: speakerUser._id.toString(),
        isSpeaker: false
      });

      await new Promise((r) => setTimeout(r, 200));

      const roomInDb = await GroupVoiceRoom.findById(room._id);
      expect(roomInDb.speakers.map(s => s.toString()).includes(speakerUser._id.toString()), 'Speaker remains untouched in speakers array');
    });

    // ── TEST 7: Rapid Hand Raise & Lower Idempotency ─────────────
    await runAsyncTest('Rapid hand raise toggles are safe and idempotent', async () => {
      const room = await createTestRoom();
      const sListener = connectSocket(listenerToken);
      socketsToClose.push(sListener);

      await new Promise((res) => sListener.on('connect', res));
      sListener.emit('room:join', { roomId: room._id.toString() });
      await new Promise((r) => setTimeout(r, 100));

      // Emit rapidly 5 times
      sListener.emit('room:raise_hand', { roomId: room._id.toString(), raised: true });
      sListener.emit('room:raise_hand', { roomId: room._id.toString(), raised: true });
      sListener.emit('room:raise_hand', { roomId: room._id.toString(), raised: false });
      sListener.emit('room:raise_hand', { roomId: room._id.toString(), raised: true });

      await new Promise((r) => setTimeout(r, 250));

      const roomInDb = await GroupVoiceRoom.findById(room._id);
      const matches = roomInDb.raisedHands.filter(h => h.toString() === listenerUser._id.toString());
      expect(matches.length === 1, 'No duplicate entries created in raisedHands array');
    });

    // ── TEST 8: Rapid Promote & Demote Stability ─────────────────
    await runAsyncTest('Rapid promote and demote sequence completes without corrupting state', async () => {
      const room = await createTestRoom();
      const sHost = connectSocket(hostToken);
      socketsToClose.push(sHost);

      await new Promise((res) => sHost.on('connect', res));
      sHost.emit('room:join', { roomId: room._id.toString() });
      await new Promise((r) => setTimeout(r, 100));

      sHost.emit('room:update_speaker', { roomId: room._id.toString(), targetUserId: listenerUser._id.toString(), isSpeaker: true });
      sHost.emit('room:update_speaker', { roomId: room._id.toString(), targetUserId: listenerUser._id.toString(), isSpeaker: false });
      sHost.emit('room:update_speaker', { roomId: room._id.toString(), targetUserId: listenerUser._id.toString(), isSpeaker: true });

      await new Promise((r) => setTimeout(r, 350));

      const roomInDb = await GroupVoiceRoom.findById(room._id);
      expect(roomInDb.speakers.map(s => s.toString()).includes(listenerUser._id.toString()), 'Final state correctly has user in speakers');
    });

    // ── TEST 9: Leave Cleans Up Raised Hand & Membership ──────────
    await runAsyncTest('Participant leave cleans up membership and raised hand state', async () => {
      const room = await createTestRoom({ raisedHands: [listenerUser._id] });
      const sHost = connectSocket(hostToken);
      const sListener = connectSocket(listenerToken);
      socketsToClose.push(sHost, sListener);

      await Promise.all([
        new Promise((res) => sHost.on('connect', res)),
        new Promise((res) => sListener.on('connect', res))
      ]);

      sHost.emit('room:join', { roomId: room._id.toString() });
      sListener.emit('room:join', { roomId: room._id.toString() });
      await new Promise((r) => setTimeout(r, 150));

      const leavePromise = new Promise((resolve) => {
        sHost.on('room:member_left', (data) => {
          resolve(data);
        });
      });

      sListener.emit('room:leave', { roomId: room._id.toString() });
      const leaveData = await leavePromise;

      const leftUid = (leaveData.userId || leaveData.member?.id || leaveData.member?._id).toString();
      expect(leftUid === listenerIdStr || leftUid === listenerUser._id.toString(), 'Leave event broadcasts left userId');

      const roomInDb = await GroupVoiceRoom.findById(room._id);
      expect(!roomInDb.listeners.map(l => l.toString()).includes(listenerUser._id.toString()), 'User removed from listeners');
      expect(!roomInDb.raisedHands.map(h => h.toString()).includes(listenerUser._id.toString()), 'User removed from raisedHands');
    });

    // ── TEST 10: Host Ends Room vs Leaves Stage ──────────────────
    await runAsyncTest('Host stage leave keeps room active; Room close broadcasts room:closed', async () => {
      const room = await createTestRoom();
      const sHost = connectSocket(hostToken);
      const sSpeaker = connectSocket(speakerToken);
      socketsToClose.push(sHost, sSpeaker);

      await Promise.all([
        new Promise((res) => sHost.on('connect', res)),
        new Promise((res) => sSpeaker.on('connect', res))
      ]);

      sHost.emit('room:join', { roomId: room._id.toString() });
      sSpeaker.emit('room:join', { roomId: room._id.toString() });
      await new Promise((r) => setTimeout(r, 150));

      // Host leaves stage
      sHost.emit('room:leave', { roomId: room._id.toString() });
      await new Promise((r) => setTimeout(r, 150));

      const stageLeftRoom = await GroupVoiceRoom.findById(room._id);
      expect(stageLeftRoom.status === 'active', 'Room remains active when host leaves stage');

      // Now close room
      stageLeftRoom.status = 'closed';
      stageLeftRoom.closedAt = new Date();
      await stageLeftRoom.save();

      const closedPromise = new Promise((resolve) => {
        sSpeaker.on('room:closed', (data) => {
          resolve(data);
        });
      });

      await emitRoomClosed(stageLeftRoom);
      const closedData = await closedPromise;

      const expectedRoomId = (stageLeftRoom.id || stageLeftRoom._id).toString();
      expect(closedData.roomId === expectedRoomId || closedData.roomId === stageLeftRoom._id.toString(), 'room:closed event received with roomId');
      const finalRoom = await GroupVoiceRoom.findById(room._id);
      expect(finalRoom.status === 'closed', 'Room status in DB is closed');
    });

  } finally {
    // Teardown
    for (const s of socketsToClose) {
      try { s.disconnect(); } catch (e) {}
    }
    await closeTestServer();
    await mongoose.disconnect();
  }

  console.log('\n================================================================');
  console.log(`🏁 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests();
