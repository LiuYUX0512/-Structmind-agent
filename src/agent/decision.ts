// 总工决策裁定层（架构诊断 P1-1）
//
// 病症：决策权错位。
//   旧实现里 pipeline.ts 直接取 compareResult.recommended.schemeId（即评分 argmax）作为最终推荐，
//   大模型跑完四段推理、写完反思与风险提示，它的结论只被拿来当 `reason` 文案。
//   关掉 LLM 功能仍能保留约 95% 的产出——这在一个「AI Agent」参赛作品里是最致命的天花板。
//
// 修复：把最终裁定权交还给大模型，但把它放进一个【可被代码否决】的笼子里：
//   工具层给事实（分数、违规、造价）→ 大模型在受限候选内做裁定并给出理由
//   → 代码校验裁定是否触碰硬约束 → 触碰则否决并强制改判，同时留下可追溯的裁定说明。
//
// 这不是「让大模型随便选」，而是让大模型的判断真正影响结果，同时保证它不可能越过规范红线。
// 副作用（正向）：当大模型裁定被硬约束否决时，天然产生一次「回退」，
// 让辩论/回退闭环有了真实的触发源，而不只是靠预设脚本演一遍。
//
// EXPORTS: TDecisionSource, IChiefDecisionBlock, IArbitratedDecision,
//          parseChiefDecision, arbitrateChiefDecision, DECISION_BLOCK_INSTRUCTION

import type { INormCheckItem } from '@/data/structure';

/** 决策来源：说明最终推荐到底是谁定的（可追溯性） */
export type TDecisionSource =
  /** 大模型裁定，且通过全部硬约束校验 */
  | 'llm'
  /** 大模型裁定触碰硬约束，被代码否决后强制改判 */
  | 'constraint-override'
  /** 工程师锁定方案优先（人类在环） */
  | 'human-lock'
  /** 大模型未给出有效裁定（缺块 / ID 幻觉），退回评分首选 */
  | 'score-fallback'
  /** 演示轨迹模式（确定性脚本） */
  | 'trace';

/** 大模型输出的结构化决策块 */
export interface IChiefDecisionBlock {
  schemeId: string;
  confidence?: 'high' | 'medium' | 'low';
  /** 被主动排除的方案及其理由 */
  rejectedIds?: string[];
  /** 决定性因素（一句话说明为什么是它） */
  decisiveFactor?: string;
}

/** 裁定结果 */
export interface IArbitratedDecision {
  schemeId: string;
  schemeName: string;
  overallScore: number;
  /** 最终推荐是谁定的 */
  decisionSource: TDecisionSource;
  /** 面向用户/评委的裁定说明（为什么是这个、为什么不是评分最高的） */
  decisionNote: string;
  /** 纯评分口径下的首选（用于与最终裁定对照展示） */
  scoreTopSchemeId: string;
  /** 大模型的原始裁定（若有） */
  llmChoiceSchemeId?: string;
  /** 大模型裁定的置信度 */
  llmConfidence?: 'high' | 'medium' | 'low';
  /** 大模型给出的决定性因素 */
  decisiveFactor?: string;
  /** 触发否决的硬约束清单（条文级，可追溯） */
  hardConstraintViolations?: string[];
}

/** 注入总工 Prompt 的决策块格式要求 */
export const DECISION_BLOCK_INSTRUCTION =
  '\n\n## 🔧 最终裁定（必须输出，机器会读取）' +
  '\n综合评分只是参考，最终采用哪个方案由你裁定。请在回答的最后输出如下代码块：' +
  '\n```chief-decision' +
  '\n{"schemeId":"<你裁定的方案ID>","confidence":"high|medium|low","rejectedIds":["<你主动排除的方案ID>"],"decisiveFactor":"<一句话说明决定性因素>"}' +
  '\n```' +
  '\nschemeId 必须是上述候选方案的 ID。若你认为评分最高的方案不该被采用（例如它虽便宜但抗震储备不足、' +
  '\n或施工难度过高），请直接裁定为你认为正确的方案并说明——你的裁定会被采纳，' +
  '\n但若它违反强制性条文，代码会否决并改判。';

