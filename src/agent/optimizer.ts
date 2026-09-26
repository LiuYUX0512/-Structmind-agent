// 自主优化引擎
// 核心：从当前推荐方案出发，按用户选择的优化目标，自动跑 3-5 轮迭代
// 每轮：分析短板 → 决定调整杠杆 → 调用工具重算指标 → 对比保留/回退
// EXPORTS:
//   runOptimization,
//   type IOptimizationGoal,
//   type IOptimizationIteration,
//   type IOptimizationResult,
//   generateOptimizationSuggestions,

import {
  STRUCTURE_SYSTEM_LIBRARY,
  generateSchemesFromParams,
  estimateCost,
  estimateDuration,
  estimateCarbonEmission,
  estimatePrecastRate,
  calculateNormCompliance,
  calculateBuildingHeight,
  type IStructureScheme,
  type IProjectParams,
  type IWeightConfig,
  type IRecommendation,
} from '@/data/structure';
import { computeSchemeScore } from './scoring';

// ============ 类型定义 ============

export type IOptimizationGoal =
  | 'cost'
  | 'duration'
  | 'precast'
  | 'green'
  | 'safety';

export interface IOptimizationLever {
  /** 杠杆类型 */
  type: 'system_switch' | 'span_adjust' | 'intensity_adjust' | 'precast_adjust';
  /** 调整描述（展示用） */
  description: string;
  /** 调整后的参数 */
  newSystemId?: string;
  newSpan?: number;
  /** 预期影响方向 */
  expectedImpact: string;
}

export interface IOptimizationIteration {
  /** 轮次编号，0 = 原方案 */
  round: number;
  /** 本轮思考（分析短板 + 决定调哪个杠杆） */
  thought: string;
  /** 本轮调整的杠杆 */
  lever?: IOptimizationLever;
  /** 重算后的方案（调整成功时） */
  scheme?: IStructureScheme;
  /** 关键指标变化（与上一轮对比） */
  delta?: {
    cost: number;
    duration: number;
    precastRate: number;
    carbon: number;
    seismic: number;
  };
  /** 决策：'accepted' 接受 / 'rejected' 回退 / 'baseline' 基准 */
  decision: 'baseline' | 'accepted' | 'rejected';
  /** 决策理由 */
  decisionReason: string;
  /** 目标达成情况 */
  goalProgress?: {
    target: string;
    achieved: boolean;
    currentValue: number;
    targetValue: number;
  };
  /** Agent 自评：本轮后目标是否已足够好、是否继续、下一轮方向 */
  selfAssessment?: {
    /** 自评结论：continue 继续 / stop 达标停止 / stop_no_levers 无杠杆停止 */
    verdict: 'continue' | 'stop_target_met' | 'stop_diminishing' | 'stop_no_levers';
    /** 自评说明文字（展示在时间线上） */
    summary: string;
    /** 剩余优化空间预估（百分比） */
    remainingPotentialPct: number;
    /** 是否判断目标已达成 */
    goalMet: boolean;
  };
}

export interface IOptimizationResult {
  /** 优化目标 */
  goal: IOptimizationGoal;
  /** 目标预算（成本优先时有值，单位：元/㎡） */
  targetBudget?: number;
  /** 迭代历史（第 0 项 = 原始方案） */
  iterations: IOptimizationIteration[];
  /** 最终优化后方案 */
  finalScheme: IStructureScheme;
  /** 优化总结 */
  summary: {
    totalRounds: number;
    acceptedRounds: number;
    originalCost: number;
    finalCost: number;
    originalDuration: number;
    finalDuration: number;
    originalPrecastRate: number;
    finalPrecastRate: number;
    originalCarbon: number;
    finalCarbon: number;
    originalSeismic: number;
    finalSeismic: number;
    goalAchieved: boolean;
    keyInsight: string;
    /** Agent 自主停止原因（展示用） */
    agentStopReason?: string;
  };
}

// ============ 核心优化引擎 ============

/**
 * 执行自主优化循环
 * @param baseScheme 初始方案（推荐方案）
 * @param params 项目参数
 * @param weights 权重配置
 * @param goal 优化目标
 * @param targetBudget 目标预算（成本优先时）
 * @param maxRounds 最大迭代轮次，默认 4
 */
