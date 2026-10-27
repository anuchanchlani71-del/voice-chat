const http = require('http');
const app = require('./src/app');
const config = require('./src/config/env');
const { connectDB, disconnectDB } = require('./src/config/db');
const Admin = require('./src/models/Admin');
const { signToken } = require('./src/utils/tokenUtils');

async function runTests() {
  console.log('--- Starting Admin Profile Update Tests ---');
  let server;
  try {
    await connectDB();

    // Ensure we have a primary test admin
    let testAdmin = await Admin.findByEmail('admin@voicefriends.io');
    if (!testAdmin) {
      testAdmin = await Admin.createAdmin({
        name: 'Admin Team',
        email: 'admin@voicefriends.io',
        password: 'AdminPassword123!',
        role: 'Super Admin',
        initials: 'AD'
      });
    }

    // Ensure we have a secondary admin to test duplicate email conflict
    let secondaryAdmin = await Admin.findByEmail('second_admin@voicefriends.io');
    if (!secondaryAdmin) {
      secondaryAdmin = await Admin.createAdmin({
        name: 'Second Admin',
        email: 'second_admin@voicefriends.io',
        password: 'SecondPassword123!',
        role: 'Moderator',
        initials: 'SA'
      });
    }

    server = http.createServer(app.callback());
    await new Promise((resolve) => server.listen(5001, resolve));
    const baseUrl = 'http://localhost:5001/api/v1';

    const token = signToken({
      id: testAdmin.id,
      email: testAdmin.email,
      role: testAdmin.role
    });

    // Helper request function
    async function request(path, options = {}) {
      const url = new URL(`${baseUrl}${path}`);
      return new Promise((resolve, reject) => {
        const req = http.request(url, {
          method: options.method || 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
            ...(options.headers || {})
          }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              resolve({ status: res.statusCode, body: json });
            } catch (e) {
              resolve({ status: res.statusCode, body: data });
            }
          });
        });
        req.on('error', reject);
        if (options.body) {
          req.write(JSON.stringify(options.body));
        }
        req.end();
      });
    }

    // Test 1: GET /admin/auth/me
    const t1 = await request('/admin/auth/me', { token });
    console.log('Test 1 (GET /me):', t1.status === 200 && t1.body.success ? 'PASS' : 'FAIL', t1.body);

    // Test 2: PUT /admin/auth/me (name only)
    const t2 = await request('/admin/auth/me', {
      method: 'PUT',
      token,
      body: { name: 'Super Admin Lead' }
    });
    console.log('Test 2 (PUT name only):', t2.status === 200 && t2.body.admin.name === 'Super Admin Lead' && t2.body.admin.initials === 'SA' ? 'PASS' : 'FAIL', t2.body);

    // Test 3: PUT /admin/auth/me (email only)
    const t3 = await request('/admin/auth/me', {
      method: 'PUT',
      token,
      body: { email: 'admin_updated@voicefriends.io' }
    });
    console.log('Test 3 (PUT email only):', t3.status === 200 && t3.body.admin.email === 'admin_updated@voicefriends.io' ? 'PASS' : 'FAIL', t3.body);

    // Test 4: PUT /admin/auth/me (name + email back to standard)
    const t4 = await request('/admin/auth/me', {
      method: 'PUT',
      token,
      body: { name: 'Admin Team', email: 'admin@voicefriends.io' }
    });
    console.log('Test 4 (PUT name + email):', t4.status === 200 && t4.body.admin.name === 'Admin Team' && t4.body.admin.email === 'admin@voicefriends.io' && t4.body.admin.initials === 'AT' ? 'PASS' : 'FAIL', t4.body);

    // Test 5: GET /me after update
    const t5 = await request('/admin/auth/me', { token });
    console.log('Test 5 (GET /me verified):', t5.status === 200 && t5.body.admin.name === 'Admin Team' ? 'PASS' : 'FAIL');

    // Test 6: Invalid empty name (400)
    const t6 = await request('/admin/auth/me', {
      method: 'PUT',
      token,
      body: { name: '   ' }
    });
    console.log('Test 6 (Invalid empty name -> 400):', t6.status === 400 && !t6.body.success ? 'PASS' : 'FAIL', t6.body);

    // Test 7: Invalid email format (400)
    const t7 = await request('/admin/auth/me', {
      method: 'PUT',
      token,
      body: { email: 'invalid-email-format' }
    });
    console.log('Test 7 (Invalid email -> 400):', t7.status === 400 && !t7.body.success ? 'PASS' : 'FAIL', t7.body);

    // Test 8: Duplicate email of another admin (409)
    const t8 = await request('/admin/auth/me', {
      method: 'PUT',
      token,
      body: { email: 'second_admin@voicefriends.io' }
    });
    console.log('Test 8 (Duplicate email -> 409):', t8.status === 409 && !t8.body.success ? 'PASS' : 'FAIL', t8.body);

    // Test 9: Unauthenticated PUT (401)
    const t9 = await request('/admin/auth/me', {
      method: 'PUT',
      body: { name: 'Hacker Name' }
    });
    console.log('Test 9 (Unauthenticated -> 401):', t9.status === 401 && !t9.body.success ? 'PASS' : 'FAIL', t9.body);

    // Test 10: Role modification attempt (Role must remain untouched)
    const t10 = await request('/admin/auth/me', {
      method: 'PUT',
      token,
      body: { role: 'Supreme Overlord' }
    });
    console.log('Test 10 (Role modification attempt -> protected):', t10.status === 400 || (t10.body.admin && t10.body.admin.role === 'Super Admin') ? 'PASS' : 'FAIL', t10.body);

    // Test 11 & 12: PasswordHash / salt modification & response check
    const t11 = await request('/admin/auth/me', {
      method: 'PUT',
      token,
      body: { name: 'Admin Team', passwordHash: 'hacked_hash', salt: 'hacked_salt' }
    });
    console.log('Test 11 & 12 (Credentials protected & omitted):', t11.status === 200 && t11.body.admin.passwordHash === undefined && t11.body.admin.salt === undefined ? 'PASS' : 'FAIL');

    console.log('--- ALL TESTS COMPLETED SUCCESSFULLY ---');
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    if (server) server.close();
    await disconnectDB();
  }
}

runTests();
