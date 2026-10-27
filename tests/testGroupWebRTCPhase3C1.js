/**
 * Focused Test Suite: Group WebRTC Dynamic Role & Peer Transition Lifecycle (Phase 3C-1)
 *
 * Verifies all 25 Phase 3C-1 requirements:
 *
 * Role State:
 * 1. Listener starts as non-publisher.
 * 2. Listener -> Speaker changes isPublisher to true.
 * 3. Speaker -> Listener changes isPublisher to false.
 * 4. Host remains publisher.
 * 5. Repeated same-role updates do not trigger unnecessary lifecycle work.
 *
 * Promotion:
 * 6. Promotion acquires local audio if missing.
 * 7. Promotion does not call getUserMedia twice when stream already exists.
 * 8. Existing mute state is preserved (track.enabled === false when muted).
 * 9. Existing peers are not blindly destroyed on promotion.
 * 10. Existing peers are marked/recognized as requiring role transition handling.
 *
 * Demotion:
 * 11. Demotion stops local microphone publishing.
 * 12. Local microphone tracks are released according to lifecycle (track.stop()).
 * 13. localStream is cleared when microphone is released.
 * 14. Valid publisher connections remain after demotion.
 * 15. Listener-to-listener connections are removed.
 *
 * Rapid Changes:
 * 16. Promote -> demote while getUserMedia is pending is safe.
 * 17. Repeated promotion/demotion does not leak streams.
 * 18. No duplicate peer connections are created.
 *
 * Participant Sync:
 * 19. Publisher -> listener relationship remains valid.
 * 20. Listener -> publisher waits for publisher offer.
 * 21. Publisher <-> publisher deterministic rule remains unchanged.
 * 22. Listener <-> listener connection is never retained.
 *
 * Cleanup:
 * 23. destroy() after promotion cleans all resources.
 * 24. destroy() after demotion cleans all resources.
 * 25. No socket/media/peer resources remain after room exit.
 */

const path = require('path');
const { pathToFileURL } = require('url');

function expect(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

// ── Mock Classes for WebRTC Media in Node.js ──────────────────────────

class MockMediaStreamTrack {
  constructor(kind = 'audio') {
    this.kind = kind;
    this.enabled = true;
    this.stopped = false;
  }
  stop() {
    this.stopped = true;
  }
}

class MockMediaStream {
  constructor(tracks = [new MockMediaStreamTrack('audio')]) {
    this.tracks = tracks;
  }
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
}

class MockRTCSessionDescription {
  constructor({ type, sdp }) {
    this.type = type;
    this.sdp = sdp || `mock_${type}_sdp`;
  }
}

class MockRTCIceCandidate {
  constructor(data) {
    this.candidate = data.candidate || 'mock_candidate_str';
    this.sdpMid = data.sdpMid || '0';
    this.sdpMLineIndex = data.sdpMLineIndex !== undefined ? data.sdpMLineIndex : 0;
  }
}

class MockRTCPeerConnection {
  constructor(config) {
    this.config = config;
    this.senders = [];
    this.signalingState = 'stable';
    this.connectionState = 'new';
    this.iceConnectionState = 'new';
    this.localDescription = null;
    this.remoteDescription = null;
    this.addedIceCandidates = [];
    this.closed = false;

    this.onicecandidate = null;
    this.ontrack = null;
    this.onconnectionstatechange = null;
    this.oniceconnectionstatechange = null;
  }

  getSenders() {
    return this.senders;
  }

  addTrack(track, stream) {
    this.senders.push({ track, stream });
  }

  removeTrack(sender) {
    const idx = this.senders.indexOf(sender);
    if (idx !== -1) {
      this.senders.splice(idx, 1);
    }
  }

  async createOffer() {
    return new MockRTCSessionDescription({ type: 'offer', sdp: 'v=0 mock_created_offer' });
  }

  async createAnswer() {
    return new MockRTCSessionDescription({ type: 'answer', sdp: 'v=0 mock_created_answer' });
  }

  async setLocalDescription(desc) {
    if (desc.type === 'rollback') {
      this.signalingState = 'stable';
      this.localDescription = null;
      return;
    }
    this.localDescription = desc;
    if (desc.type === 'offer') {
      this.signalingState = 'have-local-offer';
    } else if (desc.type === 'answer') {
      this.signalingState = 'stable';
    }
  }

  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
    if (desc.type === 'offer') {
      this.signalingState = 'have-remote-offer';
    } else if (desc.type === 'answer') {
      this.signalingState = 'stable';
    }
  }

  async addIceCandidate(cand) {
    if (!cand || !cand.candidate) {
      throw new Error('Invalid candidate');
    }
    this.addedIceCandidates.push(cand);
  }

  close() {
    this.closed = true;
    this.signalingState = 'closed';
    this.connectionState = 'closed';
  }
}