export function runOptimization(
  baseScheme: IStructureScheme,
  params: IProjectParams,
  weights: IWeightConfig,
  goal: IOptimizationGoal,
  targetBudget?: number,
  maxRounds = 4,
  lockedParams?: Partial<Record<keyof IProjectParams, boolean>>
): IOptimizationResult {
  const iterations: IOptimizationIteration[] = [];

  // 🔴 关键：用当前参数重算基准方案指标，保证与后续迭代同一计算基准
  // 否则体系库静态值（10层/7度/8m跨）与动态计算值不可比
  const initialCandidates = generateSchemesFromParams(params);
  let normalizedBase = initialCandidates.find((s) => s.id === baseScheme.id);
  if (!normalizedBase) {
    // 如果参数下基准方案不在候选池中（如被筛选掉），取候选池中第一个
    normalizedBase = initialCandidates[0] ?? baseScheme;
  }

  let currentScheme: IStructureScheme = { ...normalizedBase, metrics: { ...normalizedBase.metrics } };
  let currentParams: IProjectParams = { ...params };

  // 第 0 轮：基准 + 首轮自评
  const baselineProgress = buildGoalProgress(goal, currentScheme, targetBudget);
  iterations.push({
    round: 0,
    thought: `初始方案：${currentScheme.name}，造价 ${currentScheme.metrics.cost} 元/㎡，工期 ${currentScheme.metrics.duration} 个月，装配率 ${currentScheme.metrics.precastRate.rate}%，碳排放 ${currentScheme.metrics.carbonEmission} kg/㎡。以该方案为基准开始优化迭代。`,
    decision: 'baseline',
    decisionReason: '原始推荐方案，作为优化基准线。',
    scheme: { ...currentScheme },
    goalProgress: baselineProgress,
    selfAssessment: agentSelfAssessment(goal, currentScheme, iterations, new Set<string>(), maxRounds, params, lockedParams),
  });

  // 已尝试过的杠杆（避免重复）
  const triedLevers = new Set<string>();

  for (let round = 1; round <= maxRounds; round++) {
    // 1. 分析短板，决定本轮杠杆
    const lever = pickNextLever(goal, currentScheme, currentParams, triedLevers, lockedParams);

    if (!lever) {
      // 没有可用杠杆，提前结束
      break;
    }

    triedLevers.add(leverKey(lever));

    // 2. 构造思考文本
    const thought = buildThought(round, goal, currentScheme, lever);

    // 3. 执行调整，重算指标
    const result = applyLever(lever, currentParams, currentScheme);
    const newScheme = result.scheme;
    const newParams = result.params;

    // 4. 计算变化量
    const delta = computeDelta(currentScheme, newScheme);

    // 5. 判断是否接受
    const { accepted, reason } = evaluateLever(goal, delta, currentScheme, newScheme, targetBudget);

    if (accepted) {
      currentScheme = newScheme;
      currentParams = newParams;
    }

    iterations.push({
      round,
      thought,
      lever,
      scheme: { ...newScheme },
      delta,
      decision: accepted ? 'accepted' : 'rejected',
      decisionReason: reason,
      goalProgress: buildGoalProgress(goal, accepted ? newScheme : currentScheme, targetBudget),
    });

    // 6. Agent 自评：判断方案够不够好，要不要继续
    const assessment = agentSelfAssessment(goal, accepted ? newScheme : currentScheme, iterations, triedLevers, maxRounds, currentParams, lockedParams);
    iterations[iterations.length - 1].selfAssessment = assessment;

    // 7. 自评决定：目标已达成 / 边际效益递减 → 提前停止
    if (assessment.verdict === 'stop_target_met' || assessment.verdict === 'stop_diminishing') {
      break;
    }
  }

  const original = iterations[0].scheme!;
  const summary = buildSummary(goal, iterations, original, currentScheme, targetBudget);

  return {
    goal,
    targetBudget,
    iterations,
    finalScheme: currentScheme,
    summary,
  };
}

// ============ 杠杆选择 ============

/**
 * 根据优化目标 + 当前方案，选择下一个尝试的杠杆
 */
function pickNextLever(
  goal: IOptimizationGoal,
  currentScheme: IStructureScheme,
  params: IProjectParams,
  tried: Set<string>,
  lockedParams?: Partial<Record<keyof IProjectParams, boolean>>
): IOptimizationLever | null {
  const allSystems = STRUCTURE_SYSTEM_LIBRARY.map((s) => s.id);

  // 按目标排序候选体系（成本优先→从便宜到贵；工期优先→从快到慢；装配率优先→从高到低）
  const rankedSystems = rankSystemsForGoal(goal, params);

  // 当前体系在排序列表中的位置
  const currentIdx = rankedSystems.indexOf(currentScheme.id);

  // 1) 体系切换杠杆（structurePreference 被锁定时禁用）
  if (!lockedParams?.structurePreference && (goal === 'cost' || goal === 'duration' || goal === 'precast' || goal === 'green' || goal === 'safety')) {
    // 找下一个"更偏目标方向"的体系（cost 找更便宜的 = 排名更靠前；其他同理）
    const candidates =
      goal === 'cost' || goal === 'green'
        ? rankedSystems.filter((s) => {
            const idx = rankedSystems.indexOf(s);
            return idx > currentIdx; // 更便宜/更绿色的排后面
          })
        : goal === 'duration'
          ? rankedSystems.filter((s) => rankedSystems.indexOf(s) < currentIdx) // 更快的排前面
          : rankedSystems.filter((s) => rankedSystems.indexOf(s) > currentIdx); // 装配率更高的排后面

    for (const sysId of candidates) {
      const lever: IOptimizationLever = {
        type: 'system_switch',
        newSystemId: sysId,
        description: `体系切换：${currentScheme.name} → ${getSystemName(sysId)}`,
        expectedImpact: describeSystemImpact(goal, sysId, params),
      };
      if (!tried.has(leverKey(lever))) return lever;
    }
  }

  // 2) 跨度调整杠杆（mainSpan 被锁定时禁用；成本优先时减小跨度降造价；安全优先时减小跨度增刚度）
  if (!lockedParams?.mainSpan && (goal === 'cost' || goal === 'safety') && params.mainSpan > 6) {
    const newSpan = Math.max(6, params.mainSpan - 2);
    const lever: IOptimizationLever = {
      type: 'span_adjust',
      newSpan,
      description: `跨度调整：${params.mainSpan}m → ${newSpan}m`,
      expectedImpact:
        goal === 'cost'
          ? '减小跨度可降低梁高和用钢量，造价下降约 3-5%'
          : '减小跨度可提高结构刚度，层间位移角更易满足',
    };
    if (!tried.has(leverKey(lever))) return lever;
  }

  // 3) 安全优先 → 升级体系（structurePreference 被锁定时禁用）
  if (!lockedParams?.structurePreference && goal === 'safety') {
    // 从低抗震到高抗震体系
    const safetyRanking = getSeismicRanking(params);
    const curSafetyIdx = safetyRanking.indexOf(currentScheme.id);
    const saferSystems = safetyRanking.filter((s) => safetyRanking.indexOf(s) < curSafetyIdx);
    for (const sysId of saferSystems) {
      const lever: IOptimizationLever = {
        type: 'system_switch',
        newSystemId: sysId,
        description: `体系升级：${currentScheme.name} → ${getSystemName(sysId)}`,
        expectedImpact: '抗震性能提升，抗侧刚度增大，安全冗余提高',
      };
      if (!tried.has(leverKey(lever))) return lever;
    }
  }

  return null;
}

