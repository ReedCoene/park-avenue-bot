// Park Ave Ops Bot — Slack (Socket Mode, no public URL needed).
// Drop an invoice (photo/PDF) -> it reads every line -> posts a card -> Approve to enter it.
// Or just chat: "who's overdue?", "open invoices", etc.
require('dotenv').config();
const { App } = require('@slack/bolt');
const axios = require('axios');
const cron = require('node-cron');
const { extractInvoice, extractDocx, extractXlsx } = require('./lib/extract');
const qbo = require('./lib/qbo');
const fb = require('./lib/fishbowl');
const agent = require('./lib/agent');
const { postBrief } = require('./morning-brief');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

const pending = new Map(); // id -> parsed invoice awaiting approval (vision/upload flow)
const writes = new Map();  // id -> drafted write awaiting Approve (agent flow)
const convos = new Map();  // userId -> { history, ts }  (per-DM conversation memory)
const CONVO_TTL_MS = 30 * 60 * 1000;

// Access control: only FINANCE_USERS can touch QuickBooks. Empty = demo (everyone).
const FINANCE = new Set((process.env.FINANCE_USERS || '').split(',').map((s) => s.trim()).filter(Boolean));
const isFinance = (uid) => FINANCE.size === 0 || FINANCE.has(uid);

const money = (n) => (n == null ? '?' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 }));

async function downloadFile(file) {
  const res = await axios.get(file.url_private_download, {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    responseType: 'arraybuffer',
  });
  return Buffer.from(res.data);
}

function invoiceCard(id, inv) {
  const lines = (inv.lines || []).slice(0, 8)
    .map((l) => `• ${l.description} — ${l.qty ?? ''} ${l.qty ? '×' : ''} ${l.unit_price != null ? money(l.unit_price) : ''}  =  *${money(l.amount)}*`)
    .join('\n');
  const more = (inv.lines || []).length > 8 ? `\n_…and ${inv.lines.length - 8} more lines_` : '';
  const conf = inv.confidence === 'low' ? ' :warning: *low confidence — double-check*' : '';
  return [
    { type: 'header', text: { type: 'plain_text', text: `🧾 Invoice read — ${inv.vendor || 'Unknown vendor'}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*Invoice #:* ${inv.invoice_number || '—'}   *Date:* ${inv.date || '—'}${conf}\n\n${lines}${more}\n\n*Total: ${money(inv.total)}*` } },
    { type: 'actions', elements: [
      { type: 'button', style: 'primary', text: { type: 'plain_text', text: '✅ Approve & enter' }, action_id: 'approve_invoice', value: id },
      { type: 'button', text: { type: 'plain_text', text: '✏️ Needs a fix' }, action_id: 'edit_invoice', value: id },
    ] },
  ];
}

async function handleInvoice(file, say) {
  const msg = await say(`📄 Reading *${file.name}*…`);
  try {
    const buf = await downloadFile(file);
    const inv = await extractInvoice(buf, file.mimetype);
    const id = `${file.id}-${Date.now()}`;
    pending.set(id, inv);
    await say({ text: `Read ${inv.vendor || 'invoice'} (${(inv.lines || []).length} lines)`, blocks: invoiceCard(id, inv) });
  } catch (e) {
    await say(`❌ Couldn't read that one: ${e.message}. Try a clearer photo or a PDF.`);
  }
}

function writeCard(d) {
  return [
    { type: 'header', text: { type: 'plain_text', text: d.title } },
    { type: 'section', text: { type: 'mrkdwn', text: `${(d.lines || []).join('\n')}\n\n*${d.summary}*` } },
    { type: 'actions', elements: [
      { type: 'button', style: 'primary', text: { type: 'plain_text', text: '✅ Approve & submit' }, action_id: 'approve_write', value: d.id },
      { type: 'button', text: { type: 'plain_text', text: '✖️ Cancel' }, action_id: 'cancel_write', value: d.id },
    ] },
  ];
}

const TEXTY = /^(csv|tsv|txt|text|md|markdown|json|xml|html?|log|yaml|yml|ini|conf|tex|srt|vtt|rtf|js|ts|py|sql)$/;
async function readFileContent(file) {
  const name = file.name || 'file';
  const ext = (name.split('.').pop() || '').toLowerCase();
  const mt = file.mimetype || '';
  const buf = await downloadFile(file);
  if (ext === 'docx') return extractDocx(buf);
  if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') return extractXlsx(buf);
  if (TEXTY.test(ext) || mt.startsWith('text/') || mt.includes('json') || mt.includes('xml') || mt.includes('csv')) return buf.toString('utf8');
  return null;
}

