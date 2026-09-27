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
// 解析层与基线解耦（关键设计）：
//   extractIntervention(message) 只做「纯抽取」——把句子里的干预读成字段改动，
//   绝不假设用户当前参数是多少，也不做「是否与当前值相同」的判断。
//   是否真构成变化，由调用方拿真实基线判定（见 intent.ts 的 handleWhatIf）。
//   原因：若解析层自带假基线，用户当前值恰好等于假基线值时，改动会被误当「没变」丢弃。
//
// EXPORTS: ICounterfactualChange, ICounterfactualMetricDelta, ICounterfactualCheckFlip,
//          ICounterfactualResult, ICounterfactualReport,
//          extractIntervention, resolveInterventionFromText, diffParams,
//          applyParamChanges (结构化干预，供 UI 滑杆),
//          simulateCounterfactual, simulateSystemCounterfactual

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
  /** 对使用者而言的方向：good=变好 / bad=变差 / neutral=基本持平或优劣取决于项目定位 */
  direction: 'good' | 'bad' | 'neutral';
  /** 归因说明：为什么会变（只陈述可验证的输入依赖，不编造中间机制） */
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

/**
 * 归因方式的诚实性约束：
 *
 * 引擎只知道「参数变了 → 指标跟着变了」，它并不知道中间发生了什么力学或经济机制。
 * 因此归因文案只允许陈述两类事实：
 *   (a) 本次**实际变动**的参数（来自 diffParams，可验证）
 *   (b) 该指标在当前模型中**由哪些输入决定**（来自估算函数签名，可验证）
 *
 * 严禁写「因为构件截面加大所以造价上升」这种编造的中间机制——
 * 那是超出模型知识范围的断言。宁可说「造价随层数、设防烈度、场地类别联动」，
 * 也不要说「造价上升是因为配筋率提高」。
 */
interface IMetricMeta {
  key: string;
  label: string;
  unit: string;
  lowerIsBetter: boolean;
  /** 从评估快照取出该指标值 */
  read: (ev: ISchemeEvaluation) => number;
  /**
   * 该指标在当前模型中的**真实输入依赖**（与估算函数签名一致）。
   * 用于生成可验证的归因，替代编造的因果链。
   */
  drivers: string[];
  /**
   * 方向判定是否适用"越大越好/越小越好"的通用规则。
   * false 表示该指标的优劣**取决于项目定位**，不能由数值大小直接判定——
   * 这类指标一律记为 neutral，避免把中性变化渲染成缺陷（装配率即典型：
   * GB/T 51129-2017 只在项目定位为装配式建筑时才要求 ≥50%，
   * 现浇项目装配率低并不构成问题）。
   */
  polarDirection: boolean;
  /**
   * 该指标在本模型中的**定量敏感度说明**（仅在估算函数里确实写明了系数时才提供）。
   * 引用代码中真实存在的系数，不是编造的机制解释。
   */
  quantifiedNote?: string;
}

