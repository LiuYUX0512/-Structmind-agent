// ============================================================
// 智构 StructMind · DAG 引擎回归（模块①）
//
// 核心目标：证明 dynamic 模式（DAG 调度器）与 static 模式（旧四阶段）
// 在相同输入下产出**逐字段一致**的结果（影子并行）。
//
// 覆盖两个维度：
//   A. DagScheduler 引擎单元测试（拓扑排序 / 条件跳过 / 递归重规划 / 上限保护）
//   B. 端到端一致性：static vs dynamic 在 trace 与 real 两种推理模式下逐字段相等
//
// 运行：node scripts/verify-dag-out/verify-dag.js
// ============================================================
import { runAgentPipeline } from '../src/agent/pipeline';
import { DagScheduler, type ITaskNode, type IReplanInstruction } from '../src/agent/dag-engine';
import { Planner } from '../src/agent/planner';
import { scopedStorage } from '@lark-apaas/client-toolkit-lite';
import type { IProjectParams } from '../src/data/structure';

const checks: Array<[string, boolean, string]> = [];
const push = (name: string, ok: boolean, detail = '') => checks.push([name, ok, detail]);

// ============ A. 调度器单元测试（与业务无关） ============

// A1：拓扑排序 —— deps 未满足的节点不会先执行
{
  const order: string[] = [];
  const nodes: ITaskNode<null>[] = [
    { id: 'a', label: 'A', deps: [], run: async () => { order.push('a'); } },
    { id: 'c', label: 'C', deps: ['b'], run: async () => { order.push('c'); } },
    { id: 'b', label: 'B', deps: ['a'], run: async () => { order.push('b'); } },
  ];
  const s = new DagScheduler<null>();
  const r = await s.run(nodes, null);
  push('A1 拓扑排序：依赖未满足的节点不会先执行', JSON.stringify(order) === JSON.stringify(['a', 'b', 'c']), order.join('→'));
}

// A2：条件跳过 —— when 返回 false 的节点被 skipped，下游仍可执行
{
  const order: string[] = [];
  const nodes: ITaskNode<null>[] = [
    { id: 'a', label: 'A', deps: [], run: async () => { order.push('a'); } },
    { id: 'b', label: 'B', deps: ['a'], when: () => false, run: async () => { order.push('b'); } },
    { id: 'c', label: 'C', deps: ['b'], run: async () => { order.push('c'); } },
  ];
  const s = new DagScheduler<null>();
  const r = await s.run(nodes, null);
  push('A2 条件跳过：when=false 跳过 b，下游 c 仍执行', r.skipped.includes('b') && order.join(',') === 'a,c', `skipped=${r.skipped.join(',')} order=${order.join(',')}`);
}

// A3：递归重规划 —— 节点返回 replan 指令，新节点插入指定位置之前
{
  const order: string[] = [];
  const nodes: ITaskNode<null>[] = [
    { id: 'a', label: 'A', deps: [], run: async () => { order.push('a'); } },
    {
      id: 'b', label: 'B', deps: ['a'],
      run: async (): Promise<unknown | IReplanInstruction<null>> => {
        order.push('b');
        return {
          __replan: true,
          insertBefore: 'd',
          reason: 'B 触发重规划',
          nodes: [
            { id: 'x', label: 'X', deps: ['b'], run: async () => { order.push('x'); } },
            { id: 'y', label: 'Y', deps: ['x'], run: async () => { order.push('y'); } },
          ],
        };
      },
    },
    { id: 'd', label: 'D', deps: ['b'], run: async () => { order.push('d'); } },
  ];
  const s = new DagScheduler<null>();
  const r = await s.run(nodes, null);
  push('A3 递归重规划：新节点 x→y 插入 d 之前', order.join(',') === 'a,b,x,y,d', `${order.join(',')} replan=${r.replanCount}`);
  push('A4 重规划理由被记录', r.replanReasons.length === 1 && r.replanReasons[0].includes('B 触发'), r.replanReasons.join('|'));
}

// A5：重规划上限保护 —— 每个新节点都递归 replan，形成真正死循环
{
  let count = 0;
  const makeLoop = (deps: string[]): ITaskNode<null> => {
    const myId = `loop-${count}`;
    count++;
    return {
      id: myId,
      label: 'L',
      deps,
      run: async (): Promise<unknown | IReplanInstruction<null>> => {
        return {
          __replan: true,
          insertBefore: 'end',
          reason: '死循环',
          nodes: [makeLoop([myId])],
        };
      },
    };
  };
  const nodes: ITaskNode<null>[] = [makeLoop([]), { id: 'end', deps: [], run: async () => { } }];
  const s = new DagScheduler<null>({ maxReplans: 3 });
  let threw = false;
  try {
    await s.run(nodes, null);
  } catch (e) {
    threw = /重规划次数超过上限/.test((e as Error).message);
  }
  push('A5 重规划上限保护：超过 maxReplans 抛错', threw, `count=${count}`);
}

