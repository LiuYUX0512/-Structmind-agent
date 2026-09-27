// 反事实推演引擎（架构诊断 P1-3）
//
// 问题：P0-1~P1-1 建立了完整的「可解释判定链」，但它只能回答「现状是什么」。
//   评委真正会问的是「如果把层数从 30 降到 20 会怎样」「剪力墙换成框剪呢」——
//   即 what-if 反事实问题。旧实现完全没有这个能力。
//
// 设计原则（延续红线 1：LLM 不做数值计算）：
//   本模块是纯确定性计算 + 归因，不引入任何 LLM。
//   所有指标一律复用 evaluateScheme(systemId, params)（带指纹缓存），
//   保证反事实结果与主流程口径完全一致——绝不另起一套算式。
//
// 关键概念：
//   - 基线（baseline）：当前工程参数下的评估快照
//   - 干预（intervention）：用户想改的字段（层数/体系/烈度/场地…）
//   - 差异（delta）：逐指标的变化量 + 方向 + 归因
//   - 翻转（flip）：规范判定从 pass→fail 或 fail→pass —— 最有信息量的事件
//
// EXPORTS: ICounterfactualChange, ICounterfactualMetricDelta, ICounterfactualCheckFlip,
//          ICounterfactualResult, simulateCounterfactual, resolveInterventionFromText,
//          applyParamChanges, describeChange

import { evaluateScheme, type ISchemeEvaluation } from './scheme-evaluator';
import { STRUCTURE_SYSTEM_LIBRARY, type IProjectParams, type INormCheckItem } from './structure';
import { resolveBuildingHeight } from './norm-evaluator';
// ============ 类型 ============

/** 用户在反事实问题里想改的一个字段 */
export interface ICounterfactualChange {
  /** 参数字段名（IProjectParams 的键） */
  field: keyof IProjectParams;
  /** 中文可读名，用于展示 */
  label: string;
  /** 原值 */
  from: string | number;
  /** 新值 */
  to: string | number;
}

/** 单个指标的差异 */
export interface ICounterfactualMetricDelta {
  key: string;
  label: string;
  unit: string;
  before: number;
  after: number;
  /** 变化量（after - before） */
  delta: number;
  /** 变化百分比（before 为 0 时记 null） */
  deltaPercent: number | null;
  /** 对使用者而言的方向：good=变好 / bad=变差 / neutral=基本持平 / info=中性信息（如碳排放下降但造价上升需权衡） */
  direction: 'good' | 'bad' | 'neutral';
  /** 越低越好的指标（造价/工期/碳排/风险） */
  lowerIsBetter: boolean;
  /** 归因说明：为什么会变 */
  attribution: string;
}

/** 规范判定翻转 */
export interface ICounterfactualCheckFlip {
  name: string;
  /** 变化前状态 */
  before: INormCheckItem['status'];
  /** 变化后状态 */
  after: INormCheckItem['status'];
  /** 翻转类型 */
  kind: 'new-violation' | 'resolved' | 'new-warning' | 'cleared-warning' | 'severity-up';
  /** 严重性：涉及强制性条文时为 critical */
  impact: 'critical' | 'major' | 'minor';
  /** 条文证据 */
  evidence: string;
  /** 是否涉及强制性条文 */
  mandatory: boolean;
}

/** 单个体系的反事实结果 */
export interface ICounterfactualResult {
  systemId: string;
  systemName: string;
  /** 是否为当前推荐方案 */
  isCurrentRecommendation: boolean;
  baseline: ISchemeEvaluation;
  counterfactual: ISchemeEvaluation;
  metricDeltas: ICounterfactualMetricDelta[];
  checkFlips: ICounterfactualCheckFlip[];
  /** 强制性条文违规数（变化后） */
  mandatoryViolationsAfter: number;
  /** 强制性条文违规数（变化前） */
  mandatoryViolationsBefore: number;
  /** 是否从合规变为不合规 */
  becameNonCompliant: boolean;
  /** 综合评价 */
  verdict: 'improved' | 'worsened' | 'mixed' | 'unchanged';
  /** 一句话结论 */
  summary: string;
}