/** 按目标对体系排序，越靠前越符合目标 */
function rankSystemsForGoal(goal: IOptimizationGoal, params: IProjectParams): string[] {
  // 用全库体系做估算排名，但只保留【高度合规】的体系——优化不能突破规范红线
  const height = calculateBuildingHeight(params.floors);
  const compliantSystems = STRUCTURE_SYSTEM_LIBRARY.filter((s) => {
    const compliance = calculateNormCompliance(s.id, params);
    // 只要不是高度超限，都可以作为候选（其他非致命问题可通过措施解决）
    return !compliance.checks.some((c) => c.status === 'fail' && c.name === '高度适用范围');
  });

  const allRanked = compliantSystems.map((s) => {
    const cost = estimateCost(s.id, params.floors, params.seismicIntensity, params.soilCategory, params.mainSpan);
    const duration = estimateDuration(s.id, params.area, params.floors);
    const carbon = estimateCarbonEmission(s.id, params.floors);
    const precast = estimatePrecastRate(s.id, params.floors);
    return { id: s.id, cost, duration, carbon, precastRate: precast.rate };
  });

  switch (goal) {
    case 'cost':
      // 造价从低到高（便宜的排后面，我们取"比当前更便宜"即 index > currentIdx）
      return [...allRanked].sort((a, b) => b.cost - a.cost).map((s) => s.id);
    case 'duration':
      // 工期从短到长（快的排前面）
      return [...allRanked].sort((a, b) => a.duration - b.duration).map((s) => s.id);
    case 'precast':
      // 装配率从低到高（高的排后面）
      return [...allRanked].sort((a, b) => a.precastRate - b.precastRate).map((s) => s.id);
    case 'green':
      // 碳排从低到高（低碳排的排后面）
      return [...allRanked].sort((a, b) => b.carbon - a.carbon).map((s) => s.id);
    case 'safety':
      return getSeismicRanking(params);
    default:
      return allRanked.map((s) => s.id);
  }
}

/** 抗震性能排序（性能好的排前面） */
function getSeismicRanking(params: IProjectParams): string[] {
  // 抗震性能主要由体系决定，从体系库取静态值
  const allRanked = STRUCTURE_SYSTEM_LIBRARY.map((s) => ({
    id: s.id,
    seismic: s.metrics.seismicPerformance,
  }));
  return [...allRanked].sort((a, b) => b.seismic - a.seismic).map((s) => s.id);
}

function getSystemName(id: string): string {
  return STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === id)?.name || id;
}

function leverKey(lever: IOptimizationLever): string {
  return `${lever.type}:${lever.newSystemId || ''}:${lever.newSpan || ''}`;
}

function describeSystemImpact(goal: IOptimizationGoal, systemId: string, params: IProjectParams): string {
  switch (goal) {
    case 'cost':
      return '更经济的结构体系，预期造价降低';
    case 'duration':
      return '施工速度更快的体系，预期工期缩短';
    case 'precast':
      return '预制程度更高的体系，预期装配率提升';
    case 'green':
      return '碳排放更低的体系，预期隐含碳减少';
    default:
      return '';
  }
}

// ============ 应用杠杆 ============

/**
 * 应用杠杆到当前方案，返回新方案 + 新参数
 */
function applyLever(
  lever: IOptimizationLever,
  params: IProjectParams,
  current: IStructureScheme
): { scheme: IStructureScheme; params: IProjectParams } {
  let newParams = { ...params };

  if (lever.type === 'system_switch' && lever.newSystemId) {
    newParams = { ...params, structurePreference: lever.newSystemId };
  } else if (lever.type === 'span_adjust' && lever.newSpan) {
    newParams = { ...params, mainSpan: lever.newSpan };
  }

  // 用 generateSchemesFromParams 重新生成所有方案，找到对应体系
  const allSchemes = generateSchemesFromParams(newParams);

  let targetId: string;
  if (lever.type === 'system_switch' && lever.newSystemId) {
    targetId = lever.newSystemId;
  } else {
    targetId = current.id;
  }

  const found = allSchemes.find((s) => s.id === targetId);

  if (found) {
    return { scheme: found, params: newParams };
  }

  // 找不到就返回当前（极端情况兜底）
  return { scheme: current, params };
}

// ============ 评估杠杆 ============

function evaluateLever(
  goal: IOptimizationGoal,
  delta: ReturnType<typeof computeDelta>,
  _current: IStructureScheme,
  _newScheme: IStructureScheme,
  targetBudget?: number
): { accepted: boolean; reason: string } {
  switch (goal) {
    case 'cost': {
      // 成本优先：造价降低就接受；升高则拒绝（除非安全/工期显著提升但这里简单处理）
      if (delta.cost < 0) {
        return { accepted: true, reason: `造价降低 ${Math.abs(delta.cost).toFixed(0)} 元/㎡，符合成本优化目标，接受。` };
      } else if (delta.cost === 0) {
        return { accepted: false, reason: '造价无变化，不接受。' };
      } else {
        return { accepted: false, reason: `造价升高 ${delta.cost.toFixed(0)} 元/㎡，不符合成本优化目标，回退。` };
      }
    }
    case 'duration': {
      if (delta.duration < 0) {
        return { accepted: true, reason: `工期缩短 ${Math.abs(delta.duration).toFixed(1)} 个月，符合工期优化目标，接受。` };
      } else if (delta.duration === 0) {
        return { accepted: false, reason: '工期无变化，不接受。' };
      } else {
        return { accepted: false, reason: `工期增加 ${delta.duration.toFixed(1)} 个月，不符合工期优化目标，回退。` };
      }
    }
    case 'precast': {
      if (delta.precastRate > 0) {
        return { accepted: true, reason: `装配率提升 ${delta.precastRate.toFixed(1)} 个百分点，符合装配率优化目标，接受。` };
      } else if (delta.precastRate === 0) {
        return { accepted: false, reason: '装配率无变化，不接受。' };
      } else {
        return { accepted: false, reason: `装配率下降 ${Math.abs(delta.precastRate).toFixed(1)} 个百分点，不符合装配率优化目标，回退。` };
      }
    }
    case 'green': {
      if (delta.carbon < 0) {
        return { accepted: true, reason: `碳排放减少 ${Math.abs(delta.carbon).toFixed(0)} kg/㎡，符合低碳优化目标，接受。` };
      } else if (delta.carbon === 0) {
        return { accepted: false, reason: '碳排放无变化，不接受。' };
      } else {
        return { accepted: false, reason: `碳排放增加 ${delta.carbon.toFixed(0)} kg/㎡，不符合低碳优化目标，回退。` };
      }
    }
    case 'safety': {
      if (delta.seismic > 0) {
        return { accepted: true, reason: `抗震性能提升 ${delta.seismic.toFixed(1)} 分，符合安全优化目标，接受。` };
      } else if (delta.seismic === 0) {
        return { accepted: false, reason: '抗震性能无变化，不接受。' };
      } else {
        return { accepted: false, reason: `抗震性能下降 ${Math.abs(delta.seismic).toFixed(1)} 分，不符合安全优化目标，回退。` };
      }
    }
    default:
      return { accepted: false, reason: '未知优化目标' };
  }
}

