require('dotenv').config();
const qbo = require('./qbo');

const AR_ACCOUNT    = { value: '54', name: 'Accounts Receivable' };
const SALES_ACCOUNT = { value: '52', name: 'Wholesale Exempt Sales' }; // account 311

async function listOpenCreditMemos() {
  const result = await qbo.query(
    "SELECT * FROM CreditMemo WHERE RemainingCredit > '0' ORDERBY TxnDate DESC MAXRESULTS 100"
  );
  return result?.CreditMemo || [];
}

async function reverseCreditMemo(creditMemoId) {
  // 1. Fetch the credit memo
  const result = await qbo.query(`SELECT * FROM CreditMemo WHERE Id = '${creditMemoId}'`);
  const cm = result?.CreditMemo?.[0];
  if (!cm) throw new Error(`Credit memo ID ${creditMemoId} not found`);

  const amount    = cm.RemainingCredit;
  const customer  = cm.CustomerRef;
  const txnDate   = new Date().toISOString().split('T')[0];

  console.log(`\nReversing Credit Memo #${cm.DocNumber}`);
  console.log(`  Customer : ${customer.name}`);
  console.log(`  Amount   : $${amount}`);
  console.log(`  Date     : ${txnDate}`);

  // STEP 1: Journal Entry — DR Accounts Receivable / CR Sales 311
  const je = await qbo.post('journalentry', {
    TxnDate: txnDate,
    PrivateNote: `Reversal of Credit Memo #${cm.DocNumber}`,
    Line: [
      {
        Amount: amount,
        DetailType: 'JournalEntryLineDetail',
        JournalEntryLineDetail: {
          PostingType: 'Debit',
          AccountRef: AR_ACCOUNT,
          Entity: { Type: 'Customer', EntityRef: customer },
        },
      },
      {
        Amount: amount,
        DetailType: 'JournalEntryLineDetail',
        JournalEntryLineDetail: {
          PostingType: 'Credit',
          AccountRef: SALES_ACCOUNT,
          Entity: { Type: 'Customer', EntityRef: customer },
        },
      },
    ],
  });

  const jeId = je.JournalEntry.Id;
  console.log(`\n  ✅ Step 1 — Journal Entry created (ID: ${jeId})`);
  console.log(`     DR Accounts Receivable  $${amount}  [${customer.name}]`);
  console.log(`     CR Wholesale Exempt Sales 311  $${amount}  [${customer.name}]`);

  // STEP 2: Receive Payment — links JE + credit memo, nets to $0
  const payment = await qbo.post('payment', {
    CustomerRef: customer,
    TotalAmt: 0,
    Line: [
      {
        Amount: amount,
        LinkedTxn: [{ TxnId: jeId, TxnType: 'JournalEntry' }],
      },
      {
        Amount: amount,
        LinkedTxn: [{ TxnId: cm.Id, TxnType: 'CreditMemo' }],
      },
    ],
  });

  console.log(`\n  ✅ Step 2 — Payment #${payment.Payment.Id} created — Credit Memo + JE cleared`);
  console.log('\nDone. Both entries are posted in QuickBooks.');
  return { je: je.JournalEntry, payment: payment.Payment };
}

// Standalone runner
if (require.main === module) (async () => {
  const arg = process.argv[2];

  if (!arg) {
    const memos = await listOpenCreditMemos();
    if (memos.length === 0) {
      console.log('No open credit memos found.');
      return;
    }
    console.log(`\nOpen Credit Memos (${memos.length} total):\n`);
    memos.forEach((cm, i) => {
      const pad = String(i + 1).padStart(3);
      console.log(`${pad}. #${cm.DocNumber.padEnd(12)} | ${cm.CustomerRef.name.padEnd(10)} | $${String(cm.RemainingCredit).padStart(8)} | ${cm.TxnDate}`);
    });
    console.log('\nTo reverse one: node reverse-credit-memo.js <DocNumber>');
    return;
  }

  // Find by doc number or QBO ID
  const memos = await listOpenCreditMemos();
  const cm = memos.find(m => m.DocNumber === arg || m.Id === arg);
  if (!cm) {
    console.error(`Could not find open credit memo: ${arg}`);
    process.exit(1);
  }
  await reverseCreditMemo(cm.Id);
})().catch(e => {
  const msg = e.response?.data?.Fault?.Error?.[0]?.Detail || e.response?.data || e.message;
  console.error('\nError:', msg);
  process.exit(1);
});

module.exports = { listOpenCreditMemos, reverseCreditMemo };
