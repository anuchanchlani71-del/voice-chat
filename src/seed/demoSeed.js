/**
 * Demo / Test Seed System for Voice Chat & Friends Platform
 * 
 * Provides safe, idempotent demo data across all platform entities:
 * - Users (with varied status, online/offline, stats)
 * - Interests (categories & icons)
 * - Icebreaker Prompts
 * - Friendships (active pairs with userPairKey)
 * - Friend Requests (pending, rejected, cancelled)
 * - Voice Calls (completed, missed, ongoing, declined)
 * - Reports (including multi-reporter Repeat Offender patterns)
 * - Blocked Users
 * - Appeals (suspended & blocked user appeals)
 * - Notifications
 *
 * Safe for repeated execution: NEVER deletes existing records, uses unique demo keys.
 */

const { connectDB } = require('../config/db');
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const FriendRequest = require('../models/FriendRequest');
const VoiceCall = require('../models/VoiceCall');
const Report = require('../models/Report');
const Notification = require('../models/Notification');
const Block = require('../models/Block');
const Appeal = require('../models/Appeal');
const Interest = require('../models/Interest');
const IcebreakerPrompt = require('../models/IcebreakerPrompt');
const GroupVoiceRoom = require('../models/GroupVoiceRoom');
const Plan = require('../models/Plan');

// Demo Plans Definition (Free & Aura)
const DEMO_PLANS = [
  {
    id: 'demo_plan_free',
    key: 'free',
    name: 'Free',
    description: 'Default tier for all registered users with essential voice features.',
    badgeText: '',
    features: [
      'Standard audio quality (64 kbps)',
      'Join & host community voice rooms',
      'Up to 10 participants per room',
      'Standard community matching'
    ],
    limits: {
      maxDailyCallMinutes: 0,
      maxGroupRoomCapacity: 10,
      canHostGroupRooms: true,
      canCreatePrivateRooms: false,
      hasAuraGlow: false,
      hasPriorityMatching: false,
      audioBitrateKbps: 64
    },
    pricing: {
      monthly: { amount: 0, currency: 'INR' },
      yearly: { amount: 0, currency: 'INR' }
    },
    isDefault: true,
    isActive: true,
    displayOrder: 1
  },
  {
    id: 'demo_plan_aura',
    key: 'aura',
    name: 'Aura',
    description: 'Premium tier with enhanced HD voice, custom rooms, and exclusive aura badge.',
    badgeText: 'Aura',
    features: [
      'High-definition voice audio (128 kbps)',
      'Exclusive glowing Aura profile badge',
      'Host rooms with up to 25 participants',
      'Create private and invite-only voice rooms',
      'Priority matching in discovery queue'
    ],
    limits: {
      maxDailyCallMinutes: 0,
      maxGroupRoomCapacity: 25,
      canHostGroupRooms: true,
      canCreatePrivateRooms: true,
      hasAuraGlow: true,
      hasPriorityMatching: true,
      audioBitrateKbps: 128
    },
    pricing: {
      monthly: { amount: 0, currency: 'INR' },
      yearly: { amount: 0, currency: 'INR' }
    },
    isDefault: false,
    isActive: true,
    displayOrder: 2
  }
];

// Demo Interests Definition
const DEMO_INTERESTS = [
  { id: 'demo_int_01', name: 'Music & Audio', category: 'Entertainment & Arts', icon: '🎵', userCount: 5, isActive: true },
  { id: 'demo_int_02', name: 'Gaming & Esports', category: 'Gaming & Tech', icon: '🎮', userCount: 4, isActive: true },
  { id: 'demo_int_03', name: 'Technology', category: 'Gaming & Tech', icon: '💻', userCount: 4, isActive: true },
  { id: 'demo_int_04', name: 'Anime & Manga', category: 'Entertainment & Arts', icon: '✨', userCount: 2, isActive: true },
  { id: 'demo_int_05', name: 'Fitness & Health', category: 'Lifestyle', icon: '💪', userCount: 2, isActive: true },
  { id: 'demo_int_06', name: 'Movies & TV', category: 'Entertainment & Arts', icon: '🎬', userCount: 3, isActive: true }
];

