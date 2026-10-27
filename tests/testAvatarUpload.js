const http = require('http');
const fs = require('fs');
const path = require('path');
const app = require('../src/app');
const { connectDB, disconnectDB } = require('../src/config/db');
const User = require('../src/models/User');
const { signToken } = require('../src/utils/tokenUtils');

async function runAvatarUploadTests() {
  console.log('=== RUNNING AVATAR UPLOAD AUTOMATED TESTS ===\n');
  let testPassCount = 0;
  let testFailCount = 0;
  let server;
  let testUser;
  let userToken;

  const assert = (condition, testName) => {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      testPassCount++;
    } else {
      console.error(`[FAIL] ${testName}`);
      testFailCount++;
    }
  };

  try {
    // 0. Connect DB
    await connectDB();

    // 1. Start test HTTP server on random port (0)
    server = http.createServer(app.callback());
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    console.log(`Test HTTP server started on http://127.0.0.1:${port}`);

    // 2. Prepare test user in MongoDB
    const testUsername = `avatar_test_${Date.now()}`;
    const userId = `usr_avatar_${Date.now()}`;
    testUser = await User.create({
      id: userId,
      fullName: 'Avatar Test User',
      username: testUsername,
      email: `${testUsername}@example.com`,
      passwordHash: '$2b$10$abcdefghijklmnopqrstuuu', // mock hash
      role: 'user',
      avatar: '🎧',
      avatarId: 'av-1'
    });


    userToken = signToken({
      id: testUser._id.toString(),
      username: testUser.username,
      email: testUser.email,
      role: testUser.role
    });


    // Helper: Perform HTTP Request
    const makeRequest = (options, postData = null) => {
      return new Promise((resolve, reject) => {
        const reqOptions = {
          hostname: '127.0.0.1',
          port: port,
          path: options.path,
          method: options.method || 'GET',
          headers: options.headers || {}
        };
        const req = http.request(reqOptions, (res) => {
          let rawData = '';
          const chunks = [];
          res.on('data', (chunk) => {
            rawData += chunk;
            chunks.push(chunk);
          });
          res.on('end', () => {
            let json = null;
            try {
              json = JSON.parse(rawData);
            } catch (e) {}
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: rawData,
              buffer: Buffer.concat(chunks),
              json
            });
          });
        });
        req.on('error', reject);
        if (postData) {
          req.write(postData);
        }
        req.end();
      });
    };

    // Helper: Construct multipart/form-data payload
    const createMultipartPayload = (fieldName, filename, mimeType, bufferData) => {
      const boundary = '----WebKitFormBoundaryTest' + Date.now();
      let header = `--${boundary}\r\n`;
      header += `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n`;
      header += `Content-Type: ${mimeType}\r\n\r\n`;
      const footer = `\r\n--${boundary}--\r\n`;

      const headerBuffer = Buffer.from(header, 'utf8');
      const footerBuffer = Buffer.from(footer, 'utf8');
      const payload = Buffer.concat([headerBuffer, bufferData, footerBuffer]);

      return {
        boundary,
        contentType: `multipart/form-data; boundary=${boundary}`,
        payload
      };
    };

    // TEST 1: Reject unauthorized upload (No Token)
    {
      const dummyPng = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
      const { contentType, payload } = createMultipartPayload('avatar', 'test.png', 'image/png', dummyPng);
      const res = await makeRequest({
        path: '/api/v1/users/upload-avatar',
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          'Content-Length': payload.length
        }
      }, payload);

      assert(res.statusCode === 401, 'Test 1: Unauthorized upload without token returns 401 status');
    }

    // TEST 2: Reject invalid file extension/MIME (Text File)
    {
      const textBuffer = Buffer.from('This is a plain text file, not an image.', 'utf8');
      const { contentType, payload } = createMultipartPayload('avatar', 'malicious.exe.txt', 'text/plain', textBuffer);
      const res = await makeRequest({
        path: '/api/v1/users/upload-avatar',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${userToken}`,
          'Content-Type': contentType,
          'Content-Length': payload.length
        }
      }, payload);

      assert(res.statusCode === 400 && res.json && res.json.success === false, 'Test 2: Invalid file extension/MIME rejected with 400 status');
    }

    // TEST 3: Reject file exceeding 2 MB limit
    {
      const oversizedBuffer = Buffer.alloc(2.5 * 1024 * 1024); // 2.5 MB
      const { contentType, payload } = createMultipartPayload('avatar', 'large_photo.png', 'image/png', oversizedBuffer);
      const res = await makeRequest({
        path: '/api/v1/users/upload-avatar',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${userToken}`,
          'Content-Type': contentType,
          'Content-Length': payload.length
        }
      }, payload);

      assert(res.statusCode === 400 && res.json && res.json.error.includes('2 MB'), 'Test 3: File over 2 MB rejected with 400 status');
    }

    // TEST 4: Successful upload of valid PNG image
    let firstAvatarUrl = '';
    let firstUploadedFilePath = '';
    {
      // 1x1 Transparent PNG valid magic bytes & structure
      const validPngHex = '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d0b0000000049454e44ae426082';
      const validPngBuffer = Buffer.from(validPngHex, 'hex');
      const { contentType, payload } = createMultipartPayload('avatar', 'profile_pic.png', 'image/png', validPngBuffer);

      const res = await makeRequest({
        path: '/api/v1/users/upload-avatar',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${userToken}`,
          'Content-Type': contentType,
          'Content-Length': payload.length
        }
      }, payload);

      assert(res.statusCode === 200 && res.json && res.json.success === true, 'Test 4: Valid PNG upload returns 200 OK');
      assert(res.json && res.json.avatarUrl && res.json.avatarUrl.startsWith('/uploads/avatars/'), 'Test 4: Response contains correct /uploads/avatars/ avatarUrl');

      if (res.json && res.json.avatarUrl) {
        firstAvatarUrl = res.json.avatarUrl;
        const filename = path.basename(firstAvatarUrl);
        firstUploadedFilePath = path.join(__dirname, '../uploads/avatars', filename);
        assert(fs.existsSync(firstUploadedFilePath), 'Test 4: Uploaded PNG file exists on local disk storage');
      }

      // Verify user DB record updated
      const updatedDbUser = await User.findById(testUser._id);
      assert(updatedDbUser.avatar === firstAvatarUrl && updatedDbUser.avatarId === 'custom', 'Test 4: User record in MongoDB updated with custom avatarUrl');
    }

    // TEST 5: Verify static HTTP serving of uploaded avatar
    {
      const res = await makeRequest({
        path: firstAvatarUrl,
        method: 'GET'
      });

      assert(res.statusCode === 200, 'Test 5: GET static upload endpoint returns HTTP 200');
      assert(res.headers['content-type'] === 'image/png', 'Test 5: Static upload served with correct image/png Content-Type header');
    }

    // TEST 6: Upload a second image & verify cleanup of old custom avatar file
    {
      const validJpegHex = 'ffd8ffe000104a46494600010101004000400000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffda0008010100003f007f00d9';
      const validJpegBuffer = Buffer.from(validJpegHex, 'hex');
      const { contentType, payload } = createMultipartPayload('avatar', 'new_profile.jpg', 'image/jpeg', validJpegBuffer);

      const res = await makeRequest({
        path: '/api/v1/users/upload-avatar',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${userToken}`,
          'Content-Type': contentType,
          'Content-Length': payload.length
        }
      }, payload);

      assert(res.statusCode === 200 && res.json.success === true, 'Test 6: Second photo upload returns 200 OK');
      assert(!fs.existsSync(firstUploadedFilePath), 'Test 6: Previous uploaded avatar file safely deleted from storage');
    }

    // TEST 7: Clean up test user & files
    if (testUser) {
      const dbUser = await User.findById(testUser._id);
      if (dbUser && dbUser.avatar && dbUser.avatar.startsWith('/uploads/avatars/')) {
        const fileToDelete = path.join(__dirname, '../uploads/avatars', path.basename(dbUser.avatar));
        if (fs.existsSync(fileToDelete)) {
          try { fs.unlinkSync(fileToDelete); } catch (e) {}
        }
      }
      await User.deleteOne({ _id: testUser._id });
      console.log('Cleaned up test user and temporary upload test file.');
    }

  } catch (err) {
    console.error('Test execution error:', err);
    testFailCount++;
  } finally {
    if (server) {
      await new Promise(resolve => server.close(resolve));
      console.log('Test server closed.');
    }
    await disconnectDB();
  }

  console.log(`\n========================================`);
  console.log(`AVATAR UPLOAD TEST SUMMARY: ${testPassCount} PASSED, ${testFailCount} FAILED`);
  console.log(`========================================\n`);

  if (testFailCount > 0) {
    process.exit(1);
  }
}

runAvatarUploadTests();
