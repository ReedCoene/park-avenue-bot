// Proves Fishbowl connection (run AFTER approving "OpsBot" in the Fishbowl client). node test-fishbowl.js
const fb = require('./lib/fishbowl');
(async () => {
  try {
    const t = await fb.login();
    console.log('✅ Fishbowl connected. token:', String(t).slice(0, 14) + '…');
    for (const p of ['/api/parts?pageSize=1', '/api/products?pageSize=1', '/api/inventory?pageSize=1']) {
      try { console.log(p, '->', JSON.stringify(await fb.get(p)).slice(0, 220)); }
      catch (e) { console.log(p, 'ERR', e.message); }
    }
  } catch (e) {
    console.error('❌', e.message);
    if (/approve|integrated/i.test(e.message)) console.error('   → Approve "OpsBot" in the Fishbowl client (admin), then re-run.');
  }
})();