/** 一次反事实推演的完整产物 */
export interface ICounterfactualReport {
  /** 用户原始问题 */
  question: string;
  /** 实际施加的干预（可能包含推断出的默认值） */
  changes: ICounterfactualChange[];
  /** 是否有推断成分（用户没把话说完） */
  hasInference: boolean;
  /** 推断说明 */
  inferenceNotes: string[];
  /** 基线参数 */
  baselineParams: IProjectParams;
  /** 反事实参数 */
  counterfactualParams: IProjectParams;
  /** 逐体系结果 */
  results: ICounterfactualResult[];
  /** 变化后仍满足全部强制性条文的体系 id 列表 */
  compliantAfter: string[];
  /** 变化后新增违规的体系 id 列表 */
  newlyViolating: string[];
  /** 是否有任何一个体系发生了强制性条文翻转 */
  hasCriticalFlip: boolean;
}

// ============ 指标元数据 ============

interface IMetricMeta {
  key: string;
  label: string;
  unit: string;
  lowerIsBetter: boolean;
  /** 从评估快照取出该指标值 */
  read: (ev: ISchemeEvaluation) => number;
  /** 归因模板：(delta) => 该指标为何变化（不含「把 X 改成 Y」这类上下文，由展示层统一给出） */
  attribute: (delta: number) => string;
}

const METRIC_META: IMetricMeta[] = [
  {
    key: 'cost',
    label: '结构造价',
    unit: '元/㎡',
    lowerIsBetter: true,
    read: (ev) => ev.metrics.cost,
    attribute: (d) =>
      d === 0
        ? '结构造价基本持平'
        : `结构造价${d > 0 ? '上升' : '下降'}，主要来自构件截面、配筋率与体系单价的联动`,
  },
  {
    key: 'totalCost',
    label: '结构总造价',
    unit: '万元',
    lowerIsBetter: true,
    read: (ev) => Math.round((ev.metrics.cost * ev.params.area) / 10000),
    attribute: (d) =>
      d === 0 ? '总造价基本持平' : `总造价（=单方造价×建筑面积）${d > 0 ? '上升' : '下降'}`,
  },
  {
    key: 'duration',
    label: '工期',
    unit: '月',
    lowerIsBetter: true,
    read: (ev) => ev.metrics.duration,
    attribute: (d) =>
      d === 0
        ? '工期影响可忽略'
        : `工期${d > 0 ? '延长' : '缩短'}——层数是工期的主导变量（每层约 0.2~0.4 月流水节拍）`,
  },
  {
    key: 'carbonEmission',
    label: '碳排放',
    unit: 'kgCO₂/㎡',
    lowerIsBetter: true,
    read: (ev) => ev.metrics.carbonEmission,
    attribute: (d) =>
      d === 0 ? '碳排放基本不变' : `碳排放${d > 0 ? '增加' : '减少'}，与结构材料用量正相关`,
  },
  {
    key: 'seismicPerformance',
    label: '抗震性能评分',
    unit: '分',
    lowerIsBetter: false,
    read: (ev) => ev.metrics.seismicPerformance,
    attribute: (d) =>
      d === 0
        ? '抗震性能评级不变'
        : `抗震性能${d > 0 ? '提升' : '下降'}（体系固有属性 + 设防烈度共同决定）`,
  },
  {
    key: 'constructionDifficulty',
    label: '施工难度',
    unit: '分',
    lowerIsBetter: true,
    read: (ev) => ev.metrics.constructionDifficulty,
    attribute: (d) =>
      d === 0
        ? '施工难度不变'
        : `施工难度${d > 0 ? '上升' : '下降'}（主要来自体系工艺复杂度）`,
  },
  {
    key: 'sustainability',
    label: '可持续性评分',
    unit: '分',
    lowerIsBetter: false,
    read: (ev) => ev.metrics.sustainability,
    attribute: (d) =>
      d === 0 ? '可持续性评级不变' : `可持续性${d > 0 ? '提升' : '下降'}`,
  },
  {
    key: 'precastRate',
    label: '装配率',
    unit: '%',
    lowerIsBetter: false,
    read: (ev) => ev.metrics.precastRate.rate,
    attribute: (d) =>
      d === 0
        ? '装配率不变'
        : `装配率${d > 0 ? '提升' : '下降'}（预制构件比例随体系与层数变化）`,
  },
];

/** 建筑高度上限：不同体系在给定设防下的规范限值由 norm-evaluator 判定，此处仅用于差价归因 */
function readHeight(ev: ISchemeEvaluation): number {
  return resolveBuildingHeight(ev.params);
}

