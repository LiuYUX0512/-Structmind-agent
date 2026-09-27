// 元认知与自我进化（模块③）—— Chief 不仅评价方案，还评价「Agent 们的执行轨迹」
//
// 这是本次重构的灵魂。旧 Chief 只输出方案推荐，现在它还要：
//   1. 读取轨迹元数据（循环次数 / 节点耗时 / 降级 / token 估算）
//   2. 生成结构化反思 IStrategyReflection（机器可读，非一段自然语言）
//   3. 通过 memory.storeExperience 写入经验库，供下一次 Planner 真实修改 DAG 拓扑
//
// 双模式（保命底线 4）：
//   - real 模式：LlmReflector，独立无状态 LLM 请求生成结构化反思
//   - trace 模式：RuleReflector，确定性规则检测轨迹特征，无 Key 也能演示「自我进化」
//
// 反思 → 经验的映射（闭环激活）：
//   IStrategyReflection.applyTo === 'planner' → kind='insert-precheck'（提前预校核）
//   写入经验库后，下次 Planner 读到该经验即真实插入预校核节点。
//
// EXPORTS: IReflector, RuleReflector, LlmReflector, reflectionToExperience

import type { IStrategyReflection, ITrajectoryMetrics } from './types';
import type { IExperience } from './memory';
import type { IMemoryTriggerContext } from './memory';

/** 反思器接口 */
export interface IReflector {
  reflect(metrics: ITrajectoryMetrics): Promise<IStrategyReflection>;
}

/**
 * 确定性规则反思器（trace 模式 / 无 LLM 兜底）。
 * 用规则检测轨迹特征，生成简化反思——保证无 Key 也能演示「自我进化」。
 */
export class RuleReflector implements IReflector {
  async reflect(metrics: ITrajectoryMetrics): Promise<IStrategyReflection> {
    // 规则 1：回退循环 > 0 → 校核挑刺太晚，应提前预校核
    if (metrics.totalLoops > 0) {
      return {
        observation: `本次运行触发 ${metrics.totalLoops} 轮校核回退，选型后才暴露违规`,
        diagnosis: 'Architect 出方案时未做即时预校核，违规拖到 Code 阶段才被发现',
        lesson: 'Architect 出方案后应立即做抗震预校核，把违规暴露在选型阶段',
        applyTo: 'planner',
        trigger: '高烈度区或回退循环 > 0 时',
      };
    }
    // 规则 2：某节点耗时 > 5s → 该节点偏慢
    const slowNode = Object.entries(metrics.nodeDurations).find(([, ms]) => ms > 5000);
    if (slowNode) {
      return {
        observation: `节点「${slowNode[0]}」耗时 ${(slowNode[1] / 1000).toFixed(1)}s，明显偏慢`,
        diagnosis: '该节点推理步数或工具调用次数过多，存在可压缩空间',
        lesson: `优化「${slowNode[0]}」节点的推理步数与工具调用，缩短单节点耗时`,
        applyTo: 'tool',
        trigger: '单节点耗时 > 5s 时',
      };
    }
    // 规则 3：降级 → 配置或网络问题
    if (metrics.degraded) {
      return {
        observation: '本次运行真实模式崩溃后降级到演示轨迹',
        diagnosis: 'LLM 请求失败或配置不足，触发了透明降级兜底',
        lesson: '检查 API 配置与网络稳定性，避免依赖降级兜底',
        applyTo: 'tool',
        trigger: '触发降级时',
      };
    }
    // 默认：运行健康
    return {
      observation: `本次运行工具调用 ${metrics.toolCallCount} 次，循环 ${metrics.totalLoops} 轮，运行健康`,
      diagnosis: '各阶段执行顺利，无回退、无降级',
      lesson: '保持当前规划模板，无需调整',
      applyTo: 'prompt',
      trigger: '运行健康时',
    };
  }
}

/**
 * LLM 反思器（real 模式）：独立无状态请求，要求输出 JSON 结构化反思。
 * 解析失败时降级为 RuleReflector（保命：元认知不阻断主链路）。
 */
export class LlmReflector implements IReflector {
  constructor(private readonly summarize: (text: string, instruction: string) => Promise<string>) {}

  async reflect(metrics: ITrajectoryMetrics): Promise<IStrategyReflection> {
    const input = JSON.stringify(metrics, null, 2);
    const instruction =
      '你是元认知反思器，负责评价 Agent 团队的执行轨迹（而非方案本身）。' +
      '请根据下面的轨迹指标，输出一个 JSON 对象，字段为 observation（观察到的事实）、diagnosis（归因）、lesson（教训）、applyTo（planner/tool/prompt 之一）、trigger（复用条件）。' +
      '只输出 JSON，不要解释。';
    try {
      const raw = await this.summarize(input, instruction);
      const parsed = JSON.parse(extractJson(raw));
      if (isStrategyReflection(parsed)) return parsed;
      throw new Error('反思 JSON 字段不完整');
    } catch (e) {
      // 降级为规则反思（元认知不阻断主链路）
      return new RuleReflector().reflect(metrics);
    }
  }
}

/** 从 LLM 输出中提取 JSON（剥离 ```json 围栏等） */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }
  return raw.trim();
}

function isStrategyReflection(x: unknown): x is IStrategyReflection {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.observation === 'string' &&
    typeof o.diagnosis === 'string' &&
    typeof o.lesson === 'string' &&
    (o.applyTo === 'planner' || o.applyTo === 'tool' || o.applyTo === 'prompt') &&
    typeof o.trigger === 'string'
  );
}

/**
 * 把结构化反思转成经验（闭环激活）：applyTo='planner' 的教训转成
 * insert-precheck 经验，写入经验库后下次 Planner 真实插入预校核节点。
 */
export function reflectionToExperience(
  reflection: IStrategyReflection,
  ctx: IMemoryTriggerContext
): Omit<IExperience, 'trigger'> | null {
  // 只有作用于 planner 的教训能直接转成拓扑操作
  if (reflection.applyTo !== 'planner') return null;

  const now = Date.now();
  return {
    id: `reflect-${now}-${Math.random().toString(36).slice(2, 6)}`,
    kind: 'insert-precheck',
    applyTo: 'architect',
    lesson: reflection.lesson,
    featureKey: `seismic-${ctx.params.seismicIntensity ?? 'unknown'}`,
    // 触发条件：与当前上下文对齐（下次相同上下文时命中）
    conditions: [
      { field: 'seismicIntensity', op: 'gte' as const, value: Number(ctx.params.seismicIntensity) || 8 },
      { field: 'realMode', op: 'eq' as const, value: ctx.realMode },
    ],
    ts: now,
  };
}
