// One-shot health check: tells you exactly what is connected and what is not.
//   node status.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const axios = require('axios');

const ok = (m) => console.log(`  [ OK ]  ${m}`);
const bad = (m) => console.log(`  [FAIL]  ${m}`);
const info = (m) => console.log(`          ${m}`);

const REQUIRED = [
  'FB_SERVER', 'FB_PORT', 'FB_USERNAME', 'FB_PASSWORD',
  'QBO_CLIENT_ID', 'QBO_CLIENT_SECRET', 'QBO_REDIRECT_URI',
  'QBO_ACCESS_TOKEN', 'QBO_REFRESH_TOKEN', 'QBO_REALM_ID',
];

function checkEnv() {
  console.log('\n── Configuration (.env) ───────────────────────────────');
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    bad(`Missing keys: ${missing.join(', ')}`);
    return false;
  }
  ok(`All ${REQUIRED.length} required keys present`);
  info(`Fishbowl server: ${process.env.FB_SERVER}:${process.env.FB_PORT}`);
  info(`QBO realm ID:    ${process.env.QBO_REALM_ID}`);
  return true;
}

async function checkFishbowl() {
  console.log('\n── Fishbowl ───────────────────────────────────────────');
  const base = `http://${process.env.FB_SERVER}:${process.env.FB_PORT}/api`;
  let token;
  try {
    const res = await axios.post(`${base}/login`, {
      username: process.env.FB_USERNAME,
      password: process.env.FB_PASSWORD,
      appName: 'Claude Reports',
      appDescription: 'Claude AI integration',
      appId: 5150,
    }, { timeout: 30000 });
    token = res.data.token;
    ok('Login succeeded');
  } catch (e) {
    const msg = e.response?.data?.message || e.message;
    bad(`Login failed (${e.response?.status || e.code || 'network'})`);
    info(msg);
    if (/approve/i.test(msg)) {
      info('FIX: In the Fishbowl desktop client, log in as admin and go to');
      info('     Account > Integrated Apps (or the approval prompt) and approve');
      info('     the app named "Claude Reports".');
    }
    return false;
  }

  try {
    const meta = await axios.get(`${base}/sales-orders`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { pageSize: 1 },
      timeout: 30000,
    });
    ok(`Sales orders reachable — ${(meta.data.totalCount || 0).toLocaleString()} total`);
  } catch (e) {
    bad(`Data read failed: ${e.response?.status || e.message}`);
  }

  await axios.post(`${base}/logout`, {}, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  return true;
}

async function checkQBO() {
  console.log('\n── QuickBooks Online ──────────────────────────────────');
  const realm = process.env.QBO_REALM_ID;
  const url = `https://quickbooks.api.intuit.com/v3/company/${realm}/query`;
  const q = { query: 'SELECT * FROM CompanyInfo MAXRESULTS 1' };

  const tryQuery = async (tok) => axios.get(url, {
    params: q,
    headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' },
    timeout: 30000,
  });

  try {
    const r = await tryQuery(process.env.QBO_ACCESS_TOKEN);
    ok(`Connected — ${r.data.QueryResponse.CompanyInfo[0].CompanyName}`);
    return true;
  } catch (e) {
    if (e.response?.status !== 401) {
      bad(`Unexpected error: ${e.response?.status || e.message}`);
      return false;
    }
  }

  info('Access token expired (normal — they last 1 hour). Trying refresh...');
  try {
    const creds = Buffer.from(
      `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`
    ).toString('base64');
    const res = await axios.post(
      'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      `grant_type=refresh_token&refresh_token=${encodeURIComponent(process.env.QBO_REFRESH_TOKEN)}`,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${creds}` }, timeout: 30000 }
    );
    const r = await tryQuery(res.data.access_token);
    ok(`Refresh works — ${r.data.QueryResponse.CompanyInfo[0].CompanyName}`);
    info('Run "node refresh-now.js" to write the new token to .env.');
    return true;
  } catch (e) {
    const err = e.response?.data;
    bad(`Refresh failed: ${err?.error || e.message}`);
    if (err?.error === 'invalid_grant') {
      info('The refresh token is dead (expired, revoked, or superseded).');
      info('FIX: run "node reauth.js" and follow the prompts.');
    }
    return false;
  }
}

(async () => {
  console.log('\n=== Park Avenue Analysis — connection status ===');
  const envOk = checkEnv();
  if (!envOk) {
    console.log('\nFill in the missing .env keys before continuing.\n');
    process.exit(1);
  }
  const fb = await checkFishbowl();
  const qbo = await checkQBO();

  console.log('\n── Summary ────────────────────────────────────────────');
  console.log(`  Fishbowl:      ${fb ? 'connected' : 'DOWN'}`);
  console.log(`  QuickBooks:    ${qbo ? 'connected' : 'DOWN'}`);
  if (fb && qbo) console.log('\n  All systems go. Try: node company-overview.js\n');
  else console.log('\n  See the FIX lines above.\n');
})();
