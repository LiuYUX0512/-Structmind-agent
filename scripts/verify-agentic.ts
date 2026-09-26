// ============================================================
// 智构 StructMind · 真实模式升级专项验证（v2 增量改造）
// 场景 1：校核回退闭环 —— Code 发现违规 → Architect 重出 → 复核通过
//          （monkey-patch 工具输出注入可控违规/重出序列）
// 场景 2：崩溃自动降级 —— 真实模式异常 → 透明降级演示轨迹跑完 + degraded 标记
// 运行：node scripts/verify-out/verify-agentic.js
// ============================================================
import { scopedStorage } from '@lark-apaas/client-toolkit-lite';
import { runAgentPipeline } from '../src/agent/pipeline';
import { TOOL_REGISTRY } from '../src/agent/tools';
import type { IProjectParams } from '../src/data/structure';

// ---------- Mock LLM 工具 ----------
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
  if (u.includes('estimate_cost、estimate_schedule')) return 'economist';
  if (u.includes('check_seismic_requirements 和 check_fire_requirements 工具进行规范校核')) return 'code';
  if (u.includes('query_structure_systems 工具筛选')) return 'architect';
  return 'unknown';
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
        /* ignore */
      }
    }
  }
  if (out.length > 0) return out;
  // 兜底：各阶段 engine 独立（messages 不含前序工具结果），从 user prompt 提取「方案名（id）」
  const u = lastUser(messages);
  const re = /[（(]([a-z][a-z0-9-]*)[）)]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(u))) {
    const id = m[1];
    if (!['residential', 'office', 'school', 'factory', 'gymnasium'].includes(id)) out.push(id);
  }
  return [...new Set(out)];
};

const PARAMS: IProjectParams = {
  buildingType: 'residential',
  floors: 30,
  area: 18000,
  mainSpan: 8.4,
  seismicIntensity: '8',
  soilCategory: 'Ⅱ',
  budget: 5000,
};

let architectRedone = false;
/** 场景 3 开关：Code 阶段工具调用乱序（fire 提前、体系逆序），验证配对零错位 */
let shuffleCode = false;