class MockSocket {
  constructor() {
    this.listeners = new Map();
    this.emitted = [];
  }

  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(handler);
  }

  off(event, handler) {
    if (!this.listeners.has(event)) return;
    const list = this.listeners.get(event).filter((h) => h !== handler);
    this.listeners.set(event, list);
  }

  emit(event, payload) {
    this.emitted.push({ event, payload });
  }

  async trigger(event, data) {
    if (!this.listeners.has(event)) return;
    for (const h of this.listeners.get(event)) {
      await h(data);
    }
  }
}

function createMockNavigator(customGUM = null) {
  let gumCalls = 0;
  return {
    get gumCalls() {
      return gumCalls;
    },
    mediaDevices: {
      getUserMedia: customGUM || (async () => {
        gumCalls++;
        return new MockMediaStream();
      })
    }
  };
}

async function runPhase3C1Tests() {
  console.log('================================================================');
  console.log('🧪 GROUP WEBRTC PHASE 3C-1 — DYNAMIC ROLE TRANSITION TEST SUITE');
  console.log('================================================================');

  // Setup globals for node
  globalThis.RTCPeerConnection = MockRTCPeerConnection;
  globalThis.RTCSessionDescription = MockRTCSessionDescription;
  globalThis.RTCIceCandidate = MockRTCIceCandidate;

  const managerModulePath = path.resolve(__dirname, '../../frontend/src/services/groupWebRTCManager.js');
  const managerUrl = pathToFileURL(managerModulePath).href;
  const { GroupWebRTCManager } = await import(managerUrl);

  const ROOM_ID = 'test_room_3c1';

  // ──────────────────────────────────────────────────────────────────
  // TEST GROUP 1: ROLE STATE CONSISTENCY (Requirements 1 - 5)
  // ──────────────────────────────────────────────────────────────────

  // Req 1: Listener starts as non-publisher
  const listenerManager = new GroupWebRTCManager({
    roomId: ROOM_ID,
    currentUserId: 'user_listener_1',
    isHost: false,
    isSpeaker: false,
    isPublisher: false,
    navigator: createMockNavigator()
  });
  expect(listenerManager.getIsPublisher() === false, '1. Listener starts as non-publisher');
  expect(listenerManager.getIsSpeaker() === false && listenerManager.getIsHost() === false, '1. Role flags indicate neither host nor speaker');

  // Req 2: Listener -> Speaker changes isPublisher to true
  listenerManager.setRole({ isHost: false, isSpeaker: true });
  expect(listenerManager.getIsPublisher() === true, '2. Listener -> Speaker changes isPublisher to true');
  expect(listenerManager.getIsSpeaker() === true, '2. isSpeaker is true on promotion');

  // Req 3: Speaker -> Listener changes isPublisher to false
  listenerManager.setRole({ isHost: false, isSpeaker: false });
  expect(listenerManager.getIsPublisher() === false, '3. Speaker -> Listener changes isPublisher to false');
  expect(listenerManager.getIsSpeaker() === false, '3. isSpeaker is false on demotion');

  // Req 4: Host remains publisher
  const hostManager = new GroupWebRTCManager({
    roomId: ROOM_ID,
    currentUserId: 'user_host_1',
    isHost: true,
    isSpeaker: false,
    isPublisher: true,
    navigator: createMockNavigator()
  });
  expect(hostManager.getIsPublisher() === true && hostManager.getIsHost() === true, '4. Host remains publisher');
  hostManager.setRole({ isHost: true, isSpeaker: false });
  expect(hostManager.getIsPublisher() === true, '4. Host role update maintains publisher status');

  // Req 5: Repeated same-role updates do not trigger unnecessary work
  let transitionWorkTriggered = false;
  const mockNav5 = createMockNavigator();
  const testManager5 = new GroupWebRTCManager({
    roomId: ROOM_ID,
    currentUserId: 'user_listener_5',
    isHost: false,
    isSpeaker: false,
    navigator: mockNav5
  });
  // Call setRole with identical non-publisher state
  testManager5.setRole({ isHost: false, isSpeaker: false });
  testManager5.setRole({ isHost: false, isSpeaker: false });
  expect(mockNav5.gumCalls === 0, '5. Repeated same-role updates do not trigger unnecessary lifecycle work');

  // ──────────────────────────────────────────────────────────────────
  // TEST GROUP 2: PROMOTION LIFECYCLE (Requirements 6 - 10)
  // ──────────────────────────────────────────────────────────────────

  // Req 6: Promotion acquires local audio if missing
  const mockNav6 = createMockNavigator();
  const promoManager = new GroupWebRTCManager({
    roomId: ROOM_ID,
    currentUserId: 'user_promoted_1',
    isHost: false,
    isSpeaker: false,
    navigator: mockNav6
  });
  expect(promoManager.getLocalStream() === null, '6. Listener starts without local audio stream');
  promoManager.setRole({ isHost: false, isSpeaker: true });
  // Wait for microtask tick for async acquisition
  await new Promise((r) => setTimeout(r, 20));
  expect(mockNav6.gumCalls === 1, '6. Promotion acquires local audio if missing');
  expect(promoManager.getLocalStream() !== null, '6. Local audio stream stored in manager on promotion');

  // Req 7: Promotion does not call getUserMedia twice when stream already exists
  promoManager.setRole({ isHost: false, isSpeaker: true });
  await new Promise((r) => setTimeout(r, 10));
  expect(mockNav6.gumCalls === 1, '7. Promotion does not call getUserMedia twice when stream already exists');

  // Req 8: Existing mute state is preserved (track.enabled === false when muted)
  const mockNav8 = createMockNavigator();
  const mutePromoManager = new GroupWebRTCManager({
    roomId: ROOM_ID,
    currentUserId: 'user_muted_promo',
    isHost: false,
    isSpeaker: false,
    navigator: mockNav8
  });
  mutePromoManager.setMuted(true);
  expect(mutePromoManager.getIsMuted() === true, '8. User set to muted before promotion');
  mutePromoManager.setRole({ isHost: false, isSpeaker: true });
  await new Promise((r) => setTimeout(r, 20));
  const acquiredStream = mutePromoManager.getLocalStream();
  expect(acquiredStream !== null, '8. Microphone acquired on promotion');
  const tracks = acquiredStream.getAudioTracks();
  expect(tracks.length > 0 && tracks[0].enabled === false, '8. Existing mute state is preserved (track.enabled === false when muted; never hot-mic)');

  // Req 9: Existing peers are not blindly destroyed on promotion
  const mockNav9 = createMockNavigator();
  const peerPromoManager = new GroupWebRTCManager({
    roomId: ROOM_ID,
    currentUserId: 'user_peer_promo',
    isHost: false,
    isSpeaker: false,
    navigator: mockNav9
  });
  const pcHost = peerPromoManager.createPeerConnection('user_host_remote');
  expect(peerPromoManager.getPeer('user_host_remote') === pcHost, '9. Pre-existing peer connection established');
  peerPromoManager.setRole({ isHost: false, isSpeaker: true });
  await new Promise((r) => setTimeout(r, 20));
  expect(!pcHost.closed, '9. Existing peers are not blindly destroyed on promotion');
  expect(peerPromoManager.getPeer('user_host_remote') === pcHost, '9. Same peer connection retained');

  // Req 10: Existing peers are marked/recognized as requiring role transition handling
  const needsReneg = peerPromoManager.getNeedsRenegotiation();
  expect(needsReneg.has('user_host_remote'), '10. Existing peers are marked/recognized as requiring role transition handling');

  // ──────────────────────────────────────────────────────────────────
  // TEST GROUP 3: DEMOTION LIFECYCLE (Requirements 11 - 15)
  // ──────────────────────────────────────────────────────────────────

  // Req 11 & 12 & 13: Demotion stops local microphone publishing & releases tracks
  const mockNav11 = createMockNavigator();
  const demoteManager = new GroupWebRTCManager({
    roomId: ROOM_ID,
    currentUserId: 'user_demote_1',
    isHost: false,
    isSpeaker: true,
    isPublisher: true,
    navigator: mockNav11
  });
  const activeStream = await demoteManager.startLocalAudio();
  const streamTrack = activeStream.getAudioTracks()[0];
  expect(demoteManager.getLocalStream() !== null, '11. Speaker has active local audio');
  expect(streamTrack.stopped === false, '11. Microphone track is active');

  demoteManager.setRole({ isHost: false, isSpeaker: false });
  expect(demoteManager.getIsPublisher() === false, '11. Demotion stops local microphone publishing');
  expect(streamTrack.stopped === true, '12. Local microphone tracks are released according to lifecycle (track.stop())');
  expect(demoteManager.getLocalStream() === null, '13. localStream is cleared to null when microphone is released');

  // Req 14 & 15: Valid publisher connections remain; listener-to-listener connections removed
  const mockNav14 = createMockNavigator();
  const meshDemoteManager = new GroupWebRTCManager({
    roomId: ROOM_ID,
    currentUserId: 'user_speaker_mesh',
    isHost: false,
    isSpeaker: true,
    isPublisher: true,
    navigator: mockNav14
  });
  await meshDemoteManager.startLocalAudio();

  // Create connections: one to host, one to a fellow listener
  const pcToHost = meshDemoteManager.createPeerConnection('host_123');
  const pcToListener = meshDemoteManager.createPeerConnection('listener_456');

  // Roster before demotion:
  const roster = [
    { id: 'user_speaker_mesh', role: 'speaker' },
    { id: 'host_123', role: 'host' },
    { id: 'listener_456', role: 'listener' }
  ];
  await meshDemoteManager.syncParticipants(roster);
  expect(meshDemoteManager.getPeer('host_123') !== null, '14. Connected to host');
  expect(meshDemoteManager.getPeer('listener_456') !== null, '14. Connected to listener as speaker');

  // Demote user to listener
  const updatedRosterAfterDemotion = [
    { id: 'user_speaker_mesh', role: 'listener' },
    { id: 'host_123', role: 'host' },
    { id: 'listener_456', role: 'listener' }
  ];
  meshDemoteManager.setRole({ isHost: false, isSpeaker: false });
  await meshDemoteManager.syncParticipants(updatedRosterAfterDemotion);

  expect(meshDemoteManager.getPeer('host_123') !== null, '14. Valid publisher connections remain after demotion');
  expect(!pcToHost.closed, '14. Host peer connection remains alive to receive stage audio');
  expect(meshDemoteManager.getPeer('listener_456') === null, '15. Listener-to-listener connections are removed');
  expect(pcToListener.closed === true, '15. Listener-to-listener peer was safely closed and pruned');

  // ──────────────────────────────────────────────────────────────────
  // TEST GROUP 4: RAPID CHANGES & RACE PROTECTION (Requirements 16 - 18)
  // ──────────────────────────────────────────────────────────────────

  // Req 16: Promote -> demote while getUserMedia is pending is safe
  let resolveGUM;
  const delayedGUM = () => new Promise((resolve) => {
    resolveGUM = resolve;
  });
  const mockNavDelayed = {
    mediaDevices: {
      getUserMedia: delayedGUM
    }
  };

  const raceManager = new GroupWebRTCManager({
    roomId: ROOM_ID,
    currentUserId: 'user_race_1',
    isHost: false,
    isSpeaker: false,
    navigator: mockNavDelayed
  });

  // Promote triggers GUM
  raceManager.setRole({ isHost: false, isSpeaker: true });
  // Demote immediately before GUM resolves!
  raceManager.setRole({ isHost: false, isSpeaker: false });
  expect(raceManager.getIsPublisher() === false, '16. Demoted before getUserMedia resolved');

  // Now resolve GUM
  const lateStream = new MockMediaStream();
  const lateTrack = lateStream.getAudioTracks()[0];
  resolveGUM(lateStream);
  await new Promise((r) => setTimeout(r, 20));

  expect(lateTrack.stopped === true, '16. Promote -> demote while getUserMedia is pending is safe: late stream stopped immediately');
  expect(raceManager.getLocalStream() === null, '16. Manager does not leak localStream if demoted while acquisition was pending');

  // Req 17: Repeated promotion/demotion does not leak streams
  const mockNav17 = createMockNavigator();
  const toggleManager = new GroupWebRTCManager({
    roomId: ROOM_ID,
    currentUserId: 'user_toggle',
    isHost: false,
    isSpeaker: false,
    navigator: mockNav17
  });

  for (let i = 0; i < 5; i++) {
    toggleManager.setRole({ isSpeaker: true });
    await new Promise((r) => setTimeout(r, 10));
    toggleManager.setRole({ isSpeaker: false });
    await new Promise((r) => setTimeout(r, 10));
  }
  expect(toggleManager.getLocalStream() === null, '17. Repeated promotion/demotion does not leak streams');
  expect(toggleManager.getIsPublisher() === false, '17. Final role state is strictly listener');

  // Req 18: No duplicate peer connections are created
  const mockNav18 = createMockNavigator();
  const socket18 = new MockSocket();
  const dupManager = new GroupWebRTCManager({
    roomId: ROOM_ID,
    socket: socket18,
    currentUserId: 'user_dup_1',
    isHost: false,
    isSpeaker: true,
    isPublisher: true,
    navigator: mockNav18
  });
  await dupManager.startLocalAudio();

  const dupRoster = [
    { id: 'user_dup_1', role: 'speaker' },
    { id: 'listener_target', role: 'listener' }
  ];
  await dupManager.syncParticipants(dupRoster);
  const pcInitial = dupManager.getPeer('listener_target');
  expect(pcInitial !== null, '18. Initial peer connection created');

  // Call syncParticipants repeatedly with same participants
  await dupManager.syncParticipants(dupRoster);
  await dupManager.syncParticipants(dupRoster);
  expect(dupManager.getPeer('listener_target') === pcInitial, '18. No duplicate peer connections are created on sync');

  // ──────────────────────────────────────────────────────────────────
  // TEST GROUP 5: PARTICIPANT SYNCHRONIZATION (Requirements 19 - 22)
  // ──────────────────────────────────────────────────────────────────

  // Req 19: Publisher -> listener relationship remains valid
  const socket19 = new MockSocket();
  const pubSyncManager = new GroupWebRTCManager({
    roomId: ROOM_ID,
    socket: socket19,
    currentUserId: 'pub_user_19',
    isHost: true,
    isPublisher: true,
    navigator: createMockNavigator()
  });
  await pubSyncManager.startLocalAudio();
  await pubSyncManager.syncParticipants([
    { id: 'pub_user_19', role: 'host' },
    { id: 'listener_target_19', role: 'listener' }
  ]);
  expect(pubSyncManager.getPeer('listener_target_19') !== null, '19. Publisher -> listener relationship remains valid (peer created)');
  const offerEmitted = socket19.emitted.find((e) => e.event === 'room:webrtc_offer' && e.payload.targetUserId === 'listener_target_19');
  expect(offerEmitted !== undefined, '19. Publisher initiated offer for listener');

  // Req 20: Listener -> publisher waits for publisher offer
  const socket20 = new MockSocket();
  const lisSyncManager = new GroupWebRTCManager({
    roomId: ROOM_ID,
    socket: socket20,
    currentUserId: 'lis_user_20',
    isHost: false,
    isSpeaker: false,
    isPublisher: false,
    navigator: createMockNavigator()
  });
  await lisSyncManager.syncParticipants([
    { id: 'lis_user_20', role: 'listener' },
    { id: 'pub_target_20', role: 'host' }
  ]);
  expect(lisSyncManager.getPeer('pub_target_20') === null, '20. Listener -> publisher waits for publisher offer (does not initiate peer)');
  expect(socket20.emitted.length === 0, '20. Listener did not send offer');

  // Req 21: Publisher <-> publisher deterministic rule remains unchanged
  const socket21A = new MockSocket();
  const socket21B = new MockSocket();
  const pubA = new GroupWebRTCManager({
    roomId: ROOM_ID,
    socket: socket21A,
    currentUserId: 'aaa_pub', // smaller ID
    isHost: false,
    isSpeaker: true,
    isPublisher: true,
    navigator: createMockNavigator()
  });
  const pubB = new GroupWebRTCManager({
    roomId: ROOM_ID,
    socket: socket21B,
    currentUserId: 'zzz_pub', // larger ID
    isHost: true,
    isPublisher: true,
    navigator: createMockNavigator()
  });
  await pubA.startLocalAudio();
  await pubB.startLocalAudio();

  const pubRoster = [
    { id: 'aaa_pub', role: 'speaker' },
    { id: 'zzz_pub', role: 'host' }
  ];
  await pubA.syncParticipants(pubRoster);
  await pubB.syncParticipants(pubRoster);

  expect(socket21A.emitted.some((e) => e.event === 'room:webrtc_offer' && e.payload.targetUserId === 'zzz_pub'), '21. Deterministic offerer (aaa_pub) initiates offer');
  expect(socket21B.emitted.filter((e) => e.event === 'room:webrtc_offer').length === 0, '21. Deterministic answerer (zzz_pub) does not initiate competing offer');

  // Req 22: Listener <-> listener connection is never retained
  const lisManagerA = new GroupWebRTCManager({
    roomId: ROOM_ID,
    currentUserId: 'lis_a',
    isHost: false,
    isSpeaker: false,
    isPublisher: false,
    navigator: createMockNavigator()
  });
  // Force a stale peer connection into manager as if left over from previous state
  const stalePeer = lisManagerA.createPeerConnection('lis_b');
  expect(lisManagerA.getPeer('lis_b') !== null, '22. Stale peer injected for test');

  await lisManagerA.syncParticipants([
    { id: 'lis_a', role: 'listener' },
    { id: 'lis_b', role: 'listener' }
  ]);
  expect(lisManagerA.getPeer('lis_b') === null, '22. Listener <-> listener connection is never retained (immediately pruned)');
  expect(stalePeer.closed === true, '22. Stale listener-to-listener peer closed');

  // ──────────────────────────────────────────────────────────────────
  // TEST GROUP 6: CLEANUP & TEARDOWN (Requirements 23 - 25)
  // ──────────────────────────────────────────────────────────────────

  // Req 23: destroy() after promotion cleans all resources
  const mockNav23 = createMockNavigator();
  const socket23 = new MockSocket();
  const cleanupPromoManager = new GroupWebRTCManager({
    roomId: ROOM_ID,
    socket: socket23,
    currentUserId: 'user_cleanup_promo',
    isHost: false,
    isSpeaker: false,
    navigator: mockNav23
  });
  cleanupPromoManager.setRole({ isSpeaker: true });
  await new Promise((r) => setTimeout(r, 20));
  const pcPromo = cleanupPromoManager.createPeerConnection('target_23');
  const promoStream = cleanupPromoManager.getLocalStream();

  cleanupPromoManager.destroy();
  expect(pcPromo.closed === true, '23. destroy() after promotion closes all peer connections');
  expect(promoStream.getTracks()[0].stopped === true, '23. destroy() after promotion stops local media stream');
  expect(cleanupPromoManager.getLocalStream() === null, '23. localStream is null after destroy');
  expect(cleanupPromoManager.getPeer('target_23') === null, '23. Peers map is cleared after destroy');

  // Req 24: destroy() after demotion cleans all resources
  const mockNav24 = createMockNavigator();
  const socket24 = new MockSocket();
  const cleanupDemoteManager = new GroupWebRTCManager({
    roomId: ROOM_ID,
    socket: socket24,
    currentUserId: 'user_cleanup_demote',
    isHost: false,
    isSpeaker: true,
    navigator: mockNav24
  });
  await cleanupDemoteManager.startLocalAudio();
  cleanupDemoteManager.setRole({ isSpeaker: false });
  cleanupDemoteManager.destroy();
  expect(cleanupDemoteManager.getLocalStream() === null, '24. destroy() after demotion cleans all resources');

  // Req 25: No socket/media/peer resources remain after room exit
  expect(socket23.listeners.get('room:webrtc_offer').length === 0, '25. room:webrtc_offer socket listener removed on destroy');
  expect(socket23.listeners.get('room:webrtc_answer').length === 0, '25. room:webrtc_answer socket listener removed on destroy');
  expect(socket23.listeners.get('room:webrtc_ice_candidate').length === 0, '25. room:webrtc_ice_candidate socket listener removed on destroy');

  console.log('================================================================');
  console.log('🎉 ALL 25/25 GROUP WEBRTC PHASE 3C-1 TESTS PASSED 100%!');
  console.log('================================================================');
}

runPhase3C1Tests().catch((err) => {
  console.error('Phase 3C-1 test failure:', err);
  process.exit(1);
});
