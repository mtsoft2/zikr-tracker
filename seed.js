const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, 'data.json');
const TARGET_ZIKR_ID = process.argv[2] || '4fbb7a1bea39'; // التكبير by default

const makeId = () => crypto.randomBytes(6).toString('hex');
const makePid = () => crypto.randomBytes(8).toString('hex');

// 20 Arabic mockup contributors with varied contributions.
// Each person has an array of chunks they contributed (positive = add, negative = correction).
const PEOPLE = [
  { name: 'أحمد',       chunks: [500, 300, 200] },           // 1000 — finisher
  { name: 'محمد',       chunks: [1000, 500] },               // 1500
  { name: 'فاطمة',      chunks: [400, 400] },                // 800
  { name: 'عائشة',      chunks: [500, 700] },                // 1200
  { name: 'علي',         chunks: [300, 200, 200] },           // 700
  { name: 'خديجة',      chunks: [200, 250] },                // 450
  { name: 'عمر',         chunks: [500, 500, -50] },           // 950
  { name: 'مريم',        chunks: [600, 500] },                // 1100
  { name: 'يوسف',       chunks: [300, 300] },                // 600
  { name: 'زينب',        chunks: [100, 233] },                // 333
  { name: 'حسن',         chunks: [400, 450] },                // 850
  { name: 'سارة',        chunks: [200] },                     // 200
  { name: 'إبراهيم',    chunks: [500, 500] },                // 1000 — finisher
  { name: 'هاجر',        chunks: [555] },                     // 555
  { name: 'صفية',        chunks: [50, 50] },                  // 100
  { name: 'خالد',        chunks: [333, 333] },                // 666
  { name: 'أسماء',       chunks: [999] },                     // 999
  { name: 'عبد الله',   chunks: [800, 500] },                // 1300
  { name: 'رقية',         chunks: [200, 200] },                // 400
  { name: 'بلال',         chunks: [75] }                       // 75
];

const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const z = data.zikrs.find(x => x.id === TARGET_ZIKR_ID);
if (!z) {
  console.error('Zikr not found:', TARGET_ZIKR_ID);
  process.exit(1);
}

// Start timeline at the zikr's createdAt, advance every entry by ~2-4 minutes.
let cursor = new Date(z.createdAt).getTime() + 60_000;
const step = () => { cursor += 60_000 + Math.floor(Math.random() * 180_000); return new Date(cursor).toISOString(); };

let added = 0;
for (const p of PEOPLE) {
  const pid = makePid();
  for (const amount of p.chunks) {
    z.contributions.push({
      id: makeId(),
      participantId: pid,
      name: p.name,
      amount,
      at: step()
    });
    added++;
  }
}

fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
const total = z.contributions.reduce((s, c) => s + (Number(c.amount) || 0), 0);
console.log(`Added ${added} entries from ${PEOPLE.length} contributors to "${z.title}"`);
console.log(`New total: ${total} / ${z.target} (user target: ${z.userTarget || 0})`);
