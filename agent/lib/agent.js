// The agent brain: Claude with TOOLS to read and write Fishbowl + QuickBooks.
// Reads run live. WRITES are drafted (never auto-posted) and returned for a human
// Approve click — app.js renders the card and calls the draft's exec() on approval.
// QuickBooks tools are finance-gated (owner/manager only) at tool-offer time.
const Anthropic = require('@anthropic-ai/sdk');
const fb = require('./fishbowl');
const qbo = require('./qbo');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });

let seq = 0;
const nextId = () => `w${Date.now()}_${++seq}`;

// Each tool: { schema, finance?, write?, run?(input), draft?(input) }
// A write tool's draft() returns { id, title, summary, lines[], exec() }.
const TOOLS = {
  check_inventory: {
    schema: { name: 'check_inventory', description: 'Search LIVE Fishbowl inventory for a product and return matching parts with on-hand quantities. Omit "product" to get an overall snapshot (total items, total units, how many are low or out of stock).', input_schema: { type: 'object', properties: { product: { type: 'string', description: 'product keyword, e.g. "vest", "packers jersey". Optional.' } } } },
    run: async ({ product }) => {
      if (!product || !product.trim()) {
        const s = await fb.inventorySummary();
        return { items_stocked: s.skuCount, total_units: s.totalUnits, running_low: s.lowCount, out_of_stock: s.outCount, lowest: s.low.slice(0, 12) };
      }
      const items = await fb.searchInventory(product);
      return { query: product, matches: items.length, total_on_hand: items.reduce((a, i) => a + i.qty, 0), items: items.slice(0, 60) };
    },
  },
  low_stock: {
    schema: { name: 'low_stock', description: 'List Fishbowl items at or below the low-stock threshold (i.e. that need reordering).', input_schema: { type: 'object', properties: {} } },
    run: async () => { const low = await fb.lowStock(); return { count: low.length, items: low.slice(0, 40) }; },
  },
  find_fishbowl_vendor: {
    schema: { name: 'find_fishbowl_vendor', description: 'Find a vendor in Fishbowl by name. Use before drafting a purchase order so the vendor is exact.', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    run: async ({ name }) => { const d = await fb.findVendor(name); return (d.results || []).slice(0, 8).map((v) => ({ id: v.id, name: v.name })); },
  },
  list_sales_orders: {
    schema: { name: 'list_sales_orders', description: 'List recent Fishbowl SALES ORDERS (read-only): order number, customer, status, dates. Use for "what sold today", "recent orders", order status. This is fulfillment data, not dollar figures.', input_schema: { type: 'object', properties: { limit: { type: 'number', description: 'how many recent orders (default 25, max 100)' } } } },
    run: async ({ limit }) => {
      const n = Math.min(Number(limit) || 25, 100);
      const head = await fb.get('/api/sales-orders?pageSize=1');
      const total = head.totalCount || 0;
      const page = Math.max(1, Math.ceil(total / n));
      const d = await fb.get(`/api/sales-orders?pageSize=${n}&pageNumber=${page}`);
      const rows = (d.results || []).map((s) => ({ number: s.number, customer: s.customerName, status: s.status, issued: s.dateIssued, scheduled: s.dateScheduled }));
      return { total_orders: total, showing_most_recent: rows.length, orders: rows };
    },
  },
  quickbooks_open_invoices: {
    finance: true,
    schema: { name: 'quickbooks_open_invoices', description: 'OWNER/MANAGER ONLY. List open (unpaid) customer invoices from QuickBooks — customer, balance, due date.', input_schema: { type: 'object', properties: {} } },
    run: async () => { const r = await qbo.getOpenInvoices(); return (r.Invoice || []).map((i) => ({ customer: i.CustomerRef?.name, balance: i.Balance, due: i.DueDate, doc: i.DocNumber })); },
  },
  find_quickbooks_vendor: {
    finance: true,
    schema: { name: 'find_quickbooks_vendor', description: 'OWNER/MANAGER ONLY. Find a vendor in QuickBooks by name. Use before drafting a bill.', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    run: async ({ name }) => { const r = await qbo.findVendor(name); return (r.Vendor || []).map((v) => ({ id: v.Id, name: v.DisplayName })); },
  },

  // ---- WRITES: drafted, posted only on Approve -----------------------------
  create_purchase_order: {
    write: true,
    schema: { name: 'create_purchase_order', description: 'Draft a Fishbowl PURCHASE ORDER to a vendor. First confirm the vendor (find_fishbowl_vendor) and parts (check_inventory) so names/numbers are exact. The user must Approve before it posts.', input_schema: { type: 'object', properties: { vendor_name: { type: 'string' }, items: { type: 'array', items: { type: 'object', properties: { part_number: { type: 'string' }, quantity: { type: 'number' }, unit_cost: { type: 'number' } }, required: ['part_number', 'quantity', 'unit_cost'] } } }, required: ['vendor_name', 'items'] } },
    draft: async ({ vendor_name, items }) => {
      const vd = await fb.findVendor(vendor_name);
      const vendor = (vd.results || [])[0];
      if (!vendor) throw new Error(`No Fishbowl vendor matches "${vendor_name}".`);
      const all = await fb.allInventory(); // reliable lookup by part number OR description
      const resolved = [];
      for (const it of items || []) {
        const key = String(it.part_number).toLowerCase();
        const part = all.find((p) => String(p.number).toLowerCase() === key)
          || all.find((p) => String(p.number).toLowerCase().includes(key) || String(p.part).toLowerCase().includes(key));
        if (!part) throw new Error(`No Fishbowl part matches "${it.part_number}".`);
        resolved.push({ part: { id: part.id, number: part.number }, quantity: Number(it.quantity), unitCost: Number(it.unit_cost), desc: part.part });
      }
      const total = resolved.reduce((s, r) => s + r.quantity * r.unitCost, 0);
      const lines = resolved.map((r) => `• ${r.desc} (${r.part.number}) — ${r.quantity} × ${money(r.unitCost)} = *${money(r.quantity * r.unitCost)}*`);
      return {
        id: nextId(), title: `📦 Draft Purchase Order → ${vendor.name}`, summary: `${resolved.length} line(s) · total ${money(total)}`, lines,
        exec: async () => {
          const po = await fb.createPurchaseOrder({ vendor: { id: vendor.id, name: vendor.name }, items: resolved.map((r) => ({ part: r.part, quantity: r.quantity, unitCost: r.unitCost })), status: 'Bid Request' });
          return `Purchase order *#${po.number || po.id}* created in Fishbowl for ${vendor.name} (${money(total)}).`;
        },
      };
    },
  },
  create_bill: {
    write: true, finance: true,
    schema: { name: 'create_bill', description: 'OWNER/MANAGER ONLY. Draft a vendor BILL in QuickBooks (e.g. from an invoice). First confirm the vendor (find_quickbooks_vendor). The user must Approve before it posts.', input_schema: { type: 'object', properties: { vendor_name: { type: 'string' }, lines: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' }, amount: { type: 'number' } }, required: ['amount'] } }, doc_number: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['vendor_name', 'lines'] } },
    draft: async ({ vendor_name, lines, doc_number, date }) => {
      const r = await qbo.findVendor(vendor_name);
      const vendor = (r.Vendor || [])[0];
      if (!vendor) throw new Error(`No QuickBooks vendor matches "${vendor_name}".`);
      const total = (lines || []).reduce((s, l) => s + Number(l.amount || 0), 0);
      const disp = (lines || []).map((l) => `• ${l.description || 'item'} = *${money(l.amount)}*`);
      return {
        id: nextId(), title: `🧾 Draft QuickBooks Bill → ${vendor.DisplayName}`, summary: `${(lines || []).length} line(s) · total ${money(total)}${doc_number ? ` · inv ${doc_number}` : ''}`, lines: disp,
        exec: async () => {
          const bill = await qbo.createBillDraft({ vendorId: vendor.Id, lines: (lines || []).map((l) => ({ description: l.description, amount: l.amount })), txnDate: date, docNumber: doc_number });
          return `Bill *#${bill.Bill?.Id}* entered in QuickBooks for ${vendor.DisplayName} (${money(total)}).`;
        },
      };
    },
  },
};

const SYSTEM = `You are Agent, Park Ave's AI operations coworker in Slack. You have LIVE two-way access to the company's Fishbowl (inventory + purchase orders) and QuickBooks (the books) and you read and write them yourself with your tools. NEVER tell anyone to pull a report, share data, or check with someone else — that is your job.

BIAS HARD TOWARD ACTING, NOT ASKING. Make a sensible interpretation and pull the data — only ask a clarifying question if you truly cannot proceed at all. When someone names a product, SEARCH for it immediately and show what you find (all colors/sizes/variants) — never ask them to narrow before you've even looked. The user's messages are an ONGOING conversation: a short reply like "fishbowl", "shorts", "stock", or "part number" is a continuation of the question above — read the history and act on it. It is NEVER a new topic, and it is NEVER "cut off" — do not ever tell the user their message got cut off. When a search finds nothing, automatically try a broader term yourself (e.g. drop words, try just the part number) before telling them you found nothing.

Use your tools to fulfill requests. Default to inventory/Fishbowl unless the request is clearly about money (the books, bills, receivables). For anything that CHANGES data (a purchase order, a bill), call the matching tool to DRAFT it — the user will get an Approve button. After drafting, tell them plainly what you drafted and that they need to approve it. NEVER say something is done before it's approved.

What you can create: purchase orders (Fishbowl) and vendor bills (QuickBooks, owner/manager only). What you CANNOT do yet: create sales orders or receive stock — Fishbowl's API doesn't allow those. If asked for one of those, say plainly that it's not available yet and offer what you can do instead. Don't fake it or misuse another tool.

QuickBooks tools are restricted to the owner and manager. If you don't have a QuickBooks tool available, the user isn't authorized — tell them money/QuickBooks is limited to the owner and manager, and offer inventory help instead.

Be concise, friendly, and plain-spoken. Format for Slack: use short bullet lists and *bold* — do NOT use Markdown tables or "#" headers, they don't render in Slack.`;

// Returns { reply, pendingWrites: [draft...] }. pendingWrites carry exec() for app.js.
async function run({ text, history = [], isFinance }) {
  const offered = Object.values(TOOLS).filter((t) => !t.finance || isFinance);
  const tools = offered.map((t) => t.schema);
  const byName = Object.fromEntries(Object.values(TOOLS).map((t) => [t.schema.name, t]));
  const messages = [...history, { role: 'user', content: text }];
  const pendingWrites = [];
  let reply = '';

  for (let step = 0; step < 14; step++) {
    const resp = await client.messages.create({ model: MODEL, max_tokens: 2048, system: SYSTEM, tools, messages });
    messages.push({ role: 'assistant', content: resp.content });
    const toolUses = resp.content.filter((b) => b.type === 'tool_use');
    if (resp.stop_reason !== 'tool_use' || !toolUses.length) {
      reply = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      break;
    }
    const results = [];
    for (const tu of toolUses) {
      const tool = byName[tu.name];
      if (!tool || (tool.finance && !isFinance)) {
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Not authorized or unknown tool.', is_error: true });
        continue;
      }
      try {
        if (tool.write) {
          const draft = await tool.draft(tu.input || {});
          pendingWrites.push(draft);
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: `DRAFTED (${draft.title} — ${draft.summary}). It is now showing to the user with an Approve button. Tell them what you drafted and that they must approve it. Do NOT call this tool again for the same request.` });
        } else {
          const out = await tool.run(tu.input || {});
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 8000) });
        }
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Error: ' + e.message, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  if (!reply) reply = 'That one got complicated — can you break it into a smaller step?';
  const newHistory = [...history, { role: 'user', content: text }, { role: 'assistant', content: reply }].slice(-12);
  return { reply, pendingWrites, history: newHistory };
}

module.exports = { run };
