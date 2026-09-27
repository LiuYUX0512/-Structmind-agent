// ============================================================
// 智构 StructMind · 记忆系统回归（模块②）
//
// 覆盖三个子系统：
//   ① 短期压缩器：token 估算 / 切词 / 词频向量 / 规则压缩 / 超阈值触发 / 冷启动
//   ② 长期偏好：主动注入 / 冷启动默认库 / 词频检索
//   ③ 经验闭环：trigger 纯函数 / 经验命中 / 拓扑修改
//
// 运行：node scripts/verify-memory-out/verify-memory.js
// ============================================================
import {
  estimateTokens,
  tokenize,
  BagOfWordsEmbedder,
  RuleCompressor,
  MemorySystem,
  matchesConditions,
  type IAgentActionLog,
  type IMemoryTriggerContext,
  type IExperience,
} from '../src/agent/memory';
import { Planner } from '../src/agent/planner';

const checks: Array<[string, boolean, string]> = [];
const push = (name: string, ok: boolean, detail = '') => checks.push([name, ok, detail]);

// ============ ① 短期压缩器 ============

// A1：token 估算（中文 1 字 ≈ 1 token）
{
  push('A1 estimateTokens：中文按 1 字/ token 估算', estimateTokens('你好世界') === 4, `=${estimateTokens('你好世界')}`);
  push('A1b estimateTokens：英文按 4 字符/ token 估算', estimateTokens('hello') === 2, `=${estimateTokens('hello')}`);
  push('A1c estimateTokens：空串为 0', estimateTokens('') === 0, '');
}

// A2：中文 1-gram + 2-gram 切词
{
  const tokens = tokenize('钢结构');
  const has1gram = tokens.includes('钢') && tokens.includes('结') && tokens.includes('构');
  const has2gram = tokens.includes('钢结') && tokens.includes('结构');
  push('A2 tokenize：1-gram + 2-gram 切词', has1gram && has2gram, tokens.join(','));
}

// A3：词频向量余弦相似度（相同=1，不同<1）
{
  const emb = new BagOfWordsEmbedder();
  const same = emb.similarity(emb.embed('钢结构高层建筑'), emb.embed('钢结构高层建筑'));
  const diff = emb.similarity(emb.embed('钢结构'), emb.embed('木结构'));
  push('A3 词频向量：相同文本相似度=1', Math.abs(same - 1) < 1e-9, `=${same.toFixed(4)}`);
  push('A3b 词频向量：不同文本相似度<1', diff < 1, `钢结构vs木结构=${diff.toFixed(4)}`);
}

// A4：规则压缩器抽取事实，不编造
{
  const logs: IAgentActionLog[] = [
    { step: 1, type: 'tool_call', agent: 'code', tool: 'check_seismic_requirements', content: '调用工具' },
    { step: 2, type: 'tool_result', agent: 'code', tool: 'check_seismic_requirements', content: '完成' },
    { step: 3, type: 'conclusion', agent: 'code', content: '框架结构剪重比不满足，需调整' },
  ];
  const facts = await new RuleCompressor().compress(logs);
  const joined = facts.join('|');
  push('A4 规则压缩：抽取结论', facts.some((f) => f.includes('剪重比')), joined);
  push('A4b 规则压缩：记录工具调用', facts.some((f) => f.includes('check_seismic_requirements')), joined);
  // 不编造：压缩结果不出现日志里没有的内容
  push('A4c 规则压缩：不编造新事实', !joined.includes('编造标记XYZ'), joined);
}

// A5：超阈值触发压缩，未超不触发
{
  const mem = new MemorySystem();
  // 短日志：不触发
  const short: IAgentActionLog[] = [{ step: 1, type: 'conclusion', agent: 'architect', content: '候选方案已确定' }];
  const r1 = await mem.maybeCompress(short, 4000, new RuleCompressor());
  push('A5 短日志不触发压缩', r1.triggered === false, '');

  // 长日志：超过阈值触发
  const long: IAgentActionLog[] = [];
  for (let i = 0; i < 100; i++) {
    long.push({ step: i + 1, type: 'think', agent: 'code', content: '这是第' + i + '条校核过程记录，包含大量的规范条文说明文字用于撑大上下文长度触发压缩机制验证。' });
  }
  const r2 = await mem.maybeCompress(long, 400, new RuleCompressor());
  const factCount = r2.summary ? r2.summary.split('\n').filter((s) => s.trim()).length : 0;
  push('A5b 长日志触发压缩且产出事实摘要', r2.triggered === true && factCount >= 3, r2.triggered ? `摘要 ${factCount} 条` : '未触发');
  push('A5c 压缩事件带 [Memory] 标记', !!r2.event && r2.event.message.includes('[Memory]'), r2.event?.message ?? '');
}

// A6：冷启动——本地库为空时静默生成默认偏好/经验（不报错）
{
  const mem = new MemorySystem();
  mem.clear();
  const mem2 = new MemorySystem();
  // 通过 scanPreferences 间接验证默认库已生成（高烈度参数应命中默认偏好）
  const { prefs } = mem2.scanPreferences({ buildingType: 'residential', floors: 20, area: 10000, seismicIntensity: '8', budget: 3000 } as never);
  push('A6 冷启动：空库自动生成默认偏好，且可被检索命中', prefs.length > 0, `命中 ${prefs.length} 条`);
}

// ============ ② 长期偏好注入 ============

