const path = require('path');
const fs = require('fs');

// Lightweight built-in .env parser (Zero external dependency requirement)
function loadEnv() {
  const envPath = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const lines = envContent.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const equalsIdx = trimmed.indexOf('=');
      if (equalsIdx > 0) {
        const key = trimmed.slice(0, equalsIdx).trim();
        const value = trimmed.slice(equalsIdx + 1).trim();
        if (process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
    }
  }
}

loadEnv();

const config = {
  port: parseInt(process.env.PORT, 10) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/voice-chat-friends',
  dbName: process.env.DB_NAME || 'voice-chat-friends',
  jwtSecret: process.env.JWT_SECRET || 'voicefriends_super_secure_jwt_secret_key_2026_phase1_mvp!',
  jwtExpiresIn: parseInt(process.env.JWT_EXPIRES_IN, 10) || 86400, // 24 hours in seconds
  defaultAdmin: {
    email: process.env.DEFAULT_ADMIN_EMAIL || 'admin@voicefriends.io',
    password: process.env.DEFAULT_ADMIN_PASSWORD || 'AdminPassword123!',
    name: process.env.DEFAULT_ADMIN_NAME || 'Admin Team',
    role: process.env.DEFAULT_ADMIN_ROLE || 'Super Admin'
  }
};

module.exports = config;
