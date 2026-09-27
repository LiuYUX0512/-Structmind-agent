// EXPORTS:
// IProjectParams, IWeightConfig, INormCheckItem, INormCompliance,
// ICostBreakdown, IFoundationSuggestion, IThinkingStep, IPresetCase,
// ISchemeMetrics, IStructureScheme, IRecommendation, IChatMessage,
// IExtremeParamAlert,
// MOCK_PROJECT_PARAMS, MOCK_WEIGHT_CONFIG, STRUCTURE_SYSTEM_LIBRARY, MOCK_RECOMMENDATION,
// MOCK_CHAT_MESSAGES,
// BUILDING_TYPES, SEISMIC_INTENSITIES, SOIL_CATEGORIES, GEOLOGY_TYPES,
// STRUCTURE_PREFERENCES, PRESET_CASES, THINKING_STEPS_TEMPLATE, METRIC_DIMENSIONS,
// calculateNormCompliance, calculateBuildingHeight, checkExtremeParams,
// estimateCarbonEmission, estimatePrecastRate, estimateConstructionRisk

import { evaluateCompliance, resolveBuildingHeight } from './norm-evaluator';
import { calculateBuildingHeight, getHeightLimit, isKnownSystem } from './code-rules';
import { resolveScreeningBonus } from './domain-adjustments';
import { evaluateScheme, toScheme } from './scheme-evaluator';

// ============ 类型定义 ============

export interface IProjectParams {
  buildingType: string;
  floors: number;
  area: number;
  structurePreference: string;
  seismicIntensity: string;
  soilCategory: string;
  geologyType: string;
  mainSpan: number;
  budget: number;
  /** 基本风压（kN/㎡） */
  windPressure: string;
  /** 基本雪压（kN/㎡） */
  snowPressure: string;
  /** 抗震设防类别 */
  fortificationCategory: string;
  /** 建筑高度（m），方案阶段可按层数×层高估算，也可手工输入；留空则按层数×3m自动估算 */
  buildingHeight?: number;
}

export interface IWeightConfig {
  cost: number;
  duration: number;
  safety: number;
  green: number;
}

export interface INormCheckItem {
  name: string;
  status: 'pass' | 'warning' | 'fail';
  description: string;
  value?: string;
  requirement?: string;
  /** 计算链：依据 → 输入 → 公式 → 结果 */
  calcChain?: {
    basis: string;
    input: string;
    formula?: string;
    result: string;
  };
  /** 规范条文原文/要点摘要 */
  clauseText?: string;
  /** 判定理由（工程解释，一两句） */
  reason?: string;
  /** 完整出处（标准编号 + 条文号） */
  source?: string;
  /** 条文严重性：mandatory=强制性条文（超限必须判 fail）；general=一般控制指标；advisory=提示性措施 */
  severity?: 'mandatory' | 'general' | 'advisory';
}

export interface INormCompliance {
  standards: string[];
  checks: INormCheckItem[];
  summary: string;
}

export interface ICostBreakdown {
  baseCost: number;
  range: [number, number];
  factors: { name: string; coefficient: number; description: string }[];
  composition: { category: string; percentage: number }[];
}

export interface IFoundationSuggestion {
  foundationType: string;
  reason: string;
  notes: string[];
}

export interface IThinkingStep {
  id: number;
  title: string;
  description: string;
  status: 'pending' | 'active' | 'done';
}

export interface IPresetCase {
  id: string;
  name: string;
  description: string;
  icon: string;
  params: IProjectParams;
  weights: IWeightConfig;
}

export interface ISchemeMetrics {
  cost: number;
  duration: number;
  seismicPerformance: number;
  constructionDifficulty: number;
  sustainability: number;
  precastRate: { rate: number; grade: string; gradeCode: string };
  carbonEmission: number;
  safetyRisk: 'low' | 'medium' | 'high';
}

export interface IStructureScheme {
  id: string;
  name: string;
  description: string;
  applicableScenarios: string;
  advantages: string[];
  disadvantages: string[];
  metrics: ISchemeMetrics;
  normCompliance?: INormCompliance;
  costBreakdown?: ICostBreakdown;
  foundationSuggestion?: IFoundationSuggestion;
  safetyRiskNotes?: string[];
  /**
   * 本套 metrics 所依据的工程参数快照。
   * metrics 是「(结构体系 × 工程参数)」的二元函数而非体系的内在属性，
   * 因此必须记录评估条件，否则同一方案在不同调用方会得到不同指标与不同评分。
   */
  evaluatedAt?: IProjectParams;
}

export interface IRecommendation {
  schemeId: string;
  schemeName: string;
  reason: string;
  overallScore: number;
  weightedScores?: { schemeId: string; score: number; breakdown: Record<string, number> }[];
  /** P1-1 决策溯源：最终推荐是谁定的 */
  decisionSource?: 'llm' | 'constraint-override' | 'human-lock' | 'score-fallback' | 'trace';
  /** P1-1：裁定说明——为什么是它，以及为什么可能不是评分最高的那个 */
  decisionNote?: string;
  /** P1-1：纯评分口径下的首选（与最终裁定对照展示） */
  scoreTopSchemeId?: string;
  /** P1-1：大模型的原始裁定（被否决时也保留） */
  llmChoiceSchemeId?: string;
  /** P1-1：大模型自评置信度 */
  llmConfidence?: 'high' | 'medium' | 'low';
  /** P1-1：大模型给出的决定性因素 */
  decisiveFactor?: string;
  /** P1-1：触发否决的强制性条文清单 */
  hardConstraintViolations?: string[];
}

export interface IChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface IExtremeParamAlert {
  isExtreme: boolean;
  reasons: string[];
  suggestion: string;
}

// ============ 枚举选项 ============

export const BUILDING_TYPES = [
  { value: 'residential', label: '住宅' },
  { value: 'office', label: '办公楼' },
  { value: 'school', label: '教学楼' },
  { value: 'factory', label: '厂房' },
  { value: 'gymnasium', label: '体育馆' },
];

export const SEISMIC_INTENSITIES = [
  { value: '6', label: '6度' },
  { value: '7', label: '7度' },
  { value: '8', label: '8度' },
  { value: '9', label: '9度' },
];

export const SOIL_CATEGORIES = [
  { value: 'Ⅰ', label: 'Ⅰ类' },
  { value: 'Ⅱ', label: 'Ⅱ类' },
  { value: 'Ⅲ', label: 'Ⅲ类' },
  { value: 'Ⅳ', label: 'Ⅳ类' },
];

export const GEOLOGY_TYPES = [
  { value: 'loess', label: '湿陷性黄土' },
  { value: 'clay', label: '一般黏土' },
  { value: 'rock', label: '岩石地基' },
  { value: 'fill', label: '填土/其他' },
];

export const STRUCTURE_PREFERENCES = [
  { value: 'frame', label: '框架结构' },
  { value: 'frame-shearwall', label: '框架-剪力墙结构' },
  { value: 'shearwall', label: '剪力墙结构' },
  { value: 'steel', label: '钢结构' },
  { value: 'prefabricated', label: '装配式混凝土结构(PC)' },
  { value: 'prefab-steel', label: '装配式钢结构' },
  { value: 'composite', label: '钢-混凝土组合结构' },
  { value: 'masonry', label: '砌体结构' },
  { value: 'frame-corewall', label: '框架-核心筒' },
  { value: 'tube-in-tube', label: '筒中筒结构' },
  { value: 'mass-timber', label: '胶合木结构' },
  { value: 'space-truss', label: '空间结构(网架/桁架)' },
  { value: 'any', label: '不限（智能推荐）' },
];

// ============ 默认值 ============

export const MOCK_WEIGHT_CONFIG: IWeightConfig = {
  cost: 25,
  duration: 25,
  safety: 25,
  green: 25,
};

