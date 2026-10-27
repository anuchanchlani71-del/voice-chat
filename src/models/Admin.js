let mongoose;
try {
  mongoose = require('mongoose');
} catch (e) {
  mongoose = null;
}

const { hashPassword, verifyPassword } = require('../utils/passwordUtils');

let AdminModel;

if (mongoose) {
  const AdminSchema = new mongoose.Schema(
    {
      id: {
        type: String,
        unique: true,
        index: true
      },
      name: {
        type: String,
        required: [true, 'Admin name is required'],
        trim: true
      },
      email: {
        type: String,
        required: [true, 'Admin email is required'],
        unique: true,
        lowercase: true,
        trim: true,
        index: true
      },
      role: {
        type: String,
        default: 'Super Admin',
        trim: true
      },
      initials: {
        type: String,
        default: 'AD',
        trim: true
      },
      passwordHash: {
        type: String,
        required: true
      },
      salt: {
        type: String,
        required: true
      }
    },
    {
      timestamps: true,
      collection: 'admins',
      toJSON: {
        transform: function (doc, ret) {
          delete ret.passwordHash;
          delete ret.salt;
          delete ret.__v;
          if (ret._id) {
            ret.id = ret.id || ret._id.toString();
            delete ret._id;
          }
          return ret;
        }
      }
    }
  );

  /**
   * Static: Find Admin by email (case-insensitive)
   */
  AdminSchema.statics.findByEmail = async function (email) {
    if (!email) return null;
    return this.findOne({ email: email.trim().toLowerCase() });
  };

  /**
   * Static: Find Admin by unique ID or MongoDB _id
   */
  AdminSchema.statics.findAdminById = async function (id) {
    if (!id) return null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      return this.findById(id);
    }
    return this.findOne({ id });
  };

  /**
   * Static: Create and persist a new Admin document in MongoDB
   */
  AdminSchema.statics.createAdmin = async function ({ email, password, name, role = 'Super Admin', initials }) {
    if (!email || !password) {
      throw new Error('Email and password are required.');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.findOne({ email: normalizedEmail });
    if (existing) {
      throw new Error(`Admin with email "${normalizedEmail}" already exists.`);
    }

    const { salt, hash } = await hashPassword(password);
    const computedInitials = initials || (name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : 'AD');
    const customId = `adm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const admin = new this({
      id: customId,
      name: name || 'Admin Team',
      email: normalizedEmail,
      role: role || 'Super Admin',
      initials: computedInitials,
      passwordHash: hash,
      salt: salt
    });

    await admin.save();
    return this.sanitize(admin);
  };

  /**
   * Static: Compare plain text password against stored hash/salt
   */
  AdminSchema.statics.comparePassword = async function (adminDoc, candidatePassword) {
    if (!adminDoc || !adminDoc.salt || !adminDoc.passwordHash) {
      return false;
    }
    return verifyPassword(candidatePassword, adminDoc.salt, adminDoc.passwordHash);
  };

  /**
   * Static: Sanitize admin document to strip password/salt/hash
   */
  AdminSchema.statics.sanitize = function (adminDoc) {
    if (!adminDoc) return null;
    const obj = adminDoc.toObject ? adminDoc.toObject() : { ...adminDoc };
    delete obj.passwordHash;
    delete obj.salt;
    delete obj.__v;
    if (obj._id) {
      obj.id = obj.id || obj._id.toString();
      delete obj._id;
    }
    return obj;
  };

  AdminModel = mongoose.models.Admin || mongoose.model('Admin', AdminSchema);
} else {
  // Fallback interface if mongoose not installed yet
  AdminModel = class StandaloneAdmin {
    static sanitize(doc) {
      if (!doc) return null;
      const { passwordHash, salt, __v, _id, ...safe } = doc;
      safe.id = safe.id || (_id ? _id.toString() : '');
      return safe;
    }
  };
}

module.exports = AdminModel;
