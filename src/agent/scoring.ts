// 统一评分口径（四子 Agent + 前端共用）
// 设计原则：
// 1. 使用行业典型参考范围做固定归一化（而非方案集内 MinMax），保证单方案/多方案、任何调用方得到同一分数；
// 2. 安全 = 抗震60% + 施工难度40%；绿色 = 可持续40% + 碳排35% + 装配率25%；
// 3. 所有分项 0~10 分，综合分为权重加权平均。
import type { IStructureScheme, IWeightConfig } from '@/data/structure';

/** 各维度行业典型参考范围（用于固定归一化） */
export const SCORE_RANGES = {
  cost: { min: 2000, max: 6000 }, // 元/㎡，越低越好
  duration: { min: 6, max: 36 }, // 月，越低越好
  difficulty: { min: 1, max: 10 }, // 施工难度，越低越好
  carbon: { min: 200, max: 1000 }, // kgCO2/㎡，越低越好
  seismic: { min: 0, max: 10 }, // 抗震性能，越高越好
  sustain: { min: 0, max: 10 }, // 可持续性，越高越好
  precast: { min: 0, max: 100 }, // 装配率 %，越高越好
} as const;

/**
 * 固定范围归一化（0~10 分）
 * @param lowerIsBetter true = 值越小分越高（逆向）
 */
export function normalizeMetric(value: number, min: number, max: number, lowerIsBetter: boolean): number {
  const clamped = Math.min(max, Math.max(min, value));
  const norm = (clamped - min) / (max - min); // 0~1
  const score = (lowerIsBetter ? 1 - norm : norm) * 10;
  return Math.round(score * 100) / 100;
}

export interface ISchemeScoreBreakdown {
  cost: number;
  duration: number;
  seismic: number;
  difficulty: number;
  sustain: number;
  carbon: number;
  precast: number;
  safety: number;
  green: number;
  performance: number;
  overall: number;
}

/** 统一综合评分：对任意方案 + 任意权重，输出唯一确定的 0~10 分及各分项 */
export function computeSchemeScore(
  scheme: IStructureScheme,
  weights: IWeightConfig
): ISchemeScoreBreakdown {
  const m = scheme.metrics;

  const costScore = normalizeMetric(m.cost, SCORE_RANGES.cost.min, SCORE_RANGES.cost.max, true);
  const durationScore = normalizeMetric(m.duration, SCORE_RANGES.duration.min, SCORE_RANGES.duration.max, true);
  const seismicScore = normalizeMetric(m.seismicPerformance, SCORE_RANGES.seismic.min, SCORE_RANGES.seismic.max, false);
  const difficultyScore = normalizeMetric(m.constructionDifficulty, SCORE_RANGES.difficulty.min, SCORE_RANGES.difficulty.max, true);
  const sustainScore = normalizeMetric(m.sustainability, SCORE_RANGES.sustain.min, SCORE_RANGES.sustain.max, false);
  const carbonScore = normalizeMetric(m.carbonEmission, SCORE_RANGES.carbon.min, SCORE_RANGES.carbon.max, true);
  const precastScore = normalizeMetric(m.precastRate.rate, SCORE_RANGES.precast.min, SCORE_RANGES.precast.max, false);

  // 安全 = 抗震60% + 施工难度40%（难度越低分越高）
  const safetyScore = Math.round((seismicScore * 0.6 + difficultyScore * 0.4) * 100) / 100;
  // 绿色 = 可持续40% + 碳排35% + 装配率25%
  const greenScore = Math.round((sustainScore * 0.4 + carbonScore * 0.35 + precastScore * 0.25) * 100) / 100;
  // 综合性能 = 抗震 + 可持续 平均
  const performanceScore = Math.round(((seismicScore + sustainScore) / 2) * 100) / 100;

  const weightTotal = weights.cost + weights.duration + weights.safety + weights.green || 100;
  const overall =
    (costScore * weights.cost +
      durationScore * weights.duration +
      safetyScore * weights.safety +
      greenScore * weights.green) /
    weightTotal;

  return {
    cost: costScore,
    duration: durationScore,
    seismic: seismicScore,
    difficulty: difficultyScore,
    sustain: sustainScore,
    carbon: carbonScore,
    precast: precastScore,
    safety: safetyScore,
    green: greenScore,
    performance: performanceScore,
    overall: Math.round(overall * 100) / 100,
  };
}
