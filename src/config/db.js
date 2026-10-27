const config = require('./env');

/**
 * MongoDB Database Connection Manager
 * Connects strictly to local MongoDB at config.mongoUri (mongodb://localhost:27017/voice-chat-friends).
 * Fails clearly if MongoDB is not available (no silent fallback).
 */

let mongoose;
try {
  mongoose = require('mongoose');
} catch (e) {
  // Graceful fallback if mongoose package not yet installed via npm
  mongoose = null;
}

let isConnected = false;
let dbInstance = null;

async function connectDB() {
  if (isConnected) {
    return mongoose ? mongoose.connection : dbInstance;
  }

  const uri = config.mongoUri;
  console.log(`[MongoDB] Connecting to local MongoDB instance: ${uri}...`);

  if (mongoose) {
    try {
      mongoose.set('strictQuery', true);
      const conn = await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5000,
        autoIndex: true
      });

      isConnected = true;
      dbInstance = conn.connection;

      console.log(`[MongoDB] Connected successfully to database: "${conn.connection.name}" on host: "${conn.connection.host}:${conn.connection.port}"`);

      mongoose.connection.on('error', (err) => {
        console.error(`[MongoDB] Connection error:`, err.message);
      });

      mongoose.connection.on('disconnected', () => {
        console.warn(`[MongoDB] Connection disconnected.`);
        isConnected = false;
      });

      return conn.connection;
    } catch (err) {
      console.error('====================================================');
      console.error('❌ MONGODB CONNECTION FAILED');
      console.error(`Target URI: ${uri}`);
      console.error(`Error Details: ${err.message}`);
      console.error('Please ensure your local MongoDB service is running on localhost:27017');
      console.error('====================================================');
      throw new Error(`MongoDB Connection Error: ${err.message}`);
    }
  } else {
    // If mongoose package is being loaded via native driver or standalone bridge
    try {
      const { MongoClient } = require('mongodb');
      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
      await client.connect();
      const db = client.db(config.dbName);
      isConnected = true;
      dbInstance = db;
      console.log(`[MongoDB] Connected successfully to database: "${config.dbName}" via MongoDB Client`);
      return db;
    } catch (err) {
      // If neither is installed or connection refused, fail fast
      console.error('====================================================');
      console.error('❌ MONGODB DRIVER / CONNECTION NOT AVAILABLE');
      console.error(`Target URI: ${uri}`);
      console.error(`Error: ${err.message}`);
      console.error('Please run "npm install mongoose" in /backend and ensure MongoDB is running locally on port 27017.');
      console.error('====================================================');
      throw new Error(`MongoDB Connection Error: ${err.message}`);
    }
  }
}

async function disconnectDB() {
  if (mongoose && mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    isConnected = false;
    console.log('[MongoDB] Disconnected from MongoDB.');
  }
}

function getConnectionStatus() {
  if (mongoose) {
    const states = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };
    return states[mongoose.connection.readyState] || 'unknown';
  }
  return isConnected ? 'connected' : 'disconnected';
}

module.exports = {
  connectDB,
  disconnectDB,
  getConnectionStatus,
  get mongoose() {
    return mongoose;
  }
};