// Demo Icebreaker Prompts Definition
const DEMO_PROMPTS = [
  { id: 'demo_prm_01', interest: 'Music & Audio', prompt: 'What is the last album or playlist you listened to on repeat?', status: 'active' },
  { id: 'demo_prm_02', interest: 'Gaming & Esports', prompt: 'What multiplayer game have you spent the most hours playing?', status: 'active' },
  { id: 'demo_prm_03', interest: 'Technology', prompt: 'What emerging tech or gadget are you most enthusiastic about right now?', status: 'active' },
  { id: 'demo_prm_04', interest: 'Anime & Manga', prompt: 'If you could live in any anime world for a week, which one would you choose?', status: 'active' },
  { id: 'demo_prm_05', interest: 'Fitness & Health', prompt: 'What is your favorite workout music or morning productivity routine?', status: 'active' },
  { id: 'demo_prm_06', interest: 'Movies & TV', prompt: 'What is one cinematic masterpiece you believe everyone should watch at least once?', status: 'active' }
];

// Demo Users Definition
const DEMO_USERS = [
  {
    id: 'demo_usr_01',
    username: 'aarav_sharma',
    fullName: 'Aarav Sharma',
    avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
    bio: 'Music enthusiast, indie guitarist & casual gamer.',
    interests: ['Music & Audio', 'Gaming & Esports'],
    isOnline: true,
    lastSeen: 'Just now',
    accountStatus: 'active',
    joinedDate: '2026-01-15',
    friendsCount: 3,
    voiceCallsCount: 12,
    totalVoiceMinutes: 145,
    reportsCount: 0,
    isBlocked: false,
    email: 'aarav.sharma@example.com',
    phone: '+91 98765 43210'
  },
  {
    id: 'demo_usr_02',
    username: 'priya_patel',
    fullName: 'Priya Patel',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
    bio: 'Software engineer by day, anime binge-watcher by night.',
    interests: ['Technology', 'Anime & Manga'],
    isOnline: true,
    lastSeen: 'Just now',
    accountStatus: 'active',
    joinedDate: '2026-01-20',
    friendsCount: 4,
    voiceCallsCount: 18,
    totalVoiceMinutes: 210,
    reportsCount: 0,
    isBlocked: false,
    email: 'priya.patel@example.com',
    phone: '+91 98765 43211'
  },
  {
    id: 'demo_usr_03',
    username: 'rohan_verma',
    fullName: 'Rohan Verma',
    avatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150&auto=format&fit=crop&q=80',
    bio: 'Fitness freak, marathon runner and podcast explorer.',
    interests: ['Fitness & Health', 'Music & Audio'],
    isOnline: false,
    lastSeen: '15m ago',
    accountStatus: 'active',
    joinedDate: '2026-02-01',
    friendsCount: 2,
    voiceCallsCount: 8,
    totalVoiceMinutes: 85,
    reportsCount: 0,
    isBlocked: false,
    email: 'rohan.verma@example.com',
    phone: '+91 98765 43212'
  },
  {
    id: 'demo_usr_04',
    username: 'ananya_sen',
    fullName: 'Ananya Sen',
    avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&auto=format&fit=crop&q=80',
    bio: 'Cinema buff, screenwriter & creative storyteller.',
    interests: ['Movies & TV', 'Technology'],
    isOnline: true,
    lastSeen: 'Just now',
    accountStatus: 'active',
    joinedDate: '2026-02-10',
    friendsCount: 3,
    voiceCallsCount: 14,
    totalVoiceMinutes: 160,
    reportsCount: 0,
    isBlocked: false,
    email: 'ananya.sen@example.com',
    phone: '+91 98765 43213'
  },
  {
    id: 'demo_usr_05',
    username: 'kabir_singh',
    fullName: 'Kabir Singh',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    bio: 'Competitive esports player & game streamer.',
    interests: ['Gaming & Esports', 'Technology'],
    isOnline: false,
    lastSeen: '2h ago',
    accountStatus: 'suspended',
    joinedDate: '2026-02-18',
    friendsCount: 1,
    voiceCallsCount: 5,
    totalVoiceMinutes: 40,
    reportsCount: 3,
    isBlocked: false,
    email: 'kabir.singh@example.com',
    phone: '+91 98765 43214'
  },
  {
    id: 'demo_usr_06',
    username: 'neha_gupta',
    fullName: 'Neha Gupta',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
    bio: 'Art director & classical acoustic music admirer.',
    interests: ['Music & Audio', 'Movies & TV'],
    isOnline: false,
    lastSeen: '1d ago',
    accountStatus: 'active',
    joinedDate: '2026-03-01',
    friendsCount: 2,
    voiceCallsCount: 6,
    totalVoiceMinutes: 65,
    reportsCount: 0,
    isBlocked: false,
    email: 'neha.gupta@example.com',
    phone: '+91 98765 43215'
  },
  {
    id: 'demo_usr_07',
    username: 'dev_malhotra',
    fullName: 'Dev Malhotra',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    bio: 'Tech entrepreneur & artificial intelligence researcher.',
    interests: ['Technology', 'Gaming & Esports'],
    isOnline: true,
    lastSeen: 'Just now',
    accountStatus: 'active',
    joinedDate: '2026-03-05',
    friendsCount: 2,
    voiceCallsCount: 9,
    totalVoiceMinutes: 110,
    reportsCount: 0,
    isBlocked: false,
    email: 'dev.malhotra@example.com',
    phone: '+91 98765 43216'
  },
  {
    id: 'demo_usr_08',
    username: 'vikram_joshi',
    fullName: 'Vikram Joshi',
    avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80',
    bio: 'Audio gear enthusiast & amateur podcaster.',
    interests: ['Music & Audio', 'Fitness & Health'],
    isOnline: false,
    lastSeen: '3d ago',
    accountStatus: 'active',
    joinedDate: '2026-03-12',
    friendsCount: 0,
    voiceCallsCount: 2,
    totalVoiceMinutes: 15,
    reportsCount: 2,
    isBlocked: true,
    email: 'vikram.joshi@example.com',
    phone: '+91 98765 43217'
  }
];

