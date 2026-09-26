// ============================================================
// 智构 StructMind · 真实模式管线本地端到端验证
// 用 Mock LLM（模拟 DeepSeek function calling 响应序列）驱动
// 完整四 Agent 管线：工具调用 / 日志配对 / 逐步回调 / 评分 / advice 提取
// 运行：node scripts/verify-out/index.js
// ============================================================
import { scopedStorage } from '@lark-apaas/client-toolkit-lite';
import { runAgentPipeline } from '../src/agent/pipeline';
import type { IProjectParams } from '../src/data/structure';
import type { IAgentActionLog } from '../src/agent/types';

// ---------- 1. 预置引擎配置（使 isRealModeAvailable() = true） ----------
scopedStorage.setItem(
  'agent_engine_config',
  JSON.stringify({
    endpoint: 'https://api.deepseek.com/v1',
    apiKey: 'sk-mock-not-real',
    model: 'deepseek-chat',
  })
);

// ---------- 2. Mock LLM：按 agent 阶段与工具结果状态返回响应 ----------
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
  // 用「任务指令句」判定（角色 prompt 的工具清单会含相同工具名，必须用完整指令句区分）
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
        if (Array.isArray(parsed.candidates)) {
          parsed.candidates.forEach((c: any) => {
            if (c?.id) out.push(c.id);
          });
        }
      } catch {
        /* 忽略非 JSON 工具消息 */
      }
    }
  }
  if (out.length > 0) return out;
  // 兜底：从 user prompt 提取「方案名（id）」中的 id（修复后 pipeline 会传 id）
  const u = lastUser(messages);
  const re = /[（(]([a-z][a-z0-9-]*)[）)]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(u))) {
    const id = m[1];
    if (!['residential', 'office', 'school', 'factory', 'gymnasium'].includes(id)) {
      out.push(id);
    }
  }
  return [...new Set(out)];
};

const PARAMS: IProjectParams = {
  buildingType: 'residential',
  floors: 8,
  area: 12000,
  mainSpan: 8.4,
  seismicIntensity: '8',
  soilCategory: 'Ⅱ',
  budget: 2800,
};

const buildMockResponse = (messages: any[]): any => {
  const agent = whichAgent(messages);
  const candidates = extractCandidates(messages);

  if (agent === 'architect') {
    return messages.some((m: any) => m.role === 'tool')
      ? { role: 'assistant', content: '**方案选型结论**\n经筛选，建议采用框架结构、框架-剪力墙结构、钢结构作为候选方案进行比选。' }
      : {
          role: 'assistant',
          content: null,
          tool_calls: [
            toolCall('query_structure_systems', {
              filters: { buildingType: 'residential', floors: 8, seismicIntensity: '8', mainSpan: 8.4, budget: 2800 },
            }),
          ],
        };
  }

  if (agent === 'code') {
    if (!messages.some((m: any) => m.role === 'tool')) {
      const calls: any[] = [];
      for (const id of candidates) {
        calls.push(
          toolCall('check_seismic_requirements', {
            systemId: id,
            params: { floors: 8, seismicIntensity: '8', soilCategory: 'Ⅱ', buildingType: 'residential' },
          })
        );
        calls.push(toolCall('check_fire_requirements', { systemId: id, floors: 8, buildingType: 'residential' }));
      }
      return { role: 'assistant', content: null, tool_calls: calls };
    }
    return {
      role: 'assistant',
      content: '**规范校核结论**\n三个候选方案均满足 GB 55002-2021 抗震与 GB 55037-2022 防火要求，无强条违反。',
    };
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
    return {
      role: 'assistant',
      content: '**经济与绿色评估结论**\n框架-剪力墙方案综合经济性与绿色性能最优，装配率 AA 级，造价处于中等水平。',
    };
  }

  if (agent === 'chief') {
    if (!messages.some((m: any) => m.role === 'tool')) {
      return {
        role: 'assistant',
        content: null,
        tool_calls: [
          toolCall('compare_schemes', {
            schemeIds: candidates,
            params: PARAMS,
            weights: { cost: 25, duration: 25, safety: 25, green: 25 },
          }),
        ],
      };
    }
    return {
      role: 'assistant',
      content: `# 综合评审结论
## 1. 综合推荐方案及排序
推荐采用 **框架-剪力墙结构**，综合得分最高。

## 2. 推荐理由
- 抗震性能优越，层间位移角满足规范限值
- 造价适中，经济性良好
- 施工成熟度高，质量可控

## 3. 各方案优劣势对比
- 框架结构：造价低但侧向刚度不足
- 钢结构：工期短但造价偏高、防火成本高

## 4. 🤔 总工反思（Reflection）
### 4.1 反向质疑
高层区段框架结构可能不满足层间位移角要求。
### 4.2 置信度自评
置信度：中高。规范校核数据充分，造价为经验估算。
### 4.3 遗漏检查
未考虑场地液化与地下室层数影响。
### 4.4 改进方向
下一轮可补充基础方案比选。

## 5. ⚠️ 风险提示
框架-剪力墙方案施工缝处理是关键风险点；当设防烈度提高或场地变差时需重新评估。

## 6. 下一步优化建议
- 优化剪力墙布置位置，减小扭转效应
- 对比筏板基础与桩基础造价`,
    };
  }

  return { role: 'assistant', content: '（未知任务）' };
};

