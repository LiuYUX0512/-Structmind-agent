// DAG 执行引擎（通用、与业务无关）
// 职责：把声明式的任务节点图（含依赖、条件、重规划指令）编译为一次确定性的执行。
//
// 设计约束（对齐架构决策 3：不追求表面并行）：
//   推理引擎（RealEngine）是单例、LLM 请求本质串行，因此调度器不引入 Promise.all
//   真并行。"并行"的价值体现在依赖关系的显式建模——同一层级（如 code 与 economist）
//   只依赖共同上游，可安全地按任意顺序执行；本调度器按声明顺序串行跑。
//
// 核心能力：
//   1. 拓扑调度：只有 deps 全部完成的节点才可执行
//   2. 条件跳过：when(ctx) 返回 false 的节点标记 skipped，其下游视为依赖已满足
//   3. 递归重规划：节点 run 返回 IReplanInstruction 时，把新节点插入指定位置之前
//   4. 上限保护：replan 次数超限抛错，防止无法收敛的循环
//   5. 失败即抛：节点失败不吞错，向上抛给调用方（pipeline 借此触发崩溃降级）
//
// 本模块刻意不 import 任何业务类型（AgentType / IProjectParams 等），
// 保持为一个可复用的纯调度器。
//
// EXPORTS: ITaskNode, IReplanInstruction, IDagRunResult, IDagSchedulerOptions,
//          DagScheduler, isReplan

/** 任务节点（泛型 Ctx = 调用方传入的共享上下文，如 pipeline 实例） */
export interface ITaskNode<Ctx, Out = unknown> {
  /** 节点唯一 ID（重规划插入的新节点不得与已有节点冲突） */
  id: string;
  /** 展示标签（用于进度回调 / 错误信息） */
  label: string;
  /** 依赖的节点 ID：全部完成（或跳过）后本节点才可执行 */
  deps?: string[];
  /** 条件：返回 false 则跳过本节点（不执行 run），下游视为已满足 */
  when?: (ctx: Ctx) => boolean;
  /** 执行器：返回产出，或返回重规划指令 */
  run: (ctx: Ctx) => Promise<Out | IReplanInstruction<Ctx>>;
  /** 失败重试次数（可重试错误，如网络抖动） */
  maxRetries?: number;
}

/** 重规划指令：节点执行后声明「需要插入新节点」 */
export interface IReplanInstruction<Ctx> {
  /** 判别标记（区别于正常产出） */
  __replan: true;
  /** 要插入的新节点（其 deps 可指向已执行或同批新节点） */
  nodes: ITaskNode<Ctx, unknown>[];
  /** 插入到哪个待执行节点之前（该节点必须存在于待执行队列） */
  insertBefore: string;
  /** 本次重规划理由（写入执行轨迹，供审计 / 元认知读取） */
  reason?: string;
}

/** 一次 DAG 运行的结果 */
export interface IDagRunResult {
  status: 'completed';
  /** 按实际执行顺序排列的节点 ID（不含 skipped） */
  executed: string[];
  /** 被条件跳过的节点 ID */
  skipped: string[];
  /** 本次运行触发的重规划次数 */
  replanCount: number;
  /** 每次重规划的理由 */
  replanReasons: string[];
}

/** 调度器配置 */
export interface IDagSchedulerOptions {
  /** 重规划次数上限（防无限重规划，默认 8） */
  maxReplans?: number;
  /** 节点开始前回调（供 UI 流式展示） */
  onNodeStart?: (nodeId: string, label: string) => void;
  /** 节点完成后回调 */
  onNodeDone?: (nodeId: string, label: string) => void;
}

/** 类型守卫：判断节点产出是否为重规划指令 */
export function isReplan<Ctx>(x: unknown): x is IReplanInstruction<Ctx> {
  return !!x && typeof x === 'object' && (x as { __replan?: boolean }).__replan === true;
}

export class DagScheduler<Ctx = unknown> {
  private readonly opts: IDagSchedulerOptions;

