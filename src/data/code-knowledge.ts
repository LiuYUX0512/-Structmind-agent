// 规范知识库（**CODE_RULE_REGISTRY 的只读投影**，不再自持一份条文）
//
// 架构演进（对应 P1-2 规范知识图谱化）：
//   本文件过去是**独立的**条文库，与 code-rules.ts 的 RULE_REGISTRY 双源并存。
//   同一条规范在两处各写一遍的必然结果是**漂移**，且已经实际发生：
//     - 剪重比：本文件曾写「6度 0.008、7度 0.012」，与权威限值表 SHEAR_WEIGHT_RATIO_MIN
//       的「6度框架 0.012、7度框架 0.024」矛盾；
//     - 钢结构防火：本文件曾写「第 5.1.3 条（耐火等级）」，与 RULE_REGISTRY 的
//       「表 5.2.1（构件耐火极限）」不是同一条。
//   两个「真理」必有一假 —— 判定用的是 RULE_REGISTRY，展示用的是本文件，
//   于是界面会向用户展示与判定依据**不一致**的条文。
//
// 现在本文件只做投影：条文文本、编号、适用范围全部**派生自唯一数据源 RULE_REGISTRY**，
// 双源漂移在结构上不再可能。

import { RULE_REGISTRY as CODE_RULE_REGISTRY } from './code-rules';

/**
 * 知识库条目（对外形态，保持与既有调用方字段兼容）。
 * 新增 clauseText 与 severity：让「条文原文 + 适用条件 + 严重性」三元组可一次取全，
 * 而不是只给要点摘要。
 */
export interface ICodeKnowledgeEntry {
  /** 知识库条目 ID（稳定标识，供工具按 ruleKey 引用） */
  id: string;
  /** 规范编号 */
  code: string;
  /** 条文号（条款/表编号） */
  clause: string;
  /** 条目标题 */
  title: string;
  /** 条文要旨（= RULE_REGISTRY 的 clauseText，单一数据源） */
  text: string;
  /** 规则 key（对应判定类型，供 resolveKnowledgeBasis 命中） */
  ruleKeys: string[];
  /** 适用结构体系（undefined / 空数组 = 通用） */
  appliesTo?: string[];
  /** 严重性（强制性 / 一般性 / 提示性） */
  severity: 'mandatory' | 'general' | 'advisory';
}

/** 已知结构体系全集（带 appliesTo 的规则按此判定是否命中某体系） */
const ALL_SYSTEM_IDS = [
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

/**
 * 从规则的可执行套件反推「本规则适用于哪些体系」。
 * 由于 RULE_REGISTRY.appliesTo 是**函数**（依赖上下文），静态投影拿不到体系名单，
 * 故用一组中性探针上下文（8 度、50m 高）逐个试判 12 个已知体系，得到体系白名单。
 * 这样 appliesTo 的语义变化会自动反映到知识库投影上，无需人工同步两份名单。
 */
function inferAppliesTo(rule: (typeof CODE_RULE_REGISTRY)[number]): string[] {
  return ALL_SYSTEM_IDS.filter((sid) => {
    try {
      return rule.appliesTo({
        schemeId: sid,
        params: {} as never,
        intensity: 8,
        height: 50,
        period: 1.0,
        aspectRatio: 2.0,
      });
    } catch {
      return false;
    }
  });
}

/**
 * 投影：RULE_REGISTRY → ICodeKnowledgeEntry[]。
 * 全覆盖（12/12）的规则视为「通用」，appliesTo 记 undefined，避免冗长白名单。
 */
export const CODE_KNOWLEDGE: ICodeKnowledgeEntry[] = CODE_RULE_REGISTRY.map((rule) => {
  const appliesTo = inferAppliesTo(rule);
  const isUniversal = appliesTo.length === ALL_SYSTEM_IDS.length;
  return {
    id: rule.id,
    code: rule.code,
    clause: rule.clause,
    title: rule.clauseTitle,
    text: rule.clauseText,
    ruleKeys: rule.ruleKeys,
    appliesTo: isUniversal ? undefined : appliesTo,
    severity: rule.severity,
  } satisfies ICodeKnowledgeEntry;
});

/**
 * 按结构体系 + 规则 key 解析命中的规范条目（校核结论的条文依据）。
 * 语义与旧版一致：通用条目命中所有体系；带 appliesTo 的只命中对应体系。
 */
export function resolveKnowledgeBasis(
  systemId: string,
  ruleKeys: string[]
): ICodeKnowledgeEntry[] {
  return CODE_KNOWLEDGE.filter((r) => {
    const keyHit = r.ruleKeys.some((k) => ruleKeys.includes(k));
    if (!keyHit) return false;
    if (r.appliesTo && r.appliesTo.length > 0 && !r.appliesTo.includes(systemId)) return false;
    return true;
  });
}

/** 兼容旧类型名（既有调用方可能引用 ICodeRule） */
export type ICodeRule = ICodeKnowledgeEntry;