// ============ 辅助函数 ============

function computeDelta(old: IStructureScheme, next: IStructureScheme) {
  return {
    cost: next.metrics.cost - old.metrics.cost,
    duration: next.metrics.duration - old.metrics.duration,
    precastRate: next.metrics.precastRate.rate - old.metrics.precastRate.rate,
    carbon: next.metrics.carbonEmission - old.metrics.carbonEmission,
    seismic: next.metrics.seismicPerformance - old.metrics.seismicPerformance,
  };
}

function buildThought(
  round: number,
  goal: IOptimizationGoal,
  current: IStructureScheme,
  lever: IOptimizationLever
): string {
  const goalLabels: Record<IOptimizationGoal, string> = {
    cost: '成本优先',
    duration: '工期优先',
    precast: '装配率优先',
    green: '绿色低碳优先',
    safety: '安全冗余优先',
  };

  const lines: string[] = [];
  lines.push(`【第 ${round} 轮分析】优化目标：${goalLabels[goal]}。`);
  lines.push(`当前方案：${current.name}，`);

  switch (goal) {
    case 'cost':
      lines.push(`造价 ${current.metrics.cost} 元/㎡。`);
      break;
    case 'duration':
      lines.push(`工期 ${current.metrics.duration} 个月。`);
      break;
    case 'precast':
      lines.push(`装配率 ${current.metrics.precastRate.rate}%（${current.metrics.precastRate.grade}）。`);
      break;
    case 'green':
      lines.push(`碳排放 ${current.metrics.carbonEmission} kg/㎡。`);
      break;
    case 'safety':
      lines.push(`抗震性能 ${current.metrics.seismicPerformance}/10 分。`);
      break;
  }

  lines.push(`短板分析：${shortageAnalysis(goal, current)}。`);
  lines.push(`决定尝试：${lever.description}。`);
  lines.push(`预期效果：${lever.expectedImpact}。`);

  return lines.join('');
}

function shortageAnalysis(goal: IOptimizationGoal, scheme: IStructureScheme): string {
  switch (goal) {
    case 'cost':
      return `当前造价 ${scheme.metrics.cost} 元/㎡偏高，体系 ${scheme.name} 的主材成本占比较大`;
    case 'duration':
      return `当前工期 ${scheme.metrics.duration} 个月偏长，${scheme.name} 的现浇作业量较大`;
    case 'precast':
      return `当前装配率 ${scheme.metrics.precastRate.rate}%（${scheme.metrics.precastRate.grade}），尚未达到更高预制等级`;
    case 'green':
      return `当前隐含碳排放 ${scheme.metrics.carbonEmission} kg/㎡，有进一步减排空间`;
    case 'safety':
      return `当前抗震性能 ${scheme.metrics.seismicPerformance}/10 分，安全冗余可进一步提升`;
    default:
      return '有进一步优化空间';
  }
}

function buildGoalProgress(
  goal: IOptimizationGoal,
  scheme: IStructureScheme,
  targetBudget?: number
): IOptimizationIteration['goalProgress'] {
  switch (goal) {
    case 'cost': {
      const target = targetBudget || 3500;
      return {
        target: `造价 ≤ ${target} 元/㎡`,
        achieved: scheme.metrics.cost <= target,
        currentValue: scheme.metrics.cost,
        targetValue: target,
      };
    }
    case 'duration':
      return {
        target: '工期尽可能短',
        achieved: false, // 工期没有绝对达标，持续优化
        currentValue: scheme.metrics.duration,
        targetValue: 0,
      };
    case 'precast':
      return {
        target: '装配率尽可能高',
        achieved: scheme.metrics.precastRate.rate >= 90,
        currentValue: scheme.metrics.precastRate.rate,
        targetValue: 90,
      };
    case 'green':
      return {
        target: '碳排放尽可能低',
        achieved: false,
        currentValue: scheme.metrics.carbonEmission,
        targetValue: 0,
      };
    case 'safety':
      return {
        target: '抗震性能 ≥ 9 分',
        achieved: scheme.metrics.seismicPerformance >= 9,
        currentValue: scheme.metrics.seismicPerformance,
        targetValue: 9,
      };
    default:
      return undefined;
  }
}

