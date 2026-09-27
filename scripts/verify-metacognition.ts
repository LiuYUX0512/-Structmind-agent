// ============================================================
// 智构 StructMind · 元认知回归（模块③）
//
// 覆盖：轨迹指标提取 / 结构化反思生成（RuleReflector）/ LlmReflector 降级 /
//       反思→经验转换 / 闭环写入经验库 / 下次 Planner 读取并修改拓扑
//
// 运行：node scripts/verify-metacognition-out/verify-metacognition.js
// ============================================================
import { RuleReflector, LlmReflector, reflectionToExperience } from '../src/agent/metacognition';
import { MemorySystem } from '../src/agent/memory';
import { Planner } from '../src/agent/planner';
import type { ITrajectoryMetrics, IStrategyReflection } from '../src/agent/types';

const checks: Array<[string, boolean, string]> = [];
const push = (name: string, ok: boolean, detail = '') => checks.push([name, ok, detail]);

// ============ A. RuleReflector 规则反思 ============

// A1：回退循环 > 0 → 提前预校核教训（applyTo=planner）
{
  const r = await new RuleReflector().reflect({
    totalLoops: 3, nodeDurations: { architect: 1000, code: 2000 }, degraded: false,
    tokenEstimate: 3000, toolCallCount: 20, replanCount: 3,
  });
  push('A1 回退循环>0 → applyTo=planner（提前预校核）', r.applyTo === 'planner' && r.lesson.includes('预校核'), `${r.applyTo}: ${r.lesson.slice(0, 30)}`);
  push('A1b 反思含观察/归因/教训/触发四字段', !!(r.observation && r.diagnosis && r.lesson && r.trigger), '');
}

// A2：某节点耗时 > 5s → applyTo=tool
{
  const r = await new RuleReflector().reflect({
    totalLoops: 0, nodeDurations: { architect: 8000, code: 1000 }, degraded: false,
    tokenEstimate: 3000, toolCallCount: 20, replanCount: 0,
  });
  push('A2 节点耗时>5s → applyTo=tool', r.applyTo === 'tool' && r.lesson.includes('优化'), `${r.applyTo}: ${r.lesson.slice(0, 30)}`);
}

// A3：降级 → applyTo=tool
{
  const r = await new RuleReflector().reflect({
    totalLoops: 0, nodeDurations: { architect: 1000 }, degraded: true,
    tokenEstimate: 3000, toolCallCount: 5, replanCount: 0,
  });
  push('A3 降级 → 检查配置教训', r.applyTo === 'tool' && r.observation.includes('降级'), r.observation.slice(0, 30));
}

// A4：健康 → applyTo=prompt
{
  const r = await new RuleReflector().reflect({
    totalLoops: 0, nodeDurations: { architect: 1000, code: 1000 }, degraded: false,
    tokenEstimate: 3000, toolCallCount: 10, replanCount: 0,
  });
  push('A4 运行健康 → applyTo=prompt（无需调整）', r.applyTo === 'prompt', r.applyTo);
}

// ============ B. LlmReflector 降级 ============

// B1：LLM 返回合法 JSON → 解析出结构化反思
{
  const summarize = async () => JSON.stringify({ observation: 'o', diagnosis: 'd', lesson: 'l', applyTo: 'planner', trigger: 't' });
  const r = await new LlmReflector(summarize).reflect({ totalLoops: 1, nodeDurations: {}, degraded: false, tokenEstimate: 100, toolCallCount: 1, replanCount: 1 });
  push('B1 LlmReflector 解析合法 JSON', r.applyTo === 'planner' && r.lesson === 'l', JSON.stringify(r));
}

// B2：LLM 返回非法 → 降级为规则反思（不抛错）
{
  const summarize = async () => '这不是 JSON';
  const r = await new LlmReflector(summarize).reflect({ totalLoops: 2, nodeDurations: {}, degraded: false, tokenEstimate: 100, toolCallCount: 1, replanCount: 2 });
  push('B2 LlmReflector 非法输出降级为规则反思', r.applyTo === 'planner' && !!r.lesson, r.applyTo);
}

// B3：LLM 抛错 → 降级（不阻断）
{
  const summarize = async () => { throw new Error('network'); };
  const r = await new LlmReflector(summarize).reflect({ totalLoops: 0, nodeDurations: { x: 1 }, degraded: false, tokenEstimate: 100, toolCallCount: 1, replanCount: 0 });
  push('B3 LlmReflector 抛错降级为规则反思', !!r.observation && !!r.lesson, r.applyTo);
}

// ============ C. 闭环激活：反思 → 经验 → 下次 Planner 修改拓扑 ============

// C1：reflectionToExperience 把 planner 教训转成 insert-precheck 经验
{
  const reflection: IStrategyReflection = {
    observation: '回退循环空转', diagnosis: '预校核缺失', lesson: '选型后立即预校核', applyTo: 'planner', trigger: '高烈度',
  };
  const exp = reflectionToExperience(reflection, {
    params: { seismicIntensity: '8', floors: 20, buildingType: 'residential', area: 10000 } as never,
    realMode: true, allowRecheck: true,
  });
  push('C1 反思→经验：applyTo=planner 转 insert-precheck', !!exp && exp.kind === 'insert-precheck' && exp.applyTo === 'architect', exp ? exp.kind : 'null');
  // applyTo=tool 不转经验
  const exp2 = reflectionToExperience({ ...reflection, applyTo: 'tool' }, { params: { seismicIntensity: '8' } as never, realMode: true, allowRecheck: true });
  push('C1b 反思→经验：applyTo=tool 不转拓扑经验', exp2 === null, '');
}

// C2：闭环——storeExperience 后 recallExperiences 读回，Planner 修改拓扑
{
  const mem = new MemorySystem();
  mem.clear();
  const mem2 = new MemorySystem();
  const reflection: IStrategyReflection = {
    observation: '回退空转', diagnosis: '缺预校核', lesson: '高烈度区选型后立即预校核', applyTo: 'planner', trigger: '高烈度',
  };
  const exp = reflectionToExperience(reflection, {
    params: { seismicIntensity: '8', floors: 20, buildingType: 'residential', area: 10000 } as never,
    realMode: true, allowRecheck: true,
  });
  if (exp) mem2.storeExperience(exp);

  const ctx = { params: { seismicIntensity: '8', floors: 20, buildingType: 'residential', area: 10000 } as never, realMode: true, allowRecheck: true };
  const { experiences } = mem2.recallExperiences(ctx);
  push('C2 闭环：storeExperience 后 recall 读回反思经验', experiences.some((e) => e.lesson.includes('预校核')), `命中 ${experiences.length} 条`);

  // 下次 Planner 读取并真实修改拓扑
  const planner = new Planner();
  const plan = planner.buildPlan({
    params: { buildingType: 'residential', floors: 20, area: 10000, seismicIntensity: '8' } as never,
    weights: { cost: 25, duration: 25, safety: 25, green: 25 } as never,
    realMode: true, allowRecheck: true,
    memory: { experiences },
  });
  const hasPrecheck = plan.some((n) => n.kind === 'precheck');
  push('C2b 闭环：下次 Planner 真实插入预校核节点', hasPrecheck, plan.map((n) => n.id).join(','));
}

// ============ 输出 ============
let passed = 0;
console.log('\n=== 元认知回归（模块③）===\n');
for (const [name, ok, detail] of checks) {
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  [${detail}]` : ''}`);
}
console.log(`\n通过 ${passed}/${checks.length}\n`);
if (passed !== checks.length) process.exit(1);
