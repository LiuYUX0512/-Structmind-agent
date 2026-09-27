// 规范规则层（声明式）—— 规范知识图谱的**唯一数据源**
// 职责边界：只描述「判什么、依据哪条、适用条件、限值来源、条文原文、可执行限值」，不做数值估算。
// 数值估算与判定求值在 norm-evaluator.ts。
//
// 设计要点（对应架构诊断 P0-1 / P1-2）：
// 1. severity 决定超限时的判定等级 —— 强制性条文超限必须是 fail，不允许降级为 warning；
// 2. **条文原文在此处单一数据源**（原 structure.ts 的 clauseTemplates 已迁入）；
//    P1-2 把 code-knowledge.ts 的重复条文库也收编为本表的投影，消除双源漂移。
// 3. 未知结构体系不再静默兜底（|| 默认值），由求值器显式报错。
// 4. **可执行限值 threshold**：每条规则自带「怎么取值」的求值函数，
//    输出「条文原文 + 适用条件 + 判定限值」三元组，使条文与判定永不脱钩。
//
// EXPORTS: IRuleSeverity, ICodeRule, IThresholdSpec, RULE_REGISTRY,
//          DRIFT_LIMITS, SHEAR_WEIGHT_RATIO_MIN, HEIGHT_LIMITS, AXIAL_RATIO_LIMITS,
//          ALPHA_MAX, CHAR_PERIOD_TG, PERIOD_COEFF, PERIOD_RATIO_BASE,
//          getHeightLimit, getDriftLimit, getShearWeightRatioMin, getPeriodCoeff,
//          getPeriodRatioBase, getAlphaMax, getCharPeriod, isKnownSystem,
//          listKnownSystemIds, calculateBuildingHeight

import type { IProjectParams } from './structure';

/** 条文严重性：决定违反该条时的判定等级 */
export type IRuleSeverity =
  /** 强制性条文（通用规范 / 黑体字条文）：超限必须判 fail */
  | 'mandatory'
  /** 一般性控制指标：超限判 fail，接近限值判 warning */
  | 'general'
  /** 提示性措施要求：仅需提示，不构成违反（恒 warning） */
  | 'advisory';

/** 规则求值上下文 */
export interface IRuleContext {
  schemeId: string;
  params: IProjectParams;
  /** 数值化后的设防烈度（6~9，非法输入已归一） */
  intensity: number;
  /** 建筑高度（m）：优先取用户填写值，否则按层数×3m 估算 */
  height: number;
  /** 结构基本自振周期 T1（s） */
  period: number;
  /** 结构高宽比 H/B */
  aspectRatio: number;
}

/**
 * 可执行限值规格：把「这条规则的限值怎么算」也声明在规则上，而不是散落在求值器里。
 * 输出三元组的第三元（判定限值），与 clauseText（条文原文）、appliesTo（适用条件）配套。
 */
export interface IThresholdSpec {
  /** 限值是否在单条规则内可直接求值（false = 需体系/烈度组合，见 thresholdNote） */
  resolvable: boolean;
  /**
   * 求值函数：给定上下文返回本规则在本方案下的限值（与实测值的比较基准）。
   * 返回 null 表示本规则不适用数值判定（如纯构造措施要求）。
   */
  value: (ctx: IRuleContext) => number | null;
  /** 比较方向：'max' = 实测值不得超过限值；'min' = 实测值不得低于限值 */
  direction: 'max' | 'min';
  /** 限值的人读描述（用于「要求」列，如「≤ 1/550」「≥ 4.8%（8度设防）」） */
  describe: (ctx: IRuleContext) => string;
  /** 取值依据说明（如「按 8 度设防取表 5.2.5」） */
  note?: string;
}

