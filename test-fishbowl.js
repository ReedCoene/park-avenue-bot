const fb = require('./fishbowl');

(async () => {
  try {
    await fb.login();

    console.log('\n--- Parts (first 3) ---');
    const parts = await fb.getParts({ pageSize: 3 });
    console.log(JSON.stringify(parts, null, 2));

    console.log('\n--- Sales Orders (first 3) ---');
    const orders = await fb.getSalesOrders({ pageSize: 3 });
    console.log(JSON.stringify(orders, null, 2));

    await fb.logout();
    console.log('\nDone.');
  } catch (err) {
    console.error('Error:', err.response?.status, err.response?.data || err.message);
  }
})();