const METRIC_META: IMetricMeta[] = [
  {
    key: 'cost',
    label: '结构造价',
    unit: '元/㎡',
    lowerIsBetter: true,
    read: (ev) => ev.metrics.cost,
    drivers: ['结构体系', '层数', '设防烈度', '场地类别', '柱网跨度'],
    polarDirection: true,
    quantifiedNote: '本模型：层数>10 后每层 +0.5% 单价；设防烈度每提高 1 度 +9%；跨度超过 8m 每米 +1.5%',
  },
  {
    key: 'totalCost',
    label: '结构总造价',
    unit: '万元',
    lowerIsBetter: true,
    read: (ev) => Math.round((ev.metrics.cost * ev.params.area) / 10000),
    // 总造价 = 单方造价 × 建筑面积；单方造价本身又是体系/层数/烈度/场地/跨度的函数，
    // 故 drivers 直接列出**用户可见的参数**，而非「单方造价」这类内部中间量——
    // 否则与 diffParams 的字段命名体系对不上，会误判为「非直接输入」。
    drivers: ['结构体系', '层数', '设防烈度', '场地类别', '柱网跨度', '建筑面积'],
    polarDirection: true,
    quantifiedNote: '本模型：单方造价随体系/层数/烈度/场地/跨度变化，乘以建筑面积得总造价',
  },
  {
    key: 'duration',
    label: '工期',
    unit: '月',
    lowerIsBetter: true,
    read: (ev) => ev.metrics.duration,
    drivers: ['建筑面积', '层数', '结构体系'],
    polarDirection: true,
    quantifiedNote: '本模型：层数>6 后每增加一层 +0.2~0.4 月；现浇标准层约 4~6 层/月',
  },
  {
    key: 'carbonEmission',
    label: '碳排放',
    unit: 'kgCO₂/㎡',
    lowerIsBetter: true,
    read: (ev) => ev.metrics.carbonEmission,
    drivers: ['结构体系', '层数'],
    polarDirection: true,
    quantifiedNote: '本模型：层数>10 后每 10 层 +3% 单位面积碳排',
  },
  {
    key: 'seismicPerformance',
    label: '抗震性能评分',
    unit: '分',
    lowerIsBetter: false,
    read: (ev) => ev.metrics.seismicPerformance,
    drivers: ['结构体系'],
    polarDirection: true,
  },
  {
    key: 'constructionDifficulty',
    label: '施工难度',
    unit: '分',
    lowerIsBetter: true,
    read: (ev) => ev.metrics.constructionDifficulty,
    drivers: ['结构体系', '层数'],
    polarDirection: true,
  },
  {
    key: 'sustainability',
    label: '可持续性评分',
    unit: '分',
    lowerIsBetter: false,
    read: (ev) => ev.metrics.sustainability,
    drivers: ['结构体系'],
    polarDirection: true,
  },
  {
    key: 'precastRate',
    label: '装配率',
    unit: '%',
    lowerIsBetter: false,
    read: (ev) => ev.metrics.precastRate.rate,
    drivers: ['结构体系', '层数'],
    polarDirection: false,
  },
];

// ============ 差异计算 ============

/**
 * 生成可验证的归因文案。
 *
 * 只陈述两件可验证的事：
 *   1) 该指标在模型中由哪些输入决定（drivers，来自估算函数签名）
 *   2) 本次实际变动了哪些 drivers（来自 diffParams）
 * 然后指出「变动项 ∩ 依赖项」，说明哪些变动确实可能影响本指标。
 * 这比编造力学机制诚实得多，也更有用——用户能看出自己改的参数是否真的作用于此指标。
 */
function buildAttribution(
  meta: IMetricMeta,
  delta: number,
  changedFields: ICounterfactualChange[]
): string {
  if (delta === 0) return `${meta.label}基本持平`;

  const dirText = `${meta.label}${delta > 0 ? '上升' : '下降'}`;
  const changedLabels = changedFields.map((c) => c.label);
  const note = meta.quantifiedNote ? `。${meta.quantifiedNote}` : '';

  // 本次变动项中，哪些是该指标的真实输入
  const relevant = changedFields.filter((c) => meta.drivers.includes(c.label));
  if (relevant.length > 0) {
    return `${dirText}。本次变动中，${relevant.map((c) => c.label).join('、')}是本指标的模型输入${note}`;
  }
  // 本次未直接改动该指标的输入 → 说明是间接联动，如实标注
  const others = changedLabels.length > 0 ? changedLabels.join('、') : '本次调整';
  return `${dirText}（本次改动的是${others}，非本指标的直接输入，属模型内部联动）${note}`;
}

