const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = 3001;
const FB_BASE = `http://${process.env.FB_SERVER}:${process.env.FB_PORT}/api`;

let token = null;
let cache = null;
let cacheTime = null;
const CACHE_TTL = 30 * 60 * 1000; // 30 min

// ── Fishbowl helpers ─────────────────────────────────────────────────────────
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

function getDate(so) {
  return new Date(so.dateIssued || so.dateCreated || so.date || 0);
}

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

async function fetchPages(startPage, endPage, pageSize) {
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
  }
  return all;
}

// ── Build comparison dataset ─────────────────────────────────────────────────
async function buildData() {
  console.log('[data] Connecting to Fishbowl...');
  await fbLogin();

  const meta = await fbGet('/sales-orders', { pageSize: 1 });
  const totalSOs = meta.totalCount || 0;
  const pageSize = 500;
  const totalPages = Math.ceil(totalSOs / pageSize);
  console.log(`[data] Total SOs: ${totalSOs.toLocaleString()}`);

  // Fixed YTD window: Jan 1 – May 27
  const start2025 = new Date('2025-01-01T00:00:00');
  const end2025   = new Date('2025-05-27T23:59:59');
  const start2026 = new Date('2026-01-01T00:00:00');
  const end2026   = new Date('2026-05-27T23:59:59');

  console.log('[data] Binary-searching page boundaries...');
  const p25s = await findStartPage(start2025, totalPages, pageSize);
  const p25e = await findEndPage(end2025,   totalPages, pageSize);
  const p26s = await findStartPage(start2026, totalPages, pageSize);
  const p26e = await findEndPage(end2026,   totalPages, pageSize);
  console.log(`[data] 2025: pages ${p25s}-${p25e}  |  2026: pages ${p26s}-${p26e}`);

  console.log('[data] Fetching 2025 pages...');
  const raw25 = await fetchPages(p25s, p25e, pageSize);
  const sos25 = raw25.filter(so => { const d = getDate(so); return d >= start2025 && d <= end2025; });

  console.log('[data] Fetching 2026 pages...');
  const raw26 = await fetchPages(p26s, p26e, pageSize);
  const sos26 = raw26.filter(so => { const d = getDate(so); return d >= start2026 && d <= end2026; });

  console.log(`[data] 2025 YTD: ${sos25.length.toLocaleString()} orders  |  2026 YTD: ${sos26.length.toLocaleString()} orders`);

  // Build monthly breakdown
  const monthlyMap = {};
  for (let m = 1; m <= 5; m++) {
    const key = String(m).padStart(2, '0');
    monthlyMap[key] = { o25: 0, o26: 0 };
  }
  sos25.forEach(so => {
    const d = getDate(so);
    const key = String(d.getMonth() + 1).padStart(2, '0');
    if (monthlyMap[key]) monthlyMap[key].o25++;
  });
  sos26.forEach(so => {
    const d = getDate(so);
    const key = String(d.getMonth() + 1).padStart(2, '0');
    if (monthlyMap[key]) monthlyMap[key].o26++;
  });

  // Aggregate by customer
  const agg = list => {
    const map = {};
    list.forEach(so => {
      const name = (so.customerName || so.customer?.name || 'Unknown').trim();
      map[name] = (map[name] || 0) + 1;
    });
    return map;
  };
  const c25 = agg(sos25);
  const c26 = agg(sos26);
  const allNames = new Set([...Object.keys(c25), ...Object.keys(c26)]);

  const rows = Array.from(allNames).map(name => {
    const o25 = c25[name] || 0;
    const o26 = c26[name] || 0;
    const chg = o26 - o25;
    const pct = o25 > 0 ? Math.round(chg / o25 * 1000) / 10 : null;
    return { name, o25, o26, chg, pct };
  });

  const existing   = rows.filter(r => r.o25 > 0 && r.o26 > 0).sort((a, b) => b.o25 - a.o25);
  const newCust    = rows.filter(r => r.o25 === 0 && r.o26 > 0).sort((a, b) => b.o26 - a.o26);
  const churned    = rows.filter(r => r.o25 > 0 && r.o26 === 0).sort((a, b) => b.o25 - a.o25);

  const tot25 = sos25.length, tot26 = sos26.length;
  const totChg = tot26 - tot25;

  await axios.post(`${FB_BASE}/logout`, {}, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      total2025: tot25,
      total2026: tot26,
      change: totChg,
      changePct: Math.round(totChg / tot25 * 1000) / 10,
      customers2025: Object.keys(c25).length,
      customers2026: Object.keys(c26).length,
      newIn2026: newCust.length,
      goneQuiet: churned.length,
    },
    monthly: monthlyMap,
    existing,
    newCustomers: newCust,
    churned,
  };
}

// ── Express routes ────────────────────────────────────────────────────────────
app.get('/api/data', async (req, res) => {
  const force = req.query.refresh === '1';
  const now = Date.now();
  if (!force && cache && cacheTime && (now - cacheTime) < CACHE_TTL) {
    return res.json({ ...cache, cached: true });
  }
  try {
    cache = await buildData();
    cacheTime = now;
    res.json({ ...cache, cached: false });
  } catch (err) {
    console.error('[data] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.listen(PORT, () => {
  console.log(`\n  ✅  Dashboard running at: http://localhost:${PORT}`);
  console.log('  First visit will fetch ~29 pages of data (30–60 sec)\n');
});
