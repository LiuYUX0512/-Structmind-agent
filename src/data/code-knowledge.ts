// 规范知识库（集中式、可维护）
// 设计目标：
//   1. 规范条文集中管理 —— 更新规范只需改本文件，无需改工具逻辑（评审"知识库怎么更新规范"的答案）
//   2. 校核判定可追溯 —— 每条判定携带条文号 + 条文要旨，结论有据可查
//   3. 与硬编码规则引擎解耦 —— 本文件只存"规范事实"，判定逻辑仍在 tools/structure 中
// 数据来源：现有 calculateNormCompliance 中已核实的条文文本（GB 55002-2021 / GB/T 50011-2010 等公开通用规范）
// 注意：text 为"条文要旨"（依据公开规范条款的要点摘录），非逐字原文；正式设计须以现行规范原文为准。

export interface ICodeRule {
  /** 知识库条目 ID（稳定标识，供工具按 ruleKey 引用） */
  id: string;
  /** 规范编号 */
  code: string;
  /** 条文号（条款/表编号） */
  clause: string;
  /** 条目标题 */
  title: string;
  /** 条文要旨（要点摘录） */
  text: string;
  /** 规则 key（对应硬编码判定函数使用的判定类型） */
  ruleKeys: string[];
  /** 适用结构体系（空数组 = 通用） */
  appliesTo?: string[];
}

export const CODE_KNOWLEDGE: ICodeRule[] = [
  {
    id: 'gb50011-6.1.1-max-height',
    code: 'GB/T 50011-2010（2024年局部修订）',
    clause: '表 6.1.1',
    title: '现浇钢筋混凝土房屋的最大适用高度',
    text: '现浇钢筋混凝土房屋的最大适用高度应符合规范要求（单位 m）：框架结构 6/7度 60m、8度 40m、9度 24m；框架-抗震墙 130/120/100/50m；全落地抗震墙 140/120/100/60m；框架-核心筒 150/130/100/70m；筒中筒 180/150/120/80m。超限工程需进行专项论证。',
    ruleKeys: ['max_height'],
    appliesTo: ['frame', 'frame-shearwall', 'shearwall', 'frame-corewall', 'tube-in-tube', 'prefabricated'],
  },
  {
    id: 'gb50011-5.5.1-drift',
    code: 'GB/T 50011-2010（2024年局部修订）',
    clause: '表 5.5.1',
    title: '弹性层间位移角限值',
    text: '多遇地震作用下，结构弹性层间位移角应满足限值要求：框架结构 1/550；框架-抗震墙、板柱-抗震墙、框架-核心筒 1/800；抗震墙、筒中筒 1/1000；多高层钢结构 1/250。该限值用于控制结构在多遇地震下的侧向变形，过大说明结构侧向刚度不足。',
    ruleKeys: ['drift'],
  },
  {
    id: 'gb55002-4.2.3-swr',
    code: 'GB 55002-2021《建筑与市政工程抗震通用规范》；GB/T 50011-2010（2024年局部修订）',
    clause: '第 4.2.3 条 / 表 5.2.5',
    title: '楼层最小剪重比',
    text: '结构各楼层对应于地震作用标准值的楼层剪力系数 λ 不应小于 λ_min。框架结构：6度(0.05g) 0.008、7度(0.10g) 0.012、8度(0.20g) 0.024、9度(0.40g) 0.048；其他结构体系为框架结构的 2/3。剪重比不足说明地震作用偏小，需按规定进行调整。',
    ruleKeys: ['swr'],
  },
  {
    id: 'jgj3-3.4.5-period',
    code: 'JGJ 3-2010《高层建筑混凝土结构技术规程》',
    clause: '第 3.4.5 条',
    title: '结构扭转周期比',
    text: '结构扭转为主的第一自振周期 Tt 与平动为主的第一自振周期 T1 之比，A级高度高层建筑不应大于 0.90，B级高度高层建筑（>150m）不应大于 0.85。周期比用于控制结构扭转效应，防止扭转为主的破坏模式。',
    ruleKeys: ['period'],
    appliesTo: ['frame-shearwall', 'shearwall', 'frame-corewall', 'tube-in-tube', 'prefabricated'],
  },
  {
    id: 'gb50010-11.7.16-axial',
    code: 'GB/T 50010-2010（2024年局部修订）',
    clause: '第 11.7.16 条',
    title: '抗震墙墙肢轴压比限值',
    text: '抗震墙底部加强部位墙肢轴压比限值：一级（9度）≤ 0.40；一级（7、8度）≤ 0.50；二、三级 ≤ 0.60。轴压比是控制墙肢延性、防止脆性破坏的重要指标。',
    ruleKeys: ['axial_ratio'],
    appliesTo: ['shearwall', 'frame-shearwall'],
  },
  {
    id: 'gb55037-5.1.3-fire-grade',
    code: 'GB 55037-2022《建筑防火通用规范》',
    clause: '第 5.1.3 条',
    title: '建筑耐火等级确定',
    text: '建筑耐火等级应根据建筑高度、使用性质与火灾危险性确定：高层建筑耐火等级不低于一级，多层建筑不低于二级。耐火等级决定构件耐火极限要求。',
    ruleKeys: ['fire_grade'],
  },
  {
    id: 'gb55037-5.2.1-steel-fire',
    code: 'GB 55037-2022《建筑防火通用规范》',
    clause: '表 5.2.1',
    title: '钢结构构件耐火极限要求',
    text: '一级耐火等级高层建筑，钢柱耐火极限不应低于 3.00h，钢梁不应低于 2.00h，楼板不应低于 1.50h。钢结构必须采取防火保护措施（防火涂料、防火板等）。',
    ruleKeys: ['steel_fire'],
    appliesTo: ['steel', 'prefab-steel', 'space-truss'],
  },
  {
    id: 'gb50011-6.1.2-seismic-grade',
    code: 'GB/T 50011-2010（2024年局部修订）',
    clause: '第 6.1.2 条',
    title: '现浇钢筋混凝土房屋抗震等级',
    text: '抗震等级应根据设防烈度、结构类型与房屋高度划分（一、二、三、四级）。高烈度区、超高房屋应采用更高的抗震等级，以对应更强的抗震构造措施。',
    ruleKeys: ['seismic_grade'],
    appliesTo: ['frame', 'frame-shearwall', 'shearwall', 'frame-corewall', 'tube-in-tube', 'prefabricated'],
  },
];

/** 按结构体系 + 规则 key 解析命中的规范条目（校核结论的条文依据） */
export function resolveKnowledgeBasis(
  systemId: string,
  ruleKeys: string[]
): ICodeRule[] {
  return CODE_KNOWLEDGE.filter((r) => {
    const keyHit = r.ruleKeys.some((k) => ruleKeys.includes(k));
    if (!keyHit) return false;
    // 通用条目（无 appliesTo）命中所有体系；带 appliesTo 的只命中对应体系
    if (r.appliesTo && r.appliesTo.length > 0 && !r.appliesTo.includes(systemId)) return false;
    return true;
  });
}