/**
 * Main Demo Seeding Procedure
 */
async function seedDemoData() {
  const summary = {
    interests: { created: 0, existing: 0 },
    prompts: { created: 0, existing: 0 },
    users: { created: 0, existing: 0 },
    friendships: { created: 0, existing: 0 },
    friendRequests: { created: 0, existing: 0 },
    voiceCalls: { created: 0, existing: 0 },
    reports: { created: 0, existing: 0 },
    blocks: { created: 0, existing: 0 },
    appeals: { created: 0, existing: 0 },
    notifications: { created: 0, existing: 0 },
    groupVoiceRooms: { created: 0, existing: 0 },
    plans: { created: 0, existing: 0 }
  };

  try {
    await connectDB();
    console.log('====================================================');
    console.log('🌱 Executing Idempotent Demo / Test Seed System');
    console.log('====================================================');

    // 1. Seed Interests
    for (const intData of DEMO_INTERESTS) {
      const existing = await Interest.findOne({
        $or: [{ id: intData.id }, { name: intData.name }]
      });
      if (!existing) {
        await Interest.create(intData);
        summary.interests.created++;
      } else {
        summary.interests.existing++;
      }
    }

    // 2. Seed Icebreaker Prompts
    for (const prmData of DEMO_PROMPTS) {
      const existing = await IcebreakerPrompt.findOne({
        $or: [{ id: prmData.id }, { prompt: prmData.prompt }]
      });
      if (!existing) {
        await IcebreakerPrompt.create(prmData);
        summary.prompts.created++;
      } else {
        summary.prompts.existing++;
      }
    }

    // 3. Seed Users
    const userMap = {};
    for (const usrData of DEMO_USERS) {
      let doc = await User.findOne({
        $or: [{ id: usrData.id }, { username: usrData.username }]
      });
      if (!doc) {
        doc = await User.create(usrData);
        summary.users.created++;
      } else {
        summary.users.existing++;
      }
      userMap[usrData.id] = doc;
    }

    const u1 = userMap['demo_usr_01'];
    const u2 = userMap['demo_usr_02'];
    const u3 = userMap['demo_usr_03'];
    const u4 = userMap['demo_usr_04'];
    const u5 = userMap['demo_usr_05'];
    const u6 = userMap['demo_usr_06'];
    const u7 = userMap['demo_usr_07'];
    const u8 = userMap['demo_usr_08'];

    // 4. Seed Friendships (Active Friendships with userPairKey)
    if (u1 && u2 && u3 && u4 && u7) {
      const demoFriendships = [
        {
          id: 'demo_fr_01',
          requester: u1._id,
          recipient: u2._id,
          userPairKey: [u1._id.toString(), u2._id.toString()].sort().join(':'),
          status: 'accepted',
          matchedInterests: ['Music & Audio', 'Technology'],
          voiceCallsCount: 6,
          requestedAt: '2026-03-01T10:00:00.000Z',
          acceptedAt: '2026-03-01T10:15:00.000Z'
        },
        {
          id: 'demo_fr_02',
          requester: u2._id,
          recipient: u4._id,
          userPairKey: [u2._id.toString(), u4._id.toString()].sort().join(':'),
          status: 'accepted',
          matchedInterests: ['Technology', 'Movies & TV'],
          voiceCallsCount: 4,
          requestedAt: '2026-03-05T14:20:00.000Z',
          acceptedAt: '2026-03-05T14:45:00.000Z'
        },
        {
          id: 'demo_fr_03',
          requester: u1._id,
          recipient: u3._id,
          userPairKey: [u1._id.toString(), u3._id.toString()].sort().join(':'),
          status: 'accepted',
          matchedInterests: ['Music & Audio', 'Fitness & Health'],
          voiceCallsCount: 2,
          requestedAt: '2026-03-10T11:00:00.000Z',
          acceptedAt: '2026-03-10T11:30:00.000Z'
        },
        {
          id: 'demo_fr_04',
          requester: u4._id,
          recipient: u7._id,
          userPairKey: [u4._id.toString(), u7._id.toString()].sort().join(':'),
          status: 'accepted',
          matchedInterests: ['Technology'],
          voiceCallsCount: 3,
          requestedAt: '2026-03-15T16:00:00.000Z',
          acceptedAt: '2026-03-15T16:20:00.000Z'
        }
      ];

      for (const fr of demoFriendships) {
        const existing = await Friendship.findOne({
          $or: [{ id: fr.id }, { userPairKey: fr.userPairKey }]
        });
        if (!existing) {
          await Friendship.create(fr);
          summary.friendships.created++;
        } else {
          summary.friendships.existing++;
        }
      }
    }

    // 5. Seed Friend Requests (Pending, Rejected, Cancelled)
    if (u1 && u2 && u3 && u4 && u6 && u7) {
      const demoRequests = [
        {
          id: 'demo_freq_01',
          requester: u7._id,
          recipient: u1._id,
          status: 'pending',
          matchedInterests: ['Technology', 'Gaming & Esports'],
          requestedAt: '2026-09-28T09:30:00.000Z',
          respondedAt: null
        },
        {
          id: 'demo_freq_02',
          requester: u6._id,
          recipient: u2._id,
          status: 'pending',
          matchedInterests: ['Music & Audio'],
          requestedAt: '2026-09-28T11:15:00.000Z',
          respondedAt: null
        },
        {
          id: 'demo_freq_03',
          requester: u3._id,
          recipient: u4._id,
          status: 'rejected',
          matchedInterests: ['Movies & TV'],
          requestedAt: '2026-09-27T14:00:00.000Z',
          respondedAt: '2026-09-27T15:30:00.000Z'
        },
        {
          id: 'demo_freq_04',
          requester: u7._id,
          recipient: u6._id,
          status: 'cancelled',
          matchedInterests: ['Music & Audio'],
          requestedAt: '2026-09-26T18:00:00.000Z',
          respondedAt: '2026-09-26T18:10:00.000Z'
        }
      ];

      for (const freq of demoRequests) {
        const existing = await FriendRequest.findOne({ id: freq.id });
        if (!existing) {
          await FriendRequest.create(freq);
          summary.friendRequests.created++;
        } else {
          summary.friendRequests.existing++;
        }
      }
    }

    // 6. Seed Voice Calls
    if (u1 && u2 && u3 && u4 && u5 && u7) {
      const demoCalls = [
        {
          id: 'demo_call_01',
          caller: u1._id,
          receiver: u2._id,
          status: 'completed',
          durationSeconds: 1145,
          durationFormatted: '19m 05s',
          startedAt: '2026-09-28T14:00:00.000Z',
          connectedAt: '2026-09-28T14:00:05.000Z',
          endedAt: '2026-09-28T14:19:10.000Z',
          endReason: 'Normal hangup',
          audioQuality: 'HD (Opus / 48kHz)'
        },
        {
          id: 'demo_call_02',
          caller: u2._id,
          receiver: u4._id,
          status: 'completed',
          durationSeconds: 820,
          durationFormatted: '13m 40s',
          startedAt: '2026-09-28T12:30:00.000Z',
          connectedAt: '2026-09-28T12:30:04.000Z',
          endedAt: '2026-09-28T12:43:44.000Z',
          endReason: 'Normal hangup',
          audioQuality: 'Good'
        },
        {
          id: 'demo_call_03',
          caller: u3._id,
          receiver: u1._id,
          status: 'missed',
          durationSeconds: 0,
          durationFormatted: '0m 00s',
          startedAt: '2026-09-28T10:15:00.000Z',
          connectedAt: null,
          endedAt: '2026-09-28T10:15:35.000Z',
          endReason: 'No answer',
          audioQuality: 'N/A'
        },
        {
          id: 'demo_call_04',
          caller: u7._id,
          receiver: u4._id,
          status: 'completed',
          durationSeconds: 450,
          durationFormatted: '7m 30s',
          startedAt: '2026-09-27T19:00:00.000Z',
          connectedAt: '2026-09-27T19:00:06.000Z',
          endedAt: '2026-09-27T19:07:36.000Z',
          endReason: 'Normal hangup',
          audioQuality: 'HD (Opus / 48kHz)'
        },
        {
          id: 'demo_call_05',
          caller: u5._id,
          receiver: u1._id,
          status: 'declined',
          durationSeconds: 0,
          durationFormatted: '0m 00s',
          startedAt: '2026-09-27T16:20:00.000Z',
          connectedAt: null,
          endedAt: '2026-09-27T16:20:12.000Z',
          endReason: 'User declined',
          audioQuality: 'N/A'
        },
        {
          id: 'demo_call_06',
          caller: u1._id,
          receiver: u7._id,
          status: 'ongoing',
          durationSeconds: 180,
          durationFormatted: '3m 00s',
          startedAt: new Date(Date.now() - 180000).toISOString(),
          connectedAt: new Date(Date.now() - 175000).toISOString(),
          endedAt: null,
          endReason: '',
          audioQuality: 'HD (Opus / 48kHz)'
        }
      ];

      for (const call of demoCalls) {
        const existing = await VoiceCall.findOne({ id: call.id });
        if (!existing) {
          await VoiceCall.create(call);
          summary.voiceCalls.created++;
        } else {
          summary.voiceCalls.existing++;
        }
      }
    }

    // 7. Seed Reports (Ensures multi-reporter Repeat Offender pattern on demo_usr_05)
    if (u1 && u2 && u3 && u4 && u5 && u6 && u8) {
      const demoReports = [
        {
          id: 'demo_rep_01',
          reporter: u1._id,
          reportedUser: u5._id,
          reasonCategory: 'Harassment',
          reason: 'Abusive verbal language in voice room',
          description: 'User repeatedly screamed offensive words and disrupted the session.',
          status: 'pending',
          severity: 'high',
          notes: 'Flagged for moderation review.',
          date: '2026-09-28 14:30'
        },
        {
          id: 'demo_rep_02',
          reporter: u2._id,
          reportedUser: u5._id,
          reasonCategory: 'Inappropriate Behavior',
          reason: 'Unwanted aggressive comments',
          description: 'Harassed multiple participants during a shared audio discussion.',
          status: 'pending',
          severity: 'medium',
          notes: 'Second report against this user.',
          date: '2026-09-28 15:10'
        },
        {
          id: 'demo_rep_03',
          reporter: u3._id,
          reportedUser: u5._id,
          reasonCategory: 'Spam / Solicitation',
          reason: 'Repeated call spamming after refusal',
          description: 'Kept calling repeatedly and sending unwanted audio prompts.',
          status: 'pending',
          severity: 'medium',
          notes: 'Third distinct reporter against Kabir Singh (Repeat Offender pattern triggered).',
          date: '2026-09-28 16:00'
        },
        {
          id: 'demo_rep_04',
          reporter: u4._id,
          reportedUser: u8._id,
          reasonCategory: 'Spam / Solicitation',
          reason: 'Commercial advertising during call',
          description: 'User promoted external commercial crypto telegram channels.',
          status: 'resolved',
          severity: 'low',
          notes: 'Account warned and spam link removed.',
          date: '2026-09-27 11:20'
        },
        {
          id: 'demo_rep_05',
          reporter: u6._id,
          reportedUser: u8._id,
          reasonCategory: 'Harassment',
          reason: 'Unsolicited voice messages',
          description: 'Sent repetitive unsolicited voice invites late at night.',
          status: 'pending',
          severity: 'high',
          notes: 'Pending investigation.',
          date: '2026-09-28 08:45'
        }
      ];

      for (const rep of demoReports) {
        const existing = await Report.findOne({ id: rep.id });
        if (!existing) {
          await Report.create(rep);
          summary.reports.created++;
        } else {
          summary.reports.existing++;
        }
      }
    }

    // 8. Seed Blocked Users
    if (u1 && u4 && u8) {
      const demoBlocks = [
        {
          id: 'demo_blk_01',
          blockedUser: u8._id,
          blockedBy: u1._id,
          reason: 'Unwanted repetitive voice calls',
          notes: 'Blocked after multiple unsolicited voice connection attempts.',
          status: 'active',
          date: '2026-09-27 18:20'
        },
        {
          id: 'demo_blk_02',
          blockedUser: u8._id,
          blockedBy: u4._id,
          reason: 'Spamming commercial promotions',
          notes: 'Blocked due to continuous external advertising pitches.',
          status: 'active',
          date: '2026-09-28 10:05'
        }
      ];

      for (const blk of demoBlocks) {
        const existing = await Block.findOne({ id: blk.id });
        if (!existing) {
          await Block.create(blk);
          summary.blocks.created++;
        } else {
          summary.blocks.existing++;
        }
      }
    }

    // 9. Seed Appeals
    if (u5 && u8) {
      const demoAppeals = [
        {
          id: 'demo_app_01',
          user: u5._id,
          actionType: 'suspended',
          originalReason: 'Multiple harassment reports from peers during voice calls',
          appealMessage: 'I sincerely apologize for my frustration during that voice room. My microphone had feedback issues and I got agitated. I assure full adherence to community rules in all future sessions.',
          status: 'pending',
          adminNotes: 'Awaiting moderation review after 3 distinct user reports.',
          submittedAt: '2026-09-28T16:30:00.000Z',
          relatedReportCount: 3
        },
        {
          id: 'demo_app_02',
          user: u8._id,
          actionType: 'blocked',
          originalReason: 'Repeated spam reports for external links',
          appealMessage: 'I misunderstood group guidelines regarding sharing indie game and audio tools. I will never share external links again. Please review my account block.',
          status: 'under_review',
          adminNotes: 'Reviewing user history and call transcripts.',
          submittedAt: '2026-09-28T12:00:00.000Z',
          relatedReportCount: 2
        }
      ];

      for (const app of demoAppeals) {
        const existing = await Appeal.findOne({ id: app.id });
        if (!existing) {
          await Appeal.create(app);
          summary.appeals.created++;
        } else {
          summary.appeals.existing++;
        }
      }
    }

    // 10. Seed Notifications
    if (u1 && u2 && u3 && u4 && u5 && u7) {
      const demoNotifications = [
        {
          id: 'demo_ntf_01',
          targetUser: u1._id,
          sender: u7._id,
          type: 'friend_request',
          title: 'New Friend Request',
          message: 'Dev Malhotra sent you a friend request.',
          status: 'Delivered',
          isRead: false,
          iconColor: 'text-indigo-600',
          date: '2026-09-28 09:30'
        },
        {
          id: 'demo_ntf_02',
          targetUser: u1._id,
          sender: u3._id,
          type: 'call_missed',
          title: 'Missed Voice Call',
          message: 'You missed a voice call from Rohan Verma.',
          status: 'Delivered',
          isRead: false,
          iconColor: 'text-rose-600',
          date: '2026-09-28 10:15'
        },
        {
          id: 'demo_ntf_03',
          targetUser: u2._id,
          sender: u1._id,
          type: 'friend_accepted',
          title: 'Friend Request Accepted',
          message: 'Aarav Sharma accepted your friend request.',
          status: 'Read',
          isRead: true,
          iconColor: 'text-emerald-600',
          date: '2026-09-28 10:16'
        },
        {
          id: 'demo_ntf_04',
          targetUser: u5._id,
          sender: null,
          type: 'safety_alert',
          title: 'Safety Moderation Notice',
          message: 'Your account has been suspended due to 3 community guideline violations.',
          status: 'Delivered',
          isRead: false,
          iconColor: 'text-amber-600',
          date: '2026-09-28 16:10'
        },
        {
          id: 'demo_ntf_05',
          targetUser: u4._id,
          sender: u2._id,
          type: 'call_alert',
          title: 'Voice Call Completed',
          message: 'Completed voice call with Priya Patel (13m 40s).',
          status: 'Read',
          isRead: true,
          iconColor: 'text-indigo-600',
          date: '2026-09-28 12:44'
        },
        {
          id: 'demo_ntf_06',
          targetUser: u1._id,
          sender: null,
          type: 'system_alert',
          title: 'Scheduled Platform Maintenance',
          message: 'Audio routing nodes will undergo scheduled maintenance tonight at 02:00 IST.',
          status: 'Read',
          isRead: true,
          iconColor: 'text-blue-600',
          date: '2026-09-28 08:00'
        }
      ];

      for (const ntf of demoNotifications) {
        const existing = await Notification.findOne({ id: ntf.id });
        if (!existing) {
          await Notification.create(ntf);
          summary.notifications.created++;
        } else {
          summary.notifications.existing++;
        }
      }

      // 11. Seed Group Voice Rooms
      const demoRooms = [
        {
          id: 'demo_gvr_01',
          title: 'Late Night Indie Pop & Guitar Jamming 🎸',
          topic: 'Music & Audio',
          description: 'Open acoustic jam session! Bring your guitar or just vibe and listen to unreleased indie songs.',
          host: u1._id,
          capacity: 20,
          accessType: 'anyone',
          status: 'active',
          participantCount: 7,
          invitedUsers: []
        },
        {
          id: 'demo_gvr_02',
          title: 'Psychology & Modern Philosophy Book Club 📚',
          topic: 'Books & Philosophy',
          description: 'Private deep-dive discussion on cognitive biases and stoicism. Selected cohort members only.',
          host: u2._id,
          capacity: 10,
          accessType: 'invite_only',
          status: 'active',
          participantCount: 4,
          invitedUsers: [u1._id, u3._id, u4._id]
        },
        {
          id: 'demo_gvr_03',
          title: 'Valorant Ranked Strategy & Chill Gaming 🎮',
          topic: 'Gaming & Esports',
          description: 'Calling all Diamond+ players for team composition planning and voice comms practice.',
          host: u3._id,
          capacity: 10,
          accessType: 'anyone',
          status: 'active',
          participantCount: 6,
          invitedUsers: []
        },
        {
          id: 'demo_gvr_04',
          title: 'French & Japanese Language Practice Lounge 🗣️',
          topic: 'Language Exchange',
          description: 'Selected language exchange partners practicing conversational fluency and accent pronunciation.',
          host: u4._id,
          capacity: 15,
          accessType: 'invite_only',
          status: 'scheduled',
          participantCount: 0,
          invitedUsers: [u1._id, u2._id, u5._id]
        },
        {
          id: 'demo_gvr_05',
          title: 'Cinema Screenplay Writers Roundtable 🎬',
          topic: 'Movies & TV',
          description: 'Invited indie directors and screenwriters discussing character arcs and 3-act structure.',
          host: u5._id,
          capacity: 10,
          accessType: 'invite_only',
          status: 'ended',
          participantCount: 0,
          invitedUsers: [u2._id, u4._id]
        },
        {
          id: 'demo_gvr_06',
          title: 'Weekend Casual Chit-Chat & Tech Trends ☕',
          topic: 'Technology',
          description: 'Open microphone community hangout to chat about AI, web tools, design, and weekend plans.',
          host: u1._id,
          capacity: 50,
          accessType: 'anyone',
          status: 'active',
          participantCount: 14,
          invitedUsers: []
        }
      ];

      for (const roomData of demoRooms) {
        let existing = await GroupVoiceRoom.findOne({ id: roomData.id });
        if (!existing) {
          await GroupVoiceRoom.create(roomData);
          summary.groupVoiceRooms.created++;
        } else {
          existing.status = roomData.status;
          existing.accessType = roomData.accessType;
          existing.title = roomData.title;
          existing.topic = roomData.topic;
          existing.participantCount = roomData.participantCount;
          existing.isDeleted = false;
          await existing.save();
          summary.groupVoiceRooms.existing++;
        }
      }
    }

    // 12. Seed Subscription Plans (Idempotent: Free and Aura)
    for (const planData of DEMO_PLANS) {
      const existing = await Plan.findOne({
        $or: [{ id: planData.id }, { key: planData.key }]
      });
      if (!existing) {
        await Plan.create(planData);
        summary.plans.created++;
      } else {
        // Idempotent: Do NOT overwrite manually modified plan values on subsequent seed runs
        summary.plans.existing++;
      }
    }

    console.log('====================================================');
    console.log('🎉 Demo / Test Seeding Finished Successfully!');
    console.log('====================================================');
    console.log('📊 Seeding Summary:');
    console.log(`- Interests:       ${summary.interests.created} created, ${summary.interests.existing} already existed`);
    console.log(`- Prompts:         ${summary.prompts.created} created, ${summary.prompts.existing} already existed`);
    console.log(`- Users:           ${summary.users.created} created, ${summary.users.existing} already existed`);
    console.log(`- Friendships:     ${summary.friendships.created} created, ${summary.friendships.existing} already existed`);
    console.log(`- Friend Requests: ${summary.friendRequests.created} created, ${summary.friendRequests.existing} already existed`);
    console.log(`- Voice Calls:     ${summary.voiceCalls.created} created, ${summary.voiceCalls.existing} already existed`);
    console.log(`- Reports:         ${summary.reports.created} created, ${summary.reports.existing} already existed`);
    console.log(`- Blocked Users:   ${summary.blocks.created} created, ${summary.blocks.existing} already existed`);
    console.log(`- Appeals:         ${summary.appeals.created} created, ${summary.appeals.existing} already existed`);
    console.log(`- Notifications:   ${summary.notifications.created} created, ${summary.notifications.existing} already existed`);
    console.log(`- Voice Rooms:     ${summary.groupVoiceRooms.created} created, ${summary.groupVoiceRooms.existing} already existed`);
    console.log(`- Plans:           ${summary.plans.created} created, ${summary.plans.existing} already existed`);
    console.log('====================================================');

    return summary;
  } catch (err) {
    console.error('❌ Error during demo data seeding:', err.message);
    throw err;
  }
}

if (require.main === module) {
  seedDemoData()
    .then(() => {
      console.log('[Seed Demo] Completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Seed Demo] Execution failed:', err.message);
      process.exit(1);
    });
}

module.exports = {
  seedDemoData
};