export const MOCK_PROJECT_PARAMS: IProjectParams = {
  buildingType: 'residential',
  floors: 30,
  area: 15000,
  structurePreference: 'any',
  seismicIntensity: '8',
  soilCategory: 'Ⅱ',
  geologyType: 'clay',
  mainSpan: 8,
  budget: 4500,
  windPressure: '0.4',
  snowPressure: '0.2',
  fortificationCategory: 'standard',
  buildingHeight: 90,
};

// ============ 工具函数 ============

// ============ 规范规则层 / 判定层（已拆分为 code-rules.ts + norm-evaluator.ts）============
// 拆分原因见架构诊断 P0-1：规则（判什么/依据哪条/严重性）与计算（估算值）混写，
// 导致剪重比、周期比恒 pass、高度超限被降级为 warning 等判定失真问题。
export { calculateBuildingHeight, getHeightLimit, DRIFT_LIMITS, SHEAR_WEIGHT_RATIO_MIN } from './code-rules';
export { evaluateCompliance, estimateSeismicShearCoefficient, estimateTorsionPeriodRatio } from './norm-evaluator';

/**
 * 规范符合性计算
 * @description 转发至判定层 norm-evaluator.evaluateCompliance；对外签名与返回结构保持不变。
 * @throws 未知结构体系 / 未知场地类别时抛错（不再静默兜底）
 */
export function calculateNormCompliance(
  schemeId: string,
  params: IProjectParams
): INormCompliance {
  return evaluateCompliance(schemeId, params);
}

/**
 * 估算工期（月）—— 基于建筑面积、层数、结构体系的经验施工速率模型
 *
 * 计算模型：
 *   工期 = 基础工期 + 面积增量 + 层数增量 + 体系系数 + 场地修正
 *
 *   - 基础工期：小型项目约 1.5-2.5 个月（场地平整+基础）
 *   - 面积增量：按结构体系的月施工面积推算（如现浇框架约 800-1200 ㎡/月层）
 *   - 层数增量：高层需考虑流水施工、垂直运输、验收节点，层数>6 后每增加一层加 0.2-0.4 月
 *   - 体系系数：框架 1.0 / 框剪 1.15 / 剪力墙 1.2 / 钢结构 0.7（预制快） / 装配式 0.75
 *
 * 参考工程经验（国内常规施工速度）：
 *   - 300 ㎡ 2 层框架办公楼：约 2.5-4 个月
 *   - 3000 ㎡ 6 层框架住宅：约 6-9 个月
 *   - 10000 ㎡ 18 层框剪住宅：约 12-16 个月
 *   - 20000 ㎡ 30 层剪力墙：约 18-24 个月
 *   - 钢结构高层比现浇快约 25-35%
 */
export function estimateDuration(
  schemeId: string,
  area: number,
  floors: number
): number {
  // 各结构体系的"月施工面积效率"（㎡/月，单作业面基准）
  // 数值越大 = 速度越快 = 工期越短
  const efficiencyMap: Record<string, number> = {
    frame: 900,              // 现浇框架
    'frame-shearwall': 780,  // 框架-剪力墙（工序多）
    shearwall: 700,          // 剪力墙（模板复杂）
    steel: 1300,             // 钢结构（工厂预制+现场吊装）
    prefabricated: 1200,     // 装配式混凝土（PC）
    'prefab-steel': 1400,    // 装配式钢结构（最快）
    composite: 1000,         // 钢-混凝土组合结构
    masonry: 650,            // 砌体结构（传统工艺，人工砌筑）
    'frame-corewall': 750,   // 框架-核心筒（核心筒+外框两部分）
    'tube-in-tube': 720,     // 筒中筒（复杂程度最高）
    'mass-timber': 1500,     // 胶合木结构（工厂预制，现场拼装极快）
    'space-truss': 1100,     // 空间网架/桁架（工厂预制+现场拼装）
  };
  const efficiency = efficiencyMap[schemeId] || 800;

  // 1. 主体工期 = 建筑面积 / 月施工效率（考虑多作业面系数）
  //    小项目按单层推进，大项目可分区流水
  //    高层（>10层）标准层施工速度明显更快（模板周转+流水施工成熟）
  let floorArea = Math.max(area / Math.max(floors, 1), 200); // 单层面积
  let floorsPerMonth: number;
  if (floorArea <= 500) {
    floorsPerMonth = efficiency / (floorArea * 1.2); // 小面积层效率稍低（准备时间占比大）
  } else if (floorArea <= 2000) {
    floorsPerMonth = efficiency / floorArea;
  } else {
    floorsPerMonth = efficiency / floorArea * 0.85; // 大面积单层效率略降
  }

  // 高层效率提升：标准层施工速度显著快于低层（模板周转 + 流水作业成熟）
  // 国内常规高层住宅：标准层约 5-7 天/层 → 约 4-6 层/月
  // 这里按层数渐进提升效率，10 层以上每 5 层效率 +10%，上限 +60%
  if (floors > 10) {
    const boostSteps = Math.floor((floors - 10) / 5);
    const boostFactor = 1 + Math.min(boostSteps * 0.1, 0.6);
    floorsPerMonth *= boostFactor;
  }

  floorsPerMonth = Math.max(floorsPerMonth, 0.8); // 最慢 0.8 层/月

  let mainDuration = floors / floorsPerMonth;

  // 2. 基础工期（含场地平整、基础施工）
  //    小项目基础约 1-2 个月；大项目/高层基础 3-6 个月
  let foundationMonths: number;
  if (floors <= 3) {
    foundationMonths = 1.2 + (area / 5000) * 0.8;
  } else if (floors <= 10) {
    foundationMonths = 2 + (floors - 3) * 0.2;
  } else if (floors <= 30) {
    foundationMonths = 3.5 + (floors - 10) * 0.1;
  } else {
    foundationMonths = 5.5 + (floors - 30) * 0.08;
  }

  // 3. 装饰装修 + 机电安装 + 竣工验收
  //    小项目 1-2 个月，大项目 3-6 个月
  let fitoutMonths: number;
  if (area <= 1000) {
    fitoutMonths = 1.0;
  } else if (area <= 5000) {
    fitoutMonths = 1.5 + (area - 1000) / 8000;
  } else if (area <= 20000) {
    fitoutMonths = 2 + (area - 5000) / 10000;
  } else {
    fitoutMonths = 3.5 + (area - 20000) / 30000;
  }

  // 钢结构现场湿作业少，装修可与主体更深度穿插
  if (schemeId === 'steel') fitoutMonths *= 0.85;
  if (schemeId === 'prefabricated') fitoutMonths *= 0.9;

  const total = foundationMonths + mainDuration + fitoutMonths;

  // 最少 2 个月（即使很小的项目也要走流程）
  return Math.max(2, Math.round(total * 10) / 10);
}

/**
 * 估算单位面积造价（元/㎡）—— 基于结构体系 + 设防烈度 + 高度 + 场地修正
 *
 * 参考国内常规建安工程指标（结构主体，不含精装修、设备、土地）：
 *   - 多层框架：2500-3500 元/㎡
 *   - 高层框剪：3500-5000 元/㎡
 *   - 高层剪力墙：4000-5500 元/㎡
 *   - 钢结构：5000-7000 元/㎡（含主材）
 *   - 装配式：比现浇高 10-20%
 *
 * 修正因素：
 *   - 设防烈度：每提高 1 度，造价增加约 3-5%
 *   - 建筑高度：10 层以上每 10 层增加约 3-5%
 *   - 场地类别：Ⅲ/Ⅳ类场地基础造价增加 5-10%
 */
