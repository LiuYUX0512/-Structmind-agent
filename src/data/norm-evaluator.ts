// 规范求值器（判定层）
// 职责：① 数值估算（纯函数）② 按规则层声明的 severity 给出判定等级 ③ 生成可追溯的判定理由
//
// 对应架构诊断 P0-1 的三处修复：
// 1. 剪重比：原实现 = λ_min × 1.3 × 场地系数，恒大于限值 → 永远 pass（装饰性检查）。
//    改为底部剪力法 λ = 0.85 × α₁(T₁, Tg, α_max)，高柔长周期结构会真实出现剪重比不足。
// 2. 周期比：原实现 = 纯查表常量，与平面布置无关 → 永远 pass。
//    改为「规则平面基准值 + 高宽比修正 + 大跨空间修正」，高宽比过大时真实超限。
// 3. 高度适用范围：严重性为强制性（severity: mandatory），超限必须判 fail，
//    不再降级为 warning（旧实现导致「不破红线」护栏成为死代码）。
// EXPORTS: evaluateCompliance, estimateSeismicInfluenceCoefficient,
//          estimateSeismicShearCoefficient, estimateTorsionPeriodRatio,
//          estimateDriftRatio, resolveBuildingHeight, STANDARDS_BY_SYSTEM

import {
  RULE_REGISTRY,
  calculateBuildingHeight,
  getHeightLimit,
  getDriftLimit,
  getShearWeightRatioMin,
  getPeriodCoeff,
  getPeriodRatioBase,
  getAlphaMax,
  getCharPeriod,
  isKnownSystem,
  listKnownSystemIds,
  type IRuleContext,
  type IRuleSeverity,
} from './code-rules';
import type {
  IProjectParams,
  INormCheckItem,
  INormCompliance,
} from './structure';

// ============ 各体系引用的标准清单 ============

