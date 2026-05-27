const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB = process.env.MONGODB_DB || 'zikr_tracker';

const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json());
app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/admin', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const makeId = () => crypto.randomBytes(6).toString('hex');
const makePid = () => crypto.randomBytes(8).toString('hex');

function newZikr({ title, phrase, intro, target, userTarget, capUserTarget, deadline }) {
  return {
    id: makeId(),
    title: title || 'ذكر جماعي',
    phrase: phrase || 'لا إله إلا الله',
    intro: intro || 'بسم الله الرحمن الرحيم. أهلاً بكم في الذكر الجماعي.',
    target: Math.max(0, Number(target) || 0),
    userTarget: Math.max(0, Number(userTarget) || 0),
    capUserTarget: !!capUserTarget,
    deadline: deadline || null,
    createdAt: new Date().toISOString(),
    archived: false,
    paused: false,
    contributions: []
  };
}

function defaultData() {
  const z = newZikr({
    title: 'ذكر التهليل',
    phrase: 'لا إله إلا الله',
    intro: 'بسم الله الرحمن الرحيم. هلمّوا إلى ذكر الله جماعةً.',
    target: 1000,
    deadline: null
  });
  return { zikrs: [z] };
}

function normalize(data) {
  if (data && Array.isArray(data.zikrs)) {
    for (const z of data.zikrs) {
      if (typeof z.paused !== 'boolean') z.paused = false;
      if (typeof z.archived !== 'boolean') z.archived = false;
      if (!Array.isArray(z.contributions)) z.contributions = [];
      if (!z.phrase) z.phrase = z.title || '';
      if (!z.title) z.title = 'ذكر';
      if (!z.intro) z.intro = '';
      if (typeof z.target !== 'number' || z.target < 0) z.target = 0;
      if (typeof z.userTarget !== 'number' || z.userTarget < 0) z.userTarget = 0;
      if (typeof z.capUserTarget !== 'boolean') z.capUserTarget = false;
    }
    return data;
  }
  return defaultData();
}

// === Storage backends ===

let store;
if (MONGODB_URI) {
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(MONGODB_URI);
  let collection;
  store = {
    async init() {
      await client.connect();
      collection = client.db(MONGODB_DB).collection('state');
      const existing = await collection.findOne({ _id: 'main' });
      if (!existing) {
        await collection.insertOne({ _id: 'main', ...defaultData() });
      }
      console.log(`Connected to MongoDB (db: ${MONGODB_DB})`);
    },
    async load() {
      const doc = await collection.findOne({ _id: 'main' });
      if (!doc) {
        const d = defaultData();
        await collection.insertOne({ _id: 'main', ...d });
        return d;
      }
      const { _id, ...data } = doc;
      const normalized = normalize(data);
      return normalized;
    },
    async save(data) {
      await collection.replaceOne(
        { _id: 'main' },
        { _id: 'main', ...data },
        { upsert: true }
      );
    }
  };
} else {
  store = {
    async init() {
      console.log(`Using local file storage: ${DATA_FILE}`);
    },
    async load() {
      if (!fs.existsSync(DATA_FILE)) {
        const d = defaultData();
        fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2), 'utf8');
        return d;
      }
      return normalize(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
    },
    async save(data) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    }
  };
}

function findZikr(data, id) {
  return data.zikrs.find(z => z.id === id);
}

function sumCount(z) {
  return z.contributions.reduce((s, c) => s + (Number(c.amount) || 0), 0);
}

function summarize(z) {
  return {
    id: z.id,
    title: z.title,
    phrase: z.phrase,
    target: z.target,
    userTarget: z.userTarget || 0,
    capUserTarget: !!z.capUserTarget,
    deadline: z.deadline,
    createdAt: z.createdAt,
    archived: z.archived,
    paused: z.paused,
    currentCount: sumCount(z),
    participantCount: new Set(z.contributions.map(c => c.name)).size,
    entryCount: z.contributions.length
  };
}

function publicZikr(z) {
  return {
    id: z.id,
    title: z.title,
    phrase: z.phrase,
    intro: z.intro,
    target: z.target,
    userTarget: z.userTarget || 0,
    capUserTarget: !!z.capUserTarget,
    deadline: z.deadline,
    createdAt: z.createdAt,
    archived: z.archived,
    paused: z.paused,
    currentCount: sumCount(z),
    contributions: z.contributions.map(c => ({
      id: c.id, participantId: c.participantId, name: c.name, amount: c.amount, at: c.at
    }))
  };
}

// === Public API ===

app.get('/api/zikrs', async (req, res) => {
  const data = await store.load();
  res.json(data.zikrs.map(summarize));
});

app.get('/api/zikr/:id', async (req, res) => {
  const data = await store.load();
  const z = findZikr(data, req.params.id);
  if (!z) return res.status(404).json({ error: 'الذكر غير موجود' });
  res.json(publicZikr(z));
});

