const ioClient = require('socket.io-client');
const mongoose = require('mongoose');
const { initSocketServer } = require('../src/socket/socketServer');
const User = require('../src/models/User');
const Friendship = require('../src/models/Friendship');
const Block = require('../src/models/Block');
const VoiceCall = require('../src/models/VoiceCall');
const Notification = require('../src/models/Notification');
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
  console.log('⚡ SOCKET.IO PHASE 5: 1-TO-1 VOICE CALL REALTIME TEST SUITE');
  console.log('====================================================');

  await mongoose.connect(TEST_DB_URI);
  console.log('[MongoDB] Connected successfully to database');

  await setupTestServer();
  console.log(`⚡ Server started on ${serverUrl}`);

  const timestamp = Date.now();

  // Create 3 Test Users
  const userADoc = await User.create({
    username: `vc_user_a_${timestamp}`,
    email: `vc_user_a_${timestamp}@example.com`,
    fullName: 'Caller User A',
    passwordHash: 'hashed_pwd',
    salt: 'salt_a',
    accountStatus: 'active',
    id: `usr_vc_a_${timestamp}`
  });

  const userBDoc = await User.create({
    username: `vc_user_b_${timestamp}`,
    email: `vc_user_b_${timestamp}@example.com`,
    fullName: 'Receiver User B',
    passwordHash: 'hashed_pwd',
    salt: 'salt_b',
    accountStatus: 'active',
    id: `usr_vc_b_${timestamp}`
  });

  const userCDoc = await User.create({
    username: `vc_user_c_${timestamp}`,
    email: `vc_user_c_${timestamp}@example.com`,
    fullName: 'Third User C',
    passwordHash: 'hashed_pwd',
    salt: 'salt_c',
    accountStatus: 'active',
    id: `usr_vc_c_${timestamp}`
  });

  // Create Mutual Friendship between A and B, and B and C
  const pairAB = Friendship.generateUserPairKey(userADoc._id, userBDoc._id);
  await Friendship.create({
    userPairKey: pairAB,
    requester: userADoc._id,
    recipient: userBDoc._id,
    status: 'accepted'
  });

  const pairBC = Friendship.generateUserPairKey(userBDoc._id, userCDoc._id);
  await Friendship.create({
    userPairKey: pairBC,
    requester: userBDoc._id,
    recipient: userCDoc._id,
    status: 'accepted'
  });

  // Generate Tokens
  const tokenA = signToken({ id: userADoc.id || userADoc._id.toString() });
  const tokenB = signToken({ id: userBDoc.id || userBDoc._id.toString() });
  const tokenC = signToken({ id: userCDoc.id || userCDoc._id.toString() });

  let socketA, socketB, socketC;

  try {
    // 1. Connect Client Sockets
    socketA = connectSocket(tokenA);
    socketB = connectSocket(tokenB);
    socketC = connectSocket(tokenC);

    await Promise.all([
      new Promise(res => socketA.on('connect', res)),
      new Promise(res => socketB.on('connect', res)),
      new Promise(res => socketC.on('connect', res))
    ]);

    console.log('  ✅ PASS 1: Sockets A, B, and C authenticated and connected to server');

    // 2. Test call:initiate & call:incoming delivery
    let callIncomingReceived = null;
    let userCReceivedCall = false;

    socketB.on('call:incoming', (payload) => {
      callIncomingReceived = payload;
    });

    socketC.on('call:incoming', () => {
      userCReceivedCall = true;
    });

    socketA.emit('call:initiate', { recipientId: userBDoc.id });

    await new Promise(res => setTimeout(res, 600));

    if (!callIncomingReceived) {
      throw new Error('User B failed to receive call:incoming socket event.');
    }

    if (userCReceivedCall) {
      throw new Error('SECURITY VIOLATION: Isolated User C received call:incoming event meant for User B!');
    }

    const createdCallId = callIncomingReceived.callId;
    console.log('  ✅ PASS 2: call:incoming delivered to target User B; User C isolated');

    // 3. Test call:accept & call:accepted emission
    let socketAAccepted = null;
    let socketBAccepted = null;

    socketA.on('call:accepted', (p) => { socketAAccepted = p; });
    socketB.on('call:accepted', (p) => { socketBAccepted = p; });

    socketB.emit('call:accept', { callId: createdCallId });

    await new Promise(res => setTimeout(res, 600));

    if (!socketAAccepted || !socketBAccepted) {
      throw new Error('call:accepted event was not received by both caller and receiver.');
    }

    async function findCallInDb(callIdInput) {
      if (!callIdInput) return null;
      const idStr = String(callIdInput);
      if (mongoose.Types.ObjectId.isValid(idStr) && idStr.length === 24) {
        return await VoiceCall.findOne({ $or: [{ _id: idStr }, { id: idStr }] });
      }
      return await VoiceCall.findOne({ id: idStr });
    }

    const dbCallOngoing = await findCallInDb(createdCallId);
    if (!dbCallOngoing || dbCallOngoing.status !== 'ongoing') {
      throw new Error(`Expected DB status 'ongoing', got '${dbCallOngoing?.status}'`);
    }

    console.log('  ✅ PASS 3: call:accepted received by both users; MongoDB updated to ongoing');

    // 4. Test call:end & call:ended emission
    let socketAEnded = null;
    let socketBEnded = null;

    socketA.on('call:ended', (p) => { socketAEnded = p; });
    socketB.on('call:ended', (p) => { socketBEnded = p; });

    socketA.emit('call:end', { callId: createdCallId, durationSeconds: 45, endReason: 'user_ended' });

    await new Promise(res => setTimeout(res, 600));

    if (!socketAEnded || !socketBEnded) {
      throw new Error('call:ended event was not received by both caller and receiver.');
    }

    const dbCallCompleted = await findCallInDb(createdCallId);
    if (!dbCallCompleted || dbCallCompleted.status !== 'completed' || dbCallCompleted.durationSeconds !== 45) {
      throw new Error(`Expected completed call with 45s duration in DB`);
    }

    console.log('  ✅ PASS 4: call:ended synchronized across both users; DB updated to completed (45s)');

    // 5. Test call:decline & call:declined emission
    let socketADeclined = null;

    socketA.on('call:declined', (p) => { socketADeclined = p; });

    // Initiate new call from A to B
    socketA.emit('call:initiate', { recipientId: userBDoc.id });
    await new Promise(res => setTimeout(res, 600));

    const secondCallDoc = await VoiceCall.findOne({ caller: userADoc._id, status: 'ringing' });
    const secondCallId = secondCallDoc.id || secondCallDoc._id.toString();

    // User B declines
    socketB.emit('call:decline', { callId: secondCallId, endReason: 'user_declined' });
    await new Promise(res => setTimeout(res, 600));

    if (!socketADeclined) {
      throw new Error('Caller User A did not receive call:declined event.');
    }

    const dbCallDeclined = await findCallInDb(secondCallId);
    if (!dbCallDeclined || dbCallDeclined.status !== 'declined') {
      throw new Error(`Expected call status 'declined' in DB`);
    }

    console.log('  ✅ PASS 5: call:declined emitted to caller and persisted in MongoDB');

    // 6. Test User Busy detection
    let socketCBusy = null;
    socketC.on('call:busy', (p) => { socketCBusy = p; });

    // Put User A and B in ongoing call
    const ongoingCallDoc = await VoiceCall.create({
      caller: userADoc._id,
      receiver: userBDoc._id,
      status: 'ongoing',
      startedAt: new Date().toISOString(),
      connectedAt: new Date().toISOString()
    });

    // User C attempts to call User B while User B is busy
    socketC.emit('call:initiate', { recipientId: userBDoc.id });
    await new Promise(res => setTimeout(res, 600));

    if (!socketCBusy) {
      throw new Error('User C did not receive call:busy when calling busy User B.');
    }

    console.log('  ✅ PASS 6: User busy state correctly detected and call:busy emitted');

    // 7. Security: Non-friends call attempt rejected
    let nonFriendIncoming = false;
    socketC.on('call:incoming', () => { nonFriendIncoming = true; });

    // User A attempts to call non-friend User C
    socketA.emit('call:initiate', { recipientId: userCDoc.id });
    await new Promise(res => setTimeout(res, 600));

    if (nonFriendIncoming) {
      throw new Error('SECURITY VIOLATION: Non-friend received call:incoming event!');
    }

    console.log('  ✅ PASS 7: Non-friend call initiation strictly rejected by server');

    // 8. Disconnect Cleanup: Drop socket during call
    const ringingCall = await VoiceCall.create({
      caller: userADoc._id,
      receiver: userBDoc._id,
      status: 'ringing',
      startedAt: new Date().toISOString()
    });

    let disconnectEndedRecv = null;
    socketB.on('call:ended', (p) => {
      if (p.callId === ringingCall._id.toString()) {
        disconnectEndedRecv = p;
      }
    });

    // User A disconnects abruptly
    socketA.disconnect();
    await new Promise(res => setTimeout(res, 800));

    const dbCallFailed = await VoiceCall.findOne({ _id: ringingCall._id });
    if (!dbCallFailed || dbCallFailed.status !== 'failed' || dbCallFailed.endReason !== 'disconnect') {
      throw new Error(`Expected call status 'failed' with endReason 'disconnect' after abrupt socket drop`);
    }

    console.log('  ✅ PASS 8: Abrupt socket disconnect cleaned up active call record in DB (status: failed)');

    console.log('\n====================================================');
    console.log('🎉 ALL 8/8 SOCKET VOICE CALL SIGNALING TESTS PASSED 100%!');
    console.log('====================================================\n');
  } finally {
    if (socketA && socketA.connected) socketA.disconnect();
    if (socketB && socketB.connected) socketB.disconnect();
    if (socketC && socketC.connected) socketC.disconnect();

    await User.deleteMany({ _id: { $in: [userADoc._id, userBDoc._id, userCDoc._id] } });
    await Friendship.deleteMany({ userPairKey: { $in: [pairAB, pairBC] } });
    await VoiceCall.deleteMany({ caller: { $in: [userADoc._id, userBDoc._id, userCDoc._id] } });
    await Notification.deleteMany({ sender: { $in: [userADoc._id, userBDoc._id, userCDoc._id] } });

    await closeTestServer();
    await mongoose.disconnect();
  }
}

runTests().catch(err => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
