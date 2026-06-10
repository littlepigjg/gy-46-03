import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import getDb from './db.js';
import { startScheduler, triggerScreenshotNow } from './scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use('/screenshots', express.static(path.join(__dirname, 'screenshots')));

app.get('/api/urls', async (req, res) => {
  const db = await getDb();
  const urls = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM screenshots s WHERE s.url_id = u.id) as screenshot_count
    FROM urls u
    ORDER BY u.created_at DESC
  `).all();
  res.json(urls);
});

app.post('/api/urls', async (req, res) => {
  const { url, name, frequency = 'daily' } = req.body;

  if (!url || !name) {
    return res.status(400).json({ error: 'URL和名称必填' });
  }

  const validFrequencies = ['hourly', 'daily', 'weekly', 'monthly'];
  if (!validFrequencies.includes(frequency)) {
    return res.status(400).json({ error: '无效的频率' });
  }

  try {
    const db = await getDb();
    const stmt = db.prepare('INSERT INTO urls (url, name, frequency) VALUES (?, ?, ?)');
    const result = stmt.run(url, name, frequency);

    const newUrl = db.prepare('SELECT * FROM urls WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(newUrl);
  } catch (err) {
    if (err.message.includes('UNIQUE') || err.message.includes('unique')) {
      res.status(400).json({ error: '该URL已存在' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

app.delete('/api/urls/:id', async (req, res) => {
  const { id } = req.params;
  const db = await getDb();

  const screenshots = db.prepare('SELECT file_path FROM screenshots WHERE url_id = ?').all(id);
  screenshots.forEach(s => {
    if (fs.existsSync(s.file_path)) {
      fs.unlinkSync(s.file_path);
      const dir = path.dirname(s.file_path);
      try {
        if (fs.readdirSync(dir).length === 0) {
          fs.rmdirSync(dir);
        }
      } catch (e) {}
    }
  });

  db.prepare('DELETE FROM screenshots WHERE url_id = ?').run(id);
  const stmt = db.prepare('DELETE FROM urls WHERE id = ?');
  stmt.run(id);
  res.json({ success: true });
});

app.put('/api/urls/:id', async (req, res) => {
  const { id } = req.params;
  const { name, frequency, status } = req.body;
  const db = await getDb();

  const existing = db.prepare('SELECT * FROM urls WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'URL不存在' });
  }

  const finalName = name || existing.name;
  const finalFrequency = frequency || existing.frequency;
  const finalStatus = status || existing.status;

  const stmt = db.prepare('UPDATE urls SET name = ?, frequency = ?, status = ? WHERE id = ?');
  stmt.run(finalName, finalFrequency, finalStatus, id);

  const updated = db.prepare('SELECT * FROM urls WHERE id = ?').get(id);
  res.json(updated);
});

app.get('/api/urls/:id/screenshots', async (req, res) => {
  const { id } = req.params;
  const db = await getDb();
  const screenshots = db.prepare(`
    SELECT * FROM screenshots
    WHERE url_id = ?
    ORDER BY created_at DESC
  `).all(id);
  res.json(screenshots);
});

app.get('/api/screenshots/:id', async (req, res) => {
  const { id } = req.params;
  const db = await getDb();
  const screenshot = db.prepare('SELECT * FROM screenshots WHERE id = ?').get(id);
  if (!screenshot) {
    return res.status(404).json({ error: '截图不存在' });
  }
  res.json(screenshot);
});

app.delete('/api/screenshots/:id', async (req, res) => {
  const { id } = req.params;
  const db = await getDb();
  const screenshot = db.prepare('SELECT * FROM screenshots WHERE id = ?').get(id);
  if (!screenshot) {
    return res.status(404).json({ error: '截图不存在' });
  }

  if (fs.existsSync(screenshot.file_path)) {
    fs.unlinkSync(screenshot.file_path);
  }

  db.prepare('DELETE FROM screenshots WHERE id = ?').run(id);
  res.json({ success: true });
});

app.post('/api/urls/:id/screenshot', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await triggerScreenshotNow(parseInt(id));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/urls/:id', async (req, res) => {
  const { id } = req.params;
  const db = await getDb();
  const url = db.prepare('SELECT * FROM urls WHERE id = ?').get(id);
  if (!url) {
    return res.status(404).json({ error: 'URL不存在' });
  }
  res.json(url);
});

app.listen(PORT, async () => {
  console.log(`后端服务运行在 http://localhost:${PORT}`);
  await getDb();
  startScheduler();
});