function buildSummary(
  goal: IOptimizationGoal,
  iterations: IOptimizationIteration[],
  original: IStructureScheme,
  final: IStructureScheme,
  targetBudget?: number
): IOptimizationResult['summary'] {
  const acceptedRounds = iterations.filter((i) => i.decision === 'accepted').length;
  const goalLabels: Record<IOptimizationGoal, string> = {
    cost: '成本',
    duration: '工期',
    precast: '装配率',
    green: '低碳',
    safety: '安全',
  };

  let keyInsight = '';
  switch (goal) {
    case 'cost': {
      const pct = ((original.metrics.cost - final.metrics.cost) / original.metrics.cost) * 100;
      keyInsight =
        pct > 0
          ? `通过 ${acceptedRounds} 轮有效迭代，造价从 ${original.metrics.cost} 元/㎡降至 ${final.metrics.cost} 元/㎡，降幅 ${pct.toFixed(1)}%`
          : '当前方案已是该条件下的最优经济性方案';
      break;
    }
    case 'duration': {
      const diff = original.metrics.duration - final.metrics.duration;
      keyInsight =
        diff > 0
          ? `通过 ${acceptedRounds} 轮有效迭代，工期从 ${original.metrics.duration} 个月缩短至 ${final.metrics.duration} 个月，缩短 ${diff.toFixed(1)} 个月`
          : '当前方案已是该条件下的最快工期方案';
      break;
    }
    case 'precast': {
      const diff = final.metrics.precastRate.rate - original.metrics.precastRate.rate;
      keyInsight =
        diff > 0
          ? `通过 ${acceptedRounds} 轮有效迭代，装配率从 ${original.metrics.precastRate.rate}% 提升至 ${final.metrics.precastRate.rate}%（${final.metrics.precastRate.grade}）`
          : '当前方案装配率已达较高水平';
      break;
    }
    case 'green': {
      const diff = original.metrics.carbonEmission - final.metrics.carbonEmission;
      keyInsight =
        diff > 0
          ? `通过 ${acceptedRounds} 轮有效迭代，碳排放从 ${original.metrics.carbonEmission} kg/㎡降至 ${final.metrics.carbonEmission} kg/㎡，减排 ${diff.toFixed(0)} kg/㎡`
          : '当前方案已是该条件下的低碳最优解';
      break;
    }
    case 'safety': {
      const diff = final.metrics.seismicPerformance - original.metrics.seismicPerformance;
      keyInsight =
        diff > 0
          ? `通过 ${acceptedRounds} 轮有效迭代，抗震性能从 ${original.metrics.seismicPerformance} 分提升至 ${final.metrics.seismicPerformance} 分`
          : '当前方案抗震性能已处较高水平';
      break;
    }
  }

  const goalAchieved = iterations[iterations.length - 1]?.goalProgress?.achieved ?? false;

  // Agent 自主停止原因（用于优化路径图展示）
  const lastAssessment = iterations[iterations.length - 1]?.selfAssessment;
  let agentStopReason = '';
  if (lastAssessment) {
    switch (lastAssessment.verdict) {
      case 'stop_target_met':
        agentStopReason = '🎯 Agent 自主判定：目标已达成，主动停止迭代';
        break;
      case 'stop_diminishing':
        agentStopReason = '📉 Agent 自主判定：边际效益递减，见好就收';
        break;
      case 'stop_no_levers':
        agentStopReason = '🔚 Agent 自主判定：已用尽全部优化杠杆';
        break;
      default:
        agentStopReason = '⚙️ 达到最大迭代轮次限制';
    }
  }

  // 把 Agent 自评结论追加到 keyInsight
  if (agentStopReason && keyInsight) {
    keyInsight += `。${agentStopReason}`;
  }

  return {
    totalRounds: iterations.length - 1, // 不含基准轮
    acceptedRounds,
    originalCost: original.metrics.cost,
    finalCost: final.metrics.cost,
    originalDuration: original.metrics.duration,
    finalDuration: final.metrics.duration,
    originalPrecastRate: original.metrics.precastRate.rate,
    finalPrecastRate: final.metrics.precastRate.rate,
    originalCarbon: original.metrics.carbonEmission,
    finalCarbon: final.metrics.carbonEmission,
    originalSeismic: original.metrics.seismicPerformance,
    finalSeismic: final.metrics.seismicPerformance,
    goalAchieved,
    keyInsight,
    agentStopReason,
  };
}

// ============ Agent 自评引擎 ============

/**
 * Agent 自评：每轮迭代后判断「现在的方案够不够好？要不要继续？下一步调什么？」
 * 替代硬跑 maxRounds 的机械式迭代，体现 Agent 的自主决策能力
 */
function agentSelfAssessment(
  goal: IOptimizationGoal,
  currentScheme: IStructureScheme,
  iterations: IOptimizationIteration[],
  triedLevers: Set<string>,
  maxRounds: number,
  params: IProjectParams,
  lockedParams?: Partial<Record<keyof IProjectParams, boolean>>
): NonNullable<IOptimizationIteration['selfAssessment']> {
  const progress = buildGoalProgress(goal, currentScheme, iterations[0]?.scheme?.metrics.cost);
  const goalMet = progress?.achieved ?? false;

  // 计算连续迭代的边际效益（近两轮改善幅度对比）
  const acceptedIters = iterations.filter((it) => it.decision === 'accepted');
  const lastTwo = acceptedIters.slice(-2);
  let diminishingReturns = false;
  let remainingPotentialPct = 10;

  if (lastTwo.length >= 2 && lastTwo[1].delta && lastTwo[0].delta) {
    const lastGain = getGoalDeltaMagnitude(goal, lastTwo[1].delta);
    const prevGain = getGoalDeltaMagnitude(goal, lastTwo[0].delta);
    if (prevGain > 0 && lastGain < prevGain * 0.3) {
      diminishingReturns = true; // 本轮改善不足上轮的 30%
    }
    remainingPotentialPct = Math.max(1, Math.round((lastGain / Math.max(prevGain, 0.01)) * 10));
  }

  // 场景 1：目标已明确达成 → 停止
  if (goalMet) {
    const goalLabels: Record<IOptimizationGoal, string> = {
      cost: '成本控制目标已达成',
      duration: '工期目标已达成',
      precast: '装配率目标已达成',
      green: '低碳目标已达成',
      safety: '安全目标已达成',
    };
    const valueText = formatGoalValue(goal, currentScheme);
    return {
      verdict: 'stop_target_met',
      summary: `✅ 第${iterations.length - 1}轮自评：${goalLabels[goal]}（当前 ${valueText}），继续优化边际效益有限，Agent 决定停止迭代。`,
      remainingPotentialPct: Math.min(5, remainingPotentialPct),
      goalMet: true,
    };
  }

  // 场景 2：连续两轮边际效益递减 + 已迭代 ≥ 3 轮 → 停止
  if (diminishingReturns && acceptedIters.length >= 3) {
    return {
      verdict: 'stop_diminishing',
      summary: `📉 第${iterations.length - 1}轮自评：连续两轮改善幅度快速收窄（边际效益递减），继续优化可能得不偿失，Agent 决定见好就收。`,
      remainingPotentialPct,
      goalMet: false,
    };
  }

  // 场景 3：没有可用杠杆了 → 停止（基于真实杠杆枚举探测，避免"假性无杠杆"提前停止）
  const remainingLevers = estimateRemainingLevers(goal, currentScheme, triedLevers, params, lockedParams);
  if (remainingLevers === 0) {
    return {
      verdict: 'stop_no_levers',
      summary: `🔚 第${iterations.length - 1}轮自评：已尝试全部可用杠杆，无更多优化手段，Agent 决定停止迭代。`,
      remainingPotentialPct: 0,
      goalMet: false,
    };
  }

  // 场景 4：继续优化，并给出下一轮方向建议
  const nextHint = suggestNextLeverDirection(goal, currentScheme);
  return {
    verdict: 'continue',
    summary: `🔄 第${iterations.length - 1}轮自评：目标尚未达成，仍有约 ${remainingPotentialPct}% 的优化空间，下一轮${nextHint}，Agent 决定继续迭代。`,
    remainingPotentialPct,
    goalMet: false,
  };
}