// ============ 差异计算 ============

function computeMetricDeltas(
  baseline: ISchemeEvaluation,
  after: ISchemeEvaluation
): ICounterfactualMetricDelta[] {
  const out: ICounterfactualMetricDelta[] = [];
  for (const meta of METRIC_META) {
    const before = meta.read(baseline);
    const afterVal = meta.read(after);
    const delta = Math.round((afterVal - before) * 100) / 100;
    const deltaPercent =
      before === 0 ? null : Math.round(((afterVal - before) / before) * 1000) / 10;

    let direction: ICounterfactualMetricDelta['direction'];
    const eps = Math.max(Math.abs(before) * 0.005, 1e-6); // 0.5% 以内视为持平
    if (Math.abs(delta) <= eps) {
      direction = 'neutral';
    } else {
      const good = meta.lowerIsBetter ? delta < 0 : delta > 0;
      direction = good ? 'good' : 'bad';
    }

    out.push({
      key: meta.key,
      label: meta.label,
      unit: meta.unit,
      before,
      after: afterVal,
      delta,
      deltaPercent,
      direction,
      lowerIsBetter: meta.lowerIsBetter,
      attribution: meta.attribute(delta),
    });
  }
  return out;
}

/**
 * 比对两组规范判定，找出翻转项。
 * 翻转 = 状态变化（pass↔warning↔fail）或严重性升级。
 * 关键：只比较「两边都出现的同名检查项」，避免体系替换导致的两套不同检查被误判为翻转。
 */
function computeCheckFlips(
  baseline: ISchemeEvaluation,
  after: ISchemeEvaluation
): ICounterfactualCheckFlip[] {
  const beforeMap = new Map<string, INormCheckItem>();
  for (const c of baseline.normCompliance.checks) beforeMap.set(c.name, c);

  const flips: ICounterfactualCheckFlip[] = [];

  const rank: Record<INormCheckItem['status'], number> = { pass: 0, warning: 1, fail: 2 };

  for (const c of after.normCompliance.checks) {
    const b = beforeMap.get(c.name);
    if (!b) continue; // 变化后才出现的检查项（如换体系带来新检查）不计为翻转，靠 violations 计数体现
    if (b.status === c.status) continue;

    const mandatory = c.severity === 'mandatory' || b.severity === 'mandatory';
    const up = rank[c.status] > rank[b.status];

    let kind: ICounterfactualCheckFlip['kind'];
    if (up) {
      if (c.status === 'fail' && b.status === 'pass') kind = 'new-violation';
      else if (c.status === 'fail' && b.status === 'warning') kind = 'severity-up';
      else kind = 'new-warning';
    } else {
      if (c.status === 'pass' && b.status === 'fail') kind = 'resolved';
      else kind = 'cleared-warning';
    }

    const impact: ICounterfactualCheckFlip['impact'] =
      mandatory && (kind === 'new-violation' || kind === 'severity-up') ? 'critical' : up ? 'major' : 'minor';

    const evidenceBits = [
      `${c.name}：${statusCn(b.status)} → ${statusCn(c.status)}`,
      c.value ? `实测 ${c.value}` : '',
      c.requirement ? `要求 ${c.requirement}` : '',
      c.source ? `依据 ${c.source}` : '',
    ].filter(Boolean);

    flips.push({
      name: c.name,
      before: b.status,
      after: c.status,
      kind,
      impact,
      evidence: evidenceBits.join('，'),
      mandatory,
    });
  }

  // 严重的排前面
  const weight = { critical: 0, major: 1, minor: 2 } as const;
  flips.sort((x, y) => weight[x.impact] - weight[y.impact]);
  return flips;
}

function statusCn(s: INormCheckItem['status']): string {
  return s === 'pass' ? '满足' : s === 'warning' ? '提示' : '不满足';
}

function countMandatoryViolations(ev: ISchemeEvaluation): number {
  return ev.normCompliance.checks.filter((c) => c.status === 'fail').length;
}

// ============ 核心推演 ============

/**
 * 归一化：层数变化时建筑高度必须联动。
 *
 * 设计依据：改层数在工程语义上就等于改建筑高度。
 * 若调用方（UI 滑杆 / 文本解析）只改了 floors 而 buildingHeight 仍是旧值，
 * 最大适用高度、层间位移角、周期比等判定会在旧高度下计算，推演结果失真。
 * 因此在引擎入口统一纠正，而不是要求每个调用方都记得处理。
 */
