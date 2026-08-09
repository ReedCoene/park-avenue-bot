// Daily push digest -> posts a morning summary to a Slack channel. Run on a cron (e.g. 7am).
require('dotenv').config();
const { WebClient } = require('@slack/web-api');
const qbo = require('./lib/qbo');

const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });

(async () => {
  const web = new WebClient(process.env.SLACK_BOT_TOKEN);
  const blocks = [{ type: 'header', text: { type: 'plain_text', text: '☀️ Park Ave — Daily Ops' } }];
  let text = 'Daily Ops';

  try {
    if (qbo.ready()) {
      const r = await qbo.getOpenInvoices();
      const inv = r.Invoice || [];
      const total = inv.reduce((s, i) => s + Number(i.Balance || 0), 0);
      text = `💰 Overdue/open AR: ${money(total)} across ${inv.length} invoices`;
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `💰 *Open AR:* ${money(total)} across *${inv.length}* invoices` } });
    } else {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '_Connect QuickBooks + Fishbowl to populate this digest._' } });
    }
  } catch (e) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `:warning: digest error: ${e.message}` } });
  }
  // TODO: add Fishbowl low-stock list once the company FB API user is wired.

  await web.chat.postMessage({ channel: process.env.DIGEST_CHANNEL, text, blocks });
  console.log('digest posted');
})();
