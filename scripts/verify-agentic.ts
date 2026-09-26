// ============================================================
// 智构 StructMind · 真实模式升级专项验证（v2 增量改造）
// 场景 1：校核回退闭环 —— Code 发现违规 → Architect 重出 → 复核通过
//          （monkey-patch 工具输出注入可控违规/重出序列）
// 场景 2：崩溃自动降级 —— 真实模式异常 → 透明降级演示轨迹跑完 + degraded 标记
// 运行：node scripts/verify-out/verify-agentic.js
// ============================================================
import { scopedStorage } from '@lark-apaas/client-toolkit-lite';
import { runAgentPipeline } from '../src/agent/pipeline';
import { TOOL_REGISTRY, executeToolByName } from '../src/agent/tools';
import { resolveKnowledgeBasis } from '../src/data/code-knowledge';
import { saveHistoryEntry, loadHistory, clearHistory, type IHistoryEntry } from '../src/data/project-history';
import type { IProjectParams } from '../src/data/structure';
import { STRUCTURE_SYSTEM_LIBRARY } from '../src/data/structure';
import { parseIntentByRules } from '../src/agent/intent';
import { EIntentType } from '../src/agent/types';
import { estimateCarbonBreakdown } from '../src/data/carbon-model';
import { buildModelDefinition, serializeModelJson, serializeModelText, buildImportGuide } from '../src/lib/model-export';
import { renderToString } from 'react-dom/server';
import CountUpOnView from '../src/components/CountUpOnView';
import StructureWireframe3D from '../src/components/StructureWireframe3D';
import HeroSection from '../src/pages/HomePage/sections/HeroSection';
import AgentFlowMap from '../src/components/AgentFlowMap';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as React from 'react';
import { extractDebateItems } from '../src/components/DebatePanel';

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
- 最可能出问题：剪力墙布置是关键风险点
- 什么情况下需要重新评估（触发条件）：当设防烈度提高或建筑高度增加时
- 后续深化设计时重点关注：节点构造与配筋
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

