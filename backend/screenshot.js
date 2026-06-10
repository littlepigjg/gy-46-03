import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import getDb from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

let browser = null;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
  }
  return browser;
}

function sanitizeFilename(str) {
  return str.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
}

export async function takeScreenshot(urlRecord) {
  const { id, url, name } = urlRecord;
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');

  const urlDir = path.join(SCREENSHOTS_DIR, sanitizeFilename(name || url), dateStr);
  if (!fs.existsSync(urlDir)) {
    fs.mkdirSync(urlDir, { recursive: true });
  }

  const fileName = `${timeStr}.png`;
  const filePath = path.join(urlDir, fileName);

  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.screenshot({ path: filePath, fullPage: true });

    const db = await getDb();
    const insertStmt = db.prepare(`
      INSERT INTO screenshots (url_id, file_path, file_name, width, height)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = insertStmt.run(id, filePath, fileName, 1920, 1080);

    const updateStmt = db.prepare(`
      UPDATE urls SET last_screenshot_at = CURRENT_TIMESTAMP WHERE id = ?
    `);
    updateStmt.run(id);

    return {
      id: result.lastInsertRowid,
      file_path: filePath,
      file_name: fileName,
      created_at: now.toISOString()
    };
  } catch (error) {
    console.error(`截图失败 [${url}]:`, error.message);
    throw error;
  } finally {
    if (page) {
      await page.close().catch(console.error);
    }
  }
}

export { SCREENSHOTS_DIR };
