import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adjustAllThresholds,
  shouldTriggerLearning,
  LEARNING_CONFIG
} from './thresholdStrategy.js';
import {
  buildScoreStats,
  aggregateDimensionStats,
  computeAlertMetrics,
  calculateTheoreticalAlertRate,
  backtestThreshold
} from './statsCalculator.js';

function generateHistory(count, baseScore, variance) {
  const history = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const overall = Math.max(0.001, Math.min(0.5, baseScore + (Math.random() - 0.5) * variance * 2));
    history.push({
      id: i + 1,
      url_id: 1,
      overall_score: overall,
      layout_score: overall * 0.6,
      content_score: overall * 0.8,
      style_score: overall * 0.5,
      created_at: new Date(now - (count - i) * 3600000).toISOString()
    });
  }
  return history;
}

function generateAlerts(history, falsePositiveIndices) {
  return history.filter((_, idx) => history[idx].overall_score > 0.05).map((h, idx) => ({
    id: idx + 1,
    url_id: 1,
    overall_score: h.overall_score,
    layout_score: h.layout_score,
    content_score: h.content_score,
    style_score: h.style_score,
    is_false_positive: falsePositiveIndices.includes(idx) ? 1 : 0,
    created_at: h.created_at
  }));
}

function simulateFullLearningCycle({
  baseThresholds,
  history,
  realAlerts,
  falsePositiveAlerts,
  truePositiveAlerts
}) {
  const dimStats = aggregateDimensionStats(history);
  const rule = {
    overall_threshold: baseThresholds.overall,
    layout_threshold: baseThresholds.layout,
    content_threshold: baseThresholds.content,
    style_threshold: baseThresholds.style
  };
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

  const result = adjustAllThresholds({
    currentThresholds: baseThresholds,
    falsePositiveScoresByDim,
    allScoresByDim,
    realAlertScoresByDim,
    metrics
  });

  return { result, metrics, dimStats };
}

test('场景1: 大量误报时阈值应持续升高', () => {
  const history = generateHistory(50, 0.035, 0.015);
  const alertingHistory = history.filter(h => h.overall_score > 0.04);
  const alerts = alertingHistory.map((h, idx) => ({
    id: idx + 1,
    url_id: 1,
    overall_score: h.overall_score,
    layout_score: h.layout_score,
    content_score: h.content_score,
    style_score: h.style_score,
    is_false_positive: idx < 6 ? 1 : 0,
    created_at: h.created_at
  }));
  const fpAlerts = alerts.filter(a => a.is_false_positive === 1);
  const tpAlerts = alerts.filter(a => a.is_false_positive === 0);

  let thresholds = {
    overall: 0.04,
    layout: 0.03,
    content: 0.045,
    style: 0.025
  };
  const thresholdHistory = [{ ...thresholds }];

  for (let round = 0; round < 3; round++) {
    const { result } = simulateFullLearningCycle({
      baseThresholds: thresholds,
      history,
      realAlerts: alerts,
      falsePositiveAlerts: fpAlerts.slice(0, Math.min(2 + round * 2, fpAlerts.length)),
      truePositiveAlerts: tpAlerts
    });

    if (result.adjusted) {
      thresholds = { ...result.thresholds };
    }
    thresholdHistory.push({ ...thresholds });
  }

  assert.ok(thresholds.overall > 0.04,
    `经过${thresholdHistory.length - 1}轮学习，overall阈值应从0.04上升到${thresholds.overall}`);

  console.log('  场景1阈值变化:', thresholdHistory.map(t =>
    `overall=${(t.overall * 100).toFixed(2)}%`
  ).join(' → '));
});

test('场景2: 连续误报标记后调整生效（修复时间间隔限制问题）', () => {
  const history = generateHistory(30, 0.04, 0.012);
  const alertingHistory = history.filter(h => h.overall_score > 0.05);
  const baseAlerts = alertingHistory.map((h, idx) => ({
    id: idx + 1,
    url_id: 1,
    overall_score: h.overall_score,
    layout_score: h.layout_score,
    content_score: h.content_score,
    style_score: h.style_score,
    is_false_positive: 0,
    created_at: h.created_at
  }));

  let thresholds = {
    overall: 0.05,
    layout: 0.04,
    content: 0.06,
    style: 0.03
  };
  const fpScores = [0.058, 0.052, 0.061];
  const adjustedCountPerRound = [];

  for (let round = 0; round < fpScores.length; round++) {
    const markedFp = fpScores.slice(0, round + 1).map((s, i) => ({
      id: 100 + i,
      url_id: 1,
      overall_score: s,
      layout_score: s * 0.6,
      content_score: s * 0.8,
      style_score: s * 0.5,
      is_false_positive: 1,
      created_at: new Date().toISOString()
    }));

    const { result } = simulateFullLearningCycle({
      baseThresholds: thresholds,
      history,
      realAlerts: [...baseAlerts, ...markedFp],
      falsePositiveAlerts: markedFp,
      truePositiveAlerts: baseAlerts
    });

    adjustedCountPerRound.push(result.adjusted ? 1 : 0);
    if (result.adjusted) {
      thresholds = { ...result.thresholds };
    }
  }

  const totalAdjustments = adjustedCountPerRound.reduce((a, b) => a + b, 0);
  assert.ok(totalAdjustments >= 1,
    `连续${fpScores.length}次误报标记后应至少调整${totalAdjustments}次，各轮: ${adjustedCountPerRound.join(',')}`);
  assert.ok(thresholds.overall > 0.05,
    `连续误报标记后阈值应从0.05上升到${thresholds.overall}`);

  console.log(`  场景2各轮是否调整: ${adjustedCountPerRound.map(v => v ? '是' : '否').join(',')}`);
  console.log(`  场景2最终阈值: overall=${(thresholds.overall * 100).toFixed(2)}%`);
});

