// QuickBooks Online connector — generalized from the Park Ave setup. Read + draft/create.
// Auto-refreshes the access token (writes new tokens back to .env). Reusable per client.
const path = require('path');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ENVPATH = path.join(__dirname, '..', '.env');
const BASE = () => `https://quickbooks.api.intuit.com/v3/company/${process.env.QBO_REALM_ID}`;
const ready = () => Boolean(process.env.QBO_REALM_ID && process.env.QBO_REFRESH_TOKEN);

async function refreshIfNeeded() {
  try {
    await axios.get(`${BASE()}/query`, {
      params: { query: 'SELECT * FROM CompanyInfo MAXRESULTS 1' },
      headers: { Authorization: `Bearer ${process.env.QBO_ACCESS_TOKEN}`, Accept: 'application/json' },
    });
  } catch (e) {
    if (e.response?.status !== 401) return;
    const creds = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64');
    const res = await axios.post(
      'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      `grant_type=refresh_token&refresh_token=${encodeURIComponent(process.env.QBO_REFRESH_TOKEN)}`,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${creds}` } }
    );
    const t = res.data;
    let env = fs.readFileSync(ENVPATH, 'utf8');
    env = env.replace(/QBO_ACCESS_TOKEN=.*/, `QBO_ACCESS_TOKEN=${t.access_token}`);
    if (t.refresh_token) {
      env = env.replace(/QBO_REFRESH_TOKEN=.*/, `QBO_REFRESH_TOKEN=${t.refresh_token}`);
      process.env.QBO_REFRESH_TOKEN = t.refresh_token;
    }
    fs.writeFileSync(ENVPATH, env);
    process.env.QBO_ACCESS_TOKEN = t.access_token;
  }
}

async function query(sql) {
  await refreshIfNeeded();
  const res = await axios.get(`${BASE()}/query`, {
    params: { query: sql },
    headers: { Authorization: `Bearer ${process.env.QBO_ACCESS_TOKEN}`, Accept: 'application/json' },
  });
  return res.data.QueryResponse || {};
}

async function post(endpoint, body) {
  await refreshIfNeeded();
  const res = await axios.post(`${BASE()}/${endpoint}`, body, {
    headers: {
      Authorization: `Bearer ${process.env.QBO_ACCESS_TOKEN}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  return res.data;
}

const getOpenInvoices = () => query(`SELECT * FROM Invoice WHERE Balance > '0' ORDERBY DueDate ASC MAXRESULTS 50`);
const findVendor = (name) => query(`SELECT * FROM Vendor WHERE DisplayName LIKE '%${name.replace(/'/g, "")}%' MAXRESULTS 5`);

// Draft a vendor Bill from extracted invoice lines. Returns the created Bill (post to QBO).
// NOTE: account/item mapping is per-client config — wire the real AccountRef/ItemRef after discovery.
async function createBillDraft({ vendorId, lines, txnDate, docNumber }) {
  const body = {
    VendorRef: { value: vendorId },
    TxnDate: txnDate,
    DocNumber: docNumber,
    Line: lines.map((l) => ({
      DetailType: 'AccountBasedExpenseLineDetail',
      Amount: Number(l.amount) || 0,
      Description: l.description,
      AccountBasedExpenseLineDetail: { AccountRef: { value: process.env.QBO_DEFAULT_EXPENSE_ACCOUNT || '1' } },
    })),
  };
  return post('bill', body);
}

module.exports = { ready, query, post, getOpenInvoices, findVendor, createBillDraft };
