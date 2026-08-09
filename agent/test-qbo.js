// Proves the QuickBooks connection works (no Slack needed). Run: node test-qbo.js
const qbo = require('./lib/qbo');
(async () => {
  try {
    const c = await qbo.query('SELECT * FROM CompanyInfo MAXRESULTS 1');
    console.log('✅ Connected:', c.CompanyInfo?.[0]?.CompanyName);
    const inv = await qbo.getOpenInvoices();
    console.log('   Open invoices:', (inv.Invoice || []).length);
    console.log('\nQuickBooks is connected, from the cloud, with nothing installed on anyone\'s computer.');
  } catch (e) {
    console.error('❌ FAIL:', e.response?.data || e.message);
    console.error('   If "invalid_grant" -> re-run: node connect-qbo.js');
  }
})();
