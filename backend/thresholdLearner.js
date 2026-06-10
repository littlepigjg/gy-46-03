import getDb from './db.js';
import {
  aggregateDimensionStats,
  computeAlertMetrics,
  buildScoreStats,
  calculateMean,
  calculateStdDev
} from './statsCalculator.js';
import {
  adjustAllThresholds,
  LEARNING_CONFIG
} from './thresholdStrategy.js';

const LEARNING_INTERVAL_COMPARISONS = 15;
const MAX_HISTORY_SAMPLES = 200;

function ensureThresholdStats(db, urlId) {
  let stats = db.prepare('SELECT * FROM threshold_stats WHERE url_id = ?').get(urlId);
  if (!stats) {
    db.prepare('INSERT INTO threshold_stats (url_id) VALUES (?)').run(urlId);
    stats = db.prepare('SELECT * FROM threshold_stats WHERE url_id = ?').get(urlId);
  }
  return stats;
}

function fetchLearningData(db, urlId) {
  const history = db.prepare(`
    SELECT * FROM diff_history
    WHERE url_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(urlId, MAX_HISTORY_SAMPLES);

  const realAlerts = db.prepare(`
    SELECT * FROM alerts
    WHERE url_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(urlId, MAX_HISTORY_SAMPLES);

  const falsePositiveAlerts = realAlerts.filter(a => a.is_false_positive === 1);
  const truePositiveAlerts = realAlerts.filter(a => a.is_false_positive === 0);

  return {
    history,
    realAlerts,
    falsePositiveAlerts,
    truePositiveAlerts
  };
}

function shouldLearnByInterval(db, urlId, forceTrigger, hasFalsePositiveMarked) {
  if (forceTrigger || hasFalsePositiveMarked) return true;

  const stats = ensureThresholdStats(db, urlId);
  if (stats.total_comparisons < LEARNING_CONFIG.MIN_HISTORY_FOR_ADJUSTMENT) {
    return false;
  }

  if (!stats.last_learned_at) return true;

  const recentComparisons = db.prepare(`
    SELECT COUNT(*) as cnt FROM diff_history
    WHERE url_id = ? AND created_at > ?
  `).get(urlId, stats.last_learned_at);

  return (recentComparisons.cnt || 0) >= LEARNING_INTERVAL_COMPARISONS;
}

function updateThresholdStats(db, urlId, { history, realAlerts, falsePositiveAlerts, dimStats }) {
  const overallScores = history.map(h => h.overall_score);
  const avgOverall = calculateMean(overallScores);
  const stdOverall = calculateStdDev(overallScores, avgOverall);

  db.prepare(`
    UPDATE threshold_stats SET
      total_comparisons = ?,
      alert_count = ?,
      false_positive_count = ?,
      avg_overall_score = ?,
      avg_layout_score = ?,
      avg_content_score = ?,
      avg_style_score = ?,
      std_overall_score = ?,
      last_learned_at = CURRENT_TIMESTAMP
    WHERE url_id = ?
  `).run(
    history.length,
    realAlerts.length,
    falsePositiveAlerts.length,
    avgOverall,
    dimStats.layout.mean,
    dimStats.content.mean,
    dimStats.style.mean,
    stdOverall,
    urlId
  );
}

function applyThresholdsToDb(db, urlId, newThresholds) {
  db.prepare(`
    UPDATE alert_rules SET
      overall_threshold = ?,
      layout_threshold = ?,
      content_threshold = ?,
      style_threshold = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE url_id = ?
  `).run(
    newThresholds.overall,
    newThresholds.layout,
    newThresholds.content,
    newThresholds.style,
    urlId
  );
}

export async function learnThresholdIfNeeded(urlId, options = {}) {
  const { forceTrigger = false, falsePositiveMarked = false } = options;

  const db = await getDb();
  const rule = db.prepare('SELECT * FROM alert_rules WHERE url_id = ?').get(urlId);

  if (!rule) {
    return { learned: false, reason: 'no_alert_rule' };
  }

  if (!rule.auto_learn && !forceTrigger) {
    return { learned: false, reason: 'auto_learn_disabled' };
  }

  if (!shouldLearnByInterval(db, urlId, forceTrigger, falsePositiveMarked)) {
    return { learned: false, reason: 'not_enough_data_or_interval' };
  }

  const { history, realAlerts, falsePositiveAlerts, truePositiveAlerts } =
    fetchLearningData(db, urlId);

  if (history.length < LEARNING_CONFIG.MIN_HISTORY_FOR_ADJUSTMENT) {
    return {
      learned: false,
      reason: `insufficient_history (${history.length}/${LEARNING_CONFIG.MIN_HISTORY_FOR_ADJUSTMENT})`
    };
  }

  const dimStats = aggregateDimensionStats(history);
  const metrics = computeAlertMetrics({
    allHistory: history,
    realAlerts,
    falsePositiveAlerts,
    rule
  });

  const falsePositiveScoresByDim = {
    overall: falsePositiveAlerts.map(a => a.overall_score),
    layout: falsePositiveAlerts.map(a => a.layout_score),
    content: falsePositiveAlerts.map(a => a.content_score),
    style: falsePositiveAlerts.map(a => a.style_score)
  };

  const allScoresByDim = {
    overall: history.map(h => h.overall_score),
    layout: history.map(h => h.layout_score),
    content: history.map(h => h.content_score),
    style: history.map(h => h.style_score)
  };

  const realAlertScoresByDim = {
    overall: truePositiveAlerts.map(a => a.overall_score),
    layout: truePositiveAlerts.map(a => a.layout_score),
    content: truePositiveAlerts.map(a => a.content_score),
    style: truePositiveAlerts.map(a => a.style_score)
  };

  const currentThresholds = {
    overall: rule.overall_threshold,
    layout: rule.layout_threshold,
    content: rule.content_threshold,
    style: rule.style_threshold
  };

  const adjustResult = adjustAllThresholds({
    currentThresholds,
    falsePositiveScoresByDim,
    allScoresByDim,
    realAlertScoresByDim,
    metrics
  });

  updateThresholdStats(db, urlId, {
    history,
    realAlerts,
    falsePositiveAlerts,
    dimStats
  });

  if (!adjustResult.adjusted) {
    return {
      learned: true,
      thresholdsAdjusted: false,
      metrics,
      stats: dimStats,
      reason: 'within_target_range'
    };
  }

  applyThresholdsToDb(db, urlId, adjustResult.thresholds);

  return {
    learned: true,
    thresholdsAdjusted: true,
    reasons: adjustResult.reasons,
    oldThresholds: currentThresholds,
    newThresholds: adjustResult.thresholds,
    metrics,
    stats: dimStats
  };
}

export async function getThresholdStats(urlId) {
  const db = await getDb();
  return ensureThresholdStats(db, urlId);
}

export async function resetLearning(urlId) {
  const db = await getDb();
  db.prepare(`
    UPDATE threshold_stats SET
      total_comparisons = 0,
      alert_count = 0,
      false_positive_count = 0,
      avg_overall_score = 0,
      avg_layout_score = 0,
      avg_content_score = 0,
      avg_style_score = 0,
      std_overall_score = 0,
      last_learned_at = NULL
    WHERE url_id = ?
  `).run(urlId);
  return getThresholdStats(urlId);
}

export default {
  learnThresholdIfNeeded,
  getThresholdStats,
  resetLearning,
  LEARNING_CONFIG,
  LEARNING_INTERVAL_COMPARISONS
};
