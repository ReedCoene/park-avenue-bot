const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const axios = require('axios');
const fs = require('fs');

(async () => {
  console.log('Refreshing token using existing refresh token...');
  const creds = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64');
  try {
    const res = await axios.post(
      'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      `grant_type=refresh_token&refresh_token=${encodeURIComponent(process.env.QBO_REFRESH_TOKEN)}`,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${creds}` } }
    );
    const t = res.data;
    let env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    env = env.replace(/QBO_ACCESS_TOKEN=.*/, `QBO_ACCESS_TOKEN=${t.access_token}`);
    if (t.refresh_token) env = env.replace(/QBO_REFRESH_TOKEN=.*/, `QBO_REFRESH_TOKEN=${t.refresh_token}`);
    fs.writeFileSync(path.join(__dirname, '.env'), env);
    console.log('✓ New access token saved. Testing connection...');

    // Quick test
    const realm = process.env.QBO_REALM_ID;
    const test = await axios.get(`https://quickbooks.api.intuit.com/v3/company/${realm}/query`, {
      params: { query: 'SELECT * FROM CompanyInfo MAXRESULTS 1' },
      headers: { Authorization: `Bearer ${t.access_token}`, Accept: 'application/json' },
    });
    console.log(`✓ Connected! Company: ${test.data.QueryResponse.CompanyInfo[0].CompanyName}`);
  } catch (e) {
    console.error('Failed:', e.response?.data || e.message);
    if (e.response?.data?.error === 'invalid_grant') {
      console.log('\nRefresh token is expired or invalid — full re-auth required.');
    }
  }
})();
