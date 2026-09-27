// Planner（任务规划 Agent）—— 决定「跑什么、什么顺序、什么条件跳过」
//
// 架构定位（对应蓝图 L2 规划层）：
//   Planner 只输出**计划拓扑**（IPlanNodeSpec[]），不负责执行。
//   执行器（executor）由 pipeline 在「绑定」阶段注入——因为 executor 需要访问
//   pipeline 的私有状态（候选方案 / 校核结果 / 指标 / 推理引擎单例）。
//
//   这种「规划 / 执行分离」是本次重构的关键：旧的 pipeline.runCore() 把
//   「四阶段顺序」和「每阶段怎么跑」揉在一起；现在前者归 Planner，后者归 pipeline。
//
// 模块①的边界：
//   - 目前只实现**确定性默认模板**（buildDefaultPlan），拓扑 = 旧四阶段。
//     这样 dynamic 模式与 static 模式在相同输入下行为逐字段一致（影子并行可验证）。
//   - buildDynamicPlan 是模块②③的扩展点：接入记忆系统后，Planner 将依据
//     用户偏好 / 历史经验对模板做「条件跳过」（如低层项目跳过周期比校核）
//     或「拓扑调整」（如经验显示某体系碳排易溢出，则插入预校验节点）。
//
// EXPORTS: IPlanNodeSpec, IPlanContext, Planner

import type { AgentType } from './types';
import type { IProjectParams, IWeightConfig } from '@/data/structure';

/** 规划节点种类（供 pipeline 绑定 executor 时识别） */
export type PlanNodeKind = 'architect' | 'code' | 'economist' | 'chief';

/** 计划节点规格：纯拓扑声明，不含 executor */
export interface IPlanNodeSpec {
  /** 节点唯一 ID */
  id: string;
  /** 展示标签 */
  label: string;
  /** 关联的 Agent */
  agent: AgentType;
  /** 节点种类（pipeline 据此绑定 executor） */
  kind: PlanNodeKind;
  /** 依赖的节点 ID */
  deps: string[];
  /**
   * 条件跳过：返回 false 时该节点不执行。
   * 模块① 默认模板不设任何条件（与旧四阶段一致）；模块②③ 动态规划时启用。
   */
  when?: (ctx: IPlanContext) => boolean;
  /** 校核回退轮次（0 = 首轮；>0 = 被打回后的第 N 轮复核）—— 供回退闭环节点使用 */
  feedbackLoop?: number;
  /**
   * 被打回重出时携带的上一轮校核反馈文本（仅 architect 重出节点使用）。
   * 属于「运行时数据」，仅出现在重规划动态构造的节点上；初始计划不携带。
   */
  feedback?: string;
}

/** 规划上下文：Planner 生成计划所需的全部输入 */
export interface IPlanContext {
  params: IProjectParams;
  weights: IWeightConfig;
  /** 是否为真实推理模式（LLM） */
  realMode: boolean;
  /** 是否允许校核回退闭环（对应 IEngineConfig.allowRecheck） */
  allowRecheck: boolean;
  /**
   * 未来扩展（模块②③）：记忆系统注入的用户偏好 / 历史经验，
   * Planner 据此做条件跳过与拓扑调整。
   */
  memory?: {
    preferences?: unknown[];
    experiences?: unknown[];
  };
}

export class Planner {
  /**
   * 生成计划。模块① 恒返回默认模板；模块②③ 将在此分流：
   * 有记忆注入时走 buildDynamicPlan，否则退回默认模板。
   */
  buildPlan(ctx: IPlanContext): IPlanNodeSpec[] {
    // 模块②③ 扩展点：这里会读 ctx.memory 决定是否动态化
    return this.buildDefaultPlan(ctx);
  }

  /**
   * 默认模板：与旧四阶段严格同构的拓扑。
   *   architect（选型）→ code（校核）┐
   *                    ↘ economist（评估）→ chief（评审）
   * 依赖显式化：code 与 economist 只依赖 architect（可安全重排 / 未来并行），
   * chief 依赖 code + economist。
   */
  private buildDefaultPlan(ctx: IPlanContext): IPlanNodeSpec[] {
    void ctx; // 默认模板不依赖上下文（与旧行为一致）
    return [
      {
        id: 'architect',
        label: '方案创作',
        agent: 'architect',
        kind: 'architect',
        deps: [],
      },
      {
        id: 'code',
        label: '规范校核',
        agent: 'code',
        kind: 'code',
        deps: ['architect'],
        feedbackLoop: 0,
      },
      {
        id: 'economist',
        label: '经济评估',
        agent: 'economist',
        kind: 'economist',
        // 时序对齐旧四阶段：economist 在校核（code）之后执行，而非仅依赖 architect。
        // 这样 code 触发回退时，重定向会把 economist 的依赖正确改为最新一轮的
        // architect-r{loop} + code-r{loop}，依赖图诚实反映数据流。
        deps: ['architect', 'code'],
      },
      {
        id: 'chief',
        label: '综合评审',
        agent: 'chief',
        kind: 'chief',
        deps: ['code', 'economist'],
      },
    ];
  }
}