export function estimateCost(
  schemeId: string,
  floors: number,
  intensity: string,
  soilCategory: string,
  mainSpan: number = 8
): number {
  // 基准造价（按 10 层、7 度设防、Ⅱ 类场地估算）
  const baseCostMap: Record<string, number> = {
    frame: 2800,
    'frame-shearwall': 3800,
    shearwall: 4400,
    steel: 5500,
    prefabricated: 4200,
    'prefab-steel': 5800,
    composite: 4800,
    masonry: 1800,
    'frame-corewall': 5000,
    'tube-in-tube': 6000,
    'mass-timber': 6500,
    'space-truss': 5200,
  };
  let cost = baseCostMap[schemeId] || 3000;

  // 高度修正（层间递增）
  // 工程经验：每增加 10 层，结构造价约增加 3-5%（竖向构件及基础增量）
  if (floors > 10) {
    cost *= 1 + (floors - 10) * 0.005; // 每层 +0.5%，每 10 层约 +5%
  } else if (floors < 5) {
    cost *= 0.92; // 低层稍便宜（措施费低）
  }

  // 设防烈度修正
  // 工程经验：烈度每提高 1 度，结构造价增加约 8-12%（钢筋用量增加、构件截面加大）
  const intensityNum = parseInt(intensity, 10);
  if (!isNaN(intensityNum)) {
    const intensityDiff = intensityNum - 7; // 以 7 度为基准
    cost *= 1 + intensityDiff * 0.09; // 每度约 +9%
  }

  // 主跨修正：大跨度结构用钢量/混凝土用量显著增加
  // 以 8m 为基准，每超过 1m 造价增加约 1.5%（大跨度梁板增厚）
  if (mainSpan > 8) {
    cost *= 1 + (mainSpan - 8) * 0.015;
  }

  // 场地类别修正（基础造价影响）
  if (soilCategory === 'Ⅰ') cost *= 0.97;
  if (soilCategory === 'Ⅲ') cost *= 1.05;
  if (soilCategory === 'Ⅳ') cost *= 1.1;

  return Math.round(cost);
}

/**
 * 构造造价拆解说明（与 estimateCost 计算链保持一致）
 */
export function buildCostBreakdown(
  schemeId: string,
  params: IProjectParams,
  finalCost: number
): ICostBreakdown | null {
  const baseCostMap: Record<string, number> = {
    frame: 2800,
    'frame-shearwall': 3800,
    shearwall: 4400,
    steel: 5500,
    prefabricated: 4200,
    'prefab-steel': 5800,
    composite: 4800,
    masonry: 1800,
    'frame-corewall': 5000,
    'tube-in-tube': 6000,
    'mass-timber': 6500,
    'space-truss': 5200,
  };
  const baseCost = baseCostMap[schemeId];
  if (!baseCost) return null;

  const intensityRaw = parseInt(params.seismicIntensity, 10);
  const intensityNum = isNaN(intensityRaw) ? 7 : Math.max(6, Math.min(9, intensityRaw));
  const intensityFactor = 1 + (intensityNum - 7) * 0.09;
  const heightFactor = params.floors > 10 ? 1 + (params.floors - 10) * 0.005 : params.floors < 5 ? 0.92 : 1;
  const soilFactor =
    params.soilCategory === 'Ⅰ' ? 0.97 :
    params.soilCategory === 'Ⅲ' ? 1.05 :
    params.soilCategory === 'Ⅳ' ? 1.1 : 1;
  const spanFactor = params.mainSpan > 8 ? 1 + (params.mainSpan - 8) * 0.015 : 1;

  const schemeNameMap: Record<string, string> = {
    frame: '框架结构',
    'frame-shearwall': '框架-剪力墙结构',
    shearwall: '剪力墙结构',
    steel: '钢结构',
    prefabricated: '装配式混凝土结构',
    'prefab-steel': '装配式钢结构',
    composite: '钢-混凝土组合结构',
    masonry: '砌体结构',
    'frame-corewall': '框架-核心筒结构',
    'tube-in-tube': '筒中筒结构',
    'mass-timber': '胶合木结构',
    'space-truss': '空间网架/桁架结构',
  };

  const factors: { name: string; coefficient: number; description: string }[] = [
    { name: '结构体系基准', coefficient: 1.0, description: `${schemeNameMap[schemeId] || schemeId}基准造价约 ${baseCost} 元/㎡` },
  ];

  if (params.floors > 10) {
    factors.push({ name: '建筑高度调整', coefficient: Number(heightFactor.toFixed(4)), description: `${params.floors}层，每增加一层+0.5%` });
  } else if (params.floors < 5) {
    factors.push({ name: '低层项目优惠', coefficient: 0.92, description: '低层建筑措施费较低' });
  }

  if (intensityNum) {
    factors.push({ name: '设防烈度调整', coefficient: Number(intensityFactor.toFixed(4)), description: `${params.seismicIntensity}度设防，每度约+9%` });
  }

  if (params.soilCategory !== 'Ⅱ') {
    factors.push({ name: '场地类别调整', coefficient: Number(soilFactor.toFixed(4)), description: `${params.soilCategory}类场地土基础造价调整` });
  }

  if (params.mainSpan > 8) {
    factors.push({ name: '主跨调整', coefficient: Number(spanFactor.toFixed(4)), description: `主跨 ${params.mainSpan}m，大于 8m 每米+1.5%` });
  }

  // 造价构成（按结构体系不同比例）
  const compositionMap: Record<string, { category: string; percentage: number }[]> = {
    frame: [
      { category: '混凝土结构主体', percentage: 50 },
      { category: '基础工程', percentage: 18 },
      { category: '钢筋工程', percentage: 15 },
      { category: '模板及脚手架', percentage: 10 },
      { category: '措施及其他', percentage: 7 },
    ],
    'frame-shearwall': [
      { category: '混凝土结构主体', percentage: 55 },
      { category: '基础工程', percentage: 15 },
      { category: '钢筋工程', percentage: 12 },
      { category: '模板及脚手架', percentage: 8 },
      { category: '措施及其他', percentage: 10 },
    ],
    shearwall: [
      { category: '混凝土及钢筋', percentage: 60 },
      { category: '基础工程', percentage: 18 },
      { category: '模板工程', percentage: 10 },
      { category: '脚手架及措施', percentage: 7 },
      { category: '其他', percentage: 5 },
    ],
    steel: [
      { category: '钢材主材', percentage: 45 },
      { category: '制作加工', percentage: 20 },
      { category: '防火防腐', percentage: 12 },
      { category: '安装施工', percentage: 13 },
      { category: '基础及其他', percentage: 10 },
    ],
    prefabricated: [
      { category: '预制构件采购', percentage: 55 },
      { category: '现场安装', percentage: 15 },
      { category: '基础工程', percentage: 12 },
      { category: '灌浆及节点', percentage: 10 },
      { category: '措施及其他', percentage: 8 },
    ],
  };

  const rangeLow = Math.round(finalCost * 0.9);
  const rangeHigh = Math.round(finalCost * 1.1);

  return {
    baseCost,
    range: [rangeLow, rangeHigh],
    factors,
    composition: compositionMap[schemeId] || compositionMap.frame,
  };
}

/**
 * 估算装配率（%）—— 按结构体系 + 层数微调
 * 依据：GB/T 51129-2017《装配式建筑评价标准》
 *   评价等级：P<50% 未达标；50%≤P<60% 基本要求（未达A级）；
 *            60%~75% A级；76%~90% AA级；≥91% AAA级
 *   计算公式：P = (Q1 + Q2 + Q3) / (100 - Q4) × 100%
 * 注：本工具为方案阶段经验估算，正式评价应按标准逐项评分。
 */
