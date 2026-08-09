const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const OAuthClient = require('intuit-oauth');
const fs = require('fs');
const { exec } = require('child_process');

const client = new OAuthClient({
  clientId: process.env.QBO_CLIENT_ID,
  clientSecret: process.env.QBO_CLIENT_SECRET,
  environment: 'production',
  redirectUri: process.env.QBO_REDIRECT_URI,
});

const app = express();

app.get('/callback', async (req, res) => {
  try {
    const token = await client.createToken(req.url);
    const t = token.getJson();

    // Save tokens to .env
    let env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const set = (key, val) => {
      if (env.includes(`${key}=`)) {
        env = env.replace(new RegExp(`${key}=.*`), `${key}=${val}`);
      } else {
        env += `\n${key}=${val}`;
      }
    };
    set('QBO_ACCESS_TOKEN', t.access_token);
    set('QBO_REFRESH_TOKEN', t.refresh_token);
    set('QBO_REALM_ID', req.query.realmId);
    fs.writeFileSync(path.join(__dirname, '.env'), env);

    res.send('<h2>QuickBooks connected! You can close this tab.</h2>');
    console.log('\nQBO connected successfully! Tokens saved to .env');
    setTimeout(() => process.exit(0), 1000);
  } catch (e) {
    console.error('Auth error:', e.message);
    res.send('Error: ' + e.message);
  }
});

const server = app.listen(3000, () => {
  const authUrl = client.authorizeUri({
    scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
    state: 'reports',
  });

  console.log('Opening browser for QuickBooks authorization...');
  exec(`start "" "${authUrl}"`);
  console.log('\nIf the browser did not open, go to:\n' + authUrl);
});
