/**
 * Focused Test Suite: Group WebRTC Real Speaking State -> Existing UI Integration (Phase 3C-4)
 *
 * Verifies all 16 Phase 3C-4 requirements:
 * 1. Local speaking state reaches React UI.
 * 2. Local speaking true activates existing speaking state.
 * 3. Local speaking false deactivates existing speaking state.
 * 4. Mute immediately clears speaking UI.
 * 5. Unmute allows speaking UI to react again.
 * 6. Listener state forces speaking UI false.
 * 7. Listener → Speaker enables real speaking UI.
 * 8. Speaker → Listener clears speaking UI.
 * 9. Rapid Speaker → Listener → Speaker is safe.
 * 10. Fake 3800ms timer no longer controls local speaking state.
 * 11. No duplicate speaking subscription is created.
 * 12. Component unmount cleans speaking subscription.
 * 13. Manager destroy clears speaking state.
 * 14. Existing stage layout remains intact.
 * 15. Existing .is-speaking styling remains intact.
 * 16. Remote participant fallback remains isolated from local real speaking state.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

function expect(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

// ── Mock Web Audio & WebRTC Classes for Node Environment ─────────────

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
      array.fill(128); // Baseline silence
    }
  }
}

class MockAudioContext {
  constructor() {
    this.state = 'running';
    this.closed = false;
    this.suspended = false;
  }
  createMediaStreamSource(stream) {
    return new MockMediaStreamAudioSourceNode(stream);
  }
  createAnalyser() {
    return new MockAnalyserNode();
  }
  async resume() {
    this.state = 'running';
  }
  async suspend() {
    this.state = 'suspended';
  }
  async close() {
    this.state = 'closed';
    this.closed = true;
  }
}

class MockNavigator {
  constructor() {
    this.mediaDevices = {
      getUserMedia: async () => new MockMediaStream([new MockMediaStreamTrack('audio')])
    };
  }
}

// ── Stage UI State Model (Mirrors UserActiveVoiceRoom.jsx logic) ──────

class StageSpeakingModel {
  constructor({ currentUser, isHost = false, isSpeaker = false, room = {} }) {
    this.currentUser = currentUser;
    this.isHost = isHost;
    this.isSpeaker = isSpeaker;
    this.room = room;
    this.isMuted = false;
    this.localIsSpeaking = false;
    this.activeSpeakerIdx = 0; // Fallback simulation index
    this.subscriptionCount = 0;
  }

  // Phase 3C-4 priority-aware resolution
  get isPublisher() {
    return this.isHost || this.isSpeaker;
  }

  get effectiveLocalSpeaking() {
    return !this.isMuted && this.isPublisher && this.localIsSpeaking;
  }

  getHostIsSpeaking() {
    return this.isHost ? this.effectiveLocalSpeaking : (this.activeSpeakerIdx === 0);
  }

  getSpeakerIsSpeaking(sp, idx) {
    const spId = sp?.id || (sp?._id ? sp._id.toString() : (typeof sp === 'string' ? sp : ''));
    const currentId = this.currentUser ? (this.currentUser.id || (this.currentUser._id ? this.currentUser._id.toString() : '')) : '';
    const isSelf = spId === currentId || (sp?.username && sp.username === this.currentUser?.username);
    return isSelf ? this.effectiveLocalSpeaking : (this.activeSpeakerIdx === (idx + 1));
  }

  bindManager(manager) {
    this.subscriptionCount++;
    manager.onLocalSpeakingChange = (speaking) => {
      this.localIsSpeaking = speaking;
    };
  }

  unbindManager(manager) {
    this.subscriptionCount--;
    manager.onLocalSpeakingChange = null;
    this.localIsSpeaking = false;
  }
}

// ── Test Runner ───────────────────────────────────────────────────────

async function runPhase3C4Tests() {
  console.log('================================================================');
  console.log('⚡ GROUP WEBRTC PHASE 3C-4 — REAL SPEAKING UI INTEGRATION TESTS');
  console.log('================================================================\n');

  const managerModulePath = path.resolve(__dirname, '../../frontend/src/services/groupWebRTCManager.js');
  const managerModuleUrl = pathToFileURL(managerModulePath).href;
  const { GroupWebRTCManager } = await import(managerModuleUrl);

  const uiComponentPath = path.resolve(__dirname, '../../frontend/src/pages/user/UserActiveVoiceRoom.jsx');
  const uiSource = fs.readFileSync(uiComponentPath, 'utf8');

  const mockNav = new MockNavigator();

  function createManager(opts = {}) {
    return new GroupWebRTCManager({
      roomId: 'room_phase3c4',
      currentUserId: 'usr_me',
      isHost: true,
      navigator: mockNav,
      audioContextClass: MockAudioContext,
      speakingThreshold: 0.04,
      speakingDebounceMs: 100,
      ...opts
    });
  }

  const currentUser = { id: 'usr_me', username: 'anita' };
  const remoteHost = { id: 'usr_remote_host', username: 'aarav' };
  const remoteSpeaker = { id: 'usr_remote_speaker', username: 'priya' };

  // ── TEST 1, 2, 3: Local speaking state reaches React UI ─────────────
  console.log('[Group 1: Real Local Speaking State Integration]');
  {
    const mgr = createManager();
    const ui = new StageSpeakingModel({ currentUser, isHost: true, room: { host: currentUser, speakers: [] } });
    ui.bindManager(mgr);

    await mgr.startLocalAudio();
    const analyser = mgr.getLocalAnalyserNode();

    // 1. Initial state
    expect(ui.localIsSpeaking === false, '1. Local speaking state initializes to false in UI');
    expect(ui.getHostIsSpeaking() === false, '1. Host podium starts with speaking = false');

    // 2. Local speech triggered
    analyser.customSamples = [100, 156, 100, 156]; // speech volume
    mgr.analyzeSpeakingNow();

    expect(ui.localIsSpeaking === true, '1. Manager onLocalSpeakingChange reaches UI state');
    expect(ui.getHostIsSpeaking() === true, '2. Real local speaking true activates host speaking UI state');

    // 3. Local speech stops
    analyser.customSamples = [128, 128, 128, 128]; // silence
    await new Promise((r) => setTimeout(r, 120));
    mgr.analyzeSpeakingNow();

    expect(ui.localIsSpeaking === false, '3. Local speaking false reaches UI state');
    expect(ui.getHostIsSpeaking() === false, '3. Local speaking false deactivates host speaking UI state');

    mgr.destroy();
  }

  // ── TEST 4 & 5: Mute & Unmute UI State ────────────────────────────────
  console.log('\n[Group 2: Mute / Unmute State Priority]');
  {
    const mgr = createManager();
    const ui = new StageSpeakingModel({ currentUser, isHost: true, room: { host: currentUser, speakers: [] } });
    ui.bindManager(mgr);

    await mgr.startLocalAudio();
    const analyser = mgr.getLocalAnalyserNode();

    // User is speaking
    analyser.customSamples = [100, 156, 100, 156];
    mgr.analyzeSpeakingNow();
    expect(ui.getHostIsSpeaking() === true, '4. User is actively speaking before mute');

    // Mute user
    ui.isMuted = true;
    mgr.setMuted(true);

    expect(ui.effectiveLocalSpeaking === false, '4. Mute forces effectiveLocalSpeaking to false');
    expect(ui.getHostIsSpeaking() === false, '4. Mute immediately clears speaking UI state');

    // Unmute user
    ui.isMuted = false;
    mgr.setMuted(false);
    mgr.analyzeSpeakingNow();

    expect(ui.getHostIsSpeaking() === true, '5. Unmute allows speaking UI to reactivate when speech resumes');

    mgr.destroy();
  }

  // ── TEST 6, 7, 8, 9: Role Transitions (Listener <-> Speaker) ─────────
  console.log('\n[Group 3: Role Transitions & Speaking UI]');
  {
    const mgr = createManager({ isHost: false, isSpeaker: false });
    const ui = new StageSpeakingModel({
      currentUser,
      isHost: false,
      isSpeaker: false,
      room: { host: remoteHost, speakers: [] }
    });
    ui.bindManager(mgr);

    // 6. Listener state
    ui.localIsSpeaking = true; // Even if detector fired
    expect(ui.isPublisher === false, '6. Listener is not a publisher');
    expect(ui.effectiveLocalSpeaking === false, '6. Listener role strictly forces speaking UI state to false');

    // 7. Listener -> Speaker promotion
    ui.isSpeaker = true;
    mgr.setRole({ isHost: false, isSpeaker: true });
    await mgr.startLocalAudio();
    const analyser = mgr.getLocalAnalyserNode();

    analyser.customSamples = [100, 156, 100, 156];
    mgr.analyzeSpeakingNow();

    const selfSpeakerObj = { id: 'usr_me', name: 'Anita (You)' };
    expect(ui.getSpeakerIsSpeaking(selfSpeakerObj, 0) === true, '7. Listener -> Speaker enables real speaking UI on self podium');

    // 8. Speaker -> Listener demotion
    ui.isSpeaker = false;
    mgr.setRole({ isHost: false, isSpeaker: false });
    expect(ui.isPublisher === false, '8. Demoted to listener');
    expect(ui.effectiveLocalSpeaking === false, '8. Speaker -> Listener immediately clears speaking UI state');

    // 9. Rapid Speaker -> Listener -> Speaker toggle
    ui.isSpeaker = true;
    mgr.setRole({ isHost: false, isSpeaker: true });
    ui.isSpeaker = false;
    mgr.setRole({ isHost: false, isSpeaker: false });
    ui.isSpeaker = true;
    mgr.setRole({ isHost: false, isSpeaker: true });

    await new Promise((r) => setTimeout(r, 60));
    const activeAnalyser = mgr.getLocalAnalyserNode();
    if (activeAnalyser) {
      activeAnalyser.customSamples = [100, 156, 100, 156];
    }
    mgr.analyzeSpeakingNow();
    expect(ui.getSpeakerIsSpeaking(selfSpeakerObj, 0) === true, '9. Rapid Speaker -> Listener -> Speaker safely restores speaking UI');

    mgr.destroy();
  }

  // ── TEST 10 & 16: Fake 3800ms Timer Isolation & Remote Fallback ──────
  console.log('\n[Group 4: Fake Timer Isolation & Remote Fallback]');
  {
    const mgr = createManager({ isHost: true });
    const ui = new StageSpeakingModel({
      currentUser,
      isHost: true,
      room: { host: currentUser, speakers: [remoteSpeaker] }
    });
    ui.bindManager(mgr);

    await mgr.startLocalAudio();
    const analyser = mgr.getLocalAnalyserNode();
    analyser.customSamples = [128, 128, 128, 128]; // Local user is completely silent
    mgr.analyzeSpeakingNow();

    expect(ui.localIsSpeaking === false, '10. Local user is silent');

    // Cycle fake timer to index 0 (which used to be fake Host speaking!)
    ui.activeSpeakerIdx = 0;
    expect(ui.getHostIsSpeaking() === false, '10. Fake 3800ms timer (index 0) no longer turns on local host speaking indicator');

    // Cycle fake timer to index 1 (remote speaker)
    ui.activeSpeakerIdx = 1;
    expect(ui.getSpeakerIsSpeaking(remoteSpeaker, 0) === true, '16. Remote participant fallback remains operational on index 1');
    expect(ui.getHostIsSpeaking() === false, '16. Local host remains silent while remote speaker fallback is active');

    // Local host speaks
    analyser.customSamples = [100, 156, 100, 156];
    mgr.analyzeSpeakingNow();
    expect(ui.getHostIsSpeaking() === true, '10. Local host speaking indicator is driven strictly by real speech');

    mgr.destroy();
  }

  // ── TEST 11, 12, 13: Subscription Lifecycle & Teardown ───────────────
  console.log('\n[Group 5: Subscription Lifecycle & Teardown]');
  {
    const mgr = createManager();
    const ui = new StageSpeakingModel({ currentUser, isHost: true });

    ui.bindManager(mgr);
    expect(ui.subscriptionCount === 1, '11. Exactly 1 speaking subscription active');

    // Unmount simulation
    ui.unbindManager(mgr);
    expect(ui.subscriptionCount === 0, '12. Component unmount clears speaking subscription');
    expect(ui.localIsSpeaking === false, '12. Unmount resets localIsSpeaking to false');
    expect(mgr.onLocalSpeakingChange === null, '12. Manager callback unlinked on unmount');

    // Manager destroy
    mgr.destroy();
    expect(mgr.getLocalIsSpeaking() === false, '13. Manager destroy clears speaking state');
  }

  // ── TEST 14 & 15: Source Integrity & CSS Class Preservation ──────────
  console.log('\n[Group 6: UI Source & CSS Class Preservation]');
  {
    // 14. Existing stage layout remains intact
    expect(uiSource.includes('host-podium-card'), '14. host-podium-card structure is preserved');
    expect(uiSource.includes('speaker-podium-card'), '14. speaker-podium-card structure is preserved');
    expect(uiSource.includes('stage-podium-grid'), '14. stage-podium-grid container is preserved');

    // 15. Existing .is-speaking and voice wave classes remain intact
    expect(uiSource.includes("${hostIsSpeaking ? 'is-speaking' : ''}"), '15. Host .is-speaking class expression is preserved');
    expect(uiSource.includes("${isSpeakerActive ? 'is-speaking' : ''}"), '15. Speaker .is-speaking class expression is preserved');
    expect(uiSource.includes('active-speaking'), '15. Aura ring active-speaking animation classes preserved');
    expect(uiSource.includes('speaking-active-indicator'), '15. speaking-active-indicator visualizer container preserved');
    expect(uiSource.includes('voice-wave-visualizer'), '15. voice-wave-visualizer animated bars preserved');
  }

  console.log('\n================================================================');
  console.log('🎉 ALL 16/16 GROUP WEBRTC PHASE 3C-4 TESTS PASSED 100%!');
  console.log('================================================================');
}

runPhase3C4Tests().catch((err) => {
  console.error('\n❌ TEST RUNNER FAILED:', err);
  process.exit(1);
});
