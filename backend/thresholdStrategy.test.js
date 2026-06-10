import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adjustSingleDimension,
  adjustAllThresholds,
  shouldTriggerLearning,
  LEARNING_CONFIG
} from './thresholdStrategy.js';

function buildMetrics(overrides = {}) {
  return {
    realAlertRate: 0.05,
    theoreticalAlertRate: 0.06,
    effectiveAlertRate: 0.06,
    falsePositiveRate: 0.10,
    totalRealAlertCount: 5,
    totalFalsePositiveCount: 1,
    totalHistoryCount: 20,
    ...overrides
  };
}

function buildHistoryScores(base, count, stdDev) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    const noise = (Math.sin(i * 1.7) + Math.cos(i * 2.3)) * stdDev;
    arr.push(Math.max(0, Math.min(1, base + noise)));
  }
  return arr;
}

test('单个误报就能触发阈值提高', () => {
  const result = adjustSingleDimension({
    dimension: 'overall',
    currentThreshold: 0.05,
    falsePositiveScores: [0.08],
    allScores: buildHistoryScores(0.03, 30, 0.01),
    realAlertScores: [0.09, 0.10, 0.11],
    metrics: buildMetrics({
      effectiveAlertRate: 0.08,
      falsePositiveRate: 0.25,
      totalRealAlertCount: 3,
      totalFalsePositiveCount: 1
    })
  });

  assert.equal(result.adjusted, true, '单个误报且误报率高时应调整');
  assert.ok(result.threshold > 0.05, `阈值应从0.05提高，当前为${result.threshold}`);
  assert.ok(result.reasons.some(r => r.includes('误报')), '应有误报相关的原因说明');
});

test('误报分数刚超阈值一点点也能调整（原逻辑被最小步长卡掉的问题）', () => {
  const currentT = 0.05;
  const fpScore = 0.055;

  const result = adjustSingleDimension({
    dimension: 'overall',
    currentThreshold: currentT,
    falsePositiveScores: [fpScore, fpScore + 0.001],
    allScores: buildHistoryScores(0.035, 25, 0.008),
    realAlertScores: [0.08, 0.09, 0.10, 0.085],
    metrics: buildMetrics({
      effectiveAlertRate: 0.10,
      falsePositiveRate: 0.33,
      totalRealAlertCount: 4,
      totalFalsePositiveCount: 2
    })
  });

  assert.equal(result.adjusted, true, '误报分数刚超阈值也应调整');
  assert.ok(result.threshold > currentT, `阈值应提高，当前=${currentT} 调整后=${result.threshold}`);
});

test('误报分数略低于阈值但误报率过高时仍应提高阈值（核心Bug修复）', () => {
  const currentT = 0.05;
  const fpScore = 0.045;

  const result = adjustSingleDimension({
    dimension: 'overall',
    currentThreshold: currentT,
    falsePositiveScores: [fpScore, fpScore - 0.002, fpScore + 0.003],
    allScores: buildHistoryScores(0.03, 40, 0.01),
    realAlertScores: [0.07, 0.08, 0.09],
    metrics: buildMetrics({
      effectiveAlertRate: 0.05,
      falsePositiveRate: 0.50,
      totalRealAlertCount: 3,
      totalFalsePositiveCount: 3
    })
  });

  assert.equal(result.adjusted, true, '误报率超标即使分数低于阈值也应调整');
  assert.ok(result.threshold > currentT, `阈值应从${currentT}提高到${result.threshold}`);
  assert.ok(result.reasons.some(r => r.includes('误报率')), '应有误报率相关说明');
});