export function estimatePrecastRate(
  schemeId: string,
  floors: number = 10
): { rate: number; grade: string; gradeCode: string } {
  const baseRates: Record<string, number> = {
    frame: 22,
    'frame-shearwall': 30,
    shearwall: 40,
    steel: 85,
    prefabricated: 70,
    'prefab-steel': 90,
    composite: 55,
    masonry: 5,
    'frame-corewall': 35,
    'tube-in-tube': 45,
    'mass-timber': 95,
    'space-truss': 80,
  };
  let rate = baseRates[schemeId] || 15;
  // 层数越高，标准化程度越高，装配率可提升（钢结构除外，本身已很高）
  if (schemeId !== 'steel' && floors > 20) rate += 8;
  else if (schemeId !== 'steel' && floors > 10) rate += 4;
  rate = Math.min(95, Math.round(rate));

  let grade = '未达到装配式建筑装配率要求';
  let gradeCode = 'none';
  if (rate >= 91) {
    grade = 'AAA级';
    gradeCode = 'AAA';
  } else if (rate >= 76) {
    grade = 'AA级';
    gradeCode = 'AA';
  } else if (rate >= 60) {
    grade = 'A级';
    gradeCode = 'A';
  } else if (rate >= 50) {
    grade = '达到装配率基本要求（未达A级）';
    gradeCode = 'basic';
  }

  return { rate, grade, gradeCode };
}

/**
 * 估算单位面积碳排放（kgCO2/㎡）
 * 依据：GB/T 51366-2019《建筑碳排放计算标准》
 *   计算边界：建材生产运输与建造阶段的主体结构隐含碳（阶段划分与边界参照 GB/T 51366-2019）
 *   不含运行阶段碳排放
 *   数值采用 CLCD / ICE 等碳排放数据库经验均值
 *   注：该标准规定计算方法与边界，不规定单位面积限值
 *
 * 参考数据（中国平均）：
 *   - 现浇混凝土框架：500-650 kgCO2/㎡
 *   - 现浇剪力墙：600-750 kgCO2/㎡（墙体材料多）
 *   - 钢结构：400-550 kgCO2/㎡（钢材隐含碳高但用量少，且可回收）
 *   - 装配式混凝土：略低于现浇（减少现场浪费）
 *
 * 层数修正：层数越高，竖向构件占比增大，单位面积碳排略增
 */
export function estimateCarbonEmission(schemeId: string, floors: number): number {
  const baseMap: Record<string, number> = {
    frame: 520,
    'frame-shearwall': 580,
    shearwall: 640,
    steel: 460,
    prefabricated: 500,
    'prefab-steel': 420,
    composite: 500,
    masonry: 380,
    'frame-corewall': 620,
    'tube-in-tube': 660,
    'mass-timber': 150,
    'space-truss': 430,
  };
  let base = baseMap[schemeId] || 550;
  // 层数修正（每 10 层 +3%）
  if (floors > 10) base *= 1 + Math.floor((floors - 10) / 10) * 0.03;
  // 低层项目单位面积碳排略低（基础占比小）
  if (floors <= 3) base *= 0.92;
  return Math.round(base);
}

/**
 * 施工安全风险等级评估
 */
export function estimateConstructionRisk(
  schemeId: string,
  floors: number
): { level: 'low' | 'medium' | 'high'; notes: string[] } {
  const riskMap: Record<string, string[]> = {
    frame: ['高处作业', '模板支设', '混凝土浇筑'],
    'frame-shearwall': ['高处作业', '脚手架', '大体积混凝土'],
    shearwall: ['高处作业', '脚手架', '大模板施工', '起重吊装'],
    steel: ['高处作业', '起重吊装', '焊接作业', '高空拼装'],
    prefabricated: ['起重吊装', '构件安装', '节点连接'],
    'prefab-steel': ['起重吊装', '高空拼装', '焊接作业', '构件运输'],
    composite: ['高处作业', '钢混界面施工', '起重吊装', '混凝土浇筑'],
    masonry: ['人工砌筑', '高处作业', '质量控制'],
    'frame-corewall': ['高处作业', '核心筒滑模', '外框安装', '施工组织复杂'],
    'tube-in-tube': ['高空作业', '巨型构件安装', '施工组织极复杂', '测量控制'],
    'mass-timber': ['起重吊装', '构件连接', '防火处理', '防潮控制'],
    'space-truss': ['高空拼装', '起重吊装', '焊接作业', '整体提升'],
  };

  const notes = riskMap[schemeId] || [];
  let level: 'low' | 'medium' | 'high' = 'low';

  if (floors > 10) level = 'medium';
  if (floors > 30) level = 'high';
  if (schemeId === 'steel' && floors > 20) level = 'high';

  return { level, notes };
}

/**
 * 基础方案建议 - 根据地勘类型和上部结构
 */
export function suggestFoundation(
  schemeId: string,
  geologyType: string,
  floors: number,
  soilCategory: string
): IFoundationSuggestion {
  const isHighRise = floors >= 15;
  const isLowRise = floors <= 3;

  let foundationType = '';
  let reason = '';
  const notes: string[] = [];

  if (geologyType === 'rock') {
    foundationType = '天然地基 + 独立基础/条形基础';
    reason = '岩石地基承载力高，压缩性小，上部结构荷载可直接由天然地基承担';
    notes.push('岩石地基需进行岩体强度和完整性检验');
    notes.push('需注意边坡稳定性及抗浮设计');
    if (isHighRise) {
      foundationType = '岩石锚杆基础 / 桩基础（嵌岩桩）';
      reason = '高层建筑荷载大，需采用嵌岩桩或锚杆基础以提供足够承载力和抗拔力';
    }
  } else if (geologyType === 'loess') {
    if (isHighRise) {
      foundationType = '桩基础（灌注桩/预应力管桩）+ 地基处理';
      reason = '湿陷性黄土需消除湿陷性，高层采用桩基础穿透湿陷性土层';
    } else if (isLowRise) {
      foundationType = '强夯法 / 灰土挤密桩地基处理 + 条形基础';
      reason = '低层建筑可采用地基处理消除湿陷性，降低造价';
    } else {
      foundationType = 'CFG桩复合地基 / 桩基础';
      reason = '中高层建筑需根据湿陷等级选用复合地基或桩基础';
    }
    notes.push('需进行湿陷性等级评价（Ⅰ~Ⅳ级）');
    notes.push('应做好场地排水，防止雨水下渗');
    notes.push('基础埋深应大于大气影响深度');
  } else if (geologyType === 'clay') {
    if (isHighRise) {
      foundationType = '桩基础（钻孔灌注桩 / 预应力管桩）';
      reason = '高层建筑荷载较大，一般黏土需采用桩基础，桩端进入较好持力层';
    } else {
      foundationType = '天然地基 + 筏板基础 / 条形基础';
      reason = '一般黏土承载力中等，多层建筑可采用天然地基方案';
    }
    notes.push('需注意软弱下卧层验算');
    notes.push('关注地基沉降和不均匀沉降控制');
  } else {
    // fill / 其他
    foundationType = '桩基础 / 复合地基（需专项论证）';
    reason = '填土地基均匀性差，承载力低，需进行地基处理或采用桩基础穿透填土层';
    notes.push('填土成分复杂，需详细勘察查明填土性质和厚度');
    notes.push('建议进行专项地基方案论证');
    notes.push('需特别关注工后沉降问题');
  }

  // 上部结构修正
  if (schemeId === 'steel') {
    notes.push('钢结构自重较轻，对基础承载力要求相对较低');
  }
  if (schemeId === 'shearwall') {
    notes.push('剪力墙结构自重较大，基础底板配筋率相应提高');
  }

  return { foundationType, reason, notes };
}

/**
 * 极端参数检测
 * 检测是否超出常规设计范围
 */
