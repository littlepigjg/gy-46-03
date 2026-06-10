import getDb from './db.js';
import { dispatchNotifications } from './notificationService.js';

function ensureAlertRule(db, urlId) {
  let rule = db.prepare('SELECT * FROM alert_rules WHERE url_id = ?').get(urlId);
  if (!rule) {
    db.prepare('INSERT INTO alert_rules (url_id) VALUES (?)').run(urlId);
    rule = db.prepare('SELECT * FROM alert_rules WHERE url_id = ?').get(urlId);
  }
  return rule;
}

function recordDiffHistory(db, urlId, previousScreenshot, currentScreenshot, diffResult) {
  db.prepare(`
    INSERT INTO diff_history (
      url_id, screenshot_before_id, screenshot_after_id,
      overall_score, layout_score, content_score, style_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    urlId,
    previousScreenshot?.id || null,
    currentScreenshot.id,
    diffResult.scores.overall,
    diffResult.scores.layout,
    diffResult.scores.content,
    diffResult.scores.style
  );
}

function checkCooldown(db, urlId, cooldownMinutes) {
  const cooldownMs = cooldownMinutes * 60 * 1000;
  const lastAlert = db.prepare(`
    SELECT created_at FROM alerts
    WHERE url_id = ? AND is_false_positive = 0
    ORDER BY created_at DESC
    LIMIT 1
  `).get(urlId);

  if (!lastAlert) return true;

  const now = Date.now();
  const lastAlertTime = new Date(lastAlert.created_at).getTime();
  return (now - lastAlertTime) >= cooldownMs;
}

export async function processAlert(urlRecord, previousScreenshot, currentScreenshot, diffResult) {
  const db = await getDb();
  const urlId = urlRecord.id;

  const rule = ensureAlertRule(db, urlId);

  recordDiffHistory(db, urlId, previousScreenshot, currentScreenshot, diffResult);

  if (!rule.enabled) {
    return { alertCreated: false, reason: 'alert_rule_disabled' };
  }

  if (!diffResult.shouldAlert) {
    return { alertCreated: false, reason: 'below_threshold' };
  }

  const canAlert = checkCooldown(db, urlId, rule.cooldown_minutes);
  if (!canAlert) {
    return { alertCreated: false, reason: 'cooldown_active' };
  }

  const changeTypesJson = JSON.stringify(diffResult.changeTypes);
  const regionsJson = JSON.stringify(diffResult.regions);

  const insertResult = db.prepare(`
    INSERT INTO alerts (
      url_id, screenshot_before_id, screenshot_after_id,
      overall_score, layout_score, content_score, style_score,
      change_types, diff_regions
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    urlId,
    previousScreenshot?.id || null,
    currentScreenshot.id,
    diffResult.scores.overall,
    diffResult.scores.layout,
    diffResult.scores.content,
    diffResult.scores.style,
    changeTypesJson,
    regionsJson
  );

  const alertId = insertResult.lastInsertRowid;

  const alertRecordForNotify = {
    id: alertId,
    change_types: changeTypesJson,
    overall_score: diffResult.scores.overall,
    layout_score: diffResult.scores.layout,
    content_score: diffResult.scores.content,
    style_score: diffResult.scores.style
  };

  const channelsNotified = dispatchNotifications(db, alertRecordForNotify, urlRecord, rule);

  if (channelsNotified.length > 0) {
    db.prepare(`
      UPDATE alerts SET notified = 1, notification_channels = ? WHERE id = ?
    `).run(JSON.stringify(channelsNotified), alertId);
  }

  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId);

  return {
    alertCreated: true,
    alert,
    channelsNotified,
    scores: diffResult.scores,
    changeTypes: diffResult.changeTypes
  };
}

export async function getAlertRule(urlId) {
  const db = await getDb();
  return ensureAlertRule(db, urlId);
}

