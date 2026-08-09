// Probe the Fishbowl server to learn its API flavor + what it needs. Run: node probe-fishbowl.js
require('dotenv').config();
const net = require('net');
const crypto = require('crypto');

const host = process.env.FB_SERVER;
const port = Number(process.env.FB_PORT) || 3635;
const user = process.env.FB_USERNAME;
const pw = process.env.FB_PASSWORD;

console.log(`Probing Fishbowl at ${host}:${port} as "${user}"...`);

const md5b64 = crypto.createHash('md5').update(pw).digest('base64');
const login = { FbiJson: { Ticket: { Key: '' }, FbiMsgsRq: { LoginRq: {
  IAID: 1, IAName: 'OpsBot', IADescription: 'AI ops assistant', UserName: user, UserPassword: md5b64,
} } } };
const body = Buffer.from(JSON.stringify(login), 'utf8');
const len = Buffer.alloc(4); len.writeInt32BE(body.length, 0);

const chunks = [];
const sock = net.connect(port, host, () => {
  console.log('✅ TCP connection OPEN — server is reachable.');
  sock.write(Buffer.concat([len, body]));
});
sock.setTimeout(10000, () => { console.log('⏱️  no full response in 10s'); finish(); });
sock.on('data', (d) => { chunks.push(d); });
sock.on('error', (e) => { console.log(`❌ TCP ${e.code}: ${e.message}`); process.exit(0); });
sock.on('close', finish);

function finish() {
  const r = Buffer.concat(chunks);
  if (!r.length) { console.log('No bytes returned (port open but silent — may be REST/HTTPS or IP-restricted).'); process.exit(0); }
  console.log(`\n--- response (${r.length} bytes) ---`);
  console.log(r.toString('utf8').slice(4, 1200));
  process.exit(0);
}
