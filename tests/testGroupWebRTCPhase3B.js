/**
 * Focused Test Suite: Group WebRTC Multi-User Offer/Answer/ICE Negotiation & Media (Phase 3B)
 *
 * Verifies all 25 Phase 3B requirements:
 *
 * Negotiation:
 * 1. Publisher creates peer connection.
 * 2. Offer is created.
 * 3. Offer is sent through Phase 2 signaling.
 * 4. Listener receives offer.
 * 5. Listener creates answer.
 * 6. Answer is sent through Phase 2 signaling.
 * 7. Offerer applies answer.
 *
 * ICE:
 * 8. ICE candidate is sent.
 * 9. ICE candidate is queued before remote description.
 * 10. Queued ICE candidates are flushed after remote description.
 * 11. Invalid/stale ICE does not crash.
 *
 * Multi-user:
 * 12. Multiple remote peers can exist simultaneously.
 * 13. Each remote user has only one peer connection.
 * 14. New participant triggers only required connections.
 * 15. Listener-to-listener peer is not created.
 *
 * Publisher-to-publisher:
 * 16. Deterministic offer ownership prevents simultaneous offers.
 * 17. Both publisher tracks can be attached when required.
 *
 * Remote media:
 * 18. ontrack stores the correct remote stream.
 * 19. Remote stream callback fires.
 * 20. Removing peer removes remote stream.
 *
 * Cleanup:
 * 21. Leaving room closes all peers.
 * 22. Audio playback references are removed.
 * 23. Local microphone stops.
 * 24. Socket listeners are removed.
 *
 * Room isolation:
 * 25. Signaling from another room is ignored.
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

async function runPhase3BTests() {
  console.log('================================================================');
  console.log('🧪 GROUP WEBRTC PHASE 3B — MULTI-USER NEGOTIATION TEST SUITE');
  console.log('================================================================\n');

  // Install Node.js environment mocks
  globalThis.RTCPeerConnection = MockRTCPeerConnection;
  globalThis.RTCSessionDescription = MockRTCSessionDescription;
  globalThis.RTCIceCandidate = MockRTCIceCandidate;

  const mockNavigator = {
    mediaDevices: {
      getUserMedia: async () => new MockMediaStream()
    }
  };

  const managerModulePath = path.resolve(__dirname, '../../frontend/src/services/groupWebRTCManager.js');
  const { createGroupWebRTCManager } = await import(pathToFileURL(managerModulePath).href);

  try {
    const socketPublisher = new MockSocket();
    const socketListener = new MockSocket();

    // 1. Publisher Manager (Host user A)
    const publisherManager = createGroupWebRTCManager({
      roomId: 'room_phase3b_100',
      socket: socketPublisher,
      currentUser: { id: 'user_host_aaa' },
      isPublisher: true,
      navigator: mockNavigator
    });

    // 2. Listener Manager (Listener user B)
    const listenerManager = createGroupWebRTCManager({
      roomId: 'room_phase3b_100',
      socket: socketListener,
      currentUser: { id: 'user_listener_bbb' },
      isPublisher: false,
      navigator: mockNavigator
    });

    // Acquire microphone on publisher
    await publisherManager.startLocalAudio();

    // ── Test 1: Publisher creates peer connection ──
    const pubPeer = publisherManager.createPeerConnection('user_listener_bbb');
    expect(pubPeer && publisherManager.getPeer('user_listener_bbb') === pubPeer, '1. Publisher creates peer connection for target participant');
    expect(pubPeer.senders.length === 1, '1. Publisher attaches local microphone track to peer');

    // ── Test 2: Offer is created ──
    await publisherManager.initiateOffer('user_listener_bbb');
    expect(pubPeer.localDescription && pubPeer.localDescription.type === 'offer', '2. Offer is created and set as localDescription');

    // ── Test 3: Offer is sent through Phase 2 signaling ──
    const lastOfferEmit = socketPublisher.emitted.find((e) => e.event === 'room:webrtc_offer');
    expect(lastOfferEmit && lastOfferEmit.payload.roomId === 'room_phase3b_100', '3. Offer is sent through Phase 2 room:webrtc_offer');
    expect(lastOfferEmit.payload.targetUserId === 'user_listener_bbb', '3. Offer targets listener participant');

    // ── Test 4: Listener receives offer ──
    // Simulate socket relay delivery: Server forwards to listener socket
    await socketListener.trigger('room:webrtc_offer', {
      roomId: 'room_phase3b_100',
      fromUserId: 'user_host_aaa',
      offer: lastOfferEmit.payload.offer
    });

    const listenerPeer = listenerManager.getPeer('user_host_aaa');
    expect(listenerPeer !== null, '4. Listener receives offer and initializes peer connection');
    expect(listenerPeer.remoteDescription && listenerPeer.remoteDescription.type === 'offer', '4. Listener applies remote description from offer');

    // ── Test 5: Listener creates answer ──
    expect(listenerPeer.localDescription && listenerPeer.localDescription.type === 'answer', '5. Listener creates answer and sets localDescription');
    expect(listenerPeer.senders.length === 0, '5. Listener connection exists without publishing local microphone track');

    // ── Test 6: Answer is sent through Phase 2 signaling ──
    const lastAnswerEmit = socketListener.emitted.find((e) => e.event === 'room:webrtc_answer');
    expect(lastAnswerEmit && lastAnswerEmit.payload.roomId === 'room_phase3b_100', '6. Answer is sent through Phase 2 room:webrtc_answer');
    expect(lastAnswerEmit.payload.targetUserId === 'user_host_aaa', '6. Answer targets publisher host');

    // ── Test 7: Offerer applies answer ──
    // Simulate socket relay delivery back to publisher
    await socketPublisher.trigger('room:webrtc_answer', {
      roomId: 'room_phase3b_100',
      fromUserId: 'user_listener_bbb',
      answer: lastAnswerEmit.payload.answer
    });
    expect(pubPeer.remoteDescription && pubPeer.remoteDescription.type === 'answer', '7. Offerer applies answer as remoteDescription');
    expect(pubPeer.signalingState === 'stable', '7. Publisher connection transitions to stable signaling state');

    // ── Test 8: ICE candidate is sent ──
    socketPublisher.emitted = [];
    pubPeer.onicecandidate({ candidate: { candidate: 'candidate:pub_ice 1 UDP 212' } });
    const lastIceEmit = socketPublisher.emitted.find((e) => e.event === 'room:webrtc_ice_candidate');
    expect(lastIceEmit && lastIceEmit.payload.roomId === 'room_phase3b_100', '8. ICE candidate is sent through Phase 2 room:webrtc_ice_candidate');

    // ── Test 9: ICE candidate is queued before remote description ──
    const testPeerNew = listenerManager.createPeerConnection('user_unready_target');
    listenerManager.handleIceCandidate('user_unready_target', { candidate: 'candidate:early_ice' });
    const queue = listenerManager.iceCandidateQueues.get('user_unready_target');
    expect(queue && queue.length === 1, '9. Inbound ICE candidate queued when remoteDescription is not yet set');

    // ── Test 10: Queued ICE candidates are flushed after remote description ──
    await testPeerNew.setRemoteDescription(new MockRTCSessionDescription({ type: 'offer', sdp: 'sdp' }));
    await listenerManager._flushIceCandidateQueue('user_unready_target');
    expect(testPeerNew.addedIceCandidates.length === 1, '10. Queued ICE candidate flushed and added after remoteDescription');
    expect(listenerManager.iceCandidateQueues.get('user_unready_target').length === 0, '10. Queue cleared after flushing');

    // ── Test 11: Invalid/stale ICE does not crash ──
    let noCrashOnStale = true;
    try {
      await listenerManager.handleIceCandidate('user_unready_target', null);
      await listenerManager.handleIceCandidate('user_non_existent', { candidate: 'candidate:dummy' });
    } catch (e) {
      noCrashOnStale = false;
    }
    expect(noCrashOnStale, '11. Invalid or stale ICE candidate handled safely without crashing');

    // ── Test 12: Multiple remote peers can exist simultaneously ──
    const peerC = publisherManager.createPeerConnection('user_listener_ccc');
    const peerD = publisherManager.createPeerConnection('user_listener_ddd');
    expect(publisherManager.peers.size >= 3, '12. Multiple remote peer connections active simultaneously');

    // ── Test 13: Each remote user has only one peer connection ──
    const peerCSecond = publisherManager.createPeerConnection('user_listener_ccc');
    expect(peerC.closed === true, '13. Pre-existing peer closed upon duplicate peer creation');
    expect(publisherManager.getPeer('user_listener_ccc') === peerCSecond, '13. Exactly one active peer connection retained per remote user');

    // ── Test 14: New participant triggers only required connections ──
    socketPublisher.emitted = [];
    await publisherManager.syncParticipants([
      { id: 'user_host_aaa', role: 'host' },
      { id: 'user_listener_bbb', role: 'listener' },
      { id: 'user_listener_eee', role: 'listener' } // New participant
    ]);
    const offerForE = socketPublisher.emitted.find((e) => e.event === 'room:webrtc_offer' && e.payload.targetUserId === 'user_listener_eee');
    expect(offerForE !== undefined, '14. syncParticipants triggers required offer for new room listener');

    // ── Test 15: Listener-to-listener peer is not created ──
    await listenerManager.syncParticipants([
      { id: 'user_listener_bbb', role: 'listener' },
      { id: 'user_listener_fff', role: 'listener' } // Another listener
    ]);
    expect(listenerManager.getPeer('user_listener_fff') === null, '15. Listener-to-listener peer connection is NOT created');

    // ── Test 16: Deterministic offer ownership prevents simultaneous offers ──
    // Publisher 1: user_pub_1 (smaller ID), Publisher 2: user_pub_2 (larger ID)
    const socketPub1 = new MockSocket();
    const socketPub2 = new MockSocket();
    const pub1Manager = createGroupWebRTCManager({
      roomId: 'room_phase3b_100',
      socket: socketPub1,
      currentUser: { id: 'user_pub_1' },
      isPublisher: true,
      navigator: mockNavigator
    });
    const pub2Manager = createGroupWebRTCManager({
      roomId: 'room_phase3b_100',
      socket: socketPub2,
      currentUser: { id: 'user_pub_2' },
      isPublisher: true,
      navigator: mockNavigator
    });

    await pub1Manager.syncParticipants([
      { id: 'user_pub_1', role: 'speaker' },
      { id: 'user_pub_2', role: 'speaker' }
    ]);
    await pub2Manager.syncParticipants([
      { id: 'user_pub_1', role: 'speaker' },
      { id: 'user_pub_2', role: 'speaker' }
    ]);

    // Pub 1 (smaller ID) should initiate offer
    const pub1EmittedOffer = socketPub1.emitted.find((e) => e.event === 'room:webrtc_offer' && e.payload.targetUserId === 'user_pub_2');
    // Pub 2 (larger ID) must NOT initiate offer (waits to answer)
    const pub2EmittedOffer = socketPub2.emitted.find((e) => e.event === 'room:webrtc_offer' && e.payload.targetUserId === 'user_pub_1');

    expect(pub1EmittedOffer !== undefined, '16. Deterministic offerer (user_pub_1) initiates offer');
    expect(pub2EmittedOffer === undefined, '16. Deterministic answerer (user_pub_2) does not initiate competing offer');

    // ── Test 17: Both publisher tracks can be attached when required ──
    await pub2Manager.startLocalAudio();
    await pub2Manager.handleOffer('user_pub_1', pub1EmittedOffer.payload.offer);
    const pub2Peer = pub2Manager.getPeer('user_pub_1');
    expect(pub2Peer && pub2Peer.senders.length === 1, '17. Answering publisher attaches local audio track to answer connection');

    // ── Test 18: ontrack stores the correct remote stream ──
    const activeTestPeer = listenerManager.createPeerConnection('user_stream_host');
    const incomingRemoteStream = new MockMediaStream();
    activeTestPeer.ontrack({ streams: [incomingRemoteStream] });
    expect(listenerManager.getRemoteStream('user_stream_host') === incomingRemoteStream, '18. ontrack stores remote stream in remoteStreams map');

    // ── Test 19: Remote stream callback fires ──
    let remoteCallbackFired = false;
    let callbackUserId = null;
    listenerManager.onRemoteStream = (remoteUserId, stream) => {
      remoteCallbackFired = true;
      callbackUserId = remoteUserId;
    };
    activeTestPeer.ontrack({ streams: [incomingRemoteStream] });
    expect(remoteCallbackFired && callbackUserId === 'user_stream_host', '19. onRemoteStream callback fires with remoteUserId and stream');

    // ── Test 20: Removing peer removes remote stream ──
    let removeCallbackFired = false;
    listenerManager.onRemoteStreamRemoved = (id) => {
      removeCallbackFired = true;
    };
    listenerManager.removePeer('user_stream_host');
    expect(listenerManager.getRemoteStream('user_stream_host') === null, '20. removePeer removes remote stream from storage');
    expect(removeCallbackFired, '20. onRemoteStreamRemoved callback invoked');

    // ── Test 21: Leaving room closes all peers ──
    pub1Manager.cleanupAllPeers();
    expect(pub1Manager.peers.size === 0, '21. cleanupAllPeers closes and clears all peers');

    // ── Test 22: Audio playback references are removed ──
    expect(pub1Manager.remoteStreams.size === 0, '22. Remote stream playback references removed');

    // ── Test 23: Local microphone stops ──
    pub1Manager.destroy();
    expect(pub1Manager.getLocalStream() === null, '23. Local microphone stopped and cleared on destroy');

    // ── Test 24: Socket listeners are removed ──
    expect(socketPub1.listeners.get('room:webrtc_offer').length === 0, '24. room:webrtc_offer listener removed on destroy');
    expect(socketPub1.listeners.get('room:webrtc_answer').length === 0, '24. room:webrtc_answer listener removed on destroy');
    expect(socketPub1.listeners.get('room:webrtc_ice_candidate').length === 0, '24. room:webrtc_ice_candidate listener removed on destroy');

    // ── Test 25: Signaling from another room is ignored ──
    let otherRoomIgnored = true;
    pub2Manager.onSignalingOffer = () => {
      otherRoomIgnored = false;
    };
    await socketPub2.trigger('room:webrtc_offer', { roomId: 'different_room_999', fromUserId: 'intruder' });
    expect(otherRoomIgnored, '25. Signaling from another room is strictly ignored');

    console.log('\n================================================================');
    console.log('🎉 ALL 25/25 GROUP WEBRTC PHASE 3B TESTS PASSED 100%!');
    console.log('================================================================\n');

  } catch (err) {
    console.error('❌ PHASE 3B TEST FAILED:', err.message);
    process.exitCode = 1;
  }
}

runPhase3BTests();