export function checkExtremeParams(params: IProjectParams): IExtremeParamAlert {
  const reasons: string[] = [];
  const height = resolveBuildingHeight(params);

  // 层数 > 60 层
  if (params.floors > 60) {
    reasons.push(`建筑层数 ${params.floors} 层（约 ${height}m），超出常规高层设计范围，属于超高层建筑，需进行专项超限设计审查。`);
  }

  // 层数 ≤ 0 或不合理
  if (params.floors < 1) {
    reasons.push('建筑层数不能小于1层。');
  }

  // 预算过低
  if (params.budget < 800) {
    reasons.push(`单位造价 ${params.budget} 元/㎡ 过低，远低于常规结构造价下限，无法满足基本的结构安全要求。`);
  }

  // 预算过高（异常）
  if (params.budget > 20000) {
    reasons.push(`单位造价 ${params.budget} 元/㎡ 超出常规结构造价范围，请确认是否为总造价而非单位造价。`);
  }

  // 高度与结构体系严重不匹配
  const intensity = parseInt(params.seismicIntensity, 10);
  if (params.structurePreference !== 'any' && isKnownSystem(params.structurePreference)) {
    const limit = getHeightLimit(params.structurePreference, intensity);
    if (height > limit * 1.5) {
      const nameMap: Record<string, string> = {
        frame: '框架结构',
        'frame-shearwall': '框架-剪力墙结构',
        shearwall: '剪力墙结构',
        steel: '钢结构',
        prefabricated: '装配式结构',
      };
      reasons.push(
        `建筑高度 ${height}m 与所选结构体系「${nameMap[params.structurePreference] || params.structurePreference}」严重不匹配（${params.seismicIntensity}度设防该体系常规适用高度 ≤ ${limit}m），需进行超限审查或更换结构体系。`
      );
    }
  }

  // 面积过小
  if (params.area < 200) {
    reasons.push(`建筑面积 ${params.area}㎡ 过小，可能为小品建筑或构筑物，不适用本工具的方案比选。`);
  }

  // 跨度过大
  if (params.mainSpan > 60) {
    reasons.push(`主要跨度 ${params.mainSpan}m 超出常规建筑跨度范围，可能需要大跨度专项结构设计。`);
  }

  // 9度设防 + 高层
  if (params.seismicIntensity === '9' && params.floors > 30) {
    reasons.push('9度高烈度区 + 30层以上高层建筑，抗震设计难度极大，需进行专项抗震性能化设计。');
  }

  return {
    isExtreme: reasons.length > 0,
    reasons,
    suggestion:
      '该组合超出常规设计范围，建议咨询专业设计院进行专项论证。本工具仅用于常规建筑方案的概念比选。',
  };
}

// ============ 方案数据 ============

// ============ 结构体系库（12类） ============

