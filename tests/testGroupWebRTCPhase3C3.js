/**
 * Focused Test Suite: Group WebRTC Real-Time Speaking Detection (Phase 3C-3)
 *
 * Verifies all required Phase 3C-3 behaviors:
 * 1. AudioContext initialization.
 * 2. AnalyserNode initialization.
 * 3. Existing localStream reused.
 * 4. No second microphone stream created.
 * 5. Speaking state becomes true above threshold.
 * 6. Speaking state becomes false below threshold.
 * 7. Speaking debounce prevents flicker.
 * 8. Mute forces speaking false.
 * 9. Unmute resumes detection.
 * 10. Speaker → Listener stops detection.
 * 11. Listener → Speaker starts detection.
 * 12. Repeated promotion does not create duplicate detector.
 * 13. Rapid role changes are safe.
 * 14. Destroy stops detection.
 * 15. Component/manager cleanup cancels detection loop.
 * 16. Late async callback after destroy is ignored.
 * 17. Microphone permission failure does not crash detector.
 * 18. AudioContext cleanup is performed.
 */

const path = require('path');
const { pathToFileURL } = require('url');

function expect(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

// ── Mock Classes for Web Audio & WebRTC in Node.js ──────────────────

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

class MockMediaStreamAudioSourceNode extends MockAudioNode {
  constructor(stream) {
    super();
    this.stream = stream;
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
      // Silence baseline (128 centered)
      array.fill(128);
    }
  }
}

class MockAudioContext {
  static instances = [];
  constructor() {
    this.state = 'running';
    this.closed = false;
    this.suspended = false;
    this.sourceNodes = [];
    this.analysers = [];
    MockAudioContext.instances.push(this);
  }
  createMediaStreamSource(stream) {
    const node = new MockMediaStreamAudioSourceNode(stream);
    this.sourceNodes.push(node);
    return node;
  }
  createAnalyser() {
    const node = new MockAnalyserNode();
    this.analysers.push(node);
    return node;
  }
  async resume() {
    this.state = 'running';
    this.suspended = false;
  }
  async suspend() {
    this.state = 'suspended';
    this.suspended = true;
  }
  async close() {
    this.state = 'closed';
    this.closed = true;
  }
}

class MockNavigator {
  constructor() {
    this.mediaDevices = {
      getUserMedia: async (constraints) => {
        MockNavigator.getUserMediaCallCount++;
        if (MockNavigator.shouldFailPermission) {
          const err = new Error('Permission denied');
          err.name = 'NotAllowedError';
          throw err;
        }
        return new MockMediaStream([new MockMediaStreamTrack('audio')]);
      }
    };
  }
}
MockNavigator.getUserMediaCallCount = 0;
MockNavigator.shouldFailPermission = false;

// ── Test Runner ───────────────────────────────────────────────────────

