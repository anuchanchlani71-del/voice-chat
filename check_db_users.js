const { connectDB, disconnectDB } = require('./src/config/db');
const User = require('./src/models/User');

async function check() {
  await connectDB();
  const all = await User.find({}).select('id username fullName email voiceStatus isOnline accountStatus');
  console.log('Total users in DB:', all.length);
  const byStatus = { online: 0, offline: 0, suspended: 0 };
  all.forEach(u => {
    if (u.accountStatus === 'suspended') byStatus.suspended++;
    else if (u.isOnline) byStatus.online++;
    else byStatus.offline++;
  });
  console.log('Breakdown:', byStatus);
  console.log('Last 10 users:', all.slice(-10).map(u => ({ id: u.id, username: u.username, isOnline: u.isOnline, voiceStatus: u.voiceStatus, status: u.accountStatus })));
  await disconnectDB();
}

check();