// A6：失败即抛 —— 节点 run 抛错向上传播（不吞错）
{
  const nodes: ITaskNode<null>[] = [
    { id: 'a', label: 'A', deps: [], run: async () => { throw new Error('boom'); } },
  ];
  const s = new DagScheduler<null>();
  let threw = false;
  try {
    await s.run(nodes, null);
  } catch (e) {
    threw = (e as Error).message === 'boom';
  }
  push('A6 失败即抛：节点异常向上传播', threw, '');
}

// A7：依赖重定向 —— 重规划后下游节点 deps 指向最新节点（不读废弃结果）
{
  let observedDeps: string[] = [];
  let readValue = '';
  let shared = '';
  const nodes: ITaskNode<null>[] = [
    {
      id: 'a', label: 'A', deps: [],
      run: async () => { shared = 'A-首轮(废弃)'; },
    },
    {
      id: 'b', label: 'B', deps: ['a'],
      run: async (): Promise<unknown | IReplanInstruction<null>> => ({
        __replan: true,
        insertBefore: 'c',
        reason: 'b 触发重规划',
        redirects: [{ from: 'a', to: 'a-r1' }, { from: 'b', to: 'b-r1' }],
        nodes: [
          { id: 'a-r1', label: 'A重出', deps: ['b'], run: async () => { shared = 'A-重出(最新)'; } },
          { id: 'b-r1', label: 'B复核', deps: ['a-r1'], run: async () => { } },
        ],
      }),
    },
  ];
  const cNode: ITaskNode<null> = {
    id: 'c', label: 'C', deps: ['a', 'b'],
    run: async () => { observedDeps = [...(cNode.deps ?? [])]; readValue = shared; },
  };
  nodes.push(cNode);

  const s = new DagScheduler<null>();
  const r = await s.run(nodes, null);
  push('A7 依赖重定向：下游 deps 指向最新节点（非废弃首轮）', JSON.stringify(observedDeps) === JSON.stringify(['a-r1', 'b-r1']), observedDeps.join(','));
  push('A8 依赖重定向：下游读到最新结果', readValue === 'A-重出(最新)' && r.executed.join(',') === 'a,b,a-r1,b-r1,c', `read=${readValue} exec=${r.executed.join(',')}`);
}

// ============ B. Planner 默认模板 ============

{
  const plan = new Planner().buildPlan({
    params: { buildingType: 'residential', floors: 8, area: 12000 } as IProjectParams,
    weights: { cost: 25, duration: 25, safety: 25, green: 25 },
    realMode: true,
    allowRecheck: true,
  });
  const ids = plan.map((n) => n.id).join(',');
  push('B1 Planner 默认模板 = 旧四阶段拓扑', ids === 'architect,code,economist,chief', ids);
  const codeNode = plan.find((n) => n.id === 'code');
  const chiefNode = plan.find((n) => n.id === 'chief');
  const econNode = plan.find((n) => n.id === 'economist');
  push('B2 依赖显式化：chief 依赖 code+economist', JSON.stringify(chiefNode?.deps) === JSON.stringify(['code', 'economist']), JSON.stringify(chiefNode?.deps));
  push('B3 时序对齐：economist 依赖 architect+code（校核后评估）', JSON.stringify(econNode?.deps) === JSON.stringify(['architect', 'code']), JSON.stringify(econNode?.deps));
  push('B3b code 依赖 architect', JSON.stringify(codeNode?.deps) === JSON.stringify(['architect']), JSON.stringify(codeNode?.deps));
}

// ============ C. 端到端一致性：static vs dynamic（trace 模式） ============

const TRACE_PARAMS: IProjectParams = {
  buildingType: 'residential',
  floors: 20,
  area: 15000,
  mainSpan: 8.4,
  seismicIntensity: '8',
  soilCategory: 'Ⅱ',
  budget: 4500,
};

async function runTraceStatic() {
  return runAgentPipeline(TRACE_PARAMS, undefined, { mode: 'trace', plannerMode: 'static', maxSteps: 20 });
}
async function runTraceDynamic() {
  return runAgentPipeline(TRACE_PARAMS, undefined, { mode: 'trace', plannerMode: 'dynamic', maxSteps: 20 });
}

