require('dotenv').config();
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const { spawnSync, execSync } = require('child_process');

// ── 1. Pull data from the running dashboard server (instant — cached) ─────────
function fetchFromServer() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://localhost:3001/api/data', res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(6000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── 2. Build full HTML report ──────────────────────────────────────────────────
function buildHTML(data) {
  const { summary, monthly, existing, newCustomers, churned } = data;
  const genTime = new Date(data.generatedAt).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
  });

  const fmt     = n  => (n || 0).toLocaleString('en-US');
  const fmtP    = p  => p != null ? `${p >= 0 ? '+' : ''}${Number(p).toFixed(1)}%` : '—';
  const cls     = n  => n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  const chgStr  = n  => n > 0 ? `+${fmt(n)}` : fmt(n);

  const MONTHS = { '01':'January','02':'February','03':'March','04':'April','05':'May' };

  // ── Pre-estimate page numbers (refined by JS below at render time) ────────
  // Letter page: 11in * 96dpi = 1056px; margins 0.55in each = 950px content
  // Row height ≈ 25px (8.5pt font + line-height 1.45 + 7px padding + 1px border)
  // First page of each section: ~82px header + 28px thead leaves ~840px → ~33 rows
  // Subsequent pages: ~28px thead leaves ~922px → ~36 rows
  const rowsFirstPage = 33;
  const rowsPerPage   = 36;
  const pagesFor = count =>
    count <= rowsFirstPage ? 1 : 1 + Math.ceil((count - rowsFirstPage) / rowsPerPage);
  const PAGE_CUST  = 2;
  const PAGE_NEW   = PAGE_CUST  + pagesFor(existing.length);
  const PAGE_CHURN = PAGE_NEW   + pagesFor(newCustomers.length);

  // ── Monthly rows ─────────────────────────────────────────────────────────
  const monthRows = Object.entries(monthly).map(([k, v]) => {
    const chg = v.o26 - v.o25;
    const pct = v.o25 > 0 ? chg / v.o25 * 100 : null;
    return `<tr>
      <td class="L">${MONTHS[k] || k}</td>
      <td>${fmt(v.o25)}</td><td>${fmt(v.o26)}</td>
      <td class="${cls(chg)}">${chgStr(chg)}</td>
      <td class="${cls(pct)}">${fmtP(pct)}</td>
    </tr>`;
  }).join('');

  // ── Existing customer rows ────────────────────────────────────────────────
  const custRows = existing.map(r => `<tr>
    <td class="L">${r.name}</td>
    <td>${fmt(r.o25)}</td><td>${fmt(r.o26)}</td>
    <td class="${cls(r.chg)}">${chgStr(r.chg)}</td>
    <td class="${cls(r.pct)}">${fmtP(r.pct)}</td>
  </tr>`).join('');

  // ── New customer rows ─────────────────────────────────────────────────────
  const newRows = newCustomers.map(r => `<tr>
    <td class="L">${r.name}</td><td class="mu">—</td><td>${fmt(r.o26)}</td><td class="pos">NEW</td>
  </tr>`).join('');

  // ── Churned rows ──────────────────────────────────────────────────────────
  const churnRows = churned.map(r => `<tr>
    <td class="L">${r.name}</td><td>${fmt(r.o25)}</td><td class="mu">—</td><td class="neg">0</td>
  </tr>`).join('');

  const totalChgStr = `${summary.change >= 0 ? '+' : ''}${fmt(summary.change)}`;
  const totalPctStr = fmtP(summary.changePct);
  const chgColor    = summary.change >= 0 ? '#16a34a' : '#dc2626';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Park Avenue Wholesale — Sales 2025 vs 2026</title>