  constructor(opts: IDagSchedulerOptions = {}) {
    this.opts = opts;
  }

  async run(nodes: ITaskNode<Ctx, unknown>[], ctx: Ctx): Promise<IDagRunResult> {
    const maxReplans = this.opts.maxReplans ?? 8;
    const queue: ITaskNode<Ctx, unknown>[] = [...nodes];
    const done = new Set<string>();
    const skipped = new Set<string>();
    const executed: string[] = [];
    const replanReasons: string[] = [];
    let replanCount = 0;

    this.validateInitial(nodes);

    while (queue.length > 0) {
      // 找一个就绪节点：deps 全部 done 或 skipped
      const idx = queue.findIndex((n) =>
        (n.deps ?? []).every((d) => done.has(d) || skipped.has(d))
      );
      if (idx === -1) {
        const pendingIds = queue.map((n) => n.id);
        const unmet = queue.flatMap((n) =>
          (n.deps ?? []).filter((d) => !done.has(d) && !skipped.has(d))
        );
        throw new Error(
          `DAG 调度失败：存在无法满足的依赖。待执行=[${pendingIds.join(',')}]，未满足依赖=[${[...new Set(unmet)].join(',')}]`
        );
      }

      const node = queue.splice(idx, 1)[0];
      this.opts.onNodeStart?.(node.id, node.label);

      // 条件跳过
      if (node.when && !node.when(ctx)) {
        skipped.add(node.id);
        continue;
      }

      // 执行（含重试），失败直接抛出（由调用方决定降级 / 中止）
      const result = await this.runWithRetry(node, ctx);

      // 递归重规划
      if (isReplan<Ctx>(result)) {
        replanCount++;
        if (replanCount > maxReplans) {
          throw new Error(`DAG 重规划次数超过上限 ${maxReplans}，疑似存在无法收敛的循环`);
        }
        replanReasons.push(result.reason ?? '(未说明理由)');

        const insertAt = queue.findIndex((n) => n.id === result.insertBefore);
        if (insertAt === -1) {
          throw new Error(
            `DAG 重规划失败：插入目标节点「${result.insertBefore}」不在待执行队列中（待执行=[${queue.map((n) => n.id).join(',')}]）`
          );
        }

        // 校验新节点 ID 不与已有节点（已执行 / 已跳过 / 待执行）冲突
        const existingIds = new Set([...queue.map((n) => n.id), ...done, ...skipped]);
        for (const nn of result.nodes) {
          if (existingIds.has(nn.id)) {
            throw new Error(`DAG 重规划失败：新节点 ID「${nn.id}」与已有节点冲突`);
          }
          existingIds.add(nn.id);
        }
        queue.splice(insertAt, 0, ...result.nodes);
      }

      done.add(node.id);
      executed.push(node.id);
      this.opts.onNodeDone?.(node.id, node.label);
    }

    return {
      status: 'completed',
      executed,
      skipped: [...skipped],
      replanCount,
      replanReasons,
    };
  }

  /** 初始节点校验：ID 唯一 + deps 指向的节点存在于初始计划（重规划节点的 deps 由主循环兜底） */
  private validateInitial(nodes: ITaskNode<Ctx, unknown>[]): void {
    const ids = new Set<string>();
    const allIds = new Set(nodes.map((n) => n.id));
    for (const n of nodes) {
      if (ids.has(n.id)) {
        throw new Error(`DAG 初始计划存在重复节点 ID：${n.id}`);
      }
      ids.add(n.id);
      for (const d of n.deps ?? []) {
        if (!allIds.has(d)) {
          throw new Error(`DAG 节点「${n.id}」依赖了初始计划中不存在的节点「${d}」`);
        }
      }
    }
  }

  private async runWithRetry(node: ITaskNode<Ctx, unknown>, ctx: Ctx): Promise<unknown> {
    const maxRetries = node.maxRetries ?? 0;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await node.run(ctx);
      } catch (e) {
        lastErr = e;
        if (attempt >= maxRetries) break;
      }
    }
    throw lastErr;
  }
}
