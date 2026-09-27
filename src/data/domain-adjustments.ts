// 领域调节规则层（声明式）
// 职责：把散落在各处的「工程经验性调节」收敛到单一数据源。
//
// 背景（架构诊断 P0-3）：同一条业务规则「高烈度高层住宅优先抗震墙体系」此前被硬编码三处：
//   - tools.ts       compare_schemes：综合评分 +1.2
//   - structure.ts   generateSchemesFromParams：候选池筛选分 +8
//   - scoring.ts     computeSchemeScore：+0（完全不知道有这条规则）
// 后果：8 度 + 高层 + 住宅场景下，总工的排序分 ≠ 方案卡片分 ≠ 优化器分。
//
// 解决：规则在此处声明一次，同时驱动两个量纲（综合评分 / 候选池筛选分）。
// EXPORTS: IDomainAdjustment, DOMAIN_ADJUSTMENTS, resolveDomainAdjustments,
//          IAdjustmentContext, buildAdjustmentContext

import { resolveBuildingHeight, parseIntensity } from './norm-evaluator';
import type { IProjectParams } from './structure';

/** 调节规则求值上下文 */
export interface IAdjustmentContext {
  params: IProjectParams;
  /** 数值化设防烈度 */
  intensity: number;
  /** 建筑高度（m） */
  height: number;
}

/**
 * 领域调节规则
 * 说明：这类规则是「规范未明说、但工程界公认」的经验性偏向，
 * 因此必须与规范判定（code-rules.ts）分开管理，并在界面上标明其为经验调节而非规范强制。
 */
export interface IDomainAdjustment {
  id: string;
  name: string;
  /** 工程依据（说明为什么有这条调节） */
  basis: string;
  /** 适用条件 */
  appliesTo: (ctx: IAdjustmentContext) => boolean;
  /** 受益的结构体系 */
  targetSystems: string[];
  /** 0~10 综合评分上的调节分（正 = 加分） */
  scoreDelta: number;
  /** 候选池筛选分上的加成（该分数量纲与综合评分不同，故单独声明） */
  screeningBonus: number;
}

export const DOMAIN_ADJUSTMENTS: IDomainAdjustment[] = [
  {
    id: 'lateral_stiffness_priority',
    name: '高烈度高层住宅侧向刚度控制',
    basis:
      '8 度及以上设防、高度 ≥ 30m 的住宅建筑，侧向刚度与延性通常是第一控制因素。抗震墙类体系（剪力墙、框剪、框筒、筒中筒）抗侧刚度大、延性好，较纯框架体系更适应该场景。',
    appliesTo: (ctx) =>
      ctx.params.buildingType === 'residential' && ctx.intensity >= 8 && ctx.height >= 30,
    targetSystems: ['shearwall', 'frame-shearwall', 'frame-corewall', 'tube-in-tube'],
    scoreDelta: 1.2,
    screeningBonus: 8,
  },
];

/** 构造调节规则求值上下文 */
export function buildAdjustmentContext(params: IProjectParams): IAdjustmentContext {
  return {
    params,
    intensity: parseIntensity(params.seismicIntensity),
    height: resolveBuildingHeight(params),
  };
}

/** 取当前工程条件下生效的调节规则 */
export function resolveDomainAdjustments(params: IProjectParams): IDomainAdjustment[] {
  const ctx = buildAdjustmentContext(params);
  return DOMAIN_ADJUSTMENTS.filter((a) => a.appliesTo(ctx));
}

/** 取某体系在当前条件下应得的总调节分（0~10 量纲） */
export function resolveScoreDelta(systemId: string, params: IProjectParams): number {
  const ctx = buildAdjustmentContext(params);
  return DOMAIN_ADJUSTMENTS.filter((a) => a.appliesTo(ctx) && a.targetSystems.includes(systemId))
    .reduce((sum, a) => sum + a.scoreDelta, 0);
}

/** 取某体系在当前条件下应得的候选池筛选加成 */
export function resolveScreeningBonus(systemId: string, params: IProjectParams): number {
  const ctx = buildAdjustmentContext(params);
  return DOMAIN_ADJUSTMENTS.filter((a) => a.appliesTo(ctx) && a.targetSystems.includes(systemId))
    .reduce((sum, a) => sum + a.screeningBonus, 0);
}
