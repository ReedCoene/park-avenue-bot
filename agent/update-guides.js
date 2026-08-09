// Rewrite the pinned channel guides: vaguer wording, "OpsBot" -> "the agent",
// document-focused (not invoice-specific), no "QuickBooks limited to owner/manager" note.
require('dotenv').config();
const { WebClient } = require('@slack/web-api');
const web = new WebClient(process.env.SLACK_BOT_TOKEN);

const HOWTO = [
  { type: 'header', text: { type: 'plain_text', text: '👋 Meet OpsBot' } },
  { type: 'section', text: { type: 'mrkdwn', text:
    `*OpsBot* is your AI coworker. Find it in your sidebar under *Direct Messages*, click it, and just talk like you would to a person — plain English, no commands, no terminal.` } },
  { type: 'divider' },
  { type: 'section', text: { type: 'mrkdwn', text:
    `*What the agent can do:*\n` +
    `• Answer questions about whatever you're working on in *Fishbowl* or *QuickBooks* — just ask.\n` +
    `• *Send OpsBot the documents of what you're working on within Fishbowl/QuickBooks* — snap a photo or drop a PDF, and the agent reads it and handles the entry for you.\n` +
    `• Look things up so you don't have to dig through the system.` } },
  { type: 'section', text: { type: 'mrkdwn', text:
    `*How to send a document:*\n` +
    `• *Computer:* drag the photo or PDF into your OpsBot DM and hit Enter.\n` +
    `• *Phone:* in the OpsBot DM tap the *➕ / camera* → take a photo or pick one → send.` } },
  { type: 'divider' },
  { type: 'context', elements: [{ type: 'mrkdwn', text: `Stuck, or something looks off? Post in *#report-an-issue* and a person will help.` }] },
];

const BRIEF = [
  { type: 'header', text: { type: 'plain_text', text: '☀️ Morning Brief' } },
  { type: 'section', text: { type: 'mrkdwn', text:
    `Every morning *OpsBot* posts a snapshot here — inventory health, what's running low, and the day's activity. No need to log in and check; it comes to you.` } },
  { type: 'context', elements: [{ type: 'mrkdwn', text: `Posted automatically by the agent each morning.` }] },
];

const ISSUE = [
  { type: 'header', text: { type: 'plain_text', text: '🛠️ Report an Issue' } },
  { type: 'section', text: { type: 'mrkdwn', text:
    `Something not working right? OpsBot got something wrong, gave a strange answer, or you're stuck? *Post it here* and a person on the team will jump in. A screenshot helps if you can add one.` } },
  { type: 'context', elements: [{ type: 'mrkdwn', text: `This is the one channel for problems. For everything else, just *DM OpsBot* directly.` }] },
];

const TARGETS = [
  { name: 'how-to-use-agent', match: /meet /i, blocks: HOWTO, text: 'How to use OpsBot' },
  { name: 'morning-brief', match: /morning brief/i, blocks: BRIEF, text: 'Morning Brief' },
  { name: 'report-an-issue', match: /report an issue/i, blocks: ISSUE, text: 'Report an issue' },
];

(async () => {
  let chans = [], cursor;
  do {
    const r = await web.conversations.list({ exclude_archived: true, types: 'public_channel', limit: 200, cursor });
    chans = chans.concat(r.channels || []); cursor = r.response_metadata?.next_cursor;
  } while (cursor);
  const byName = Object.fromEntries(chans.map((c) => [c.name, c.id]));

  for (const t of TARGETS) {
    const id = byName[t.name];
    if (!id) { console.log(`! #${t.name} not found`); continue; }
    const hist = await web.conversations.history({ channel: id, limit: 30 });
    const msg = (hist.messages || []).find((m) => m.blocks?.some((b) => b.type === 'header' && t.match.test(b.text?.text || '')));
    if (msg) {
      await web.chat.update({ channel: id, ts: msg.ts, text: t.text, blocks: t.blocks });
      console.log(`updated #${t.name}`);
    } else {
      const m = await web.chat.postMessage({ channel: id, text: t.text, blocks: t.blocks });
      await web.pins.add({ channel: id, timestamp: m.ts }).catch(() => {});
      console.log(`posted fresh #${t.name}`);
    }
  }
  console.log('done.');
})().catch((e) => { console.error('ERR', e.data?.error || e.message); process.exit(1); });
