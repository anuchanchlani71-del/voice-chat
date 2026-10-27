const config = require('../config/env');
const Admin = require('../models/Admin');
const { connectDB } = require('../config/db');

/**
 * Seed initial Super Admin account in MongoDB if none exists.
 * Idempotent: Will NOT create duplicates if executed multiple times.
 */
async function seedDefaultAdmin() {
  try {
    // Ensure DB connection is active
    await connectDB();

    const normalizedEmail = config.defaultAdmin.email.trim().toLowerCase();
    const existing = await Admin.findByEmail(normalizedEmail);

    if (!existing) {
      console.log(`[Seed] Initializing default Super Admin in MongoDB (${normalizedEmail})...`);
      const admin = await Admin.createAdmin({
        email: normalizedEmail,
        password: config.defaultAdmin.password,
        name: config.defaultAdmin.name,
        role: config.defaultAdmin.role
      });
      console.log(`[Seed] Super Admin initialized successfully in MongoDB with ID: ${admin.id}`);
      return admin;
    } else {
      console.log(`[Seed] Super Admin already exists in MongoDB (${existing.email}). Skipping seed.`);
      return Admin.sanitize(existing);
    }
  } catch (err) {
    console.error('[Seed] Error seeding default admin in MongoDB:', err.message);
    throw err;
  }
}

if (require.main === module) {
  seedDefaultAdmin()
    .then(() => {
      console.log('[Seed] Seeding process completed.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Seed] Seeding failed:', err.message);
      process.exit(1);
    });
}

module.exports = {
  seedDefaultAdmin
};
