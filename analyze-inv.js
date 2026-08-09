const fs = require('fs');
const { parse } = require('csv-parse/sync');

const raw = fs.readFileSync('C:/Users/tpand/OneDrive/Documents/InvQtys.csv', 'utf8');
const rows = parse(raw, { columns: true, skip_empty_lines: true });

console.log('Total inventory rows:', rows.length);

const byLoc = {};
let totalValue = 0;
let zeroCount = 0;

rows.forEach(r => {
  const loc = r['Location'] || 'Unknown';
  const qty = parseFloat(r['Qty']) || 0;
  const cost = parseFloat(r['Cost']) || 0;
  byLoc[loc] = (byLoc[loc] || 0) + qty;
  totalValue += qty * cost;
  if (qty === 0) zeroCount++;
});

console.log('\nUnits by location:');
Object.entries(byLoc)
  .sort((a, b) => b[1] - a[1])
  .forEach(([l, q]) => console.log(`  ${l}: ${q.toLocaleString()} units`));

console.log(`\nTotal units: ${Object.values(byLoc).reduce((a,b) => a+b, 0).toLocaleString()}`);
console.log(`Estimated inventory value (at cost): $${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
console.log(`Items with zero qty: ${zeroCount}`);