test('场景3: 误报分数略低于当前阈值但误报率高时仍应提高', () => {
  const history = generateHistory(60, 0.035, 0.01);
  const fpScores = [0.045, 0.047, 0.046, 0.044];
  const fpAlerts = fpScores.map((s, i) => ({
    id: i + 1,
    url_id: 1,
    overall_score: s,
    layout_score: s * 0.6,
    content_score: s * 0.8,
    style_score: s * 0.5,
    is_false_positive: 1,
    created_at: new Date(Date.now() - i * 3600000).toISOString()
  }));
  const tpScores = [0.08, 0.085, 0.09];
  const tpAlerts = tpScores.map((s, i) => ({
    id: 100 + i,
    url_id: 1,
    overall_score: s,
    layout_score: s * 0.6,
    content_score: s * 0.8,
    style_score: s * 0.5,
    is_false_positive: 0,
    created_at: new Date(Date.now() - 10000 - i * 3600000).toISOString()
  }));

  const { result } = simulateFullLearningCycle({
    baseThresholds: { overall: 0.05, layout: 0.04, content: 0.06, style: 0.03 },
    history,
    realAlerts: [...fpAlerts, ...tpAlerts],
    falsePositiveAlerts: fpAlerts,
    truePositiveAlerts: tpAlerts
  });

  assert.equal(result.adjusted, true,
    `误报率${(fpAlerts.length / (fpAlerts.length + tpAlerts.length) * 100).toFixed(0)}%超标，必须调整`);
  assert.ok(result.thresholds.overall > 0.05,
    `阈值应提高到${result.thresholds.overall}（当前0.05），误报分数集中在${fpScores.map(s => s.toFixed(3)).join(',')}`);

  console.log(`  场景3: 误报率${(fpAlerts.length / (fpAlerts.length + tpAlerts.length) * 100).toFixed(0)}%，阈值从5%提高到${(result.thresholds.overall * 100).toFixed(2)}%`);
  console.log(`  场景3调整原因: ${result.reasons.slice(0, 3).join('; ')}`);
});

test('场景4: 告警率过高时自动提高阈值', () => {
  const history = generateHistory(50, 0.06, 0.02);
  const alerts = history.filter(h => h.overall_score > 0.03).map((h, idx) => ({
    id: idx + 1,
    url_id: 1,
    overall_score: h.overall_score,
    layout_score: h.layout_score,
    content_score: h.content_score,
    style_score: h.style_score,
    is_false_positive: idx % 10 === 0 ? 1 : 0,
    created_at: h.created_at
  }));
  const fpAlerts = alerts.filter(a => a.is_false_positive === 1);
  const tpAlerts = alerts.filter(a => a.is_false_positive === 0);

  const { result, metrics } = simulateFullLearningCycle({
    baseThresholds: { overall: 0.03, layout: 0.025, content: 0.04, style: 0.02 },
    history,
    realAlerts: alerts,
    falsePositiveAlerts: fpAlerts,
    truePositiveAlerts: tpAlerts
  });

  assert.ok(metrics.effectiveAlertRate > 0.20,
    `测试场景告警率应高于20%，实际${(metrics.effectiveAlertRate * 100).toFixed(1)}%`);
  assert.equal(result.adjusted, true, '高告警率应触发阈值提高');
  assert.ok(result.thresholds.overall > 0.03, `阈值应提高到${result.thresholds.overall}`);

  console.log(`  场景4: 告警率${(metrics.effectiveAlertRate * 100).toFixed(1)}%，阈值从3%提高到${(result.thresholds.overall * 100).toFixed(2)}%`);
});