globalThis.fetch = (async (_input: any, init?: any) => {
  const body = JSON.parse(String(init?.body));
  const message = buildMockResponse(body.messages);
  return new Response(
    JSON.stringify({ choices: [{ message }], usage: { total_tokens: 0 } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}) as typeof fetch;

// ---------- 3. 运行完整管线（真实模式） ----------
const progress: number[] = [];
let result: Awaited<ReturnType<typeof runAgentPipeline>>;

try {
  result = await runAgentPipeline(
    PARAMS,
    undefined,
    { mode: 'real' },
    (_log: IAgentActionLog[], agentIndex: number) => progress.push(agentIndex)
  );
} catch (e) {
  console.error('❌ 管线运行抛错:', (e as Error).message);
  process.exit(1);
}

// ---------- 4. 断言验证 ----------
// --- 调试：先输出管线中间状态 ---
console.log('===== 调试信息 =====');
console.log('conclusions 全文:');
result.conclusions.forEach((c, i) => console.log(`  [${i}] ${c.slice(0, 120)}`));
console.log('actionLog 摘要:');
result.actionLog.forEach((l, i) => console.log(`  [${i}] ${l.type} agent=${l.agent} tool=${l.tool ?? '-'} ${(l.content ?? '').slice(0, 50)}`));
console.log('codeChecks keys:', Object.keys(result.codeChecks));
console.log('metrics keys:', Object.keys(result.metrics));
console.log('ranking:', JSON.stringify(result.ranking));
console.log('==================\n');

const checks: Array<[string, boolean, string?]> = [
  ['schemes=3（Architect 产出候选）', result.schemes.length === 3, `实际 ${result.schemes.length}: ${result.schemes.map((s) => s.id).join(',')}`],
  ['ranking=3（Chief 综合比选排序）', result.ranking.length === 3, `实际 ${result.ranking.length}`],
  ['recommended.schemeId 在候选内', result.ranking.some((r) => r.schemeId === result.recommended.schemeId), `推荐 ${result.recommended.schemeId}`],
  ['recommended.overallScore > 0', result.recommended.overallScore > 0, `得分 ${result.recommended.overallScore}`],
  ['advice.pros 非空（推荐理由）', result.advice.pros.length > 0, `实际 ${result.advice.pros.length}`],
  ['advice.cons 非空（风险提示）', result.advice.cons.length > 0, `实际 ${result.advice.cons.length}`],
  ['advice.nextSteps 非空（下一步建议）', result.advice.nextSteps.length > 0, `实际 ${result.advice.nextSteps.length}`],
  ['conclusions=4（四 Agent 各一条结论）', result.conclusions.length === 4, `实际 ${result.conclusions.length}`],
  ['onProgress 触发 4 次且顺序 1→2→3→4', progress.length === 4 && JSON.stringify(progress) === '[1,2,3,4]', `实际 ${JSON.stringify(progress)}`],
];

// 日志配对：tool_call 与 tool_result 严格 1:1 且 toolCallId 相同
const calls = result.actionLog.filter((l) => l.type === 'tool_call');
const resLogs = result.actionLog.filter((l) => l.type === 'tool_result');
const pairOk =
  calls.length === resLogs.length &&
  calls.every((c, i) => !!c.toolCallId && c.toolCallId === resLogs[i].toolCallId);
checks.push(['tool_call 与 tool_result 严格配对（同 toolCallId）', pairOk && calls.length >= 9, `调用 ${calls.length} / 结果 ${resLogs.length}`]);

// 执行顺序：第一工具 query_structure_systems（Architect），最后 compare_schemes（Chief）
const firstTool = result.actionLog.find((l) => l.type === 'tool_call')?.tool;
const lastTool = [...result.actionLog].reverse().find((l) => l.type === 'tool_call')?.tool;
checks.push(['工具执行顺序正确（先选型→最后比选）', firstTool === 'query_structure_systems' && lastTool === 'compare_schemes', `${firstTool} → ... → ${lastTool}`]);

// codeChecks / metrics 已挂载到结果
const hasCodeChecks = Object.keys(result.codeChecks).length === 3;
const hasMetrics = Object.keys(result.metrics).length === 3;
checks.push(['codeChecks 覆盖 3 方案', hasCodeChecks, `实际 ${Object.keys(result.codeChecks).length}`]);
checks.push(['metrics 覆盖 3 方案', hasMetrics, `实际 ${Object.keys(result.metrics).length}`]);

// ---------- 5. 输出 ----------
let passCount = 0;
console.log('===== 真实模式管线本地验证 =====\n');
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  [${detail}]` : ''}`);
  if (ok) passCount++;
}
console.log(`\n---- ${passCount}/${checks.length} 项通过 ----`);

if (passCount === checks.length) {
  console.log('🎯 全部通过：真实模式管线（工具调用/日志配对/逐步回调/评分/建议提取）底层逻辑无问题');
  console.log(`   推荐方案: ${result.recommended.schemeName} (${result.recommended.schemeId}) 综合得分 ${result.recommended.overallScore?.toFixed(1)}`);
  process.exit(0);
} else {
  console.log('⚠️ 存在失败项，见上方 ❌');
  process.exit(1);
}
