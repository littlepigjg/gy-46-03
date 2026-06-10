import {
  buildScoreStats,
  calculatePercentile
} from './statsCalculator.js';

const MIN_THRESHOLD = 0.01;
const MAX_THRESHOLD = 0.50;

const MAX_RELATIVE_INCREASE = 0.50;
const MAX_RELATIVE_DECREASE = 0.25;
const MIN_ABSOLUTE_STEP = 0.005;

const FALSE_POSITIVE_PERCENTILE = 0.85;
const NORMAL_VARIATION_PERCENTILE = 0.95;
const SAFETY_MARGIN = 0.005;

const MIN_FALSE_POSITIVES_FOR_ADJUSTMENT = 2;
const MIN_ALERTS_FOR_ADJUSTMENT = 5;
const MIN_HISTORY_FOR_ADJUSTMENT = 10;

const TARGET_ALERT_RATE_MIN = 0.05;
const TARGET_ALERT_RATE_MAX = 0.25;
const TARGET_FALSE_POSITIVE_RATE_MAX = 0.20;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothClamp(current, proposed, maxRelIncrease, maxRelDecrease, absMin, absMax) {
  if (proposed === current) return current;

  const minAllowed = Math.max(absMin, current * (1 - maxRelDecrease), current - MIN_ABSOLUTE_STEP);
  const maxAllowed = Math.min(absMax, current * (1 + maxRelIncrease), current + MIN_ABSOLUTE_STEP * 3);

  return clamp(proposed, minAllowed, maxAllowed);
}

function computeFromFalsePositives(falsePositiveScores, currentThreshold) {
  if (falsePositiveScores.length < MIN_FALSE_POSITIVES_FOR_ADJUSTMENT) {
    return null;
  }
  const sorted = [...falsePositiveScores].sort((a, b) => a - b);
  const pFp = calculatePercentile(sorted, FALSE_POSITIVE_PERCENTILE);
  return pFp + SAFETY_MARGIN;
}

function computeFromNormalVariation(allScores, currentThreshold) {
  if (allScores.length < MIN_HISTORY_FOR_ADJUSTMENT) {
    return null;
  }
  const stats = buildScoreStats(allScores);
  return stats.p95 + SAFETY_MARGIN;
}

export function adjustSingleDimension({
  dimension,
  currentThreshold,
  falsePositiveScores,
  allScores,
  realAlertScores,
  metrics
}) {
  let candidate = currentThreshold;
  const reasons = [];

  const fpSuggestion = computeFromFalsePositives(falsePositiveScores, currentThreshold);
  if (fpSuggestion !== null && fpSuggestion > currentThreshold) {
    candidate = Math.max(candidate, fpSuggestion);
    reasons.push(`${dimension}维度：基于${falsePositiveScores.length}次误报的P${FALSE_POSITIVE_PERCENTILE * 100}分位数+安全裕度`);
  }

  if (metrics.falsePositiveRate > TARGET_FALSE_POSITIVE_RATE_MAX) {
    if (realAlertScores.length >= MIN_ALERTS_FOR_ADJUSTMENT) {
      const alertStats = buildScoreStats(realAlertScores);
      const suggestedFromAlerts = alertStats.median + SAFETY_MARGIN;
      if (suggestedFromAlerts > candidate) {
        candidate = Math.max(candidate, suggestedFromAlerts);
        reasons.push(`${dimension}维度：误报率${(metrics.falsePositiveRate * 100).toFixed(0)}%过高，基于告警中位数调整`);
      }
    }
  }

  if (metrics.alertRate > TARGET_ALERT_RATE_MAX) {
    if (fpSuggestion !== null) {
      candidate = Math.max(candidate, fpSuggestion);
      reasons.push(`${dimension}维度：告警率${(metrics.alertRate * 100).toFixed(0)}%过高`);
    } else if (allScores.length >= MIN_HISTORY_FOR_ADJUSTMENT) {
      const normalSuggestion = computeFromNormalVariation(allScores, currentThreshold);
      if (normalSuggestion !== null && normalSuggestion > candidate) {
        candidate = Math.max(candidate, normalSuggestion);
        reasons.push(`${dimension}维度：告警率过高，基于正常变化P95调整`);
      }
    }
  }

  if (metrics.alertRate < TARGET_ALERT_RATE_MIN &&
      metrics.falsePositiveRate <= TARGET_FALSE_POSITIVE_RATE_MAX &&
      metrics.totalRealAlertCount >= MIN_ALERTS_FOR_ADJUSTMENT) {
    const alertStats = buildScoreStats(realAlertScores);
    const lowerBound = alertStats.p90;
    if (lowerBound < candidate * 0.8 && lowerBound > MIN_THRESHOLD) {
      candidate = lowerBound + SAFETY_MARGIN * 0.5;
      reasons.push(`${dimension}维度：告警率${(metrics.alertRate * 100).toFixed(1)}%过低且误报可控，适度降低`);
    }
  }

  const smoothed = smoothClamp(
    currentThreshold,
    candidate,
    MAX_RELATIVE_INCREASE,
    MAX_RELATIVE_DECREASE,
    MIN_THRESHOLD,
    MAX_THRESHOLD
  );

  if (Math.abs(smoothed - currentThreshold) < MIN_ABSOLUTE_STEP * 0.5) {
    return { adjusted: false, threshold: currentThreshold, reasons: [] };
  }

  return {
    adjusted: true,
    threshold: smoothed,
    reasons
  };
}