export const STRUCTURE_SYSTEM_LIBRARY: IStructureScheme[] = [
  {
    id: 'frame',
    name: '框架结构',
    description:
      '框架结构是由梁和柱以刚接或铰接相连接而成的承重结构体系，竖向荷载和水平荷载均由框架承担。',
    applicableScenarios:
      '适用于10层以下的多层住宅、办公楼、教学楼、商场等建筑，建筑平面布置灵活，空间开阔。',
    advantages: [
      '建筑平面布置灵活，可获得较大使用空间',
      '构造简单，施工方便，造价较低',
      '技术成熟，设计经验丰富',
      '改建、扩建相对容易',
    ],
    disadvantages: [
      '侧向刚度较小，层数受限制',
      '抗震性能不如剪力墙结构',
      '柱截面较大，影响建筑使用面积',
      '高烈度地区适用高度有限',
    ],
    metrics: {
      cost: 2800,
      duration: 12,
      seismicPerformance: 6.5,
      constructionDifficulty: 5,
      sustainability: 6,
      precastRate: { rate: 22, grade: '未达到装配式建筑装配率要求', gradeCode: 'none' },
      carbonEmission: 520,
      safetyRisk: 'medium',
    },
  },
  {
    id: 'frame-shearwall',
    name: '框架-剪力墙结构',
    description:
      '框架-剪力墙结构是在框架结构中设置适当剪力墙的结构体系，兼具框架结构布置灵活和剪力墙刚度大的优点。',
    applicableScenarios:
      '适用于10-40层的高层住宅、办公楼、酒店等，需要灵活空间同时对抗震有较高要求的项目。',
    advantages: [
      '建筑平面布置灵活，可获得较大使用空间',
      '抗震性能优异，侧向刚度大，层间位移小',
      '技术成熟，施工经验丰富',
      '经济性较好，造价比纯剪力墙结构低',
    ],
    disadvantages: [
      '剪力墙布置影响建筑平面功能布局',
      '结构计算相对复杂，需专业软件分析',
      '施工工序较多，周期略长于纯框架',
    ],
    metrics: {
      cost: 3800,
      duration: 16,
      seismicPerformance: 8.5,
      constructionDifficulty: 6.5,
      sustainability: 7,
      precastRate: { rate: 30, grade: '未达到装配式建筑装配率要求', gradeCode: 'none' },
      carbonEmission: 580,
      safetyRisk: 'medium',
    },
  },
  {
    id: 'shearwall',
    name: '剪力墙结构',
    description:
      '剪力墙结构是利用建筑物的墙体作为主要承重和抗侧力构件的结构体系，墙体同时承担竖向荷载和水平荷载。',
    applicableScenarios:
      '适用于15-50层的高层住宅、公寓等，特别适合抗震设防烈度较高地区的住宅类项目。',
    advantages: [
      '侧向刚度大，抗震性能优异',
      '墙体同时作为分隔墙，建筑功能与结构统一',
      '结构整体性好，安全储备高',
      '适合标准化设计和工业化施工',
    ],
    disadvantages: [
      '建筑平面布置受限，空间灵活性差',
      '自重大，基础造价较高',
      '剪力墙开洞受限，影响建筑造型',
      '材料用量较大，造价偏高',
    ],
    metrics: {
      cost: 4400,
      duration: 20,
      seismicPerformance: 9.2,
      constructionDifficulty: 6,
      sustainability: 6.5,
      precastRate: { rate: 40, grade: '未达到装配式建筑装配率要求', gradeCode: 'none' },
      carbonEmission: 640,
      safetyRisk: 'medium',
    },
  },
  {
    id: 'steel',
    name: '钢结构',
    description:
      '钢结构是以钢材为主要承重构件的结构体系，具有强度高、自重轻、塑性韧性好、施工速度快等优点。',
    applicableScenarios:
      '适用于大跨度、超高层、造型复杂的建筑，如体育馆、会展中心、超高层办公楼等。',
    advantages: [
      '强度高，自重轻，抗震性能好',
      '工厂预制，现场装配，施工速度快',
      '建筑造型灵活，适合复杂曲面和大跨度',
      '钢材可回收利用，绿色环保',
    ],
    disadvantages: [
      '造价较高，材料成本大',
      '防火性能差，需做防火处理',
      '防腐维护成本高',
      '对施工精度和焊接质量要求高',
    ],
    metrics: {
      cost: 5500,
      duration: 14,
      seismicPerformance: 8.8,
      constructionDifficulty: 7.5,
      sustainability: 8.5,
      precastRate: { rate: 85, grade: 'AA级', gradeCode: 'AA' },
      carbonEmission: 460,
      safetyRisk: 'high',
    },
  },
  {
    id: 'prefabricated',
    name: '装配式混凝土结构(PC)',
    description:
      '装配式混凝土结构（PC）是将部分或全部混凝土构件在工厂预制，运输到现场进行装配的结构体系，是建筑工业化的核心方向。',
    applicableScenarios:
      '适用于标准化程度高的住宅、公寓、学校、保障房等项目，尤其适合政府推广装配式建筑的地区。',
    advantages: [
      '工厂预制，质量稳定可控',
      '现场湿作业少，施工速度快',
      '减少现场扬尘和噪音，绿色环保',
      '受季节天气影响小，工期可控',
    ],
    disadvantages: [
      '建造成本略高于现浇（运输+吊装费用）',
      '节点连接是关键技术难点',
      '对预制构件生产设备要求高',
      '建筑平面标准化要求较高',
    ],
    metrics: {
      cost: 4200,
      duration: 14,
      seismicPerformance: 7.8,
      constructionDifficulty: 6,
      sustainability: 8,
      precastRate: { rate: 70, grade: 'A级', gradeCode: 'A' },
      carbonEmission: 500,
      safetyRisk: 'medium',
    },
  },
  {
    id: 'prefab-steel',
    name: '装配式钢结构',
    description:
      '装配式钢结构是钢结构与装配式建造方式的深度结合，所有构件工厂预制、现场螺栓/焊接装配，工业化程度最高。',
    applicableScenarios:
      '适用于超高层办公楼、大跨度场馆、装配式住宅、模块化建筑等，对工期要求紧的项目尤其适用。',
    advantages: [
      '工业化程度最高，施工速度最快',
      '自重轻，基础造价低',
      '抗震性能优异，延性好',
      '钢材可回收，全生命周期绿色',
    ],
    disadvantages: [
      '单位造价较高',
      '防火防腐要求高，维护成本大',
      '对加工精度和安装精度要求极高',
      '隔声隔热性能需专项处理',
    ],
    metrics: {
      cost: 5800,
      duration: 10,
      seismicPerformance: 9.0,
      constructionDifficulty: 7,
      sustainability: 9,
      precastRate: { rate: 90, grade: 'AA级', gradeCode: 'AA' },
      carbonEmission: 420,
      safetyRisk: 'high',
    },
  },
  {
    id: 'composite',
    name: '钢-混凝土组合结构',
    description:
      '钢-混凝土组合结构充分发挥钢材抗拉和混凝土抗压的各自优势，常见形式有钢骨混凝土、钢管混凝土、组合梁等。',
    applicableScenarios:
      '适用于高层和超高层建筑、大跨度结构、转换层结构等，对刚度和承载力都有较高要求的项目。',
    advantages: [
      '充分发挥钢与混凝土两种材料的优势',
      '承载力高，截面小，增加使用面积',
      '抗震性能好，延性优于纯混凝土结构',
      '耐火性能优于纯钢结构',
    ],
    disadvantages: [
      '构造复杂，施工难度大',
      '造价较高，介于钢结构与混凝土结构之间',
      '节点构造复杂，设计难度大',
      '对施工工艺和质量控制要求高',
    ],
    metrics: {
      cost: 4800,
      duration: 16,
      seismicPerformance: 8.8,
      constructionDifficulty: 8,
      sustainability: 7.5,
      precastRate: { rate: 55, grade: '达到装配率基本要求（未达A级）', gradeCode: 'basic' },
      carbonEmission: 500,
      safetyRisk: 'high',
    },
  },
  {
    id: 'masonry',
    name: '砌体结构',
    description:
      '砌体结构是由块材（砖、砌块、石材等）通过砂浆砌筑而成的结构体系，是最传统也是最经济的结构形式之一。',
    applicableScenarios:
      '适用于7层以下的多层住宅、宿舍、办公楼、小型商业等，尤其适合造价敏感的乡镇和三四线城市项目。',
    advantages: [
      '造价低廉，经济性最好',
      '材料易得，施工技术门槛低',
      '隔声隔热性能好，居住舒适度高',
      '维护成本低，耐久性好',
    ],
    disadvantages: [
      '抗震性能差，适用高度有限',
      '自重大，对地基承载力要求高',
      '砌筑劳动强度大，工业化程度低',
      '墙体拆除改造困难',
    ],
    metrics: {
      cost: 1800,
      duration: 10,
      seismicPerformance: 4.0,
      constructionDifficulty: 3,
      sustainability: 5.5,
      precastRate: { rate: 5, grade: '未达到装配式建筑装配率要求', gradeCode: 'none' },
      carbonEmission: 380,
      safetyRisk: 'low',
    },
  },
  {
    id: 'frame-corewall',
    name: '框架-核心筒结构',
    description:
      '框架-核心筒结构是由中央钢筋混凝土核心筒和外围框架组成的结构体系，是目前超高层建筑最常用的结构形式之一。',
    applicableScenarios:
      '适用于40-80层的超高层办公楼、酒店、公寓等，建筑高度100-200m的超高层项目。',
    advantages: [
      '抗侧刚度大，适用高度高',
      '核心筒集中布置交通核，建筑功能合理',
      '外围柱距大，办公空间开阔灵活',
      '抗震性能好，两道抗震防线',
    ],
    disadvantages: [
      '结构计算复杂，需专项分析',
      '造价较高，施工难度大',
      '核心筒面积占比较大，得房率略低',
      '施工周期长，技术要求高',
    ],
    metrics: {
      cost: 5000,
      duration: 28,
      seismicPerformance: 9.0,
      constructionDifficulty: 8.5,
      sustainability: 7,
      precastRate: { rate: 35, grade: '未达到装配式建筑装配率要求', gradeCode: 'none' },
      carbonEmission: 620,
      safetyRisk: 'high',
    },
  },
  {
    id: 'tube-in-tube',
    name: '筒中筒结构',
    description:
      '筒中筒结构由内筒（通常为剪力墙核心筒）和外筒（密柱深梁框筒或支撑框筒）组成，两个筒体共同抵抗水平荷载。',
    applicableScenarios:
      '适用于60层以上的超高层建筑（200-400m），如地标性超高层办公楼、酒店、综合体等。',
    advantages: [
      '空间整体受力，抗侧刚度极大',
      '适用高度最高，可达400m以上',
      '抗震抗风性能优异，扭转刚度大',
      '建筑造型挺拔，立面美观',
    ],
    disadvantages: [
      '造价极高，结构材料用量大',
      '设计难度极大，需复杂分析',
      '施工难度高，周期长',
      '外围密柱影响立面开窗和视线',
    ],
    metrics: {
      cost: 6000,
      duration: 36,
      seismicPerformance: 9.5,
      constructionDifficulty: 9.5,
      sustainability: 6.5,
      precastRate: { rate: 45, grade: '未达到装配式建筑装配率要求', gradeCode: 'none' },
      carbonEmission: 660,
      safetyRisk: 'high',
    },
  },
  {
    id: 'mass-timber',
    name: '胶合木结构',
    description:
      '胶合木结构（Mass Timber）是以工程木产品（CLT正交胶合木、Glulam胶合木等）为主要承重构件的现代木结构体系。',
    applicableScenarios:
      '适用于8层以下的低层/多层住宅、办公楼、学校、文旅建筑等，特别适合追求绿色低碳、亲近自然的项目。',
    advantages: [
      '碳排放最低，真正的绿色低碳建筑',
      '工厂预制，现场拼装，施工速度快',
      '建筑美学好，室内空间温暖自然',
      '自重轻，基础造价低，抗震性能好',
    ],
    disadvantages: [
      '造价较高，木材材料成本大',
      '防火设计要求高（需阻燃处理）',
      '适用高度有限（国内规范10层/30m以下）',
      '防腐防潮需专项设计',
    ],
    metrics: {
      cost: 6500,
      duration: 10,
      seismicPerformance: 7.5,
      constructionDifficulty: 6.5,
      sustainability: 10,
      precastRate: { rate: 95, grade: 'AAA级', gradeCode: 'AAA' },
      carbonEmission: 150,
      safetyRisk: 'medium',
    },
  },
  {
    id: 'space-truss',
    name: '空间结构(网架/桁架)',
    description:
      '空间结构包括网架、网壳、桁架、悬索、膜结构等形式，具有受力合理、跨度大、自重轻、造型丰富等特点。',
    applicableScenarios:
      '适用于大跨度公共建筑，如体育馆、会展中心、航站楼、高铁站房、大型厂房等跨度30m以上的项目。',
    advantages: [
      '跨越能力强，可实现超大跨度',
      '自重轻，材料利用率高',
      '造型丰富美观，建筑表现力强',
      '工厂预制，现场拼装，工期可控',
    ],
    disadvantages: [
      '节点构造复杂，加工精度要求高',
      '屋面系统造价较高',
      '防火防腐要求高',
      '对支座沉降敏感',
    ],
    metrics: {
      cost: 5200,
      duration: 12,
      seismicPerformance: 7.0,
      constructionDifficulty: 8,
      sustainability: 8,
      precastRate: { rate: 80, grade: 'AA级', gradeCode: 'AA' },
      carbonEmission: 430,
      safetyRisk: 'high',
    },
  },
];