function normalizeHeightLinkage(before: IProjectParams, after: IProjectParams): IProjectParams {
  if (after.floors === before.floors) return after;
  if (after.buildingHeight !== before.buildingHeight) return after; // 调用方显式改了高度 → 尊重
  const next = { ...after };
  delete next.buildingHeight; // 回退为「按层数×3m 自动估算」
  return next;
}

/**
 * 对单个体系做一次反事实推演。
 * @param systemId 体系 id
 * @param baselineParams 基线参数
 * @param afterParams 变化后参数
 * @param isCurrentRecommendation 是否当前推荐方案（用于标注）
 */
export function simulateSystemCounterfactual(
  systemId: string,
  baselineParams: IProjectParams,
  afterParams: IProjectParams,
  isCurrentRecommendation = false
): ICounterfactualResult {
  const normalizedAfter = normalizeHeightLinkage(baselineParams, afterParams);
  const baseline = evaluateScheme(systemId, baselineParams);
  const counterfactual = evaluateScheme(systemId, normalizedAfter);

  const metricDeltas = computeMetricDeltas(baseline, counterfactual);
  const checkFlips = computeCheckFlips(baseline, counterfactual);

  const mandatoryViolationsBefore = countMandatoryViolations(baseline);
  const mandatoryViolationsAfter = countMandatoryViolations(counterfactual);
  const becameNonCompliant =
    mandatoryViolationsAfter > 0 && mandatoryViolationsBefore === 0;

  const improved = metricDeltas.filter((d) => d.direction === 'good').length;
  const worsened = metricDeltas.filter((d) => d.direction === 'bad').length;
  const criticalFlips = checkFlips.filter((f) => f.impact === 'critical');

  let verdict: ICounterfactualResult['verdict'];
  if (becameNonCompliant || criticalFlips.some((f) => f.kind === 'new-violation' || f.kind === 'severity-up')) {
    verdict = 'worsened';
  } else if (improved > 0 && worsened === 0) {
    verdict = 'improved';
  } else if (worsened > 0 && improved === 0) {
    verdict = 'worsened';
  } else if (improved === 0 && worsened === 0) {
    verdict = 'unchanged';
  } else {
    verdict = 'mixed';
  }

  const summary = buildSummary(verdict, metricDeltas, checkFlips, mandatoryViolationsAfter);

  return {
    systemId,
    systemName: baseline.systemName,
    isCurrentRecommendation,
    baseline,
    counterfactual,
    metricDeltas,
    checkFlips,
    mandatoryViolationsBefore,
    mandatoryViolationsAfter,
    becameNonCompliant,
    verdict,
    summary,
  };
}

function buildSummary(
  verdict: ICounterfactualResult['verdict'],
  deltas: ICounterfactualMetricDelta[],
  flips: ICounterfactualCheckFlip[],
  violations: number
): string {
  const parts: string[] = [];
  const critical = flips.filter((f) => f.impact === 'critical');

  if (critical.length > 0) {
    parts.push(`⛔ 触发 ${critical.length} 项强制性条文判定变化，方案可行性下降`);
  }

  const newViolations = flips.filter((f) => f.kind === 'new-violation');
  if (newViolations.length > 0) {
    parts.push(`新增 ${newViolations.length} 项不满足（${newViolations.map((f) => f.name).join('、')}）`);
  }
  const resolved = flips.filter((f) => f.kind === 'resolved');
  if (resolved.length > 0) {
    parts.push(`消除了 ${resolved.length} 项不满足（${resolved.map((f) => f.name).join('、')}）`);
  }

  const good = deltas.filter((d) => d.direction === 'good');
  const bad = deltas.filter((d) => d.direction === 'bad');
  if (good.length > 0) parts.push(`${good.map((d) => d.label).join('、')}改善`);
  if (bad.length > 0) parts.push(`${bad.map((d) => d.label).join('、')}变差`);

  if (parts.length === 0) parts.push('各项指标基本持平');

  if (violations > 0) parts.push(`仍有 ${violations} 项不满足需处理`);

  const head =
    verdict === 'improved' ? '✅ 整体改善' :
    verdict === 'worsened' ? '❌ 整体变差' :
    verdict === 'mixed' ? '⚖️ 有得有失' : '➖ 基本持平';

  return `${head}：${parts.join('；')}`;
}