export async function updateAlertRule(urlId, updates) {
  const db = await getDb();
  ensureAlertRule(db, urlId);

  const allowedFields = [
    'enabled', 'overall_threshold', 'layout_threshold', 'content_threshold',
    'style_threshold', 'notify_in_app', 'notify_email', 'email_address',
    'cooldown_minutes', 'auto_learn'
  ];

  const sets = [];
  const params = [];
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      sets.push(`${field} = ?`);
      params.push(updates[field]);
    }
  }

  if (sets.length > 0) {
    sets.push('updated_at = CURRENT_TIMESTAMP');
    params.push(urlId);
    db.prepare(`UPDATE alert_rules SET ${sets.join(', ')} WHERE url_id = ?`).run(...params);
  }

  return getAlertRule(urlId);
}

export async function getAlerts(urlId = null, options = {}) {
  const db = await getDb();
  const { limit = 50, offset = 0, includeFalsePositive = true } = options;

  let sql = `
    SELECT a.*, u.name as url_name, u.url as url,
      sb.file_path as before_file_path,
      sa.file_path as after_file_path
    FROM alerts a
    JOIN urls u ON a.url_id = u.id
    LEFT JOIN screenshots sb ON a.screenshot_before_id = sb.id
    LEFT JOIN screenshots sa ON a.screenshot_after_id = sa.id
  `;

  const params = [];
  const conditions = [];

  if (urlId) {
    conditions.push('a.url_id = ?');
    params.push(urlId);
  }

  if (!includeFalsePositive) {
    conditions.push('a.is_false_positive = 0');
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const alerts = db.prepare(sql).all(...params);
  return alerts.map(a => {
    try { a.change_types = JSON.parse(a.change_types || '[]'); } catch { a.change_types = []; }
    try { a.diff_regions = JSON.parse(a.diff_regions || '[]'); } catch { a.diff_regions = []; }
    try { a.notification_channels = JSON.parse(a.notification_channels || '[]'); } catch { a.notification_channels = []; }
    return a;
  });
}

export async function getAlertStats(urlId = null) {
  const db = await getDb();
  const params = [];
  let whereClause = '';

  if (urlId) {
    whereClause = 'WHERE url_id = ?';
    params.push(urlId);
  }

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN is_false_positive = 1 THEN 1 ELSE 0 END) as false_positives,
      SUM(CASE WHEN notified = 1 THEN 1 ELSE 0 END) as notified_count,
      AVG(overall_score) as avg_overall_score,
      AVG(layout_score) as avg_layout_score,
      AVG(content_score) as avg_content_score,
      AVG(style_score) as avg_style_score
    FROM alerts
    ${whereClause}
  `).get(...params);

  return stats;
}

export async function markFalsePositive(alertId, isFalsePositive = true) {
  const db = await getDb();
  db.prepare('UPDATE alerts SET is_false_positive = ? WHERE id = ?')
    .run(isFalsePositive ? 1 : 0, alertId);
  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId);
  return {
    alert,
    shouldRelearn: true
  };
}

export async function getDiffHistory(urlId, limit = 30) {
  const db = await getDb();
  const history = db.prepare(`
    SELECT dh.*, sb.file_path as before_file_path, sa.file_path as after_file_path
    FROM diff_history dh
    LEFT JOIN screenshots sb ON dh.screenshot_before_id = sb.id
    LEFT JOIN screenshots sa ON dh.screenshot_after_id = sa.id
    WHERE dh.url_id = ?
    ORDER BY dh.created_at DESC
    LIMIT ?
  `).all(urlId, limit);
  return history;
}

export function getAlertWithScreenshots(db, alertId) {
  return db.prepare(`
    SELECT a.*, sb.file_path as before_file_path, sa.file_path as after_file_path
    FROM alerts a
    LEFT JOIN screenshots sb ON a.screenshot_before_id = sb.id
    LEFT JOIN screenshots sa ON a.screenshot_after_id = sa.id
    WHERE a.id = ?
  `).get(alertId);
}

export default {
  processAlert,
  getAlertRule,
  updateAlertRule,
  getAlerts,
  getAlertStats,
  markFalsePositive,
  getDiffHistory,
  getAlertWithScreenshots
};