{
  const s = await runTraceStatic();
  const d = await runTraceDynamic();
  const sKey = JSON.stringify(sortResult(s));
  const dKey = JSON.stringify(sortResult(d));
  push('C1 trace 模式：static 与 dynamic 输出逐字段一致', sKey === dKey, sKey === dKey ? '完全一致' : '存在差异，见下方 diff');
  if (sKey !== dKey) {
    console.log('  static 推荐:', JSON.stringify(s.recommended));
    console.log('  dynamic 推荐:', JSON.stringify(d.recommended));
  }
}

// ============ D. 端到端一致性：static vs dynamic（real 模式，Mock LLM） ============

// 预置引擎配置 + Mock LLM（复用 verify-entry 的 Mock 策略）
scopedStorage.setItem(
  'agent_engine_config',
  JSON.stringify({ endpoint: 'https://api.deepseek.com/v1', apiKey: 'sk-mock-not-real', model: 'deepseek-chat' })
);

let callSeq = 0;
const toolCall = (name: string, args: Record<string, unknown>) => ({
  id: `call_${++callSeq}`,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});
const lastUser = (messages: any[]) => [...messages].reverse().find((m: any) => m.role === 'user')?.content || '';
const whichAgent = (messages: any[]): string => {
  const u = lastUser(messages);
  if (u.includes('compare_schemes 工具进行综合对比评分')) return 'chief';
  if (u.includes('estimate_cost、estimate_schedule、estimate_precast_rate、estimate_carbon、assess_construction_risk 工具进行经济与绿色指标评估')) return 'economist';
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
        if (Array.isArray(parsed.candidates)) parsed.candidates.forEach((c: any) => { if (c?.id) out.push(c.id); });
      } catch { /* ignore */ }
    }
  }
  if (out.length > 0) return [...new Set(out)];
  const u = lastUser(messages);
  const re = /[（(]([a-z][a-z0-9-]*)[）)]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(u))) {
    if (!['residential', 'office', 'school', 'factory', 'gymnasium'].includes(m[1])) out.push(m[1]);
  }
  return [...new Set(out)];
};

// D 簇：验证「无记忆命中」时 static 与 dynamic 逐字段一致（影子并行）。
// 用 7 度避免命中冷启动默认经验（default-precheck-high-intensity 的触发条件为
// seismicIntensity >= 8 && realMode），保证 dynamic 的 plan = 默认模板。
// 「经验命中 → 插入预校核」这一 dynamic 的故意增强由 verify-memory 的 C 簇覆盖。
const REAL_PARAMS: IProjectParams = {
  buildingType: 'residential',
  floors: 8,
  area: 12000,
  mainSpan: 8.4,
  seismicIntensity: '7',
  soilCategory: 'Ⅱ',
  budget: 2800,
};

