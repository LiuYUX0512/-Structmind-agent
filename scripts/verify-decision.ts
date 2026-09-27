// ============================================================
// 智构 StructMind · 总工决策裁定层回归（架构诊断 P1-1）
//
// 守护的核心命题：【最终推荐必须由大模型裁定，但大模型不能越过规范红线】
// 旧实现 pipeline 直接取 compare_schemes 的评分 argmax 作为推荐，
// 总工 Agent 的四段推理只被用来生成 reason 文案 —— 关掉 LLM 仍保留约 95% 产出。
//
// 运行：node scripts/verify-decision-out/verify-decision.js
// ============================================================
import { scopedStorage } from '@lark-apaas/client-toolkit-lite';
import {
  parseChiefDecision,
  arbitrateChiefDecision,
  DECISION_BLOCK_INSTRUCTION,
  type IChiefDecisionBlock,
} from '@/agent/decision';
import { runAgentPipeline } from '../src/agent/pipeline';
import { calculateNormCompliance, type IProjectParams } from '../src/data/structure';

const checks: Array<[string, boolean, string]> = [];
const push = (name: string, ok: boolean, detail = '') => checks.push([name, ok, detail]);

const CANDIDATES = [
  { id: 'frame', name: '框架结构' },
  { id: 'shearwall', name: '剪力墙结构' },
  { id: 'frame-shearwall', name: '框架-剪力墙结构' },
];
const RANKING = [
  { schemeId: 'frame', score: 6.4 },
  { schemeId: 'frame-shearwall', score: 6.1 },
  { schemeId: 'shearwall', score: 5.9 },
];

/** 框架结构存在强制性条文违反（真实模式 codeChecks 的形状：按工具分组） */
const CODE_CHECKS_NESTED = {
  frame: {
    seismic: {
      checks: [
        { name: '层间位移角', status: 'fail', severity: 'mandatory', value: '1/420', requirement: '≤ 1/800' },
        { name: '剪重比', status: 'fail', severity: 'mandatory', value: '2.9%', requirement: '≥ 4.8%' },
        { name: '防火保护', status: 'warning', severity: 'advisory', value: '-', requirement: '-' },
      ],
    },
    fire: { checks: [] },
  },
  shearwall: { seismic: { checks: [] }, fire: { checks: [] } },
  'frame-shearwall': { seismic: { checks: [] }, fire: { checks: [] } },
};
/** 演示模式 codeChecks 的形状：INormCompliance 本体 */
const CODE_CHECKS_FLAT = {
  frame: {
    checks: [
      { name: '高度适用范围', status: 'fail', severity: 'mandatory', value: '90 m', requirement: '≤ 40 m' },
    ],
  },
  shearwall: { checks: [] },
  'frame-shearwall': { checks: [] },
};

// ---------- 场景 A：决策块解析 ----------
{
  const md = `一堆分析文字……
\`\`\`chief-decision
{"schemeId":"shearwall","confidence":"high","rejectedIds":["frame"],"decisiveFactor":"8度区侧向刚度优先"}
\`\`\`
`;
  const d = parseChiefDecision(md);
  push(
    'A1 解析标准决策块',
    d?.schemeId === 'shearwall' && d?.confidence === 'high' && d?.rejectedIds?.[0] === 'frame',
    `schemeId=${d?.schemeId}, 置信=${d?.confidence}, 排除=${d?.rejectedIds?.join('、')}`
  );

  // 大模型常见脏输出：单引号 + 尾逗号
  const dirty = "```chief-decision\n{'schemeId':'frame','confidence':'medium',}\n```";
  const dd = parseChiefDecision(dirty);
  push('A2 容忍脏 JSON（单引号 / 尾逗号）', dd?.schemeId === 'frame', `schemeId=${dd?.schemeId}`);

  push('A3 无决策块时返回 null（不臆造裁定）', parseChiefDecision('# 纯文本结论') === null, 'null');
  push(
    'A4 缺 schemeId 的块视为无效',
    parseChiefDecision('```chief-decision\n{"confidence":"high"}\n```') === null,
    'null'
  );
  const loose = '我的结论：{"schemeId": "shearwall"} 由此确定。';
  push(
    'A5 未用围栏时从散落 JSON 兜底提取',
    parseChiefDecision(loose)?.schemeId === 'shearwall',
    `schemeId=${parseChiefDecision(loose)?.schemeId}`
  );
  push(
    'A6 决策块格式说明已注入 Prompt（大模型知道要输出）',
    DECISION_BLOCK_INSTRUCTION.includes('chief-decision') &&
      DECISION_BLOCK_INSTRUCTION.includes('schemeId'),
    `长度=${DECISION_BLOCK_INSTRUCTION.length}`
  );
}