/** 声明式规范规则（不含数值估算；含可执行限值） */
export interface ICodeRule {
  id: string;
  /** 校核项名称（对外展示，与 UI / 回归用例契约一致，禁止随意改动） */
  name: string;
  /**
   * 条文正式名称（面向报告「条文依据」栏展示，贴合规范用语）。
   * 与 name 的区别：name 是界面/回归用的短标签（如「高度适用范围」），
   * clauseTitle 是规范条文自身的名称（如「现浇钢筋混凝土房屋的最大适用高度」）。
   */
  clauseTitle: string;
  /** 标准编号 */
  code: string;
  /** 条文号 */
  clause: string;
  /** 条文原文 / 要点（单一数据源） */
  clauseText: string;
  /** 严重性 */
  severity: IRuleSeverity;
  /** 适用条件：返回 false 时该条不参与本方案校核 */
  appliesTo: (ctx: IRuleContext) => boolean;
  /** 完整出处 */
  source: string;
  /**
   * 规则 key 别名（与旧 code-knowledge.ts 的 ruleKeys 对齐，供 resolveKnowledgeBasis 兼容）。
   * 保留它是为了不破坏既有调用方（tools.ts 按这些 key 取条文依据）。
   */
  ruleKeys: string[];
  /** 可执行限值：条文与判定不脱钩的关键（P1-2） */
  threshold: IThresholdSpec;
}

// ============ 基础几何 ============

/** 建筑高度（m）：按层高 3m 估算 */
export function calculateBuildingHeight(floors: number): number {
  return Math.round(floors * 3 * 10) / 10;
}

// ============ 体系白名单（用于消灭静默兜底）============

const KNOWN_SYSTEM_IDS = [
  'frame',
  'frame-shearwall',
  'shearwall',
  'steel',
  'prefabricated',
  'prefab-steel',
  'composite',
  'masonry',
  'frame-corewall',
  'tube-in-tube',
  'mass-timber',
  'space-truss',
] as const;

export function isKnownSystem(schemeId: string): boolean {
  return (KNOWN_SYSTEM_IDS as readonly string[]).includes(schemeId);
}

export function listKnownSystemIds(): string[] {
  return [...KNOWN_SYSTEM_IDS];
}

// ============ 控制指标常量表 ============

/**
 * 弹性层间位移角限值
 * GB/T 50011-2010（2024 年局部修订）表 5.5.1；强制性通用规范 GB 55002-2021 第 5.1.1 条
 * 注：组合结构/砌体/木结构/空间桁架表 5.5.1 未单列，为工程经验参考值
 */
export const DRIFT_LIMITS: Record<string, number> = {
  frame: 1 / 550,
  'frame-shearwall': 1 / 800,
  shearwall: 1 / 1000,
  steel: 1 / 250,
  prefabricated: 1 / 800,
  'prefab-steel': 1 / 250,
  composite: 1 / 650,
  masonry: 1 / 1200,
  'frame-corewall': 1 / 800,
  'tube-in-tube': 1 / 1000,
  'mass-timber': 1 / 350,
  'space-truss': 1 / 300,
  'frame-corewall-frame': 1 / 800,
};

/**
 * 楼层最小地震剪力系数 λ_min
 * GB 55002-2021 第 4.2.3 条（强制性）及 GB/T 50011-2010 表 5.2.5
 * 本表按 7 度 0.10g、8 度 0.20g 取值；7 度 0.15g、8 度 0.30g 地区
 * 框架分别取 0.036、0.072，其他体系分别取 0.024、0.048。
 */
export const SHEAR_WEIGHT_RATIO_MIN: Record<string, Record<string, number>> = {
  '6': { frame: 0.012, other: 0.008 },
  '7': { frame: 0.024, other: 0.016 },
  '8': { frame: 0.048, other: 0.032 },
  '9': { frame: 0.096, other: 0.064 },
};

/**
 * 各体系在不同设防烈度下的适用最大高度（m）
 * GB/T 50011-2010（2024 年局部修订）表 6.1.1（混凝土）/表 8.1.1（钢结构）/表 7.1.2（砌体）
 * 未在表中单列的体系（钢-混组合、胶合木、空间桁架、装配式）为方案阶段经验参考值。
 */
