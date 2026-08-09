require('dotenv').config();
const axios = require('axios');

// Try both endpoints to diagnose sandbox vs production credentials
const PROD    = `https://quickbooks.api.intuit.com/v3/company/${process.env.QBO_REALM_ID}`;
const SANDBOX = `https://sandbox-quickbooks.api.intuit.com/v3/company/${process.env.QBO_REALM_ID}`;

async function test(label, base) {
  try {
    const res = await axios.get(`${base}/query`, {
      params: { query: 'SELECT * FROM CompanyInfo MAXRESULTS 1' },
      headers: { Authorization: `Bearer ${process.env.QBO_ACCESS_TOKEN}`, Accept: 'application/json' },
    });
    const co = res.data.QueryResponse?.CompanyInfo?.[0];
    console.log(`✅  ${label}: ${co?.CompanyName} (realm ${process.env.QBO_REALM_ID})`);
  } catch (e) {
    console.log(`❌  ${label}: HTTP ${e.response?.status} — ${e.response?.data?.fault?.error?.[0]?.message || e.message}`);
  }
}

(async () => {
  await test('Production endpoint', PROD);
  await test('Sandbox endpoint  ', SANDBOX);
})();