const buildMockResponse = (messages: any[]): any => {
  const agent = whichAgent(messages);
  const candidates = extractCandidates(messages);
  const u = lastUser(messages);
  const hasFeedback = u.includes('上一轮规范校核反馈') || u.includes('校核未通过');

  if (agent === 'architect') {
    // 重出优先：收到校核反馈时必须重新调用工具选型（真实 LLM 在续写会话中也会如此）
    if (hasFeedback && !architectRedone) {
      architectRedone = true;
      return {
        role: 'assistant',
        content: null,
        tool_calls: [toolCall('query_structure_systems', { filters: { buildingType: 'residential', floors: 30, seismicIntensity: '8', mainSpan: 8.4, budget: 5000, preferPass: true } })],
      };
    }
    if (messages.some((m: any) => m.role === 'tool')) {
      return {
        role: 'assistant',
        content: architectRedone
          ? '**方案选型结论（重出）**\n经校核反馈重新选型，建议采用框架-剪力墙结构、剪力墙结构、钢结构作为候选方案。'
          : '**方案选型结论**\n经筛选，建议采用框架结构、剪力墙结构、钢结构作为候选方案进行比选。',
      };
    }
    return {
      role: 'assistant',
      content: null,
      tool_calls: [toolCall('query_structure_systems', { filters: { buildingType: 'residential', floors: 30, seismicIntensity: '8', mainSpan: 8.4, budget: 5000 } })],
    };
  }

  if (agent === 'code') {
    if (!messages.some((m: any) => m.role === 'tool')) {
      if (shuffleCode) {
        // 乱序场景：全部 fire 提前 + 体系逆序（模拟 LLM 不按候选顺序调用）
        const reordered: any[] = [];
        for (const id of [...candidates].reverse()) {
          reordered.push(toolCall('check_fire_requirements', { systemId: id, floors: 30, buildingType: 'residential' }));
        }
        for (const id of [...candidates].reverse()) {
          reordered.push(toolCall('check_seismic_requirements', { systemId: id, params: { floors: 30, seismicIntensity: '8', soilCategory: 'Ⅱ', buildingType: 'residential' } }));
        }
        return { role: 'assistant', content: null, tool_calls: reordered };
      }
      const calls: any[] = [];
      for (const id of candidates) {
        calls.push(toolCall('check_seismic_requirements', { systemId: id, params: { floors: 30, seismicIntensity: '8', soilCategory: 'Ⅱ', buildingType: 'residential' } }));
        calls.push(toolCall('check_fire_requirements', { systemId: id, floors: 30, buildingType: 'residential' }));
      }
      return { role: 'assistant', content: null, tool_calls: calls };
    }
    return { role: 'assistant', content: '**规范校核结论**\n候选方案已完成抗震与防火校核，个别方案存在适用高度超限，已如实标注。' };
  }

  if (agent === 'economist') {
    const toolCount = messages.filter((m: any) => m.role === 'tool').length;
    if (toolCount === 0) {
      const calls: any[] = [];
      for (const id of candidates) {
        calls.push(toolCall('estimate_cost', { systemId: id, floors: 30, seismicIntensity: '8', soilCategory: 'Ⅱ', mainSpan: 8.4 }));
        calls.push(toolCall('estimate_schedule', { systemId: id, area: 18000, floors: 30 }));
        calls.push(toolCall('estimate_precast_rate', { systemId: id, floors: 30 }));
      }
      return { role: 'assistant', content: null, tool_calls: calls };
    }
    if (toolCount === candidates.length * 3) {
      const calls: any[] = [];
      for (const id of candidates) {
        calls.push(toolCall('estimate_carbon', { systemId: id, floors: 30 }));
        calls.push(toolCall('assess_construction_risk', { systemId: id, floors: 30 }));
      }
      return { role: 'assistant', content: null, tool_calls: calls };
    }
    return { role: 'assistant', content: '**经济与绿色评估结论**\n框架-剪力墙方案综合经济性与绿色性能最优。' };
  }

  if (agent === 'chief') {
    if (!messages.some((m: any) => m.role === 'tool')) {
      return {
        role: 'assistant',
        content: null,
        tool_calls: [toolCall('compare_schemes', { schemeIds: candidates, params: PARAMS, weights: { cost: 25, duration: 25, safety: 25, green: 25 } })],
      };
    }
    return {
      role: 'assistant',
      content: `# 综合评审结论
## 1. 综合推荐方案及排序
推荐采用 **框架-剪力墙结构**，综合得分最高。
## 2. 推荐理由
- 抗震性能优越
- 造价适中
- 施工成熟度高
## 3. 各方案优劣势对比
- 剪力墙结构：刚度大但造价偏高
- 钢结构：工期短但防火成本高
## 4. 🤔 总工反思（Reflection）
### 4.1 反向质疑
高层区段需复核层间位移角。
### 4.2 置信度自评
置信度：中高。
### 4.3 遗漏检查
未考虑场地液化影响。
### 4.4 改进方向
下一轮可补充基础方案比选。
## 5. ⚠️ 风险提示
剪力墙布置是关键风险点；烈度提高时需重新评估。
## 6. 下一步优化建议
- 优化剪力墙布置
- 对比基础方案`,
    };
  }

  return { role: 'assistant', content: '（未知任务）' };
};

