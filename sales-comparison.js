require('dotenv').config();
const axios = require('axios');

const FB_BASE = `http://${process.env.FB_SERVER}:${process.env.FB_PORT}/api`;
let token = null;

async function fbLogin() {
  const res = await axios.post(`${FB_BASE}/login`, {
    username: process.env.FB_USERNAME,
    password: process.env.FB_PASSWORD,
    appName: 'Claude Reports',
    appDescription: 'Claude AI integration',
    appId: 5150,
  });
  token = res.data.token;
}

function fbGet(path, params = {}) {
  return axios.get(`${FB_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  }).then(r => r.data);
}

function fmtN(n) { return n.toLocaleString('en-US'); }
function getDate(so) { return new Date(so.dateIssued || so.dateCreated || so.date || 0); }

// ── Binary search helpers ────────────────────────────────────────────────────
// Find the FIRST page whose last record has date >= targetDate
async function findStartPage(targetDate, totalPages, pageSize) {
  let lo = 1, hi = totalPages;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const data = await fbGet('/sales-orders', { pageSize, pageNumber: mid });
    const results = data.results || [];
    const lastDate = results.length ? getDate(results[results.length - 1]) : new Date(0);
    if (lastDate < targetDate) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Find the LAST page whose first record has date <= targetDate
async function findEndPage(targetDate, totalPages, pageSize) {
  let lo = 1, hi = totalPages, result = 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const data = await fbGet('/sales-orders', { pageSize, pageNumber: mid });
    const results = data.results || [];
    const firstDate = results.length ? getDate(results[0]) : new Date(0);
    if (firstDate <= targetDate) { result = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return result;
}

// ── Fetch a range of pages in parallel batches ───────────────────────────────
async function fetchPages(label, startPage, endPage, pageSize) {
  const BATCH = 20;
  const all = [];
  for (let i = startPage; i <= endPage; i += BATCH) {
    const end = Math.min(i + BATCH - 1, endPage);
    const pages = await Promise.all(
      Array.from({ length: end - i + 1 }, (_, k) =>
        fbGet('/sales-orders', { pageSize, pageNumber: i + k })
      )
    );
    pages.forEach(p => all.push(...(p.results || [])));
    process.stdout.write(`  ${label}: fetched through page ${end}/${endPage}...\r`);
  }
  process.stdout.write('\n');
  return all;
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('Connecting to Fishbowl...');
  await fbLogin();

  const meta = await fbGet('/sales-orders', { pageSize: 1 });
  const totalSOs = meta.totalCount || 0;
  const pageSize = 500;
  const totalPages = Math.ceil(totalSOs / pageSize);
  console.log(`Total SOs ever: ${fmtN(totalSOs)} across ${totalPages} pages\n`);

  // YTD window: Jan 1 – May 27 (same slice, both years)
  const start2025 = new Date('2025-01-01T00:00:00');
  const end2025   = new Date('2025-05-27T23:59:59');
  const start2026 = new Date('2026-01-01T00:00:00');
  const end2026   = new Date('2026-05-27T23:59:59');

  console.log('Locating page boundaries via binary search...');
  const p25s = await findStartPage(start2025, totalPages, pageSize);
  const p25e = await findEndPage(end2025,   totalPages, pageSize);
  const p26s = await findStartPage(start2026, totalPages, pageSize);
  const p26e = await findEndPage(end2026,   totalPages, pageSize);

  console.log(`  2025 YTD: pages ${p25s}–${p25e}  (~${fmtN((p25e - p25s + 1) * pageSize)} records to scan)`);
  console.log(`  2026 YTD: pages ${p26s}–${p26e}  (~${fmtN((p26e - p26s + 1) * pageSize)} records to scan)\n`);

  console.log('Fetching 2025 data...');
  const raw2025 = await fetchPages('2025', p25s, p25e, pageSize);
  const sos2025 = raw2025.filter(so => { const d = getDate(so); return d >= start2025 && d <= end2025; });

  console.log('Fetching 2026 data...');
  const raw2026 = await fetchPages('2026', p26s, p26e, pageSize);
  const sos2026 = raw2026.filter(so => { const d = getDate(so); return d >= start2026 && d <= end2026; });

  console.log(`\n  Confirmed: ${fmtN(sos2025.length)} orders (2025 YTD)  |  ${fmtN(sos2026.length)} orders (2026 YTD)`);

  // ── Aggregate by customer ──────────────────────────────────────────────────
  const agg = (list) => {
    const map = {};
    list.forEach(so => {
      const name = (so.customerName || so.customer?.name || 'Unknown').trim();
      map[name] = (map[name] || 0) + 1;
    });
    return map;
  };

  const c25 = agg(sos2025);
  const c26 = agg(sos2026);
  const allNames = new Set([...Object.keys(c25), ...Object.keys(c26)]);

  const rows = Array.from(allNames).map(name => {
    const o25 = c25[name] || 0;
    const o26 = c26[name] || 0;
    const chg = o26 - o25;
    const pct = o25 > 0 ? (chg / o25 * 100) : null;
    return { name, o25, o26, chg, pct };
  });

  // Segments
  const existing = rows.filter(r => r.o25 > 0 && r.o26 > 0).sort((a, b) => b.o25 - a.o25);
  const newCust  = rows.filter(r => r.o25 === 0 && r.o26 > 0).sort((a, b) => b.o26 - a.o26);
  const churned  = rows.filter(r => r.o25 > 0 && r.o26 === 0).sort((a, b) => b.o25 - a.o25);

  // ── Print report ───────────────────────────────────────────────────────────
  const W = 76;
  const LINE = '═'.repeat(W);
  const DASH = '─'.repeat(W);
  const chgStr = n => (n >= 0 ? `+${n}` : `${n}`);
  const pctStr = p => p !== null ? `${p >= 0 ? '+' : ''}${p.toFixed(0)}%` : 'NEW';

  const tot25 = sos2025.length, tot26 = sos2026.length;
  const totChg = tot26 - tot25;

  console.log('\n' + LINE);
  console.log('  PARK AVENUE WHOLESALE — CUSTOMER SALES COMPARISON');
  console.log('  Jan 1 – May 27  (same YTD window, both years)');
  console.log(LINE);

  console.log(`
  SUMMARY
  ${'2025 YTD orders:'.padEnd(30)} ${fmtN(tot25)}
  ${'2026 YTD orders:'.padEnd(30)} ${fmtN(tot26)}
  ${'Change:'.padEnd(30)} ${chgStr(totChg)}  (${(totChg/tot25*100).toFixed(1)}%)
  ${'Unique customers 2025:'.padEnd(30)} ${fmtN(Object.keys(c25).length)}
  ${'Unique customers 2026:'.padEnd(30)} ${fmtN(Object.keys(c26).length)}
  ${'New accounts in 2026:'.padEnd(30)} ${fmtN(newCust.length)}
  ${'Gone quiet in 2026:'.padEnd(30)} ${fmtN(churned.length)}`);

  // Header row helper
  const HDR = `  ${'Customer'.padEnd(38)} ${'2025'.padStart(7)} ${'2026'.padStart(7)} ${'Chg'.padStart(6)}  ${'%Chg'.padStart(6)}`;

  // ── Existing customers table ─────────────────────────────────────────────
  console.log('\n\n  EXISTING CUSTOMERS — sorted by 2025 order volume');
  console.log('  ' + DASH);
  console.log(HDR);
  console.log('  ' + DASH);
  existing.forEach(r => {
    const bigMove = Math.abs(r.pct) >= 30 && r.o25 >= 5 ? ' ◄' : '';
    console.log(
      `  ${r.name.slice(0, 37).padEnd(38)} ` +
      `${fmtN(r.o25).padStart(7)} ${fmtN(r.o26).padStart(7)} ` +
      `${chgStr(r.chg).padStart(6)}  ${pctStr(r.pct).padStart(6)}${bigMove}`
    );
  });

  // ── New customers ───────────────────────────────────────────────────────
  if (newCust.length > 0) {
    console.log(`\n\n  NEW IN 2026 — ${newCust.length} customers with zero orders Jan–May 2025`);
    console.log('  ' + DASH);
    console.log(`  ${'Customer'.padEnd(38)} ${'2025'.padStart(7)} ${'2026'.padStart(7)}`);
    console.log('  ' + DASH);
    newCust.forEach(r => {
      console.log(`  ${r.name.slice(0, 37).padEnd(38)} ${'—'.padStart(7)} ${fmtN(r.o26).padStart(7)}`);
    });
  }

  // ── Churned customers ───────────────────────────────────────────────────
  if (churned.length > 0) {
    console.log(`\n\n  INACTIVE IN 2026 — ${churned.length} customers who ordered Jan–May 2025 but not 2026`);
    console.log('  ' + DASH);
    console.log(`  ${'Customer'.padEnd(38)} ${'2025'.padStart(7)} ${'2026'.padStart(7)}`);
    console.log('  ' + DASH);
    churned.forEach(r => {
      console.log(`  ${r.name.slice(0, 37).padEnd(38)} ${fmtN(r.o25).padStart(7)} ${'—'.padStart(7)}`);
    });
  }

  // ── Most improved / biggest drops ─────────────────────────────────────
  const improved = existing.filter(r => r.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 10);
  const dropped  = existing.filter(r => r.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, 10);

  if (improved.length > 0) {
    console.log('\n\n  TOP 10 MOST IMPROVED (% growth, existing customers only)');
    console.log('  ' + DASH);
    console.log(HDR);
    console.log('  ' + DASH);
    improved.forEach(r => {
      console.log(
        `  ${r.name.slice(0, 37).padEnd(38)} ` +
        `${fmtN(r.o25).padStart(7)} ${fmtN(r.o26).padStart(7)} ` +
        `${chgStr(r.chg).padStart(6)}  ${pctStr(r.pct).padStart(6)}`
      );
    });
  }

  if (dropped.length > 0) {
    console.log('\n\n  TOP 10 BIGGEST DECLINES (% drop, existing customers only)');
    console.log('  ' + DASH);
    console.log(HDR);
    console.log('  ' + DASH);
    dropped.forEach(r => {
      console.log(
        `  ${r.name.slice(0, 37).padEnd(38)} ` +
        `${fmtN(r.o25).padStart(7)} ${fmtN(r.o26).padStart(7)} ` +
        `${chgStr(r.chg).padStart(6)}  ${pctStr(r.pct).padStart(6)}`
      );
    });
  }

  console.log('\n  ◄ = ≥30% volume change with at least 5 orders in 2025');
  console.log('  Note: Order counts only — revenue requires QuickBooks Online.');
  console.log('\n' + LINE + '\n');

  await axios.post(`${FB_BASE}/logout`, {}, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
})().catch(err => {
  console.error('\nError:', err.response?.data || err.message);
  process.exit(1);
});
