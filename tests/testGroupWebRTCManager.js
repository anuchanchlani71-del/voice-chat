/**
 * Test Suite: GroupWebRTCManager Media Foundation (Phase 3A)
 *
 * Verifies all 14 Phase 3A requirements:
 * 1. getUserMedia success (stores localStream)
 * 2. getUserMedia permission denied (structured error & microphonePermissionDenied = true)
 * 3. microphone unavailable / device_not_found error handling
 * 4. stopLocalAudio stops all tracks & clears stream
 * 5. mute disables audio tracks (track.enabled = false)
 * 6. unmute enables audio tracks (track.enabled = true)
 * 7. peer connection creation & configuration
 * 8. duplicate peer prevention / safe replacement
 * 9. remote ontrack handling & storage
 * 10. ICE candidate callback & Phase 2 emission
 * 11. peer cleanup (removePeer)
 * 12. cleanupAllPeers closes all connections & clears maps
 * 13. room isolation (different rooms do not leak signals)
 * 14. socket listener cleanup on destroy()
 */

const path = require('path');
const { pathToFileURL } = require('url');

function expect(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

// ── Mock Classes for Node.js Headless Testing ──────────────────────────

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

class MockRTCPeerConnection {
  constructor(config) {
    this.config = config;
    this.senders = [];
    this.connectionState = 'new';
    this.iceConnectionState = 'new';
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

  close() {
    this.closed = true;
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

  trigger(event, data) {
    if (!this.listeners.has(event)) return;
    this.listeners.get(event).forEach((h) => h(data));
  }
}

async function runPhase3ATests() {
  console.log('================================================================');
  console.log('🧪 GROUP WEBRTC PHASE 3A — MEDIA FOUNDATION TEST SUITE');
  console.log('================================================================\n');

  // Set up global mocks in Node environment
  globalThis.RTCPeerConnection = MockRTCPeerConnection;
  let mockGetUserMediaImplementation = async () => new MockMediaStream();

  const mockNavigator = {
    mediaDevices: {
      getUserMedia: (constraints) => mockGetUserMediaImplementation(constraints)
    }
  };

  // Dynamically import ESM groupWebRTCManager
  const managerModulePath = path.resolve(__dirname, '../../frontend/src/services/groupWebRTCManager.js');
  const { GroupWebRTCManager, createGroupWebRTCManager } = await import(pathToFileURL(managerModulePath).href);

  try {
    const mockSocket = new MockSocket();
    const manager = createGroupWebRTCManager({
      roomId: 'room_test_123',
      socket: mockSocket,
      navigator: mockNavigator
    });

    // ── Test 1: getUserMedia success ──
    const stream = await manager.startLocalAudio();
    expect(stream && stream.getAudioTracks().length > 0, '1. getUserMedia success: local stream acquired and stored');
    expect(manager.getLocalStream() === stream, '1. getLocalStream() returns active stream');

    // ── Test 2: Mute disables track ──
    manager.setMuted(true);
    expect(manager.getIsMuted() === true, '2. setMuted(true) updates isMuted state');
    expect(stream.getAudioTracks()[0].enabled === false, '2. Mute sets track.enabled = false without stopping track');
    expect(stream.getAudioTracks()[0].stopped === false, '2. Muted track remains active (not stopped)');

    // ── Test 3: Unmute enables track ──
    manager.setMuted(false);
    expect(manager.getIsMuted() === false, '3. setMuted(false) updates isMuted state');
    expect(stream.getAudioTracks()[0].enabled === true, '3. Unmute restores track.enabled = true');

    // ── Test 4: stopLocalAudio stops tracks ──
    manager.stopLocalAudio();
    expect(stream.getAudioTracks()[0].stopped === true, '4. stopLocalAudio() stops all local tracks');
    expect(manager.getLocalStream() === null, '4. stopLocalAudio() clears localStream to null');

    // Repeated call should safely no-op
    manager.stopLocalAudio();
    expect(manager.getLocalStream() === null, '4. Repeated stopLocalAudio() call is safe');

    // ── Test 5: getUserMedia permission denied handling ──
    mockGetUserMediaImplementation = async () => {
      const err = new Error('Permission denied');
      err.name = 'NotAllowedError';
      throw err;
    };

    let permErrorCaught = null;
    try {
      await manager.startLocalAudio();
    } catch (e) {
      permErrorCaught = e;
    }
    expect(permErrorCaught && permErrorCaught.code === 'permission_denied', '5. NotAllowedError returns structured code permission_denied');
    expect(manager.isPermissionDenied() === true, '5. microphonePermissionDenied flag set to true');

    // ── Test 6: Microphone unavailable / NotFoundError ──
    mockGetUserMediaImplementation = async () => {
      const err = new Error('No audio device');
      err.name = 'NotFoundError';
      throw err;
    };

    let notFoundErrorCaught = null;
    try {
      await manager.startLocalAudio();
    } catch (e) {
      notFoundErrorCaught = e;
    }
    expect(notFoundErrorCaught && notFoundErrorCaught.code === 'device_not_found', '6. NotFoundError returns structured code device_not_found');

    // Restore working getUserMedia
    mockGetUserMediaImplementation = async () => new MockMediaStream();
    await manager.startLocalAudio();

    // ── Test 7: RTCPeerConnection creation ──
    const pcUser1 = manager.createPeerConnection('user_peer_1');
    expect(pcUser1 && pcUser1 instanceof MockRTCPeerConnection, '7. createPeerConnection returns RTCPeerConnection instance');
    expect(manager.getPeer('user_peer_1') === pcUser1, '7. getPeer() returns created peer connection');
    expect(pcUser1.senders.length === 1, '7. addLocalTracks automatically attached local audio to publisher peer');

    // ── Test 8: Duplicate peer connection prevention ──
    const pcUser1Replacement = manager.createPeerConnection('user_peer_1');
    expect(pcUser1.closed === true, '8. Previous duplicate peer connection was closed safely');
    expect(manager.getPeer('user_peer_1') === pcUser1Replacement, '8. Peer map updated with replacement peer');

    // ── Test 9: Remote ontrack handling ──
    let remoteStreamReceived = null;
    manager.onRemoteStream = (remoteUserId, rStream) => {
      remoteStreamReceived = { remoteUserId, rStream };
    };

    const mockRemoteStream = new MockMediaStream();
    pcUser1Replacement.ontrack({ streams: [mockRemoteStream] });
    expect(manager.getRemoteStream('user_peer_1') === mockRemoteStream, '9. Remote stream stored in remoteStreams map');
    expect(remoteStreamReceived && remoteStreamReceived.remoteUserId === 'user_peer_1', '9. onRemoteStream callback invoked with correct remoteUserId');

    // ── Test 10: ICE candidate trickle & Phase 2 emission ──
    mockSocket.emitted = [];
    pcUser1Replacement.onicecandidate({ candidate: { candidate: 'candidate:dummy_ice 1 UDP' } });
    expect(mockSocket.emitted.length === 1, '10. onicecandidate triggers socket emission');
    expect(mockSocket.emitted[0].event === 'room:webrtc_ice_candidate', '10. Emitted event is room:webrtc_ice_candidate');
    expect(mockSocket.emitted[0].payload.roomId === 'room_test_123', '10. ICE candidate payload contains correct roomId');
    expect(mockSocket.emitted[0].payload.targetUserId === 'user_peer_1', '10. ICE candidate payload contains targetUserId');

    // ── Test 11: Phase 2 signaling emitters ──
    manager.sendOffer('user_peer_1', { type: 'offer', sdp: 'mock_offer_sdp' });
    const lastOffer = mockSocket.emitted[mockSocket.emitted.length - 1];
    expect(lastOffer.event === 'room:webrtc_offer' && lastOffer.payload.offer.sdp === 'mock_offer_sdp', '11. sendOffer emits room:webrtc_offer with payload');

    manager.sendAnswer('user_peer_1', { type: 'answer', sdp: 'mock_answer_sdp' });
    const lastAnswer = mockSocket.emitted[mockSocket.emitted.length - 1];
    expect(lastAnswer.event === 'room:webrtc_answer' && lastAnswer.payload.answer.sdp === 'mock_answer_sdp', '11. sendAnswer emits room:webrtc_answer with payload');

    // ── Test 12: Peer cleanup (removePeer) ──
    let streamRemovedUserId = null;
    manager.onRemoteStreamRemoved = (id) => {
      streamRemovedUserId = id;
    };
    manager.removePeer('user_peer_1');
    expect(pcUser1Replacement.closed === true, '12. removePeer closes peer connection');
    expect(manager.getPeer('user_peer_1') === null, '12. removePeer deletes peer from map');
    expect(manager.getRemoteStream('user_peer_1') === null, '12. removePeer deletes remote stream from map');
    expect(streamRemovedUserId === 'user_peer_1', '12. onRemoteStreamRemoved callback invoked');

    // ── Test 13: cleanupAllPeers ──
    const pcA = manager.createPeerConnection('user_A');
    const pcB = manager.createPeerConnection('user_B');
    expect(manager.peers.size === 2, '13. Multiple peers created');
    manager.cleanupAllPeers();
    expect(pcA.closed === true && pcB.closed === true, '13. cleanupAllPeers closes all peer connections');
    expect(manager.peers.size === 0, '13. cleanupAllPeers clears internal peer map');

    // ── Test 14: Room isolation (rejects cross-room signaling) ──
    let receivedOtherRoomSignal = false;
    manager.onSignalingOffer = () => {
      receivedOtherRoomSignal = true;
    };
    // Emit signal for another room
    mockSocket.trigger('room:webrtc_offer', { roomId: 'different_room_456', fromUserId: 'other_user' });
    expect(!receivedOtherRoomSignal, '14. Room isolation: signals for different rooms are strictly ignored');

    // Emit signal for same room
    let receivedSameRoomSignal = false;
    manager.onSignalingOffer = (data) => {
      if (data.fromUserId === 'valid_user') receivedSameRoomSignal = true;
    };
    mockSocket.trigger('room:webrtc_offer', { roomId: 'room_test_123', fromUserId: 'valid_user' });
    expect(receivedSameRoomSignal === true, '14. Room isolation: signals matching active roomId are received');

    // ── Test 15: Manager destroy() unregisters socket listeners and releases all media ──
    manager.destroy();
    expect(mockSocket.listeners.get('room:webrtc_offer').length === 0, '15. destroy() unregisters room:webrtc_offer socket listener');
    expect(mockSocket.listeners.get('room:webrtc_answer').length === 0, '15. destroy() unregisters room:webrtc_answer socket listener');
    expect(mockSocket.listeners.get('room:webrtc_ice_candidate').length === 0, '15. destroy() unregisters room:webrtc_ice_candidate socket listener');
    expect(manager.getLocalStream() === null, '15. destroy() stops local audio stream');

    console.log('\n================================================================');
    console.log('🎉 ALL 15/15 GROUP WEBRTC PHASE 3A FOUNDATION TESTS PASSED 100%!');
    console.log('================================================================\n');

  } catch (err) {
    console.error('❌ PHASE 3A TEST FAILED:', err.message);
    process.exitCode = 1;
  }
}

runPhase3ATests();
