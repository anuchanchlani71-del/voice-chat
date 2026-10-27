const crypto = require('crypto');

/**
 * Secure cryptographic password hashing utility using Node.js native crypto.
 * Implements PBKDF2 with SHA-512 and 100,000 iterations + cryptographically secure salt.
 */

const ITERATIONS = 100000;
const KEYLEN = 64;
const DIGEST = 'sha512';

/**
 * Hash a plain text password with a newly generated salt.
 * @param {string} password - The plain text password to hash.
 * @returns {Promise<{ salt: string, hash: string }>}
 */
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    if (!password || typeof password !== 'string') {
      return reject(new Error('Password must be a non-empty string.'));
    }

    const salt = crypto.randomBytes(32).toString('hex');
    crypto.pbkdf2(password, salt, ITERATIONS, KEYLEN, DIGEST, (err, derivedKey) => {
      if (err) return reject(err);
      resolve({
        salt,
        hash: derivedKey.toString('hex')
      });
    });
  });
}

/**
 * Verify a plain text password against a stored salt and hash using timingSafeEqual.
 * @param {string} candidatePassword - The candidate password supplied during login.
 * @param {string} storedSalt - The stored hex-encoded salt.
 * @param {string} storedHash - The stored hex-encoded hash.
 * @returns {Promise<boolean>}
 */
function verifyPassword(candidatePassword, storedSalt, storedHash) {
  return new Promise((resolve, reject) => {
    if (!candidatePassword || !storedSalt || !storedHash) {
      return resolve(false);
    }

    crypto.pbkdf2(candidatePassword, storedSalt, ITERATIONS, KEYLEN, DIGEST, (err, derivedKey) => {
      if (err) return reject(err);
      try {
        const candidateBuffer = Buffer.from(derivedKey.toString('hex'), 'hex');
        const storedBuffer = Buffer.from(storedHash, 'hex');

        if (candidateBuffer.length !== storedBuffer.length) {
          return resolve(false);
        }

        const isMatch = crypto.timingSafeEqual(candidateBuffer, storedBuffer);
        resolve(isMatch);
      } catch (e) {
        resolve(false);
      }
    });
  });
}

module.exports = {
  hashPassword,
  verifyPassword
};
