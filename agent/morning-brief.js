// Morning brief -> posts an informative inventory snapshot to #morning-brief.
// Reads from the local inventory cache (see lib/inventory.js) so it costs at most
// ONE Fishbowl seat for a couple seconds at 8am, not a seat per data point.
// Scheduled in-process by app.js at 8am ET. Standalone: `node morning-brief.js`.
require('dotenv').config();
const { WebClient } = require('@slack/web-api');
let fb = null;
try { fb = require('./lib/fishbowl'); } catch (e) {}

const web = new WebClient(process.env.SLACK_BOT_TOKEN);
const n = (x) => Number(x || 0).toLocaleString('en-US');
const today = () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/New_York' });

async function postBrief() {
  const blocks = [{ type: 'header', text: { type: 'plain_text', text: `☀️ Morning Brief — ${today()}` } }];
  let summary = 'Morning brief';

  let inv = null;
  if (fb && fb.ready()) { try { inv = await fb.inventorySummary(); } catch (e) {} } // live off the held session

  if (!inv) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '_Inventory is momentarily unavailable — the brief will fill in once Fishbowl is reachable._' } });
  } else {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text:
      `*📦 Inventory*\n` +
      `• *${n(inv.skuCount)}* items stocked  ·  *${n(inv.totalUnits)}* total units on hand\n` +
      `• *${n(inv.lowCount)}* running low  ·  *${n(inv.outCount)}* out of stock` } });
    if (inv.low.length) {
      const list = inv.low.slice(0, 8).map((r) => `• ${r.part} — *${n(r.qty)}* left`).join('\n');
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*⚠️ Lowest stock — reorder soon:*\n${list}` } });
    }
    if (inv.top && inv.top.length) {
      blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Deepest stock: ${inv.top.slice(0, 3).map((r) => `${r.part} (${n(r.qty)})`).join(', ')}` }] });
    }
    summary = `${n(inv.lowCount)} items low, ${n(inv.outCount)} out of stock`;
  }

  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: 'Need a live number on anything? Just DM the agent.' }] });
  await web.chat.postMessage({ channel: process.env.DIGEST_CHANNEL, text: summary, blocks });
  console.log('morning brief posted to', process.env.DIGEST_CHANNEL);
}

module.exports = { postBrief };

if (require.main === module) {
  postBrief().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
}
