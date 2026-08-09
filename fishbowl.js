const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const axios = require('axios');

const BASE_URL = `http://${process.env.FB_SERVER}:${process.env.FB_PORT}/api`;

let token = null;

async function login() {
  const res = await axios.post(`${BASE_URL}/login`, {
    username: process.env.FB_USERNAME,
    password: process.env.FB_PASSWORD,
    appName: 'Claude Reports',
    appDescription: 'Claude AI integration',
    appId: 5150,
  });
  token = res.data.token;
  console.log('Fishbowl login successful');
  return token;
}

function authHeaders() {
  return { headers: { Authorization: `Bearer ${token}` } };
}

async function getParts(params = {}) {
  const res = await axios.get(`${BASE_URL}/parts`, { ...authHeaders(), params });
  return res.data;
}

async function getSalesOrders(params = {}) {
  const res = await axios.get(`${BASE_URL}/sales-orders`, { ...authHeaders(), params });
  return res.data;
}

async function getPurchaseOrders(params = {}) {
  const res = await axios.get(`${BASE_URL}/purchase-orders`, { ...authHeaders(), params });
  return res.data;
}

async function getProducts(params = {}) {
  const res = await axios.get(`${BASE_URL}/products`, { ...authHeaders(), params });
  return res.data;
}

async function logout() {
  if (token) {
    await axios.post(`${BASE_URL}/logout`, {}, authHeaders());
    token = null;
  }
}

module.exports = { login, logout, getParts, getSalesOrders, getPurchaseOrders, getProducts };
