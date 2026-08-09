require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const { parse } = require('csv-parse/sync');

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

function fmt$(n) { return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtN(n) { return n.toLocaleString('en-US'); }

(async () => {
  console.log('Connecting to Fishbowl...');
  await fbLogin();

  // â”€â”€ Step 1: get counts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [soMeta, poMeta, partsMeta] = await Promise.all([
    fbGet('/sales-orders', { pageSize: 1 }),
    fbGet('/purchase-orders', { pageSize: 1 }),
    fbGet('/parts', { pageSize: 1 }),
  ]);

  const totalSOs = soMeta.totalCount || 0;
  const totalPOs = poMeta.totalCount || 0;
  const totalParts = partsMeta.totalCount || 0;
  const pageSize = 500;

  // â”€â”€ Step 2: fetch recent SOs (last ~1500 = 3 pages from the end) â”€â”€â”€â”€
  const lastPage = Math.ceil(totalSOs / pageSize);
  const pagesToFetch = [lastPage, lastPage - 1, lastPage - 2].filter(p => p >= 1);
  console.log(`Fetching recent sales orders (pages ${pagesToFetch.join(', ')} of ${lastPage})...`);

  const soPages = await Promise.all(
    pagesToFetch.map(p => fbGet('/sales-orders', { pageSize, pageNumber: p }))
  );
  const recentSOs = soPages.flatMap(p => p.results || []);

  // â”€â”€ Step 3: fetch all POs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  console.log('Fetching purchase orders...');
  const poLastPage = Math.ceil(totalPOs / pageSize);
  const poPages = await Promise.all(
    Array.from({ length: poLastPage }, (_, i) => fbGet('/purchase-orders', { pageSize, pageNumber: i + 1 }))
  );
  const allPOs = poPages.flatMap(p => p.results || []);

  // â”€â”€ Step 4: inventory CSV â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const invRaw = fs.readFileSync(process.env.INVENTORY_CSV_PATH || './InvQtys.csv', 'utf8');
  const invRows = parse(invRaw, { columns: true, skip_empty_lines: true });

  await axios.post(`${FB_BASE}/logout`, {}, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // ANALYSIS
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  const now = new Date();
  const days7  = new Date(now - 7  * 86400000);
  const days30 = new Date(now - 30 * 86400000);
  const days90 = new Date(now - 90 * 86400000);

  // â”€â”€ Inventory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const byLoc = {}, byCat = {};
  let invUnits = 0, invValue = 0, zeroCost = 0, zeroQty = 0;

  invRows.forEach(r => {
    const qty  = parseFloat(r.Qty)  || 0;
    const cost = parseFloat(r.Cost) || 0;
    const loc  = (r.Location || 'Unknown').trim();
    const cat  = (r.Category || 'Uncategorized').trim();

    byLoc[loc] = (byLoc[loc] || 0) + qty;
    if (qty > 0) {
      byCat[cat] = (byCat[cat] || { units: 0, value: 0 });
      byCat[cat].units += qty;
      byCat[cat].value += qty * cost;
    }
    invUnits += qty;
    invValue += qty * cost;
    if (cost === 0 && qty > 0) zeroCost++;
    if (qty === 0) zeroQty++;
  });

  const topCats = Object.entries(byCat).sort((a, b) => b[1].value - a[1].value).slice(0, 10);

  // â”€â”€ Sales orders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Probe first SO to understand available fields
  const sampleSO = recentSOs[0] || {};

  const soByStatus = {}, customerOrders = {}, customerRevenue = {}, monthlyData = {};
  let totalRevenue = 0, filledCount = 0;

  recentSOs.forEach(so => {
    const status = so.status || 'Unknown';
    soByStatus[status] = (soByStatus[status] || 0) + 1;

    const name = so.customerName || so.customer?.name || 'Unknown';
    customerOrders[name]  = (customerOrders[name]  || 0) + 1;

    // Revenue fields â€” try several common Fishbowl field names
    const rev = parseFloat(
      so.totalPrice ?? so.grandTotal ?? so.total ?? so.subTotal ?? so.orderTotal ?? 0
    );
    if (rev > 0) {
      totalRevenue += rev;
      filledCount++;
      customerRevenue[name] = (customerRevenue[name] || 0) + rev;
    }

    const d = new Date(so.dateIssued || so.dateCreated || so.date);
    if (!isNaN(d)) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthlyData[key] = monthlyData[key] || { orders: 0, revenue: 0 };
      monthlyData[key].orders++;
      monthlyData[key].revenue += rev;
    }
  });

  const so7  = recentSOs.filter(s => new Date(s.dateIssued || s.date) > days7).length;
  const so30 = recentSOs.filter(s => new Date(s.dateIssued || s.date) > days30).length;
  const so90 = recentSOs.filter(s => new Date(s.dateIssued || s.date) > days90).length;

  const openSOs = recentSOs.filter(s =>
    !['Fulfilled', 'Closed', 'Cancelled', 'Void'].includes(s.status)
  );

  const topByOrders  = Object.entries(customerOrders).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const topByRevenue = Object.entries(customerRevenue).sort((a, b) => b[1] - a[1]).slice(0, 15);

  const months = Object.entries(monthlyData).sort((a, b) => a[0].localeCompare(b[0])).slice(-6);
  const maxOrders = Math.max(...months.map(([, v]) => v.orders), 1);

  // â”€â”€ Purchase orders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const poByStatus = {}, vendorPOs = {}, vendorSpend = {};
  let openPOValue = 0;

  allPOs.forEach(po => {
    const status = po.status || 'Unknown';
    poByStatus[status] = (poByStatus[status] || 0) + 1;

    const vendor = po.vendorName || po.vendor?.name || 'Unknown';
    vendorPOs[vendor] = (vendorPOs[vendor] || 0) + 1;

    const val = parseFloat(po.totalPrice ?? po.grandTotal ?? po.total ?? 0);
    if (val > 0) vendorSpend[vendor] = (vendorSpend[vendor] || 0) + val;

    const isOpen = !['Closed', 'Fulfilled', 'Cancelled', 'Void'].includes(status);
    if (isOpen) openPOValue += val;
  });

  const openPOs = allPOs.filter(p =>
    !['Closed', 'Fulfilled', 'Cancelled', 'Void'].includes(p.status)
  );

  const topVendors = Object.entries(vendorSpend).sort((a, b) => b[1] - a[1]).slice(0, 10);

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // REPORT
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  const W = 68;
  const line  = 'â•'.repeat(W);
  const dash  = 'â”€'.repeat(W);

  console.log('\n' + line);
  console.log('  PARK AVENUE WHOLESALE â€” FINANCIAL & OPERATIONS SNAPSHOT');
  console.log(`  ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`);
  console.log(line);

  // â”€â”€ INVENTORY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  console.log('\n  INVENTORY');
  console.log(dash);
  console.log(`  Total SKUs tracked:        ${fmtN(totalParts)}`);
  console.log(`  Line items in CSV:         ${fmtN(invRows.length)}`);
  console.log(`  Total units on hand:       ${fmtN(invUnits)}`);
  console.log(`  Estimated value at cost:   ${fmt$(invValue)}`);
  console.log(`  SKUs with $0 cost:         ${fmtN(zeroCost)}  â† needs cost assignment`);
  console.log(`  SKUs with 0 qty:           ${fmtN(zeroQty)}`);
  console.log('\n  By warehouse:');
  Object.entries(byLoc).filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1])
    .forEach(([l, q]) => {
      const pct = ((q / invUnits) * 100).toFixed(1);
      console.log(`    ${l.padEnd(32)} ${fmtN(q).padStart(10)} units  (${pct}%)`);
    });

  if (topCats.length) {
    console.log('\n  Top categories by value at cost:');
    topCats.forEach(([cat, { units, value }]) => {
      const pct = ((value / invValue) * 100).toFixed(1);
      console.log(`    ${cat.slice(0, 30).padEnd(32)} ${fmt$(value).padStart(13)}  (${pct}%)`);
    });
  }

  // â”€â”€ SALES ORDERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  console.log('\n\n  SALES ORDERS');
  console.log(dash);
  console.log(`  All-time total:            ${fmtN(totalSOs)} orders`);
  console.log(`  Sample window:             most recent ${fmtN(recentSOs.length)} orders`);
  console.log(`  Within sample â€” last 7d:   ${fmtN(so7)}`);
  console.log(`  Within sample â€” last 30d:  ${fmtN(so30)}`);
  console.log(`  Within sample â€” last 90d:  ${fmtN(so90)}`);
  console.log(`  Currently open (sample):   ${fmtN(openSOs.length)}`);

  if (filledCount > 0) {
    console.log(`\n  Revenue in sample:         ${fmt$(totalRevenue)}`);
    console.log(`  Orders with $ data:        ${fmtN(filledCount)} of ${fmtN(recentSOs.length)}`);
    console.log(`  Avg order value:           ${fmt$(totalRevenue / filledCount)}`);
  } else {
    console.log('\n  Revenue:                   $ data not exposed by this endpoint');
    console.log(`  (sample SO fields: ${Object.keys(sampleSO).join(', ')})`);
  }

  console.log('\n  Status breakdown (sample):');
  Object.entries(soByStatus).sort((a, b) => b[1] - a[1])
    .forEach(([s, c]) => {
      const pct = ((c / recentSOs.length) * 100).toFixed(1);
      console.log(`    ${s.padEnd(20)} ${fmtN(c).padStart(6)}  (${pct}%)`);
    });

  console.log('\n  Monthly order trend (last 6 months in sample):');
  months.forEach(([m, { orders, revenue }]) => {
    const bar = 'â–ˆ'.repeat(Math.round((orders / maxOrders) * 24));
    const revStr = revenue > 0 ? `  ${fmt$(revenue)}` : '';
    console.log(`    ${m}  ${bar.padEnd(24)} ${fmtN(orders).padStart(5)}${revStr}`);
  });

  console.log('\n  Top 15 customers by order count (sample):');
  topByOrders.forEach(([name, count], i) => {
    const rev = customerRevenue[name];
    const revStr = rev ? `  ${fmt$(rev)}` : '';
    console.log(`    ${String(i + 1).padStart(2)}. ${name.slice(0, 33).padEnd(35)} ${fmtN(count).padStart(5)} orders${revStr}`);
  });

  if (topByRevenue.length && topByRevenue[0][1] > 0) {
    console.log('\n  Top 15 customers by revenue (sample):');
    topByRevenue.forEach(([name, rev], i) => {
      const pct = ((rev / totalRevenue) * 100).toFixed(1);
      console.log(`    ${String(i + 1).padStart(2)}. ${name.slice(0, 33).padEnd(35)} ${fmt$(rev).padStart(14)}  (${pct}%)`);
    });
  }

  // â”€â”€ PURCHASE ORDERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  console.log('\n\n  PURCHASE ORDERS');
  console.log(dash);
  console.log(`  All-time total:            ${fmtN(totalPOs)} POs`);
  console.log(`  Fetched:                   ${fmtN(allPOs.length)}`);
  console.log(`  Currently open:            ${fmtN(openPOs.length)}`);
  if (openPOValue > 0) {
    console.log(`  Open PO value:             ${fmt$(openPOValue)}`);
  }
  console.log('\n  Status breakdown:');
  Object.entries(poByStatus).sort((a, b) => b[1] - a[1])
    .forEach(([s, c]) => {
      const pct = ((c / allPOs.length) * 100).toFixed(1);
      console.log(`    ${s.padEnd(20)} ${fmtN(c).padStart(6)}  (${pct}%)`);
    });

  if (topVendors.length && topVendors[0][1] > 0) {
    console.log('\n  Top 10 vendors by $ ordered:');
    topVendors.forEach(([v, spend], i) => {
      console.log(`    ${String(i + 1).padStart(2)}. ${v.slice(0, 33).padEnd(35)} ${fmt$(spend).padStart(14)}`);
    });
  } else {
    console.log('\n  Top vendors by PO count:');
    Object.entries(vendorPOs).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .forEach(([v, c], i) => {
        console.log(`    ${String(i + 1).padStart(2)}. ${v.slice(0, 33).padEnd(35)} ${fmtN(c).padStart(5)} POs`);
      });
  }

  // â”€â”€ HEALTH FLAGS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  console.log('\n\n  FLAGS & OBSERVATIONS');
  console.log(dash);
  const flags = [];

  if (zeroCost > 100) flags.push(`  âš   ${fmtN(zeroCost)} inventory line items have $0 cost â€” overstates real margin`);
  if (openPOs.length > 50) flags.push(`  âš   ${fmtN(openPOs.length)} open POs â€” confirm these are all active`);
  if (so30 < 10)  flags.push(`  âš   Very few orders in last 30 days visible in sample â€” check page alignment`);
  if (filledCount === 0) flags.push('  â„¹  Fishbowl SO endpoint does not expose order totals â€” need /api/sales-order/:id or QBO for revenue');
  if (invValue > 0) flags.push(`  âœ“  ${fmt$(invValue)} inventory at cost across ${fmtN(invUnits)} units`);
  if (totalSOs > 100000) flags.push(`  âœ“  ${fmtN(totalSOs)} lifetime orders â€” very high volume / established business`);

  flags.forEach(f => console.log(f));

  console.log('\n  NOTE: Revenue figures require QuickBooks Online (production credentials).');
  console.log('        Run `node qbo-auth.js` after entering production QBO credentials.');
  console.log('\n' + line + '\n');

})().catch(err => {
  console.error('Error:', err.response?.data || err.message);
  process.exit(1);
});
