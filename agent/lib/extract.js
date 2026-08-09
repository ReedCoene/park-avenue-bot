// Invoice extraction via Claude vision. Give it an image or PDF buffer -> structured line items.
const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

const SCHEMA_PROMPT = `You are an accounts-payable clerk. Read this invoice and return ONLY valid JSON, no prose:
{
 "vendor": "string (the supplier/biller name)",
 "invoice_number": "string or null",
 "date": "YYYY-MM-DD or null",
 "lines": [ { "description": "string", "qty": number|null, "unit_price": number|null, "amount": number } ],
 "subtotal": number|null,
 "tax": number|null,
 "total": number|null,
 "confidence": "high|medium|low (low if the image is blurry or fields are ambiguous)"
}
Extract every line item exactly. Numbers as numbers (no $ or commas). If unreadable, use null.`;

function block(buffer, mimetype) {
  const data = buffer.toString('base64');
  if (mimetype === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  }
  const media = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimetype) ? mimetype : 'image/jpeg';
  return { type: 'image', source: { type: 'base64', media_type: media, data } };
}

async function extractInvoice(buffer, mimetype) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: [block(buffer, mimetype), { type: 'text', text: SCHEMA_PROMPT }] }],
  });
  const text = msg.content.map((c) => c.text || '').join('');
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(json);
}

// General Q&A: answer a question, optionally grounded in data we pass in.
async function answer(question, context = '') {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: 'You are Agent, Park Ave’s ops assistant in Slack. You have a LIVE connection to the company’s Fishbowl inventory and QuickBooks — you pull the real data yourself. NEVER tell the user to share data, pull a report, or check with someone else; that is your job. DEFAULT TO INVENTORY: assume every question is about Fishbowl stock unless it is explicitly about money (invoices owed, receivables, payments, revenue, the books). Use the DATA provided in the prompt to answer. If a specific item wasn’t found or the question is too broad, ask ONE short clarifying question naming what you need (e.g. “Which product — vests, jerseys, hats?”) — never imply you lack access. QuickBooks/financial DATA is provided only for authorized owner/manager users; if none is present, treat the question as inventory and never volunteer financials. Be concise and plain-spoken.',
    messages: [{ role: 'user', content: context ? `DATA:\n${context}\n\nQUESTION: ${question}` : question }],
  });
  return msg.content.map((c) => c.text || '').join('').trim();
}

// Pull the core product keyword to search Fishbowl part descriptions.
// "how many size-L hi-vis vests do we have?" -> "vest"
async function inventoryTerm(question) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 20,
    system: 'Extract ONE product keyword from an inventory question — the single most distinctive word to search part descriptions (e.g. "vest", "jersey", "hoodie", "hat"). No sizes, colors, or punctuation. Reply with only that word, or NONE.',
    messages: [{ role: 'user', content: question }],
  });
  const t = msg.content.map((c) => c.text || '').join('').trim().replace(/[^\w-]/g, '');
  return /^none$/i.test(t) ? '' : t;
}

// Document text extraction for non-image files (Word / Excel).
const mammoth = require('mammoth');
const XLSX = require('xlsx');
async function extractDocx(buffer) { const r = await mammoth.extractRawText({ buffer }); return (r.value || '').trim(); }
function extractXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  return wb.SheetNames.map((name) => `# Sheet: ${name}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[name])).join('\n\n').trim();
}

module.exports = { extractInvoice, answer, inventoryTerm, extractDocx, extractXlsx };