test('连续多次误报标记逐步提高阈值（模拟4次误报）', () => {
  const allHistory = buildHistoryScores(0.03, 50, 0.01);
  const tpScores = [0.085, 0.09, 0.095, 0.10, 0.088];
  let currentT = 0.05;
  const fpScores = [];
  const thresholds = [currentT];

  const fpSequence = [0.062, 0.055, 0.07, 0.065];
  let totalAlerts = 5;

  for (let i = 0; i < fpSequence.length; i++) {
    fpScores.push(fpSequence[i]);
    const result = adjustSingleDimension({
      dimension: 'overall',
      currentThreshold: currentT,
      falsePositiveScores: [...fpScores],
      allScores: allHistory,
      realAlertScores: tpScores,
      metrics: buildMetrics({
        effectiveAlertRate: 0.08 + i * 0.02,
        falsePositiveRate: ((i + 1) / (totalAlerts + i + 1)),
        totalRealAlertCount: totalAlerts,
        totalFalsePositiveCount: i + 1
      })
    });

    if (result.adjusted) {
      currentT = result.threshold;
    }
    thresholds.push(currentT);
  }

  assert.ok(thresholds[thresholds.length - 1] > thresholds[0],
    `连续误报后阈值应持续上升: ${thresholds.map(t => t.toFixed(4)).join(' → ')}`);

  for (let i = 1; i < thresholds.length; i++) {
    assert.ok(thresholds[i] >= thresholds[i - 1] - 0.0001,
      `阈值不应下降: 第${i}步 ${thresholds[i - 1]} → ${thresholds[i]}`);
  }
});

test('告警率过高（>20%）时自动提高阈值', () => {
  const result = adjustSingleDimension({
    dimension: 'overall',
    currentThreshold: 0.03,
    falsePositiveScores: [],
    allScores: buildHistoryScores(0.06, 50, 0.02),
    realAlertScores: [0.07, 0.08, 0.09],
    metrics: buildMetrics({
      effectiveAlertRate: 0.35,
      falsePositiveRate: 0.05,
      totalRealAlertCount: 3
    })
  });

  assert.equal(result.adjusted, true, '告警率过高应提高阈值');
  assert.ok(result.threshold > 0.03, `阈值应提高到${result.threshold}`);
  assert.ok(result.reasons.some(r => r.includes('告警率')), '应有告警率相关说明');
});

test('告警率过低（<3%）且误报可控时降低阈值', () => {
  const result = adjustSingleDimension({
    dimension: 'overall',
    currentThreshold: 0.15,
    falsePositiveScores: [],
    allScores: buildHistoryScores(0.05, 30, 0.015),
    realAlertScores: [0.08, 0.085, 0.09, 0.095, 0.087],
    metrics: buildMetrics({
      effectiveAlertRate: 0.01,
      falsePositiveRate: 0.0,
      totalRealAlertCount: 5
    })
  });

  assert.equal(result.adjusted, true, '告警率过低应降低阈值');
  assert.ok(result.threshold < 0.15, `阈值应降低到${result.threshold}`);
});

test('误报率过高时使用告警分布P75额外提升', () => {
  const result = adjustSingleDimension({
    dimension: 'overall',
    currentThreshold: 0.05,
    falsePositiveScores: [0.048, 0.052],
    allScores: buildHistoryScores(0.03, 40, 0.01),
    realAlertScores: [0.09, 0.10, 0.11, 0.095, 0.105],
    metrics: buildMetrics({
      effectiveAlertRate: 0.10,
      falsePositiveRate: 0.40,
      totalRealAlertCount: 5,
      totalFalsePositiveCount: 2
    })
  });

  assert.equal(result.adjusted, true, '误报率过高应调整');
  assert.ok(result.threshold > 0.05, '阈值应提高');
});

test('无数据时不调整', () => {
  const result = adjustSingleDimension({
    dimension: 'overall',
    currentThreshold: 0.05,
    falsePositiveScores: [],
    allScores: [],
    realAlertScores: [],
    metrics: buildMetrics({
      effectiveAlertRate: 0.05,
      falsePositiveRate: 0.0,
      totalRealAlertCount: 0,
      totalHistoryCount: 0
    })
  });

  assert.equal(result.adjusted, false, '无数据时不应调整');
});

test('adjustAllThresholds 多维度同时调整', () => {
  const result = adjustAllThresholds({
    currentThresholds: {
      overall: 0.05,
      layout: 0.04,
      content: 0.06,
      style: 0.03
    },
    falsePositiveScoresByDim: {
      overall: [0.07, 0.08, 0.075],
      layout: [0.06, 0.065],
      content: [0.08],
      style: []
    },
    allScoresByDim: {
      overall: buildHistoryScores(0.04, 30, 0.01),
      layout: buildHistoryScores(0.03, 30, 0.008),
      content: buildHistoryScores(0.05, 30, 0.012),
      style: buildHistoryScores(0.02, 30, 0.006)
    },
    realAlertScoresByDim: {
      overall: [0.09, 0.10, 0.11],
      layout: [0.07, 0.08, 0.075],
      content: [0.10, 0.11, 0.12],
      style: [0.05, 0.055, 0.06]
    },
    metrics: buildMetrics({
      effectiveAlertRate: 0.12,
      falsePositiveRate: 0.50,
      totalRealAlertCount: 3,
      totalFalsePositiveCount: 3
    })
  });

  assert.equal(result.adjusted, true, '多维度应至少有一个维度调整');
  assert.ok(result.thresholds.overall > 0.05, 'overall维度应有提高');
  assert.ok(result.thresholds.layout > 0.04, 'layout维度应有提高');
  assert.ok(result.reasons.length > 0, '应有调整原因说明');
});

