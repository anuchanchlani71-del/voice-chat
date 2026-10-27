const http = require('http');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: 5000,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let resBody = '';
      res.on('data', c => resBody += c);
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(resBody) }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(path, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 5000,
      path,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    }, res => {
      let resBody = '';
      res.on('data', c => resBody += c);
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(resBody) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function test() {
  const uid = Math.floor(1000 + Math.random() * 9000);
  
  // Register Account A
  const regA = await post('/api/v1/auth/register', {
    fullName: 'Account A Real',
    username: `user_a_${uid}`,
    email: `usera_${uid}@example.com`,
    password: 'Password123!'
  });
  console.log('Reg A status:', regA.status, 'ID:', regA.data.user?.id);

  // Register Account B
  const regB = await post('/api/v1/auth/register', {
    fullName: 'Account B Real',
    username: `user_b_${uid}`,
    email: `userb_${uid}@example.com`,
    password: 'Password123!'
  });
  console.log('Reg B status:', regB.status, 'ID:', regB.data.user?.id);

  const tokenA = regA.data.token;

  // Account A calls GET /api/v1/users/discover
  const discA = await get('/api/v1/users/discover?page=1&limit=50', tokenA);
  console.log('Account A Discover status:', discA.status);
  console.log('Account A Discover totalCount:', discA.data.totalCount);
  const foundB = discA.data.users?.find(u => u.id === regB.data.user?.id);
  const foundA = discA.data.users?.find(u => u.id === regA.data.user?.id);
  console.log('Account B found in Discover for Account A?', !!foundB, foundB?.username);
  console.log('Account A found in Discover for Account A (should be false)?', !!foundA);
}

test();