// ============ 解析 ============

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // 大模型偶尔输出单引号或尾逗号，做一次温和的规范化后再试
    try {
      const normalized = trimmed
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/'/g, '"');
      const value = JSON.parse(normalized) as unknown;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 从总工的 Markdown 回答中解析结构化决策块。
 * 解析不出就返回 null —— 调用方据此退回评分首选，绝不臆造裁定。
 */
export function parseChiefDecision(markdown: string): IChiefDecisionBlock | null {
  if (!markdown) return null;

  const candidates: string[] = [];
  // 优先：显式标记的决策块
  const fenced = /```(?:chief-decision|chief_decision|decision)\s*([\s\S]*?)```/i.exec(markdown);
  if (fenced?.[1]) candidates.push(fenced[1]);
  // 兜底：全文里出现过的、含 schemeId 的 JSON 对象（取出现的最后一个，通常贴近结论）
  const objects = markdown.match(/\{[^{}]*["']?schemeId["']?\s*:\s*[^{}]*\}/g);
  if (objects) candidates.push(...objects.reverse());

  for (const raw of candidates) {
    const parsed = tryParseJsonObject(raw);
    if (!parsed) continue;
    const schemeId = parsed.schemeId;
    if (typeof schemeId !== 'string' || schemeId.trim() === '') continue;

    const confidence = parsed.confidence;
    const rejectedRaw = parsed.rejectedIds;
    const decisive = parsed.decisiveFactor;

    return {
      schemeId: schemeId.trim(),
      ...(confidence === 'high' || confidence === 'medium' || confidence === 'low'
        ? { confidence }
        : {}),
      ...(Array.isArray(rejectedRaw)
        ? { rejectedIds: rejectedRaw.filter((x): x is string => typeof x === 'string') }
        : {}),
      ...(typeof decisive === 'string' && decisive.trim() !== ''
        ? { decisiveFactor: decisive.trim() }
        : {}),
    };
  }
  return null;
}

// ============ 裁定 ============

/**
 * 递归收集校核项，兼容 codeChecks 的两种形状：
 *   - 演示模式：{ checks: [...] }（INormCompliance 本体）
 *   - 真实模式：{ seismic: { checks: [...] }, fire: { checks: [...] } }（管线按工具分组存放）
 * 若只认第一种，硬约束校验会在真实模式下静默失效——变成一条永不生效的防线。
 */
function collectCheckItems(value: unknown, depth = 0): INormCheckItem[] {
  if (!value || typeof value !== 'object' || depth > 2) return [];
  const obj = value as Record<string, unknown>;
  const out: INormCheckItem[] = [];
  if (Array.isArray(obj.checks)) {
    out.push(...(obj.checks as INormCheckItem[]));
  }
  for (const key of Object.keys(obj)) {
    if (key === 'checks') continue;
    out.push(...collectCheckItems(obj[key], depth + 1));
  }
  return out;
}

/** 取某方案中违反的强制性条文（severity = mandatory 且 status = fail） */
function collectHardViolations(
  codeChecks: Record<string, unknown> | undefined,
  schemeId: string,
  schemeName: string
): string[] {
  const items = collectCheckItems(codeChecks?.[schemeId]);
  return items
    .filter((c) => c?.severity === 'mandatory' && c?.status === 'fail')
    .map((c) => `${schemeName}：${c.name}（强制性，${c.value} vs ${c.requirement}）`);
}

export interface IArbitrationInput {
  /** 候选方案（id + 名称） */
  candidates: Array<{ id: string; name: string }>;
  /** 评分排序结果（已按分数降序） */
  ranking: Array<{ schemeId: string; score: number }>;
  /** 各方案的规范校核结果（用于硬约束校验） */
  codeChecks?: Record<string, unknown>;
  /** 大模型的结构化裁定（trace 模式或解析失败时为 null） */
  llmDecision?: IChiefDecisionBlock | null;
  /** 工程师锁定的方案 ID（人类在环硬约束） */
  lockedSchemeIds?: string[];
  /** 大模型未给出有效裁定时的来源标记（trace 模式传 'trace'） */
  fallbackSource?: TDecisionSource;
}

/**
 * 裁定最终推荐方案。
 *
 * 权限顺序（后者不能推翻前者）：
 *   1. 强制性条文 —— 谁都不能选违反强制性条文的方案
 *   2. 工程师锁定 —— 人类在环优先于 AI 裁定
 *   3. 大模型裁定 —— 在满足 1、2 的前提下，采用大模型的判断（哪怕它不是评分最高的）
 *   4. 评分兜底 —— 大模型没给出有效裁定时才退回评分首选
 */
export function arbitrateChiefDecision(input: IArbitrationInput): IArbitratedDecision {
  const { candidates, ranking, codeChecks, llmDecision, lockedSchemeIds } = input;
  const fallbackSource: TDecisionSource = input.fallbackSource ?? 'score-fallback';

  const nameOf = (id: string) => candidates.find((c) => c.id === id)?.name || id;
  const scoreOf = (id: string) => ranking.find((r) => r.schemeId === id)?.score ?? 0;

  const scoreTopSchemeId = ranking[0]?.schemeId || candidates[0]?.id || '';

  // —— 硬约束 1：强制性条文 ——
  const violating = new Set<string>();
  const violationDetails: string[] = [];
  for (const c of candidates) {
    const vs = collectHardViolations(codeChecks, c.id, c.name);
    if (vs.length > 0) {
      violating.add(c.id);
      violationDetails.push(...vs);
    }
  }
  const compliant = candidates.filter((c) => !violating.has(c.id));
  const compliantIds = new Set(compliant.map((c) => c.id));

  // —— 硬约束 2：工程师锁定 ——
  const locked = (lockedSchemeIds ?? []).filter((id) => candidates.some((c) => c.id === id));
  const lockedCompliant = locked.filter((id) => compliantIds.has(id));

  // 候选全军覆没（都违反强制性条文）：如实告知，取评分首选并标注冲突
  if (compliant.length === 0) {
    const forced = scoreTopSchemeId;
    return {
      schemeId: forced,
      schemeName: nameOf(forced),
      overallScore: scoreOf(forced),
      decisionSource: 'constraint-override',
      decisionNote:
        `⚠️ 全部候选方案均存在强制性条文违反，无一可合法采用。此处暂列评分首选（${nameOf(forced)}），` +
        `但必须调整工程参数或结构体系后重新比选，不得直接进入深化设计。`,
      scoreTopSchemeId,
      ...(llmDecision ? { llmChoiceSchemeId: llmDecision.schemeId } : {}),
      hardConstraintViolations: violationDetails,
    };
  }

  // 工程师锁定优先（人类在环）
  if (lockedCompliant.length > 0) {
    const chosen = lockedCompliant[0];
    const note =
      chosen === scoreTopSchemeId
        ? `工程师已锁定 ${nameOf(chosen)}，评分亦为首选，两者一致。`
        : `工程师已锁定 ${nameOf(chosen)}（评分首选为 ${nameOf(scoreTopSchemeId)}），按人类在环优先原则采用锁定方案。`;
    return {
      schemeId: chosen,
      schemeName: nameOf(chosen),
      overallScore: scoreOf(chosen),
      decisionSource: 'human-lock',
      decisionNote: note,
      scoreTopSchemeId,
      ...(llmDecision ? { llmChoiceSchemeId: llmDecision.schemeId } : {}),
      ...(violationDetails.length > 0 ? { hardConstraintViolations: violationDetails } : {}),
    };
  }
  if (locked.length > 0) {
    // 锁定方案全部违反强制性条文：硬约束 1 高于人类锁定，但必须显眼地告知工程师
    const best = [...compliant].sort((a, b) => scoreOf(b.id) - scoreOf(a.id))[0];
    return {
      schemeId: best.id,
      schemeName: best.name,
      overallScore: scoreOf(best.id),
      decisionSource: 'constraint-override',
      decisionNote:
        `⚠️ 工程师锁定的 ${locked.map(nameOf).join('、')} 存在强制性条文违反，` +
        `规范优先级高于人工锁定，已改判为 ${best.name}。请工程师复核锁定项。`,
      scoreTopSchemeId,
      ...(llmDecision ? { llmChoiceSchemeId: llmDecision.schemeId } : {}),
      hardConstraintViolations: violationDetails,
    };
  }

  // —— 大模型裁定 ——
  if (llmDecision) {
    const chosenId = llmDecision.schemeId;
    const known = candidates.some((c) => c.id === chosenId);

    if (!known) {
      // ID 幻觉 / 不在候选内：否决并退回评分首选，但不静默——如实记录
      const best = [...compliant].sort((a, b) => scoreOf(b.id) - scoreOf(a.id))[0];
      return {
        schemeId: best.id,
        schemeName: best.name,
        overallScore: scoreOf(best.id),
        decisionSource: fallbackSource,
        decisionNote:
          `总工裁定的方案 ID「${chosenId}」不在候选列表内（疑似笔误或幻觉），` +
          `已改判为合规首选 ${best.name}。`,
        scoreTopSchemeId,
        llmChoiceSchemeId: chosenId,
        ...(violationDetails.length > 0 ? { hardConstraintViolations: violationDetails } : {}),
      };
    }

    if (!compliantIds.has(chosenId)) {
      // 裁定触碰强制性条文：否决 + 强制改判 + 留下条文级证据
      const best = [...compliant].sort((a, b) => scoreOf(b.id) - scoreOf(a.id))[0];
      return {
        schemeId: best.id,
        schemeName: best.name,
        overallScore: scoreOf(best.id),
        decisionSource: 'constraint-override',
        decisionNote:
          `总工裁定 ${nameOf(chosenId)}，但该方案违反强制性条文，代码已否决并改判为 ${best.name}。` +
          `规范红线高于 AI 裁定，此为强制回退。`,
        scoreTopSchemeId,
        llmChoiceSchemeId: chosenId,
        ...(llmDecision.confidence ? { llmConfidence: llmDecision.confidence } : {}),
        ...(llmDecision.decisiveFactor ? { decisiveFactor: llmDecision.decisiveFactor } : {}),
        hardConstraintViolations: violationDetails,
      };
    }

    // 裁定有效且合规 —— 采纳大模型的判断（哪怕它不是评分最高的）
    const note =
      chosenId === scoreTopSchemeId
        ? `总工裁定 ${nameOf(chosenId)}，与评分首选一致${llmDecision.decisiveFactor ? `。决定性因素：${llmDecision.decisiveFactor}` : '。'}`
        : `总工裁定 ${nameOf(chosenId)}，主动否决了评分首选 ${nameOf(scoreTopSchemeId)}` +
          `${llmDecision.decisiveFactor ? `。决定性因素：${llmDecision.decisiveFactor}` : '。'}` +
          `——评分不是唯一依据，工程判断已生效。`;
    return {
      schemeId: chosenId,
      schemeName: nameOf(chosenId),
      overallScore: scoreOf(chosenId),
      decisionSource: 'llm',
      decisionNote: note,
      scoreTopSchemeId,
      llmChoiceSchemeId: chosenId,
      ...(llmDecision.confidence ? { llmConfidence: llmDecision.confidence } : {}),
      ...(llmDecision.decisiveFactor ? { decisiveFactor: llmDecision.decisiveFactor } : {}),
      ...(violationDetails.length > 0 ? { hardConstraintViolations: violationDetails } : {}),
    };
  }

  // —— 无有效裁定：退回合规评分首选 ——
  const best = [...compliant].sort((a, b) => scoreOf(b.id) - scoreOf(a.id))[0];
  const scoreTopViolating = violating.has(scoreTopSchemeId);
  return {
    schemeId: best.id,
    schemeName: best.name,
    overallScore: scoreOf(best.id),
    // 评分首选被硬约束淘汰属于「真实发生的强制改判」，
    // 即便这一轮没有大模型裁定（演示轨迹模式）也应如实标记，否则回退在日志里不可见
    decisionSource: scoreTopViolating ? 'constraint-override' : fallbackSource,
    decisionNote: scoreTopViolating
      ? `评分首选 ${nameOf(scoreTopSchemeId)} 违反强制性条文，已改判为合规最优 ${best.name}。`
      : `未取得有效的总工裁定，按综合评分首选 ${best.name} 推荐。`,
    scoreTopSchemeId,
    ...(violationDetails.length > 0 ? { hardConstraintViolations: violationDetails } : {}),
  };
}