export const HEIGHT_LIMITS: Record<string, Record<number, number>> = {
  frame: { 6: 60, 7: 50, 8: 40, 9: 24 },
  'frame-shearwall': { 6: 130, 7: 120, 8: 100, 9: 50 },
  shearwall: { 6: 140, 7: 120, 8: 100, 9: 60 },
  steel: { 6: 110, 7: 110, 8: 90, 9: 50 },
  prefabricated: { 6: 80, 7: 70, 8: 60, 9: 30 },
  'prefab-steel': { 6: 110, 7: 110, 8: 90, 9: 50 },
  composite: { 6: 130, 7: 120, 8: 100, 9: 50 },
  masonry: { 6: 21, 7: 21, 8: 18, 9: 12 },
  'frame-corewall': { 6: 150, 7: 130, 8: 100, 9: 70 },
  'tube-in-tube': { 6: 180, 7: 150, 8: 120, 9: 80 },
  'mass-timber': { 6: 20, 7: 16, 8: 12, 9: 8 },
  'space-truss': { 6: 50, 7: 45, 8: 35, 9: 25 },
};

/**
 * 抗震墙墙肢轴压比限值（底部加强部位）
 * GB/T 50011 第 6.4.2 条；GB/T 50010-2010（2024 年局部修订）第 11.7.16 条
 */
export const AXIAL_RATIO_LIMITS: Record<string, number> = {
  grade1_9: 0.4,
  grade1_78: 0.5,
  grade23: 0.6,
};

/**
 * 水平地震影响系数最大值 α_max
 * GB/T 50011-2010（2024 年局部修订）表 5.1.4-1
 * 取各烈度常用设计基本加速度对应值：6度 0.05g、7度 0.10g、8度 0.20g、9度 0.40g。
 */
export const ALPHA_MAX: Record<number, number> = {
  6: 0.04,
  7: 0.08,
  8: 0.16,
  9: 0.32,
};

/**
 * 场地特征周期 Tg（s）
 * GB/T 50011-2010（2024 年局部修订）表 5.1.4-2，按设计地震分组取值。
 * 未指定分组时默认第二组；Ⅰ 类取 Ⅰ1 亚类。
 */
export const CHAR_PERIOD_TG: Record<string, { g1: number; g2: number; g3: number }> = {
  Ⅰ: { g1: 0.25, g2: 0.3, g3: 0.35 },
  Ⅱ: { g1: 0.35, g2: 0.4, g3: 0.45 },
  Ⅲ: { g1: 0.45, g2: 0.55, g3: 0.65 },
  Ⅳ: { g1: 0.65, g2: 0.75, g3: 0.9 },
};

/** 结构基本周期经验系数 T1 ≈ 系数 × 层数 */
export const PERIOD_COEFF: Record<string, number> = {
  frame: 0.1,
  'frame-shearwall': 0.08,
  shearwall: 0.06,
  steel: 0.12,
  prefabricated: 0.09,
  'prefab-steel': 0.11,
  composite: 0.085,
  masonry: 0.07,
  'frame-corewall': 0.06,
  'tube-in-tube': 0.055,
  'mass-timber': 0.095,
  'space-truss': 0.15,
};

/**
 * 规则平面布置下的扭转周期比基准值 Tt/T1
 * 注：实际周期比取决于平面刚度分布，此处为规则建筑基准，
 * 不规则修正（高宽比、大跨空间）由求值器叠加。
 */
export const PERIOD_RATIO_BASE: Record<string, number> = {
  frame: 0.8,
  'frame-shearwall': 0.75,
  shearwall: 0.7,
  steel: 0.82,
  prefabricated: 0.78,
  'prefab-steel': 0.8,
  composite: 0.78,
  masonry: 0.72,
  'frame-corewall': 0.68,
  'tube-in-tube': 0.62,
  'mass-timber': 0.75,
  'space-truss': 0.85,
};

