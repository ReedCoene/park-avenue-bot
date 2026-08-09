// Fishbowl REST connector (Jetty/Spring API on FB_PORT, cleartext http).
// Robust single-session client: ONE login reused for everything, with guards so
// it never piles up sessions (Fishbowl caps concurrent sessions per user).
//   - single-flight login: concurrent callers share one login, not many
//   - logout-before-relogin on a 401 (frees the dead slot first)
//   - logout() on shutdown (app.js calls it) so restarts don't leak sessions
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');

const BASE = `http://${process.env.FB_SERVER}:${process.env.FB_PORT}`;
const APP = { appName: 'OpsBot', appDescription: 'AI ops assistant', appId: 1 };
const LOW_STOCK = Number(process.env.FB_LOW_STOCK_THRESHOLD || 5);

let token = null;
let loginInFlight = null;     // single-flight guard: one login at a time, shared by all callers
let loginFailures = 0;        // consecutive FAILED logins -> exponential backoff (so we never hammer)
let nextAllowedLogin = 0;     // timestamp before which we won't attempt another login
const MAX_BACKOFF_MS = Number(process.env.FB_MAX_BACKOFF_MS || 15 * 60 * 1000);     // cap on failure backoff
const KEEPALIVE_MS = Number(process.env.FB_KEEPALIVE_MS || 3 * 60 * 1000);          // ping to hold the session/seat open

const ready = () => Boolean(process.env.FB_SERVER && process.env.FB_PASSWORD);

async function doLogin() {
  const r = await axios.post(`${BASE}/api/login`,
    { ...APP, username: process.env.FB_USERNAME, password: process.env.FB_PASSWORD },
    { headers: { 'Content-Type': 'application/json' }, validateStatus: () => true, timeout: 12000 });
  if (r.status !== 200) throw new Error(`Fishbowl login ${r.status}: ${r.data?.message || JSON.stringify(r.data).slice(0, 160)}`);
  const t = r.data?.token;
  if (!t) throw new Error('Fishbowl login ok but no token in response');
  return t;
}

// If a login is already happening, every caller awaits the SAME one (prevents
// 5 simultaneous questions from opening 5 sessions).
async function login() {
  if (token) return token;
  if (loginInFlight) return loginInFlight;
  // Back off ONLY after consecutive failures, so we never hammer Fishbowl (that's
  // what locked the office out). A clean session drop recovers instantly because a
  // successful login resets the backoff to zero.
  if (Date.now() < nextAllowedLogin) throw new Error('Fishbowl login backing off (avoiding lockout)');
  loginInFlight = doLogin()
    .then((t) => { token = t; loginFailures = 0; nextAllowedLogin = 0; return t; })
    .catch((e) => {
      loginFailures += 1;
      const backoff = Math.min(MAX_BACKOFF_MS, 60 * 1000 * Math.pow(2, loginFailures - 1)); // 1,2,4,8,15 min
      nextAllowedLogin = Date.now() + backoff;
      throw e;
    })
    .finally(() => { loginInFlight = null; });
  return loginInFlight;
}

async function logout() {
  if (!token) return;
  const dead = token;
  token = null;
  try {
    await axios.post(`${BASE}/api/logout`, {}, { headers: { Authorization: `Bearer ${dead}` }, validateStatus: () => true, timeout: 6000 });
  } catch (e) { /* best effort */ }
}

// Keepalive: a cheap request on the EXISTING token so the session (and our one
// seat) stays open — no new login. If the session was dropped/kicked, clear the
// token so the maintain loop re-acquires it (gently, via the throttled login()).
async function keepalive() {
  if (!token) return;
  try {
    const r = await axios.get(`${BASE}/api/parts?pageSize=1`, { headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true, timeout: 8000 });
    if (r.status === 401) token = null;
  } catch (e) { /* transient blip — keep the token, try again next tick */ }
}

// Hold ONE persistent session: log in once, keep it alive, re-acquire gently if
// it ever drops. Login attempts are throttled, so this can never hammer Fishbowl.
function start() {
  if (!ready()) { console.log('[fishbowl] not configured'); return; }
  login().then(() => console.log('[fishbowl] connected — holding 1 seat, live')).catch((e) => console.log('[fishbowl] connect deferred:', e.message));
  const iv = setInterval(() => {
    if (token) keepalive();
    else login().then(() => console.log('[fishbowl] reconnected')).catch(() => {});
  }, KEEPALIVE_MS);
  if (iv.unref) iv.unref();
}

async function req(method, path, data) {
  if (!token) await login();
  const cfg = () => ({ method, url: `${BASE}${path}`, data, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, validateStatus: () => true, timeout: 15000 });
  let r = await axios(cfg());
  if (r.status === 401) {            // token expired/invalid -> release the dead slot, log in fresh once, retry
    await logout();
    await login();
    r = await axios(cfg());
  }
  if (r.status >= 400) throw new Error(`${path} ${r.status}: ${r.data?.message || r.data?.detail || ''}`);
  return r.data;
}

