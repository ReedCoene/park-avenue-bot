require('dotenv').config();
const axios = require('axios');

const FB_BASE = `http://${process.env.FB_SERVER}:${process.env.FB_PORT}/api`;
let token = null;

const TRAVEL_CENTERS = ['love', 'pilot', 'iowa 80', 'road ranger', 'travel center', 'ta petro', 'petro'];

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

function isTravelCenter(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return TRAVEL_CENTERS.some(tc => lower.includes(tc));
}

(async () => {
  console.log('Logging in to Fishbowl...');
  await fbLogin();

  // Get total count first
  const probe = await fbGet('/sales-orders', { pageSize: 1 });
  const total = probe.totalCount || 138372;
  const pageSize = 500;
  const lastPage = Math.ceil(total / pageSize);

  console.log(`Total orders: ${total.toLocaleString()}. Pulling recent pages...`);

  // Pull last ~5,000 orders (10 pages)
  const pagesToFetch = [];
  for (let i = Math.max(1, lastPage - 9); i <= lastPage; i++) pagesToFetch.push(i);

  const pageResults = await Promise.all(
    pagesToFetch.map(p => fbGet('/sales-orders', { pageSize, pageNumber: p }))
  );

  const allOrders = pageResults.flatMap(r => r.results || []);
  console.log(`Pulled ${allOrders.length} recent orders.\n`);

  // Show sample of customer names to verify matching
  const uniqueCustomers = [...new Set(allOrders.map(o => o.customerName).filter(Boolean))];
  const tcMatches = uniqueCustomers.filter(isTravelCenter);

  console.log('Travel center customer names found in data:');
  if (tcMatches.length === 0) {
    console.log('  NONE MATCHED — showing all unique customer names for review:');
    uniqueCustomers.slice(0, 60).forEach(n => console.log(`  "${n}"`));
  } else {
    tcMatches.forEach(n => console.log(`  "${n}"`));
  }

  // Filter to travel center orders
  const tcOrders = allOrders.filter(o => isTravelCenter(o.customerName));

  if (tcOrders.length === 0) {
    console.log('\nNo travel center orders matched. Customer name list above will help identify the right names.');
    await axios.post(`${FB_BASE}/logout`, {}, fbHeaders()).catch(() => {});
    return;
  }

  const now = new Date();
  const days30 = new Date(now - 30 * 86400000);
  const days90 = new Date(now - 90 * 86400000);
  const days365 = new Date(now - 365 * 86400000);

  // Per-customer breakdown
  const byCustomer = {};
  tcOrders.forEach(so => {
    const name = so.customerName;
    if (!byCustomer[name]) byCustomer[name] = { total: 0, last30: 0, last90: 0, last365: 0, revenue: 0 };
    byCustomer[name].total++;
    const d = new Date(so.dateIssued || so.dateCreated);
    if (d > days30) byCustomer[name].last30++;
    if (d > days90) byCustomer[name].last90++;
    if (d > days365) byCustomer[name].last365++;
    byCustomer[name].revenue += parseFloat(so.totalPrice || so.total || so.amount || 0);
  });

  // Monthly trend for travel centers
  const monthly = {};
  tcOrders.forEach(so => {
    const d = new Date(so.dateIssued || so.dateCreated);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthly[key] = (monthly[key] || 0) + 1;
  });
  const monthlyTrend = Object.entries(monthly).sort((a, b) => a[0].localeCompare(b[0])).slice(-12);

  // Sample first order to show available fields
  const sampleOrder = tcOrders[0];

  console.log('\n' + '='.repeat(65));
  console.log('  TRAVEL CENTER SALES ANALYSIS — BUFFALO OUTDOORS');
  console.log('  ' + new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
  console.log('='.repeat(65));

  console.log('\n SAMPLE DATA FIELDS AVAILABLE:');
  console.log(' ', Object.keys(sampleOrder).join(', '));

  console.log('\n TRAVEL CENTER ORDER TOTALS (recent ~5,000 orders sampled)');
  console.log(`  Matched orders: ${tcOrders.length}`);

  const sorted = Object.entries(byCustomer).sort((a, b) => b[1].total - a[1].total);
  sorted.forEach(([name, stats]) => {
    console.log(`\n  ${name}`);
    console.log(`    Orders in sample:  ${stats.total}`);
    console.log(`    Last 30 days:      ${stats.last30}`);
    console.log(`    Last 90 days:      ${stats.last90}`);
    console.log(`    Last 365 days:     ${stats.last365}`);
    if (stats.revenue > 0) {
      console.log(`    Revenue in sample: $${stats.revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    }
  });

  console.log('\n MONTHLY ORDER TREND (travel centers, last 12 months):');
  const maxCount = Math.max(...monthlyTrend.map(x => x[1]));
  monthlyTrend.forEach(([m, c]) => {
    const bar = '█'.repeat(Math.round(c / maxCount * 25));
    console.log(`  ${m}  ${bar.padEnd(25)} ${c} orders`);
  });

  console.log('\n' + '='.repeat(65));

  await axios.post(`${FB_BASE}/logout`, {}, fbHeaders()).catch(() => {});
})().catch(console.error);