// ============ 取值函数（未知体系显式报错，禁止静默兜底）============

export function getHeightLimit(schemeId: string, intensity: number): number {
  const byIntensity = HEIGHT_LIMITS[schemeId];
  if (!byIntensity) {
    throw new Error(
      `未知结构体系「${schemeId}」，无法查取适用高度限值。已知体系：${listKnownSystemIds().join('、')}`
    );
  }
  const limit = byIntensity[intensity];
  if (limit == null) {
    throw new Error(`结构体系「${schemeId}」缺少 ${intensity} 度的适用高度限值`);
  }
  return limit;
}

export function getDriftLimit(schemeId: string): number {
  const limit = DRIFT_LIMITS[schemeId];
  if (limit == null) {
    throw new Error(
      `未知结构体系「${schemeId}」，无法查取层间位移角限值。已知体系：${listKnownSystemIds().join('、')}`
    );
  }
  return limit;
}

export function getShearWeightRatioMin(schemeId: string, intensity: number): number {
  const row = SHEAR_WEIGHT_RATIO_MIN[String(intensity)];
  const value = row?.[schemeId === 'frame' ? 'frame' : 'other'];
  if (value == null) {
    throw new Error(`缺少 ${intensity} 度设防的楼层最小地震剪力系数限值`);
  }
  return value;
}

export function getPeriodCoeff(schemeId: string): number {
  const coeff = PERIOD_COEFF[schemeId];
  if (coeff == null) {
    throw new Error(`未知结构体系「${schemeId}」，无法查取基本周期经验系数`);
  }
  return coeff;
}

export function getPeriodRatioBase(schemeId: string): number {
  const base = PERIOD_RATIO_BASE[schemeId];
  if (base == null) {
    throw new Error(`未知结构体系「${schemeId}」，无法查取周期比基准值`);
  }
  return base;
}

export function getAlphaMax(intensity: number): number {
  const a = ALPHA_MAX[intensity];
  if (a == null) {
    throw new Error(`缺少 ${intensity} 度设防的水平地震影响系数最大值`);
  }
  return a;
}

/** 取场地特征周期（默认设计地震第二组） */
export function getCharPeriod(soilCategory: string, group: 1 | 2 | 3 = 2): number {
  const row = CHAR_PERIOD_TG[soilCategory];
  if (!row) {
    throw new Error(
      `未知场地类别「${soilCategory}」，无法查取特征周期。已知类别：Ⅰ、Ⅱ、Ⅲ、Ⅳ`
    );
  }
  return group === 1 ? row.g1 : group === 3 ? row.g3 : row.g2;
}

// ============ 规则注册表 ============