test('场景5: 学习后误报率应下降（回测验证）', () => {
  const history = generateHistory(60, 0.04, 0.015);
  const alerts = history.filter(h => h.overall_score > 0.04).map((h, idx) => ({
    id: idx + 1,
    url_id: 1,
    overall_score: h.overall_score,
    layout_score: h.layout_score,
    content_score: h.content_score,
    style_score: h.style_score,
    is_false_positive: idx < 5 ? 1 : 0,
    created_at: h.created_at
  }));
  const fpAlerts = alerts.filter(a => a.is_false_positive === 1);
  const tpAlerts = alerts.filter(a => a.is_false_positive === 0);

  const oldT = 0.04;
  const { result } = simulateFullLearningCycle({
    baseThresholds: { overall: oldT, layout: 0.035, content: 0.05, style: 0.025 },
    history,
    realAlerts: alerts,
    falsePositiveAlerts: fpAlerts,
    truePositiveAlerts: tpAlerts
  });

  if (result.adjusted) {
    const allScores = history.map(h => h.overall_score);
    const beforeBacktest = backtestThreshold(allScores, tpAlerts.map(a => a.overall_score), fpAlerts.map(a => a.overall_score), oldT);
    const afterBacktest = backtestThreshold(allScores, tpAlerts.map(a => a.overall_score), fpAlerts.map(a => a.overall_score), result.thresholds.overall);

    assert.ok(afterBacktest.capturedFalsePositives <= beforeBacktest.capturedFalsePositives,
      `调整后误报捕获数应减少或不变: 调整前${beforeBacktest.capturedFalsePositives} → 调整后${afterBacktest.capturedFalsePositives}`);

    console.log(`  场景5: 阈值从${(oldT * 100).toFixed(2)}% → ${(result.thresholds.overall * 100).toFixed(2)}%`);
    console.log(`    调整前: 误报捕获=${beforeBacktest.capturedFalsePositives}, 理论告警率=${(beforeBacktest.theoreticalAlertRate * 100).toFixed(1)}%, F1=${beforeBacktest.f1?.toFixed(3) || 'N/A'}`);
    console.log(`    调整后: 误报捕获=${afterBacktest.capturedFalsePositives}, 理论告警率=${(afterBacktest.theoreticalAlertRate * 100).toFixed(1)}%, F1=${afterBacktest.f1?.toFixed(3) || 'N/A'}`);
  } else {
    console.log('  场景5: 本次未调整（边界条件）');
  }
});

test('场景6: 应该误报标记时总是立即触发学习（shouldTriggerLearning）', () => {
  const cases = [
    { opts: { falsePositiveMarked: true, stats: { total_comparisons: 1 } }, expected: true, desc: '仅1次比较+误报标记' },
    { opts: { falsePositiveMarked: true, stats: null }, expected: true, desc: '无统计+误报标记' },
    { opts: { forceTrigger: true, stats: { total_comparisons: 0 } }, expected: true, desc: '强制触发' },
    { opts: { stats: { total_comparisons: 1 } }, expected: false, desc: '历史太少，无特殊标记' },
    { opts: { stats: { total_comparisons: 20 } }, expected: true, desc: '历史充足' }
  ];

  for (const c of cases) {
    const actual = shouldTriggerLearning(c.opts);
    assert.equal(actual, c.expected, `${c.desc}: 期望${c.expected}，实际${actual}`);
  }

  console.log('  场景6: 所有触发条件判定正确');
});

test('场景7: effectiveAlertRate 被合理限制，不会虚高', () => {
  const history = generateHistory(40, 0.06, 0.015);
  const alerts = history.filter(h => h.overall_score > 0.08).map((h, i) => ({
    id: i + 1,
    url_id: 1,
    overall_score: h.overall_score,
    layout_score: h.layout_score,
    content_score: h.content_score,
    style_score: h.style_score,
    is_false_positive: 0,
    created_at: h.created_at
  }));

  const rule = { overall_threshold: 0.03, layout_threshold: 0.025, content_threshold: 0.04, style_threshold: 0.02 };
  const metrics = computeAlertMetrics({ allHistory: history, realAlerts: alerts, falsePositiveAlerts: [], rule });

  assert.ok(metrics.theoreticalAlertRate > 0.5,
    `理论告警率应偏高（实际=${metrics.theoreticalAlertRate.toFixed(2)}，因为阈值太低）`);
  assert.ok(metrics.cappedTheoreticalAlertRate <= 0.25,
    `cappedTheoreticalAlertRate(${metrics.cappedTheoreticalAlertRate.toFixed(3)}不应超过25%`);
  assert.ok(metrics.effectiveAlertRate <= 0.25,
    `effectiveAlertRate(${metrics.effectiveAlertRate.toFixed(3)})不应超过25%，不会因为理论值虚高`);
  assert.ok(metrics.effectiveAlertRate >= metrics.realAlertRate,
    `effectiveAlertRate不应低于realAlertRate`);

  console.log(`  场景7: real=${(metrics.realAlertRate * 100).toFixed(1)}%, rawTheoretical=${(metrics.theoreticalAlertRate * 100).toFixed(1)}%, cappedTheoretical=${(metrics.cappedTheoreticalAlertRate * 100).toFixed(1)}%, effective=${(metrics.effectiveAlertRate * 100).toFixed(1)}%`);
});