async function runPhase3C3Tests() {
  console.log('================================================================');
  console.log('⚡ GROUP WEBRTC PHASE 3C-3 — REAL-TIME SPEAKING DETECTION TESTS');
  console.log('================================================================\n');

  const modulePath = path.resolve(__dirname, '../../frontend/src/services/groupWebRTCManager.js');
  const moduleUrl = pathToFileURL(modulePath).href;
  const { GroupWebRTCManager } = await import(moduleUrl);

  const mockNav = new MockNavigator();

  // Helper to create manager instance with injected audioContextClass and navigator
  function createTestManager(opts = {}) {
    return new GroupWebRTCManager({
      roomId: 'test-room-phase3c3',
      currentUserId: 'usr_local_test',
      isHost: true,
      navigator: mockNav,
      audioContextClass: MockAudioContext,
      speakingThreshold: 0.04,
      speakingDebounceMs: 200,
      ...opts
    });
  }

  // ── TEST 1: AudioContext initialization ──────────────────────────────
  console.log('[Group 1: AudioContext & AnalyserNode Initialization]');
  {
    MockNavigator.getUserMediaCallCount = 0;
    MockAudioContext.instances = [];

    const mgr = createTestManager();
    await mgr.startLocalAudio();

    expect(mgr.getAudioContext() instanceof MockAudioContext, '1. AudioContext is successfully created and initialized');
    expect(mgr.getAudioContext().state === 'running', '1. AudioContext is in running state');

    // ── TEST 2: AnalyserNode initialization ────────────────────────────
    const analyser = mgr.getLocalAnalyserNode();
    expect(analyser instanceof MockAnalyserNode, '2. AnalyserNode is created and attached');
    expect(analyser.fftSize === 512, '2. Analyser fftSize configured (512)');

    // ── TEST 3 & 4: Existing localStream reused, no second getUserMedia ─
    const stream1 = mgr.getLocalStream();
    expect(stream1 !== null, '3. Local audio stream acquired');
    expect(MockNavigator.getUserMediaCallCount === 1, '3. Exactly 1 getUserMedia call was made');

    // Speaking detector uses this stream
    expect(mgr.getAudioContext().sourceNodes[0].stream === stream1, '3. AudioContext source node uses existing localStream');

    await mgr.startLocalAudio(); // Calling again when already acquired
    expect(MockNavigator.getUserMediaCallCount === 1, '4. No second microphone stream created when audio already active');

    mgr.destroy();
  }

  // ── TEST 5 & 6: Speaking State Above / Below Threshold ───────────────
  console.log('\n[Group 2: Speaking Threshold Evaluation]');
  {
    const mgr = createTestManager();
    let speakingEvents = [];
    mgr.onLocalSpeakingChange = (speaking) => {
      speakingEvents.push(speaking);
    };

    await mgr.startLocalAudio();
    const analyser = mgr.getLocalAnalyserNode();

    // Baseline: silence (samples = 128)
    analyser.customSamples = [128, 128, 128, 128];
    mgr.analyzeSpeakingNow();
    expect(mgr.getLocalIsSpeaking() === false, '6. Speaking state is false during silence');

    // Audio above threshold: simulate speech wave amplitude (100 and 156 -> normalized amplitude ~0.22, RMS ~0.22 > 0.04)
    analyser.customSamples = [100, 156, 100, 156];
    mgr.analyzeSpeakingNow();
    expect(mgr.getLocalIsSpeaking() === true, '5. Speaking state becomes true above threshold');
    expect(speakingEvents[speakingEvents.length - 1] === true, '5. onLocalSpeakingChange callback fired with true');

    // Silence again: below threshold
    analyser.customSamples = [128, 128, 128, 128];

    // Immediate check (within debounce window < 200ms)
    mgr.analyzeSpeakingNow();
    expect(mgr.getLocalIsSpeaking() === true, '7. Speaking debounce prevents immediate flicker on silent sample');

    // Wait past debounce window (> 210ms)
    await new Promise((r) => setTimeout(r, 220));
    mgr.analyzeSpeakingNow();
    expect(mgr.getLocalIsSpeaking() === false, '6. Speaking state transitions to false after silence exceeds debounce window');
    expect(speakingEvents[speakingEvents.length - 1] === false, '6. onLocalSpeakingChange fired with false after debounce');

    mgr.destroy();
  }

  // ── TEST 8 & 9: Mute Behavior ────────────────────────────────────────
  console.log('\n[Group 3: Mute & Unmute Lifecycle]');
  {
    const mgr = createTestManager();
    let speakingEvents = [];
    mgr.onLocalSpeakingChange = (speaking) => {
      speakingEvents.push(speaking);
    };

    await mgr.startLocalAudio();
    const analyser = mgr.getLocalAnalyserNode();

    // Speaking active
    analyser.customSamples = [100, 156, 100, 156];
    mgr.analyzeSpeakingNow();
    expect(mgr.getLocalIsSpeaking() === true, '8. User is initially speaking');

    // Mute microphone
    mgr.setMuted(true);
    expect(mgr.getLocalIsSpeaking() === false, '8. Mute forces speaking state to false immediately');
    expect(speakingEvents[speakingEvents.length - 1] === false, '8. onLocalSpeakingChange fired with false on mute');

    // Analyzing while muted remains false even with sound
    analyser.customSamples = [90, 166, 90, 166];
    mgr.analyzeSpeakingNow();
    expect(mgr.getLocalIsSpeaking() === false, '8. Speaking remains false while isMuted is true despite audio signal');

    // Unmute
    mgr.setMuted(false);
    expect(mgr.getIsMuted() === false, '9. Microphone is unmuted');
    mgr.analyzeSpeakingNow();
    expect(mgr.getLocalIsSpeaking() === true, '9. Unmute allows speaking detection to resume normally');

    mgr.destroy();
  }

  // ── TEST 10 & 11: Role Transitions (Speaker <-> Listener) ───────────
  console.log('\n[Group 4: Promotion & Demotion Role Transitions]');
  {
    const mgr = createTestManager({ isHost: false, isSpeaker: false });
    expect(mgr.getIsPublisher() === false, '10. Initial role is Listener');
    expect(mgr.isSpeakingDetectorActive() === false, '10. Speaking detector is inactive for Listener');

    // Promote to Speaker
    mgr.setRole({ isHost: false, isSpeaker: true });
    expect(mgr.getIsPublisher() === true, '11. Promoted to Speaker');

    // startLocalAudio automatically triggered upon promotion
    await new Promise((r) => setTimeout(r, 50));
    expect(mgr.isSpeakingDetectorActive() === true, '11. Listener -> Speaker starts speaking detection');
    expect(mgr.getLocalAnalyserNode() !== null, '11. Analyser node active after promotion');

    // Demote to Listener
    mgr.setRole({ isHost: false, isSpeaker: false });
    expect(mgr.getIsPublisher() === false, '10. Demoted to Listener');
    expect(mgr.isSpeakingDetectorActive() === false, '10. Speaker -> Listener stops speaking detection');
    expect(mgr.getLocalIsSpeaking() === false, '10. isSpeaking reset to false upon demotion');

    // ── TEST 12: Repeated promotion does not duplicate detector ────────
    mgr.setRole({ isHost: false, isSpeaker: true });
    await new Promise((r) => setTimeout(r, 50));
    const firstAnalyser = mgr.getLocalAnalyserNode();

    // Trigger promotion role again
    mgr.setRole({ isHost: true, isSpeaker: false });
    const secondAnalyser = mgr.getLocalAnalyserNode();
    expect(firstAnalyser === secondAnalyser, '12. Repeated promotion does not duplicate detector nodes');

    mgr.destroy();
  }

  // ── TEST 13: Rapid Role Changes ──────────────────────────────────────
  console.log('\n[Group 5: Rapid Role Changes]');
  {
    const mgr = createTestManager({ isHost: false, isSpeaker: false });

    // Rapid toggle: Listener -> Speaker -> Listener -> Speaker -> Listener
    mgr.setRole({ isSpeaker: true });
    mgr.setRole({ isSpeaker: false });
    mgr.setRole({ isSpeaker: true });
    mgr.setRole({ isSpeaker: false });

    await new Promise((r) => setTimeout(r, 60));
    expect(mgr.getIsPublisher() === false, '13. Final role is Listener');
    expect(mgr.isSpeakingDetectorActive() === false, '13. Speaking detector is safely inactive after rapid role toggles');
    expect(mgr.getLocalStream() === null, '13. Local stream is stopped after final demotion');

    mgr.destroy();
  }

  // ── TEST 14 & 15: Destroy & Cleanup ──────────────────────────────────
  console.log('\n[Group 6: Teardown, Cleanup & Safety]');
  {
    const mgr = createTestManager();
    await mgr.startLocalAudio();
    expect(mgr.isSpeakingDetectorActive() === true, '14. Detector is active before destroy');

    const ctx = mgr.getAudioContext();
    mgr.destroy();

    expect(mgr.isSpeakingDetectorActive() === false, '14. Destroy stops speaking detection immediately');
    expect(mgr.getLocalAnalyserNode() === null, '15. Analyser node disconnected and cleared on destroy');
    expect(mgr.getLocalIsSpeaking() === false, '15. isSpeaking reset to false on destroy');

    // ── TEST 18: AudioContext cleanup ──────────────────────────────────
    expect(ctx.closed === true, '18. AudioContext close() was invoked on destroy');

    // ── TEST 16: Late async callbacks after destroy ────────────────────
    mgr.analyzeSpeakingNow();
    expect(mgr.getLocalIsSpeaking() === false, '16. Late analysis call after destroy is completely ignored');
  }

  // ── TEST 17: Microphone Permission Failure Handling ──────────────────
  console.log('\n[Group 7: Microphone Permission Failure Protection]');
  {
    MockNavigator.shouldFailPermission = true;
    const mgr = createTestManager();

    let threw = false;
    try {
      await mgr.startLocalAudio();
    } catch (e) {
      threw = true;
    }
    expect(threw === true, '17. Permission failure caught cleanly');
    expect(mgr.isPermissionDenied() === true, '17. Microphone permission denied recorded');
    expect(mgr.isSpeakingDetectorActive() === false, '17. Speaking detector did not crash or activate on permission failure');
    expect(mgr.getLocalIsSpeaking() === false, '17. isSpeaking remains false when permission denied');

    MockNavigator.shouldFailPermission = false;
    mgr.destroy();
  }

  console.log('\n================================================================');
  console.log('🎉 ALL 18/18 GROUP WEBRTC PHASE 3C-3 TESTS PASSED 100%!');
  console.log('================================================================');
}

runPhase3C3Tests().catch((err) => {
  console.error('\n❌ TEST RUNNER FAILED:', err);
  process.exit(1);
});