export const STANDARDS_BY_SYSTEM: Record<string, string[]> = {
  frame: [
    'GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）',
    'GB 55008-2021《混凝土结构通用规范》（强制性）',
    'GB 55037-2022《建筑防火通用规范》（强制性）',
    '《建筑抗震设计标准》GB/T 50011-2010（2024年局部修订）',
    '《混凝土结构设计标准》GB/T 50010-2010（2024年局部修订）',
    '《建筑结构荷载规范》GB 50009-2012',
  ],
  'frame-shearwall': [
    'GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）',
    'GB 55008-2021《混凝土结构通用规范》（强制性）',
    'GB 55037-2022《建筑防火通用规范》（强制性）',
    '《建筑抗震设计标准》GB/T 50011-2010（2024年局部修订）',
    '《混凝土结构设计标准》GB/T 50010-2010（2024年局部修订）',
    '《高层建筑混凝土结构技术规程》JGJ 3-2010',
    '《建筑结构荷载规范》GB 50009-2012',
  ],
  shearwall: [
    'GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）',
    'GB 55008-2021《混凝土结构通用规范》（强制性）',
    'GB 55037-2022《建筑防火通用规范》（强制性）',
    '《建筑抗震设计标准》GB/T 50011-2010（2024年局部修订）',
    '《混凝土结构设计标准》GB/T 50010-2010（2024年局部修订）',
    '《高层建筑混凝土结构技术规程》JGJ 3-2010',
  ],
  steel: [
    'GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）',
    'GB 55037-2022《建筑防火通用规范》（强制性）',
    '《建筑抗震设计标准》GB/T 50011-2010（2024年局部修订）',
    '《钢结构设计标准》GB/T 50017-2017',
    '《高层民用建筑钢结构技术规程》JGJ 99-2015',
    '《建筑设计防火规范》GB 50016-2014（2018版）',
  ],
  prefabricated: [
    'GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）',
    'GB 55008-2021《混凝土结构通用规范》（强制性）',
    'GB 55037-2022《建筑防火通用规范》（强制性）',
    '《建筑抗震设计标准》GB/T 50011-2010（2024年局部修订）',
    '《装配式混凝土建筑技术标准》GB/T 51231-2016',
    '《装配式建筑评价标准》GB/T 51129-2017',
    '《混凝土结构设计标准》GB/T 50010-2010（2024年局部修订）',
  ],
  'prefab-steel': [
    'GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）',
    'GB 55006-2021《钢结构通用规范》（强制性）',
    'GB 55037-2022《建筑防火通用规范》（强制性）',
    '《钢结构设计标准》GB/T 50017-2017',
    '《装配式钢结构建筑技术标准》GB/T 51232-2016',
    '《装配式建筑评价标准》GB/T 51129-2017',
  ],
  composite: [
    'GB 55004-2021《组合结构通用规范》（强制性）',
    'GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）',
    'GB 55008-2021《混凝土结构通用规范》（强制性）',
    'GB 55037-2022《建筑防火通用规范》（强制性）',
    '《混凝土结构设计标准》GB/T 50010-2010（2024年局部修订）',
    '《钢结构设计标准》GB/T 50017-2017',
  ],
  masonry: [
    'GB 55007-2021《砌体结构通用规范》（强制性）',
    'GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）',
    'GB 55037-2022《建筑防火通用规范》（强制性）',
    '《砌体结构设计规范》GB 50003-2011',
    '《建筑抗震设计标准》GB/T 50011-2010（2024年局部修订）',
  ],
  'frame-corewall': [
    'GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）',
    'GB 55008-2021《混凝土结构通用规范》（强制性）',
    'GB 55037-2022《建筑防火通用规范》（强制性）',
    '《混凝土结构设计标准》GB/T 50010-2010（2024年局部修订）',
    '《高层建筑混凝土结构技术规程》JGJ 3-2010',
  ],
  'tube-in-tube': [
    'GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）',
    'GB 55008-2021《混凝土结构通用规范》（强制性）',
    'GB 55037-2022《建筑防火通用规范》（强制性）',
    '《混凝土结构设计标准》GB/T 50010-2010（2024年局部修订）',
    '《高层建筑混凝土结构技术规程》JGJ 3-2010',
  ],
  'mass-timber': [
    'GB 55005-2021《木结构通用规范》（强制性）',
    'GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）',
    'GB 55037-2022《建筑防火通用规范》（强制性）',
    '《木结构设计标准》GB 50005-2017',
  ],
  'space-truss': [
    'GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）',
    'GB 55006-2021《钢结构通用规范》（强制性）',
    'GB 55037-2022《建筑防火通用规范》（强制性）',
    '《钢结构设计标准》GB/T 50017-2017',
    '《空间网格结构技术规程》JGJ 7-2010',
  ],
};

// ============ 数值估算（纯函数）============

/** 建筑高度（m）：优先取用户填写值，否则按层数×3m 估算 */
export function resolveBuildingHeight(params: IProjectParams): number {
  const manual = Number(params.buildingHeight);
  if (Number.isFinite(manual) && manual > 0) return Math.round(manual * 10) / 10;
  return calculateBuildingHeight(params.floors);
}

export function parseIntensity(raw: string): number {
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? 7 : Math.max(6, Math.min(9, parsed));
}

/**
 * 地震影响系数 α(T)
 * GB/T 50011-2010（2024年局部修订）第 5.1.5 条反应谱曲线（阻尼比 ζ=0.05）：
 *   T ≤ 0.1s      α = (0.45 + 5.5T)·α_max      （上升段，T=0.1 处为 α_max）
 *   0.1 < T ≤ Tg  α = α_max                     （平台段）
 *   Tg < T ≤ 5Tg  α = (Tg/T)^0.9 · α_max        （曲线下降段，γ=0.9、η₂=1）
 *   5Tg < T ≤ 6s  α = [0.2^0.9 − 0.02(T − 5Tg)]·α_max   （直线下降段，η₁=0.02）
 */
export function estimateSeismicInfluenceCoefficient(
  period: number,
  charPeriod: number,
  alphaMax: number
): number {
  const T = Math.max(0.01, period);
  const Tg = charPeriod;
  let alpha: number;
  if (T <= 0.1) {
    alpha = (0.45 + 5.5 * T) * alphaMax;
  } else if (T <= Tg) {
    alpha = alphaMax;
  } else if (T <= 5 * Tg) {
    alpha = Math.pow(Tg / T, 0.9) * alphaMax;
  } else {
    const t5 = 5 * Tg;
    alpha = (Math.pow(0.2, 0.9) - 0.02 * (Math.min(T, 6) - t5)) * alphaMax;
  }
  return Math.max(0, alpha);
}

