# Park Avenue Bot

A Slack bot that performs real accounting operations in QuickBooks Online for a wholesale
distribution business. Send it a message in Slack; it looks up invoices and records customer
payments against the company's live books.

Built for **Park Avenue Wholesale, Inc.**, a workwear distributor operating two warehouses
(Lackawanna, PA and Oklahoma City, OK) and selling into truck-stop and travel-center chains.

---

## What it does

| Command | Effect |
|---|---|
| `status` | Reports whether QuickBooks and Fishbowl are reachable, and which company is connected |
| `invoice 255289` | Looks up one invoice: customer, dates, total, amount paid, balance |
| `open` | Lists unpaid invoices, oldest due first, with a total outstanding |
| `open <customer>` | Same, filtered to one customer |
| `pay 255289` | Records a payment for the full remaining balance |
| `pay 255289 1924.80` | Records a partial payment |
| `demo pay 255289` | Runs the entire flow but skips the write |
| `confirm` / `cancel` | Resolves a pending write |
| `clear` | Posts blank lines to scroll the view (cosmetic) |

It **pays** invoices; it does not create them, does not create bank deposits, and does not
email customers. The deposit step is intentionally left manual — see *Design decisions*.

---

## Architecture

```
Slack (Socket Mode, outbound WebSocket)
   │
   ├─ slack-bot.js ──────── command router, authorization, confirmation state machine
   │      │
   │      ├─ qbo.js ─────── QuickBooks Online REST client, OAuth token refresh
   │      │                    └─ https://quickbooks.api.intuit.com/v3/company/{realmId}
   │      │
   │      └─ fishbowl.js ── Fishbowl Inventory REST client (inventory / sales orders)
   │
   └─ .env ──────────────── credentials, never committed
```

**Socket Mode** was chosen over HTTP webhooks so the bot can run on an ordinary office PC.
Slack normally requires a publicly reachable URL to deliver events; Socket Mode instead has
the bot open an outbound WebSocket, so there is no inbound port, no tunnel, and no hosting.
The trade-off is availability: the bot only answers while that machine is awake.

### Recording a payment

QuickBooks models a customer payment as a `Payment` object linked to an `Invoice`, deposited
into an account. The bot posts to **Undeposited Funds** (a holding account), which mirrors how
the business already works — payments accumulate there, then a human groups them into a bank
deposit that matches an actual line on the bank statement.

```js
qbo.post('payment', {
  CustomerRef: invoice.CustomerRef,
  TotalAmt: amount,
  TxnDate: today(),
  DepositToAccountRef: { value: '46' },   // Undeposited Funds
  Line: [{ Amount: amount, LinkedTxn: [{ TxnId: invoice.Id, TxnType: 'Invoice' }] }],
});
```

### OAuth token lifecycle

Intuit access tokens expire hourly; refresh tokens last ~100 days **and rotate on every use**,
invalidating the previous one. `qbo.js` detects a 401, refreshes, and writes the new tokens
back to `.env` mid-run. Two copies of the same `.env` will fight over a rotating token —
whichever refreshes last wins and the other gets `invalid_grant`.

---

## Design decisions

These were deliberate, and most exist because the bot moves real money.

**1. Allowlist, enforced at startup.**
Only Slack member IDs in `SLACK_ALLOWED_USERS` are obeyed. The process *refuses to boot* with
an empty allowlist rather than defaulting open — a misconfiguration should fail loudly, not
silently expose the company's books to everyone in the workspace.

**2. Two-phase commit on every write.**
A `pay` command does not write. It looks up the invoice, validates the amount, warns on
overpayment or partial payment, and stages a confirmation that expires after five minutes and
is single-use. Only an explicit `confirm` performs the write. Reads are unrestricted; writes
are deliberate.

**3. Payments stop at Undeposited Funds.**
The bot will not create bank deposits. During manual processing in June 2026 a deposit was
built that overstated the bank by $120, and reconciling it took significant effort. Grouping
payments into a deposit requires comparing against a bank statement — judgment the bot does
not have. Automating the step *before* the error-prone one, and stopping there, is the point.

**4. Dry-run mode, and a test that proves it is inert.**
`DEMO_MODE=1` simulates all writes. Rather than trusting that, `test-demo-flow.js` reads the
invoice balance and the day's payment count before and after a simulated payment and asserts
both are unchanged. A safety feature that is not tested is a claim, not a feature.

**5. No fabricated identifiers.**
In demo mode the success message omits the Payment ID rather than inventing a plausible one.
A fake record number could later be mistaken for a real transaction.

---

## Files

| File | Purpose |
|---|---|
| `slack-bot.js` | The bot: routing, auth, confirmations, demo mode |
| `qbo.js` | QuickBooks client and OAuth refresh |
| `fishbowl.js` | Fishbowl Inventory client |
| `status.js` | Health check for both integrations; prints the fix for failures |
| `slack-check.js` | Verifies Slack tokens and reports missing scopes |
| `test-demo-flow.js` | Proves demo mode writes nothing |
| `slack-app-manifest.yaml` | Slack app configuration |
| `reauth.js` | Full QuickBooks OAuth re-authorization |
| `refresh-now.js` | Refreshes the access token when the refresh token is still valid |
| `bank-deposit.js` | Deposit helpers (manual use) |
| `company-overview.js`, `analyze-inv.js`, `sales-comparison.js` | Reporting scripts |

---

## Setup

Requires Node.js 18+ (developed on v24).

```bash
npm install
cp .env.example .env      # then fill in credentials
node reauth.js            # authorize QuickBooks, pick the company
node status.js            # verify both integrations
node slack-bot.js         # start the bot
```

For Slack: create an app at api.slack.com/apps using **From a manifest** and paste
`slack-app-manifest.yaml`, generate an app-level token with `connections:write`, install to the
workspace, and copy both tokens into `.env`.

Two setup traps worth knowing, since both present identically as "the bot never replies":
- A manifest without a `features.app_home` block creates the app with DMs disabled.
- Creating the app "From scratch" grants the wrong scopes; the bot runs and Slack accepts the
  message, but the app cannot see it. `node slack-check.js` reports exactly what is missing.
  Fixing scopes requires reinstalling the app.

---

## Security notes

`.env` holds live credentials — QuickBooks tokens, the Fishbowl admin password, and Slack
tokens — and is excluded via `.gitignore`, along with generated reports and scratch scripts
containing real customer data. Anyone cloning this repo supplies their own credentials via
`.env.example`.

Chart-of-accounts IDs and local file paths are also read from `.env` rather than hardcoded, so
the published source carries no business-identifying values. `PUBLICATION-NOTES.md` documents
exactly what was withheld from this repository and why.

## Status

The Slack bot and QuickBooks integration are working. The Fishbowl integration is code-complete
but blocked: Fishbowl requires an administrator to approve an integrated application from
inside its desktop client, and that approval is outstanding, so Fishbowl API calls return 401.
`status` reports this accurately rather than failing silently.