// ---------- 场景 5：人类在环（HITL） ----------
async function scenarioHitl() {
  callSeq = 0;
  architectRedone = false;
  shuffleCode = false;
  installToolPatches();

  // 覆盖重出候选：返回不含 shearwall（验证 pipeline 对锁定方案强制保留，工程师锁超越 LLM）
  const queryTool = TOOL_REGISTRY.find((t) => t.name === 'query_structure_systems')!;
  const origQuery = queryTool.executor;
  queryTool.executor = ((args: Record<string, unknown>) => {
    const preferPass = !!(args.filters as Record<string, unknown>)?.preferPass;
    if (preferPass) {
      const ids = ['frame-shearwall', 'steel'];
      return {
        candidates: ids.map((id) => ({ id, name: id, description: 'mock' })),
        filters: args.filters,
      };
    }
    return origQuery(args);
  }) as typeof queryTool.executor;

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
    { mode: 'real', endpoint: 'https://api.deepseek.com/v1', apiKey: 'sk-mock-not-real', model: 'deepseek-chat', maxSteps: 20 },
    undefined,
    undefined,
    { lockedSchemeIds: ['shearwall'], budgetCap: 100, notes: '优先考虑装配式施工' }
  );
  globalThis.fetch = originalFetch;
  queryTool.executor = origQuery;

  const logs = result.actionLog.map((l: any) => String(l.content || ''));
  const hasBudgetLog = logs.some((l) => l.includes('人工设定预算上限 100 万元'));
  const hasLockLog = logs.some((l) => l.includes('人工锁定方案'));
  const hasNoteLog = logs.some((l) => l.includes('人工备注'));
  const shearwallKept = result.schemes.some((sc: any) => sc.id === 'shearwall');
  const risks = result.advice?.risks || [];
  const hasBudgetRisk = risks.some((r: string) => r.includes('预算超限'));
  const exceeded = result.budgetExceeded || [];

  const checks: Array<[string, boolean, string]> = [
    ['干预日志：预算上限已写入 actionLog', hasBudgetLog, `found=${hasBudgetLog}`],
    ['干预日志：锁定方案已写入 actionLog', hasLockLog, `found=${hasLockLog}`],
    ['干预日志：人工备注已写入 actionLog', hasNoteLog, `found=${hasNoteLog}`],
    ['锁定方案强制保留（LLM 重出未返回也补回）', shearwallKept, `schemes=${result.schemes.map((s: any) => s.id).join(',')}`],
    ['预算超限已机械化判定（budgetExceeded）', exceeded.length > 0, `exceeded=${exceeded.join(',')}`],
    ['advice.risks 如实反映预算风险', hasBudgetRisk, `risks=${risks.length}`],
    ['无降级（HITL 全程真实模式）', !result.degraded, `degraded=${JSON.stringify(result.degraded)}`],
    ['结论完整', result.conclusions.length >= 6, `conclusions=${result.conclusions.length}`],
  ];

  console.log('\n===== 场景 5：人类在环（HITL）干预 =====\n');
  let pass = 0;
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? '✅' : '❌'} ${name}  [${detail}]`);
    if (ok) pass++;
  }
  return { ok: pass === checks.length, pass, total: checks.length };
}

// ---------- 场景 6：Chief 结构化输出（反思/风险/置信度解析） ----------
async function scenarioChiefStructured() {
  callSeq = 0;
  architectRedone = false;
  shuffleCode = false;
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

  const advice = result.advice;
  const checks: Array<[string, boolean, string]> = [
    ['advice.pros 从"推荐理由"解析', (advice?.pros || []).length > 0, `pros=${advice?.pros?.length}`],
    ['advice.cons 从"优劣势对比"解析', (advice?.cons || []).length > 0, `cons=${advice?.cons?.length}`],
    ['advice.nextSteps 解析', (advice?.nextSteps || []).length > 0, `next=${advice?.nextSteps?.length}`],
    ['advice.risks 从"风险提示"解析', (advice?.risks || []).length > 0, `risks=${JSON.stringify(advice?.risks)}`],
    ['advice.riskTriggers 从"触发条件"解析', (advice?.riskTriggers || []).length > 0, `triggers=${advice?.riskTriggers?.length}`],
    ['advice.confidence 解析出等级', !!advice?.confidence?.level, `level=${advice?.confidence?.level}`],
    ['confidence 带理由', (advice?.confidence?.reason || '').length > 6, `reason=${(advice?.confidence?.reason || '').slice(0, 30)}`],
    ['无降级', !result.degraded, `degraded=${JSON.stringify(result.degraded)}`],
  ];

  console.log('\n===== 场景 6：Chief 结构化输出（反思/风险/置信度） =====\n');
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

// ---------- 场景 7：规范知识库条文追溯（第 8 条意见落地验证） ----------
async function scenarioKnowledge() {
  console.log('\n===== 场景 7：规范知识库条文追溯 =====\n');
  const checks: Array<[string, boolean, string]> = [];
  const seismic = executeToolByName('check_seismic_requirements', {
    systemId: 'frame',
    params: { floors: 10, seismicIntensity: '8' },
  });
  const fire = executeToolByName('check_fire_requirements', {
    systemId: 'steel',
    floors: 20,
    buildingType: 'factory',
  });
  const kb = (seismic as { knowledgeBasis?: unknown }).knowledgeBasis as Array<{ code: string; clause: string; title: string; text: string }> | undefined;
  checks.push(['seismic 输出携带 knowledgeBasis', Array.isArray(kb) && kb.length > 0, String(kb?.length)]);
  const codeOk = (kb ?? []).every((r) => r.code && r.clause && r.title && r.text);
  checks.push(['每条条文含 规范号/条文号/标题/要旨', codeOk, `${(kb ?? []).length} 条`]);
  const clauseOk = (kb ?? []).some((r) => r.clause.includes('表') || r.clause.includes('第'));
  checks.push(['条文号格式可追溯', clauseOk, (kb ?? []).map((r) => r.clause).join(' / ')]);
  const fireKb = (fire as { knowledgeBasis?: unknown }).knowledgeBasis as Array<{ code: string }> | undefined;
  checks.push(['fire 输出携带知识库（钢结构防火条文）', Array.isArray(fireKb) && fireKb.length > 0 && (fireKb ?? []).some((r) => r.code.includes('GB 55037')), String(fireKb?.length)]);
  // 通用条目不过滤：frame 应命中高度/位移角/剪重比等（appliesTo 含 frame 或通用）
  const hasHeight = (kb ?? []).some((r) => r.title.includes('最大适用高度'));
  checks.push(['frame 命中最大适用高度条文', hasHeight, 'GB/T 50011 表6.1.1']);
  // 适用过滤：axial_ratio 只对剪力墙体系
  const frameAxial = resolveKnowledgeBasis('frame', ['axial_ratio']);
  const wallAxial = resolveKnowledgeBasis('shearwall', ['axial_ratio']);
  checks.push(['appliesTo 过滤正确（轴压比仅墙系）', frameAxial.length === 0 && wallAxial.length > 0, `frame=${frameAxial.length}, shearwall=${wallAxial.length}`]);
  // 判定本身仍带条文文本（原有 clauseText 不回归）
  const seisChecks = (seismic as { checks?: Array<{ clauseText?: string }> }).checks ?? [];
  checks.push(['校核判定仍带 clauseText（未回归）', seisChecks.some((c) => c.clauseText), `${seisChecks.length} 项`]);
  let pass = 0;
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? '✅' : '❌'} ${name}  [${detail}]`);
    if (ok) pass++;
  }
  return { ok: pass === checks.length, pass, total: checks.length };
}

