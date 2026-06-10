import {
  buildScoreStats,
  calculatePercentile,
  calculateTheoreticalAlertRate,
  backtestThreshold
} from './statsCalculator.js';

const MIN_THRESHOLD = 0.01;
const MAX_THRESHOLD = 0.50;

const MAX_RELATIVE_INCREASE = 0.40;
const MAX_RELATIVE_DECREASE = 0.20;
const MIN_ABSOLUTE_STEP = 0.003;
const MIN_ADJUSTMENT_THRESHOLD = 0.0015;

const FP_P_LOW = 0.50;
const FP_P_MID = 0.75;
const FP_P_HIGH = 0.90;
const SAFETY_MARGIN_BASE = 0.003;

const MIN_FALSE_POSITIVES_FOR_STRONG = 3;
const MIN_ALERTS_FOR_ADJUSTMENT = 3;
const MIN_HISTORY_FOR_ADJUSTMENT = 8;

const TARGET_ALERT_RATE_MIN = 0.03;
const TARGET_ALERT_RATE_MAX = 0.20;
const TARGET_FALSE_POSITIVE_RATE_MAX = 0.15;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothClamp(current, proposed, absMin, absMax) {
  if (proposed === current) return current;

  const minAllowed = Math.max(absMin, current * (1 - MAX_RELATIVE_DECREASE), current - MIN_ABSOLUTE_STEP);
  const maxAllowed = Math.min(absMax, current * (1 + MAX_RELATIVE_INCREASE), current + MIN_ABSOLUTE_STEP * 4);

  return clamp(proposed, minAllowed, maxAllowed);
}

function minAdjustmentReached(current, proposed) {
  return Math.abs(proposed - current) >= MIN_ADJUSTMENT_THRESHOLD;
}

function computeSuggestionFromFalsePositives(falsePositiveScores) {
  if (falsePositiveScores.length === 0) return null;
  const sorted = [...falsePositiveScores].sort((a, b) => a - b);

  if (falsePositiveScores.length >= MIN_FALSE_POSITIVES_FOR_STRONG) {
    const pHigh = calculatePercentile(sorted, FP_P_HIGH);
    const margin = SAFETY_MARGIN_BASE * 2;
    return {
      value: pHigh + margin,
      confidence: 'strong',
      source: `P${FP_P_HIGH * 100}分位数+安全裕度`
    };
  }

  if (falsePositiveScores.length === 2) {
    const pMid = calculatePercentile(sorted, FP_P_MID);
    return {
      value: pMid + SAFETY_MARGIN_BASE * 1.5,
      confidence: 'medium',
      source: `P${FP_P_MID * 100}分位数+安全裕度`
    };
  }

  const pLow = calculatePercentile(sorted, FP_P_LOW);
  return {
    value: pLow + SAFETY_MARGIN_BASE,
    confidence: 'weak',
    source: `P${FP_P_LOW * 100}分位数+安全裕度(仅${falsePositiveScores.length}个样本)`
  };
}

function computeSuggestionFromAllScores(allScores) {
  if (allScores.length < MIN_HISTORY_FOR_ADJUSTMENT) return null;
  const stats = buildScoreStats(allScores);
  return {
    value: stats.p90 + SAFETY_MARGIN_BASE,
    confidence: allScores.length >= 30 ? 'strong' : 'medium',
    source: `全体P90+安全裕度(${allScores.length}样本)`
  };
}

function computeSuggestionFromTruePositives(realAlertScores) {
  if (realAlertScores.length < MIN_ALERTS_FOR_ADJUSTMENT) return null;
  const stats = buildScoreStats(realAlertScores);
  return {
    value: Math.max(MIN_THRESHOLD, stats.p10 - SAFETY_MARGIN_BASE),
    confidence: realAlertScores.length >= 10 ? 'medium' : 'weak',
    source: `真实告警P10-安全裕度(${realAlertScores.length}样本)`
  };
}