/** 结构基本自振周期 T1 ≈ 系数 × 层数（经验公式） */
export function estimateFundamentalPeriod(schemeId: string, floors: number): number {
  return Math.round(getPeriodCoeff(schemeId) * floors * 100) / 100;
}

/**
 * 楼层最小地震剪力系数（剪重比）估算 —— 底部剪力法
 * λ = V/G = α₁ · G_eq/G = 0.85 · α₁  （等效总重力荷载 G_eq ≈ 0.85G）
 *
 * 与旧实现的本质差别：旧实现用 λ_min × 1.3 反推估算值，数学上恒大于限值，
 * 导致剪重比永远 pass；本实现用反应谱真实估算，长周期高柔结构会真实出现
 * 剪重比不足 —— 这正是规范设置最小剪力系数要控制的工程问题。
 */
export function estimateSeismicShearCoefficient(
  schemeId: string,
  params: IProjectParams
): {
  lambda: number;
  alpha: number;
  period: number;
  charPeriod: number;
  alphaMax: number;
} {
  const intensity = parseIntensity(params.seismicIntensity);
  const period = estimateFundamentalPeriod(schemeId, params.floors);
  const charPeriod = getCharPeriod(params.soilCategory);
  const alphaMax = getAlphaMax(intensity);
  const alpha = estimateSeismicInfluenceCoefficient(period, charPeriod, alphaMax);
  const lambda = Math.round(0.85 * alpha * 10000) / 10000;
  return { lambda, alpha, period, charPeriod, alphaMax };
}

/**
 * 扭转周期比 Tt/T1 估算
 * = 规则平面基准值 + 高宽比修正 + 大跨空间修正
 *
 * 与旧实现的本质差别：旧实现是纯查表常量，与建筑平面、高宽比无关，永远 pass。
 * 本实现引入高宽比 H/B（B 取单层面积等效边长）：结构越高越瘦，扭转效应越显著，
 * 周期比越容易超限；大跨空间建筑因抗侧力构件分布不均同样上调。
 */
export function estimateTorsionPeriodRatio(
  schemeId: string,
  params: IProjectParams,
  height: number
): { ratio: number; base: number; aspectRatio: number; adjustment: number; note: string } {
  const base = getPeriodRatioBase(schemeId);
  const floors = Math.max(1, params.floors);
  const planWidth = Math.sqrt(Math.max(1, params.area) / floors);
  const aspectRatio = Math.round((height / planWidth) * 100) / 100;

  let adjustment = 0;
  const notes: string[] = [];

  // 高宽比修正：H/B 超过 5 后，每超出 1 个单位周期比上调 0.03（上限 +0.25）
  if (aspectRatio > 5) {
    adjustment += Math.min(0.25, 0.03 * (aspectRatio - 5));
    notes.push(`高宽比 H/B≈${aspectRatio.toFixed(1)} 偏大，扭转效应显著`);
  } else {
    notes.push(`高宽比 H/B≈${aspectRatio.toFixed(1)}，平面较规则`);
  }

  // 大跨空间建筑：抗侧力构件分布不均，扭转效应上调
  const isLargeSpanSpace =
    (params.buildingType === 'gymnasium' || params.buildingType === 'factory') &&
    params.mainSpan >= 18;
  if (isLargeSpanSpace) {
    adjustment += 0.03;
    notes.push('大跨空间建筑刚度分布不均');
  }

  const ratio = Math.round(Math.min(0.98, Math.max(0.5, base + adjustment)) * 100) / 100;
  return {
    ratio,
    base,
    aspectRatio,
    adjustment: Math.round(adjustment * 1000) / 1000,
    note: notes.join('；'),
  };
}

/**
 * 弹性层间位移角估算
 * 基于 8 度、100m、Ⅱ类场地的经验基准值，按烈度 / 高度 / 场地线性修正。
 */