// ---------- 场景 8：工程历史版本（localStorage 注入式存储） ----------
async function scenarioHistory() {
  console.log('\n===== 场景 8：工程历史版本管理 =====\n');
  const checks: Array<[string, boolean, string]> = [];
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
  const base: IHistoryEntry = {
    id: 't',
    timestamp: 0,
    params: { buildingType: 'residential', floors: 8, area: 4000, structurePreference: 'any', seismicIntensity: '7', soilCategory: 'Ⅱ', geologyType: 'clay', mainSpan: 8, budget: 3500, windPressure: '0.4', snowPressure: '0.2', fortificationCategory: 'standard' },
    recommended: { schemeId: 'frame', schemeName: '框架结构', overallScore: 88 },
    ranking: [{ schemeId: 'frame', schemeName: '框架结构', score: 88 }],
    codeChecks: {},
    metrics: {},
  };
  // 保存 12 版 → 只留 10 版
  let list: IHistoryEntry[] = [];
  for (let i = 0; i < 12; i++) {
    list = saveHistoryEntry({ ...base, id: String(i), timestamp: i, recommended: { ...base.recommended, overallScore: 80 + i } }, storage);
  }
  checks.push(['最多保留 10 版', list.length === 10, `${list.length} 版`]);
  checks.push(['最新在前（第11版为最新）', list[0].id === '11', `head=${list[0].id}`]);
  checks.push(['最旧被裁剪（第0/1版已淘汰）', !list.some((h) => h.id === '0' || h.id === '1'), list.map((h) => h.id).join(',')]);
  // load 一致性
  const loaded = loadHistory(storage);
  checks.push(['loadHistory 与保存一致', loaded.length === 10 && loaded[0].id === '11', `${loaded.length} 版`]);
  // 重复保存同 id 去重
  list = saveHistoryEntry({ ...base, id: '11' }, storage);
  checks.push(['同 id 重复保存去重', list.length === 10 && list.filter((h) => h.id === '11').length === 1, `${list.length} 版`]);
  // 清空
  clearHistory(storage);
  checks.push(['clearHistory 清空', loadHistory(storage).length === 0, '0 版']);
  // buildHistoryEntry 摘要正确
  const entry = saveHistoryEntry({ ...base, id: 'x' }, storage)[0];
  checks.push(['历史条目含推荐方案/得分', entry.recommended.schemeName === '框架结构' && entry.recommended.overallScore === 88, `${entry.recommended.schemeName} ${entry.recommended.overallScore}分`]);
  let pass = 0;
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? '✅' : '❌'} ${name}  [${detail}]`);
    if (ok) pass++;
  }
  return { ok: pass === checks.length, pass, total: checks.length };
}

// ---------- 场景 9：辩论可视化提取 + 意图同义归一 + 碳排放构成（第 12/13/14 条落地验证） ----------
async function scenarioNewFeatures() {
  console.log('\n===== 场景 9：辩论提取 + 意图归一 + 碳排构成 =====\n');
  const checks: Array<[string, boolean, string]> = [];

  // --- 9a. 辩论看板数据提取：演示模式 actionLog 里的"第N轮辩论"日志 ---
  const logs = [
    { type: 'think', agent: 'code', content: '【第1轮辩论 · Code 挑刺 框架结构】\n逐一审校后，发现以下不符合项：\n  弹性层间位移角：实际 1/480，限值 1/550\n判定结论：框架结构 不满足规范要求，不能作为推荐方案进入下一轮。', timestamp: 1 },
    { type: 'think', agent: 'architect', content: '【第1轮辩论 · Architect 回应】\n收到 Code Agent 对 框架结构 的质疑。同意你的判断。\n我的调整：将「框架结构」替换为「框架-剪力墙结构」重算。\n请 Code Agent 重新校核 框架-剪力墙结构。', timestamp: 2 },
    { type: 'tool_call', agent: 'code', tool: 'check_seismic_requirements', content: '对替换方案进行校核（第 1 轮重算）', timestamp: 3 },
    { type: 'think', agent: 'code', content: '【第2轮辩论 · Code 挑刺 框架-剪力墙结构】\n判定结论：仍不满足。', timestamp: 4 },
  ];
  const items = extractDebateItems(logs as any);
  checks.push(['辩论条目提取数量（2 轮 × 各 1 条有效）', items.length === 3, `${items.length} 条`]);
  checks.push(['Code 挑刺识别为 code 角色', items[0]?.role === 'code' && items[0]?.loop === 1, `${items[0]?.role}#${items[0]?.loop}`]);
  checks.push(['Architect 回应识别为 architect 角色', items[1]?.role === 'architect' && items[1]?.loop === 1, `${items[1]?.role}#${items[1]?.loop}`]);
  checks.push(['第 2 轮轮次正确', items[2]?.loop === 2, `loop=${items[2]?.loop}`]);
  checks.push(['标题（方案名）提取', items[0]?.title.includes('框架'), items[0]?.title || '(空)']);
  checks.push(['正文不含标记头', !items[0]?.content.includes('第1轮辩论'), items[0]?.content.slice(0, 20) + '…']);

  // --- 9b. 意图同义归一化（第 12 条） ---
  const cut1 = parseIntentByRules('帮我砍点预算');
  checks.push(['「帮我砍点预算」归一为 ASK_BUDGET_CUT', cut1.intent === EIntentType.ASK_BUDGET_CUT, cut1.intent]);
  const cut2 = parseIntentByRules('预算能不能少点');
  checks.push(['「预算能不能少点」归一为 ASK_BUDGET_CUT', cut2.intent === EIntentType.ASK_BUDGET_CUT, cut2.intent]);
  const cut3 = parseIntentByRules('预算砍20%');
  checks.push(['「预算砍20%」带幅度参数', cut3.intent === EIntentType.ASK_BUDGET_CUT && cut3.budgetCutPercent === 20, `pct=${cut3.budgetCutPercent}`]);
  const askCode = parseIntentByRules('层间位移角限值是多少');
  checks.push(['规范问句不回归（仍是 ASK_CODE）', askCode.intent === EIntentType.ASK_CODE, askCode.intent]);
  const change = parseIntentByRules('改成20层');
  checks.push(['参数修改不回归（仍是 CHANGE_PARAMS）', change.intent === EIntentType.CHANGE_PARAMS, change.intent]);

  // --- 9c. 碳排放构成（第 14 条）：三阶段之和 = 合计；基准对比存在 ---
  const cb = estimateCarbonBreakdown('frame', 10);
  const sum = Math.round((cb.production + cb.transport + cb.construction) * 10) / 10;
  checks.push(['三阶段之和 = 合计', sum === cb.total, `${cb.production}+${cb.transport}+${cb.construction}=${sum} / total=${cb.total}`]);
  checks.push(['基准值存在且为正', cb.baseline > 0, `baseline=${cb.baseline}`]);
  const cbSteel = estimateCarbonBreakdown('steel', 20);
  checks.push(['钢结构生产阶段占比更高', cbSteel.production / cbSteel.total > cb.production / cb.total, `${(cbSteel.production / cbSteel.total).toFixed(2)} vs ${(cb.production / cb.total).toFixed(2)}`]);
  checks.push(['vsBaselinePct 有符号', typeof cb.vsBaselinePct === 'number' && !Number.isNaN(cb.vsBaselinePct), `${cb.vsBaselinePct}%`]);

  let pass = 0;
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? '✅' : '❌'} ${name}  [${detail}]`);
    if (ok) pass++;
  }
  return { ok: pass === checks.length, pass, total: checks.length };
}


// ---------- 场景 10：PKPM/YJK 模型导出（前哨占位） ----------
async function scenarioModelExport() {
  const checks: Array<[string, boolean, string]> = [];
  const params: IProjectParams = {
    buildingType: 'factory',
    floors: 5,
    area: 5000,
    structurePreference: 'any',
    seismicIntensity: '8',
    soilCategory: 'II',
    geologyType: '粉质黏土',
    mainSpan: 12,
    budget: 2800,
    windPressure: '0.45',
    snowPressure: '0.35',
    fortificationCategory: '标准设防',
  };
  const scheme = STRUCTURE_SYSTEM_LIBRARY.find((x) => x.id === 'steel') || STRUCTURE_SYSTEM_LIBRARY[0];

  const model = buildModelDefinition(params, scheme);
  checks.push(['格式标识正确', model.format === 'structmind-sm-v1', model.format]);
  checks.push(['轴线数量 = (开间+1)+(进深+1)', model.axes.length === (model.grid.baysX + 1) + (model.grid.baysZ + 1), `axes=${model.axes.length}, bays=${model.grid.baysX}x${model.grid.baysZ}`]);
  checks.push(['层高表覆盖全部楼层', model.floorLevels.length === params.floors, `levels=${model.floorLevels.length}`]);
  checks.push(['柱表 = 全部轴线交点', model.members.columns.length === (model.grid.baysX + 1) * (model.grid.baysZ + 1), `cols=${model.members.columns.length}`]);
  checks.push(['梁表包含双向主梁（每向 = 轴线数×跨数）', model.members.beams.length === model.grid.baysX * (model.grid.baysZ + 1) + model.grid.baysZ * (model.grid.baysX + 1), `beams=${model.members.beams.length}`]);
  checks.push(['截面为数值（非空区间）', /^\d+×\d+$/.test(model.members.columns[0].section), model.members.columns[0].section]);
  checks.push(['免责声明存在且含 PKPM/YJK 字样', model.caveat.includes('PKPM/YJK'), model.caveat.slice(0, 30)]);
  const text = serializeModelText(model);
  checks.push(['文本含轴线/层高/柱/梁四个章节', ['轴线网格', '层高表', '柱截面表', '梁截面表'].every((k) => text.includes(k)), 'sections ok']);
  const guide = buildImportGuide(model);
  checks.push(['导入说明含"智能前端"定位', guide.includes('智能前端'), guide.slice(0, 40)]);
  const json = serializeModelJson(model);
  checks.push(['JSON 可解析且字段完整', JSON.parse(json).scheme.id === scheme.id, 'json ok']);

  let pass = 0;
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? '✅' : '❌'} ${name}  [${detail}]`);
    if (ok) pass++;
  }
  return { ok: pass === checks.length, pass, total: checks.length };
}


