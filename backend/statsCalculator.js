export function calculateMean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function calculateStdDev(values, mean) {
  if (values.length === 0) return 0;
  const m = mean !== undefined ? mean : calculateMean(values);
  const squaredDiffs = values.map(v => Math.pow(v - m, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

export function calculatePercentile(sortedValues, percentile) {
  if (sortedValues.length === 0) return 0;
  const index = (sortedValues.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

export function calculateMedian(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return calculatePercentile(sorted, 0.5);
}

export function calculateWeightedMean(values, weights) {
  if (values.length === 0) return 0;
  const effectiveWeights = weights && weights.length === values.length
    ? weights
    : values.map((_, i) => Math.pow(0.95, values.length - 1 - i));
  const totalWeight = effectiveWeights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) return calculateMean(values);
  return values.reduce((sum, v, i) => sum + v * effectiveWeights[i], 0) / totalWeight;
}

export function buildScoreStats(values) {
  if (values.length === 0) {
    return { mean: 0, stdDev: 0, median: 0, p75: 0, p85: 0, p90: 0, p95: 0, max: 0, min: 0, count: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = calculateMean(values);
  return {
    mean,
    stdDev: calculateStdDev(values, mean),
    median: calculatePercentile(sorted, 0.5),
    p75: calculatePercentile(sorted, 0.75),
    p85: calculatePercentile(sorted, 0.85),
    p90: calculatePercentile(sorted, 0.90),
    p95: calculatePercentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
    min: sorted[0],
    count: values.length
  };
}

export function aggregateDimensionStats(historyRecords) {
  const overall = historyRecords.map(h => h.overall_score);
  const layout = historyRecords.map(h => h.layout_score);
  const content = historyRecords.map(h => h.content_score);
  const style = historyRecords.map(h => h.style_score);

  return {
    overall: buildScoreStats(overall),
    layout: buildScoreStats(layout),
    content: buildScoreStats(content),
    style: buildScoreStats(style),
    totalSamples: historyRecords.length
  };
}

export function calculateTheoreticalAlertRate(allScores, threshold) {
  if (allScores.length === 0) return 0;
  const alertCount = allScores.filter(s => s > threshold).length;
  return alertCount / allScores.length;
}

export function backtestThreshold(allScores, truePositiveScores, falsePositiveScores, threshold) {
  const theoreticalRate = calculateTheoreticalAlertRate(allScores, threshold);
  const capturedTP = truePositiveScores.filter(s => s > threshold).length;
  const capturedFP = falsePositiveScores.filter(s => s > threshold).length;
  const totalAlerts = allScores.filter(s => s > threshold).length;
  const precision = totalAlerts > 0 ? (capturedTP) / totalAlerts : 0;
  const recall = truePositiveScores.length > 0 ? capturedTP / truePositiveScores.length : 0;
  return {
    theoreticalAlertRate: theoreticalRate,
    capturedTruePositives: capturedTP,
    capturedFalsePositives: capturedFP,
    precision,
    recall,
    f1: precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0
  };
}

export function computeAlertMetrics({
  allHistory,
  realAlerts,
  falsePositiveAlerts,
  rule
}) {
  const totalComparisons = allHistory.length;
  const totalRealAlertCount = realAlerts.length;
  const falsePositiveCount = falsePositiveAlerts.length;
  const truePositiveCount = totalRealAlertCount - falsePositiveCount;

  const falsePositiveRate = totalRealAlertCount > 0
    ? falsePositiveCount / totalRealAlertCount
    : 0;

  const realAlertRate = totalComparisons > 0 ? totalRealAlertCount / totalComparisons : 0;

  const theoreticalAlertRate = rule && totalComparisons > 0
    ? calculateTheoreticalAlertRate(
        allHistory.map(h => h.overall_score),
        rule.overall_threshold
      )
    : realAlertRate;

  return {
    totalComparisons,
    totalRealAlertCount,
    falsePositiveCount,
    truePositiveCount,
    falsePositiveRate,
    realAlertRate,
    theoreticalAlertRate,
    effectiveAlertRate: Math.max(realAlertRate, theoreticalAlertRate)
  };
}

export function getFalsePositiveScoresByDimension(alerts) {
  return {
    overall: alerts.map(a => a.overall_score),
    layout: alerts.map(a => a.layout_score),
    content: alerts.map(a => a.content_score),
    style: alerts.map(a => a.style_score)
  };
}

export function calculateScoresByDimension(alerts) {
  return {
    overall: buildScoreStats(alerts.map(a => a.overall_score)),
    layout: buildScoreStats(alerts.map(a => a.layout_score)),
    content: buildScoreStats(alerts.map(a => a.content_score)),
    style: buildScoreStats(alerts.map(a => a.style_score))
  };
}

export default {
  calculateMean,
  calculateStdDev,
  calculatePercentile,
  calculateMedian,
  calculateWeightedMean,
  buildScoreStats,
  aggregateDimensionStats,
  calculateTheoreticalAlertRate,
  backtestThreshold,
  computeAlertMetrics,
  getFalsePositiveScoresByDimension,
  calculateScoresByDimension
};