/** 获取目标维度的 delta 绝对值（用于边际效益判断） */
function getGoalDeltaMagnitude(
  goal: IOptimizationGoal,
  delta: { cost: number; duration: number; precastRate: number; carbon: number; seismic: number }
): number {
  switch (goal) {
    case 'cost':
      return Math.abs(delta.cost);
    case 'duration':
      return Math.abs(delta.duration);
    case 'precast':
      return Math.abs(delta.precastRate);
    case 'green':
      return Math.abs(delta.carbon);
    case 'safety':
      return Math.abs(delta.seismic);
    default:
      return 0;
  }
}

/** 格式化目标维度当前值（展示用） */
function formatGoalValue(goal: IOptimizationGoal, scheme: IStructureScheme): string {
  switch (goal) {
    case 'cost':
      return `${scheme.metrics.cost} 元/㎡`;
    case 'duration':
      return `${scheme.metrics.duration} 个月`;
    case 'precast':
      return `${scheme.metrics.precastRate.rate}%（${scheme.metrics.precastRate.grade}）`;
    case 'green':
      return `${scheme.metrics.carbonEmission} kgCO₂/㎡`;
    case 'safety':
      return `${scheme.metrics.seismicPerformance} 分`;
    default:
      return '';
  }
}

/**
 * 探测剩余可用杠杆数量（真实枚举）：
 * 反复调用 pickNextLever，从当前已尝试集合继续探测，直到返回 null。
 * 该值与 agentSelfAssessment 的"无杠杆停止"判定严格一致，
 * 避免硬编码估算（如"总共 6 个减已尝试"）造成假性停止。
 */
function estimateRemainingLevers(
  goal: IOptimizationGoal,
  scheme: IStructureScheme,
  tried: Set<string>,
  params: IProjectParams,
  lockedParams?: Partial<Record<keyof IProjectParams, boolean>>
): number {
  const probe = new Set(tried);
  let remaining = 0;
  let guard = 0;
  while (guard++ < 30) {
    const lever = pickNextLever(goal, scheme, params, probe, lockedParams);
    if (!lever) break;
    probe.add(leverKey(lever));
    remaining++;
  }
  return remaining;
}

/** 建议下一轮杠杆方向 */
function suggestNextLeverDirection(goal: IOptimizationGoal, scheme: IStructureScheme): string {
  switch (goal) {
    case 'cost':
      return `重点从体系切换入手，尝试换用更经济的结构形式`;
    case 'duration':
      return `考虑提升装配化程度，进一步压缩工期`;
    case 'precast':
      return `尝试向更高装配率的体系升级`;
    case 'green':
      return `从材料选择和装配化两方面挖低碳潜力`;
    case 'safety':
      return `升级到抗震性能更优的结构体系`;
    default:
      return '继续优化';
  }
}

// ============ 总工主动优化建议 ============

/**
 * 基于当前推荐方案，主动分析哪些维度有优化空间
 */
