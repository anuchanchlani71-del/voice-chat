const mongoose = require('mongoose');
const VoiceCall = require('../src/models/VoiceCall');
const User = require('../src/models/User');
const { expireStaleRingingCalls } = require('../src/utils/callSocketHelper');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/voice-chat-friends';

async function runStaleFixTests() {
  console.log('--- STARTING VOICE CALL STALE FIX VERIFICATION TESTS ---');
  await mongoose.connect(MONGO_URI);

  try {
    // 1. Fetch test users (Anita30 and Ananya30)
    const anita = await User.findOne({ username: 'anita30' });
    const ananya = await User.findOne({ username: 'ananya30' });

    if (!anita || !ananya) {
      throw new Error('Test users anita30 or ananya30 not found in database.');
    }

    console.log(`User Anita ID: ${anita._id}`);
    console.log(`User Ananya ID: ${ananya._id}`);

    // Test Case 1: Stale Ringing Call (> 45s) Should Auto-Expire
    console.log('\n[Test 1] Testing stale ringing call (>45s) auto-expiration...');
    const fiftySecAgoIso = new Date(Date.now() - 50 * 1000).toISOString();
    const staleCall = await VoiceCall.create({
      caller: anita._id,
      receiver: ananya._id,
      status: 'ringing',
      startedAt: fiftySecAgoIso
    });

    await expireStaleRingingCalls(ananya._id, 45000);

    const updatedStaleCall = await VoiceCall.findById(staleCall._id);
    console.log(`Updated Stale Call Status: "${updatedStaleCall.status}", endReason: "${updatedStaleCall.endReason}"`);

    if (updatedStaleCall.status !== 'missed' || updatedStaleCall.endReason !== 'timeout') {
      throw new Error(`FAIL: Expected status 'missed' and endReason 'timeout', got status='${updatedStaleCall.status}', endReason='${updatedStaleCall.endReason}'`);
    }
    console.log('✅ PASS: Stale ringing call correctly auto-expired to missed/timeout.');

    // Test Case 2: Fresh Ringing Call (< 45s) Should NOT Auto-Expire
    console.log('\n[Test 2] Testing fresh ringing call (<45s) non-expiration...');
    const tenSecAgoIso = new Date(Date.now() - 10 * 1000).toISOString();
    const freshCall = await VoiceCall.create({
      caller: anita._id,
      receiver: ananya._id,
      status: 'ringing',
      startedAt: tenSecAgoIso
    });

    await expireStaleRingingCalls(ananya._id, 45000);

    const updatedFreshCall = await VoiceCall.findById(freshCall._id);
    console.log(`Updated Fresh Call Status: "${updatedFreshCall.status}"`);

    if (updatedFreshCall.status !== 'ringing') {
      throw new Error(`FAIL: Expected fresh call status to remain 'ringing', got '${updatedFreshCall.status}'`);
    }
    console.log('✅ PASS: Fresh ringing call preserved in ringing status.');

    // Cleanup test fresh call record
    await VoiceCall.deleteOne({ _id: freshCall._id });

    // Test Case 3: Ongoing Call (> 45s) Should NEVER Auto-Expire
    console.log('\n[Test 3] Testing ongoing call (>45s) non-expiration...');
    const oldOngoingCall = await VoiceCall.create({
      caller: anita._id,
      receiver: ananya._id,
      status: 'ongoing',
      startedAt: fiftySecAgoIso,
      connectedAt: fiftySecAgoIso
    });

    await expireStaleRingingCalls(ananya._id, 45000);

    const updatedOngoingCall = await VoiceCall.findById(oldOngoingCall._id);
    console.log(`Updated Ongoing Call Status: "${updatedOngoingCall.status}"`);

    if (updatedOngoingCall.status !== 'ongoing') {
      throw new Error(`FAIL: Ongoing call was erroneously modified to '${updatedOngoingCall.status}'`);
    }
    console.log('✅ PASS: Ongoing call preserved without modification.');

    // Cleanup test ongoing call record
    await VoiceCall.deleteOne({ _id: oldOngoingCall._id });

    // Test Case 4: Verify previous stuck ringing calls in DB are expired and Anita/Ananya can call
    console.log('\n[Test 4] Expiring any existing stale ringing calls for Anita/Ananya...');
    await expireStaleRingingCalls(null, 45000);

    const activeCallCheck = await VoiceCall.findOne({
      $or: [{ caller: ananya._id }, { receiver: ananya._id }],
      status: { $in: ['ringing', 'ongoing'] }
    });

    console.log('Active Call Check for Ananya after cleanup:', activeCallCheck ? `STILL BUSY (${activeCallCheck._id})` : 'FREE / NOT BUSY');

    if (activeCallCheck) {
      throw new Error(`FAIL: Ananya is still marked busy by active call ${activeCallCheck._id}`);
    }
    console.log('✅ PASS: Ananya is now free and able to receive calls.');

    console.log('\n====================================================');
    console.log('🎉 ALL VOICE CALL STALE FIX TESTS PASSED SUCCESSFULLY!');
    console.log('====================================================');

  } catch (err) {
    console.error('❌ TEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

runStaleFixTests();
