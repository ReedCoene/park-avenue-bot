const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const OAuthClient = require('intuit-oauth');
const axios = require('axios');
const fs = require('fs');

const client = new OAuthClient({
  clientId: process.env.QBO_CLIENT_ID,
  clientSecret: process.env.QBO_CLIENT_SECRET,
  environment: 'production',
  redirectUri: process.env.QBO_REDIRECT_URI,
  token: {
    access_token: process.env.QBO_ACCESS_TOKEN,
    refresh_token: process.env.QBO_REFRESH_TOKEN,
    token_type: 'bearer',
    realmId: process.env.QBO_REALM_ID,
  },
});

const BASE_URL = `https://quickbooks.api.intuit.com/v3/company/${process.env.QBO_REALM_ID}`;

async function refreshIfNeeded() {
  try {
    await axios.get(`${BASE_URL}/query`, {
      params: { query: 'SELECT * FROM CompanyInfo MAXRESULTS 1' },
      headers: { Authorization: `Bearer ${process.env.QBO_ACCESS_TOKEN}`, Accept: 'application/json' },
    });
  } catch (e) {
    if (e.response?.status !== 401) return;
    // Refresh directly via HTTP — no library internal state issues
    const creds = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64');
    const res = await axios.post(
      'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      `grant_type=refresh_token&refresh_token=${encodeURIComponent(process.env.QBO_REFRESH_TOKEN)}`,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${creds}` } }
    );
    const t = res.data;
    let env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    env = env.replace(/QBO_ACCESS_TOKEN=.*/, `QBO_ACCESS_TOKEN=${t.access_token}`);
    if (t.refresh_token) {
      env = env.replace(/QBO_REFRESH_TOKEN=.*/, `QBO_REFRESH_TOKEN=${t.refresh_token}`);
      process.env.QBO_REFRESH_TOKEN = t.refresh_token;
    }
    fs.writeFileSync(path.join(__dirname, '.env'), env);
    process.env.QBO_ACCESS_TOKEN = t.access_token;
  }
}

async function query(sql) {
  await refreshIfNeeded();
  const res = await axios.get(`${BASE_URL}/query`, {
    params: { query: sql },
    headers: {
      Authorization: `Bearer ${process.env.QBO_ACCESS_TOKEN}`,
      Accept: 'application/json',
    },
  });
  return res.data.QueryResponse;
}

async function getProfitAndLoss(startDate, endDate) {
  await refreshIfNeeded();
  const res = await axios.get(`${BASE_URL}/reports/ProfitAndLoss`, {
    params: { start_date: startDate, end_date: endDate, accounting_method: 'Accrual' },
    headers: {
      Authorization: `Bearer ${process.env.QBO_ACCESS_TOKEN}`,
      Accept: 'application/json',
    },
  });
  return res.data;
}

async function getBalanceSheet(startDate, endDate) {
  await refreshIfNeeded();
  const res = await axios.get(`${BASE_URL}/reports/BalanceSheet`, {
    params: { start_date: startDate, end_date: endDate },
    headers: {
      Authorization: `Bearer ${process.env.QBO_ACCESS_TOKEN}`,
      Accept: 'application/json',
    },
  });
  return res.data;
}

async function getInvoices(params = {}) {
  return query(`SELECT * FROM Invoice ORDERBY MetaData.LastUpdatedTime DESC MAXRESULTS ${params.limit || 10}`);
}

async function getCustomers(params = {}) {
  return query(`SELECT * FROM Customer ORDERBY DisplayName MAXRESULTS ${params.limit || 10}`);
}

async function getOpenInvoices() {
  return query(`SELECT * FROM Invoice WHERE Balance > '0' ORDERBY DueDate ASC MAXRESULTS 50`);
}

async function post(endpoint, body) {
  await refreshIfNeeded();
  const res = await axios.post(`${BASE_URL}/${endpoint}`, body, {
    headers: {
      Authorization: `Bearer ${process.env.QBO_ACCESS_TOKEN}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  return res.data;
}

module.exports = { getProfitAndLoss, getBalanceSheet, getInvoices, getCustomers, getOpenInvoices, query, post };