// 智能方案筛选与生成：从12类结构体系中，根据项目参数动态筛选最适用的3个方案
// 筛选逻辑：高度适配性 + 建筑类型匹配 + 跨度匹配 + 预算约束 + 抗震需求 → 综合评分 → top 3
export function generateSchemesFromParams(params: IProjectParams): IStructureScheme[] {
  const height = resolveBuildingHeight(params);
  const parsedIntensity = parseInt(params.seismicIntensity, 10);
  const intensity = isNaN(parsedIntensity) ? 7 : Math.max(6, Math.min(9, parsedIntensity));

  const isLowRise = params.floors <= 6;        // 低层（≤6层）
  const isMidRise = params.floors > 6 && params.floors <= 18; // 中层（7-18层）
  const isHighRise = params.floors > 18 && params.floors <= 40; // 高层（19-40层）
  const isSuperHighRise = params.floors > 40; // 超高层（>40层）
  const isLargeSpan = params.mainSpan >= 18;  // 大跨度（≥18m）
  const isGreenFocus = params.buildingType === 'school' || params.buildingType === 'gymnasium';

  // 对每个结构体系打分（满分100），从库中筛选出3个最佳
  const scored = STRUCTURE_SYSTEM_LIBRARY.map((scheme) => {
    let score = 50; // 基础分

    // === 1. 高度适配性（最重要，权重最大）===
    const heightLimit = getHeightLimit(scheme.id, intensity);
    const heightRatio = height / heightLimit;

    if (heightRatio > 1.0) {
      // 高度超限 → 严重扣分，直接降到低分档
      score -= 40 + (heightRatio - 1) * 50;
    } else if (heightRatio > 0.9) {
      // 接近限值 → 小扣分
      score += 5;
    } else if (heightRatio > 0.5) {
      // 处于合理区间 → 高分
      score += 15;
    } else if (heightRatio > 0.2) {
      // 高度远低于限值 → 可用但不算最优（杀鸡用牛刀）
      score += 8;
    } else {
      // 极低层用高层体系 → 明显不经济
      score -= 5;
    }

    // === 2. 建筑类型匹配 ===
    const typeMatchMap: Record<string, string[]> = {
      residential: ['shearwall', 'frame-shearwall', 'prefabricated', 'frame', 'masonry', 'frame-corewall', 'tube-in-tube'],
      office: ['frame-shearwall', 'frame-corewall', 'tube-in-tube', 'composite', 'steel', 'prefab-steel', 'frame'],
      school: ['frame', 'masonry', 'prefabricated', 'frame-shearwall', 'mass-timber', 'steel'],
      factory: ['steel', 'prefab-steel', 'space-truss', 'frame', 'composite'],
      gymnasium: ['space-truss', 'steel', 'prefab-steel', 'composite', 'mass-timber'],
    };
    const typeMatch = typeMatchMap[params.buildingType] || [];
    const typeRank = typeMatch.indexOf(scheme.id);
    if (typeRank === 0) score += 15;
    else if (typeRank === 1) score += 12;
    else if (typeRank === 2) score += 9;
    else if (typeRank === 3) score += 6;
    else if (typeRank === 4) score += 3;
    else if (typeRank >= 0) score += 1;
    else score -= 8; // 完全不在推荐列表里

    // === 3. 跨度匹配 ===
    if (isLargeSpan) {
      // 大跨度项目优先空间结构、钢结构
      if (scheme.id === 'space-truss') score += 20;
      else if (scheme.id === 'steel' || scheme.id === 'prefab-steel') score += 15;
      else if (scheme.id === 'composite') score += 8;
      else if (scheme.id === 'frame') score -= 5; // 普通框架不适合大跨
      else if (scheme.id === 'masonry') score -= 15;
    }

    // === 4. 预算约束 ===
    const estCost = estimateCost(scheme.id, params.floors, params.seismicIntensity, params.soilCategory, params.mainSpan);
    const budgetRatio = estCost / params.budget;
    if (budgetRatio <= 0.7) {
      score += 8; // 远低于预算，经济性好
    } else if (budgetRatio <= 0.9) {
      score += 12; // 预算充足（最佳区间）
    } else if (budgetRatio <= 1.0) {
      score += 8; // 接近预算上限
    } else if (budgetRatio <= 1.1) {
      score -= 5; // 略超预算
    } else if (budgetRatio <= 1.3) {
      score -= 15; // 明显超预算
    } else {
      score -= 30; // 远超预算
    }

    // === 5. 抗震设防烈度匹配 ===
    if (intensity >= 9) {
      // 9度高烈度：优先剪力墙、框剪、框筒、筒中筒等刚度大的体系
      if (['shearwall', 'frame-shearwall', 'frame-corewall', 'tube-in-tube', 'composite'].includes(scheme.id)) score += 10;
      if (scheme.id === 'masonry') score -= 20; // 砌体9度不适用
      if (scheme.id === 'mass-timber') score -= 10;
    } else if (intensity >= 8) {
      // 8度：常规高层体系都适用
      if (['shearwall', 'frame-shearwall', 'frame-corewall'].includes(scheme.id)) score += 6;
    } else {
      // 6-7度低烈度：可选范围广，砌体、框架等经济性方案加分
      if (scheme.id === 'masonry') score += 8;
      if (scheme.id === 'frame') score += 4;
    }

    // === 6. 绿色低碳加分（学校/体育馆等公共建筑偏向绿色） ===
    if (isGreenFocus) {
      if (scheme.id === 'mass-timber') score += 10;
      if (scheme.id === 'prefabricated' || scheme.id === 'prefab-steel') score += 5;
      if (scheme.id === 'steel' || scheme.id === 'composite') score += 3;
    }

    // === 7. 场地类别修正 ===
    // 软弱地基上，自重轻的结构体系（钢结构、木结构）加分；自重大的（砌体、剪力墙）减分
    if (params.soilCategory === 'Ⅳ') {
      if (['steel', 'prefab-steel', 'mass-timber'].includes(scheme.id)) score += 5;
      if (['masonry', 'shearwall', 'tube-in-tube'].includes(scheme.id)) score -= 5;
    }

    // === 8. 低层项目特殊处理：砌体、框架、木结构更有优势 ===
    if (isLowRise) {
      if (scheme.id === 'masonry') score += 12; // 6层以下砌体经济性最佳
      if (scheme.id === 'mass-timber') score += 8;
      if (scheme.id === 'frame') score += 5;
      if (['tube-in-tube', 'frame-corewall'].includes(scheme.id)) score -= 15; // 低层用筒体太浪费
    }

    // === 9. 超高层特殊处理 ===
    if (isSuperHighRise) {
      if (scheme.id === 'tube-in-tube') score += 15;
      if (scheme.id === 'frame-corewall') score += 12;
      if (scheme.id === 'composite') score += 8;
      if (['frame', 'masonry', 'mass-timber', 'space-truss'].includes(scheme.id)) score -= 20;
    }

    return { scheme, score };
  });

  // 如果用户指定了结构偏好，将该偏好列过滤为仅包含该体系，但仍取top3
  let candidates = scored;
  if (params.structurePreference && params.structurePreference !== 'any') {
    const pref = params.structurePreference;
    candidates = scored.filter((s) => s.scheme.id === pref);
    // 如果用户只选了一个体系且符合条件，也取它（即使只有1个也返回）
    if (candidates.length === 0) {
      candidates = scored; // 兜底：如果指定体系完全不适用，退化为全库筛选
    }
  }

  // 按得分降序排序，取 top 3
  candidates.sort((a, b) => b.score - a.score);
  let top3 = candidates.slice(0, 3);

  // ===== 候选池保底：不足 2 套时从全库补充最相关的备选方案 =====
  // 保证每次比选至少呈现 2 套（最佳 + 备选），维持多方案比选的演示效果
  if (top3.length < 2) {
    const existingIds = new Set(top3.map((t) => t.scheme.id));
    // 剩余方案按与主方案的相关度排序：优先同结构材料/同受力体系的方案
    const remaining = scored.filter((s) => !existingIds.has(s.scheme.id));
    remaining.sort((a, b) => b.score - a.score);
    // 从剩余方案中补足到至少 2 套
    while (top3.length < 2 && remaining.length > 0) {
      const next = remaining.shift()!;
      top3.push(next);
    }
  }

  // ===== 领域调节：高烈度高层住宅优先抗震墙体系 =====
  // 规则与加成幅度统一声明在 domain-adjustments.ts（单一数据源），
  // 与综合评分的调节分同源，避免两处硬编码出现口径漂移。
  top3 = top3.map((item) => ({
    ...item,
    score: item.score + resolveScreeningBonus(item.scheme.id, params),
  }));
  top3.sort((a, b) => b.score - a.score);

  // 为每个方案附加动态计算的指标（走统一评估入口，带参数指纹缓存）
  return top3.map(({ scheme }) => toScheme(evaluateScheme(scheme.id, params)));
}

