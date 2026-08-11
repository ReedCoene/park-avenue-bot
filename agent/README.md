# Slack Ops Agent

**An AI coworker in Slack with live, two-way access to a company's inventory and accounting systems.**

Someone photographs a paper invoice and drops it in Slack. The agent reads every line, posts a card with the extracted vendor, line items, and total, and waits. A human clicks **Approve** and it posts to QuickBooks. Nobody opens a terminal, installs anything, or learns a new system.

It also just answers questions: *"how many size-L hi-vis vests do we have?"*, *"what's running low?"*, *"who's overdue?"*

Built with Claude (tool use) for **Park Avenue Wholesale**, a Buffalo apparel wholesaler running Fishbowl and QuickBooks Online. **Ran in daily production from June 2026.**

---

## How it works

```
Slack message or photo
        ↓
   Claude + 8 tools  ──── reads ────►  Fishbowl (inventory, POs)
   (up to 14 steps)  ──── reads ────►  QuickBooks Online (bills, invoices)
        ↓
   Read  → answers immediately
   Write → drafts a card, waits for a human to click Approve
```

Two properties the rest of the design is built around:

**The model cannot write to the books.** Read tools execute on call. Write tools do not execute at all: they return a draft object carrying a deferred function, and that function is only invoked by the Approve button handler. The agent can compose a $40,000 purchase order and still has no path to post it.

**Financial tools are removed before the model sees them.** The tool list is filtered per user, so an unauthorized request isn't made with QuickBooks tools restricted, it's made with those tools absent entirely. A second authorization check runs at execution. Anyone can ask about inventory; only the owner and operations lead can touch money.

## What it can do

| Tool | Access | What it does |
|---|---|---|
| `check_inventory` | everyone | Live Fishbowl search, or an overall stock snapshot |
| `low_stock` | everyone | Items at or below reorder threshold |
| `find_fishbowl_vendor` | everyone | Exact vendor lookup before drafting a PO |
| `list_sales_orders` | everyone | Recent sales orders, status and dates |
| `quickbooks_open_invoices` | finance only | Unpaid customer invoices, balances, due dates |
| `find_quickbooks_vendor` | finance only | Vendor lookup before drafting a bill |
| `create_purchase_order` | **draft only** | Fishbowl PO, posts on Approve |
| `create_bill` | finance only, **draft only** | QuickBooks vendor bill, posts on Approve |

Plus vision-based invoice extraction from photos and PDFs, and an optional 8am inventory digest.

Fishbowl's API does not permit creating sales orders or receiving stock. The agent is instructed to say so plainly rather than substitute another tool.

## Design notes

**[HOW-WE-BUILT-THIS.md](HOW-WE-BUILT-THIS.md)** covers the process: why the first version was scrapped, the walls we hit, and what each of them taught us. Read that before the code.

---

## Setup (~10 minutes)

### 1. Create the Slack app

1. **api.slack.com/apps → Create New App → From scratch.** Name it, pick the workspace.
2. **Socket Mode** → toggle **ON** → generate an **App-Level Token** with scope `connections:write`. That's `SLACK_APP_TOKEN` (starts `xapp-`).
3. **OAuth & Permissions** → add bot scopes: `app_mentions:read`, `chat:write`, `files:read`, `im:history`, `im:read`, `channels:history`, `groups:history` → **Install to Workspace** → copy the **Bot User OAuth Token**. That's `SLACK_BOT_TOKEN` (starts `xoxb-`).
4. **Event Subscriptions** → **ON** → subscribe to bot events: `app_mention`, `message.im`, `message.channels`, `file_shared`. Save.
5. In Slack: `/invite @YourBot`, or just DM it.

### 2. Configure

```
cp .env.example .env
```

Fill in `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `ANTHROPIC_API_KEY`. QuickBooks and Fishbowl credentials are optional for a first run: without them the agent still reads invoices and drafts cards, it just won't post.

Set `FINANCE_USERS` to the Slack user IDs allowed to touch money. Leave it empty and everyone is allowed (demo mode only).

### 3. Run

```
npm install
npm start
```

Socket Mode means no public URL and no firewall changes. DM the bot or drop an invoice image in its channel.

### 4. Optional extras

```
node setup-workspace.js   # creates channels + pinned plain-English guides
npm run digest            # posts the morning inventory summary
```

`CONNECT-CHECKLIST.md` walks through wiring QuickBooks and Fishbowl step by step.

### 5. Going 24/7

For a demo, `npm start` on any always-on machine works. For real use, deploy to Render or Railway (~$5-7/mo) as a background worker with the `.env` values stored as encrypted settings. It survives reboots and isn't tied to anyone's laptop.

### Credentials

Use a dedicated read/write API user for Fishbowl rather than a person's admin login. Rotate anything that has ever left your machine. Secrets go in `.env`, never in a chat window, never committed.

## Reuse

Nothing here is specific to one company except the example values and the assistant's name in the system prompt. Point `.env` at different Fishbowl and QuickBooks instances and it works as-is.
