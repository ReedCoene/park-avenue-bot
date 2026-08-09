// One-time QuickBooks Online authorize -> saves fresh access/refresh/realm into .env.
// Run: node connect-qbo.js  (do this AFTER pasting the new QBO_CLIENT_ID + QBO_CLIENT_SECRET).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const readline = require('readline');
const { exec } = require('child_process');
const axios = require('axios');
const fs = require('fs');

const ENVPATH = path.join(__dirname, '.env');
const REDIRECT = process.env.QBO_REDIRECT_URI || 'https://httpbin.org/get';
const authUrl =
  'https://appcenter.intuit.com/connect/oauth2' +
  '?client_id=' + process.env.QBO_CLIENT_ID +
  '&redirect_uri=' + encodeURIComponent(REDIRECT) +
  '&response_type=code' +
  '&scope=' + encodeURIComponent('com.intuit.quickbooks.accounting openid') +
  '&state=opsbot';

async function exchange(code) {
  const creds = Buffer.from(process.env.QBO_CLIENT_ID + ':' + process.env.QBO_CLIENT_SECRET).toString('base64');
  const res = await axios.post(
    'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    'grant_type=authorization_code&code=' + encodeURIComponent(code) + '&redirect_uri=' + encodeURIComponent(REDIRECT),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + creds } }
  );
  return res.data;
}

(async () => {
  if (!process.env.QBO_CLIENT_ID || !process.env.QBO_CLIENT_SECRET) {
    console.error('Paste QBO_CLIENT_ID and QBO_CLIENT_SECRET into .env first.');
    process.exit(1);
  }
  console.log('\nOpening browser to authorize QuickBooks...');
  exec('start "" "' + authUrl + '"');
  console.log('\n1) Sign in to the company QuickBooks and click Connect.');
  console.log('2) The page jumps to httpbin.org (blank/error is fine).');
  console.log('3) Copy the FULL URL from the address bar and paste it below.\n');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Paste the full URL:\n> ', async (input) => {
    rl.close();
    let code, realmId;
    try { const u = new URL(input.trim()); code = u.searchParams.get('code'); realmId = u.searchParams.get('realmId'); }
    catch { code = input.trim(); }
    if (!code) { console.error('No code found in that URL.'); process.exit(1); }
    try {
      const t = await exchange(code);
      let env = fs.readFileSync(ENVPATH, 'utf8');
      env = env.replace(/QBO_ACCESS_TOKEN=.*/, 'QBO_ACCESS_TOKEN=' + t.access_token);
      env = env.replace(/QBO_REFRESH_TOKEN=.*/, 'QBO_REFRESH_TOKEN=' + t.refresh_token);
      if (realmId) env = env.replace(/QBO_REALM_ID=.*/, 'QBO_REALM_ID=' + realmId);
      fs.writeFileSync(ENVPATH, env);
      console.log('\n✅ Saved tokens + realm to .env. Now run:  node test-qbo.js');
    } catch (e) { console.error('Failed:', e.response?.data || e.message); }
  });
})();