export function generateOptimizationSuggestions(
  scheme: IStructureScheme,
  params: IProjectParams,
  weights: IWeightConfig
): { dimension: string; description: string; potential: string; type: 'cost' | 'duration' | 'precast' | 'green' | 'safety' }[] {
  const suggestions: ReturnType<typeof generateOptimizationSuggestions> = [];

  // 成本优化空间（造价高，且权重高或有预算压力时）
  if (scheme.metrics.cost > params.budget * 1.05) {
    const overPct = ((scheme.metrics.cost - params.budget) / params.budget) * 100;
    suggestions.push({
      dimension: '造价偏高',
      description: `当前方案造价 ${scheme.metrics.cost.toLocaleString()} 元/㎡，超出预算 ${overPct.toFixed(0)}%。如果接受装配率从 ${scheme.metrics.precastRate.grade} 适当下调，或换用更经济的体系，造价可降约 ${Math.min(15, Math.round(overPct * 0.8))}%。`,
      potential: `约可省 ${Math.round(scheme.metrics.cost - params.budget)} 元/㎡`,
      type: 'cost',
    });
  }

  // 工期优化空间（工期长，且为高层/大跨度）
  if (scheme.metrics.duration > 12 && params.floors > 10) {
    const daysSaved = Math.round(scheme.metrics.duration * 0.2);
    suggestions.push({
      dimension: '工期偏长',
      description: `当前方案工期约 ${scheme.metrics.duration} 个月，如果改为装配式体系（如${scheme.id.includes('steel') ? '装配式钢结构' : '装配式混凝土'}），可缩短约 20% 的主体施工时间。`,
      potential: `约缩短 ${daysSaved} 个月`,
      type: 'duration',
    });
  }

  // 装配率提升空间
  if (scheme.metrics.precastRate.rate < 60) {
    suggestions.push({
      dimension: '装配率偏低',
      description: `当前装配率 ${scheme.metrics.precastRate.rate}%（${scheme.metrics.precastRate.grade}），若项目有装配式指标要求，可优先采用水平构件预制（楼板、楼梯、阳台），以较低成本达到 A 级（60%）。`,
      potential: `可提升至 60%（A级）`,
      type: 'precast',
    });
  }

  // 绿色低碳空间
  if (scheme.metrics.carbonEmission > 500) {
    suggestions.push({
      dimension: '碳排偏高',
      description: `当前隐含碳排放约 ${scheme.metrics.carbonEmission} kg/㎡，如果采用钢结构或木结构替代部分混凝土构件，碳排可降低 15-25%，助力绿建星级或近零碳目标。`,
      potential: `约减排 15-25%`,
      type: 'green',
    });
  }

  // 安全冗余空间（烈度高+体系抗震分不高时）
  const intensityVal = parseInt(params.seismicIntensity, 10);
  if (intensityVal >= 8 && scheme.metrics.seismicPerformance < 7) {
    suggestions.push({
      dimension: '安全冗余',
      description: `${params.seismicIntensity}度设防区当前方案抗震性能 ${scheme.metrics.seismicPerformance}/10 分，如果升级至框剪或剪力墙体系，安全冗余可显著提升，但造价会增加约 10-15%。`,
      potential: `抗震性能 +2~3 分`,
      type: 'safety',
    });
  }

  // 高风压风振优化提示
  const windVal = parseFloat((params as any).windPressure || '0.4');
  const h = params.floors * 3;
  if (windVal >= 0.55 && h >= 40) {
    suggestions.push({
      dimension: '风荷载优化',
      description: `基本风压 ${windVal.toFixed(2)} kN/㎡、高度约 ${h}m，属于风荷载敏感项目。可通过优化建筑体型（流线型收分）、采用气动措施（阻尼器、TMD）等改善风振舒适度。`,
      potential: '风振加速度降低 20-30%',
      type: 'safety',
    });
  }

  // 高雪压大跨度屋面优化提示
  const snowVal = parseFloat((params as any).snowPressure || '0.2');
  if (snowVal >= 0.4 && (params.buildingType === 'factory' || params.buildingType === 'gymnasium')) {
    suggestions.push({
      dimension: '雪荷载优化',
      description: `基本雪压 ${snowVal.toFixed(2)} kN/㎡，大跨度屋面雪荷载显著。建议采用钢结构桁架或网架体系，合理布置排雪坡度与天沟，避免不均匀积雪引发的屋面失稳。`,
      potential: '屋面用钢量优化 8-12%',
      type: 'cost',
    });
  }

  // 重点/特殊设防类提高措施提示
  const fortCat = (params as any).fortificationCategory || 'standard';
  if (fortCat === 'key' || fortCat === 'special') {
    const catLabel = fortCat === 'key' ? '重点设防类' : '特殊设防类';
    suggestions.push({
      dimension: `${catLabel}措施`,
      description: `本工程为 ${catLabel}，抗震措施需按提高一度（特殊设防类按更高标准）设计。建议加强核心筒/剪力墙底部加强区配筋，关键构件采用延性设计，确保大震下结构安全。`,
      potential: '抗震措施提高一度',
      type: 'safety',
    });
  }

  return suggestions;
}

// ============ 总工仲裁：分歧 → 权衡 → 决策 ============

export interface ITradeoffConflict {
  /** 分歧维度 key，如 cost vs safety */
  dimensions: [string, string];
  /** 分歧描述 */
  description: string;
  /** 方案 A 的优势 */
  schemeA: { id: string; name: string; advantage: string };
  /** 方案 B 的优势 */
  schemeB: { id: string; name: string; advantage: string };
  /** 差距幅度（百分比或分数差） */
  gapA: number;
  gapB: number;
  /** 单位，用于展示 */
  unitA: string;
  unitB: string;
}

export interface ITradeoffAnalysis {
  /** 是否存在显著分歧 */
  hasConflict: boolean;
  /** 主要分歧点列表 */
  conflicts: ITradeoffConflict[];
  /** 基于当前权重的决策说明 */
  decisionBasedOnWeights: string;
  /** 如果调整权重，结论会怎么变 */
  weightSensitivity: string;
  /** 最终推荐方案的核心权衡 */
  finalTradeoff: string;
}

/**
 * 分析各方案之间的权衡分歧，展示总工仲裁过程
 */
