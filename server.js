import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import morgan from 'morgan';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const VERSIONS_DIR = path.join(DATA_DIR, 'versions');
const TRASH_DIR = path.join(DATA_DIR, 'trash');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

ensureDir(DATA_DIR);
ensureDir(VERSIONS_DIR);
ensureDir(TRASH_DIR);

app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Helpers
const readFileAsync = (p) => fs.promises.readFile(p, 'utf-8');
const writeFileAsync = (p, data) => fs.promises.writeFile(p, data, 'utf-8');
const statAsync = (p) => fs.promises.stat(p);
const renameAsync = (a, b) => fs.promises.rename(a, b);
const readdirAsync = (p) => fs.promises.readdir(p);

function generateId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${rand}`;
}

function normalizeLink(raw) {
  if (typeof raw !== 'string') return undefined;
  const val = raw.trim();
  if (!val) return undefined;
  if (/^https?:\/\//i.test(val)) return val;
  return `https://${val}`;
}

function wishlistPath(id) {
  return path.join(DATA_DIR, `${id}.json`);
}

function wishlistVersionsDir(id) {
  const dir = path.join(VERSIONS_DIR, id);
  ensureDir(dir);
  return dir;
}

async function saveVersionIfExists(id) {
  const file = wishlistPath(id);
  if (fs.existsSync(file)) {
    const versionsDir = wishlistVersionsDir(id);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const versionFile = path.join(versionsDir, `${id}-${timestamp}.json`);
    await renameAsync(file, versionFile);

    // keep only 5 latest versions (by mtime desc)
    const files = (await readdirAsync(versionsDir))
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.join(versionsDir, f));
    const withTimes = await Promise.all(
      files.map(async (f) => ({ f, mtime: (await statAsync(f)).mtimeMs }))
    );
    withTimes.sort((a, b) => b.mtime - a.mtime);
    const toDelete = withTimes.slice(5);
    await Promise.all(toDelete.map(({ f }) => fs.promises.unlink(f)));
  }
}

// API
// List wishlists (ids and titles)
app.get('/api/wishlists', async (req, res) => {
  try {
    const files = (await readdirAsync(DATA_DIR)).filter((f) => f.endsWith('.json'));
    const list = [];
    for (const f of files) {
      const id = path.basename(f, '.json');
      try {
        const raw = await readFileAsync(path.join(DATA_DIR, f));
        const json = JSON.parse(raw);
        list.push({ id, title: json.title || id, updatedAt: json.updatedAt });
      } catch {
        list.push({ id, title: id });
      }
    }
    res.json(list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')));
  } catch (e) {
    res.status(500).json({ error: 'Failed to list wishlists' });
  }
});

// Create new or update existing wishlist
app.post('/api/wishlists', async (req, res) => {
  try {
    const { id: bodyId, title, items } = req.body || {};
    const id = bodyId || generateId();

    await saveVersionIfExists(id);

    const payload = {
      id,
      title: title || 'Новый вишлист',
      items: Array.isArray(items) ? items : [],
      updatedAt: new Date().toISOString()
    };
    await writeFileAsync(wishlistPath(id), JSON.stringify(payload, null, 2));
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: 'Failed to save wishlist' });
  }
});

// Get wishlist by id
app.get('/api/wishlists/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const p = wishlistPath(id);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Not found' });
    const raw = await readFileAsync(p);
    res.json(JSON.parse(raw));
  } catch (e) {
    res.status(500).json({ error: 'Failed to read wishlist' });
  }
});

// Add item
app.post('/api/wishlists/:id/items', async (req, res) => {
  try {
    const id = req.params.id;
    const { text, link } = req.body || {};
    if (!text || !text.trim()) return res.status(400).json({ error: 'Text required' });
    const p = wishlistPath(id);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Not found' });

    const raw = await readFileAsync(p);
    const data = JSON.parse(raw);

    await saveVersionIfExists(id);

    const itemId = generateId();
    const sanitizedLink = normalizeLink(link);
    const newItem = { id: itemId, text: text.trim(), status: 'free', ...(sanitizedLink ? { link: sanitizedLink } : {}) };
    data.items.push(newItem);
    data.updatedAt = new Date().toISOString();
    await writeFileAsync(p, JSON.stringify(data, null, 2));
    res.json(newItem);
  } catch (e) {
    res.status(500).json({ error: 'Failed to add item' });
  }
});

