const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const readline = require('readline');
const { exec } = require('child_process');
const axios = require('axios');
const fs = require('fs');

const REDIRECT_URI = process.env.QBO_REDIRECT_URI;

const authUrl =
  `https://appcenter.intuit.com/connect/oauth2` +
  `?client_id=${process.env.QBO_CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent('com.intuit.quickbooks.accounting openid')}` +
  `&state=reports`;

async function exchangeCode(code) {
  const creds = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64');
  const res = await axios.post(
    'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${creds}` } }
  );
  return res.data;
}

const ENV_PATH = path.join(__dirname, '.env');

function saveTokens(tokens, realmId) {
  let env = fs.readFileSync(ENV_PATH, 'utf8');
  env = env.replace(/QBO_ACCESS_TOKEN=.*/, `QBO_ACCESS_TOKEN=${tokens.access_token}`);
  env = env.replace(/QBO_REFRESH_TOKEN=.*/, `QBO_REFRESH_TOKEN=${tokens.refresh_token}`);
  if (realmId) env = env.replace(/QBO_REALM_ID=.*/, `QBO_REALM_ID=${realmId}`);
  fs.writeFileSync(ENV_PATH, env);
}

(async () => {
  console.log('\n=== QuickBooks Re-Authorization ===\n');
  console.log('Opening browser...\n');
  exec(`start "" "${authUrl}"`);

  console.log('If the browser did not open, go to this URL manually:');
  console.log(authUrl);
  console.log('\n---');
  console.log('After you click "Connect" in QuickBooks:');
  console.log(`  - Your browser will redirect to ${REDIRECT_URI} (the page itself does not matter)`);
  console.log('  - Look at the ADDRESS BAR at the top of your browser');
  console.log('  - Copy the FULL URL from the address bar\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Paste the full URL from your address bar here:\n> ', async (input) => {
    rl.close();
    input = input.trim();

    let code, realmId;
    try {
      // Accept either a full URL or just the raw code
      if (input.startsWith('http')) {
        const u = new URL(input);
        code = u.searchParams.get('code');
        realmId = u.searchParams.get('realmId');
      } else {
        code = input;
      }
    } catch {
      code = input;
    }

    if (!code) {
      console.error('\nCould not find code in that URL. Make sure you copied the full address bar URL.\n');
      process.exit(1);
    }

    try {
      console.log('\nExchanging code for tokens...');
      const tokens = await exchangeCode(code);
      saveTokens(tokens, realmId);
      console.log('\n✓ Tokens saved. Verifying connection...');

      // Confirm the tokens work AND that we are pointed at the right company.
      const realm = realmId || process.env.QBO_REALM_ID;
      const test = await axios.get(`https://quickbooks.api.intuit.com/v3/company/${realm}/query`, {
        params: { query: 'SELECT * FROM CompanyInfo MAXRESULTS 1' },
        headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
      });
      console.log(`✓ Connected to: ${test.data.QueryResponse.CompanyInfo[0].CompanyName}`);
      console.log(`  Realm ID: ${realm}`);
      console.log(`  Access token valid for ${Math.round(tokens.expires_in / 60)} minutes (auto-refreshes)`);
      console.log('  Refresh token valid for ~100 days\n');
    } catch (e) {
      console.error('\nFailed:', e.response?.data || e.message);
      process.exit(1);
    }
  });
})();
