// One-time workspace builder. Creates the channels, sets topics/purposes,
// posts + pins a plain-English guide in each, and saves #morning-brief's id
// into .env as DIGEST_CHANNEL. Safe to re-run: existing channels are reused.
//   node setup-workspace.js
require('dotenv').config();
const fs = require('fs');
const { WebClient } = require('@slack/web-api');

const BOT = 'Agent';
const web = new WebClient(process.env.SLACK_BOT_TOKEN);

// --- channel definitions -----------------------------------------------------
const CHANNELS = [
  {
    name: 'how-to-use-agent',
    purpose: `How to get the most out of ${BOT} — your AI coworker for inventory, invoices, and quick answers.`,
    topic: `Ask ${BOT} anything. Plain English. No commands to memorize.`,
    guide: [
      { type: 'header', text: { type: 'plain_text', text: `👋 Meet ${BOT} — your AI coworker` } },
      { type: 'section', text: { type: 'mrkdwn', text:
        `*${BOT}* is here so nobody has to dig through Fishbowl or retype invoices by hand. ` +
        `Just talk to it like a person — in a channel type *@${BOT} your question*, or send it a *direct message*. No special commands, no terminal.` } },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text:
        `*📦 Ask about inventory (anyone can):*\n` +
        `• "How many size-L hi-vis vests do we have?"\n` +
        `• "What's running low?"\n` +
        `• "Do we have any Bills jerseys in stock?"` } },
      { type: 'section', text: { type: 'mrkdwn', text:
        `*🧾 Kill the invoice pile:*\n` +
        `• *Snap a photo* of a paper invoice (or drop a PDF) right into the chat.\n` +
        `• ${BOT} reads every line and posts a tidy card.\n` +
        `• Click *✅ Approve & enter* and it goes into the books — no retyping.` } },
      { type: 'section', text: { type: 'mrkdwn', text:
        `*💬 Just ask things:*\n` +
        `• "Who do we owe money to?" (owner/manager only)\n` +
        `• "Summarize this invoice"\n` +
        `• "What can you do?"` } },
      { type: 'divider' },
      { type: 'context', elements: [ { type: 'mrkdwn', text:
        `🔒 *Money matters are private.* Anyone can ask about inventory. ` +
        `QuickBooks / financial answers are limited to the owner & manager.` } ] },
      { type: 'context', elements: [ { type: 'mrkdwn', text:
        `New to Slack? Check *#slack-basics* for a 2-minute walkthrough.` } ] },
    ],
  },
  {
    name: 'morning-brief',
    purpose: `${BOT} posts a daily inventory snapshot from Fishbowl here every morning.`,
    topic: `☀️ Your daily Fishbowl inventory brief — posted automatically by ${BOT}.`,
    guide: [
      { type: 'header', text: { type: 'plain_text', text: '☀️ Morning Brief' } },
      { type: 'section', text: { type: 'mrkdwn', text:
        `Every morning, *${BOT}* will post a quick *inventory snapshot from Fishbowl* right here — ` +
        `things like what's low on stock and what moved. No need to log in and check; it comes to you.` } },
      { type: 'context', elements: [ { type: 'mrkdwn', text:
        `📦 *Inventory only.* Money/QuickBooks numbers are kept private to the owner & manager, so this channel is safe for the whole team.` } ] },
      { type: 'context', elements: [ { type: 'mrkdwn', text:
        `⏳ Goes live the morning after Fishbowl is connected. Tip: make this channel post-only in channel settings so it stays a clean feed.` } ] },
    ],
  },
  {
    name: 'slack-basics',
    purpose: 'A simple, no-jargon guide to using Slack and uploading invoices.',
    topic: 'New here? Everything you need in 2 minutes.',
    guide: [
      { type: 'header', text: { type: 'plain_text', text: '🧭 Slack in 2 minutes' } },
      { type: 'section', text: { type: 'mrkdwn', text:
        `*Talking to ${BOT}:*\n` +
        `• In any channel, type *@${BOT}* then your question and hit Enter.\n` +
        `• Or click *${BOT}* in the left sidebar to send a private message — same thing, just one-on-one.` } },
      { type: 'section', text: { type: 'mrkdwn', text:
        `*📸 Sending an invoice (computer):*\n` +
        `• Just *drag the photo or PDF* from your desktop into the message box and hit Enter, or\n` +
        `• Click the *➕ / paperclip* by the message box → *Upload from your computer*.` } },
      { type: 'section', text: { type: 'mrkdwn', text:
        `*📱 Sending an invoice (phone):*\n` +
        `• Tap the *➕* (or camera) by the message box → *take a photo* of the invoice or pick one from your gallery → send.` } },
      { type: 'section', text: { type: 'mrkdwn', text:
        `*Getting around:*\n` +
        `• *Channels* (left side) are like topic rooms — click one to read it.\n` +
        `• The *search bar* at the top finds anything.\n` +
        `• A *red badge* means something new is waiting for you.` } },
      { type: 'context', elements: [ { type: 'mrkdwn', text:
        `Stuck? Type your question to *${BOT}* — it can help with that too.` } ] },
    ],
  },
];

async function ensureChannel(def) {
  let ch;
  try {
    const r = await web.conversations.create({ name: def.name });
    ch = r.channel;
    console.log(`✅ created #${def.name}`);
  } catch (e) {
    if (e.data?.error === 'name_taken') {
      console.log(`• #${def.name} already exists — skipping (delete it in Slack to rebuild)`);
      return null;
    }
    throw e;
  }
  try { await web.conversations.setPurpose({ channel: ch.id, purpose: def.purpose }); } catch (e) {}
  try { await web.conversations.setTopic({ channel: ch.id, topic: def.topic }); } catch (e) {}
  const msg = await web.chat.postMessage({ channel: ch.id, text: def.purpose, blocks: def.guide });
  try { await web.pins.add({ channel: ch.id, timestamp: msg.ts }); } catch (e) {}
  return ch;
}

function saveEnv(key, value) {
  let c = fs.readFileSync('.env', 'utf8');
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  c = re.test(c) ? c.replace(re, line) : c.trimEnd() + '\n' + line + '\n';
  fs.writeFileSync('.env', c);
}

(async () => {
  const auth = await web.auth.test();
  console.log(`Connected as ${auth.user} in ${auth.team}\n`);
  const made = {};
  for (const def of CHANNELS) made[def.name] = await ensureChannel(def);
  if (made['morning-brief']) {
    saveEnv('DIGEST_CHANNEL', made['morning-brief'].id);
    console.log(`\n📌 DIGEST_CHANNEL set to #morning-brief (${made['morning-brief'].id}) in .env`);
  }
  console.log('\nDone. Open Slack and refresh — the channels + pinned guides are there.');
})();
