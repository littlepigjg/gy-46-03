import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import getDb from './db.js';
import { compareImages } from './imageDiff.js';
import { processAlert, getAlertRule } from './alertService.js';
import { learnThresholdIfNeeded } from './thresholdLearner.js';

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
    const newScreenshotId = result.lastInsertRowid;

    const updateStmt = db.prepare(`
      UPDATE urls SET last_screenshot_at = CURRENT_TIMESTAMP WHERE id = ?
    `);
    updateStmt.run(id);

    const currentScreenshot = {
      id: newScreenshotId,
      file_path: filePath,
      file_name: fileName,
      created_at: now.toISOString()
    };

    const previousScreenshot = db.prepare(`
      SELECT * FROM screenshots
      WHERE url_id = ? AND id < ?
      ORDER BY id DESC
      LIMIT 1
    `).get(id, newScreenshotId);

    let diffResult = null;
    let alertResult = null;

    if (previousScreenshot && fs.existsSync(previousScreenshot.file_path)) {
      try {
        const rule = await getAlertRule(id);
        const thresholds = {
          overall_threshold: rule.overall_threshold,
          layout_threshold: rule.layout_threshold,
          content_threshold: rule.content_threshold,
          style_threshold: rule.style_threshold
        };

        diffResult = await compareImages(
          previousScreenshot.file_path,
          filePath,
          thresholds
        );

        alertResult = await processAlert(
          urlRecord,
          previousScreenshot,
          currentScreenshot,
          diffResult
        );

        if (alertResult.alertCreated) {
          console.log(`[告警] ${urlRecord.name}: 检测到变化 (总体差异 ${(diffResult.scores.overall * 100).toFixed(1)}%)`);
        }

        try {
          const learnResult = await learnThresholdIfNeeded(id);
          if (learnResult.learned && learnResult.thresholdsAdjusted) {
            console.log(`[学习] ${urlRecord.name}: 阈值已自动调整`, learnResult.adjustments);
          }
        } catch (learnErr) {
          console.error('[学习] 阈值学习失败:', learnErr.message);
        }
      } catch (diffErr) {
        console.error(`[差异检测] ${urlRecord.name} 对比失败:`, diffErr.message);
      }
    }

    return {
      id: newScreenshotId,
      file_path: filePath,
      file_name: fileName,
      created_at: now.toISOString(),
      diff: diffResult,
      alert: alertResult
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
