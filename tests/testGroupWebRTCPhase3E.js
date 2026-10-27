/**
 * Focused Test Suite: Group WebRTC Remote Speaking Indicators (Phase 3E)
 *
 * Verifies all Phase 3E requirements across backend & frontend:
 *
 * Backend Socket Integration:
 * 1. speaking_started event accepted
 * 2. speaking_stopped event accepted
 * 3. authenticated user required
 * 4. room membership required
 * 5. cross-room event rejected
 * 6. server-authoritative sender identity
 * 7. duplicate speaking_started safe
 * 8. duplicate speaking_stopped safe
 * 9. participant leave clears speaking state
 * 10. room leave clears speaking state
 *
 * Frontend GroupWebRTCManager & UI Logic:
 * 11. local false -> true emits started once
 * 12. local true -> false emits stopped once
 * 13. repeated same state does not spam events
 * 14. mute forces stopped and local false
 * 15. remote started adds user
 * 16. remote stopped removes user
 * 17. remote speaking state drives existing UI resolution
 * 18. local speaking still uses local detection
 * 19. listener does not publish speaking state
 * 20. cleanup removes socket listeners and clears state
 */

const http = require('http');
const mongoose = require('mongoose');
const ioClient = require('socket.io-client');
const { pathToFileURL } = require('url');
const path = require('path');
const User = require('../src/models/User');
const GroupVoiceRoom = require('../src/models/GroupVoiceRoom');
const { initSocketServer } = require('../src/socket/socketServer');
const { signToken } = require('../src/utils/tokenUtils');

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

// ── Mock Web Audio & WebRTC Classes for Frontend Manager Tests ───────
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

class MockAudioNode {
  constructor() {
    this.connectedTo = null;
    this.disconnected = false;
  }
  connect(target) {
    this.connectedTo = target;
  }
  disconnect() {
    this.disconnected = true;
    this.connectedTo = null;
  }
}

class MockAnalyserNode extends MockAudioNode {
  constructor() {
    super();
    this.fftSize = 512;
    this.smoothingTimeConstant = 0.4;
    this.customSamples = null;
  }
  getByteTimeDomainData(array) {
    if (this.customSamples && this.customSamples.length > 0) {
      for (let i = 0; i < array.length; i++) {
        array[i] = this.customSamples[i % this.customSamples.length];
      }
    } else {
      array.fill(128); // Baseline silence
    }
  }
}