export const RULE_REGISTRY: ICodeRule[] = [
  {
    id: 'drift',
    name: '层间位移角',
    clauseTitle: '弹性层间位移角限值',
    code: 'GB/T 50011-2010（2024年局部修订）',
    clause: '表 5.5.1',
    clauseText:
      '多遇地震作用下，结构弹性层间位移角应满足限值要求：框架结构 1/550；框架-抗震墙、板柱-抗震墙、框架-核心筒 1/800；抗震墙、筒中筒 1/1000；多高层钢结构 1/250。该限值用于控制结构在多遇地震下的侧向变形，保证非结构构件不发生严重破坏，过大说明结构侧向刚度不足。',
    severity: 'mandatory',
    source: 'GB/T 50011-2010（2024年局部修订）表 5.5.1 弹性层间位移角限值；GB 55002-2021 第 5.1.1 条',
    appliesTo: () => true,
    ruleKeys: ['drift'],
    threshold: {
      resolvable: true,
      direction: 'max',
      value: (ctx) => getDriftLimit(ctx.schemeId),
      describe: (ctx) => `≤ 1/${Math.round(1 / getDriftLimit(ctx.schemeId))}`,
      note: '按结构体系取表 5.5.1 对应限值',
    },
  },
  {
    id: 'swr',
    name: '剪重比',
    clauseTitle: '楼层最小地震剪力系数（剪重比）',
    code: 'GB 55002-2021 / GB/T 50011-2010',
    clause: '第 4.2.3 条 / 表 5.2.5',
    clauseText:
      '结构各楼层对应于地震作用标准值的楼层剪力系数 λ 不应小于 λ_min。框架结构：6度(0.05g) 0.012、7度(0.10g) 0.024、8度(0.20g) 0.048、9度(0.40g) 0.096；其他结构体系为框架结构的 2/3。剪重比不足说明地震作用偏小，需按规定进行调整。',
    severity: 'mandatory',
    source: 'GB 55002-2021 第 4.2.3 条（强制性）；GB/T 50011-2010（2024年局部修订）表 5.2.5',
    appliesTo: () => true,
    ruleKeys: ['swr'],
    threshold: {
      resolvable: true,
      direction: 'min',
      value: (ctx) => getShearWeightRatioMin(ctx.schemeId, ctx.intensity),
      describe: (ctx) => `≥ ${(getShearWeightRatioMin(ctx.schemeId, ctx.intensity) * 100).toFixed(1)}%（${ctx.intensity}度设防）`,
      note: '框架结构按表 5.2.5 取整；其他体系为框架的 2/3',
    },
  },
  {
    id: 'period',
    name: '周期比 Tt/T1',
    clauseTitle: '结构扭转周期比限值',
    code: 'JGJ 3-2010',
    clause: '第 3.4.5 条',
    clauseText:
      '结构扭转为主的第一自振周期 Tt 与平动为主的第一自振周期 T1 之比，A级高度高层建筑不应大于 0.90，B级高度高层建筑（>150m）不应大于 0.85。周期比用于控制结构扭转效应，防止扭转为主的破坏模式。',
    severity: 'general',
    source: 'JGJ 3-2010《高层建筑混凝土结构技术规程》第 3.4.5 条',
    appliesTo: () => true,
    ruleKeys: ['period'],
    threshold: {
      resolvable: true,
      direction: 'max',
      // B级高度（>150m）限值 0.85，A级 0.90 —— 与求值器内 periodLimit 口径一致
      value: (ctx) => (ctx.height > 150 ? 0.85 : 0.9),
      describe: (ctx) => `≤ ${ctx.height > 150 ? 0.85 : 0.9}（${ctx.height > 150 ? 'B级高度' : 'A级高度'}）`,
      note: 'B级高度（>150m）取 0.85，A级取 0.90',
    },
  },
  {
    id: 'height',
    name: '高度适用范围',
    clauseTitle: '现浇钢筋混凝土房屋的最大适用高度',
    code: 'GB/T 50011-2010（2024年局部修订）',
    clause: '表 6.1.1 / 表 8.1.1 / 表 7.1.2',
    clauseText:
      '现浇钢筋混凝土房屋的最大适用高度应符合规范要求（单位 m）：框架结构 6/7度 60m、8度 40m、9度 24m；框架-抗震墙 130/120/100/50m；全落地抗震墙 140/120/100/60m；框架-核心筒 150/130/100/70m；筒中筒 180/150/120/80m。超限工程需进行专项论证。',
    severity: 'mandatory',
    source: 'GB/T 50011-2010（2024年局部修订）表 6.1.1 最大适用高度',
    appliesTo: () => true,
    ruleKeys: ['height', 'max_height'],
    threshold: {
      resolvable: true,
      direction: 'max',
      value: (ctx) => getHeightLimit(ctx.schemeId, ctx.intensity),
      describe: (ctx) => `≤ ${getHeightLimit(ctx.schemeId, ctx.intensity)} m（${ctx.intensity}度）`,
      note: '按结构体系 + 设防烈度查最大适用高度表',
    },
  },
  {
    id: 'axial_ratio',
    name: '抗震墙墙肢轴压比（估算）',
    clauseTitle: '抗震墙墙肢轴压比限值',
    code: 'GB/T 50011 / GB/T 50010-2010',
    clause: '第 6.4.2 条 / 第 11.7.16 条',
    clauseText:
      '抗震墙底部加强部位墙肢轴压比限值：一级（9度）≤ 0.40；一级（7、8度）≤ 0.50；二、三级 ≤ 0.60。轴压比是控制墙肢延性、防止脆性破坏的重要指标。',
    severity: 'general',
    source: 'GB/T 50011 第 6.4.2 条；GB/T 50010-2010（2024年局部修订）第 11.7.16 条',
    appliesTo: (ctx) => ctx.schemeId === 'shearwall' || ctx.schemeId === 'frame-shearwall',
    ruleKeys: ['axial_ratio'],
    threshold: {
      resolvable: true,
      direction: 'max',
      // 轴压比限值随抗震等级变化：一级(9度)0.4 / 一级(7、8度)0.5 / 二三级0.6
      // 注：抗震等级由设防烈度 + 高度决定，求值器内已有 estimateSeismicGrade；此处按其等级映射限值。
      value: (ctx) => estimateAxialRatioLimit(ctx.schemeId, ctx.intensity, ctx.height),
      describe: (ctx) =>
        `≤ ${estimateAxialRatioLimit(ctx.schemeId, ctx.intensity, ctx.height).toFixed(2)}（底部加强部位）`,
      note: '限值随抗震等级变化（一级9度0.40 / 一级7、8度0.50 / 二三级0.60）',
    },
  },
  {
    id: 'fire_protection',
    name: '防火保护',
    clauseTitle: '钢结构构件耐火极限要求',
    code: 'GB 55037-2022',
    clause: '表 5.2.1',
    clauseText:
      '一级耐火等级高层建筑，钢柱耐火极限不应低于 3.00h，钢梁不应低于 2.00h，楼板不应低于 1.50h。钢结构必须采取防火保护措施（防火涂料、防火板等）。',
    severity: 'advisory',
    source: 'GB 55037-2022《建筑防火通用规范》表 5.2.1 构件耐火极限要求',
    appliesTo: (ctx) => ctx.schemeId === 'steel',
    ruleKeys: ['fire_protection', 'steel_fire'],
    threshold: {
      // 提示性措施要求，无数值限值可比（恒 warning），故 resolvable=false
      resolvable: false,
      direction: 'max',
      value: () => null,
      describe: () => '柱 3.00h / 梁 2.00h（一级耐火等级）',
      note: '构造措施要求，不参与数值判定',
    },
  },
];