// ============ 推荐 / 对话 / 预设 ============

export const MOCK_RECOMMENDATION: IRecommendation = {
  schemeId: 'frame-shearwall',
  schemeName: '框架-剪力墙结构',
  reason:
    '综合考虑项目参数（30层住宅、8度设防、Ⅱ类场地、4500元/㎡预算），框架-剪力墙结构是最优选择。该方案在抗震性能、造价经济性、施工周期和空间灵活性之间取得了最佳平衡：\n\n1. **抗震性能优异**：8.5分的抗震性能完全满足8度设防要求，剪力墙提供了足够的侧向刚度和抗侧承载力\n2. **经济性好**：4200元/㎡的造价低于4500元/㎡的预算约束，性价比高\n3. **施工周期合理**：18个月工期符合住宅项目常规建设周期\n4. **空间布置灵活**：框架部分提供了灵活的住宅户型布局空间\n5. **技术成熟可靠**：框架-剪力墙结构在国内高层住宅中应用广泛，施工经验丰富',
  overallScore: 8.6,
};

export const MOCK_CHAT_MESSAGES: IChatMessage[] = [
  {
    id: '1',
    role: 'assistant',
    content:
      '您好！我是结构设计智能助手。我可以为您解答关于结构方案选型、抗震设计、施工技术等方面的问题。\n\n您可以问我：\n- 哪个方案成本最低？\n- 剪力墙结构和框架结构抗震性能差多少？\n- 这个方案施工难点在哪里？',
    timestamp: Date.now(),
  },
];

export const PRESET_CASES: IPresetCase[] = [
  {
    id: 'xian-residential',
    name: '西安高层住宅',
    description: '30层住宅 · 8度设防 · Ⅱ类场地',
    icon: '🏠',
    params: {
      buildingType: 'residential',
      floors: 30,
      area: 15000,
      structurePreference: 'any',
      seismicIntensity: '8',
      soilCategory: 'Ⅱ',
      geologyType: 'loess',
      mainSpan: 8,
      budget: 4500,
      windPressure: '0.35',
      snowPressure: '0.2',
      fortificationCategory: 'standard',
      buildingHeight: 90,
    },
    weights: { cost: 25, duration: 20, safety: 35, green: 20 },
  },
  {
    id: 'factory-steel',
    name: '单层钢结构厂房',
    description: '单层厂房 · 轻钢结构 · 大跨度',
    icon: '🏭',
    params: {
      buildingType: 'factory',
      floors: 1,
      area: 8000,
      structurePreference: 'steel',
      seismicIntensity: '7',
      soilCategory: 'Ⅱ',
      geologyType: 'clay',
      mainSpan: 24,
      budget: 2800,
      windPressure: '0.4',
      snowPressure: '0.35',
      fortificationCategory: 'standard',
      buildingHeight: 10,
    },
    weights: { cost: 30, duration: 35, safety: 20, green: 15 },
  },
  {
    id: 'school-frame',
    name: '6层框架教学楼',
    description: '6层教学楼 · 框架结构 · 重点设防',
    icon: '🏫',
    params: {
      buildingType: 'school',
      floors: 6,
      area: 6000,
      structurePreference: 'frame',
      seismicIntensity: '8',
      soilCategory: 'Ⅲ',
      geologyType: 'clay',
      mainSpan: 7.5,
      budget: 3800,
      windPressure: '0.4',
      snowPressure: '0.25',
      fortificationCategory: 'key',
      buildingHeight: 22.8,
    },
    weights: { cost: 20, duration: 20, safety: 45, green: 15 },
  },
];

export const THINKING_STEPS_TEMPLATE: IThinkingStep[] = [
  { id: 1, title: '读取项目参数', description: '解析建筑类型、层数、面积、设防烈度、场地类别、地质条件等', status: 'pending' },
  { id: 2, title: '极端参数校验', description: '检测参数组合是否在常规设计范围内，超限则给出预警', status: 'pending' },
  { id: 3, title: '评估抗侧力需求', description: '根据设防烈度和建筑高度，计算所需侧向刚度和抗震等级', status: 'pending' },
  { id: 4, title: '筛选适用结构体系', description: '按高度限值、烈度等级和建筑功能筛选候选体系', status: 'pending' },
  { id: 5, title: '预算约束校验', description: '结合造价估算，剔除超出预算约束范围的方案', status: 'pending' },
  { id: 6, title: '规范符合性计算', description: '按GB/T 50011/GB/T 50010简化计算层间位移角、剪重比、周期比等', status: 'pending' },
  { id: 7, title: '基础方案建议', description: '结合地质条件和上部结构，推荐适用的基础形式', status: 'pending' },
  { id: 8, title: '按目标权重综合排序', description: '根据成本、工期、安全、绿色四维权重，计算综合得分并排序', status: 'pending' },
];

export const METRIC_DIMENSIONS = [
  { key: 'cost', label: '造价', inverse: true, unit: '元/㎡' },
  { key: 'duration', label: '工期', inverse: true, unit: '月' },
  { key: 'seismicPerformance', label: '抗震性能', inverse: false, unit: '分' },
  { key: 'constructionDifficulty', label: '施工难度', inverse: true, unit: '分' },
  { key: 'sustainability', label: '可持续性', inverse: false, unit: '分' },
  { key: 'precastRate', label: '装配率', inverse: false, unit: '%' },
  { key: 'carbonEmission', label: '碳排放', inverse: true, unit: 'kgCO₂/㎡' },
] as const;