// Update item (text or status: take/release)
app.patch('/api/wishlists/:id/items/:itemId', async (req, res) => {
  try {
    const { id, itemId } = req.params;
    const { text, action, name, link } = req.body || {};
    const p = wishlistPath(id);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Not found' });
    const raw = await readFileAsync(p);
    const data = JSON.parse(raw);
    const idx = data.items.findIndex((i) => i.id === itemId);
    if (idx === -1) return res.status(404).json({ error: 'Item not found' });

    await saveVersionIfExists(id);

    if (typeof text === 'string') {
      data.items[idx].text = text;
    }
    if (link !== undefined) {
      const sanitizedLink = normalizeLink(link);
      if (sanitizedLink) data.items[idx].link = sanitizedLink; else delete data.items[idx].link;
    }
    if (action === 'take') {
      data.items[idx].status = 'taken';
      data.items[idx].takenBy = name || '';
      data.items[idx].takenAt = new Date().toISOString();
    } else if (action === 'release') {
      data.items[idx].status = 'free';
      delete data.items[idx].takenBy;
      delete data.items[idx].takenAt;
    }
    data.updatedAt = new Date().toISOString();
    await writeFileAsync(p, JSON.stringify(data, null, 2));
    res.json(data.items[idx]);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update item' });
  }
});

// Rename wishlist
app.patch('/api/wishlists/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title } = req.body || {};
    const p = wishlistPath(id);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Not found' });
    const raw = await readFileAsync(p);
    const data = JSON.parse(raw);

    await saveVersionIfExists(id);

    if (typeof title === 'string') data.title = title;
    data.updatedAt = new Date().toISOString();
    await writeFileAsync(p, JSON.stringify(data, null, 2));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update wishlist' });
  }
});

// List versions
app.get('/api/wishlists/:id/versions', async (req, res) => {
  try {
    const id = req.params.id;
    const dir = wishlistVersionsDir(id);
    const files = (await readdirAsync(dir)).filter((f) => f.endsWith('.json'));
    const withTimes = await Promise.all(
      files.map(async (f) => {
        const full = path.join(dir, f);
        const st = await statAsync(full);
        return { file: f, mtime: st.mtime.toISOString() };
      })
    );
    withTimes.sort((a, b) => b.mtime.localeCompare(a.mtime));
    res.json(withTimes);
  } catch (e) {
    res.json([]);
  }
});

// Restore from version
app.post('/api/wishlists/:id/restore', async (req, res) => {
  try {
    const id = req.params.id;
    const { file } = req.body || {};
    if (!file) return res.status(400).json({ error: 'Version file required' });
    const dir = wishlistVersionsDir(id);
    const source = path.join(dir, file);
    if (!fs.existsSync(source)) return res.status(404).json({ error: 'Version not found' });

    // Move current to versions, move version to active
    await saveVersionIfExists(id);
    const target = wishlistPath(id);
    const content = await readFileAsync(source);
    await writeFileAsync(target, content);
    res.json(JSON.parse(content));
  } catch (e) {
    res.status(500).json({ error: 'Failed to restore version' });
  }
});

// Delete wishlist -> move to trash
app.delete('/api/wishlists/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const p = wishlistPath(id);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Not found' });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const trashFile = path.join(TRASH_DIR, `${id}-${timestamp}.json`);
    await renameAsync(p, trashFile);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete wishlist' });
  }
});

// List trash
app.get('/api/trash', async (req, res) => {
  try {
    const files = (await readdirAsync(TRASH_DIR)).filter((f) => f.endsWith('.json'));
    const items = [];
    for (const f of files) {
      const full = path.join(TRASH_DIR, f);
      try {
        const raw = await readFileAsync(full);
        const json = JSON.parse(raw);
        items.push({ file: f, id: json.id || null, title: json.title || f, deletedAt: (await statAsync(full)).mtime.toISOString() });
      } catch {
        items.push({ file: f, id: null, title: f, deletedAt: (await statAsync(full)).mtime.toISOString() });
      }
    }
    items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: 'Failed to list trash' });
  }
});

// Restore from trash
app.post('/api/trash/:file/restore', async (req, res) => {
  try {
    const file = req.params.file;
    const source = path.join(TRASH_DIR, file);
    if (!fs.existsSync(source)) return res.status(404).json({ error: 'Not found' });
    const content = await readFileAsync(source);
    const json = JSON.parse(content);
    const id = json.id || generateId();
    const target = wishlistPath(id);
    if (fs.existsSync(target)) {
      // If exists, generate new id to avoid overwrite
      json.id = generateId();
    }
    json.updatedAt = new Date().toISOString();
    await writeFileAsync(wishlistPath(json.id), JSON.stringify(json, null, 2));
    await fs.promises.unlink(source);
    res.json(json);
  } catch (e) {
    res.status(500).json({ error: 'Failed to restore from trash' });
  }
});

// Permanently delete from trash
app.delete('/api/trash/:file', async (req, res) => {
  try {
    const file = req.params.file;
    const p = path.join(TRASH_DIR, file);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Not found' });
    await fs.promises.unlink(p);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to remove from trash' });
  }
});

app.listen(PORT, () => {
  console.log(`Wishlist app running on http://localhost:${PORT}`);
});