export function adjustSingleDimension({
  dimension,
  currentThreshold,
  falsePositiveScores = [],
  allScores = [],
  realAlertScores = [],
  metrics
}) {
  let candidate = currentThreshold;
  const reasons = [];
  const warnings = [];

  const fpSuggestion = computeSuggestionFromFalsePositives(falsePositiveScores);
  const allSuggestion = computeSuggestionFromAllScores(allScores);
  const tpSuggestion = computeSuggestionFromTruePositives(realAlertScores);

  const effectiveAlertRate = metrics?.effectiveAlertRate ?? metrics?.alertRate ?? 0;
  const fpRate = metrics?.falsePositiveRate ?? 0;
  const totalRealAlerts = metrics?.totalRealAlertCount ?? 0;

  if (fpSuggestion) {
    if (fpSuggestion.value > candidate) {
      const old = candidate;
      candidate = Math.max(candidate, fpSuggestion.value);
      reasons.push(`${dimension}维：基于${falsePositiveScores.length}次误报(${fpSuggestion.source})，需要提高`);
      if (fpSuggestion.confidence === 'weak') {
        warnings.push(`${dimension}维：误报样本少(${falsePositiveScores.length})，建议继续观察`);
      }
    } else if (fpRate > TARGET_FALSE_POSITIVE_RATE_MAX && fpSuggestion.value > candidate * 0.9) {
      candidate = Math.max(candidate, fpSuggestion.value);
      reasons.push(`${dimension}维：误报率${(fpRate * 100).toFixed(0)}%超标，即使误报分数偏低也采用建议值`);
    }
  }

  if (fpRate > TARGET_FALSE_POSITIVE_RATE_MAX) {
    if (realAlertScores.length >= MIN_ALERTS_FOR_ADJUSTMENT) {
      const alertStats = buildScoreStats(realAlertScores);
      const suggestedFromAlerts = alertStats.p75 + SAFETY_MARGIN_BASE * 2;
      if (suggestedFromAlerts > candidate) {
        candidate = Math.max(candidate, suggestedFromAlerts);
        reasons.push(`${dimension}维：误报率过高，基于告警分布P75提升`);
      }
    } else if (allSuggestion && allSuggestion.value > candidate) {
      candidate = Math.max(candidate, allSuggestion.value);
      reasons.push(`${dimension}维：误报率过高，基于全体分布P90提升`);
    }
  }

  if (effectiveAlertRate > TARGET_ALERT_RATE_MAX) {
    if (fpSuggestion && fpSuggestion.value > candidate) {
      candidate = Math.max(candidate, fpSuggestion.value);
      reasons.push(`${dimension}维：告警率${(effectiveAlertRate * 100).toFixed(0)}%过高，优先采用误报建议`);
    } else if (allSuggestion && allSuggestion.value > candidate) {
      candidate = Math.max(candidate, allSuggestion.value);
      reasons.push(`${dimension}维：告警率过高，采用全体分布建议(${allSuggestion.source})`);
    }
  }

  if (effectiveAlertRate < TARGET_ALERT_RATE_MIN &&
      fpRate <= TARGET_FALSE_POSITIVE_RATE_MAX &&
      totalRealAlerts >= MIN_ALERTS_FOR_ADJUSTMENT) {
    if (tpSuggestion && tpSuggestion.value < candidate * 0.85) {
      candidate = tpSuggestion.value;
      reasons.push(`${dimension}维：告警率${(effectiveAlertRate * 100).toFixed(1)}%过低且误报可控，降低阈值`);
    } else if (allSuggestion && allSuggestion.value < candidate * 0.7) {
      candidate = Math.max(MIN_THRESHOLD, allSuggestion.value * 0.8);
      reasons.push(`${dimension}维：告警率过低，参考全体变化分布降低阈值`);
    }
  }

  if (fpRate <= TARGET_FALSE_POSITIVE_RATE_MAX * 0.5 &&
      effectiveAlertRate >= TARGET_ALERT_RATE_MIN &&
      effectiveAlertRate <= TARGET_ALERT_RATE_MAX * 0.7 &&
      tpSuggestion && tpSuggestion.value < candidate * 0.9) {
    candidate = (candidate + tpSuggestion.value) / 2;
    reasons.push(`${dimension}维：系统表现良好，适度降低提高灵敏度`);
  }

  candidate = clamp(candidate, MIN_THRESHOLD, MAX_THRESHOLD);

  if (allScores.length >= MIN_HISTORY_FOR_ADJUSTMENT && candidate !== currentThreshold) {
    const beforeTest = backtestThreshold(allScores, realAlertScores, falsePositiveScores, currentThreshold);
    const afterTest = backtestThreshold(allScores, realAlertScores, falsePositiveScores, candidate);

    if (fpRate > TARGET_FALSE_POSITIVE_RATE_MAX) {
      if (afterTest.capturedFalsePositives >= beforeTest.capturedFalsePositives) {
        warnings.push(`${dimension}维：调整未降低误报捕获数，调整方向可能需验证`);
      }
    }

    if (afterTest.f1 < beforeTest.f1 * 0.9 && candidate > currentThreshold) {
      candidate = currentThreshold + (candidate - currentThreshold) * 0.5;
      warnings.push(`${dimension}维：F1分数下降明显，调整幅度减半`);
    }
  }

  const smoothed = smoothClamp(currentThreshold, candidate, MIN_THRESHOLD, MAX_THRESHOLD);

  if (!minAdjustmentReached(currentThreshold, smoothed)) {
    return {
      adjusted: false,
      threshold: currentThreshold,
      reasons: [],
      warnings,
      debug: {
        candidate,
        smoothed,
        fpSuggestion,
        allSuggestion,
        tpSuggestion
      }
    };
  }

  return {
    adjusted: true,
    threshold: smoothed,
    reasons,
    warnings,
    debug: {
      candidate,
      smoothed,
      fpSuggestion,
      allSuggestion,
      tpSuggestion,
      metrics
    }
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
  const allWarnings = [];
  let anyAdjusted = false;

  for (const dim of dimensions) {
    const res = adjustSingleDimension({
      dimension: dim,
      currentThreshold: currentThresholds[dim],
      falsePositiveScores: falsePositiveScoresByDim?.[dim] || [],
      allScores: allScoresByDim?.[dim] || [],
      realAlertScores: realAlertScoresByDim?.[dim] || [],
      metrics
    });
    result[dim] = res.threshold;
    if (res.adjusted) {
      anyAdjusted = true;
      allReasons.push(...res.reasons);
      allReasons.push(
        `${dim}: ${(currentThresholds[dim] * 100).toFixed(2)}% → ${(res.threshold * 100).toFixed(2)}%`
      );
    }
    if (res.warnings && res.warnings.length > 0) {
      allWarnings.push(...res.warnings);
    }
  }

  return {
    adjusted: anyAdjusted,
    thresholds: result,
    reasons: allReasons,
    warnings: allWarnings
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
  MIN_ADJUSTMENT_THRESHOLD,
  FP_P_LOW,
  FP_P_MID,
  FP_P_HIGH,
  SAFETY_MARGIN_BASE,
  MIN_FALSE_POSITIVES_FOR_STRONG,
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