// ---------- monkey-patch 工具输出（注入可控违规/重出序列） ----------
function installToolPatches() {
  const queryTool = TOOL_REGISTRY.find((t) => t.name === 'query_structure_systems')!;
  const seisTool = TOOL_REGISTRY.find((t) => t.name === 'check_seismic_requirements')!;
  const fireTool = TOOL_REGISTRY.find((t) => t.name === 'check_fire_requirements')!;
  const origQuery = queryTool.executor;
  const origSeis = seisTool.executor;
  const origFire = fireTool.executor;

  // 第一轮（无 preferPass）返回含 frame 的候选；第二轮（preferPass）返回无 frame 的候选
  queryTool.executor = ((args: Record<string, unknown>) => {
    const preferPass = !!(args.filters as Record<string, unknown>)?.preferPass;
    if (preferPass) {
      const ids = ['frame-shearwall', 'shearwall', 'steel'];
      const names: Record<string, string> = { 'frame-shearwall': '框架-剪力墙结构', shearwall: '剪力墙结构', steel: '钢结构' };
      return { total: 3, candidates: ids.map((id) => ({ id, name: names[id], description: '', applicableScenarios: '', advantages: '', disadvantages: '' })) };
    }
    const ids = ['frame', 'shearwall', 'steel'];
    const names: Record<string, string> = { frame: '框架结构', shearwall: '剪力墙结构', steel: '钢结构' };
    return { total: 3, candidates: ids.map((id) => ({ id, name: names[id], description: '', applicableScenarios: '', advantages: '', disadvantages: '' })) };
  }) as typeof origQuery;

  // frame 抗震校核强制违规（模拟 30 层 8 度适用高度超限）；其他体系强制通过（模拟"调整后满足"）
  seisTool.executor = ((args: Record<string, unknown>) => {
    const base = origSeis(args) as any;
    if (args.systemId === 'frame') {
      return {
        ...base,
        systemId: 'frame',
        summary: '框架结构最大适用高度 50m，本工程 96m 超出限值',
        passCount: 0,
        warningCount: 0,
        failCount: 1,
        checks: [
          { name: '最大适用高度', status: 'fail', value: '96', requirement: '≤50', description: '框架结构最大适用高度超限', basis: 'GB 55002-2021 表5.1.2', formula: 'H=30×3.2=96m > 50m', input: { floors: 30, height: 96 }, clauseText: '框架结构最大适用高度为50m', reason: '适用高度超限', source: 'GB 55002-2021' },
        ],
      };
    }
    const n = (base?.checks?.length ?? 1) || 1;
    return {
      ...base,
      systemId: args.systemId,
      summary: '抗震校核全部通过',
      passCount: n,
      warningCount: 0,
      failCount: 0,
      checks: (base?.checks ?? []).map((c: any) => ({ ...c, status: 'pass' })),
    };
  }) as typeof origSeis;

  // 防火校核强制通过（避免 30 层高层级耐火等级干扰回退收敛）
  fireTool.executor = ((args: Record<string, unknown>) => {
    const base = origFire(args) as any;
    const n = (base?.checks?.length ?? 1) || 1;
    return {
      ...base,
      systemId: args.systemId,
      summary: '防火校核全部通过',
      passCount: n,
      warningCount: 0,
      failCount: 0,
      checks: (base?.checks ?? []).map((c: any) => ({ ...c, status: 'pass' })),
    };
  }) as typeof origFire;
}

