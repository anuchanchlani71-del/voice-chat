const ioClient = require('socket.io-client');
const mongoose = require('mongoose');
const { initSocketServer } = require('../src/socket/socketServer');
const User = require('../src/models/User');
const { signToken } = require('../src/utils/tokenUtils');
const http = require('http');

let expressApp;
let server;
let port;
let serverUrl;

const TEST_DB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/voice-chat-friends';

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

async function runTests() {
  console.log('====================================================');
  console.log('⚡ WEBRTC P2P SIGNALING REALTIME TEST SUITE');
  console.log('====================================================');

  await mongoose.connect(TEST_DB_URI);
  await setupTestServer();

  let socketCaller, socketCallee;

  try {
    const callerUser = await User.findOne({ username: 'anita30' }) || await User.findOne({});
    const calleeUser = await User.findOne({ username: 'ananya30' }) || await User.findOne({});

    if (!callerUser || !calleeUser) {
      throw new Error('Test users anita30 or ananya30 not found in database.');
    }

    const callerToken = signToken({ id: callerUser._id.toString() });
    const calleeToken = signToken({ id: calleeUser._id.toString() });

    socketCaller = connectSocket(callerToken);
    socketCallee = connectSocket(calleeToken);

    await Promise.all([
      new Promise((res) => socketCaller.on('connect', res)),
      new Promise((res) => socketCallee.on('connect', res))
    ]);

    console.log('✅ PASS 1: Sockets for Caller and Callee connected successfully');

    const testCallId = 'call_webrtc_test_123';
    const mockOfferSdp = { type: 'offer', sdp: 'v=0\r\no=- 123 456 IN IP4 127.0.0.1...' };
    const mockAnswerSdp = { type: 'answer', sdp: 'v=0\r\no=- 789 101 IN IP4 127.0.0.1...' };
    const mockIceCandidate = { candidate: 'candidate:1 1 UDP 2122260223 127.0.0.1 54321 typ host', sdpMid: '0', sdpMLineIndex: 0 };

    // Test 2: Relay WebRTC Offer from Caller to Callee
    const offerPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for webrtc:offer')), 3000);
      socketCallee.once('webrtc:offer', (data) => {
        clearTimeout(timeout);
        if (data && data.sdp && data.sdp.type === 'offer') {
          resolve(data);
        } else {
          reject(new Error('Invalid webrtc:offer payload'));
        }
      });
    });

    socketCaller.emit('webrtc:offer', {
      targetUserId: calleeUser.id || calleeUser._id.toString(),
      callId: testCallId,
      sdp: mockOfferSdp
    });

    await offerPromise;
    console.log('✅ PASS 2: webrtc:offer relayed to callee socket room');

    // Test 3: Relay WebRTC Answer from Callee to Caller
    const answerPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for webrtc:answer')), 3000);
      socketCaller.once('webrtc:answer', (data) => {
        clearTimeout(timeout);
        if (data && data.sdp && data.sdp.type === 'answer') {
          resolve(data);
        } else {
          reject(new Error('Invalid webrtc:answer payload'));
        }
      });
    });

    socketCallee.emit('webrtc:answer', {
      targetUserId: callerUser.id || callerUser._id.toString(),
      callId: testCallId,
      sdp: mockAnswerSdp
    });

    await answerPromise;
    console.log('✅ PASS 3: webrtc:answer relayed to caller socket room');

    // Test 4: Relay ICE Candidate from Caller to Callee
    const icePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for webrtc:ice_candidate')), 3000);
      socketCallee.once('webrtc:ice_candidate', (data) => {
        clearTimeout(timeout);
        if (data && data.candidate && data.candidate.sdpMid === '0') {
          resolve(data);
        } else {
          reject(new Error('Invalid webrtc:ice_candidate payload'));
        }
      });
    });

    socketCaller.emit('webrtc:ice_candidate', {
      targetUserId: calleeUser.id || calleeUser._id.toString(),
      callId: testCallId,
      candidate: mockIceCandidate
    });

    await icePromise;
    console.log('✅ PASS 4: webrtc:ice_candidate relayed to callee socket room');

    console.log('\n====================================================');
    console.log('🎉 ALL 4/4 WEBRTC SIGNALING TESTS PASSED 100%!');
    console.log('====================================================');

  } catch (err) {
    console.error('❌ TEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    if (socketCaller) socketCaller.disconnect();
    if (socketCallee) socketCallee.disconnect();
    await closeTestServer();
    await mongoose.disconnect();
  }
}

runTests();
