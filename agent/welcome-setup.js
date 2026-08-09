// Revert guides to "Agent" naming, set up the welcome guide, and report channel state.
require('dotenv').config();
const { WebClient } = require('@slack/web-api');
const web = new WebClient(process.env.SLACK_BOT_TOKEN);

const WELCOME = [
  { type: 'header', text: { type: 'plain_text', text: '👋 Welcome to Park Ave — meet Agent' } },
  { type: 'section', text: { type: 'mrkdwn', text:
    `This is the team's home base. *Agent* is your AI coworker — find it in your sidebar under *Direct Messages*, click it, and just talk like you would to a person.` } },
  { type: 'divider' },
  { type: 'section', text: { type: 'mrkdwn', text:
    `*What the agent can do:*\n` +
    `• Answer questions about whatever you're working on in *Fishbowl* or *QuickBooks* — just ask.\n` +
    `• *Send Agent the documents of what you're working on within Fishbowl/QuickBooks* — snap a photo or drop a PDF, and the agent reads it and handles the entry for you.\n` +
    `• Look things up so you don't have to dig through the system.` } },
  { type: 'section', text: { type: 'mrkdwn', text:
    `*How to send a document:*\n` +
    `• *Computer:* drag the photo or PDF into your Agent DM and hit Enter.\n` +
    `• *Phone:* in the Agent DM tap the *➕ / camera* → take a photo → send.` } },
  { type: 'divider' },
  { type: 'context', elements: [{ type: 'mrkdwn', text: `Daily inventory updates post in *#morning-brief*.  Stuck or something looks off? Message <@U0BD7PUPB7X>.` }] },
];
const BRIEF = [
  { type: 'header', text: { type: 'plain_text', text: '☀️ Morning Brief' } },
  { type: 'section', text: { type: 'mrkdwn', text: `Every morning *Agent* posts a snapshot here — inventory health, what's running low, and the day's activity. No need to log in; it comes to you.` } },
  { type: 'context', elements: [{ type: 'mrkdwn', text: `Posted automatically by the agent each morning.` }] },
];
const ISSUE = [
  { type: 'header', text: { type: 'plain_text', text: '🛠️ Report an Issue' } },
  { type: 'section', text: { type: 'mrkdwn', text: `Something not working right? Agent got something wrong, gave a strange answer, or you're stuck? *Post it here* and a person will jump in. A screenshot helps.` } },
  { type: 'context', elements: [{ type: 'mrkdwn', text: `For everything else, just *DM Agent* directly.` }] },
];

async function updateGuide(id, match, blocks, text) {
  const hist = await web.conversations.history({ channel: id, limit: 30 });
  const msg = (hist.messages || []).find((m) => m.blocks?.some((b) => b.type === 'header' && match.test(b.text?.text || '')));
  if (msg) { await web.chat.update({ channel: id, ts: msg.ts, text, blocks }); return 'updated'; }
  const m = await web.chat.postMessage({ channel: id, text, blocks });
  await web.pins.add({ channel: id, timestamp: m.ts }).catch(() => {});
  return 'posted';
}

(async () => {
  let chans = [], cursor;
  do {
    const r = await web.conversations.list({ exclude_archived: true, types: 'public_channel', limit: 200, cursor });
    chans = chans.concat(r.channels || []); cursor = r.response_metadata?.next_cursor;
  } while (cursor);
  const find = (n) => chans.find((c) => c.name === n);
  const all = chans.find((c) => c.is_general) || chans.find((c) => /^all-/.test(c.name));

  // 1) revert the two standing guides to Agent naming
  if (find('morning-brief')) console.log('morning-brief:', await updateGuide(find('morning-brief').id, /morning brief/i, BRIEF, 'Morning Brief'));
  if (find('report-an-issue')) console.log('report-an-issue:', await updateGuide(find('report-an-issue').id, /report an issue/i, ISSUE, 'Report an issue'));

  // 2) the welcome (all-) channel
  if (!all) { console.log('!! could not find the company-wide (all-) channel'); }
  else {
    console.log(`company channel: #${all.name}  (is_member=${all.is_member})`);
    try {
      const m = await web.chat.postMessage({ channel: all.id, text: 'Welcome to Park Ave', blocks: WELCOME });
      await web.pins.add({ channel: all.id, timestamp: m.ts }).catch(() => {});
      console.log(`  ✅ posted + pinned welcome guide in #${all.name}`);
      // safe to retire the old how-to now that its content lives in welcome
      const howto = find('how-to-use-agent');
      if (howto) { await web.conversations.archive({ channel: howto.id }).catch((e) => console.log('  how-to archive:', e.data?.error)); console.log('  archived #how-to-use-agent'); }
    } catch (e) {
      console.log(`  ⚠️ cannot post in #${all.name}: ${e.data?.error || e.message} — invite the bot there first (/invite @Agent)`);
    }
  }

  // 3) report leftover channels the admin must delete in-browser (bot isn't a member)
  const leftover = ['new-channel', 'social'].filter((n) => find(n));
  console.log('leftover to delete in browser:', leftover.length ? leftover.map((n) => '#' + n).join(', ') : 'none');
})().catch((e) => { console.error('ERR', e.data?.error || e.message); process.exit(1); });