// ---------- 场景 1：回退闭环 ----------
async function scenarioRecheck() {
  callSeq = 0;
  architectRedone = false;
  installToolPatches();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: any, init?: any) => {
    const body = JSON.parse(String(init?.body));
    const message = buildMockResponse(body.messages);
    return new Response(
      JSON.stringify({ choices: [{ message }], usage: { total_tokens: 0 } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const progress: number[] = [];
  const result = await runAgentPipeline(
    PARAMS,
    undefined,
    { mode: 'real', endpoint: 'https://api.deepseek.com/v1', apiKey: 'sk-mock-not-real', model: 'deepseek-chat', maxSteps: 20 },
    (_l: any, agentIndex: number) => progress.push(agentIndex)
  );
  globalThis.fetch = originalFetch;

  const architectConclusions = result.conclusions.filter((c) => c.startsWith('[Architect]')).length;
  const finalIds = result.schemes.map((s: any) => s.id);
  const frameCheck = result.codeChecks['frame'] as any;

  const checks: Array<[string, boolean, string]> = [
    ['回退触发：Architect 被重出（≥2 条结论）', architectConclusions >= 2, `实际 ${architectConclusions}`],
    ['第一轮违规被真实记录（codeChecks.frame 有 fail）', !!frameCheck?.seismic && (frameCheck.seismic.failCount ?? 0) > 0, `frame.seismic=${JSON.stringify(frameCheck?.seismic?.summary)}`],
    ['最终方案不含违规的 frame', !finalIds.includes('frame'), `最终 ${finalIds.join(',')}`],
    ['重出方案生效：含 frame-shearwall', finalIds.includes('frame-shearwall'), `最终 ${finalIds.join(',')}`],
    ['最终 codeChecks 不再校核 frame', !result.codeChecks['frame'] || !finalIds.includes('frame'), `keys=${Object.keys(result.codeChecks).join(',')}`],
    ['Chief 完整仲裁（进度走完 4 阶段）', progress.length >= 4, `进度 ${JSON.stringify(progress)}`],
    ['结果完整性：ranking≥2 且 recommended 有效', result.ranking.length >= 2 && !!result.recommended.schemeId, `ranking ${result.ranking.length}, rec ${result.recommended.schemeId}`],
    ['无降级标记（真实模式正常完成）', !result.degraded, `degraded=${JSON.stringify(result.degraded)}`],
  ];

  console.log('===== 场景 1：校核回退闭环 =====\n');
  let pass = 0;
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? '✅' : '❌'} ${name}  [${detail}]`);
    if (ok) pass++;
  }
  return { ok: pass === checks.length, pass, total: checks.length };
}

// ---------- 场景 2：崩溃自动降级 ----------
async function scenarioDegrade() {
  callSeq = 0;
  let degradeReason = '';
  let fetchCalls = 0;

  globalThis.fetch = (async () => {
    fetchCalls++;
    throw new Error('LLM 请求失败 (503): service unavailable');
  }) as typeof fetch;

  const result = await runAgentPipeline(
    PARAMS,
    undefined,
    { mode: 'real', endpoint: 'https://api.deepseek.com/v1', apiKey: 'sk-mock-not-real', model: 'deepseek-chat', maxSteps: 20 },
    undefined,
    (reason: string) => { degradeReason = reason; }
  );

  const checks: Array<[string, boolean, string]> = [
    ['真实请求确实失败', fetchCalls >= 1, `fetch 调用 ${fetchCalls} 次`],
    ['降级回调触发（onDegrade）', degradeReason.includes('503'), `reason=${degradeReason.slice(0, 60)}`],
    ['结果带 degraded 标记', result.degraded?.from === 'real' && !!result.degraded.reason, `degraded=${JSON.stringify(result.degraded)}`],
    ['降级后仍产出完整结果（schemes/ranking）', result.schemes.length >= 2 && result.ranking.length >= 1, `schemes ${result.schemes.length}, ranking ${result.ranking.length}`],
    ['recommended 有效', !!result.recommended.schemeId && result.recommended.overallScore > 0, `rec ${result.recommended.schemeId} score ${result.recommended.overallScore}`],
    ['结论完整（四 Agent）', result.conclusions.length >= 4, `实际 ${result.conclusions.length}`],
  ];

  console.log('\n===== 场景 2：崩溃自动降级 =====\n');
  let pass = 0;
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? '✅' : '❌'} ${name}  [${detail}]`);
    if (ok) pass++;
  }
  return { ok: pass === checks.length, pass, total: checks.length };
}