export function adjustAllThresholds({
  currentThresholds,
  falsePositiveScoresByDim,
  allScoresByDim,
  realAlertScoresByDim,
  metrics
}) {
  const dimensions = ['overall', 'layout', 'content', 'style'];
  const result = {};
  const allReasons = [];
  let anyAdjusted = false;

  for (const dim of dimensions) {
    const res = adjustSingleDimension({
      dimension: dim,
      currentThreshold: currentThresholds[dim],
      falsePositiveScores: falsePositiveScoresByDim[dim] || [],
      allScores: allScoresByDim[dim] || [],
      realAlertScores: realAlertScoresByDim[dim] || [],
      metrics
    });
    result[dim] = res.threshold;
    if (res.adjusted) {
      anyAdjusted = true;
      allReasons.push(...res.reasons);
      allReasons.push(
        `${dim}: ${(currentThresholds[dim] * 100).toFixed(1)}% → ${(res.threshold * 100).toFixed(1)}%`
      );
    }
  }

  return {
    adjusted: anyAdjusted,
    thresholds: result,
    reasons: allReasons
  };
}

export function shouldTriggerLearning({ stats, forceTrigger, falsePositiveMarked }) {
  if (forceTrigger) return true;
  if (falsePositiveMarked) return true;
  if (!stats) return false;
  if (stats.total_comparisons < MIN_HISTORY_FOR_ADJUSTMENT) return false;
  return true;
}

export const LEARNING_CONFIG = {
  MIN_THRESHOLD,
  MAX_THRESHOLD,
  MAX_RELATIVE_INCREASE,
  MAX_RELATIVE_DECREASE,
  MIN_ABSOLUTE_STEP,
  FALSE_POSITIVE_PERCENTILE,
  NORMAL_VARIATION_PERCENTILE,
  SAFETY_MARGIN,
  MIN_FALSE_POSITIVES_FOR_ADJUSTMENT,
  MIN_ALERTS_FOR_ADJUSTMENT,
  MIN_HISTORY_FOR_ADJUSTMENT,
  TARGET_ALERT_RATE_MIN,
  TARGET_ALERT_RATE_MAX,
  TARGET_FALSE_POSITIVE_RATE_MAX
};

export default {
  adjustSingleDimension,
  adjustAllThresholds,
  shouldTriggerLearning,
  LEARNING_CONFIG
};