export function estimateDriftRatio(
  schemeId: string,
  intensity: number,
  height: number,
  soilCategory: string
): number {
  const baseDrift: Record<string, number> = {
    frame: 1 / 400,
    'frame-shearwall': 1 / 900,
    shearwall: 1 / 1200,
    steel: 1 / 220,
    prefabricated: 1 / 850,
    'prefab-steel': 1 / 230,
    composite: 1 / 500,
    masonry: 1 / 1500,
    'frame-corewall': 1 / 950,
    'tube-in-tube': 1 / 850,
    'mass-timber': 1 / 300,
    'space-truss': 1 / 250,
    'frame-corewall-frame': 1 / 950,
  };

  let drift = baseDrift[schemeId] || 1 / 800;

  // 烈度修正：每增减 1 度，α_max 约翻倍（GB/T 50011 表 5.1.4-1），考虑刚度随烈度调整取 1.8 倍/度
  drift *= Math.pow(1.8, intensity - 8);
  // 高度修正：100m 基准，越高位移角越大
  drift *= Math.max(0.5, Math.min(2, height / 100));
  // 场地类别修正：Ⅲ/Ⅳ类场地土位移角略有增大
  if (soilCategory === 'Ⅲ') drift *= 1.1;
  if (soilCategory === 'Ⅳ') drift *= 1.2;

  return drift;
}

/** 抗震等级近似判定（用于轴压比限值取值） */
export function estimateSeismicGrade(
  intensity: number,
  height: number
): { grade: 'grade1_9' | 'grade1_78' | 'grade23'; label: string } {
  const isHighrise = height > 80;
  if (intensity >= 9) return { grade: 'grade1_9', label: '一级（9度）' };
  if (intensity >= 7 && isHighrise) return { grade: 'grade1_78', label: '一级（7/8度）' };
  return { grade: 'grade23', label: '二、三级' };
}

// ============ 判定 ============

/** 判定入参：实际值越小越好（如位移角、造价）时为 true */
function judge(
  severity: IRuleSeverity,
  actual: number,
  limit: number,
  lowerIsBetter: boolean
): { status: INormCheckItem['status']; nearLimit: boolean; marginPct: number } {
  const ratio = lowerIsBetter ? actual / limit : limit / Math.max(actual, 1e-9);
  const ok = lowerIsBetter ? actual <= limit : actual >= limit;
  // 余量：距限值还有多少（0 = 恰好卡线，1 = 无限余量）
  const marginPct = Math.round((1 - 1 / Math.max(ratio, 1e-9)) * 100);

  if (severity === 'advisory') {
    return { status: 'warning', nearLimit: true, marginPct };
  }
  if (!ok) return { status: 'fail', nearLimit: true, marginPct };
  // 接近限值：实际值已达限值的 90% 以上（按不利方向计）
  const nearLimit = ratio >= 0.9;
  return { status: nearLimit ? 'warning' : 'pass', nearLimit, marginPct };
}

// ============ 主入口 ============

/**
 * 规范符合性求值
 * @throws 结构体系或场地类别未知时抛错（消灭静默兜底：宁可显式报错，也不给看似专业的错误答案）
 */