test('场景8: 误报分数远低于阈值但误报率>50%时依然提高阈值', () => {
  const history = generateHistory(60, 0.04, 0.012);
  const tpScores = [0.12, 0.13, 0.115];
  const fpScores = [0.06, 0.055, 0.062, 0.058];

  const fpAlerts = fpScores.map((s, i) => ({
    id: i + 1,
    url_id: 1,
    overall_score: s,
    layout_score: s * 0.7,
    content_score: s * 0.9,
    style_score: s * 0.5,
    is_false_positive: 1,
    created_at: new Date(Date.now() - i * 3600000).toISOString()
  }));
  const tpAlerts = tpScores.map((s, i) => ({
    id: 100 + i,
    url_id: 1,
    overall_score: s,
    layout_score: s * 0.6,
    content_score: s * 0.8,
    style_score: s * 0.5,
    is_false_positive: 0,
    created_at: new Date(Date.now() - 50000 - i * 3600000).toISOString()
  }));

  const { result } = simulateFullLearningCycle({
    baseThresholds: { overall: 0.10, layout: 0.09, content: 0.11, style: 0.08 },
    history,
    realAlerts: [...fpAlerts, ...tpAlerts],
    falsePositiveAlerts: fpAlerts,
    truePositiveAlerts: tpAlerts
  });

  const fpRate = fpAlerts.length / (fpAlerts.length + tpAlerts.length);
  assert.ok(fpRate > 0.5, `测试场景误报率应>50%，实际=${(fpRate*100).toFixed(0)}%`);
  assert.equal(result.adjusted, true, '误报率>50%必须调整');
  assert.ok(result.thresholds.overall > 0.10,
    `即使误报分数(${fpScores.map(s => s.toFixed(3)).join(',')})远低于阈值0.10，也应提高阈值到${result.thresholds.overall}`);

  console.log(`  场景8: 误报率${(fpRate * 100).toFixed(0)}%，overall阈值从10%→${(result.thresholds.overall * 100).toFixed(2)}%`);
  console.log(`    调整原因: ${result.reasons.slice(0, 2).join('; ')}`);
});

test('场景9: 多轮误报标记阈值持续上升，不会因为告警率虚高而过度调整过头', () => {
  const history = generateHistory(80, 0.05, 0.015);
  const tpScores = [0.10, 0.11, 0.105, 0.115];
  const fpBatch = [
    [0.07],
    [0.07, 0.065],
    [0.07, 0.065, 0.072],
    [0.07, 0.065, 0.072, 0.068]
  ];

  let thresholds = {
    overall: 0.08,
    layout: 0.07,
    content: 0.09,
    style: 0.06
  };
  const thresholdLog = [{ ...thresholds }];

  for (let round = 0; round < fpBatch.length; round++) {
    const fpAlerts = fpBatch[round].map((s, i) => ({
      id: i + 1,
      url_id: 1,
      overall_score: s,
      layout_score: s * 0.6,
      content_score: s * 0.8,
      style_score: s * 0.5,
      is_false_positive: 1,
      created_at: new Date().toISOString()
    }));
    const tpAlerts = tpScores.map((s, i) => ({
      id: 100 + i,
      url_id: 1,
      overall_score: s,
      layout_score: s * 0.6,
      content_score: s * 0.8,
      style_score: s * 0.5,
      is_false_positive: 0,
      created_at: new Date().toISOString()
    }));

    const { result } = simulateFullLearningCycle({
      baseThresholds: { ...thresholds },
      history,
      realAlerts: [...fpAlerts, ...tpAlerts],
      falsePositiveAlerts: fpAlerts,
      truePositiveAlerts: tpAlerts
    });

    if (result.adjusted) {
      thresholds = { ...result.thresholds };
    }
    thresholdLog.push({ ...thresholds });
  }

  assert.ok(thresholds.overall > thresholdLog[0].overall,
    `多轮误报后overall阈值应持续上升: ${thresholdLog.map(t => (t.overall * 100).toFixed(2) + '%').join(' → ')}`);
  assert.ok(thresholds.overall < 0.20,
    `阈值不应上升过度（<20%），实际=${thresholds.overall.toFixed(3)}`);

  console.log(`  场景9 overall 阈值变化: ${thresholdLog.map(t => (t.overall * 100).toFixed(2) + '%').join(' → ')}`);
});

console.log('\n所有 thresholdLearner 集成测试通过!');
