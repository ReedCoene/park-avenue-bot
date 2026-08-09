// Verifies the Slack tokens and shows which app/workspace they belong to.
//   node slack-check.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const axios = require('axios');

async function call(method, token) {
  const r = await axios.get(`https://slack.com/api/${method}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 20000,
  });
  return r.data;
}

(async () => {
  console.log('\n=== Slack token check ===\n');

  const bot = process.env.SLACK_BOT_TOKEN;
  const appT = process.env.SLACK_APP_TOKEN;

  if (!bot) { console.log('SLACK_BOT_TOKEN missing'); return; }

  const a = await call('auth.test', bot);
  if (!a.ok) {
    console.log(`Bot token INVALID: ${a.error}`);
    if (a.error === 'invalid_auth') console.log('  Re-copy the Bot User OAuth Token from Install App.');
    return;
  }
  console.log(`Bot token OK`);
  console.log(`  Workspace: ${a.team}`);
  console.log(`  Bot user:  ${a.user} (${a.user_id})`);
  console.log(`  App ID:    ${a.bot_id ? a.bot_id : '-'}`);

  // Which scopes did the install actually grant?
  const r = await axios.get('https://slack.com/api/auth.test', {
    headers: { Authorization: `Bearer ${bot}` }, timeout: 20000,
  });
  const scopes = r.headers['x-oauth-scopes'];
  console.log(`\nGranted scopes:\n  ${scopes || '(none reported)'}`);

  const NEEDED = ['app_mentions:read', 'chat:write', 'im:history', 'im:read', 'im:write'];
  if (scopes) {
    const have = scopes.split(',').map(s => s.trim());
    const missing = NEEDED.filter(s => !have.includes(s));
    if (missing.length) {
      console.log(`\nMISSING scopes: ${missing.join(', ')}`);
      console.log('  Add them under OAuth & Permissions, then REINSTALL the app.');
    } else {
      console.log('\nAll required scopes present.');
    }
  }

  console.log(`\nApp-level token: ${appT ? (appT.startsWith('xapp-') ? 'present, looks right' : 'present but does NOT start with xapp-') : 'MISSING'}`);
  console.log('');
})().catch(e => console.error('Failed:', e.response?.data || e.message));