// ---------- 场景 B：裁定权限顺序 ----------
{
  // B1 核心：LLM 裁定合规但非评分首选的方案 → 必须采纳（决策权回归）
  const llm: IChiefDecisionBlock = {
    schemeId: 'shearwall',
    confidence: 'high',
    decisiveFactor: '8度区侧向刚度优先',
  };
  const d = arbitrateChiefDecision({
    candidates: CANDIDATES,
    ranking: RANKING,
    llmDecision: llm,
  });
  push(
    'B1 大模型裁定优先于评分（决策权真正回归）',
    d.schemeId === 'shearwall' && d.decisionSource === 'llm' && d.scoreTopSchemeId === 'frame',
    `裁定=${d.schemeId}｜评分首选=${d.scoreTopSchemeId}｜来源=${d.decisionSource}`
  );
  push(
    'B1b 裁定说明如实披露「否决了评分首选」',
    !!d.decisionNote && d.decisionNote.includes('框架结构') && d.decisionNote.includes('工程判断'),
    `说明=${d.decisionNote}`
  );

  // B2 大模型裁定违反强制性条文的方案 → 否决 + 改判 + 留条文级证据（兼容真实模式嵌套形状）
  const bad = arbitrateChiefDecision({
    candidates: CANDIDATES,
    ranking: RANKING,
    codeChecks: CODE_CHECKS_NESTED,
    llmDecision: { schemeId: 'frame', confidence: 'low', decisiveFactor: '造价最低' },
  });
  push(
    'B2 裁定触碰强制性条文 → 代码否决并强制改判',
    bad.schemeId !== 'frame' && bad.decisionSource === 'constraint-override',
    `裁定=${bad.llmChoiceSchemeId} → 改判=${bad.schemeId}｜来源=${bad.decisionSource}`
  );
  push(
    'B2b 否决留下条文级证据（可追溯，不是黑箱）',
    (bad.hardConstraintViolations?.length ?? 0) >= 2 &&
      bad.hardConstraintViolations!.some((v) => v.includes('强制性')),
    `证据=${bad.hardConstraintViolations?.join('；')}`
  );
  push(
    'B2c 改判落在合规方案上',
    bad.schemeId === 'frame-shearwall' || bad.schemeId === 'shearwall',
    `改判=${bad.schemeId}`
  );

  // B3 演示模式的扁平 codeChecks 形状同样生效（两种形状都不能漏）
  const flat = arbitrateChiefDecision({
    candidates: CANDIDATES,
    ranking: RANKING,
    codeChecks: CODE_CHECKS_FLAT,
    llmDecision: { schemeId: 'frame' },
  });
  push(
    'B3 演示模式 codeChecks 形状同样可判违规（形状无关）',
    flat.decisionSource === 'constraint-override' && flat.schemeId !== 'frame',
    `来源=${flat.decisionSource}，改判=${flat.schemeId}`
  );

  // B4 ID 幻觉
  const hallucinated = arbitrateChiefDecision({
    candidates: CANDIDATES,
    ranking: RANKING,
    llmDecision: { schemeId: 'space-truss' },
  });
  push(
    'B4 裁定 ID 不在候选内 → 退回合规首选并如实记录',
    hallucinated.schemeId === 'frame' && hallucinated.llmChoiceSchemeId === 'space-truss',
    `幻觉=${hallucinated.llmChoiceSchemeId}，改判=${hallucinated.schemeId}｜说明=${hallucinated.decisionNote}`
  );

  // B5 无有效裁定 → 评分首选
  const none = arbitrateChiefDecision({ candidates: CANDIDATES, ranking: RANKING, llmDecision: null });
  push(
    'B5 无裁定 → 按评分首选（可解释的兜底）',
    none.schemeId === 'frame' && none.decisionSource === 'score-fallback',
    `推荐=${none.schemeId}｜来源=${none.decisionSource}`
  );

  // B6 评分首选违反强条、且无裁定 → 仍然强制改判（真实模式下没有辩论替换环节，这条会真正开火）
  const noLlmButViolating = arbitrateChiefDecision({
    candidates: CANDIDATES,
    ranking: RANKING,
    codeChecks: CODE_CHECKS_NESTED,
    llmDecision: null,
  });
  push(
    'B6 评分首选违反强条 → 即便无裁定也强制改判',
    noLlmButViolating.decisionSource === 'constraint-override' &&
      noLlmButViolating.schemeId !== 'frame',
    `改判=${noLlmButViolating.schemeId}｜来源=${noLlmButViolating.decisionSource}`
  );

  // B7 人工锁定优先于大模型裁定（人类在环）
  const locked = arbitrateChiefDecision({
    candidates: CANDIDATES,
    ranking: RANKING,
    lockedSchemeIds: ['shearwall'],
    llmDecision: { schemeId: 'frame', decisiveFactor: '造价最低' },
  });
  push(
    'B7 工程师锁定优先于大模型裁定（HITL）',
    locked.schemeId === 'shearwall' && locked.decisionSource === 'human-lock',
    `锁定=${locked.schemeId}｜大模型原裁定=${locked.llmChoiceSchemeId}｜来源=${locked.decisionSource}`
  );

  // B8 锁定项违反强条 → 规范高于人工锁定，但必须显眼告知工程师
  const lockedBad = arbitrateChiefDecision({
    candidates: CANDIDATES,
    ranking: RANKING,
    codeChecks: CODE_CHECKS_NESTED,
    lockedSchemeIds: ['frame'],
    llmDecision: { schemeId: 'frame' },
  });
  push(
    'B8 锁定项违反强条 → 规范优先，改判并提示工程师复核',
    lockedBad.schemeId !== 'frame' && lockedBad.decisionNote.includes('工程师'),
    `改判=${lockedBad.schemeId}｜说明=${lockedBad.decisionNote.slice(0, 42)}…`
  );

  // B9 全部候选都违规 → 如实告知，绝不静默推荐
  const allBad = arbitrateChiefDecision({
    candidates: CANDIDATES,
    ranking: RANKING,
    codeChecks: {
      frame: CODE_CHECKS_NESTED.frame,
      shearwall: CODE_CHECKS_NESTED.frame,
      'frame-shearwall': CODE_CHECKS_NESTED.frame,
    },
    llmDecision: { schemeId: 'frame' },
  });
  push(
    'B9 候选全数违规 → 如实警示且不得进入深化设计',
    allBad.decisionNote.includes('强制性条文违反') && allBad.decisionNote.includes('不得'),
    `说明=${allBad.decisionNote.slice(0, 46)}…`
  );
}

