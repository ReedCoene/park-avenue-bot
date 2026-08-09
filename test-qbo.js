const qbo = require('./qbo');

(async () => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const janFirst = `${new Date().getFullYear()}-01-01`;

    console.log('--- Profit & Loss (YTD) ---');
    const pl = await qbo.getProfitAndLoss(janFirst, today);
    console.log('Report:', pl.Header?.ReportName, '|', pl.Header?.StartPeriod, 'to', pl.Header?.EndPeriod);
    pl.Rows?.Row?.slice(0, 8).forEach(r => {
      if (r.Summary) console.log(' ', r.Summary.ColData?.[0]?.value, ':', r.Summary.ColData?.[1]?.value);
    });

    console.log('\n--- Open Invoices (first 5) ---');
    const invoices = await qbo.getOpenInvoices();
    (invoices.Invoice || []).slice(0, 5).forEach(inv => {
      console.log(` SO#${inv.DocNumber} | ${inv.CustomerRef?.name} | $${inv.Balance} due ${inv.DueDate}`);
    });

    console.log('\n--- Recent Customers (first 5) ---');
    const customers = await qbo.getCustomers({ limit: 5 });
    (customers.Customer || []).forEach(c => console.log(` ${c.DisplayName} | Balance: $${c.Balance}`));

  } catch (err) {
    console.error('Error:', err.response?.status, err.response?.data || err.message);
  }
})();