/**
 * 反事实推演主入口：对一组候选体系同时做推演。
 */
export function simulateCounterfactual(
  question: string,
  baselineParams: IProjectParams,
  afterParams: IProjectParams,
  systemIds: string[],
  currentRecommendationId?: string,
  inferenceNotes: string[] = []
): ICounterfactualReport {
  // 与单体系推演保持同一套归一化，保证 changes 列表与实际推演条件一致
  const normalizedAfter = normalizeHeightLinkage(baselineParams, afterParams);
  const changes = diffParams(baselineParams, normalizedAfter).map((c) => {
    // 建筑高度被清空是层数联动的结果，展示为实际生效高度，比「自动估算」更直观
    if (c.field === 'buildingHeight' && normalizedAfter.buildingHeight === undefined) {
      return { ...c, to: `${resolveBuildingHeight(normalizedAfter)}m（随层数重算）` };
    }
    return c;
  });

  const results = systemIds.map((id) =>
    simulateSystemCounterfactual(id, baselineParams, normalizedAfter, id === currentRecommendationId)
  );

  const compliantAfter = results.filter((r) => r.mandatoryViolationsAfter === 0).map((r) => r.systemId);
  const newlyViolating = results
    .filter((r) => r.becameNonCompliant || r.checkFlips.some((f) => f.kind === 'new-violation'))
    .map((r) => r.systemId);
  const hasCriticalFlip = results.some((r) => r.checkFlips.some((f) => f.impact === 'critical'));

  return {
    question,
    changes,
    hasInference: inferenceNotes.length > 0,
    inferenceNotes,
    baselineParams: { ...baselineParams },
    counterfactualParams: { ...normalizedAfter },
    results,
    compliantAfter,
    newlyViolating,
    hasCriticalFlip,
  };
}

// ============ 参数差异描述 ============

const FIELD_LABELS: Record<string, string> = {
  buildingType: '建筑类型',
  floors: '层数',
  area: '建筑面积',
  structurePreference: '结构偏好',
  seismicIntensity: '设防烈度',
  soilCategory: '场地类别',
  geologyType: '地质条件',
  mainSpan: '柱网跨度',
  budget: '预算',
  windPressure: '基本风压',
  snowPressure: '基本雪压',
  fortificationCategory: '抗震设防类别',
  buildingHeight: '建筑高度',
};

const FIELD_UNITS: Record<string, string> = {
  floors: '层',
  area: '㎡',
  seismicIntensity: '度',
  mainSpan: 'm',
  budget: '元/㎡',
  windPressure: 'kN/㎡',
  snowPressure: 'kN/㎡',
  buildingHeight: 'm',
};

function fmtVal(field: string, v: string | number | undefined): string {
  if (v === undefined || v === '') {
    // 建筑高度被清空是「层数联动」的结果，语义上不是「无值」而是「按层自动估算」
    if (field === 'buildingHeight') return '按层数×3m 自动估算';
    return '—';
  }
  const unit = FIELD_UNITS[field] ?? '';
  if (field === 'snowPressure' && v === '0') return '0（按无雪荷载）';
  return `${v}${unit}`;
}

/** 列出两组参数之间实际发生的字段变化 */
export function diffParams(before: IProjectParams, after: IProjectParams): ICounterfactualChange[] {
  const out: ICounterfactualChange[] = [];
  for (const key of Object.keys(FIELD_LABELS) as (keyof IProjectParams)[]) {
    const b = before[key];
    const a = after[key];
    if (b === a) continue;
    if (b === undefined && a === undefined) continue;
    out.push({
      field: key,
      label: FIELD_LABELS[key],
      from: fmtVal(key, b),
      to: fmtVal(key, a),
    });
  }
  return out;
}

/** 生成「把 X 从 A 改成 B」的中文描述，用于归因文案 */
export function describeChange(before: IProjectParams, after: IProjectParams): string {
  const changes = diffParams(before, after).filter((c) => c.field !== 'buildingHeight');
  if (changes.length === 0) return '本次调整';
  return changes.map((c) => `${c.label}由 ${c.from} 改为 ${c.to}`).join('、');
}

