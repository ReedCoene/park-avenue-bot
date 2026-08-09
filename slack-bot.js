// Slack bot for Park Avenue Wholesale — QuickBooks + Fishbowl from a Slack message.
//
//   node slack-bot.js
//
// Runs on this machine and connects OUT to Slack (Socket Mode), so no public URL,
// no hosting, and no firewall changes are needed. This PC must be awake and online.
//
// SAFETY MODEL — read before changing:
//   1. Only Slack user IDs listed in SLACK_ALLOWED_USERS can do anything at all.
//   2. Anything that WRITES to QuickBooks requires a second "confirm" message.
//   3. Confirmations expire after 5 minutes and are single-use.
// Money operations are irreversible enough to be worth the extra step.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { App } = require('@slack/bolt');
const qbo = require('./qbo');

// Chart-of-accounts ID, specific to one QuickBooks company — kept in .env, not in source.
const UNDEPOSITED_FUNDS_ID = process.env.QBO_UNDEPOSITED_FUNDS_ID || '';

const ALLOWED = (process.env.SLACK_ALLOWED_USERS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// DEMO_MODE=1 in .env forces EVERY write to be simulated, even a plain `pay`.
// Set it while recording a demo so a real payment cannot be posted by accident.
// Set DEMO_MODE=0 (or remove the line) and restart to go back to live.
const GLOBAL_DEMO = /^(1|true|yes|on)$/i.test((process.env.DEMO_MODE || '').trim());

// DEMO_QUIET=1 drops the "DEMO MODE" label from payment replies so a recorded demo reads
// naturally. The mode is still reported by `status` and the startup banner — those are the
// safety net, so do not remove them. Nothing is ever written while DEMO_MODE=1, and no
// fake Payment ID is invented; that line is simply omitted.
const DEMO_QUIET = /^(1|true|yes|on)$/i.test((process.env.DEMO_QUIET || '').trim());

// Slack wiring lives at the bottom, behind a `require.main` guard, so this file can be
// imported by tests without opening a connection.

// ── Pending confirmations ────────────────────────────────────────────────────
// userId -> { describe, run, expires }
const pending = new Map();
const CONFIRM_TTL = 5 * 60 * 1000;

function stageConfirmation(userId, describe, run) {
  pending.set(userId, { describe, run, expires: Date.now() + CONFIRM_TTL });
}

function takeConfirmation(userId) {
  const p = pending.get(userId);
  if (!p) return null;
  pending.delete(userId);
  if (Date.now() > p.expires) return 'expired';
  return p;
}

const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── QuickBooks helpers ───────────────────────────────────────────────────────
async function findInvoice(docNumber) {
  const safe = String(docNumber).replace(/'/g, "''");
  const r = await qbo.query(`SELECT * FROM Invoice WHERE DocNumber = '${safe}'`);
  return r?.Invoice?.[0] || null;
}

async function recordPayment(invoice, amount, txnDate) {
  return qbo.post('payment', {
    CustomerRef: invoice.CustomerRef,
    TotalAmt: amount,
    TxnDate: txnDate,
    DepositToAccountRef: { value: UNDEPOSITED_FUNDS_ID },
    Line: [{ Amount: amount, LinkedTxn: [{ TxnId: invoice.Id, TxnType: 'Invoice' }] }],
  });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── Command handlers ─────────────────────────────────────────────────────────
const HELP = [
  '*What I can do*',
  '',
  '`status` — check the QuickBooks and Fishbowl connections',
  '`invoice 255289` — look up one invoice by its number',
  '`open` — list unpaid invoices (oldest due first)',
  '`open <customer>` — unpaid invoices for one customer',
  '`pay 255289` — record full payment on an invoice',
  '`pay 255289 1924.80` — record a partial payment',
  '`demo pay 255289` — walk the whole process without changing anything',
  '',
  'Anything that changes QuickBooks asks you to reply `confirm` first.',
  'Payments land in *Undeposited Funds* — the bank deposit is still done by hand.',
].join('\n');

async function cmdStatus() {
  const lines = [];
  if (GLOBAL_DEMO) {
    lines.push('🧪 *DEMO MODE IS ON* — no payment will be written to QuickBooks.', '');
  }
  lines.push('*Connections*', '');
  try {
    const r = await qbo.query('SELECT * FROM CompanyInfo MAXRESULTS 1');
    lines.push(`✅ QuickBooks — ${r.CompanyInfo[0].CompanyName}`);
  } catch (e) {
    lines.push(`❌ QuickBooks — ${e.response?.data?.fault?.error?.[0]?.message || e.message}`);
    lines.push('   Fix: run `node reauth.js` on the PC.');
  }
  try {
    const fb = require('./fishbowl');
    await fb.login();
    lines.push('✅ Fishbowl — connected');
    await fb.logout();
  } catch (e) {
    const msg = e.response?.data?.message || e.message;
    lines.push(`❌ Fishbowl — ${msg}`);
    if (/approv/i.test(msg)) {
      lines.push('   Fix: a Fishbowl admin must approve the "Claude Reports" app.');
    }
  }
  return lines.join('\n');
}

async function cmdInvoice(docNumber) {
  const inv = await findInvoice(docNumber);
  if (!inv) return `No invoice found with number *${docNumber}*.`;
  const paid = Number(inv.TotalAmt) - Number(inv.Balance);
  return [
    `*Invoice ${inv.DocNumber}* — ${inv.CustomerRef.name}`,
    `Date: ${inv.TxnDate}${inv.DueDate ? `   Due: ${inv.DueDate}` : ''}`,
    `Total: ${money(inv.TotalAmt)}`,
    `Paid: ${money(paid)}`,
    `*Balance: ${money(inv.Balance)}*`,
    Number(inv.Balance) === 0 ? '\n✅ Fully paid.' : '',
  ].filter(Boolean).join('\n');
}

async function cmdOpen(filter) {
  const r = await qbo.getOpenInvoices();
  let list = r?.Invoice || [];
  if (filter) {
    const f = filter.toLowerCase();
    list = list.filter(i => (i.CustomerRef?.name || '').toLowerCase().includes(f));
  }
  if (!list.length) return filter ? `No unpaid invoices matching *${filter}*.` : 'No unpaid invoices. :tada:';

  const shown = list.slice(0, 20);
  const total = list.reduce((s, i) => s + Number(i.Balance), 0);
  const rows = shown.map(i =>
    `\`${String(i.DocNumber || '?').padEnd(8)}\` ${money(i.Balance).padStart(11)}  ${i.DueDate || ''}  ${i.CustomerRef.name}`
  );
  const head = `*${list.length} unpaid invoice${list.length === 1 ? '' : 's'}* — ${money(total)} outstanding`;
  const foot = list.length > shown.length ? `\n_…and ${list.length - shown.length} more._` : '';
  return `${head}\n\n${rows.join('\n')}${foot}`;
}

async function cmdPay(userId, docNumber, rawAmount, dryRun = false) {
  const inv = await findInvoice(docNumber);
  if (!inv) return `No invoice found with number *${docNumber}*.`;

  const balance = Number(inv.Balance);
  if (balance === 0) return `Invoice *${inv.DocNumber}* is already fully paid. Nothing to do.`;

  const amount = rawAmount != null ? Number(rawAmount) : balance;
  if (!Number.isFinite(amount) || amount <= 0) return `"${rawAmount}" is not a valid amount.`;

  const warn = amount > balance
    ? `\n:warning: That is *more* than the ${money(balance)} balance — it would overpay by ${money(amount - balance)}.`
    : amount < balance
      ? `\n:information_source: Partial payment. ${money(balance - amount)} would remain owing.`
      : '';

  stageConfirmation(userId,
    `payment of ${money(amount)} on invoice ${inv.DocNumber}`,
    async () => {
      if (dryRun) {
        // Everything above this point was real: the invoice was looked up live in
        // QuickBooks and validated. Only the write is skipped.
        if (DEMO_QUIET) {
          return [
            `✅ Recorded ${money(amount)} against invoice *${inv.DocNumber}* (${inv.CustomerRef.name}).`,
            'It is sitting in *Undeposited Funds* — add it to a bank deposit when you reconcile.',
          ].join('\n');
        }
        return [
          '🧪 *DEMO MODE — nothing was written to QuickBooks.*',
          '',
          `Would have recorded ${money(amount)} against invoice *${inv.DocNumber}* (${inv.CustomerRef.name}).`,
          'Payment ID: (none — simulated)',
          'In a real run it would sit in *Undeposited Funds* awaiting a bank deposit.',
        ].join('\n');
      }
      const res = await recordPayment(inv, amount, today());
      const id = res?.Payment?.Id;
      return [
        `✅ Recorded ${money(amount)} against invoice *${inv.DocNumber}* (${inv.CustomerRef.name}).`,
        `Payment ID: ${id}`,
        'It is sitting in *Undeposited Funds* — add it to a bank deposit when you reconcile.',
      ].join('\n');
    });

  return [
    dryRun && !DEMO_QUIET ? '🧪 *DEMO MODE* — this will not change QuickBooks.\n' : '',
    '*Please confirm:*',
    '',
    `Record a payment of *${money(amount)}*`,
    `on invoice *${inv.DocNumber}* — ${inv.CustomerRef.name}`,
    `Current balance: ${money(balance)}`,
    warn,
    '',
    'Reply `confirm` to do it, or `cancel` to drop it. Expires in 5 minutes.',
  ].filter(Boolean).join('\n');
}

// ── Router ───────────────────────────────────────────────────────────────────
async function handle(userId, rawText) {
  let t = rawText.trim();

  // "demo ..." runs the full pipeline against real QuickBooks data but skips the write.
  // Safe for demonstrations; the reply is clearly labelled as simulated.
  // GLOBAL_DEMO forces simulation for everything; the `demo` prefix does it per-command.
  let dryRun = GLOBAL_DEMO;
  const demo = t.match(/^demo\s+(.*)$/i);
  if (demo) { dryRun = true; t = demo[1].trim(); }

  const lower = t.toLowerCase();

  if (lower === 'confirm' || lower === 'yes') {
    const p = takeConfirmation(userId);
    if (!p) return 'Nothing is waiting for confirmation.';
    if (p === 'expired') return 'That confirmation expired. Send the command again.';
    return p.run();
  }

  if (lower === 'cancel' || lower === 'no') {
    const had = pending.delete(userId);
    return had ? 'Cancelled. Nothing was changed.' : 'Nothing to cancel.';
  }

  if (lower === 'help' || lower === '?' || !t) return HELP;
  if (lower === 'status') return cmdStatus();

  // Cosmetic spacer: pushes earlier messages off screen so a demo starts on a clean view.
  // U+2800 (Braille blank) is used because Slack strips messages that are only whitespace.
  const spacer = lower.match(/^(?:clear|blank|spacer)(?:\s+(\d+))?$/);
  if (spacer) {
    const n = Math.min(Math.max(parseInt(spacer[1] || '45', 10), 1), 150);
    return Array(n).fill('⠀').join('\n');
  }

  let m;
  if ((m = lower.match(/^(?:invoice|inv|find|look\s*up)\s+#?(\S+)/))) return cmdInvoice(m[1]);
  if ((m = lower.match(/^(?:open|unpaid|outstanding)(?:\s+invoices)?\s*(.*)$/))) return cmdOpen(m[1].trim());
  if ((m = t.match(/^(?:pay|payment|paid)\s+#?(\S+)(?:\s+\$?([\d,]+(?:\.\d+)?))?/i))) {
    return cmdPay(userId, m[1], m[2] ? m[2].replace(/,/g, '') : null, dryRun);
  }

  return `I did not understand that.\n\n${HELP}`;
}

// ── Slack wiring ─────────────────────────────────────────────────────────────
async function respond({ userId, text, say }) {
  if (!ALLOWED.includes(userId)) {
    console.log(`[deny] user ${userId}: ${text}`);
    await say(`Sorry — you are not authorized to use this bot. (Your Slack ID is \`${userId}\`.)`);
    return;
  }
  console.log(`[cmd] ${userId}: ${text}`);
  try {
    await say(await handle(userId, text));
  } catch (e) {
    const detail = e.response?.data?.Fault?.Error?.[0]?.Detail
      || e.response?.data?.fault?.error?.[0]?.detail
      || e.message;
    console.error('[error]', detail);
    await say(`❌ Something went wrong:\n\`\`\`${detail}\`\`\``);
  }
}

// Exported so tests can drive the command router without a Slack connection.
module.exports = { _handle: handle };

if (require.main === module) {
  // Validate BEFORE constructing App — Bolt throws a stack trace on missing tokens,
  // and a plain-English message is more use than that.
  for (const k of ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN']) {
    if (!process.env[k]) {
      console.error(`\n  Missing ${k} in .env`);
      console.error('  The Slack app is not set up yet — see the setup steps.\n');
      process.exit(1);
    }
  }
  if (!ALLOWED.length) {
    console.error('\n  SLACK_ALLOWED_USERS is empty in .env.');
    console.error('  Refusing to start — that would let anyone in Slack move money.\n');
    process.exit(1);
  }

  const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
  });

  // Logs every event Slack delivers. If a DM produces no line here, the problem is on the
  // Slack side (event subscriptions / install), not in this file.
  app.use(async ({ body, next }) => {
    const e = body?.event;
    console.log(`[event] type=${e?.type || body?.type || '?'} channel_type=${e?.channel_type || '-'} user=${e?.user || '-'} text=${JSON.stringify(e?.text || '')}`);
    await next();
  });

  app.event('app_mention', async ({ event, say }) => {
    const text = String(event.text || '').replace(/<@[^>]+>/g, '').trim();
    await respond({ userId: event.user, text, say });
  });

  app.message(async ({ message, say }) => {
    if (message.subtype || message.channel_type !== 'im') return; // DMs only
    await respond({ userId: message.user, text: String(message.text || ''), say });
  });

  (async () => {
    await app.start();
    console.log('\n  Slack bot running. DM it, or @mention it in a channel.');
    console.log(`  Authorized users: ${ALLOWED.join(', ')}`);
    if (GLOBAL_DEMO) {
      console.log('\n  *** DEMO MODE ON — payments are simulated, nothing is written. ***');
      console.log('  *** Set DEMO_MODE=0 in .env and restart to go live.          ***');
    } else {
      console.log('\n  LIVE MODE — `pay` writes real payments to QuickBooks.');
    }
    console.log('\n  Leave this window open. Ctrl+C to stop.\n');
  })();
}