export function evaluateCompliance(schemeId: string, params: IProjectParams): INormCompliance {
  if (!isKnownSystem(schemeId)) {
    throw new Error(
      `未知结构体系「${schemeId}」，无法进行规范校核。已知体系：${listKnownSystemIds().join('、')}`
    );
  }

  const intensity = parseIntensity(params.seismicIntensity);
  const height = resolveBuildingHeight(params);

  const driftEstimate = estimateDriftRatio(schemeId, intensity, height, params.soilCategory);
  const driftLimit = getDriftLimit(schemeId);
  const swrMin = getShearWeightRatioMin(schemeId, intensity);
  const swr = estimateSeismicShearCoefficient(schemeId, params);
  const torsion = estimateTorsionPeriodRatio(schemeId, params, height);
  const periodLimit = height > 150 ? 0.85 : 0.9;
  const heightLimit = getHeightLimit(schemeId, intensity);

  const ctx: IRuleContext = {
    schemeId,
    params,
    intensity,
    height,
    period: swr.period,
    aspectRatio: torsion.aspectRatio,
  };

  const checks: INormCheckItem[] = [];

  for (const rule of RULE_REGISTRY) {
    if (!rule.appliesTo(ctx)) continue;

    switch (rule.id) {
      case 'drift': {
        const v = judge(rule.severity, driftEstimate, driftLimit, true);
        checks.push({
          name: rule.name,
          status: v.status,
          value: `1/${Math.round(1 / driftEstimate)}`,
          requirement: `≤ 1/${Math.round(1 / driftLimit)}`,
          description:
            v.status === 'fail'
              ? '层间位移角超出规范限值，需调整结构布置或增大刚度'
              : '风荷载及多遇地震作用下弹性层间位移角满足规范限值要求',
          calcChain: {
            basis: rule.source,
            input: `烈度 ${intensity}度、高度 ${height}m、场地 ${params.soilCategory}类、层数 ${params.floors}层`,
            formula: 'Δu/h = 基准值 × 烈度修正 × 高度修正 × 场地修正',
            result: `估算值 1/${Math.round(1 / driftEstimate)}，限值 1/${Math.round(1 / driftLimit)}`,
          },
          clauseText: rule.clauseText,
          source: rule.source,
          severity: rule.severity,
          reason:
            v.status === 'fail'
              ? `位移角 1/${Math.round(1 / driftEstimate)} 超出限值 1/${Math.round(1 / driftLimit)}，说明该体系在${intensity}度地震作用下侧向刚度不足，需增设抗震墙或加大构件截面。`
              : v.nearLimit
                ? `位移角 1/${Math.round(1 / driftEstimate)} 接近限值 1/${Math.round(1 / driftLimit)}，侧向刚度偏紧，设计中应注意合理布置剪力墙和核心筒。`
                : `本工程约 ${height}m 高，在${intensity}度多遇地震作用下位移角约 1/${Math.round(1 / driftEstimate)}，小于限值 1/${Math.round(1 / driftLimit)}，侧向刚度有充足余量。`,
        });
        break;
      }

      case 'swr': {
        const v = judge(rule.severity, swr.lambda, swrMin, false);
        const pct = (swr.lambda * 100).toFixed(2);
        const minPct = (swrMin * 100).toFixed(1);
        checks.push({
          name: rule.name,
          status: v.status,
          value: `${pct}%`,
          requirement: `≥ ${minPct}%（${intensity}度设防）`,
          description:
            v.status === 'fail'
              ? '楼层地震剪力系数低于规范最小值，需按规范调整地震作用或优化结构布置'
              : '各楼层地震剪力系数满足规范最小值要求，安全储备充足',
          calcChain: {
            basis: rule.source,
            input: `烈度 ${intensity}度（α_max=${swr.alphaMax}）、场地 ${params.soilCategory}类（Tg=${swr.charPeriod}s）、基本周期 T1≈${swr.period}s`,
            formula: 'λ = 0.85 · α₁；α₁ = α(T₁) 按 GB/T 50011 反应谱曲线取值',
            result: `α₁=${(swr.alpha * 1000).toFixed(2)}‰，估算剪重比 λ=${pct}%，限值 ${minPct}%`,
          },
          clauseText: rule.clauseText,
          source: rule.source,
          severity: rule.severity,
          reason:
            v.status === 'fail'
              ? `本工程基本周期 T1≈${swr.period}s 较长，位于反应谱下降段，地震影响系数仅 ${(swr.alpha * 1000).toFixed(2)}‰，估算剪重比 ${pct}% 低于 ${intensity}度规范最小值 ${minPct}%。这是高柔结构的典型问题：需按 GB/T 50011 第 5.2.5 条放大地震作用，或通过增设抗震墙缩短周期、增大侧向刚度。`
              : v.nearLimit
                ? `估算剪重比约 ${pct}%，略高于规范最小值 ${minPct}%（基本周期 T1≈${swr.period}s，已处反应谱下降段），设计阶段应复核地震作用放大系数。`
                : `估算剪重比约 ${pct}%，高于规范最小值 ${minPct}%（α₁=${(swr.alpha * 1000).toFixed(2)}‰，T1≈${swr.period}s），地震作用满足最小剪力要求。`,
        });
        break;
      }

      case 'period': {
        const v = judge(rule.severity, torsion.ratio, periodLimit, true);
        checks.push({
          name: rule.name,
          status: v.status,
          value: torsion.ratio.toFixed(2),
          requirement: `≤ ${periodLimit}（${height > 150 ? 'B级高度' : 'A级高度'}）`,
          description:
            v.status === 'fail'
              ? '周期比超出规范限值，结构扭转效应显著，需调整抗侧力构件布置'
              : '扭转周期与平动周期之比满足规范要求，结构抗扭性能良好',
          calcChain: {
            basis: rule.source,
            input: `体系基准 Tt/T1=${torsion.base}；高宽比 H/B≈${torsion.aspectRatio}（H=${height}m，等效平面宽度≈${Math.sqrt(Math.max(1, params.area) / Math.max(1, params.floors)).toFixed(1)}m）；基本周期 T1≈${swr.period}s`,
            formula: 'Tt/T1 = 规则平面基准值 + 高宽比修正 + 大跨空间修正',
            result: `${torsion.base} + ${torsion.adjustment.toFixed(3)} = ${torsion.ratio.toFixed(2)}，限值 ${periodLimit}`,
          },
          clauseText: rule.clauseText,
          source: rule.source,
          severity: rule.severity,
          reason:
            v.status === 'fail'
              ? `估算周期比 Tt/T1 ≈ ${torsion.ratio.toFixed(2)}，超出限值 ${periodLimit}。${torsion.note}。需在设计中使抗侧力构件尽量均匀对称布置，减小刚度偏心，必要时增设外围抗侧力构件。`
              : v.nearLimit
                ? `估算周期比 Tt/T1 ≈ ${torsion.ratio.toFixed(2)} 接近限值 ${periodLimit}（${torsion.note}），设计中应注意抗侧力构件均匀布置，减小扭转效应。`
                : `估算周期比 Tt/T1 ≈ ${torsion.ratio.toFixed(2)}，满足规范限值 ${periodLimit}（${torsion.note}），抗扭性能良好。`,
        });
        break;
      }

      case 'height': {
        const v = judge(rule.severity, height, heightLimit, true);
        checks.push({
          name: rule.name,
          status: v.status,
          value: `${height} m`,
          requirement: `≤ ${heightLimit} m（${intensity}度）`,
          description:
            v.status === 'fail'
              ? '建筑高度超出该体系规范最大适用高度，属于超限工程，需进行超限抗震设防专项审查'
              : '建筑高度在该结构体系的规范适用范围内',
          calcChain: {
            basis: rule.source,
            input: `结构体系 ${schemeId}、${intensity}度设防、建筑高度 ${height}m`,
            formula: 'H ≤ H_max(结构体系, 设防烈度)',
            result: `${height}m ${height <= heightLimit ? '≤' : '>'} ${heightLimit}m`,
          },
          clauseText: rule.clauseText,
          source: rule.source,
          severity: rule.severity,
          reason:
            v.status === 'fail'
              ? `建筑高度 ${height}m 超出规范适用最大高度 ${heightLimit}m（${intensity}度），已属超限高层范畴。该体系在本工程高度下不再适用，必须换用适用高度更高的结构体系，或按 GB 55002-2021 规定组织超限工程抗震设防专项审查。`
              : v.nearLimit
                ? `建筑高度 ${height}m 接近规范适用最大高度 ${heightLimit}m（${intensity}度），余量不足 10%，设计中应关注整体稳定与侧向刚度。`
                : `建筑高度 ${height}m ≤ 规范适用最大高度 ${heightLimit}m（${intensity}度），属于常规适用范围，无需超限专项论证。`,
        });
        break;
      }

      case 'axial_ratio': {
        const grade = estimateSeismicGrade(intensity, height);
        const limitValue =
          grade.grade === 'grade1_9' ? 0.4 : grade.grade === 'grade1_78' ? 0.5 : 0.6;
        const bands: Record<string, { min: number; max: number }> = {
          grade1_9: { min: 0.35, max: 0.42 },
          grade1_78: { min: 0.4, max: 0.48 },
          grade23: { min: 0.42, max: 0.55 },
        };
        const band = bands[grade.grade];
        const estimated = `${band.min.toFixed(2)}~${band.max.toFixed(2)}`;
        const avg = (band.min + band.max) / 2;
        const pass = band.max <= limitValue;
        const nearLimit = avg / limitValue > 0.85;
        const status: INormCheckItem['status'] = pass ? (nearLimit ? 'warning' : 'pass') : 'fail';
        checks.push({
          name: rule.name,
          status,
          value: estimated,
          requirement: `≤ ${limitValue.toFixed(2)}（底部加强部位，${grade.label}）`,
          description:
            status === 'fail'
              ? '墙肢轴压比超出限值，需加大墙肢截面或提高混凝土强度等级'
              : '底部加强部位墙肢轴压比满足规范限值要求，有一定安全储备',
          calcChain: {
            basis: rule.source,
            input: `${intensity}度设防、房屋高度 ${height}m、底部加强部位、近似抗震等级 ${grade.label}`,
            formula: 'N/(fc·A)，按经验估算，仅供方案阶段参考',
            result: `估算 ${estimated}，限值 ${limitValue.toFixed(2)}`,
          },
          clauseText: rule.clauseText,
          source: rule.source,
          severity: rule.severity,
          reason:
            status === 'fail'
              ? `墙肢轴压比估算 ${estimated} 超出限值 ${limitValue.toFixed(2)}（${grade.label}），延性不足，设计中应加大底部加强部位墙肢截面或提高混凝土强度等级。`
              : nearLimit
                ? `墙肢轴压比估算 ${estimated} 接近限值 ${limitValue.toFixed(2)}（${grade.label}），设计中应注意底部加强部位墙肢截面和混凝土强度等级的合理匹配。`
                : `底部加强部位墙肢轴压比估算 ${estimated}，低于限值 ${limitValue.toFixed(2)}（${grade.label}），墙肢延性满足要求。`,
        });
        break;
      }

      case 'fire_protection': {
        checks.push({
          name: rule.name,
          status: 'warning',
          description: '钢结构构件需做防火涂料保护，柱3h、梁2h耐火极限',
          calcChain: {
            basis: rule.source,
            input: `钢结构柱、梁、楼板；建筑高度 ${height}m`,
            formula: '按建筑高度和耐火等级确定构件耐火极限',
            result: '需防火涂料保护',
          },
          clauseText: rule.clauseText,
          source: rule.source,
          severity: rule.severity,
          reason: `钢结构自身耐火性能差（约 15min 即失稳），本工程约 ${height}m 高建筑按一级耐火等级设计，钢柱需达到 3h、钢梁 2h 耐火极限，需做防火涂料或防火板包覆，防火保护造价约占结构造价 3~5%。`,
        });
        break;
      }

      default:
        break;
    }
  }

  const passCount = checks.filter((c) => c.status === 'pass').length;
  const warnCount = checks.filter((c) => c.status === 'warning').length;
  const failCount = checks.filter((c) => c.status === 'fail').length;

  let summary = '';
  if (failCount > 0) {
    summary = `有 ${failCount} 项指标不满足规范要求，需重新评估结构方案。`;
  } else if (warnCount > 0) {
    summary = `各项主要控制指标基本满足规范要求，有 ${warnCount} 项指标接近限值或需注意，设计中应予关注。`;
  } else {
    summary = '各项控制指标均满足规范要求，抗震安全储备充足。';
  }
  summary +=
    ' 本计算基于经验公式与简化假定，仅用于方案前期概念比选与决策参考，不构成任何设计依据；实际工程设计必须由注册结构工程师主持，采用专业结构分析软件按现行国家标准逐项复核。';

  return {
    standards: STANDARDS_BY_SYSTEM[schemeId] || STANDARDS_BY_SYSTEM['frame-shearwall'],
    checks,
    summary,
  };
}
