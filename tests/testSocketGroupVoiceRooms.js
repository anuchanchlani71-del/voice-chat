const ioClient = require('socket.io-client');
const mongoose = require('mongoose');
const { initSocketServer } = require('../src/socket/socketServer');
const User = require('../src/models/User');
const GroupVoiceRoom = require('../src/models/GroupVoiceRoom');
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
  console.log('⚡ SOCKET.IO PHASE 6: GROUP VOICE ROOMS REALTIME TEST SUITE');
  console.log('====================================================');

  await mongoose.connect(TEST_DB_URI);
  await setupTestServer();

  let socketHost, socketParticipant;

  try {
    // 1. Fetch test users
    const hostUser = await User.findOne({ username: 'aarav_sharma' }) || await User.findOne({});
    const participantUser = await User.findOne({ username: 'priya_patel' }) || await User.findOne({});

    if (!hostUser || !participantUser) {
      throw new Error('Test users host and participant not found in DB.');
    }

    const hostToken = signToken({ id: hostUser._id.toString() });
    const participantToken = signToken({ id: participantUser._id.toString() });

    socketHost = connectSocket(hostToken);
    socketParticipant = connectSocket(participantToken);

    await Promise.all([
      new Promise((res) => socketHost.on('connect', res)),
      new Promise((res) => socketParticipant.on('connect', res))
    ]);

    console.log('✅ PASS 1: Sockets for Host and Participant connected successfully');

    // 2. Create test group room doc
    const roomDoc = await GroupVoiceRoom.create({
      title: 'Test Socket Lounge',
      description: 'Socket.IO Phase 6 Realtime Integration Test',
      topic: 'Technology & AI',
      accessType: 'anyone',
      status: 'active',
      host: hostUser._id,
      speakers: [hostUser._id],
      listeners: [],
      capacity: 10,
      participantCount: 1,
      speakersCount: 1
    });

    const roomIdStr = roomDoc.id || roomDoc._id.toString();

    // 3. Sockets join room channel
    socketHost.emit('room:join', { roomId: roomIdStr });
    socketParticipant.emit('room:join', { roomId: roomIdStr });

    await new Promise((res) => setTimeout(res, 300));

    // 4. Test room:member_joined event
    const joinPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for room:member_joined')), 3000);
      socketHost.once('room:member_joined', (data) => {
        clearTimeout(timeout);
        if (data && data.roomId === roomIdStr) {
          resolve(data);
        } else {
          reject(new Error('Invalid room:member_joined payload'));
        }
      });
    });

    const { emitRoomMemberJoined } = require('../src/utils/roomSocketHelper');
    await emitRoomMemberJoined(roomDoc, participantUser);

    await joinPromise;
    console.log('✅ PASS 2: room:member_joined broadcast delivered to room channel');

    // 5. Test room:hand_raised event
    const handPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for room:hand_raised')), 3000);
      socketHost.once('room:hand_raised', (data) => {
        clearTimeout(timeout);
        if (data && data.roomId === roomIdStr && data.isHandRaised === true) {
          resolve(data);
        } else {
          reject(new Error('Invalid room:hand_raised payload'));
        }
      });
    });

    socketParticipant.emit('room:raise_hand', { roomId: roomIdStr, isHandRaised: true });
    await handPromise;
    console.log('✅ PASS 3: room:hand_raised event broadcast to room channel');

    // 6. Test room:closed event
    const closedPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for room:closed')), 3000);
      socketParticipant.once('room:closed', (data) => {
        clearTimeout(timeout);
        if (data && data.roomId === roomIdStr && data.status === 'closed') {
          resolve(data);
        } else {
          reject(new Error('Invalid room:closed payload'));
        }
      });
    });

    const { emitRoomClosed } = require('../src/utils/roomSocketHelper');
    roomDoc.status = 'closed';
    await roomDoc.save();
    await emitRoomClosed(roomDoc);

    await closedPromise;
    console.log('✅ PASS 4: room:closed event broadcast delivered to all participants');

    // Cleanup test room doc
    await GroupVoiceRoom.deleteOne({ _id: roomDoc._id });

    console.log('\n====================================================');
    console.log('🎉 ALL 4/4 SOCKET GROUP VOICE ROOMS TESTS PASSED 100%!');
    console.log('====================================================');

  } catch (err) {
    console.error('❌ TEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    if (socketHost) socketHost.disconnect();
    if (socketParticipant) socketParticipant.disconnect();
    await closeTestServer();
    await mongoose.disconnect();
  }
}

runTests();