<style>
  @page { size: letter; margin: 0.55in 0.45in; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 8.5pt;
    color: #111827;
    line-height: 1.45;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── Page header band ── */
  .ph {
    background: #1e3a8a; color: #fff;
    padding: 22px 0 18px; margin-bottom: 22px; text-align: center;
  }
  .ph-co  { font-size: 20pt; font-weight: 700; letter-spacing: .02em; margin-bottom: 4px; }
  .ph-ttl { font-size: 12pt; font-weight: 400; opacity: .88; margin-bottom: 6px; }
  .ph-sub { font-size: 8pt; opacity: .65; }
  .ph-sm  { padding: 14px 0 12px; margin-bottom: 18px; }
  .ph-sm .ph-co { font-size: 14pt; margin-bottom: 2px; }
  .ph-sm .ph-sub { font-size: 7.5pt; }

  /* ── KPI grid ── */
  .kgrid { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; margin-bottom: 18px; }
  .kbox { border: 1px solid #e5e7eb; border-radius: 3px; padding: 10px 12px; text-align: center; }
  .k-lbl { font-size: 7pt; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
  .k-val { font-size: 17pt; font-weight: 700; line-height: 1; }
  .k-sub { font-size: 7pt; color: #9ca3af; margin-top: 4px; }

  /* ── Alert box ── */
  .alert {
    border: 1px solid #fde68a; background: #fffbeb;
    border-radius: 3px; padding: 11px 14px; margin-bottom: 18px; font-size: 8.5pt;
  }
  .alert b  { color: #92400e; }
  .alert ul { margin: 7px 0 0 14px; }
  .alert li { margin-bottom: 3px; }

  /* ── Section title ── */
  .stitle {
    font-size: 10pt; font-weight: 700; color: #1e3a8a;
    background: #eff6ff; border-left: 4px solid #1e3a8a;
    padding: 6px 10px; margin: 18px 0 8px;
  }

  /* ── Tables ── */
  table   { width: 100%; border-collapse: collapse; font-size: 8pt; page-break-inside: auto; }
  thead   { display: table-header-group; }
  th      { background: #1e3a8a; color: #fff; padding: 5px 7px; text-align: right;
            font-size: 7.5pt; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
  th.L    { text-align: left; }
  tr      { page-break-inside: avoid; }
  td      { padding: 3.5px 7px; border-bottom: 1px solid #f3f4f6; text-align: right; white-space: nowrap; }
  td.L    { text-align: left; font-weight: 500; }
  td.mu   { color: #d1d5db; }
  tbody tr:nth-child(even) { background: #f9fafb; }
  .tfoot td { font-weight: 700; background: #eff6ff !important; border-top: 2px solid #1e3a8a; }

  /* ── Color classes ── */
  .pos { color: #16a34a; font-weight: 700; }
  .neg { color: #dc2626; font-weight: 700; }

  /* ── Page break ── */
  .pb { break-before: page; }

  /* ── Green / red section headers ── */
  .ph-green { background: #14532d; }
  .ph-green .th-bg { background: #166534; }
  .ph-red   { background: #7c2d12; }
  .ph-red   .th-bg { background: #9a3412; }

  /* ── Table of contents ── */
  .toc {
    border: 1px solid #dbeafe; background: #f8faff;
    border-radius: 4px; padding: 14px 18px; margin-bottom: 18px;
  }
  .toc-h {
    font-size: 9pt; font-weight: 700; color: #1e3a8a;
    text-transform: uppercase; letter-spacing: .07em; margin-bottom: 10px;
    padding-bottom: 6px; border-bottom: 2px solid #1e3a8a;
  }
  .toc-row {
    display: flex; align-items: baseline;
    padding: 5px 0; border-bottom: 1px solid #e5e7eb; gap: 6px;
  }
  .toc-row:last-child { border-bottom: none; }
  .toc-sec  { font-weight: 700; color: #1e3a8a; font-size: 8.5pt; min-width: 22px; }
  .toc-lbl  { font-size: 8.5pt; color: #374151; flex: 1; }
  .toc-sub  { font-size: 7.5pt; color: #9ca3af; margin-left: 4px; }
  .toc-dots { flex: 1; border-bottom: 1px dotted #cbd5e1; min-width: 20px; position: relative; top: -5px; }
  .toc-pg   { font-size: 9pt; font-weight: 700; color: #1e40af; min-width: 28px; text-align: right; }
</style>
</head>
<body>

<!-- ═══════════════════════════════════════════════════════
     PAGE 1 — EXECUTIVE SUMMARY
     ═══════════════════════════════════════════════════════ -->

<div class="ph">
  <div class="ph-co">PARK AVENUE WHOLESALE, INC.</div>
  <div class="ph-ttl">Sales Performance — 2025 vs 2026 Year-to-Date</div>
  <div class="ph-sub">January 1 – May 27 &nbsp;·&nbsp; Same window, both years &nbsp;·&nbsp; Generated ${genTime} &nbsp;·&nbsp; Source: Fishbowl Inventory</div>
</div>

<div class="kgrid">
  <div class="kbox" style="border-color:#bfdbfe">
    <div class="k-lbl">2025 YTD Orders</div>
    <div class="k-val" style="color:#1e40af">${fmt(summary.total2025)}</div>
    <div class="k-sub">Jan 1 – May 27, 2025</div>
  </div>
  <div class="kbox" style="border-color:#ddd6fe">
    <div class="k-lbl">2026 YTD Orders</div>
    <div class="k-val" style="color:#7c3aed">${fmt(summary.total2026)}</div>
    <div class="k-sub">Jan 1 – May 27, 2026</div>
  </div>
  <div class="kbox" style="border-color:${summary.change >= 0 ? '#bbf7d0' : '#fecaca'}">
    <div class="k-lbl">YTD Change</div>
    <div class="k-val" style="color:${chgColor}">${totalChgStr}</div>
    <div class="k-sub">${totalPctStr} vs prior year</div>
  </div>
  <div class="kbox">
    <div class="k-lbl">Customer Accounts</div>
    <div class="k-val" style="font-size:12pt;color:#374151;padding-top:4px">${fmt(summary.customers2025)} → ${fmt(summary.customers2026)}</div>
    <div class="k-sub">${fmt(summary.newIn2026)} new &nbsp;·&nbsp; ${fmt(summary.goneQuiet)} quiet</div>
  </div>
</div>

<!-- TABLE OF CONTENTS -->
<div class="toc">
  <div class="toc-h">Table of Contents</div>
  <div class="toc-row">
    <span class="toc-sec">1</span>
    <span class="toc-lbl">Executive Summary &amp; Monthly Breakdown</span>
    <span class="toc-dots"></span>
    <span class="toc-pg">1</span>
  </div>
  <div class="toc-row">
    <span class="toc-sec">2</span>
    <span class="toc-lbl">Customer Comparison — Both Years Active</span>
    <span class="toc-sub">${fmt(existing.length)} customers, sorted by 2025 volume</span>
    <span class="toc-dots"></span>
    <span class="toc-pg" id="toc-pg-2">${PAGE_CUST}</span>
  </div>
  <div class="toc-row">
    <span class="toc-sec">3</span>
    <span class="toc-lbl">New Accounts in 2026</span>
    <span class="toc-sub">${fmt(newCustomers.length)} customers not seen in Jan–May 2025</span>
    <span class="toc-dots"></span>
    <span class="toc-pg" id="toc-pg-3">${PAGE_NEW}</span>
  </div>
  <div class="toc-row">
    <span class="toc-sec">4</span>
    <span class="toc-lbl">Gone Quiet in 2026</span>
    <span class="toc-sub">${fmt(churned.length)} customers with 2025 orders but zero in 2026</span>
    <span class="toc-dots"></span>
    <span class="toc-pg" id="toc-pg-4">${PAGE_CHURN}</span>
  </div>
</div>

<div class="alert">
  <b>⚠&nbsp; Key Observations</b>
  <ul>
    <li>Order volume is down <b>${Math.abs(Number(summary.changePct).toFixed(1))}%</b> year-over-year — ${fmt(Math.abs(summary.change))} fewer orders through May 27, 2026 vs the same period in 2025.</li>
    <li><b>${fmt(summary.goneQuiet)} customers</b> placed orders Jan–May 2025 but have placed zero orders in the same 2026 window — potential churn risk worth investigating.</li>
    <li><b>${fmt(summary.newIn2026)} new accounts</b> are active in 2026 that were not seen in the 2025 YTD window.</li>
    <li>Figures represent order counts only. Revenue data requires QuickBooks Online integration (production credentials needed).</li>
  </ul>
</div>

<div class="stitle">Monthly Order Volume — January through May</div>
<table>
  <thead>
    <tr>
      <th class="L" style="width:30%">Month</th>
      <th style="width:17%">2025 Orders</th>
      <th style="width:17%">2026 Orders</th>
      <th style="width:18%">Change</th>
      <th style="width:18%">% Change</th>
    </tr>
  </thead>
  <tbody>
    ${monthRows}
    <tr class="tfoot">
      <td class="L">TOTAL YTD</td>
      <td>${fmt(summary.total2025)}</td>
      <td>${fmt(summary.total2026)}</td>
      <td class="${cls(summary.change)}">${totalChgStr}</td>
      <td class="${cls(summary.changePct)}">${totalPctStr}</td>
    </tr>
  </tbody>
</table>


<!-- ═══════════════════════════════════════════════════════
     PAGE 2+ — CUSTOMER COMPARISON TABLE
     ═══════════════════════════════════════════════════════ -->

<div id="sect-cust" class="pb"></div>

<div class="ph ph-sm">
  <div class="ph-co">Customer-Level Comparison — Both Years Active</div>
  <div class="ph-sub">Sorted by 2025 order volume (highest first) &nbsp;·&nbsp; ${fmt(existing.length)} customers</div>
</div>

<table>
  <thead>
    <tr>
      <th class="L" style="width:36%">Customer</th>
      <th style="width:16%">2025 Orders</th>
      <th style="width:16%">2026 Orders</th>
      <th style="width:16%">Change</th>
      <th style="width:16%">% Change</th>
    </tr>
  </thead>
  <tbody>${custRows}</tbody>
</table>


<!-- ═══════════════════════════════════════════════════════
     NEW ACCOUNTS
     ═══════════════════════════════════════════════════════ -->

<div id="sect-new" class="pb"></div>

<div class="ph ph-sm ph-green">
  <div class="ph-co">New Accounts in 2026 &nbsp;·&nbsp; ${fmt(newCustomers.length)} customers</div>
  <div class="ph-sub">Ordered Jan–May 2026 with no orders in Jan–May 2025</div>
</div>

<table>
  <thead>
    <tr>
      <th class="L ph-green" style="width:55%; background:#166534">Customer</th>
      <th style="width:15%; background:#166534">2025 Orders</th>
      <th style="width:15%; background:#166534">2026 Orders</th>
      <th style="width:15%; background:#166534">Status</th>
    </tr>
  </thead>
  <tbody>${newRows}</tbody>
</table>


<!-- ═══════════════════════════════════════════════════════
     GONE QUIET
     ═══════════════════════════════════════════════════════ -->

<div id="sect-churn" class="pb"></div>

<div class="ph ph-sm ph-red">
  <div class="ph-co">Gone Quiet in 2026 &nbsp;·&nbsp; ${fmt(churned.length)} customers</div>
  <div class="ph-sub">Placed orders Jan–May 2025 but zero orders in Jan–May 2026</div>
</div>

<table>
  <thead>
    <tr>
      <th class="L" style="width:55%; background:#9a3412">Customer</th>
      <th style="width:15%; background:#9a3412">2025 Orders</th>
      <th style="width:15%; background:#9a3412">2026 Orders</th>
      <th style="width:15%; background:#9a3412">Status</th>
    </tr>
  </thead>
  <tbody>${churnRows}</tbody>
</table>

<script>
  // Refine TOC page numbers from actual rendered layout.
  // Letter page = 11in x 96dpi = 1056 CSS px.
  window.addEventListener('load', function () {
    var PAGE_H = 11 * 96;
    function pageOf(id) {
      var el = document.getElementById(id);
      if (!el) return null;
      var top = 0;
      for (var n = el; n; n = n.offsetParent) top += n.offsetTop;
      return Math.floor(top / PAGE_H) + 1;
    }
    var pairs = [
      ['toc-pg-2', 'sect-cust'],
      ['toc-pg-3', 'sect-new'],
      ['toc-pg-4', 'sect-churn']
    ];
    pairs.forEach(function (p) {
      var pg = pageOf(p[1]);
      if (pg !== null) document.getElementById(p[0]).textContent = pg;
    });
  });
</script>

</body>
</html>`;
}

// ── 3. Find Edge or Chrome ─────────────────────────────────────────────────────
function findBrowser() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find(p => fs.existsSync(p));
}

// ── Main ───────────────────────────────────────────────────────────────────────
(async () => {
  // 1. Fetch
  process.stdout.write('Fetching report data...');
  let data;
  try {
    data = await fetchFromServer();
    console.log(' ✓  (cached — instant)');
  } catch (e) {
    console.log('\n⚠  Dashboard server not responding. Start it first with:\n   node dashboard-server.js\n');
    process.exit(1);
  }

  // 2. Build HTML
  process.stdout.write('Building HTML report...');
  const html = buildHTML(data);
  const htmlPath = path.join(os.tmpdir(), `pa-report-${Date.now()}.html`);
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log(' ✓');

  // 3. Find browser
  const browser = findBrowser();
  if (!browser) {
    console.error('❌  Microsoft Edge or Chrome not found.');
    process.exit(1);
  }

  const today   = new Date().toISOString().slice(0, 10);
  const pdfPath = path.resolve(__dirname, `ParkAvenue-Sales-2025v2026-${today}.pdf`);
  const tmpProf = path.join(os.tmpdir(), `pa-prof-${Date.now()}`);

  process.stdout.write(`Converting to PDF via ${path.basename(browser, '.exe')}...`);
  const result = spawnSync(browser, [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--user-data-dir=${tmpProf}`,
    `--print-to-pdf=${pdfPath}`,
    '--print-to-pdf-no-header',
    '--run-all-compositor-stages-before-draw',
    `file:///${htmlPath.replace(/\\/g, '/')}`,
  ], { timeout: 60000, encoding: 'utf8', stdio: 'pipe' });

  // Clean up temp files
  try { fs.unlinkSync(htmlPath); } catch {}
  try { fs.rmSync(tmpProf, { recursive: true, force: true }); } catch {}

  if (!fs.existsSync(pdfPath)) {
    console.log('\n❌  PDF was not created.');
    if (result.stderr) console.error(result.stderr.slice(0, 600));
    process.exit(1);
  }

  const kb = (fs.statSync(pdfPath).size / 1024).toFixed(0);
  console.log(` ✓  (${kb} KB)`);
  console.log(`\n✅  PDF saved: ${pdfPath}`);
  console.log('    Opening...\n');

  execSync(`start "" "${pdfPath}"`);
})().catch(err => { console.error('\nError:', err.message); process.exit(1); });
