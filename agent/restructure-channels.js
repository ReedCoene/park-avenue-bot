// One-off: switch to DM-first model.
//  - rewrite #how-to-use-agent guide to "DM Agent for everything" (+ fold in upload basics)
//  - create #report-an-issue (the only channel people post in)
//  - archive #slack-basics (its content now lives in the guide)
require('dotenv').config();
const { WebClient } = require('@slack/web-api');
const web = new WebClient(process.env.SLACK_BOT_TOKEN);
const BOT = 'Agent';

async function resolveId(name) {
  const r = await web.chat.postMessage({ channel: name, text: '.' });
  await web.chat.delete({ channel: r.channel, ts: r.ts }).catch(() => {});
  return r.channel;
}

const HOWTO = [
  { type: 'header', text: { type: 'plain_text', text: `👋 Meet ${BOT} — your AI coworker` } },
  { type: 'section', text: { type: 'mrkdwn', text:
    `*${BOT} works in your direct messages.* Find *${BOT}* in the left sidebar under *Direct Messages*, click it, and just talk like you would to a coworker — plain English, no commands, no terminal. Everything happens in that private chat.` } },
  { type: 'divider' },
  { type: 'section', text: { type: 'mrkdwn', text:
    `*📦 Ask about inventory (anyone can):*\n` +
    `• "How many size-L hi-vis vests do we have?"\n` +
    `• "What's running low?"\n` +
    `• "Do we have any Bills jerseys in stock?"` } },
  { type: 'section', text: { type: 'mrkdwn', text:
    `*🧾 Kill the invoice pile:*\n` +
    `• *Send ${BOT} a photo or PDF* of a paper invoice right in your DM.\n` +
    `• It reads every line and posts a tidy card.\n` +
    `• Click *✅ Approve & enter* — it goes into the books, no retyping.` } },
  { type: 'section', text: { type: 'mrkdwn', text:
    `*📸 How to send an invoice:*\n` +
    `• *Computer:* drag the photo/PDF into the message box in your ${BOT} DM, hit Enter.\n` +
    `• *Phone:* in the ${BOT} DM tap the *➕* / camera → take a photo or pick one → send.` } },
  { type: 'divider' },
  { type: 'context', elements: [ { type: 'mrkdwn', text:
    `🔒 Inventory questions are open to everyone. *Money / QuickBooks answers are limited to the owner & manager.*` } ] },
  { type: 'context', elements: [ { type: 'mrkdwn', text:
    `Something wrong, or ${BOT} stuck? Post in *#report-an-issue* and a person will help.` } ] },
];

const ISSUE = [
  { type: 'header', text: { type: 'plain_text', text: '🛠️ Report an Issue' } },
  { type: 'section', text: { type: 'mrkdwn', text:
    `Something not working right? ${BOT} read an invoice wrong, gave a strange answer, or you're stuck? ` +
    `*Post it here* and a person on the team will jump in. A screenshot helps if you can add one.` } },
  { type: 'context', elements: [ { type: 'mrkdwn', text:
    `This is the one channel for problems. For everything else, just *DM ${BOT}* directly.` } ] },
];

(async () => {
  // 1) rewrite the how-to guide in place
  const howId = await resolveId('how-to-use-agent');
  const hist = await web.conversations.history({ channel: howId, limit: 30 });
  const guideMsg = (hist.messages || []).find((m) => m.blocks?.some((b) => b.type === 'header' && /Meet /.test(b.text?.text || '')));
  if (guideMsg) {
    await web.chat.update({ channel: howId, ts: guideMsg.ts, text: `How to use ${BOT}`, blocks: HOWTO });
    console.log('updated #how-to-use-agent guide (DM-first)');
  } else {
    const m = await web.chat.postMessage({ channel: howId, text: `How to use ${BOT}`, blocks: HOWTO });
    await web.pins.add({ channel: howId, timestamp: m.ts }).catch(() => {});
    console.log('posted fresh #how-to-use-agent guide');
  }

  // 2) create #report-an-issue
  let issueId;
  try {
    const r = await web.conversations.create({ name: 'report-an-issue' });
    issueId = r.channel.id;
    console.log('created #report-an-issue');
  } catch (e) {
    if (e.data?.error === 'name_taken') { issueId = await resolveId('report-an-issue'); console.log('#report-an-issue already exists'); }
    else throw e;
  }
  await web.conversations.setPurpose({ channel: issueId, purpose: `Report problems with ${BOT} here — a person will help.` }).catch(() => {});
  await web.conversations.setTopic({ channel: issueId, topic: `Something wrong? Post it here. Everything else: DM ${BOT}.` }).catch(() => {});
  const im = await web.chat.postMessage({ channel: issueId, text: 'Report an issue', blocks: ISSUE });
  await web.pins.add({ channel: issueId, timestamp: im.ts }).catch(() => {});

  // 3) archive #slack-basics
  try {
    const sbId = await resolveId('slack-basics');
    await web.conversations.archive({ channel: sbId });
    console.log('archived #slack-basics');
  } catch (e) {
    console.log('#slack-basics:', e.data?.error || e.message);
  }

  console.log('\nDone. Channels now: #how-to-use-agent (guide), #morning-brief (feed), #report-an-issue (the only post channel).');
})().catch((e) => { console.error('ERR', e.data?.error || e.message); process.exit(1); });