// ============ 自然语言 → 参数干预 ============

/**
 * 从自然语言里解析反事实干预。
 * 返回 null 表示没能识别出任何具体改动（调用方应转为澄清问句，不瞎猜）。
 *
 * 支持的模式（中文口语）：
 *   - 层数：「层数从 30 降到 20」「降到 20 层」「改成 18 层」
 *   - 体系：「剪力墙换成框剪」「改用框架结构」「换成钢结构」
 *   - 烈度：「烈度从 8 度降到 7 度」
 *   - 场地：「场地从 Ⅱ 类改成 Ⅲ 类」
 *   - 跨度：「跨度改成 9 米」
 *   - 预算：「预算降到 4000」
 *   - 高度：「高度限制到 80 米」
 */
export function resolveInterventionFromText(
  message: string,
  baseline: IProjectParams
): { params: IProjectParams; notes: string[] } | null {
  const notes: string[] = [];
  const next: IProjectParams = { ...baseline };
  let touched = false;
  /** 用户是否显式指定了建筑高度（显式时层数不再联动高度） */
  let heightTouched = false;

  // ---- 层数 ----
  // 「30 降到 20 层」「层数 30→20」「从 30 降到 20」「改成 18 层」「降到 20 层」
  // 注意：末尾「层」字是可选的（口语里「从 30 降到 20」往往省略第二处单位）
  const floorPair =
    message.match(/(\d+)\s*层?\s*(?:降|减|变|改|调|压|提|增|加|升)(?:低|高)?\s*(?:到|成|为|至)?\s*(\d+)\s*层?/) ||
    message.match(/(\d+)\s*(?:→|->|至|到)\s*(\d+)\s*层/);
  const floorSimple =
    message.match(/(?:层数|楼层)\s*(?:改|换|调|降|增|加|变|设|为|成|到)?\s*(?:成|为|到)?\s*(\d+)/) ||
    message.match(/(?:改|换|调|降|增|加|变|设)(?:成|为|到)?\s*(\d+)\s*层/) ||
    message.match(/^\s*(?:如果|假如|要是)?\s*(\d+)\s*层\s*(?:会|呢|怎样|怎么样)/);
  if (floorPair) {
    const fromN = parseInt(floorPair[1], 10);
    const to = parseInt(floorPair[2], 10);
    if (to > 0 && to <= 120 && to !== fromN) {
      next.floors = to;
      notes.push(`按「${fromN} 层 → ${to} 层」解读`);
      touched = true;
    }
  } else if (floorSimple) {
    const to = parseInt(floorSimple[1], 10);
    if (to > 0 && to <= 120 && to !== baseline.floors) {
      next.floors = to;
      touched = true;
    }
  }

  // ---- 结构体系 ----
  // 关键：体系名在句中可能出现两次（「剪力墙换成框剪」），必须取「换成/改为」**之后**的那个，
  // 否则从左到右扫描会先命中源体系，导致解析出与当前相同的体系而误判为「无变更」。
  const SYS_TOKEN =
    '(框架[-－—]?剪力墙|框剪|剪力墙|框架[-－—]?核心筒|核心筒|筒中筒|钢结构|钢框架|框架|砌体|装配式|组合结构)';
  const sysSwap = message.match(
    new RegExp(`${SYS_TOKEN}\\s*(?:换|改|变|调|替|改换)(?:成|为|作)?\\s*${SYS_TOKEN}`)
  );
  const sysSimple = message.match(new RegExp(SYS_TOKEN));
  const sysTarget = sysSwap ? sysSwap[2] : sysSimple?.[1];
  if (sysTarget) {
    const resolved = mapSystemToken(sysTarget);
    if (resolved && resolved !== baseline.structurePreference) {
      next.structurePreference = resolved;
      const name = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === resolved)?.name ?? resolved;
      const fromName =
        STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === baseline.structurePreference)?.name ??
        baseline.structurePreference;
      notes.push(`识别到体系变更：${fromName} → 「${name}」`);
      touched = true;
    }
  }

  // ---- 烈度 ----
  const intensityMatch = message.match(/(?:烈度|设防|抗震)[\s\S]{0,8}?(\d+)\s*度/);
  if (intensityMatch) {
    const to = intensityMatch[1];
    if (to !== baseline.seismicIntensity && ['6', '7', '8', '9'].includes(to)) {
      next.seismicIntensity = to;
      touched = true;
    }
  }

  // ---- 场地类别 ----
  const soilMatch = message.match(/(?:场地|土)[\s\S]{0,6}?(Ⅰ|Ⅱ|Ⅲ|Ⅳ|I{1,3}V?|IV)\s*类/);
  if (soilMatch) {
    const norm = normalizeSoil(soilMatch[1]);
    if (norm && norm !== baseline.soilCategory) {
      next.soilCategory = norm;
      touched = true;
    }
  }

  // ---- 跨度 ----
  const spanMatch = message.match(/跨度[\s\S]{0,8}?(\d+)/) || message.match(/(\d+)\s*米跨/);
  if (spanMatch) {
    const to = parseInt(spanMatch[1], 10);
    if (to > 0 && to <= 30 && to !== baseline.mainSpan) {
      next.mainSpan = to;
      touched = true;
    }
  }

  // ---- 预算 ----
  const budgetMatch = message.match(/预算[\s\S]{0,10}?(\d{3,6})/);
  if (budgetMatch) {
    const to = parseInt(budgetMatch[1], 10);
    if (to > 0 && to !== baseline.budget) {
      next.budget = to;
      touched = true;
    }
  }

  // ---- 建筑高度 ----
  const heightMatch = message.match(/(?:高度|限高)[\s\S]{0,8}?(\d+)\s*(?:米|m)/);
  if (heightMatch) {
    const to = parseInt(heightMatch[1], 10);
    if (to > 0 && to <= 500) {
      next.buildingHeight = to;
      touched = true;
      heightTouched = true;
      notes.push('已锁定建筑高度（不再按层数×3m 自动估算）');
    }
  }

  if (!touched) return null;

  // 层数联动建筑高度。
  // 语义依据：用户说「层数从 30 降到 20」，工程含义就是「建筑高度随之下降」。
  // 若不同步高度，最大适用高度、层间位移角、周期比等判定会仍在旧高度下计算，
  // 推演结果失真（降层却看不出任何规范判定改善）。
  // 仅当用户本次**显式指定了建筑高度**（heightTouched）才不联动。
  if (next.floors !== baseline.floors && !heightTouched) {
    delete next.buildingHeight;
    notes.push('建筑高度已随层数联动重算（按层高 3m 估算）');
  }

  return { params: next, notes };
}

