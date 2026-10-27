const { Server } = require('socket.io');
const { verifyToken } = require('../utils/tokenUtils');
const User = require('../models/User');
const { registerSocketHandlers } = require('./socketHandlers');

let io = null;

/**
 * Initialize Socket.IO server attached to existing HTTP server.
 * @param {object} httpServer - Node.js HTTP server instance
 * @returns {object} Initialized Socket.IO server instance
 */
function initSocketServer(httpServer) {
  if (io) {
    return io;
  }

  io = new Server(httpServer, {
    cors: {
      origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingTimeout: 20000,
    pingInterval: 25000
  });

  // ── SOCKET AUTHENTICATION MIDDLEWARE ──────────────────────────────────
  io.use(async (socket, next) => {
    try {
      // 1. Read token strictly from handshake.auth object (rejecting query string tokens)
      const token = socket.handshake.auth && socket.handshake.auth.token;

      if (!token || typeof token !== 'string') {
        return next(new Error('Authentication token required'));
      }

      // 2. Verify JWT token structure & signature
      const result = verifyToken(token);
      if (!result.valid) {
        if (result.expired) {
          return next(new Error('Authentication token has expired'));
        }
        return next(new Error('Invalid or tampered authentication token'));
      }

      if (!result.payload || !result.payload.id) {
        return next(new Error('Invalid authentication token payload'));
      }

      // 3. Retrieve user document from MongoDB
      const user = await User.findUserByIdOrIdentifier(result.payload.id);
      if (!user) {
        return next(new Error('User account not found or access revoked'));
      }

      // 4. Check account status (suspended or blocked)
      if (user.accountStatus === 'suspended') {
        return next(new Error('Account suspended due to community guideline violations'));
      }

      if (user.isBlocked) {
        return next(new Error('Account has been blocked'));
      }

      // 5. Attach sanitized user object with _id string preserved to socket object
      const sanitized = User.sanitize(user);
      socket.user = {
        ...sanitized,
        _id: user._id.toString()
      };
      next();
    } catch (err) {
      next(err);
    }
  });

  // ── CONNECTION LIFECYCLE & PERSONAL ROOM SETUP ──────────────────────
  io.on('connection', (socket) => {
    const userId = socket.user.id || socket.user._id;
    const userRoom = `user:${userId}`;

    // Join personal user room (used for targeted notifications, calls, messages)
    socket.join(userRoom);

    // Register Direct Message & transient socket handlers
    registerSocketHandlers(io, socket);

    console.log(`[Socket] User connected: ${socket.user.username} (Socket ID: ${socket.id}) -> Joined room "${userRoom}"`);

    // Disconnect Cleanup Handler
    socket.on('disconnect', (reason) => {
      console.log(`[Socket] User disconnected: ${socket.user.username} (Socket ID: ${socket.id}) [Reason: ${reason}]`);
      try {
        const { handleUserDisconnectCallCleanup } = require('../utils/callSocketHelper');
        const { handleUserDisconnectRoomCleanup } = require('../utils/roomSocketHelper');
        const targetId = socket.user.id || socket.user._id;
        handleUserDisconnectCallCleanup(targetId).catch(() => {});
        handleUserDisconnectRoomCleanup(targetId).catch(() => {});
      } catch (err) {
        // Non-fatal cleanup error
      }
    });


    // Error Handler
    socket.on('error', (err) => {
      console.warn(`[Socket] Socket error for ${socket.user.username}:`, err.message);
    });
  });

  console.log('⚡ Socket.IO Foundation Server initialized successfully.');
  return io;
}

/**
 * Get active Socket.IO server instance.
 * @returns {object|null}
 */
function getIO() {
  if (!io) {
    throw new Error('Socket.IO server has not been initialized yet.');
  }
  return io;
}

module.exports = {
  initSocketServer,
  getIO
};
