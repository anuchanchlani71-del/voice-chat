const http = require('http');
const app = require('./app');
const config = require('./config/env');
const { connectDB, disconnectDB } = require('./config/db');
const { seedDefaultAdmin } = require('./seed/seedAdmin');

const { initSocketServer } = require('./socket/socketServer');

async function startServer() {
  try {
    console.log('====================================================');
    console.log('🔄 Initializing Voice Chat & Friends Backend Service');
    console.log(`🌐 Environment: ${config.nodeEnv}`);
    console.log(`🗄️  Target MongoDB: ${config.mongoUri}`);
    console.log('====================================================');

    // 1. Establish MongoDB Connection (Fail-fast if database is unreachable)
    await connectDB();

    // 2. Seed initial Super Admin in MongoDB if not present
    await seedDefaultAdmin();

    // 3. Create & Launch HTTP Server
    const server = http.createServer(app.callback());

    // 4. Attach Socket.IO Foundation Server
    initSocketServer(server);

    server.listen(config.port, () => {
      console.log('====================================================');
      console.log(`🚀 Server listening on: http://localhost:${config.port}`);
      console.log(`🔒 Admin Auth Login:    POST http://localhost:${config.port}/api/v1/admin/auth/login`);
      console.log(`👤 Admin Auth Me:       GET  http://localhost:${config.port}/api/v1/admin/auth/me`);
      console.log(`🩺 Health Status:       GET  http://localhost:${config.port}/health`);
      console.log('====================================================');
    });

    // Graceful Shutdown Handling
    const handleShutdown = async (signal) => {
      console.log(`\n[Server] Received ${signal}. Gracefully terminating backend...`);
      server.close(async () => {
        await disconnectDB();
        console.log('[Server] HTTP listener and MongoDB connection closed.');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));

    return server;
  } catch (err) {
    console.error('====================================================');
    console.error('❌ FATAL BACKEND STARTUP FAILURE');
    console.error(`Reason: ${err.message}`);
    console.error('Server cannot start without a valid MongoDB connection.');
    console.error('====================================================');
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = {
  startServer
};