function computeMetricDeltas(
  baseline: ISchemeEvaluation,
  after: ISchemeEvaluation,
  changedFields: ICounterfactualChange[]
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
    } else if (!meta.polarDirection) {
      // 优劣取决于项目定位的指标（如装配率）：数值大小不足以判定好坏
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
      attribution: buildAttribution(meta, delta, changedFields),
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

  const changedFields = diffParams(baselineParams, normalizedAfter);
  const metricDeltas = computeMetricDeltas(baseline, counterfactual, changedFields);
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

// ============ 自然语言 → 参数干预 ============

/**
 * 从自然语言中**纯抽取**参数值，不与任何基线比较。
 *
 * 为什么必须与基线解耦：
 *   「假设层数改成 30 层」这句话是否正确解析，**取决于用户当前是不是 30 层**。
 *   若解析时用一组假基线做 `to !== baseline.floors` 判断，
 *   会出现两类误判：
 *     (a) 用户当前恰好等于假基线值 → 被当作"没改动"而丢弃 → 推演为空白
 *     (b) 用户当前与假基线不同 → 抽取值正确但判断依据是错的
 *   因此本函数只负责「句子里说了要改成什么」，是否真的构成变化由调用方
 *   拿**真实基线**去 `diffParams` 判定。
 *
 * @returns 抽取到的字段值（可能为空对象）+ 解析说明；无可识别内容时返回 null
 */
export function extractIntervention(
  message: string
): { changes: Partial<IProjectParams>; notes: string[] } | null {
  const notes: string[] = [];
  const changes: Partial<IProjectParams> = {};
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
      changes.floors = to;
      notes.push(`按「${fromN} 层 → ${to} 层」解读`);
    }
  } else if (floorSimple) {
    const to = parseInt(floorSimple[1], 10);
    if (to > 0 && to <= 120) {
      changes.floors = to;
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
    if (resolved) {
      changes.structurePreference = resolved;
      const name = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === resolved)?.name ?? resolved;
      notes.push(`识别到体系：改为「${name}」`);
    }
  }

  // ---- 烈度 ----
  const intensityMatch = message.match(/(?:烈度|设防|抗震)[\s\S]{0,8}?(\d+)\s*度/);
  if (intensityMatch) {
    const to = intensityMatch[1];
    if (['6', '7', '8', '9'].includes(to)) changes.seismicIntensity = to;
  }

  // ---- 场地类别 ----
  const soilMatch = message.match(/(?:场地|土)[\s\S]{0,6}?(Ⅰ|Ⅱ|Ⅲ|Ⅳ|I{1,3}V?|IV)\s*类/);
  if (soilMatch) {
    const norm = normalizeSoil(soilMatch[1]);
    if (norm) changes.soilCategory = norm;
  }

  // ---- 跨度 ----
  const spanMatch = message.match(/跨度[\s\S]{0,8}?(\d+)/) || message.match(/(\d+)\s*米跨/);
  if (spanMatch) {
    const to = parseInt(spanMatch[1], 10);
    if (to > 0 && to <= 30) changes.mainSpan = to;
  }

  // ---- 预算 ----
  const budgetMatch = message.match(/预算[\s\S]{0,10}?(\d{3,6})/);
  if (budgetMatch) {
    const to = parseInt(budgetMatch[1], 10);
    if (to > 0) changes.budget = to;
  }

  // ---- 建筑高度 ----
  const heightMatch = message.match(/(?:高度|限高)[\s\S]{0,8}?(\d+)\s*(?:米|m)/);
  if (heightMatch) {
    const to = parseInt(heightMatch[1], 10);
    if (to > 0 && to <= 500) {
      changes.buildingHeight = to;
      heightTouched = true;
      notes.push('已锁定建筑高度（不再按层数×3m 自动估算）');
    }
  }

  if (Object.keys(changes).length === 0) return null;

  // 层数变化且未显式指定高度 → 标记高度需联动（由调用方决定如何落地）
  if (changes.floors !== undefined && !heightTouched) {
    notes.push('建筑高度将随层数联动重算（按层高 3m 估算）');
  }

  return { changes, notes };
}

/**
 * 从自然语言里解析反事实干预，并套用到给定基线上。
 * 返回 null 表示没能识别出任何具体改动（调用方应转为澄清问句，不瞎猜）。
 *
 * 注意：本函数会把抽取结果与 baseline 合并，并在合并后检测"是否真的构成变化"。
 * 若只想要抽取结果（避免基线耦合），用 extractIntervention。
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
  const extracted = extractIntervention(message);
  if (!extracted) return null;

  const next: IProjectParams = { ...baseline, ...extracted.changes };
  const notes = [...extracted.notes];

  // 层数联动建筑高度：**仅当层数确实发生变化**时才联动。
  // 若句中的层数恰好等于当前层数（如"改成 30 层"而当前就是 30 层），
  // 它不构成层数变化，也就不该触发高度联动——
  // 否则会把 buildingHeight 从 90m 清成"自动估算"，
  // 使 diffParams 误认为发生了变化，把一个"复述现状"的问题渲染成推演。
  const floorsChanged =
    extracted.changes.floors !== undefined && extracted.changes.floors !== baseline.floors;
  if (floorsChanged && extracted.changes.buildingHeight === undefined) {
    delete next.buildingHeight;
  }

  // 合并后若与基线完全一致，说明这句话描述的正是现状，不构成干预
  if (diffParams(baseline, next).length === 0) return null;

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
 * 直接套用一组参数改动。
 * 与 resolveInterventionFromText 互补：这里接受结构化输入，不做文本解析，
 * 供「已知确切改动」的调用方使用（如将来把参数字段做成滑杆直接拖动）。
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