function mapSystemToken(token: string): string | null {
  const t = token.replace(/[－—]/g, '-');
  if (/^框剪$|框架-剪力墙|框架剪力墙/.test(t)) return 'frame-shearwall';
  if (/剪力墙/.test(t)) return 'shearwall';
  if (/框架-核心筒|核心筒/.test(t)) return 'frame-corewall';
  if (/筒中筒/.test(t)) return 'tube-in-tube';
  if (/钢框架|钢结构/.test(t)) return 'steel';
  if (/砌体/.test(t)) return 'masonry';
  if (/装配式/.test(t)) return 'precast';
  if (/组合结构/.test(t)) return 'composite';
  if (/^框架$/.test(t)) return 'frame';
  return null;
}

function normalizeSoil(raw: string): string | null {
  const s = raw.toUpperCase().replace(/I/g, 'Ⅰ').replace(/V/g, 'Ⅴ');
  if (s.includes('Ⅳ') || s === '4') return 'Ⅳ';
  if (s.includes('Ⅲ') || s === '3') return 'Ⅲ';
  if (s.includes('Ⅱ') || s === '2') return 'Ⅱ';
  if (s.includes('Ⅰ') || s === '1') return 'Ⅰ';
  return null;
}

/**
 * 直接套用一组参数改动（用于 UI 上的交互式 what-if 滑杆）。
 * 与 resolveInterventionFromText 互补：这里接受结构化输入，不做文本解析。
 */
export function applyParamChanges(
  baseline: IProjectParams,
  changes: Partial<IProjectParams>
): IProjectParams {
  const next: IProjectParams = { ...baseline };
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined) continue;
    (next as unknown as Record<string, unknown>)[k] = v;
  }
  return next;
}

/** 供 UI 使用的字段标签导出 */
export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export function fieldUnit(field: string): string {
  return FIELD_UNITS[field] ?? '';
}

export { readHeight };