/**
 * 抗震墙墙肢轴压比限值 —— 由抗震等级决定。
 * 口径必须与 norm-evaluator 的 estimateSeismicGrade 完全一致（同一判定不许有两套规则）：
 *   9 度 → 一级 → 0.40；7、8 度且高度 > 80m → 一级 → 0.50；其余 → 二、三级 → 0.60。
 * 独立成函数便于阈值声明与求值器共用同一口径，避免两处各写一遍而漂移。
 */
export function estimateAxialRatioLimit(
  schemeId: string,
  intensity: number,
  height: number
): number {
  void schemeId; // 等级仅由「烈度 + 高度」决定，体系不参与（与 estimateSeismicGrade 对齐）
  if (intensity >= 9) return AXIAL_RATIO_LIMITS.grade1_9;
  if (intensity >= 7 && height > 80) return AXIAL_RATIO_LIMITS.grade1_78;
  return AXIAL_RATIO_LIMITS.grade23;
}

/** 判定给定轴压比限值属于哪个抗震等级（与 estimateSeismicGrade 同源） */
export function axialRatioGradeLabel(intensity: number, height: number): string {
  if (intensity >= 9) return '一级（9度）';
  if (intensity >= 7 && height > 80) return '一级（7/8度）';
  return '二、三级';
}