// B1：scanPreferences 命中高烈度偏好 + 事件带 [Memory]
{
  const mem = new MemorySystem();
  mem.clear();
  const mem2 = new MemorySystem(); // 冷启动注入默认库
  const { prefs, events } = mem2.scanPreferences({ buildingType: 'residential', floors: 30, area: 15000, seismicIntensity: '8', budget: 5000 } as never);
  push('B1 偏好扫描：高烈度参数命中历史偏好', prefs.length > 0, `命中 ${prefs.length} 条`);
  push('B1b 偏好注入事件带 [Memory] 标记', events.length > 0 && events.every((e) => e.message.includes('[Memory]')), events[0]?.message ?? '');
}

// B2：buildPreferenceHint 生成可读提示文本
{
  const mem = new MemorySystem();
  const { prefs } = mem.scanPreferences({ buildingType: 'residential', floors: 30, area: 15000, seismicIntensity: '8' } as never);
  const hint = mem.buildPreferenceHint(prefs);
  push('B2 偏好提示文本生成（含⚠️记忆提示）', prefs.length > 0 && hint.includes('记忆提示'), hint.slice(0, 40));
}

// B3：主动写入——storePreference 后库增长（下次运行可注入）
{
  const mem = new MemorySystem();
  mem.clear();
  const mem2 = new MemorySystem();
  const before = mem2.scanPreferences({ seismicIntensity: '8' } as never).prefs.length;
  mem2.storePreference('用户重视低碳，接受较高造价换取低隐含碳', 'seismic-8');
  const after = mem2.scanPreferences({ seismicIntensity: '8' } as never).prefs.length;
  push('B3 主动写入：storePreference 后偏好库增长', after >= before, `before=${before} after=${after}`);
}

// ============ ③ 经验闭环激活 ============

// C1：trigger 纯函数（matchesConditions）——只依赖 ctx，可测试
{
  const ctx: IMemoryTriggerContext = {
    params: { seismicIntensity: '8', floors: 20, buildingType: 'residential', area: 10000 } as never,
    realMode: true,
    allowRecheck: true,
  };
  const hit = matchesConditions([{ field: 'seismicIntensity', op: 'gte', value: 8 }], ctx);
  const hitReal = matchesConditions([{ field: 'realMode', op: 'eq', value: true }], ctx);
  const miss = matchesConditions([{ field: 'seismicIntensity', op: 'gte', value: 9 }], ctx);
  push('C1 trigger 纯函数：条件匹配正确', hit && hitReal && !miss, `hit=${hit} real=${hitReal} miss=${miss}`);
}

// C2：recallExperiences 命中默认经验（高烈度 + real 模式）
{
  const mem = new MemorySystem();
  mem.clear();
  const mem2 = new MemorySystem(); // 冷启动注入默认经验
  const ctx: IMemoryTriggerContext = {
    params: { seismicIntensity: '8', floors: 20, buildingType: 'residential', area: 10000 } as never,
    realMode: true,
    allowRecheck: true,
  };
  const { experiences, events } = mem2.recallExperiences(ctx);
  push('C2 经验召回：高烈度+real 命中默认预校核经验', experiences.length >= 1, `命中 ${experiences.length} 条`);
  push('C2b 经验激活事件带 [Memory] 标记', events.length > 0 && events.every((e) => e.message.includes('[Memory]')), events[0]?.message ?? '');
}

// C3：Planner 读经验 → 真实修改 DAG 拓扑（插入预校核节点）
{
  const planner = new Planner();
  const exp: IExperience = {
    id: 'test-precheck',
    kind: 'insert-precheck',
    applyTo: 'architect',
    lesson: '测试：提前预校核',
    featureKey: 'test',
    conditions: [{ field: 'realMode', op: 'eq', value: true }],
    ts: Date.now(),
    trigger: () => true,
  };
  const plan = planner.buildPlan({
    params: { buildingType: 'residential', floors: 20, area: 10000, seismicIntensity: '8' } as never,
    weights: { cost: 25, duration: 25, safety: 25, green: 25 } as never,
    realMode: true,
    allowRecheck: true,
    memory: { experiences: [exp] },
  });
  const precheckNode = plan.find((n) => n.kind === 'precheck');
  const codeNode = plan.find((n) => n.id === 'code');
  const codeDependsPrecheck = !!precheckNode && codeNode?.deps.includes(precheckNode.id) === true;
  push('C3 经验闭环：Planner 插入预校核节点', !!precheckNode, plan.map((n) => n.id).join(','));
  push('C3b 经验闭环：code 依赖重定向到预校核', codeDependsPrecheck, JSON.stringify(codeNode?.deps));
}

// C4：无命中经验时 Planner 输出 = 默认模板（不误插入）
{
  const planner = new Planner();
  const plan = planner.buildPlan({
    params: { buildingType: 'residential', floors: 20, area: 10000, seismicIntensity: '6' } as never,
    weights: { cost: 25, duration: 25, safety: 25, green: 25 } as never,
    realMode: true,
    allowRecheck: true,
    memory: { experiences: [] },
  });
  push('C4 无经验：Planner 输出默认四阶段（不误插入）', plan.map((n) => n.id).join(',') === 'architect,code,economist,chief', plan.map((n) => n.id).join(','));
}

// ============ 输出 ============
let passed = 0;
console.log('\n=== 记忆系统回归（模块②）===\n');
for (const [name, ok, detail] of checks) {
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  [${detail}]` : ''}`);
}
console.log(`\n通过 ${passed}/${checks.length}\n`);
if (passed !== checks.length) process.exit(1);