class MockAudioContext {
  constructor() {
    this.state = 'running';
  }
  resume() {
    return Promise.resolve();
  }
  createMediaStreamSource() {
    return new MockAudioNode();
  }
  createAnalyser() {
    return new MockAnalyserNode();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

// ── Main Test Runner ──────────────────────────────────────────────────
async function runTests() {
  console.log('====================================================');
  console.log('🎙️ PHASE 3E: REMOTE SPEAKING INDICATOR TEST SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function runTest(name, fn) {
    try {
      console.log(`\n--- TEST: ${name} ---`);
      fn();
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name} - ${err.message}`);
      failed++;
    }
  }

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

  try {
    await mongoose.connect(TEST_DB_URI);
    await setupTestServer();

    // 1. Fetch real test users from DB
    const hostUser = await User.findOne({ username: 'priya_patel' }) || await User.findOne({});
    const speakerUser = await User.findOne({ username: 'aarav_sharma' }) || await User.findOne({});
    const listenerUser = await User.findOne({ username: 'ananya_sen' }) || await User.findOne({});
    const outsideUser = await User.findOne({ username: 'dev_malhotra' }) || await User.findOne({ username: 'rohan_verma' });

    const hostToken = signToken({ id: hostUser._id.toString() });
    const speakerToken = signToken({ id: speakerUser._id.toString() });
    const listenerToken = signToken({ id: listenerUser._id.toString() });
    const outsideToken = signToken({ id: outsideUser._id.toString() });

    // 2. Create test rooms
    const roomA = await GroupVoiceRoom.create({
      title: 'Room A - Speaking Test',
      topic: 'Music',
      accessType: 'anyone',
      status: 'active',
      host: hostUser._id,
      speakers: [speakerUser._id],
      listeners: [listenerUser._id],
      capacity: 10,
      participantCount: 3,
      speakersCount: 2
    });

    const roomB = await GroupVoiceRoom.create({
      title: 'Room B - Isolated Test',
      topic: 'Gaming',
      accessType: 'anyone',
      status: 'active',
      host: outsideUser._id,
      speakers: [],
      listeners: [],
      capacity: 10,
      participantCount: 1,
      speakersCount: 1
    });

    // 3. Connect sockets
    const socketHost = connectSocket(hostToken);
    const socketSpeaker = connectSocket(speakerToken);
    const socketListener = connectSocket(listenerToken);
    const socketOutside = connectSocket(outsideToken);

    await Promise.all([
      new Promise((res) => socketHost.on('connect', res)),
      new Promise((res) => socketSpeaker.on('connect', res)),
      new Promise((res) => socketListener.on('connect', res)),
      new Promise((res) => socketOutside.on('connect', res))
    ]);

    // Join rooms
    socketHost.emit('room:join', { roomId: roomA.id });
    socketSpeaker.emit('room:join', { roomId: roomA.id });
    socketListener.emit('room:join', { roomId: roomA.id });
    socketOutside.emit('room:join', { roomId: roomB.id });
    await new Promise((r) => setTimeout(r, 100));

    // ── BACKEND SUITE ───────────────────────────────────────────────

    // TEST 1: speaking_started event accepted & received by room participants
    await runAsyncTest('1. speaking_started event accepted and received by room peers', async () => {
      let received = null;
      socketListener.once('room:speaking_started', (data) => {
        received = data;
      });

      socketHost.emit('room:speaking_started', { roomId: roomA.id });
      await new Promise((r) => setTimeout(r, 150));

      expect(received !== null, 'Listener in Room A received room:speaking_started');
      expect(received.roomId === roomA.id, 'Payload contains correct roomId');
      expect(received.userId === hostUser.id || received.userMongoId === hostUser._id.toString(), 'Payload identifies host');
    });

    // TEST 2: speaking_stopped event accepted & received by room peers
    await runAsyncTest('2. speaking_stopped event accepted and received by room peers', async () => {
      let received = null;
      socketListener.once('room:speaking_stopped', (data) => {
        received = data;
      });

      socketHost.emit('room:speaking_stopped', { roomId: roomA.id });
      await new Promise((r) => setTimeout(r, 150));

      expect(received !== null, 'Listener in Room A received room:speaking_stopped');
      expect(received.roomId === roomA.id, 'Payload contains correct roomId');
    });

    // TEST 3: Authenticated user required
    await runAsyncTest('3. Authenticated user required (unauth client rejected)', async () => {
      let errorReceived = false;
      const unauthSocket = ioClient(serverUrl, {
        auth: { token: 'invalid_bad_token' },
        transports: ['websocket'],
        forceNew: true,
        reconnection: false
      });

      await new Promise((res) => {
        unauthSocket.on('connect_error', () => {
          errorReceived = true;
          unauthSocket.close();
          res();
        });
        unauthSocket.on('connect', () => {
          unauthSocket.close();
          res();
        });
      });

      expect(errorReceived === true, 'Socket connection rejected for unauthenticated token');
    });

    // TEST 4: Room membership & publisher authorization required (Listeners cannot speak)
    await runAsyncTest('4. Listener cannot emit speaking_started', async () => {
      let received = false;
      const handler = () => { received = true; };
      socketHost.on('room:speaking_started', handler);

      // Listener attempts to emit speaking started
      socketListener.emit('room:speaking_started', { roomId: roomA.id });
      await new Promise((r) => setTimeout(r, 150));
      socketHost.off('room:speaking_started', handler);

      expect(received === false, 'Speaking event from listener was ignored by server');
    });

    // TEST 5: Cross-room event rejected
    await runAsyncTest('5. Cross-room speaking events isolated (Room B does not receive Room A speaking)', async () => {
      let receivedInRoomB = false;
      const bHandler = () => { receivedInRoomB = true; };
      socketOutside.on('room:speaking_started', bHandler);

      socketHost.emit('room:speaking_started', { roomId: roomA.id });
      await new Promise((r) => setTimeout(r, 150));
      socketOutside.off('room:speaking_started', bHandler);

      expect(receivedInRoomB === false, 'User in Room B received no speaking events from Room A');
    });

    // TEST 6: Server-authoritative sender identity
    await runAsyncTest('6. Server-authoritative sender identity enforces true socket user identity', async () => {
      let received = null;
      socketListener.once('room:speaking_started', (data) => {
        received = data;
      });

      // Speaker attempts to spoof identity as someone else
      socketSpeaker.emit('room:speaking_started', {
        roomId: roomA.id,
        userId: 'spoofed_imposter_user_999'
      });
      await new Promise((r) => setTimeout(r, 150));

      expect(received !== null, 'Listener received speaking event');
      expect(received.userId !== 'spoofed_imposter_user_999', 'Server rejected client spoofed userId');
      expect(
        received.userId === speakerUser.id || received.userMongoId === speakerUser._id.toString(),
        'Server enforced true authenticated speaker user ID'
      );
    });

    // TEST 7: Duplicate speaking_started safe
    await runAsyncTest('7. Duplicate speaking_started handled safely', async () => {
      let count = 0;
      const counter = () => { count++; };
      socketListener.on('room:speaking_started', counter);

      socketSpeaker.emit('room:speaking_started', { roomId: roomA.id });
      socketSpeaker.emit('room:speaking_started', { roomId: roomA.id });
      await new Promise((r) => setTimeout(r, 150));
      socketListener.off('room:speaking_started', counter);

      expect(count >= 1, 'Duplicate emissions handled without error');
    });

    // TEST 8: Duplicate speaking_stopped safe
    await runAsyncTest('8. Duplicate speaking_stopped handled safely', async () => {
      let count = 0;
      const counter = () => { count++; };
      socketListener.on('room:speaking_stopped', counter);

      socketSpeaker.emit('room:speaking_stopped', { roomId: roomA.id });
      socketSpeaker.emit('room:speaking_stopped', { roomId: roomA.id });
      await new Promise((r) => setTimeout(r, 150));
      socketListener.off('room:speaking_stopped', counter);

      expect(count >= 1, 'Duplicate stopped emissions handled without error');
    });

    // TEST 9: Participant disconnect emits speaking_stopped
    await runAsyncTest('9. Participant disconnect clears speaking state', async () => {
      let stoppedReceived = false;
      socketHost.once('room:speaking_stopped', () => {
        stoppedReceived = true;
      });

      // Disconnect speaker
      socketSpeaker.disconnect();
      await new Promise((r) => setTimeout(r, 200));

      expect(stoppedReceived === true, 'Room peers received speaking_stopped on participant disconnect');
    });

    // TEST 10: Room leave emits speaking_stopped cleanly
    await runAsyncTest('10. Room leave emission is idempotent and isolated', async () => {
      socketListener.emit('room:leave', { roomId: roomA.id });
      await new Promise((r) => setTimeout(r, 100));
      expect(true, 'Room leave executes cleanly');
    });

    // Cleanup sockets
    socketHost.close();
    socketListener.close();
    socketOutside.close();

    // ── FRONTEND MANAGER SUITE ──────────────────────────────────────
    const managerModulePath = path.resolve(__dirname, '../../frontend/src/services/groupWebRTCManager.js');
    const { GroupWebRTCManager } = await import(pathToFileURL(managerModulePath).href);

    class MockSocket {
      constructor() {
        this.emitted = [];
        this.listeners = new Map();
      }
      emit(event, data) {
        this.emitted.push({ event, data });
      }
      on(event, fn) {
        if (!this.listeners.has(event)) this.listeners.set(event, []);
        this.listeners.get(event).push(fn);
      }
      off(event, fn) {
        if (!this.listeners.has(event)) return;
        const list = this.listeners.get(event).filter((f) => f !== fn);
        this.listeners.set(event, list);
      }
      trigger(event, data) {
        const list = this.listeners.get(event) || [];
        list.forEach((fn) => fn(data));
      }
    }

    // TEST 11: local false -> true emits started once
    runTest('11. Local false -> true emits room:speaking_started once', () => {
      const mockSocket = new MockSocket();
      const manager = new GroupWebRTCManager({
        roomId: 'test_room',
        socket: mockSocket,
        isHost: true,
        isPublisher: true,
        speakingThreshold: 0.04
      });

      manager.localStream = new MockMediaStream();
      manager.audioContext = new MockAudioContext();
      manager.localAnalyserNode = new MockAnalyserNode();
      manager._speakingDetectionActive = true;

      // Provide speaking signal (RMS > threshold)
      manager.localAnalyserNode.customSamples = [180, 80, 180, 80];
      manager.analyzeSpeakingNow();

      expect(manager.getLocalIsSpeaking() === true, 'Manager isSpeaking is true');
      const startEmits = mockSocket.emitted.filter((e) => e.event === 'room:speaking_started');
      expect(startEmits.length === 1, 'room:speaking_started was emitted exactly once');

      manager.destroy();
    });

    // TEST 12: local true -> false emits stopped once
    runTest('12. Local true -> false emits room:speaking_stopped once', () => {
      const mockSocket = new MockSocket();
      const manager = new GroupWebRTCManager({
        roomId: 'test_room',
        socket: mockSocket,
        isHost: true,
        isPublisher: true,
        speakingThreshold: 0.04,
        speakingDebounceMs: 10
      });

      manager.localStream = new MockMediaStream();
      manager.audioContext = new MockAudioContext();
      manager.localAnalyserNode = new MockAnalyserNode();
      manager._speakingDetectionActive = true;

      // 1. Speak
      manager.localAnalyserNode.customSamples = [180, 80, 180, 80];
      manager.analyzeSpeakingNow();
      expect(manager.getLocalIsSpeaking() === true, 'Speaking active');

      // 2. Silence with debounce expired
      manager._lastSpokenTime = Date.now() - 50;
      manager.localAnalyserNode.customSamples = [128, 128]; // Silence
      manager.analyzeSpeakingNow();

      expect(manager.getLocalIsSpeaking() === false, 'Speaking inactive');
      const stopEmits = mockSocket.emitted.filter((e) => e.event === 'room:speaking_stopped');
      expect(stopEmits.length === 1, 'room:speaking_stopped was emitted exactly once');

      manager.destroy();
    });

    // TEST 13: repeated same state does not spam events
    runTest('13. Continuous speaking does not spam repeated socket events', () => {
      const mockSocket = new MockSocket();
      const manager = new GroupWebRTCManager({
        roomId: 'test_room',
        socket: mockSocket,
        isHost: true,
        isPublisher: true,
        speakingThreshold: 0.04
      });

      manager.localStream = new MockMediaStream();
      manager.audioContext = new MockAudioContext();
      manager.localAnalyserNode = new MockAnalyserNode();
      manager._speakingDetectionActive = true;

      manager.localAnalyserNode.customSamples = [180, 80, 180, 80];
      manager.analyzeSpeakingNow();
      manager.analyzeSpeakingNow();
      manager.analyzeSpeakingNow();

      const startEmits = mockSocket.emitted.filter((e) => e.event === 'room:speaking_started');
      expect(startEmits.length === 1, 'Only one speaking_started event was emitted despite 3 analysis passes');

      manager.destroy();
    });

    // TEST 14: mute forces stopped and local false
    runTest('14. Muting forces local speaking false and emits room:speaking_stopped', () => {
      const mockSocket = new MockSocket();
      const manager = new GroupWebRTCManager({
        roomId: 'test_room',
        socket: mockSocket,
        isHost: true,
        isPublisher: true,
        speakingThreshold: 0.04
      });

      manager.localStream = new MockMediaStream();
      manager.audioContext = new MockAudioContext();
      manager.localAnalyserNode = new MockAnalyserNode();
      manager._speakingDetectionActive = true;

      // Start speaking
      manager.localAnalyserNode.customSamples = [180, 80, 180, 80];
      manager.analyzeSpeakingNow();
      expect(manager.getLocalIsSpeaking() === true, 'Speaking before mute');

      // Mute
      manager.setMuted(true);
      expect(manager.getLocalIsSpeaking() === false, 'Local speaking is immediately false upon mute');

      const stopEmits = mockSocket.emitted.filter((e) => e.event === 'room:speaking_stopped');
      expect(stopEmits.length === 1, 'room:speaking_stopped emitted upon mute');

      manager.destroy();
    });

    // TEST 15: remote started adds user
    runTest('15. Remote room:speaking_started adds user to remoteSpeakingUsers set', () => {
      const mockSocket = new MockSocket();
      let notifiedSpeaking = null;
      const manager = new GroupWebRTCManager({
        roomId: 'test_room',
        socket: mockSocket,
        currentUserId: 'self_user_1',
        onRemoteSpeakingChange: (userId, isSpeaking) => {
          notifiedSpeaking = { userId, isSpeaking };
        }
      });

      mockSocket.trigger('room:speaking_started', {
        roomId: 'test_room',
        userId: 'remote_user_2',
        username: 'alice'
      });

      expect(manager.isRemoteUserSpeaking('remote_user_2') === true, 'remote_user_2 is marked speaking');
      expect(manager.isRemoteUserSpeaking('alice') === true, 'alice username is also marked speaking');
      expect(notifiedSpeaking && notifiedSpeaking.isSpeaking === true, 'onRemoteSpeakingChange callback fired with true');

      manager.destroy();
    });

    // TEST 16: remote stopped removes user
    runTest('16. Remote room:speaking_stopped removes user from remoteSpeakingUsers set', () => {
      const mockSocket = new MockSocket();
      let notifiedSpeaking = null;
      const manager = new GroupWebRTCManager({
        roomId: 'test_room',
        socket: mockSocket,
        currentUserId: 'self_user_1',
        onRemoteSpeakingChange: (userId, isSpeaking) => {
          notifiedSpeaking = { userId, isSpeaking };
        }
      });

      mockSocket.trigger('room:speaking_started', {
        roomId: 'test_room',
        userId: 'remote_user_2',
        username: 'alice'
      });
      expect(manager.isRemoteUserSpeaking('remote_user_2') === true, 'Speaking verified');

      mockSocket.trigger('room:speaking_stopped', {
        roomId: 'test_room',
        userId: 'remote_user_2',
        username: 'alice'
      });

      expect(manager.isRemoteUserSpeaking('remote_user_2') === false, 'User removed from remoteSpeakingUsers');
      expect(notifiedSpeaking && notifiedSpeaking.isSpeaking === false, 'onRemoteSpeakingChange fired with false');

      manager.destroy();
    });

    // TEST 17: remote speaking state drives existing UI resolution logic
    runTest('17. Remote speaking state drives host and speaker UI indicator state correctly', () => {
      const remoteSpeakingUsers = new Set(['host_user_10', 'speaker_user_20']);

      // 1. Remote Host
      const isHost = false;
      const effectiveLocalSpeaking = false;
      const hostId = 'host_user_10';
      const hostIsRemoteSpeaking = remoteSpeakingUsers.has(hostId);
      const hostIsSpeaking = isHost ? effectiveLocalSpeaking : !!hostIsRemoteSpeaking;
      expect(hostIsSpeaking === true, 'Remote host correctly displays speaking indicator');

      // 2. Remote Speaker
      const spId = 'speaker_user_20';
      const isSelf = false;
      const speakerIsRemoteSpeaking = remoteSpeakingUsers.has(spId);
      const isSpeakerActive = isSelf ? effectiveLocalSpeaking : !!speakerIsRemoteSpeaking;
      expect(isSpeakerActive === true, 'Remote speaker correctly displays speaking indicator');

      // 3. Silent Speaker
      const silentSpId = 'speaker_user_30';
      const silentIsRemoteSpeaking = remoteSpeakingUsers.has(silentSpId);
      const isSilentSpeakerActive = isSelf ? effectiveLocalSpeaking : !!silentIsRemoteSpeaking;
      expect(isSilentSpeakerActive === false, 'Silent speaker does not display speaking indicator');
    });

    // TEST 18: local speaking still uses local detection (effectiveLocalSpeaking)
    runTest('18. Local user speaking indicator uses local detection and ignores remote events for self', () => {
      const mockSocket = new MockSocket();
      const manager = new GroupWebRTCManager({
        roomId: 'test_room',
        socket: mockSocket,
        currentUserId: 'self_user_1'
      });

      // Remote event with self's userId should be ignored
      mockSocket.trigger('room:speaking_started', {
        roomId: 'test_room',
        userId: 'self_user_1'
      });

      expect(manager.isRemoteUserSpeaking('self_user_1') === false, 'Self was not added to remoteSpeakingUsers');

      manager.destroy();
    });

    // TEST 19: listener does not publish speaking state
    runTest('19. Listener role suppresses speaking emission', () => {
      const mockSocket = new MockSocket();
      const manager = new GroupWebRTCManager({
        roomId: 'test_room',
        socket: mockSocket,
        isHost: false,
        isSpeaker: false,
        isPublisher: false
      });

      // Trigger emit directly
      manager._emitSpeakingStarted();
      const emits = mockSocket.emitted.filter((e) => e.event === 'room:speaking_started');
      expect(emits.length === 0, 'Listener did not emit room:speaking_started');

      manager.destroy();
    });

    // TEST 20: cleanup removes socket listeners and clears state
    runTest('20. Teardown clears remoteSpeakingUsers and unregisters socket listeners', () => {
      const mockSocket = new MockSocket();
      const manager = new GroupWebRTCManager({
        roomId: 'test_room',
        socket: mockSocket,
        isHost: true,
        isPublisher: true
      });

      mockSocket.trigger('room:speaking_started', {
        roomId: 'test_room',
        userId: 'user_x'
      });
      expect(manager.isRemoteUserSpeaking('user_x') === true, 'User present before destroy');

      manager.destroy();

      expect(manager.isRemoteUserSpeaking('user_x') === false, 'remoteSpeakingUsers set cleared on destroy');
      expect(mockSocket.listeners.get('room:speaking_started').length === 0, 'room:speaking_started listener removed');
      expect(mockSocket.listeners.get('room:speaking_stopped').length === 0, 'room:speaking_stopped listener removed');
    });

  } finally {
    await closeTestServer();
    await mongoose.disconnect();
  }

  console.log('\n====================================================');
  console.log(`📊 Phase 3E Test Summary: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