const get = (p) => req('GET', p);

// ---- inventory helpers ------------------------------------------------------
const num = (s) => Number(String(s ?? '0').replace(/,/g, '')) || 0;
const shape = (r) => ({ id: r.id, number: r.partNumber, part: r.partDescription, qty: num(r.quantity), uom: r.uom?.abbreviation });

// All on-hand inventory (~3,900 rows). Cached 20s so a burst of questions in one
// conversation doesn't re-fetch each time (still effectively live).
let _invCache = { at: 0, data: null };
async function allInventory() {
  if (_invCache.data && Date.now() - _invCache.at < 20000) return _invCache.data;
  // Page through in proven-safe chunks (pageSize=5000 is confirmed to work; a huge
  // pageSize gets rejected). Handles any inventory size.
  let rows = [];
  for (let page = 1; page <= 20; page++) {
    const d = await get(`/api/parts/inventory?pageSize=5000&pageNumber=${page}`);
    const batch = d.results || [];
    rows = rows.concat(batch);
    const total = d.totalCount || 0;
    if (batch.length < 5000 || (total && rows.length >= total)) break;
  }
  _invCache = { at: Date.now(), data: rows.map(shape) };
  return _invCache.data;
}

// Smart search: match query tokens against part NUMBER *and* description
// (plural-tolerant). Tries all-tokens, then falls back to any-token. This is why
// "716487CL Men's Tech Cargo Short" now works as one search.
async function searchInventory(term) {
  const all = await allInventory();
  const tokens = String(term || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  if (!tokens.length) return [];
  const tok = (t, h) => h.includes(t) || (t.length > 3 && h.includes(t.replace(/s$/, '')));
  const hay = (r) => (r.number + ' ' + r.part).toLowerCase();
  let hits = all.filter((r) => { const h = hay(r); return tokens.every((t) => tok(t, h)); });
  if (!hits.length) hits = all.filter((r) => { const h = hay(r); return tokens.some((t) => tok(t, h)); });
  return hits;
}

// Items at/below the low-stock threshold, lowest first (for the morning brief).
async function lowStock(threshold = LOW_STOCK) {
  const all = await allInventory();
  return all.filter((r) => r.qty <= threshold).sort((a, b) => a.qty - b.qty);
}

// Rich snapshot for the morning brief: totals, out-of-stock, and the lowest items.
async function inventorySummary(lowThreshold = LOW_STOCK) {
  const all = await allInventory();
  const totalUnits = all.reduce((s, r) => s + r.qty, 0);
  const out = all.filter((r) => r.qty <= 0);
  const low = all.filter((r) => r.qty > 0 && r.qty <= lowThreshold).sort((a, b) => a.qty - b.qty);
  const top = [...all].sort((a, b) => b.qty - a.qty).slice(0, 5);
  return { skuCount: all.length, totalUnits, outCount: out.length, lowCount: low.length, low, top };
}

// Best-effort order activity. Returns null per-section if the FB user lacks
// Sales/Purchase Order rights (or the endpoint is unavailable) — never throws.
async function orderActivity() {
  const grab = async (path) => {
    try {
      const d = await get(`${path}?pageSize=200`);
      const rows = Array.isArray(d) ? d : (d.results || []);
      return { total: d && d.totalCount != null ? d.totalCount : rows.length, rows };
    } catch (e) { return null; }
  };
  return { sales: await grab('/api/sales-orders'), po: await grab('/api/purchase-orders') };
}

// --- WRITES (Phase 2: draft-first, human-approved) --------------------------
// Create a purchase order. Defaults to "Bid Request" = unissued draft, safe to
// review and void. Confirmed against the live API (PO #385 test).
//   vendor: { id, name }
//   items:  [{ part: { id, number }, quantity, unitCost }]
async function createPurchaseOrder({ vendor, items = [], status = 'Bid Request', number }) {
  const poItems = items.map((it) => {
    const qty = Number(it.quantity) || 0;
    const cost = Number(it.unitCost) || 0;
    return { part: it.part, quantity: String(qty), unitCost: String(cost), totalCost: String(qty * cost) };
  });
  const total = poItems.reduce((s, it) => s + Number(it.totalCost), 0);
  const body = { vendor, poItems, status, totalCost: String(total), totalIncludesTax: false, ...(number ? { number } : {}) };
  return req('POST', '/api/purchase-orders', body);
}
const deletePurchaseOrder = (id) => req('DELETE', `/api/purchase-orders/${id}`);
const findVendor = (term) => get(`/api/vendors?pageSize=10${term ? `&search=${encodeURIComponent(term)}` : ''}`);

module.exports = { ready, login, logout, start, req, get, APP, LOW_STOCK, allInventory, searchInventory, lowStock, inventorySummary, orderActivity, createPurchaseOrder, deletePurchaseOrder, findVendor };
