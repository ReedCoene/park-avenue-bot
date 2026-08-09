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

function fbHeaders() { return { headers: { Authorization: `Bearer ${token}` } }; }

async function fbGet(path, params = {}) {
  const res = await axios.get(`${FB_BASE}${path}`, { ...fbHeaders(), params });
  return res.data;
}

(async () => {
  await fbLogin();

  // Pull data in parallel
  const [partsRes, recentSORes, oldSORes, poRes] = await Promise.all([
    fbGet('/parts', { pageSize: 1 }),
    fbGet('/sales-orders', { pageSize: 500 }),                          // most recent 500
    fbGet('/sales-orders', { pageSize: 500, pageNumber: 2 }),
    fbGet('/purchase-orders', { pageSize: 500 }),
  ]);

  const soList = [...(recentSORes.results || []), ...(oldSORes.results || [])];
  const poList = poRes.results || [];

  // Inventory from CSV
  const invRaw = fs.readFileSync(process.env.INVENTORY_CSV_PATH || './InvQtys.csv', 'utf8');
  const invRows = parse(invRaw, { columns: true, skip_empty_lines: true });

  // --- Inventory analysis ---
  const byLocation = {};
  let totalUnits = 0, totalValue = 0, zeroCostItems = 0;
  invRows.forEach(r => {
    const loc = r.Location || 'Unknown';
    const qty = parseFloat(r.Qty) || 0;
    const cost = parseFloat(r.Cost) || 0;
    byLocation[loc] = (byLocation[loc] || 0) + qty;
    totalUnits += qty;
    totalValue += qty * cost;
    if (cost === 0) zeroCostItems++;
  });

  // --- Sales order analysis ---
  const now = new Date();
  const days30 = new Date(now - 30 * 86400000);
  const days90 = new Date(now - 90 * 86400000);
  const statusCount = {}, customerCount = {}, monthlyCount = {};

  soList.forEach(so => {
    statusCount[so.status] = (statusCount[so.status] || 0) + 1;
    if (so.customerName) customerCount[so.customerName] = (customerCount[so.customerName] || 0) + 1;
    const d = new Date(so.dateIssued);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    monthlyCount[key] = (monthlyCount[key] || 0) + 1;
  });

  const recent30 = soList.filter(s => new Date(s.dateIssued) > days30).length;
  const recent90 = soList.filter(s => new Date(s.dateIssued) > days90).length;
  const openSOs = soList.filter(s => !['Fulfilled','Cancelled','Closed'].includes(s.status));
  const topCustomers = Object.entries(customerCount).sort((a,b) => b[1]-a[1]).slice(0,10);

  // --- PO analysis ---
  const poStatusCount = {};
  const openPOs = poList.filter(p => !['Closed','Fulfilled','Cancelled','Void'].includes(p.status));
  poList.forEach(po => { poStatusCount[po.status] = (poStatusCount[po.status] || 0) + 1; });

  // Monthly trend (last 6 months)
  const months = Object.entries(monthlyCount).sort((a,b) => a[0].localeCompare(b[0])).slice(-6);

  // --- Print report ---
  console.log('='.repeat(65));
  console.log('  PARK AVENUE WHOLESALE â€” COMPANY OVERVIEW');
  console.log(' ', new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' }));
  console.log('='.repeat(65));

  console.log('\n INVENTORY SNAPSHOT');
  console.log(`  Total SKUs tracked:     ${partsRes.totalCount?.toLocaleString()}`);
  console.log(`  Total units on hand:    ${totalUnits.toLocaleString()}`);
  console.log(`  Est. value at cost:     $${totalValue.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`);
  console.log(`  Items with $0 cost:     ${zeroCostItems} (need cost assignment)`);
  console.log('\n  By location:');
  Object.entries(byLocation).filter(([,q])=>q>0).sort((a,b)=>b[1]-a[1])
    .forEach(([l,q]) => console.log(`    ${l.padEnd(30)} ${q.toLocaleString().padStart(10)} units`));

  console.log('\n SALES ORDERS');
  console.log(`  All-time total:         ${recentSORes.totalCount?.toLocaleString()}`);
  console.log(`  Last 30 days:           ${recent30} (of ${soList.length} sampled)`);
  console.log(`  Last 90 days:           ${recent90}`);
  console.log(`  Currently open:         ${openSOs.length} (of sample)`);
  console.log('\n  Status breakdown:');
  Object.entries(statusCount).sort((a,b)=>b[1]-a[1])
    .forEach(([s,c]) => console.log(`    ${s.padEnd(20)} ${c}`));
  console.log('\n  Monthly order trend:');
  months.forEach(([m,c]) => {
    const bar = 'â–ˆ'.repeat(Math.round(c / Math.max(...months.map(x=>x[1])) * 20));
    console.log(`    ${m}  ${bar.padEnd(20)} ${c}`);
  });

  console.log('\n TOP 10 CUSTOMERS (by order count in sample)');
  topCustomers.forEach(([name, count], i) =>
    console.log(`  ${String(i+1).padStart(2)}. ${name.padEnd(35)} ${count} orders`));

  console.log('\n PURCHASE ORDERS');
  console.log(`  All-time total:         ${poRes.totalCount?.toLocaleString()}`);
  console.log(`  Open POs (in sample):   ${openPOs.length}`);
  console.log('\n  Status breakdown:');
  Object.entries(poStatusCount).sort((a,b)=>b[1]-a[1])
    .forEach(([s,c]) => console.log(`    ${s.padEnd(20)} ${c}`));

  console.log('\n' + '='.repeat(65));
  await axios.post(`${FB_BASE}/logout`, {}, fbHeaders()).catch(()=>{});
})().catch(console.error);