const buildMockResponse = (messages: any[]): any => {
  const agent = whichAgent(messages);
  const candidates = extractCandidates(messages);
  if (agent === 'architect') {
    return messages.some((m: any) => m.role === 'tool')
      ? { role: 'assistant', content: '方案选型结论：建议采用框架、框架-剪力墙、钢结构作为候选。' }
      : { role: 'assistant', content: null, tool_calls: [toolCall('query_structure_systems', { filters: { buildingType: 'residential', floors: 8, seismicIntensity: '8', mainSpan: 8.4, budget: 2800 } })] };
  }
  if (agent === 'code') {
    if (!messages.some((m: any) => m.role === 'tool')) {
      const calls: any[] = [];
      for (const id of candidates) {
        calls.push(toolCall('check_seismic_requirements', { systemId: id, params: { floors: 8, seismicIntensity: '8', soilCategory: 'Ⅱ', buildingType: 'residential' } }));
        calls.push(toolCall('check_fire_requirements', { systemId: id, floors: 8, buildingType: 'residential' }));
      }
      return { role: 'assistant', content: null, tool_calls: calls };
    }
    return { role: 'assistant', content: '规范校核结论：三候选均满足要求，无强条违反。' };
  }
  if (agent === 'economist') {
    const toolCount = messages.filter((m: any) => m.role === 'tool').length;
    if (toolCount === 0) {
      const calls: any[] = [];
      for (const id of candidates) {
        calls.push(toolCall('estimate_cost', { systemId: id, floors: 8, seismicIntensity: '8', soilCategory: 'Ⅱ', mainSpan: 8.4 }));
        calls.push(toolCall('estimate_schedule', { systemId: id, area: 12000, floors: 8 }));
        calls.push(toolCall('estimate_precast_rate', { systemId: id, floors: 8 }));
      }
      return { role: 'assistant', content: null, tool_calls: calls };
    }
    if (toolCount === candidates.length * 3) {
      const calls: any[] = [];
      for (const id of candidates) {
        calls.push(toolCall('estimate_carbon', { systemId: id, floors: 8 }));
        calls.push(toolCall('assess_construction_risk', { systemId: id, floors: 8 }));
      }
      return { role: 'assistant', content: null, tool_calls: calls };
    }
    return { role: 'assistant', content: '经济评估结论：框架-剪力墙经济性最优。' };
  }
  if (agent === 'chief') {
    if (!messages.some((m: any) => m.role === 'tool')) {
      return { role: 'assistant', content: null, tool_calls: [toolCall('compare_schemes', { schemeIds: candidates, params: REAL_PARAMS, weights: { cost: 25, duration: 25, safety: 25, green: 25 } })] };
    }
    return { role: 'assistant', content: `# 综合评审结论\n## 1. 综合推荐方案及排序\n推荐框架-剪力墙结构。\n## 2. 推荐理由\n- 抗震性能优\n- 造价适中\n- 施工成熟\n## 4. 🤔 总工反思（Reflection）\n### 4.1 反向质疑\n高层框架可能位移超限。\n### 4.2 置信度自评\n置信度：中。\n### 4.3 遗漏检查\n未考虑液化。\n### 4.4 改进方向\n补充基础比选。\n## 5. ⚠️ 风险提示\n施工缝是关键风险。\n## 6. 下一步优化建议\n- 优化剪力墙布置` };
  }
  return { role: 'assistant', content: '（未知任务）' };
};

globalThis.fetch = (async (_input: any, init?: any) => {
  const body = JSON.parse(String(init?.body));
  const message = buildMockResponse(body.messages);
  return new Response(JSON.stringify({ choices: [{ message }], usage: { total_tokens: 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;

{
  const s = await runAgentPipeline(REAL_PARAMS, undefined, { mode: 'real', plannerMode: 'static', endpoint: 'https://api.deepseek.com/v1', apiKey: 'sk-mock-not-real', model: 'deepseek-chat', maxSteps: 20 });
  const d = await runAgentPipeline(REAL_PARAMS, undefined, { mode: 'real', plannerMode: 'dynamic', endpoint: 'https://api.deepseek.com/v1', apiKey: 'sk-mock-not-real', model: 'deepseek-chat', maxSteps: 20 });
  const sKey = JSON.stringify(sortResult(s));
  const dKey = JSON.stringify(sortResult(d));
  push('D1 real 模式：static 与 dynamic 输出逐字段一致', sKey === dKey, sKey === dKey ? '完全一致' : '存在差异');
  push('D2 real 模式：dynamic 的推荐方案与 static 相同', s.recommended.schemeId === d.recommended.schemeId, `${s.recommended.schemeId} vs ${d.recommended.schemeId}`);
}

// ============ 工具：结果排序（actionLog 时间戳不同 → 去掉时间戳再比较） ============

function sortResult(r: Awaited<ReturnType<typeof runAgentPipeline>>): unknown {
  return {
    schemes: r.schemes.map((s) => s.id),
    recommended: {
      schemeId: r.recommended.schemeId,
      schemeName: r.recommended.schemeName,
      overallScore: Math.round(r.recommended.overallScore * 100) / 100,
      decisionSource: r.recommended.decisionSource ?? null,
    },
    ranking: r.ranking.map((x) => ({ schemeId: x.schemeId, score: Math.round(x.score * 100) / 100 })),
    codeChecks: r.codeChecks,
    metrics: r.metrics,
    advice: r.advice,
    // actionLog 含时间戳与 toolCallId（每次运行自增），比较其「结构」而非逐字节
    actionLogShape: r.actionLog.map((l) => ({ type: l.type, agent: l.agent, tool: l.tool ?? null })),
    conclusions: r.conclusions,
    degraded: r.degraded ?? null,
  };
}

// ============ 输出 ============
let passed = 0;
console.log('\n=== DAG 引擎回归（模块①）===\n');
for (const [name, ok, detail] of checks) {
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  [${detail}]` : ''}`);
}
console.log(`\n通过 ${passed}/${checks.length}\n`);
if (passed !== checks.length) process.exit(1);
