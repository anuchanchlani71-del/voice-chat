const mongoose = require('mongoose');
const http = require('http');
const ioClient = require('socket.io-client');
const User = require('../src/models/User');
const GroupVoiceRoom = require('../src/models/GroupVoiceRoom');
const { signToken } = require('../src/utils/tokenUtils');
const { initSocketServer } = require('../src/socket/socketServer');

const TEST_DB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/voice-chat-friends';

let expressApp;
let server;
let port;
let serverUrl;

async function setupTestServer() {
  expressApp = require('../src/app');
  server = http.createServer(expressApp);

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

async function runGroupSignalingTests() {
  console.log('================================================================');
  console.log('⚡ GROUP VOICE ROOMS WEBRTC PHASE 2 — SIGNALING & AUTH TEST SUITE');
  console.log('================================================================\n');

  await mongoose.connect(TEST_DB_URI);
  await setupTestServer();

  let socketHost, socketSpeaker, socketListener, socketUnrelated, socketOutsider;
  const createdRoomIds = [];

  try {
    // 1. Setup Test Users
    async function getOrCreateUser(username, fullName) {
      let u = await User.findOne({ username });
      if (!u) {
        u = await User.create({
          id: `usr_${username}_${Date.now()}`,
          username,
          fullName,
          email: `${username}@test.com`,
          passwordHash: 'dummyhash',
          salt: 'dummysalt',
          accountStatus: 'active'
        });
      }
      return u;
    }

    const hostUser = await getOrCreateUser('sig_host', 'Signaling Host');
    const speakerUser = await getOrCreateUser('sig_speaker', 'Signaling Speaker');
    const listenerUser = await getOrCreateUser('sig_listener', 'Signaling Listener');
    const unrelatedUser = await getOrCreateUser('sig_unrelated', 'Signaling Unrelated');
    const outsiderUser = await getOrCreateUser('sig_outsider', 'Signaling Outsider');

    const hostToken = signToken({ id: hostUser._id.toString() });
    const speakerToken = signToken({ id: speakerUser._id.toString() });
    const listenerToken = signToken({ id: listenerUser._id.toString() });
    const unrelatedToken = signToken({ id: unrelatedUser._id.toString() });
    const outsiderToken = signToken({ id: outsiderUser._id.toString() });

    // Connect Sockets
    socketHost = connectSocket(hostToken);
    socketSpeaker = connectSocket(speakerToken);
    socketListener = connectSocket(listenerToken);
    socketUnrelated = connectSocket(unrelatedToken);
    socketOutsider = connectSocket(outsiderToken);

    await Promise.all([
      new Promise((res) => socketHost.on('connect', res)),
      new Promise((res) => socketSpeaker.on('connect', res)),
      new Promise((res) => socketListener.on('connect', res)),
      new Promise((res) => socketUnrelated.on('connect', res)),
      new Promise((res) => socketOutsider.on('connect', res))
    ]);

    console.log('[Setup] 5 test sockets connected successfully.\n');

    // 2. Setup Active Test Room A
    const roomA = await GroupVoiceRoom.create({
      title: 'WebRTC Signaling Room A',
      topic: 'WebRTC Phase 2',
      accessType: 'anyone',
      status: 'active',
      host: hostUser._id,
      speakers: [speakerUser._id],
      listeners: [listenerUser._id, unrelatedUser._id],
      capacity: 10,
      participantCount: 4
    });
    createdRoomIds.push(roomA._id);
    const roomAIdStr = roomA.id || roomA._id.toString();

    // 3. Setup Second Room B (for cross-room target test)
    const roomB = await GroupVoiceRoom.create({
      title: 'WebRTC Room B Cross',
      topic: 'Testing Cross Room',
      accessType: 'anyone',
      status: 'active',
      host: outsiderUser._id,
      speakers: [],
      listeners: [],
      capacity: 10
    });
    createdRoomIds.push(roomB._id);
    const roomBIdStr = roomB.id || roomB._id.toString();

    // Sockets join room channels
    socketHost.emit('room:join', { roomId: roomAIdStr });
    socketSpeaker.emit('room:join', { roomId: roomAIdStr });
    socketListener.emit('room:join', { roomId: roomAIdStr });
    socketUnrelated.emit('room:join', { roomId: roomAIdStr });
    socketOutsider.emit('room:join', { roomId: roomBIdStr });

    await new Promise((res) => setTimeout(res, 200));

    // ── Test 1: Host -> Listener offer relay succeeds ──
    const offerFromHostPromise = new Promise((resolve) => {
      socketListener.once('room:webrtc_offer', (data) => resolve(data));
    });

    socketHost.emit('room:webrtc_offer', {
      roomId: roomAIdStr,
      targetUserId: listenerUser._id.toString(),
      offer: { type: 'offer', sdp: 'v=0 host_mock_sdp' }
    });

    const receivedOffer1 = await offerFromHostPromise;
    expect(receivedOffer1 && receivedOffer1.roomId === roomAIdStr, '1. Host -> Listener offer relay succeeds');
    expect(receivedOffer1.fromUserId === (hostUser.id || hostUser._id.toString()), '1. Offer correctly identifies host as fromUserId');

    // ── Test 2: Speaker -> Listener offer relay succeeds ──
    const offerFromSpeakerPromise = new Promise((resolve) => {
      socketListener.once('room:webrtc_offer', (data) => resolve(data));
    });

    socketSpeaker.emit('room:webrtc_offer', {
      roomId: roomAIdStr,
      targetUserId: listenerUser._id.toString(),
      sdp: 'v=0 speaker_mock_sdp'
    });

    const receivedOffer2 = await offerFromSpeakerPromise;
    expect(receivedOffer2 && receivedOffer2.roomId === roomAIdStr, '2. Speaker -> Listener offer relay succeeds');
    expect(receivedOffer2.fromUserId === (speakerUser.id || speakerUser._id.toString()), '2. Offer correctly identifies speaker as fromUserId');

    // ── Test 3: Unauthorized Listener publishing offer is rejected ──
    let unauthorizedOfferReceived = false;
    const testListenerOfferSub = (data) => { unauthorizedOfferReceived = true; };
    socketHost.on('room:webrtc_offer', testListenerOfferSub);

    socketListener.emit('room:webrtc_offer', {
      roomId: roomAIdStr,
      targetUserId: hostUser._id.toString(),
      offer: { type: 'offer', sdp: 'v=0 fake_listener_offer' }
    });

    await new Promise((res) => setTimeout(res, 300));
    socketHost.off('room:webrtc_offer', testListenerOfferSub);
    expect(!unauthorizedOfferReceived, '3. Unauthorized Listener publishing offer is rejected by server');

    // ── Test 4: Valid Listener -> Host answer succeeds ──
    const answerFromListenerPromise = new Promise((resolve) => {
      socketHost.once('room:webrtc_answer', (data) => resolve(data));
    });

    socketListener.emit('room:webrtc_answer', {
      roomId: roomAIdStr,
      targetUserId: hostUser._id.toString(),
      answer: { type: 'answer', sdp: 'v=0 listener_answer_sdp' }
    });

    const receivedAnswer = await answerFromListenerPromise;
    expect(receivedAnswer && receivedAnswer.roomId === roomAIdStr, '4. Valid Listener -> Host answer succeeds');
    expect(receivedAnswer.fromUserId === (listenerUser.id || listenerUser._id.toString()), '4. Answer correctly identifies listener as fromUserId');

    // ── Test 5: Valid ICE exchange succeeds ──
    const iceCandidatePromise = new Promise((resolve) => {
      socketListener.once('room:webrtc_ice_candidate', (data) => resolve(data));
    });

    socketHost.emit('room:webrtc_ice_candidate', {
      roomId: roomAIdStr,
      targetUserId: listenerUser._id.toString(),
      candidate: { candidate: 'candidate:1 1 UDP 2130706431 192.168.1.1 5000 typ host' }
    });

    const receivedIce = await iceCandidatePromise;
    expect(receivedIce && receivedIce.roomId === roomAIdStr, '5. Valid ICE exchange succeeds');
    expect(receivedIce.candidate && receivedIce.candidate.candidate.includes('UDP'), '5. Candidate payload intact');

    // ── Test 6 & 7: Offer reaches ONLY target user (not broadcast to unrelated room member) ──
    let unrelatedReceivedSignal = false;
    const unrelatedSpy = () => { unrelatedReceivedSignal = true; };
    socketUnrelated.on('room:webrtc_offer', unrelatedSpy);
    socketUnrelated.on('room:webrtc_answer', unrelatedSpy);
    socketUnrelated.on('room:webrtc_ice_candidate', unrelatedSpy);

    socketHost.emit('room:webrtc_offer', {
      roomId: roomAIdStr,
      targetUserId: listenerUser._id.toString(),
      offer: { type: 'offer', sdp: 'targeted_sdp' }
    });

    await new Promise((res) => setTimeout(res, 250));
    socketUnrelated.off('room:webrtc_offer', unrelatedSpy);
    socketUnrelated.off('room:webrtc_answer', unrelatedSpy);
    socketUnrelated.off('room:webrtc_ice_candidate', unrelatedSpy);

    expect(!unrelatedReceivedSignal, '6 & 7. Targeted signaling delivered only to target; not broadcast to unrelated room participant');

    // ── Test 8: Non-member sender rejected ──
    let outsiderOfferReceived = false;
    const outsiderSpy = () => { outsiderOfferReceived = true; };
    socketHost.on('room:webrtc_offer', outsiderSpy);

    socketOutsider.emit('room:webrtc_offer', {
      roomId: roomAIdStr,
      targetUserId: hostUser._id.toString(),
      offer: { type: 'offer', sdp: 'outsider_sdp' }
    });

    await new Promise((res) => setTimeout(res, 250));
    socketHost.off('room:webrtc_offer', outsiderSpy);
    expect(!outsiderOfferReceived, '8. Non-member sender rejected');

    // ── Test 9: Cross-room target rejected ──
    let crossRoomReceived = false;
    const crossSpy = () => { crossRoomReceived = true; };
    socketOutsider.on('room:webrtc_offer', crossSpy);

    socketHost.emit('room:webrtc_offer', {
      roomId: roomAIdStr,
      targetUserId: outsiderUser._id.toString(), // outsiderUser is not in roomA!
      offer: { type: 'offer', sdp: 'cross_room_sdp' }
    });

    await new Promise((res) => setTimeout(res, 250));
    socketOutsider.off('room:webrtc_offer', crossSpy);
    expect(!crossRoomReceived, '9. Cross-room target rejected');

    // ── Test 10: Self-target rejected ──
    let selfTargetReceived = false;
    const selfSpy = () => { selfTargetReceived = true; };
    socketHost.on('room:webrtc_offer', selfSpy);

    socketHost.emit('room:webrtc_offer', {
      roomId: roomAIdStr,
      targetUserId: hostUser._id.toString(), // targeting self!
      offer: { type: 'offer', sdp: 'self_sdp' }
    });

    await new Promise((res) => setTimeout(res, 250));
    socketHost.off('room:webrtc_offer', selfSpy);
    expect(!selfTargetReceived, '10. Self-target signaling rejected');

    // ── Test 11: Fake client sender ID cannot impersonate another user ──
    const spoofPromise = new Promise((resolve) => {
      socketListener.once('room:webrtc_offer', (data) => resolve(data));
    });

    socketSpeaker.emit('room:webrtc_offer', {
      roomId: roomAIdStr,
      targetUserId: listenerUser._id.toString(),
      fromUserId: 'fake_impersonated_id',
      senderUserId: 'fake_impersonated_id',
      offer: { type: 'offer', sdp: 'spoof_test_sdp' }
    });

    const spoofResult = await spoofPromise;
    expect(spoofResult.fromUserId !== 'fake_impersonated_id', '11. Fake client sender ID ignored');
    expect(spoofResult.fromUserId === (speakerUser.id || speakerUser._id.toString()), '11. Server strictly derived sender identity from socket.user');

    // ── Test 12 & 13: Closed & Ended room signaling rejected ──
    roomA.status = 'closed';
    await roomA.save();

    let signalInClosedRoomReceived = false;
    const closedSpy = () => { signalInClosedRoomReceived = true; };
    socketListener.on('room:webrtc_offer', closedSpy);

    socketHost.emit('room:webrtc_offer', {
      roomId: roomAIdStr,
      targetUserId: listenerUser._id.toString(),
      offer: { type: 'offer', sdp: 'closed_room_sdp' }
    });

    await new Promise((res) => setTimeout(res, 250));
    socketListener.off('room:webrtc_offer', closedSpy);
    expect(!signalInClosedRoomReceived, '12 & 13. Signaling in closed or ended room rejected');

    // Restore roomA to active for remaining tests
    roomA.status = 'active';
    await roomA.save();

    // ── Test 14, 15, 16: Malformed offer, answer, and ICE rejected safely ──
    let malformedReceived = false;
    const malformedSpy = () => { malformedReceived = true; };
    socketListener.on('room:webrtc_offer', malformedSpy);
    socketHost.on('room:webrtc_answer', malformedSpy);
    socketListener.on('room:webrtc_ice_candidate', malformedSpy);

    socketHost.emit('room:webrtc_offer', { roomId: roomAIdStr, targetUserId: listenerUser._id.toString() }); // missing offer
    socketListener.emit('room:webrtc_answer', { roomId: roomAIdStr, targetUserId: hostUser._id.toString() }); // missing answer
    socketHost.emit('room:webrtc_ice_candidate', { roomId: roomAIdStr, targetUserId: listenerUser._id.toString() }); // missing candidate
    socketHost.emit('room:webrtc_offer', null); // malformed
    socketHost.emit('room:webrtc_offer', 'malformed_string');

    await new Promise((res) => setTimeout(res, 300));
    socketListener.off('room:webrtc_offer', malformedSpy);
    socketHost.off('room:webrtc_answer', malformedSpy);
    socketListener.off('room:webrtc_ice_candidate', malformedSpy);

    expect(!malformedReceived, '14, 15, 16. Malformed offer, answer, and ICE candidate payloads rejected safely');

    // ── Test 17: Existing Group Voice Socket.IO events still work ──
    const handRaisedPromise = new Promise((resolve) => {
      socketHost.once('room:hand_raised', (data) => resolve(data));
    });

    socketListener.emit('room:raise_hand', { roomId: roomAIdStr, isHandRaised: true });
    const handData = await handRaisedPromise;
    expect(handData && handData.roomId === roomAIdStr && handData.isHandRaised === true, '17. Existing Group Voice room:hand_raised event operational');

    // ── Test 18: Existing 1-to-1 WebRTC signaling still works unchanged ──
    const directOfferPromise = new Promise((resolve) => {
      socketListener.once('webrtc:offer', (data) => resolve(data));
    });

    socketHost.emit('webrtc:offer', {
      targetUserId: listenerUser._id.toString(),
      sdp: { type: 'offer', sdp: 'direct_1to1_mock_sdp' },
      callId: 'call_123'
    });

    const directOfferResult = await directOfferPromise;
    expect(directOfferResult && directOfferResult.callId === 'call_123', '18. Existing 1-to-1 WebRTC signaling (webrtc:offer) operational and untouched');

    console.log('\n================================================================');
    console.log('🎉 ALL 18/18 GROUP WEBRTC SIGNALING TESTS PASSED 100%!');
    console.log('================================================================\n');

  } catch (err) {
    console.error('❌ PHASE 2 TEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    for (const rId of createdRoomIds) {
      await GroupVoiceRoom.deleteOne({ _id: rId }).catch(() => {});
    }
    if (socketHost) socketHost.disconnect();
    if (socketSpeaker) socketSpeaker.disconnect();
    if (socketListener) socketListener.disconnect();
    if (socketUnrelated) socketUnrelated.disconnect();
    if (socketOutsider) socketOutsider.disconnect();
    await closeTestServer();
    await mongoose.disconnect();
  }
}

runGroupSignalingTests();
