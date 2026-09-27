// 方案评估器（统一领域模型）
// 核心建模修正（架构诊断 P0-3）：
//   metrics 本质是「(结构体系 × 工程参数) 的二元函数」，不是结构体系的内在属性。
//   旧实现把它存成 scheme.metrics 字段，导致同一方案在不同调用方重算出不同指标，
//   optimizer.ts 曾被迫写注释「用当前参数重算基准方案指标以保证同一计算基准」。
//
// 本模块提供唯一权威入口 evaluateScheme(systemId, params)，返回不可变评估快照，
// 并带参数指纹缓存（optimizer 单轮自评的规范计算量从 O(30×12) 降到 O(12) 次命中）。
// EXPORTS: ISchemeEvaluation, evaluateScheme, evaluateSchemeSet, clearEvaluationCache,
//          toScheme, evaluationCacheStats

import {
  STRUCTURE_SYSTEM_LIBRARY,
  estimateCost,
  estimateDuration,
  estimateCarbonEmission,
  estimatePrecastRate,
  estimateConstructionRisk,
  suggestFoundation,
  buildCostBreakdown,
  calculateNormCompliance,
  type IProjectParams,
  type IStructureScheme,
  type ISchemeMetrics,
  type INormCompliance,
  type IFoundationSuggestion,
  type ICostBreakdown,
} from './structure';

/** 方案评估快照：在某一组工程参数下，某一结构体系的完整评估结果（不可变） */
export interface ISchemeEvaluation {
  systemId: string;
  systemName: string;
  /** 本次评估所依据的工程参数快照（说明 metrics 的适用条件） */
  params: IProjectParams;
  metrics: ISchemeMetrics;
  normCompliance: INormCompliance;
  foundationSuggestion: IFoundationSuggestion;
  costBreakdown?: ICostBreakdown;
  safetyRiskNotes: string[];
}

// ============ 缓存 ============

const CACHE_LIMIT = 400;
const cache = new Map<string, ISchemeEvaluation>();

function fingerprint(params: IProjectParams): string {
  return [
    params.buildingType,
    params.floors,
    params.area,
    params.seismicIntensity,
    params.soilCategory,
    params.geologyType,
    params.mainSpan,
    params.budget,
    params.windPressure,
    params.snowPressure,
    params.fortificationCategory,
    params.buildingHeight ?? '-',
  ].join('|');
}

/** 评估某一结构体系在给定工程参数下的完整结果（带缓存） */
export function evaluateScheme(systemId: string, params: IProjectParams): ISchemeEvaluation {
  const key = `${systemId}@${fingerprint(params)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const scheme = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === systemId);
  if (!scheme) {
    throw new Error(`未知结构体系「${systemId}」，无法评估`);
  }

  const cost = estimateCost(
    systemId,
    params.floors,
    params.seismicIntensity,
    params.soilCategory,
    params.mainSpan
  );
  const duration = estimateDuration(systemId, params.area, params.floors);
  const carbonEmission = estimateCarbonEmission(systemId, params.floors);
  const precastRate = estimatePrecastRate(systemId, params.floors);
  const risk = estimateConstructionRisk(systemId, params.floors);
  const costBreakdown = buildCostBreakdown(systemId, params, cost);

  const evaluation: ISchemeEvaluation = {
    systemId,
    systemName: scheme.name,
    params: { ...params },
    metrics: {
      ...scheme.metrics,
      cost,
      duration,
      carbonEmission,
      precastRate,
      safetyRisk: risk.level,
    },
    normCompliance: calculateNormCompliance(systemId, params),
    foundationSuggestion: suggestFoundation(
      systemId,
      params.geologyType,
      params.floors,
      params.soilCategory
    ),
    safetyRiskNotes: risk.notes,
    ...(costBreakdown ? { costBreakdown } : {}),
  };

  if (cache.size >= CACHE_LIMIT) {
    // FIFO 淘汰最早写入的一条
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, evaluation);
  return evaluation;
}

/** 批量评估（复用缓存） */
export function evaluateSchemeSet(
  systemIds: string[],
  params: IProjectParams
): ISchemeEvaluation[] {
  return systemIds.map((id) => evaluateScheme(id, params));
}

export function clearEvaluationCache(): void {
  cache.clear();
}

export function evaluationCacheStats(): { size: number; limit: number } {
  return { size: cache.size, limit: CACHE_LIMIT };
}

/** 把评估快照装配成 UI / 管线消费的方案对象（保留 evaluatedAt 以便评分口径统一） */
export function toScheme(evaluation: ISchemeEvaluation): IStructureScheme {
  const scheme = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === evaluation.systemId);
  if (!scheme) {
    throw new Error(`未知结构体系「${evaluation.systemId}」，无法装配方案对象`);
  }
  return {
    ...scheme,
    metrics: evaluation.metrics,
    normCompliance: evaluation.normCompliance,
    foundationSuggestion: evaluation.foundationSuggestion,
    safetyRiskNotes: evaluation.safetyRiskNotes,
    ...(evaluation.costBreakdown ? { costBreakdown: evaluation.costBreakdown } : {}),
    evaluatedAt: { ...evaluation.params },
  };
}
