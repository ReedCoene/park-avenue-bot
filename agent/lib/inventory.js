// Inventory cache: the permanent fix for Fishbowl's 12-seat license limit.
// Instead of logging into Fishbowl on every question (which competes for a seat),
// we sync a full snapshot ONCE every ~15 min (one brief login, seat released
// immediately) and answer ALL questions from this in-memory copy — zero seats
// between syncs. Self-healing: if every seat is busy at sync time, we keep the
// last good snapshot and retry, so the bot recovers on its own when a seat frees.
const fs = require('fs');
const path = require('path');
const fb = require('./fishbowl');

const CACHE_FILE = path.join(__dirname, '..', '.inventory-cache.json');
const SYNC_MS = Number(process.env.FB_SYNC_MS || 15 * 60 * 1000); // full re-sync interval (gentle: ONE login attempt per interval)

let cache = { items: [], at: 0 };
let syncing = false;

function load() { try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (e) {} }
function persist() { try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch (e) {} }

// One Fishbowl login → pull everything → release the seat. Returns true on success.
async function sync() {
  if (syncing) return false;
  syncing = true;
  try {
    const items = await fb.allInventory(); // single API call for all ~3,900 rows
    cache = { items, at: Date.now() };
    persist();
    console.log(`[inventory] synced ${items.length} items`);
    return true;
  } catch (e) {
    const where = cache.at ? `${ageMinutes()} min old` : 'no snapshot yet';
    console.error(`[inventory] sync failed (${e.message}); serving cache: ${where}`);
    return false;
  } finally {
    await fb.logout().catch(() => {}); // always free the seat, success or fail
    syncing = false;
  }
}

const ready = () => cache.items.length > 0;
const ageMinutes = () => (cache.at ? Math.round((Date.now() - cache.at) / 60000) : null);

// --- serve from cache (NO Fishbowl seat) ------------------------------------
function search(term) {
  const t = String(term || '').toLowerCase().trim();
  if (!t) return [];
  return cache.items.filter((r) =>
    String(r.part || '').toLowerCase().includes(t) || String(r.number || '').toLowerCase().includes(t));
}
function lowStock(threshold = fb.LOW_STOCK) {
  return cache.items.filter((r) => r.qty > 0 && r.qty <= threshold).sort((a, b) => a.qty - b.qty);
}
function summary(threshold = fb.LOW_STOCK) {
  const all = cache.items;
  const totalUnits = all.reduce((s, r) => s + r.qty, 0);
  const out = all.filter((r) => r.qty <= 0);
  const low = all.filter((r) => r.qty > 0 && r.qty <= threshold).sort((a, b) => a.qty - b.qty);
  const top = [...all].sort((a, b) => b.qty - a.qty).slice(0, 5);
  return { skuCount: all.length, totalUnits, outCount: out.length, lowCount: low.length, low, top, ageMinutes: ageMinutes() };
}

// Boot: load any persisted snapshot, sync now (retry until a seat frees if cold),
// then refresh on the regular interval forever.
function start() {
  if (!fb.ready()) { console.log('[inventory] Fishbowl not configured — cache disabled'); return; }
  load();
  const attempt = async () => { const ok = await sync(); if (!ok && !ready()) setTimeout(attempt, RETRY_MS); };
  attempt();
  const iv = setInterval(() => { sync(); }, SYNC_MS);
  if (iv.unref) iv.unref();
}

module.exports = { start, sync, ready, ageMinutes, search, lowStock, summary };