// ---------- 场景 11：UI 体检（视觉锤升级全量回归） ----------
async function scenarioUiHealth() {
  const checks: Array<[string, boolean, string]> = [];
  const root = process.cwd();

  // 11a. 渲染级：组件 SSR 不崩
  const cup = renderToString(React.createElement(CountUpOnView, { value: 4, suffix: '+' }));
  checks.push(['CountUpOnView SSR 不崩且输出初始值', cup.includes('0') || cup.includes('4'), cup.slice(0, 30)]);

  const params3d: IProjectParams = { buildingType: 'factory', floors: 5, area: 5000, structurePreference: 'any', seismicIntensity: '8', soilCategory: 'II', geologyType: '粉质黏土', mainSpan: 12, budget: 2800, windPressure: '0.45', snowPressure: '0.35', fortificationCategory: '标准设防' };
  const scheme3d = STRUCTURE_SYSTEM_LIBRARY.find((x) => x.id === 'frame') || STRUCTURE_SYSTEM_LIBRARY[0];
  const html3d = renderToString(React.createElement(StructureWireframe3D, { params: params3d, scheme: scheme3d, autoRotate: true }));
  checks.push(['3D autoRotate SSR 不崩', html3d.length > 200, `len=${html3d.length}`]);
  checks.push(['autoRotate 渲染顶层柱高亮段', html3d.includes('hero-top-column'), 'topcol ok']);

  const html3dStatic = renderToString(React.createElement(StructureWireframe3D, { params: params3d, scheme: scheme3d }));
  checks.push(['非 autoRotate 不输出顶层柱高亮段', !html3dStatic.includes('hero-top-column'), 'static clean']);

  const heroHtml = renderToString(
    React.createElement(HeroSection, { onStart: () => undefined, params: params3d, scheme: scheme3d })
  );
  checks.push(['HeroSection SSR 不崩', heroHtml.length > 2000, `len=${heroHtml.length}`]);
  checks.push(['Hero 统计带含 4 项数字标签', ['多智能体协同', '维度比选', '结构体系库', '方案并行比选'].every((k) => heroHtml.includes(k)), 'stats ok']);

  // 11b. 源码级：视觉类与颜色映射存在
  const themeCss = readFileSync(resolve(root, 'src', 'tailwind-theme.css'), 'utf-8');
  checks.push(['主题含 emerald/gold 色板变量', themeCss.includes('--emerald') && themeCss.includes('--gold'), 'vars ok']);
  checks.push(['主题含玻璃拟态 @utility', themeCss.includes('glass-blueprint'), 'glass ok']);
  checks.push(['主题含呼吸网格 @utility+keyframes', themeCss.includes('hero-breathing') && themeCss.includes('hero-breathe'), 'breathe ok']);
  checks.push(['主题含顶层柱高亮 @utility', themeCss.includes('hero-top-column'), 'topcol css ok']);

  const heroSrc = readFileSync(resolve(root, 'src', 'pages', 'HomePage', 'sections', 'HeroSection.tsx'), 'utf-8');
  checks.push(['Hero 传入 autoRotate', heroSrc.includes('autoRotate'), 'autoRotate prop ok']);
  checks.push(['Hero 使用玻璃拟态类', heroSrc.includes('glass-blueprint'), 'glass use ok']);
  checks.push(['Hero 使用 CountUpOnView', heroSrc.includes('CountUpOnView'), 'countup use ok']);

  const tlSrc = readFileSync(resolve(root, 'src', 'components', 'AgentActionTimeline.tsx'), 'utf-8');
  checks.push(['时间线四色映射（青/琥珀/绿/金）', tlSrc.includes('text-teal') && tlSrc.includes('text-amber') && tlSrc.includes('text-emerald') && tlSrc.includes('text-gold'), '4-color map ok']);

  const pvSrc = readFileSync(resolve(root, 'src', 'components', 'AgentPipelineView.tsx'), 'utf-8');
  checks.push(['四卡主题色同步（emerald/gold）', pvSrc.includes('emerald') && pvSrc.includes('gold'), 'pipeline theme ok']);

  const cupSrc = readFileSync(resolve(root, 'src', 'components', 'CountUpOnView.tsx'), 'utf-8');
  checks.push(['CountUp 无 IO 环境降级保护', cupSrc.includes('typeof IntersectionObserver') && cupSrc.includes('setDisplay(value)'), 'deg ok']);

  const hook1 = readFileSync(resolve(root, 'src', 'hooks', 'use-action-player.ts'), 'utf-8');
  const hook2 = readFileSync(resolve(root, 'src', 'pages', 'RuntimeVerify', 'RuntimeVerifyPage.tsx'), 'utf-8');
  checks.push(['lint 清理：无 unused eslint-disable 残留', !hook1.includes('eslint-disable-next-line react-hooks/exhaustive-deps') && !hook2.includes('eslint-disable-next-line react-hooks/exhaustive-deps'), 'lint clean']);

  const wireSrc = readFileSync(resolve(root, 'src', 'components', 'StructureWireframe3D.tsx'), 'utf-8');
  checks.push(['3D 自转走 JS 真 3D（36°/s）', wireSrc.includes('autoRotate ? 36 : 5'), 'js rotate ok']);
  checks.push(['3D hover 暂停事件', wireSrc.includes('onMouseEnter') && wireSrc.includes('onMouseLeave'), 'hover pause ok']);
  checks.push(['3D rAF 循环有清理', wireSrc.includes('cancelAnimationFrame'), 'raf cleanup ok']);

  // 11c. 执行图节点树 + 打字机 + 思考气泡
  const logs11 = [];
  for (let i = 0; i < 8; i++) {
    logs11.push({ step: i + 1, agent: (i % 4 === 0 ? 'architect' : i % 4 === 1 ? 'code' : i % 4 === 2 ? 'economist' : 'chief'), type: 'think', content: 'step ' + (i + 1) });
  }
  const flowHtml = renderToString(React.createElement(AgentFlowMap, { logs: logs11 as unknown as IAgentActionLog[], playingStep: 3, isPlaying: true }));
  checks.push(['执行图 SSR 不崩', flowHtml.includes('MULTI-AGENT') && flowHtml.includes('svg'), 'flow ok']);
  checks.push(['执行图含四泳道列头', ['方案建筑师', '规范校核员', '经济测算师', '总工仲裁'].every((k) => flowHtml.includes(k)), 'lanes ok']);
  checks.push(['执行图含 SMIL 放电动画', flowHtml.includes('<animate'), 'smil ok']);

  const rwLogs = [
    { step: 1, agent: 'architect', type: 'think', content: 'a' },
    { step: 2, agent: 'architect', type: 'conclusion', content: '方案一' },
    { step: 3, agent: 'code', type: 'tool_call', tool: 'check_seismic_requirements' },
    { step: 4, agent: 'code', type: 'tool_result', content: 'fail' },
    { step: 5, agent: 'architect', type: 'think', content: '重新选型' },
  ] as unknown as IAgentActionLog[];
  const rwHtml = renderToString(React.createElement(AgentFlowMap, { logs: rwLogs }));
  checks.push(['回退检测：code→architect 红色弧线', rwHtml.includes('agent-flow-rework') && rwHtml.includes('打回重算'), 'rework ok']);

  const tl2 = readFileSync(resolve(root, 'src', 'components', 'AgentActionTimeline.tsx'), 'utf-8');
  checks.push(['时间线含思维导图/明细切换', tl2.includes('思维导图') && tl2.includes("'list'") && tl2.includes('AgentFlowMap'), 'toggle ok']);
  checks.push(['工具气泡可读描述（GB 55002）', tl2.includes('正在查阅 GB 55002 抗震规范'), 'tool desc ok']);

  const chatSrc = readFileSync(resolve(root, 'src', 'pages', 'HomePage', 'sections', 'ChatSection.tsx'), 'utf-8');
  checks.push(['对话区打字机（行级推进）', chatSrc.includes('useTypewriter') && chatSrc.includes('TypedAssistantMessage'), 'tw ok']);
  checks.push(['思考气泡轮播 + 跳动点', chatSrc.includes('THINKING_STEPS') && chatSrc.includes('animate-bounce'), 'thinking ok']);

  const twSrc = readFileSync(resolve(root, 'src', 'hooks', 'use-typewriter.ts'), 'utf-8');
  checks.push(['useTypewriter 无 lint 残留', !twSrc.includes('eslint-disable'), 'tw lint ok']);

  const themeCss2 = readFileSync(resolve(root, 'src', 'tailwind-theme.css'), 'utf-8');
  checks.push(['执行图动画 CSS（流动/回退/呼吸）', themeCss2.includes('agent-flow-dash') && themeCss2.includes('agent-flow-rework-blink') && themeCss2.includes('agent-flow-active-pulse'), 'flow css ok']);

  // 11d. 对战舞台 + 雷达扫光 + 造价大屏数字
  const debateSrc = readFileSync(resolve(root, 'src', 'components', 'DebatePanel.tsx'), 'utf-8');
  checks.push(['辩论卡 3D 翻转入场（rotateY+透视）', debateSrc.includes('rotateY: -28') && debateSrc.includes('rotateY: 28') && debateSrc.includes('transformPerspective'), '3d flip ok']);
  checks.push(['仲裁锤 Gavel 居中', debateSrc.includes('Gavel') && debateSrc.includes('justify-center'), 'gavel ok']);

  const cmpSrc = readFileSync(resolve(root, 'src', 'pages', 'HomePage', 'sections', 'ComparisonSection.tsx'), 'utf-8');
  checks.push(['雷达 tooltip 维度数值 formatter', cmpSrc.includes("RADAR_DIMENSIONS.map((d, i)") && cmpSrc.includes('rows.join'), 'radar tooltip ok']);
  checks.push(['雷达 hover 强调（线宽/顶点光晕）', cmpSrc.includes('emphasis: {') && cmpSrc.includes('shadowBlur'), 'radar emphasis ok']);
  checks.push(['雷达极坐标网格增强', cmpSrc.includes("'rgba(15,76,129,0.28)'"), 'radar grid ok']);
  checks.push(['造价大屏数字（CountUp+font-mono+色块）', cmpSrc.includes('CountUpOnView') && cmpSrc.includes('text-[52px]') && cmpSrc.includes('border-primary/25'), 'big cost ok']);
  checks.push(['预算对比绿/红着色', cmpSrc.includes('低于预算') && cmpSrc.includes('超出预算'), 'budget color ok']);

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
const r5 = await scenarioHitl();
const r6 = await scenarioChiefStructured();
const r7 = await scenarioKnowledge();
const r8 = await scenarioHistory();
const r9 = await scenarioNewFeatures();
const r10 = await scenarioModelExport();
const r11 = await scenarioUiHealth();

console.log(`\n---- 汇总：场景1 ${r1.pass}/${r1.total} · 场景2 ${r2.pass}/${r2.total} · 场景3 ${r3.pass}/${r3.total} · 场景4 ${r4.pass}/${r4.total} · 场景5 ${r5.pass}/${r5.total} · 场景6 ${r6.pass}/${r6.total} · 场景7 ${r7.pass}/${r7.total} · 场景8 ${r8.pass}/${r8.total} · 场景9 ${r9.pass}/${r9.total} · 场景10 ${r10.pass}/${r10.total} · 场景11 ${r11.pass}/${r11.total} ----`);
if (r1.ok && r2.ok && r3.ok && r4.ok && r5.ok && r6.ok && r7.ok && r8.ok && r9.ok && r10.ok && r11.ok) {
  console.log('🎯 真实模式专项验证全部通过：回退闭环 + 崩溃降级 + 乱序零错位 + 自动重试 + 人类在环 + Chief结构化 + 知识库追溯 + 历史版本 + 辩论提取 + 意图归一 + 碳排构成 + PKPM/YJK模型导出 + UI体检');
  process.exit(0);
} else {
  console.log('⚠️ 存在失败项，见上方 ❌');
  process.exit(1);
}