// ---------- 场景 C：真实管线端到端（证明 LLM 裁定真的影响最终推荐） ----------
{
  scopedStorage.setItem(
    'agent_engine_config',
    JSON.stringify({
      endpoint: 'https://api.deepseek.com/v1',
      apiKey: 'sk-mock-not-real',
      model: 'deepseek-chat',
    })
  );

  // 该场景下 frame-shearwall 存在强制性条文违反（剪重比）且仍在候选池内，
  // 因此硬约束防线有真实的开火对象，而不是只能靠构造输入才能触发。
  const P: IProjectParams = {
    buildingType: 'residential',
    floors: 25,
    area: 15000,
    structurePreference: 'any',
    seismicIntensity: '8',
    soilCategory: 'Ⅱ',
    geologyType: 'clay',
    mainSpan: 8,
    budget: 8000,
    windPressure: '0.4',
    snowPressure: '0.2',
    fortificationCategory: 'standard',
  };

  let callSeq = 0;
  const toolCall = (name: string, args: Record<string, unknown>) => ({
    id: `call_${++callSeq}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  });
  const lastUser = (messages: any[]) =>
    [...messages].reverse().find((m: any) => m.role === 'user')?.content || '';
  const whichAgent = (messages: any[]): string => {
    const u = lastUser(messages);
    if (u.includes('compare_schemes 工具进行综合对比评分')) return 'chief';
    if (u.includes('check_seismic_requirements 和 check_fire_requirements')) return 'code';
    if (u.includes('query_structure_systems 工具筛选')) return 'architect';
    return 'economist';
  };
  const extractCandidates = (messages: any[]): string[] => {
    const out: string[] = [];
    for (const m of messages) {
      if (m.role === 'tool') {
        try {
          const parsed = JSON.parse(m.content);
          if (Array.isArray(parsed.candidates)) {
            parsed.candidates.forEach((c: any) => c?.id && out.push(c.id));
          }
        } catch {
          /* 忽略非 JSON 工具消息 */
        }
      }
    }
    if (out.length > 0) return [...new Set(out)];
    const re = /[（(]([a-z][a-z0-9-]*)[）)]/g;
    const u = lastUser(messages);
    let m: RegExpExecArray | null;
    while ((m = re.exec(u))) out.push(m[1]);
    return [...new Set(out)];
  };

  /** 可注入总工裁定块的 Mock LLM */
  let chiefDecisionSchemeId: string | null = null;
  const buildMockResponse = (messages: any[]): any => {
    const agent = whichAgent(messages);
    const candidates = extractCandidates(messages);
    if (agent === 'architect') {
      return messages.some((m: any) => m.role === 'tool')
        ? { role: 'assistant', content: '**方案选型结论**\n已筛选候选方案。' }
        : {
            role: 'assistant',
            content: null,
            tool_calls: [toolCall('query_structure_systems', { filters: P })],
          };
    }
    if (agent === 'code') {
      if (!messages.some((m: any) => m.role === 'tool')) {
        const calls: any[] = [];
        for (const id of candidates) {
          calls.push(toolCall('check_seismic_requirements', { systemId: id, params: P }));
          calls.push(toolCall('check_fire_requirements', { systemId: id, floors: P.floors, buildingType: P.buildingType }));
        }
        return { role: 'assistant', content: null, tool_calls: calls };
      }
      return { role: 'assistant', content: '**规范校核结论**\n已逐条校核。' };
    }
    if (agent === 'economist') {
      if (!messages.some((m: any) => m.role === 'tool')) {
        const calls: any[] = [];
        for (const id of candidates) {
          calls.push(toolCall('estimate_cost', { systemId: id, floors: P.floors, seismicIntensity: P.seismicIntensity, soilCategory: P.soilCategory, mainSpan: P.mainSpan }));
          calls.push(toolCall('estimate_schedule', { systemId: id, area: P.area, floors: P.floors }));
        }
        return { role: 'assistant', content: null, tool_calls: calls };
      }
      return { role: 'assistant', content: '**经济与绿色评估结论**\n已完成评估。' };
    }
    if (agent === 'chief') {
      if (!messages.some((m: any) => m.role === 'tool')) {
        return {
          role: 'assistant',
          content: null,
          tool_calls: [
            toolCall('compare_schemes', {
              schemeIds: candidates,
              params: P,
              weights: { cost: 25, duration: 25, safety: 25, green: 25 },
            }),
          ],
        };
      }
      const block = chiefDecisionSchemeId
        ? `\n\n\`\`\`chief-decision\n{"schemeId":"${chiefDecisionSchemeId}","confidence":"high","decisiveFactor":"管线集成测试"}\n\`\`\``
        : '';
      return {
        role: 'assistant',
        content: `# 综合评审结论\n## 1. 综合推荐方案及排序\n已比选。\n## 6. 下一步优化建议\n- 深化${block}`,
      };
    }
    return { role: 'assistant', content: '（未知任务）' };
  };
  globalThis.fetch = (async (_input: any, init?: any) => {
    const body = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({ choices: [{ message: buildMockResponse(body.messages) }], usage: { total_tokens: 0 } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const run = (decisionId: string | null) => {
    chiefDecisionSchemeId = decisionId;
    return runAgentPipeline(P, undefined, {
      mode: 'real',
      endpoint: 'https://api.deepseek.com/v1',
      apiKey: 'sk-mock-not-real',
      model: 'deepseek-chat',
      maxSteps: 20,
    });
  };

  // 先跑一次无裁定，拿到候选池与违规分布
  const baseRun = await run(null);
  const poolIds = baseRun.schemes.map((s) => s.id);
  const violatingIds = poolIds.filter((id) =>
    calculateNormCompliance(id, P).checks.some(
      (c) => c.severity === 'mandatory' && c.status === 'fail'
    )
  );
  const compliantIds = poolIds.filter((id) => !violatingIds.includes(id));
  push(
    'C0 场景成立：候选池中同时存在违规与合规方案',
    violatingIds.length > 0 && compliantIds.length > 0,
    `候选=${poolIds.join('、')}｜违规=${violatingIds.join('、') || '无'}｜合规=${compliantIds.join('、')}`
  );

  // C1：LLM 裁定一个「合规但不是评分首选」的方案 → 最终推荐必须跟随 LLM
  const target = compliantIds.find((id) => id !== baseRun.recommended.scoreTopSchemeId) ?? compliantIds[0];
  const r1 = await run(target);
  push(
    'C1 管线：大模型裁定合规方案 → 最终推荐跟随裁定（决策权回归）',
    r1.recommended.schemeId === target && r1.recommended.decisionSource === 'llm',
    `裁定=${target} → 推荐=${r1.recommended.schemeId}｜来源=${r1.recommended.decisionSource}`
  );

  // C2：LLM 裁定违规方案 → 被硬约束否决，且留下条文级证据 + 可见回退日志
  const r2 = await run(violatingIds[0]);
  push(
    'C2 管线：大模型裁定违规方案 → 代码否决并改判',
    r2.recommended.decisionSource === 'constraint-override' &&
      r2.recommended.schemeId !== violatingIds[0] &&
      compliantIds.includes(r2.recommended.schemeId),
    `裁定=${violatingIds[0]} → 改判=${r2.recommended.schemeId}｜来源=${r2.recommended.decisionSource}`
  );
  push(
    'C2b 否决证据进入结果（条文级，可追溯）',
    (r2.recommended.hardConstraintViolations?.length ?? 0) > 0,
    `证据=${r2.recommended.hardConstraintViolations?.join('；') || '无'}`
  );
  push(
    'C2c 强制回退写入行动日志（界面可见，不是静默改判）',
    r2.actionLog.some((l) => l.type === 'conclusion' && l.content.includes('强制回退')),
    `日志=${r2.actionLog.filter((l) => l.content.includes('强制回退')).length} 条`
  );

  // C3：无裁定 → 评分首选若违规也必须被改判（真实模式没有辩论替换环节，这条会真正开火）
  const r3 = await run(null);
  push(
    'C3 管线：无裁定时评分首选若违规仍被强制改判',
    !violatingIds.includes(r3.recommended.schemeId) || violatingIds.length === 0,
    `评分首选=${r3.recommended.scoreTopSchemeId}｜最终=${r3.recommended.schemeId}｜来源=${r3.recommended.decisionSource}`
  );
}

// ---------- 输出 ----------
let passed = 0;
console.log('\n=== 总工决策裁定层回归（P1-1）===\n');
for (const [name, ok, detail] of checks) {
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  [${detail}]` : ''}`);
}
console.log(`\n通过 ${passed}/${checks.length}\n`);
if (passed !== checks.length) process.exit(1);
