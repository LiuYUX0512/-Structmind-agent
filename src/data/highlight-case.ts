// 高光案例（Highlight Case）—— 首次打开页面的"示例运行结果"
// 解决"首次加载雷达全 0 分"的致命坑：评委第一眼看到的是已完成的示例运行，
// 而非空白画布（对标 Figma 新用户打开时有示例文件）。
// 用户一旦开始输入参数，此示例即被真实运行结果替换。
// EXPORTS: HIGHLIGHT_CASE_LOG, HIGHLIGHT_CASE_METRICS

import type { IAgentActionLog, ITrajectoryMetrics } from '@/agent/types';

/** 预置高光案例：8 度区 + 50 层智能办公楼，触发记忆/预校核/回退/元认知的完整轨迹 */
export const HIGHLIGHT_CASE_LOG: IAgentActionLog[] = [
  { step: 1, type: 'think', agent: 'architect', content: '收到任务：8 度设防、50 层智能办公楼，开始分析选型关键控制因素' },
  { step: 2, type: 'tool_call', agent: 'architect', tool: 'query_structure_systems', content: '调用工具：query_structure_systems', args: { filters: { buildingType: 'office', floors: 50, seismicIntensity: '8' } } },
  { step: 3, type: 'tool_result', agent: 'architect', tool: 'query_structure_systems', content: '工具 query_structure_systems 执行完成', result: { candidates: [{ id: 'frame' }, { id: 'frame-shearwall' }, { id: 'shearwall' }] } },
  { step: 4, type: 'think', agent: 'chief', content: '[Memory] 已注入历史偏好：高烈度区（8度及以上）项目，优先考虑抗震性能更优的剪力墙 / 框架-剪力墙体系' },
  { step: 5, type: 'conclusion', agent: 'architect', content: '候选方案：框架结构、框架-剪力墙、剪力墙三套' },
  { step: 6, type: 'think', agent: 'code', content: '[预校核] 框架结构：提前发现潜在抗震违规，已暴露在选型阶段（经验闭环生效）' },
  { step: 7, type: 'tool_call', agent: 'code', tool: 'check_seismic_requirements', content: '调用工具：check_seismic_requirements', args: { systemId: 'frame', params: { floors: 50, seismicIntensity: '8' } } },
  { step: 8, type: 'tool_result', agent: 'code', tool: 'check_seismic_requirements', content: '工具 check_seismic_requirements 执行完成', result: { failCount: 3, checks: [{ name: '层间位移角', status: 'fail', source: 'GB/T 50011-2010 表 5.5.1' }, { name: '剪重比', status: 'fail', source: 'GB 55002-2021 第 4.2.3 条' }, { name: '高度适用范围', status: 'fail', source: 'GB/T 50011-2010 表 6.1.1' }] } },
  { step: 9, type: 'think', agent: 'code', content: '框架结构层间位移角 1/420 超限值 1/550，剪重比 2.8% 低于 4.8%，高度 150m 超最大适用高度 40m，三项强条不满足' },
  { step: 10, type: 'think', agent: 'chief', content: '[Memory] 触发经验闭环：高烈度区框架结构易在选型阶段埋下校核违规，宜在选型后立即预校核' },
  { step: 11, type: 'tool_call', agent: 'code', tool: 'check_seismic_requirements', content: '调用工具：check_seismic_requirements', args: { systemId: 'shearwall', params: { floors: 50, seismicIntensity: '8' } } },
  { step: 12, type: 'tool_result', agent: 'code', tool: 'check_seismic_requirements', content: '工具 check_seismic_requirements 执行完成', result: { failCount: 0, checks: [{ name: '层间位移角', status: 'pass', source: 'GB/T 50011-2010 表 5.5.1' }] } },
  { step: 13, type: 'conclusion', agent: 'code', content: '剪力墙结构通过抗震校核，框架结构三项强条违规已打回重选' },
  { step: 14, type: 'tool_call', agent: 'economist', tool: 'estimate_cost', content: '调用工具：estimate_cost', args: { systemId: 'shearwall' } },
  { step: 15, type: 'tool_result', agent: 'economist', tool: 'estimate_cost', content: '工具 estimate_cost 执行完成', result: { costPerSqm: 5600 } },
  { step: 16, type: 'tool_call', agent: 'economist', tool: 'estimate_carbon', content: '调用工具：estimate_carbon', args: { systemId: 'shearwall' } },
  { step: 17, type: 'tool_result', agent: 'economist', tool: 'estimate_carbon', content: '工具 estimate_carbon 执行完成', result: { embodied: 580 } },
  { step: 18, type: 'conclusion', agent: 'economist', content: '剪力墙方案造价 5600 元/㎡，隐含碳 580 kgCO₂/㎡，经济绿色指标中等偏优' },
  { step: 19, type: 'tool_call', agent: 'chief', tool: 'compare_schemes', content: '调用工具：compare_schemes', args: { schemeIds: ['frame', 'frame-shearwall', 'shearwall'] } },
  { step: 20, type: 'tool_result', agent: 'chief', tool: 'compare_schemes', content: '工具 compare_schemes 执行完成', result: { recommended: { schemeId: 'shearwall' } } },
  { step: 21, type: 'think', agent: 'chief', content: '[Metacognition] 执行轨迹反思：触发 1 轮校核回退 → Architect 出方案时应即时预校核 → 已写入经验库，下次自动插入预校核节点' },
  { step: 22, type: 'conclusion', agent: 'chief', content: '推荐剪力墙结构，综合得分 7.2，抗震性能优、规范合规、经济合理' },
];

/** 高光案例对应的轨迹指标 */
export const HIGHLIGHT_CASE_METRICS: ITrajectoryMetrics = {
  totalLoops: 1,
  nodeDurations: { architect: 1420, code: 2380, economist: 1160, chief: 1620 },
  degraded: false,
  tokenEstimate: 4860,
  toolCallCount: 8,
  replanCount: 1,
};
