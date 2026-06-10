import getDb from './db.js';

const MIN_SAMPLES_FOR_LEARNING = 10;
const LEARNING_INTERVAL_COMPARISONS = 20;
const FALSE_POSITIVE_RATE_THRESHOLD = 0.3;
const ALERT_RATE_TOO_HIGH = 0.5;
const ALERT_RATE_TOO_LOW = 0.05;
const THRESHOLD_ADJUSTMENT_STEP = 0.01;
const MIN_THRESHOLD = 0.01;
const MAX_THRESHOLD = 0.50;

function calculateStdDev(values, mean) {
  if (values.length === 0) return 0;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

function ensureThresholdStats(db, urlId) {
  let stats = db.prepare('SELECT * FROM threshold_stats WHERE url_id = ?').get(urlId);
  if (!stats) {
    db.prepare('INSERT INTO threshold_stats (url_id) VALUES (?)').run(urlId);
    stats = db.prepare('SELECT * FROM threshold_stats WHERE url_id = ?').get(urlId);
  }
  return stats;
}

function shouldLearn(db, urlId) {
  const stats = ensureThresholdStats(db, urlId);
  if (stats.total_comparisons < MIN_SAMPLES_FOR_LEARNING) return false;

  const lastLearned = stats.last_learned_at ? new Date(stats.last_learned_at) : null;
  if (!lastLearned) return true;

  const recentComparisons = db.prepare(`
    SELECT COUNT(*) as cnt FROM diff_history
    WHERE url_id = ? AND created_at > ?
  `).get(urlId, stats.last_learned_at);

  return (recentComparisons.cnt || 0) >= LEARNING_INTERVAL_COMPARISONS;
}

function getRule(db, urlId) {
  return db.prepare('SELECT * FROM alert_rules WHERE url_id = ?').get(urlId);
}

export async function learnThresholdIfNeeded(urlId) {
  const db = await getDb();
  const rule = getRule(db, urlId);

  if (!rule || !rule.auto_learn) {
    return { learned: false, reason: 'auto_learn_disabled' };
  }

  if (!shouldLearn(db, urlId)) {
    return { learned: false, reason: 'not_enough_data' };
  }

  const history = db.prepare(`
    SELECT dh.*, COALESCE(a.is_false_positive, 0) as is_false_positive
    FROM diff_history dh
    LEFT JOIN alerts a ON a.screenshot_before_id = dh.screenshot_before_id
      AND a.screenshot_after_id = dh.screenshot_after_id
      AND a.url_id = dh.url_id
    WHERE dh.url_id = ?
    ORDER BY dh.created_at DESC
    LIMIT 100
  `).all(urlId);

  if (history.length < MIN_SAMPLES_FOR_LEARNING) {
    return { learned: false, reason: 'insufficient_history' };
  }

  const overallScores = history.map(h => h.overall_score);
  const layoutScores = history.map(h => h.layout_score);
  const contentScores = history.map(h => h.content_score);
  const styleScores = history.map(h => h.style_score);

  const falsePositiveCount = history.filter(h => h.is_false_positive === 1).length;
  const alertCount = history.filter(h => {
    return h.overall_score > rule.overall_threshold ||
      h.layout_score > rule.layout_threshold ||
      h.content_score > rule.content_threshold ||
      h.style_score > rule.style_threshold;
  }).length;

  const falsePositiveRate = alertCount > 0 ? falsePositiveCount / alertCount : 0;
  const alertRate = history.length > 0 ? alertCount / history.length : 0;

  const avgOverall = overallScores.reduce((a, b) => a + b, 0) / overallScores.length;
  const avgLayout = layoutScores.reduce((a, b) => a + b, 0) / layoutScores.length;
  const avgContent = contentScores.reduce((a, b) => a + b, 0) / contentScores.length;
  const avgStyle = styleScores.reduce((a, b) => a + b, 0) / styleScores.length;

  const stdOverall = calculateStdDev(overallScores, avgOverall);
  const stdLayout = calculateStdDev(layoutScores, avgLayout);
  const stdContent = calculateStdDev(contentScores, avgContent);
  const stdStyle = calculateStdDev(styleScores, avgStyle);

  let newOverallThreshold = rule.overall_threshold;
  let newLayoutThreshold = rule.layout_threshold;
  let newContentThreshold = rule.content_threshold;
  let newStyleThreshold = rule.style_threshold;
  const adjustments = [];

  if (falsePositiveRate > FALSE_POSITIVE_RATE_THRESHOLD) {
    newOverallThreshold = Math.min(MAX_THRESHOLD, rule.overall_threshold + THRESHOLD_ADJUSTMENT_STEP * 3);
    newLayoutThreshold = Math.min(MAX_THRESHOLD, rule.layout_threshold + THRESHOLD_ADJUSTMENT_STEP * 2);
    newContentThreshold = Math.min(MAX_THRESHOLD, rule.content_threshold + THRESHOLD_ADJUSTMENT_STEP * 3);
    newStyleThreshold = Math.min(MAX_THRESHOLD, rule.style_threshold + THRESHOLD_ADJUSTMENT_STEP * 2);
    adjustments.push('误报率过高，整体提高阈值');
  } else if (alertRate > ALERT_RATE_TOO_HIGH) {
    newOverallThreshold = Math.min(MAX_THRESHOLD, rule.overall_threshold + THRESHOLD_ADJUSTMENT_STEP * 2);
    newLayoutThreshold = Math.min(MAX_THRESHOLD, rule.layout_threshold + THRESHOLD_ADJUSTMENT_STEP);
    newContentThreshold = Math.min(MAX_THRESHOLD, rule.content_threshold + THRESHOLD_ADJUSTMENT_STEP * 2);
    newStyleThreshold = Math.min(MAX_THRESHOLD, rule.style_threshold + THRESHOLD_ADJUSTMENT_STEP);
    adjustments.push('告警过于频繁，适度提高阈值');
  } else if (alertRate < ALERT_RATE_TOO_LOW && avgOverall > rule.overall_threshold * 0.3) {
    const suggestedOverall = Math.max(MIN_THRESHOLD, avgOverall + stdOverall * 1.5);
    if (suggestedOverall < rule.overall_threshold * 0.7) {
      newOverallThreshold = Math.max(MIN_THRESHOLD, rule.overall_threshold - THRESHOLD_ADJUSTMENT_STEP);
      newLayoutThreshold = Math.max(MIN_THRESHOLD, rule.layout_threshold - THRESHOLD_ADJUSTMENT_STEP * 0.5);
      newContentThreshold = Math.max(MIN_THRESHOLD, rule.content_threshold - THRESHOLD_ADJUSTMENT_STEP);
      newStyleThreshold = Math.max(MIN_THRESHOLD, rule.style_threshold - THRESHOLD_ADJUSTMENT_STEP * 0.5);
      adjustments.push('告警过少且变化度较低，适度降低阈值');
    }
  }

  if (avgOverall + stdOverall * 2 > 0 && avgOverall + stdOverall * 2 < newOverallThreshold * 0.5) {
    const suggested = Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, avgOverall + stdOverall * 2));
    if (Math.abs(suggested - newOverallThreshold) > THRESHOLD_ADJUSTMENT_STEP * 2) {
      newOverallThreshold = suggested;
      adjustments.push(`基于统计分布调整总体阈值至 ${(suggested * 100).toFixed(1)}%`);
    }
  }

  if (adjustments.length === 0) {
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
      alertCount,
      falsePositiveCount,
      avgOverall,
      avgLayout,
      avgContent,
      avgStyle,
      stdOverall,
      urlId
    );

    return {
      learned: true,
      thresholdsAdjusted: false,
      stats: {
        totalSamples: history.length,
        alertRate,
        falsePositiveRate,
        avgOverall,
        stdOverall
      }
    };
  }

  db.prepare(`
    UPDATE alert_rules SET
      overall_threshold = ?,
      layout_threshold = ?,
      content_threshold = ?,
      style_threshold = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE url_id = ?
  `).run(
    newOverallThreshold,
    newLayoutThreshold,
    newContentThreshold,
    newStyleThreshold,
    urlId
  );

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
    alertCount,
    falsePositiveCount,
    avgOverall,
    avgLayout,
    avgContent,
    avgStyle,
    stdOverall,
    urlId
  );

  return {
    learned: true,
    thresholdsAdjusted: true,
    adjustments,
    oldThresholds: {
      overall: rule.overall_threshold,
      layout: rule.layout_threshold,
      content: rule.content_threshold,
      style: rule.style_threshold
    },
    newThresholds: {
      overall: newOverallThreshold,
      layout: newLayoutThreshold,
      content: newContentThreshold,
      style: newStyleThreshold
    },
    stats: {
      totalSamples: history.length,
      alertRate,
      falsePositiveRate,
      avgOverall,
      stdOverall
    }
  };
}

export async function getThresholdStats(urlId) {
  const db = await getDb();
  const stats = ensureThresholdStats(db, urlId);
  return stats;
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
  resetLearning
};