app.post('/api/contribute', async (req, res) => {
  const { zikrId, participantId, name, amount } = req.body;
  const n = (name || '').trim();
  const amt = Math.trunc(Number(amount));
  if (!zikrId || !n) return res.status(400).json({ error: 'بيانات ناقصة' });
  if (!amt || isNaN(amt)) return res.status(400).json({ error: 'العدد غير صالح' });
  if (Math.abs(amt) > 1000000) return res.status(400).json({ error: 'العدد كبير جداً' });

  const data = await store.load();
  const z = findZikr(data, zikrId);
  if (!z) return res.status(404).json({ error: 'الذكر غير موجود' });
  if (z.archived) return res.status(400).json({ error: 'هذا الذكر مؤرشف' });
  if (z.paused) return res.status(400).json({ error: 'هذا الذكر متوقّف مؤقتاً' });

  const current = sumCount(z);
  if (current + amt < 0) {
    return res.status(400).json({ error: 'لا يمكن أن يكون العداد سالباً' });
  }

  const pid = participantId && String(participantId).match(/^[a-f0-9]{8,}$/i)
    ? String(participantId) : makePid();

  // Cap at user target (only blocks positive contributions; corrections are always allowed)
  if (z.capUserTarget && z.userTarget > 0 && amt > 0) {
    const userTotal = z.contributions
      .filter(c => c.participantId === pid || c.name.trim() === n)
      .reduce((s, c) => s + (Number(c.amount) || 0), 0);
    if (userTotal >= z.userTarget) {
      return res.status(400).json({ error: `أتممت هدفك الفردي (${z.userTarget}). جزاك الله خيراً` });
    }
    if (userTotal + amt > z.userTarget) {
      return res.status(400).json({
        error: `العدد يتجاوز هدفك الفردي. بقي لك ${z.userTarget - userTotal} فقط`
      });
    }
  }

  const entry = {
    id: makeId(),
    participantId: pid,
    name: n,
    amount: amt,
    at: new Date().toISOString()
  };
  z.contributions.push(entry);
  await store.save(data);
  res.json({
    ok: true,
    participantId: pid,
    zikr: publicZikr(z)
  });
});

// === Admin API (no auth) ===

app.post('/api/admin/zikr/create', async (req, res) => {
  const { title, phrase, intro, target, userTarget, capUserTarget, deadline } = req.body;
  const data = await store.load();
  const z = newZikr({ title, phrase, intro, target, userTarget, capUserTarget, deadline });
  data.zikrs.push(z);
  await store.save(data);
  res.json({ ok: true, id: z.id });
});

app.post('/api/admin/zikr/update', async (req, res) => {
  const { id, title, phrase, intro, target, userTarget, capUserTarget, deadline } = req.body;
  const data = await store.load();
  const z = findZikr(data, id);
  if (!z) return res.status(404).json({ error: 'الذكر غير موجود' });
  if (typeof title === 'string' && title.trim()) z.title = title.trim();
  if (typeof phrase === 'string' && phrase.trim()) z.phrase = phrase.trim();
  if (typeof intro === 'string') z.intro = intro;
  if (target !== undefined) {
    z.target = Math.max(0, Math.trunc(Number(target) || 0));
  }
  if (userTarget !== undefined) {
    z.userTarget = Math.max(0, Math.trunc(Number(userTarget) || 0));
  }
  if (typeof capUserTarget === 'boolean') z.capUserTarget = capUserTarget;
  if (deadline !== undefined) z.deadline = deadline || null;
  await store.save(data);
  res.json({ ok: true });
});

app.post('/api/admin/zikr/pause', async (req, res) => {
  const { id, paused } = req.body;
  const data = await store.load();
  const z = findZikr(data, id);
  if (!z) return res.status(404).json({ error: 'الذكر غير موجود' });
  z.paused = !!paused;
  await store.save(data);
  res.json({ ok: true });
});

app.post('/api/admin/zikr/archive', async (req, res) => {
  const { id, archived } = req.body;
  const data = await store.load();
  const z = findZikr(data, id);
  if (!z) return res.status(404).json({ error: 'الذكر غير موجود' });
  z.archived = !!archived;
  await store.save(data);
  res.json({ ok: true });
});

app.post('/api/admin/zikr/delete', async (req, res) => {
  const { id } = req.body;
  const data = await store.load();
  const i = data.zikrs.findIndex(z => z.id === id);
  if (i === -1) return res.status(404).json({ error: 'الذكر غير موجود' });
  data.zikrs.splice(i, 1);
  await store.save(data);
  res.json({ ok: true });
});

app.post('/api/admin/zikr/reset', async (req, res) => {
  const { id } = req.body;
  const data = await store.load();
  const z = findZikr(data, id);
  if (!z) return res.status(404).json({ error: 'الذكر غير موجود' });
  z.contributions = [];
  await store.save(data);
  res.json({ ok: true });
});

app.post('/api/admin/zikr/remove-participant', async (req, res) => {
  const { id, name } = req.body;
  const data = await store.load();
  const z = findZikr(data, id);
  if (!z) return res.status(404).json({ error: 'الذكر غير موجود' });
  const n = (name || '').trim();
  z.contributions = z.contributions.filter(c => c.name !== n);
  await store.save(data);
  res.json({ ok: true });
});

app.post('/api/admin/zikr/remove-entry', async (req, res) => {
  const { id, entryId } = req.body;
  const data = await store.load();
  const z = findZikr(data, id);
  if (!z) return res.status(404).json({ error: 'الذكر غير موجود' });
  z.contributions = z.contributions.filter(c => c.id !== entryId);
  await store.save(data);
  res.json({ ok: true });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'خطأ في الخادم' });
});

(async () => {
  await store.init();
  app.listen(PORT, () => {
    console.log(`Zikr Tracker running on http://localhost:${PORT}`);
  });
})();
