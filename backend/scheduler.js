import cron from 'node-cron';
import getDb from './db.js';
import { takeScreenshot } from './screenshot.js';

function shouldRunNow(frequency, lastRun) {
  if (!lastRun) return true;
  const now = new Date();
  const last = new Date(lastRun);
  const diff = now - last;

  switch (frequency) {
    case 'hourly':
      return diff >= 60 * 60 * 1000;
    case 'daily':
      return diff >= 24 * 60 * 60 * 1000;
    case 'weekly':
      return diff >= 7 * 24 * 60 * 60 * 1000;
    case 'monthly':
      return diff >= 30 * 24 * 60 * 60 * 1000;
    default:
      return true;
  }
}

async function runAllDueTasks() {
  console.log('[调度器] 检查待执行任务...');
  const db = await getDb();
  const urls = db.prepare('SELECT * FROM urls WHERE status = ?').all('active');

  for (const urlRecord of urls) {
    if (shouldRunNow(urlRecord.frequency, urlRecord.last_screenshot_at)) {
      console.log(`[调度器] 执行截图: ${urlRecord.url}`);
      try {
        await takeScreenshot(urlRecord);
        console.log(`[调度器] 截图完成: ${urlRecord.url}`);
      } catch (err) {
        console.error(`[调度器] 截图失败 [${urlRecord.url}]:`, err.message);
      }
    }
  }
}

export function startScheduler() {
  cron.schedule('*/5 * * * *', async () => {
    await runAllDueTasks();
  });

  console.log('[调度器] 定时任务已启动 (每5分钟检查一次)');

  setTimeout(() => {
    runAllDueTasks();
  }, 3000);
}

export async function triggerScreenshotNow(urlId) {
  const db = await getDb();
  const urlRecord = db.prepare('SELECT * FROM urls WHERE id = ?').get(urlId);
  if (!urlRecord) {
    throw new Error('URL不存在');
  }
  return await takeScreenshot(urlRecord);
}