// ---------- 场景 3：乱序工具调用（数据配对零错位） ----------
async function scenarioShuffle() {
  callSeq = 0;
  architectRedone = false;
  shuffleCode = true;
  installToolPatches();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: any, init?: any) => {
    const body = JSON.parse(String(init?.body));
    const message = buildMockResponse(body.messages);
    return new Response(
      JSON.stringify({ choices: [{ message }], usage: { total_tokens: 0 } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const result = await runAgentPipeline(
    PARAMS,
    undefined,
    { mode: 'real', endpoint: 'https://api.deepseek.com/v1', apiKey: 'sk-mock-not-real', model: 'deepseek-chat', maxSteps: 20 }
  );
  globalThis.fetch = originalFetch;
  shuffleCode = false;

  const frame = result.codeChecks['frame'] as any;
  const steel = result.codeChecks['steel'] as any;
  const shearwall = result.codeChecks['shearwall'] as any;
  const finalIds = result.schemes.map((s: any) => s.id);

  const checks: Array<[string, boolean, string]> = [
    ['frame.seismic 配对正确（抗震结果、systemId=frame）', frame?.seismic?.systemId === 'frame' && (frame.seismic.failCount ?? 0) > 0, `seismic=${JSON.stringify(frame?.seismic?.systemId)}, fail=${frame?.seismic?.failCount}`],
    ['frame.fire 配对正确（防火结果、systemId=frame）', frame?.fire?.systemId === 'frame' && (frame.fire.failCount ?? 0) === 0, `fire=${JSON.stringify(frame?.fire?.systemId)}, fail=${frame?.fire?.failCount}`],
    ['steel.seismic 配对正确（未错位到 frame）', steel?.seismic?.systemId === 'steel' && (steel.seismic.failCount ?? 0) === 0, `seismic=${JSON.stringify(steel?.seismic?.systemId)}, fail=${steel?.seismic?.failCount}`],
    ['shearwall.seismic 配对正确', shearwall?.seismic?.systemId === 'shearwall', `seismic=${JSON.stringify(shearwall?.seismic?.systemId)}`],
    ['回退闭环仍正常收敛（frame 违规 → 重出）', !finalIds.includes('frame') && finalIds.includes('frame-shearwall'), `最终 ${finalIds.join(',')}`],
    ['无降级', !result.degraded, `degraded=${JSON.stringify(result.degraded)}`],
  ];

  console.log('\n===== 场景 3：乱序工具调用（数据配对零错位） =====\n');
  let pass = 0;
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? '✅' : '❌'} ${name}  [${detail}]`);
    if (ok) pass++;
  }
  return { ok: pass === checks.length, pass, total: checks.length };
}

// ---------- 场景 4：LLM 请求自动重试（网络抖动/5xx 不崩管线） ----------
async function scenarioRetry() {
  callSeq = 0;
  architectRedone = false;
  shuffleCode = false;
  installToolPatches();

  let firstCall = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: any, init?: any) => {
    if (firstCall) {
      // 第一次请求直接 503（模拟服务抖动）→ 引擎应自动重试
      firstCall = false;
      return new Response('service unavailable', { status: 503 });
    }
    const body = JSON.parse(String(init?.body));
    const message = buildMockResponse(body.messages);
    return new Response(
      JSON.stringify({ choices: [{ message }], usage: { total_tokens: 0 } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const result = await runAgentPipeline(
    PARAMS,
    undefined,
    { mode: 'real', endpoint: 'https://api.deepseek.com/v1', apiKey: 'sk-mock-not-real', model: 'deepseek-chat', maxSteps: 20 }
  );
  globalThis.fetch = originalFetch;

  const retryLogs = result.actionLog.filter(
    (l: any) => typeof l.content === 'string' && l.content.includes('自动重试')
  );
  const checks: Array<[string, boolean, string]> = [
    ['重试日志已写入 actionLog（用户可见）', retryLogs.length >= 1, `重试日志 ${retryLogs.length} 条`],
    ['重试后管线正常完成（未降级）', !result.degraded, `degraded=${JSON.stringify(result.degraded)}`],
    ['结果完整（schemes≥2）', result.schemes.length >= 2, `schemes ${result.schemes.length}`],
    ['recommended 有效', !!result.recommended?.schemeId, `rec=${result.recommended?.schemeId}`],
    ['结论完整（四 Agent）', result.conclusions.length >= 4, `实际 ${result.conclusions.length}`],
  ];

  console.log('\n===== 场景 4：LLM 请求自动重试（网络抖动不崩管线） =====\n');
  let pass = 0;
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? '✅' : '❌'} ${name}  [${detail}]`);
    if (ok) pass++;
  }
  return { ok: pass === checks.length, pass, total: checks.length };
}

// ---------- 运行 ----------
scopedStorage.setItem(
  'agent_engine_config',
  JSON.stringify({ endpoint: 'https://api.deepseek.com/v1', apiKey: 'sk-mock-not-real', model: 'deepseek-chat' })
);

const r1 = await scenarioRecheck();
const r2 = await scenarioDegrade();
const r3 = await scenarioShuffle();
const r4 = await scenarioRetry();

console.log(`\n---- 汇总：场景1 ${r1.pass}/${r1.total} · 场景2 ${r2.pass}/${r2.total} · 场景3 ${r3.pass}/${r3.total} · 场景4 ${r4.pass}/${r4.total} ----`);
if (r1.ok && r2.ok && r3.ok && r4.ok) {
  console.log('🎯 真实模式专项验证全部通过：回退闭环 + 崩溃降级 + 乱序零错位 + 自动重试');
  process.exit(0);
} else {
  console.log('⚠️ 存在失败项，见上方 ❌');
  process.exit(1);
}