export function analyzeTradeoffs(
  schemes: IStructureScheme[],
  weights: IWeightConfig,
  recommendation: IRecommendation
): ITradeoffAnalysis {
  const conflicts: ITradeoffConflict[] = [];

  if (schemes.length < 2) {
    return {
      hasConflict: false,
      conflicts: [],
      decisionBasedOnWeights: '仅 1 套候选方案，无可比对象。',
      weightSensitivity: '-',
      finalTradeoff: '单方案无需权衡。',
    };
  }

  // 找出综合评分前两名的方案做对比
  const scored = schemes.map((s) => ({
    scheme: s,
    score: computeWeightedScore(s, weights),
  }));
  scored.sort((a, b) => b.score - a.score);
  const top1 = scored[0];
  const top2 = scored[1];

  // 如果分差小于 3 分，认为存在显著分歧
  const scoreDiff = top1.score - top2.score;
  const hasCloseRace = scoreDiff < 3;

  // 检查几个关键维度的对立：造价 vs 抗震、工期 vs 抗震、造价 vs 装配率
  const metricPairs = [
    {
      aKey: 'cost' as const,
      aLabel: '造价',
      aUnit: '元/㎡',
      aLowerIsBetter: true,
      bKey: 'seismicPerformance' as const,
      bLabel: '抗震性能',
      bUnit: '分',
      bLowerIsBetter: false,
    },
    {
      aKey: 'duration' as const,
      aLabel: '工期',
      aUnit: '个月',
      aLowerIsBetter: true,
      bKey: 'seismicPerformance' as const,
      bLabel: '抗震性能',
      bUnit: '分',
      bLowerIsBetter: false,
    },
    {
      aKey: 'cost' as const,
      aLabel: '造价',
      aUnit: '元/㎡',
      aLowerIsBetter: true,
      bKey: 'precastRate' as const,
      bLabel: '装配率',
      bUnit: '%',
      bLowerIsBetter: false,
    },
  ];

  for (const pair of metricPairs) {
    const m1 = top1.scheme.metrics;
    const m2 = top2.scheme.metrics;
    const v1a = (m1 as any)[pair.aKey];
    const v2a = (m2 as any)[pair.aKey];
    const v1b = (m1 as any)[pair.bKey];
    const v2b = (m2 as any)[pair.bKey];

    if (v1a == null || v2a == null || v1b == null || v2b == null) continue;
    // precastRate 是对象，取 rate 字段
    const val1b = pair.bKey === 'precastRate' ? v1b.rate : v1b;
    const val2b = pair.bKey === 'precastRate' ? v2b.rate : v2b;

    // 判断是否存在对立关系：top1 在 A 维度更好但在 B 维度更差
    const top1BetterA = pair.aLowerIsBetter ? v1a < v2a : v1a > v2a;
    const top1BetterB = pair.bLowerIsBetter ? val1b < val2b : val1b > val2b;

    if (top1BetterA !== top1BetterB) {
      // 存在对立
      const gapA = Math.abs(v1a - v2a);
      const gapB = Math.abs(val1b - val2b);

      // 只有差距有意义时才列入分歧（造价差 > 100 元/㎡ 或 抗震差 > 1 分等）
      const thresholdMap: Record<string, number> = {
        cost: 100,
        seismicPerformance: 0.8,
        duration: 1,
        precastRate: 5,
      };
      const threshA = thresholdMap[pair.aKey] ?? 0;
      const threshB = thresholdMap[pair.bKey as string] ?? 0;

      if (gapA >= threshA && gapB >= threshB) {
        const betterA = top1BetterA ? top1.scheme : top2.scheme;
        const betterB = top1BetterB ? top1.scheme : top2.scheme;
        conflicts.push({
          dimensions: [pair.aLabel, pair.bLabel],
          description: `${betterA.name} 在${pair.aLabel}上更优，但${pair.bLabel}略低；${betterB.name} 则相反。`,
          schemeA: {
            id: betterA.id,
            name: betterA.name,
            advantage: `${pair.aLabel}更优`,
          },
          schemeB: {
            id: betterB.id,
            name: betterB.name,
            advantage: `${pair.bLabel}更优`,
          },
          gapA,
          gapB,
          unitA: pair.aUnit,
          unitB: pair.bUnit,
        });
      }
    }
  }

  // 基于权重的决策说明
  let decisionBasedOnWeights = '';
  let weightSensitivity = '';
  let finalTradeoff = '';

  if (conflicts.length > 0) {
    // 找出权重最高的维度
    const weightEntries = Object.entries(weights) as [keyof IWeightConfig, number][];
    weightEntries.sort((a, b) => b[1] - a[1]);
    const topWeight = weightEntries[0];
    const secondWeight = weightEntries[1];

    const weightLabelMap: Record<string, string> = {
      cost: '造价经济',
      duration: '工期效率',
      safety: '安全性能',
      green: '绿色低碳',
    };

    decisionBasedOnWeights = `当前权重下，${weightLabelMap[topWeight[0]] || topWeight[0]}（${topWeight[1]}%）权重最高，因此推荐 ${top1.scheme.name}。该方案在${weightLabelMap[topWeight[0]] || topWeight[0]}维度的优势能够抵消其在其他维度的劣势。`;

    // 权重敏感性分析
    const secondPlaceCanWinIf = weightEntries.slice(1).map(([key, val]) => {
      const need = topWeight[1] - val + 1;
      return `${weightLabelMap[key] || key} 权重提高 ${need}%`;
    });

    weightSensitivity = `如果${secondPlaceCanWinIf[0]}或${secondPlaceCanWinIf[1] || '其他维度权重显著提升'}，${top2.scheme.name} 有可能反超。当前${secondWeight ? weightLabelMap[secondWeight[0]] || secondWeight[0] : '次高维度'}权重 ${secondWeight ? secondWeight[1] : 0}%，距首位还差 ${topWeight[1] - (secondWeight ? secondWeight[1] : 0)} 个百分点。`;

    finalTradeoff = `最终推荐 ${recommendation.schemeName}，是在${conflicts.length}处核心分歧基础上，按您设定的权重优先级做出的综合权衡。建议重点关注：${conflicts[0].description}`;
  } else {
    decisionBasedOnWeights = `两方案综合评分差距 ${scoreDiff.toFixed(1)} 分，${top1.scheme.name} 在多数维度均占优，推荐结论明确。`;
    weightSensitivity = '由于优势维度较多，权重小幅调整不会改变推荐结论。';
    finalTradeoff = `推荐 ${recommendation.schemeName}，综合优势明显，无显著权衡冲突。`;
  }

  return {
    hasConflict: hasCloseRace || conflicts.length > 0,
    conflicts,
    decisionBasedOnWeights,
    weightSensitivity,
    finalTradeoff,
  };
}

/** 加权综合分（越高越好）— 统一口径见 scoring.ts，与前端、compare_schemes 完全一致 */
function computeWeightedScore(scheme: IStructureScheme, weights: IWeightConfig): number {
  return computeSchemeScore(scheme, weights).overall;
}


