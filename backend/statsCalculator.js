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

export function buildScoreStats(values) {
  if (values.length === 0) {
    return { mean: 0, stdDev: 0, median: 0, p90: 0, p95: 0, max: 0, min: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = calculateMean(values);
  return {
    mean,
    stdDev: calculateStdDev(values, mean),
    median: calculatePercentile(sorted, 0.5),
    p90: calculatePercentile(sorted, 0.9),
    p95: calculatePercentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
    min: sorted[0]
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

export function computeAlertMetrics({
  allHistory,
  realAlerts,
  falsePositiveAlerts,
  rule
}) {
  const alertIdsFromReal = new Set(realAlerts.map(a => a.id));

  const falsePositiveIds = new Set(
    falsePositiveAlerts.map(a => a.id)
  );

  const totalRealAlertCount = realAlerts.length;
  const falsePositiveCount = falsePositiveAlerts.length;
  const truePositiveCount = totalRealAlertCount - falsePositiveCount;

  const falsePositiveRate = totalRealAlertCount > 0
    ? falsePositiveCount / totalRealAlertCount
    : 0;

  const totalComparisons = allHistory.length;
  const alertRate = totalComparisons > 0 ? totalRealAlertCount / totalComparisons : 0;

  return {
    totalComparisons,
    totalRealAlertCount,
    falsePositiveCount,
    truePositiveCount,
    falsePositiveRate,
    alertRate
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
  buildScoreStats,
  aggregateDimensionStats,
  computeAlertMetrics,
  getFalsePositiveScoresByDimension,
  calculateScoresByDimension
};