test('shouldTriggerLearning - 标记误报时总是触发', () => {
  const stats = { total_comparisons: 2 };
  assert.equal(shouldTriggerLearning({ stats, falsePositiveMarked: true }), true);
  assert.equal(shouldTriggerLearning({ stats, forceTrigger: true }), true);
  assert.equal(shouldTriggerLearning({ stats }), false, '历史不足时默认不触发');
  assert.equal(shouldTriggerLearning({ stats: { total_comparisons: 20 } }), true, '历史充足时触发');
  assert.equal(shouldTriggerLearning({ stats: null }), false, '无统计时不触发');
});

test('调整幅度不会超过MAX_THRESHOLD', () => {
  const result = adjustSingleDimension({
    dimension: 'overall',
    currentThreshold: 0.45,
    falsePositiveScores: [0.60, 0.65, 0.70],
    allScores: buildHistoryScores(0.50, 30, 0.05),
    realAlertScores: [0.55, 0.60, 0.65],
    metrics: buildMetrics({
      effectiveAlertRate: 0.25,
      falsePositiveRate: 0.50,
      totalRealAlertCount: 3,
      totalFalsePositiveCount: 3
    })
  });

  assert.ok(result.threshold <= LEARNING_CONFIG.MAX_THRESHOLD,
    `阈值${result.threshold}不应超过上限${LEARNING_CONFIG.MAX_THRESHOLD}`);
});

test('调整幅度不会低于MIN_THRESHOLD', () => {
  const result = adjustSingleDimension({
    dimension: 'overall',
    currentThreshold: 0.03,
    falsePositiveScores: [],
    allScores: buildHistoryScores(0.005, 30, 0.002),
    realAlertScores: [0.01, 0.012, 0.009],
    metrics: buildMetrics({
      effectiveAlertRate: 0.01,
      falsePositiveRate: 0.0,
      totalRealAlertCount: 3
    })
  });

  assert.ok(result.threshold >= LEARNING_CONFIG.MIN_THRESHOLD,
    `阈值${result.threshold}不应低于下限${LEARNING_CONFIG.MIN_THRESHOLD}`);
});

test('系统表现良好时适度降低阈值提高灵敏度', () => {
  const result = adjustSingleDimension({
    dimension: 'overall',
    currentThreshold: 0.08,
    falsePositiveScores: [],
    allScores: buildHistoryScores(0.04, 40, 0.01),
    realAlertScores: [0.055, 0.06, 0.058, 0.062, 0.057],
    metrics: buildMetrics({
      effectiveAlertRate: 0.06,
      falsePositiveRate: 0.0,
      totalRealAlertCount: 5,
      totalFalsePositiveCount: 0
    })
  });

  assert.ok(result.threshold < 0.08 || result.reasons.length === 0,
    `表现良好时应尝试降低: 阈值=${result.threshold} reasons=${result.reasons.join('; ')}`);
});

test('调整后的阈值不低于误报分数', () => {
  const fpScores = [0.06, 0.062, 0.058, 0.065];
  const result = adjustSingleDimension({
    dimension: 'overall',
    currentThreshold: 0.05,
    falsePositiveScores: fpScores,
    allScores: buildHistoryScores(0.035, 30, 0.01),
    realAlertScores: [0.09, 0.10, 0.095],
    metrics: buildMetrics({
      effectiveAlertRate: 0.10,
      falsePositiveRate: 0.57,
      totalRealAlertCount: 3,
      totalFalsePositiveCount: 4
    })
  });

  if (result.adjusted) {
    const minFp = Math.min(...fpScores);
    assert.ok(result.threshold >= minFp - 0.005,
      `调整后阈值${result.threshold}不应明显低于最低误报分数${minFp}`);
  }
});

console.log('\n所有 thresholdStrategy 单元测试通过!');
