const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const qbo = require('./qbo');

// Chart-of-accounts IDs are specific to one QuickBooks company, so they live in .env
// rather than in source. Find yours with: SELECT * FROM Account
const CHECKING = {
  value: process.env.QBO_CHECKING_ACCOUNT_ID || '',
  name: process.env.QBO_CHECKING_ACCOUNT_NAME || 'Checking',
};
const UNDEPOSITED_FUNDS_ID = process.env.QBO_UNDEPOSITED_FUNDS_ID || '';

async function getUndepositedPayments() {
  const r = await qbo.query("SELECT * FROM Payment ORDERBY TxnDate DESC MAXRESULTS 200");
  const all = r?.Payment || [];
  return all.filter(p => p.DepositToAccountRef?.value === UNDEPOSITED_FUNDS_ID);
}

// Match payments from undeposited list against a target list of { customer, amount, date }
// date is optional — if omitted, matches by customer + amount only
function matchPayments(undeposited, targets) {
  const matched = [];
  const unmatched = [];

  for (const t of targets) {
    const hit = undeposited.find(p =>
      p.CustomerRef.name === t.customer &&
      Math.abs(parseFloat(p.TotalAmt) - t.amount) < 0.02 &&
      (!t.date || p.TxnDate === t.date)
    );
    if (hit) {
      matched.push({ payment: hit, target: t });
    } else {
      unmatched.push(t);
    }
  }
  return { matched, unmatched };
}

async function createDeposit(paymentIds, depositDate) {
  // Fetch each payment to get the amount
  const lines = [];
  for (const id of paymentIds) {
    const r = await qbo.query(`SELECT * FROM Payment WHERE Id = '${id}'`);
    const p = r?.Payment?.[0];
    if (!p) throw new Error(`Payment ID ${id} not found`);
    lines.push({
      Amount: parseFloat(p.TotalAmt),
      LinkedTxn: [{ TxnId: id, TxnType: 'Payment', TxnLineId: '0' }],
    });
  }

  const total = lines.reduce((s, l) => s + l.Amount, 0);

  const deposit = await qbo.post('deposit', {
    TxnDate: depositDate,
    DepositToAccountRef: CHECKING,
    Line: lines,
  });

  return { deposit: deposit.Deposit, total };
}

// Standalone runner
if (require.main === module) (async () => {
  const payments = await getUndepositedPayments();
  console.log(`\nUndeposited payments (${payments.length}):\n`);
  payments.forEach(p =>
    console.log(`  ID:${p.Id}  ${p.CustomerRef.name.padEnd(20)}  $${String(p.TotalAmt).padStart(8)}  ${p.TxnDate}`)
  );
})().catch(e => console.error(e.response?.data || e.message));

module.exports = { getUndepositedPayments, matchPayments, createDeposit };