// Handle ALL attached files together: photos/PDFs -> invoice reader; Word/Excel/CSV/text
// -> read and combine into ONE agent request (so instructions + template are seen together).
async function handleFiles(files, comment, say, userId) {
  const docs = [];
  for (const file of files) {
    const name = file.name || 'file';
    const ext = (name.split('.').pop() || '').toLowerCase();
    const mt = file.mimetype || '';
    if (mt.startsWith('image/') || mt === 'application/pdf' || /^(png|jpe?g|gif|webp|pdf)$/.test(ext)) {
      await handleInvoice(file, say);
      continue;
    }
    let content = null;
    try { content = await readFileContent(file); } catch (e) { console.error('file read error:', e.message); }
    if (content) docs.push(`[File: ${name}]\n${content.slice(0, 12000)}`);
    else await say(`I couldn't read *${name}* — send it as a PDF, Word, Excel, CSV, or text file.`);
  }
  if (docs.length) {
    await say(`📄 Read ${docs.length} file${docs.length > 1 ? 's' : ''} — working on it…`);
    const prompt = (comment && comment.trim() ? comment.trim() : 'Read these files and help me with them.') + '\n\n' + docs.join('\n\n');
    await handleQuestion(prompt, say, userId);
  }
}

async function handleQuestion(text, say, userId) {
  try {
    const prev = convos.get(userId);
    const history = prev && Date.now() - prev.ts < CONVO_TTL_MS ? prev.history : [];
    const { reply, pendingWrites, history: newHistory } = await agent.run({ text, history, isFinance: isFinance(userId) });
    convos.set(userId, { history: newHistory || [], ts: Date.now() });
    if (reply) await say(reply);
    for (const d of (pendingWrites || [])) { writes.set(d.id, d); await say({ text: d.title, blocks: writeCard(d) }); }
    if (!reply && !(pendingWrites || []).length) await say("I'm not sure how to help with that yet — try rephrasing.");
  } catch (e) {
    console.error('agent error:', e.message);
    await say('Sorry — I hit a snag on that. Give it another go in a moment.');
  }
}

// uploads (DM or channel) ---------------------------------------------------
app.message(async ({ message, say }) => {
  if (message.subtype === 'bot_message' || message.bot_id) return;
  if (message.channel_type !== 'im') return; // DM-only: stay silent in channels (e.g. #report-an-issue, #morning-brief)
  if (message.files && message.files.length) {
    await handleFiles(message.files, message.text, say, message.user);
    return;
  }
  if (message.text) await handleQuestion(message.text, say, message.user);
});

// @mentions in channels -----------------------------------------------------
app.event('app_mention', async ({ event, say }) => {
  const text = (event.text || '').replace(/<@[^>]+>/g, '').trim();
  if (event.files && event.files.length) { await handleFiles(event.files, text, say, event.user); return; }
  if (text) await handleQuestion(text, say, event.user);
});

// Approve button ------------------------------------------------------------
app.action('approve_invoice', async ({ ack, body, say, action }) => {
  await ack();
  const inv = pending.get(action.value);
  if (!inv) return say('That invoice expired — re-upload it.');
  if (!isFinance(body.user.id)) return say(`Thanks <@${body.user.id}> — entering it into the books needs owner/manager sign-off. I've flagged this invoice for them. 📌`);
  if (!qbo.ready()) return say(`✅ Approved *${inv.vendor}* for *${money(inv.total)}*. _(Connect QuickBooks to auto-post — placeholder for now.)_`);
  try {
    const v = await qbo.findVendor(inv.vendor || '');
    const vendorId = v.Vendor?.[0]?.Id;
    if (!vendorId) return say(`Approved, but I couldn't match vendor "${inv.vendor}" in QuickBooks. Add them first or tell me which vendor.`);
    const bill = await qbo.createBillDraft({ vendorId, lines: inv.lines, txnDate: inv.date, docNumber: inv.invoice_number });
    await say(`✅ Entered into QuickBooks — Bill #${bill.Bill?.Id} for *${inv.vendor}*, ${money(inv.total)}. That's one off the pile. 🎉`);
  } catch (e) {
    await say(`⚠️ Approved but the QuickBooks write failed: ${e.response?.data?.Fault?.Error?.[0]?.Message || e.message}`);
  }
});

app.action('edit_invoice', async ({ ack, say }) => { await ack(); await say('No problem — tell me what to change (e.g., "vendor is Acme, total is 4212") and I\'ll fix it.'); });

// Generic write approval — agent-drafted POs, bills, etc. Posts only on Approve.
app.action('approve_write', async ({ ack, say, action }) => {
  await ack();
  const d = writes.get(action.value);
  if (!d) return say('That draft expired — just ask me to do it again.');
  try {
    const msg = await d.exec();
    writes.delete(action.value);
    await say('✅ ' + msg);
  } catch (e) {
    await say('⚠️ Approved, but submitting it failed: ' + (e.response?.data?.Fault?.Error?.[0]?.Message || e.message));
  }
});
app.action('cancel_write', async ({ ack, say, action }) => { await ack(); writes.delete(action.value); await say('Cancelled — nothing was submitted.'); });

// 8:00 AM ET daily inventory brief — in-process so it reuses the bot's Fishbowl session.
cron.schedule('0 8 * * *', () => { postBrief().catch((e) => console.error('morning brief failed:', e.message)); }, { timezone: 'America/New_York' });

// Free the Fishbowl session on stop/restart so sessions never pile up.
const shutdown = async () => { try { await fb.logout(); } catch (e) {} process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

(async () => {
  await app.start();
  console.log('⚡ Park Ave Ops Bot is running (Socket Mode). QBO:', qbo.ready(), '| Fishbowl:', fb.ready());
  fb.start(); // open and hold ONE persistent Fishbowl session (live data, no per-question logins)
})();
