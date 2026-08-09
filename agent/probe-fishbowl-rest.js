// Probe the Fishbowl REST API (Jetty). Learns the login contract. Run: node probe-fishbowl-rest.js
require('dotenv').config();
const axios = require('axios');
const host = process.env.FB_SERVER, port = process.env.FB_PORT;
const opt = { timeout: 9000, validateStatus: () => true };

async function tryBase(base) {
  console.log(`\n=== ${base} ===`);
  try {
    const root = await axios.get(`${base}/api/`, opt);
    console.log(`GET /api/ -> ${root.status}`, JSON.stringify(root.data).slice(0, 200));
  } catch (e) { console.log('GET /api/ ->', e.code || e.message); }

  const body = { appName: 'OpsBot', appDescription: 'AI ops assistant', appId: 1, username: process.env.FB_USERNAME, password: process.env.FB_PASSWORD };
  try {
    const r = await axios.post(`${base}/api/login`, body, { ...opt, headers: { 'Content-Type': 'application/json' } });
    console.log(`POST /api/login -> ${r.status}`);
    console.log('  body:', JSON.stringify(r.data).slice(0, 700));
    console.log('  token header:', r.headers['token'] || r.headers['authorization'] || '(none)');
    return r;
  } catch (e) { console.log('POST /api/login ->', e.code || e.message); }
}

(async () => {
  await tryBase(`http://${host}:${port}`);
  // fallback to https if http didn't behave
  const https = require('https');
  axios.defaults.httpsAgent = new https.Agent({ rejectUnauthorized: false });
  await tryBase(`https://${host}:${port}`);
})();
