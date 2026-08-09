// Proves the bot's demo mode walks the full payment flow without writing to QuickBooks.
//   node test-demo-flow.js
//
// Checks the invoice balance before and after a simulated payment. If demo mode is
// correct the balance is unchanged and no Payment row is created.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const qbo = require('./qbo');

const DOC = process.argv[2] || '45892';

(async () => {
  const before = (await qbo.query(`SELECT * FROM Invoice WHERE DocNumber = '${DOC}'`))?.Invoice?.[0];
  if (!before) { console.log(`Invoice ${DOC} not found.`); return; }

  console.log(`\nInvoice ${DOC} — ${before.CustomerRef.name}`);
  console.log(`Balance before: $${Number(before.Balance).toFixed(2)}`);

  const payCountBefore = ((await qbo.query(
    `SELECT * FROM Payment WHERE TxnDate = '${new Date().toISOString().slice(0, 10)}' MAXRESULTS 100`
  ))?.Payment || []).length;
  console.log(`Payments dated today, before: ${payCountBefore}`);

  // Run the bot's own router in demo mode — same code path Slack drives.
  process.env.SLACK_BOT_TOKEN ||= 'x';
  process.env.SLACK_APP_TOKEN ||= 'x';
  process.env.SLACK_ALLOWED_USERS ||= 'UTEST';
  const bot = require('./slack-bot.js');

  const first = await bot._handle('UTEST', `demo pay ${DOC}`);
  console.log('\n--- bot reply to "demo pay" ---\n' + first);

  const second = await bot._handle('UTEST', 'confirm');
  console.log('\n--- bot reply to "confirm" ---\n' + second);

  const after = (await qbo.query(`SELECT * FROM Invoice WHERE DocNumber = '${DOC}'`))?.Invoice?.[0];
  const payCountAfter = ((await qbo.query(
    `SELECT * FROM Payment WHERE TxnDate = '${new Date().toISOString().slice(0, 10)}' MAXRESULTS 100`
  ))?.Payment || []).length;

  console.log(`\nBalance after:  $${Number(after.Balance).toFixed(2)}`);
  console.log(`Payments dated today, after:  ${payCountAfter}`);

  const clean = Number(after.Balance) === Number(before.Balance) && payCountAfter === payCountBefore;
  console.log(clean
    ? '\nPASS — demo mode wrote nothing to QuickBooks.'
    : '\nFAIL — something changed. Do NOT use demo mode until this is fixed.');
  process.exit(0);
})().catch(e => { console.error('Error:', e.response?.data || e.message); process.exit(1); });
