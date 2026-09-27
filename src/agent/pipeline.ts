// 多 Agent 协同管线（虚拟工程部）
// 四个子 Agent 按顺序执行：ArchitectAgent → CodeAgent → EconomistAgent → ChiefAgent
// 每个 Agent 有独立职责、允许调用的工具集、独立 actionLog 片段
// 最终产出统一结果结构 IAgentPipelineResult 供 UI 消费
// EXPORTS: AgentPipeline, runAgentPipeline

import { TraceEngine } from './trace-engine';
import { RealEngine } from './real-engine';
import { DagScheduler, type ITaskNode, type IReplanInstruction } from './dag-engine';
import { Planner, type IPlanNodeSpec } from './planner';
import {
  SUB_AGENT_SPECS,
  type IAgentPipelineResult,
  type AgentType,
  type IEngineConfig,
  type IHumanOverrides,
} from './types';
import type { IProjectParams, IWeightConfig, IStructureScheme } from '@/data/structure';
import { STRUCTURE_SYSTEM_LIBRARY, MOCK_WEIGHT_CONFIG } from '@/data/structure';
import {
  arbitrateChiefDecision,
  parseChiefDecision,
  DECISION_BLOCK_INSTRUCTION,
  type IArbitratedDecision,
  type IChiefDecisionBlock,
  type TDecisionSource,
} from './decision';

// ============ 子 Agent 角色定义 ============

/** 构建子 Agent 的 prompt 前缀 */
function buildAgentPrompt(agentId: AgentType, params: IProjectParams): string {
  const spec = SUB_AGENT_SPECS[agentId as keyof typeof SUB_AGENT_SPECS];
  const paramStr = JSON.stringify(params, null, 2);
  return `${spec.rolePrompt}

## 项目参数
\`\`\`json
${paramStr}
\`\`\`

请开始你的工作。`;
}

/**
 * 从总工 Markdown 结论中提取建议结构（real 模式 Chief 未返回结构化 advice 时兜底，
 * 避免界面"下一步建议"区域空白）
 */
function extractAdviceFromMarkdown(md: string): IAgentPipelineResult['advice'] {
  const advice: IAgentPipelineResult['advice'] = { pros: [], cons: [], nextSteps: [] };
  if (!md) return advice;

  // 按小节标题提取正文（支持 "## 3. 推荐理由" / "**推荐理由**" 等常见形态）
  const section = (title: string): string => {
    const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 标题行允许任意前缀/后缀（如 "**⚠️ 风险提示**"、"## 4. 反思与风险提示"），只要包含关键词即命中
    const re = new RegExp(`(?:#{1,6}\\s*)?[\\d.]*[^\\n]*${esc}[^\\n]*\\n([\\s\\S]*?)(?=\\n\\s*(?:#{1,6}|$)|$)`, 'i');
    const m = md.match(re);
    return m ? m[1].trim() : '';
  };

  const pickLines = (text: string): string[] =>
    text
      .split('\n')
      .map((l) => l.replace(/^[-•*]\s*/, '').trim())
      .filter((l) => l && !l.startsWith('#') && l.length < 120)
      .slice(0, 5);

  const prosText = section('推荐理由');
  if (prosText) advice.pros = pickLines(prosText);
  const consText = section('各方案优劣势对比') || section('风险提示') || section('风险');
  if (consText) advice.cons = pickLines(consText);
  const nextText = section('下一步优化建议') || section('下一步建议');
  if (nextText) advice.nextSteps = pickLines(nextText);

  // ===== Chief 结构化输出升级：反思/风险/触发条件/置信度 =====
  const risksText = section('风险提示') || section('⚠️ 风险提示') || section('风险');
  if (risksText) advice.risks = pickLines(risksText);
  const triggerText = section('什么情况下需要重新评估') || section('触发条件') || section('重新评估');
  if (triggerText) advice.riskTriggers = pickLines(triggerText);
  const confText = section('置信度自评') || section('4.2 置信度自评');
  if (confText) {
    const levelMatch = /(高|中|低)/.exec(confText);
    const level = levelMatch ? levelMatch[1] : '中';
    const reasonLine = confText
      .split('\n')
      .find((l) => /理由|因为|由于|数据|估算|不确定/.test(l) && l.trim().length > 6);
    advice.confidence = {
      level,
      score: level === '高' ? 85 : level === '低' ? 55 : 70,
      strengths: [],
      uncertainties: [],
      reason: (reasonLine ? reasonLine.trim() : confText).replace(/^[-•*\s]+/, '').slice(0, 160),
    };
  }

  // 兜底：从全文提取关键句
  if (advice.pros.length === 0 && advice.nextSteps.length === 0) {
    const lines = md
      .split('\n')
      .filter((l) => /推荐|建议|应当|需要|注意/.test(l) && l.trim().length > 8 && l.trim().length < 100);
    if (lines.length > 0) advice.nextSteps = lines.slice(0, 4);
  }
  return advice;
}

// ============ Agent Pipeline 主类 ============

export class AgentPipeline {
  private params: IProjectParams;
  private weights: IWeightConfig;
  private config: Partial<IEngineConfig>;

  // 中间结果
  private candidateSchemes: IStructureScheme[] = [];
  private codeChecks: Record<string, unknown> = {};
  private metrics: Record<string, unknown> = {};
  private finalResult: IAgentPipelineResult | null = null;

  // 全局 actionLog（按时间线合并）
  private actionLog: IAgentPipelineResult['actionLog'] = [];
  private conclusions: string[] = [];

  // 自主决策回环元数据（供 Chief 引用）
  private correctionMeta: {
    loops: number;
    replacements: Array<{ original: string; replacement: string; reason: string; loop: number; finalStatus: string }>;
    allPass: boolean;
  } | null = null;

  // 跨阶段共享上下文（真实模式：校核反馈等中间结论累积传递，供回退闭环与 Chief 仲裁引用）
  private sharedContext: string[] = [];

  // 人类在环（HITL）干预项与预算超限标记
  private humanOverrides: IHumanOverrides | null = null;
  private budgetExceededIds: string[] = [];

  private onProgress?: (actionLog: IAgentPipelineResult['actionLog'], agentIndex: number) => void;
  private onDegrade?: (reason: string) => void;

  /** 单例推理引擎：四个子 Agent 共享同一个 RealEngine 实例（配置/重试参数复用） */
  private engine: RealEngine;

  constructor(
    params: IProjectParams,
    weights?: IWeightConfig,
    config?: Partial<IEngineConfig>,
    onProgress?: (actionLog: IAgentPipelineResult['actionLog'], agentIndex: number) => void,
    onDegrade?: (reason: string) => void
  ) {
    this.params = params;
    this.weights = weights || MOCK_WEIGHT_CONFIG;
    this.config = config || {};
    this.onProgress = onProgress;
    this.onDegrade = onDegrade;
    this.engine = new RealEngine(this.params, this.weights, this.config);
  }

  /** 阶段进度回调（供 UI 逐步展示真实模式的思考过程） */
  private emitProgress(agentIndex: number): void {
    this.onProgress?.([...this.actionLog], agentIndex);
  }

  /** 设定人类在环干预项（工程师在环：锁定方案/预算上限/强制权重/备注）。必须在 run() 前调用 */
  setHumanOverride(overrides: IHumanOverrides): void {
    this.humanOverrides = overrides;
    if (overrides.forcedWeights) {
      this.weights = { ...this.weights, ...overrides.forcedWeights };
    }
  }

  /** 干预日志（写入 actionLog 与结论，用户/评委可见"人在环"决策） */
  private pushHumanLog(content: string): void {
    this.actionLog.push({
      type: 'think',
      agent: 'chief',
      content,
      step: this.actionLog.length + 1,
      timestamp: Date.now(),
    });
    this.conclusions.push(`[总工·干预] ${content}`);
  }

  /** run 开始时把干预项写入日志（体现"工程师先行决策"） */
  private applyHumanOverrideLogs(): void {
    const h = this.humanOverrides;
    if (!h) return;
    if (h.budgetCap != null) {
      this.pushHumanLog(`⚠️ 人工设定预算上限 ${h.budgetCap} 万元，超出方案将标记风险并如实反映`);
    }
    if (h.lockedSchemeIds && h.lockedSchemeIds.length > 0) {
      const names = this.candidateSchemes
        .filter((sc) => h.lockedSchemeIds!.includes(sc.id))
        .map((sc) => sc.name)
        .join('、');
      this.pushHumanLog(`🔒 人工锁定方案（AI 不得替换）：${names || h.lockedSchemeIds.join('、')}`);
    }
    if (h.notes) {
      this.pushHumanLog(`📝 人工备注：${h.notes}`);
    }
    if (h.forcedWeights) {
      const labelMap: Record<string, string> = { cost: '成本', duration: '工期', safety: '安全', green: '绿色' };
      const parts = Object.entries(h.forcedWeights)
        .map(([k, v]) => `${labelMap[k] || k} ${v}%`)
        .join('、');
      this.pushHumanLog(`⚖️ 人工强制评分权重：${parts}`);
    }
  }

  /** 运行完整管线 */
  async run(): Promise<IAgentPipelineResult> {
    // 强制真实模式校验：用户指定 real 但配置不足时直接报错，不静默降级
    if (this.config.mode === 'real') {
      const endpoint = this.config.endpoint;
      const usable = !!endpoint && (endpoint.startsWith('/') || !!(this.config.apiKey && this.config.model));
      if (!usable) {
        throw new Error(
          '真实推理模式不可用：未配置有效的代理接口或 API Key / 模型名称。请在配置面板中选择安全代理或填写直连参数，或切换到演示轨迹模式。'
        );
      }
    }

    try {
      return await this.execute();
    } catch (e) {
      // 保命机制：真实模式崩溃时自动降级到演示轨迹模式继续跑完（透明降级，不静默）
      if (this.config.mode === 'real') {
        const reason = (e as Error).message || '未知错误';
        this.config = { ...this.config, mode: 'trace' };
        this.resetState();
        this.onDegrade?.(reason);
        const result = await this.execute();
        this.finalResult = { ...result, degraded: { from: 'real', reason } };
        return this.finalResult;
      }
      throw e;
    }
  }

  /**
   * 编排分派（模块①：代际兼容开关）。
   *   plannerMode === 'dynamic' → DAG 调度器（新引擎）
   *   其余（默认 'static'）→ runCore（旧硬编码四阶段，保命默认值）
   */
  private async execute(): Promise<IAgentPipelineResult> {
    if (this.config.plannerMode === 'dynamic') {
      return this.runDynamic();
    }
    return this.runCore();
  }

  /**
   * 动态模式：Planner 生成 DAG 拓扑 → DagScheduler 执行。
   * 默认模板与旧四阶段同构，行为逐字段一致；差异仅在「编排方式」。
   */
  private async runDynamic(): Promise<IAgentPipelineResult> {
    this.applyHumanOverrideLogs();

    const planner = new Planner();
    const plan = planner.buildPlan({
      params: this.params,
      weights: this.weights,
      realMode: this.config.mode === 'real',
      allowRecheck: this.config.allowRecheck !== false,
    });

    const scheduler = new DagScheduler<this>({ maxReplans: 8 });
    const nodes = plan.map((spec) => this.bindNode(spec));

    await scheduler.run(nodes, this);

    if (!this.finalResult) {
      throw new Error('管线运行异常，未生成最终结果');
    }
    return this.finalResult;
  }

  /**
   * 把 Planner 输出的计划规格绑定为可执行节点（注入 executor）。
   * executor 复用 runArchitect / runCode / runEconomist / runChief 四个私有方法，
   * 保证 dynamic 与 static 走的是同一份执行逻辑（影子并行逐字段一致的前提）。
   */
  private bindNode(spec: IPlanNodeSpec): ITaskNode<this, unknown> {
    switch (spec.kind) {
      case 'architect': {
        // feedback 非空表示被校核打回重出：携带上一轮校核反馈（通过 spec 显式传递，无共享状态）
        return {
          id: spec.id,
          label: spec.label,
          deps: spec.deps,
          run: async () => {
            await this.runArchitect(spec.feedback);
            this.emitProgress(1);
          },
        };
      }
      case 'code': {
        return {
          id: spec.id,
          label: spec.label,
          deps: spec.deps,
          run: async () => {
            await this.runCode();
            this.emitProgress(2);
            return this.checkRecheck(spec.feedbackLoop ?? 0);
          },
        };
      }
      case 'economist': {
        return {
          id: spec.id,
          label: spec.label,
          deps: spec.deps,
          run: async () => {
            await this.runEconomist();
            this.emitProgress(3);
          },
        };
      }
      case 'chief': {
        return {
          id: spec.id,
          label: spec.label,
          deps: spec.deps,
          run: async () => {
            this.computeBudgetExceeded();
            await this.runChief();
            this.emitProgress(4);
          },
        };
      }
    }
  }

  /**
   * 校核回退闭环的 DAG 表达（递归重规划）。
   * 旧 runCore 用 for 循环硬编码「Code 发现违规 → Architect 重出 → 复核」；
   * 此处把「打回」表达为一次 replan 指令：插入 architect-r{loop} + code-r{loop}
   * 到 economist 之前。loop 与旧 MAX_LOOPS=2 对齐，保证行为一致。
   */
  private checkRecheck(loop: number): IReplanInstruction<this> | void {
    // 仅在真实模式且允许回退时启用（与旧逻辑的开关条件一致）
    if (this.config.mode !== 'real' || this.config.allowRecheck === false) return;

    const violations = this.collectViolations();
    if (violations.length === 0) {
      // 无违规：若此前发生过打回，标记「全部通过」
      if (this.correctionMeta) this.correctionMeta.allPass = true;
      return;
    }

    const MAX_LOOPS = 2;
    if (loop >= MAX_LOOPS) {
      // 轮次已用完，接受现状（与旧 for 循环上限一致）
      return;
    }

    const nextLoop = loop + 1;
    const feedback = violations
      .map((v) => `【校核未通过】${v.schemeName}（${v.schemeId}）：${v.summary}`)
      .join('\n');
    this.sharedContext.push(`第 ${nextLoop} 轮校核反馈：\n${feedback}`);
    this.correctionMeta = {
      loops: nextLoop,
      replacements: violations.map((v) => ({
        original: v.schemeId,
        replacement: '',
        reason: v.summary,
        loop: nextLoop,
        finalStatus: 'rechecking',
      })),
      allPass: false,
    };

    const prevCodeId = loop === 0 ? 'code' : `code-r${loop}`;
    const prevArchitectId = loop === 0 ? 'architect' : `architect-r${loop}`;
    const nextArchitectId = `architect-r${nextLoop}`;
    const nextCodeId = `code-r${nextLoop}`;
    return {
      __replan: true,
      insertBefore: 'economist',
      reason: `规范校核未通过，打回方案创作重出（第 ${nextLoop} 轮）`,
      // 依赖重定向：economist / chief 原本依赖首轮 architect / code，
      // 重出后必须改依赖最新一轮节点，否则会读到废弃的中间结果。
      redirects: [
        { from: prevArchitectId, to: nextArchitectId },
        { from: prevCodeId, to: nextCodeId },
      ],
      nodes: [
        this.bindNode({
          id: nextArchitectId,
          label: `方案创作（第 ${nextLoop} 轮重出）`,
          agent: 'architect',
          kind: 'architect',
          deps: [prevCodeId],
          feedbackLoop: nextLoop,
          feedback,
        }),
        this.bindNode({
          id: nextCodeId,
          label: `规范校核（第 ${nextLoop} 轮复核）`,
          agent: 'code',
          kind: 'code',
          deps: [nextArchitectId],
          feedbackLoop: nextLoop,
        }),
      ],
    };
  }

  /** 核心执行：四阶段 + 真实模式校核回退闭环 */
  private async runCore(): Promise<IAgentPipelineResult> {
    // 人类在环：先把工程师干预写入日志（决策先行），再进入四 Agent 流程
    this.applyHumanOverrideLogs();
    // 按顺序执行四个子 Agent，每完成一个阶段即回调进度（真实模式逐步展示思考过程）
    await this.runArchitect();
    this.emitProgress(1);
    await this.runCode();
    this.emitProgress(2);

    // ===== 真实模式校核回退闭环（对齐演示模式"Code 挑刺 → 重出 → 复核"能力）=====
    // Code 发现规范违规 → 反馈写回共享上下文 → Architect 带着反馈重出方案 → 重新校核
    // 最多回退 2 轮控制成本；全部通过后 Chief 在"校核状态已确认"的前提下仲裁
    if (this.config.mode === 'real' && this.config.allowRecheck !== false) {
      const MAX_LOOPS = 2;
      for (let loop = 1; loop <= MAX_LOOPS; loop++) {
        const violations = this.collectViolations();
        if (violations.length === 0) break;
        const feedback = violations
          .map((v) => `【校核未通过】${v.schemeName}（${v.schemeId}）：${v.summary}`)
          .join('\n');
        this.sharedContext.push(`第 ${loop} 轮校核反馈：\n${feedback}`);
        this.correctionMeta = {
          loops: loop,
          replacements: violations.map((v) => ({
            original: v.schemeId,
            replacement: '',
            reason: v.summary,
            loop,
            finalStatus: 'rechecking',
          })),
          allPass: false,
        };
        // 打回方案创作工程师重出（携带校核反馈）
        await this.runArchitect(feedback);
        this.emitProgress(1);
        await this.runCode();
        this.emitProgress(2);
      }
      const finalViolations = this.collectViolations();
      if (finalViolations.length === 0 && this.correctionMeta) {
        this.correctionMeta.allPass = true;
      }
    }

    await this.runEconomist();
    this.emitProgress(3);
    // 预算上限判定（Economist 出价后、Chief 仲裁前；纯硬编码，零额外 API 成本）
    this.computeBudgetExceeded();
    await this.runChief();
    this.emitProgress(4);

    if (!this.finalResult) {
      throw new Error('管线运行异常，未生成最终结果');
    }
    return this.finalResult;
  }

  /** 收集未通过规范校核的候选方案（真实模式回退闭环的违规判定） */
  private collectViolations(): Array<{ schemeId: string; schemeName: string; summary: string }> {
    const out: Array<{ schemeId: string; schemeName: string; summary: string }> = [];
    for (const scheme of this.candidateSchemes) {
      const check = this.codeChecks[scheme.id] as
        | { seismic?: { failCount?: number; summary?: string }; fire?: { failCount?: number; summary?: string } }
        | undefined;
      const parts: string[] = [];
      if (check?.seismic && (check.seismic.failCount ?? 0) > 0) {
        parts.push(`抗震校核未通过：${check.seismic.summary || '存在强条不满足'}`);
      }
      if (check?.fire && (check.fire.failCount ?? 0) > 0) {
        parts.push(`防火校核未通过：${check.fire.summary || '存在强条不满足'}`);
      }
      if (parts.length > 0) {
        out.push({ schemeId: scheme.id, schemeName: scheme.name, summary: parts.join('；') });
      }
    }
    return out;
  }

  /** 预算上限判定：估算总造价（cost 元/㎡ × 面积 ㎡ ÷ 10000 → 万元）超出人工预算上限（万元）的方案 */
  private computeBudgetExceeded(): void {
    this.budgetExceededIds = [];
    const cap = this.humanOverrides?.budgetCap;
    if (cap == null) return;
    const area = this.params.area;
    for (const id of this.candidateSchemes.map((sc) => sc.id)) {
      const m = this.metrics[id] as { cost?: { costPerSqm?: number } } | undefined;
      const cost = m?.cost?.costPerSqm as number | undefined;
      if (typeof cost === 'number' && typeof area === 'number') {
        const totalWan = (cost * area) / 10000;
        if (totalWan > cap) this.budgetExceededIds.push(id);
      }
    }
    if (this.budgetExceededIds.length > 0) {
      const names = this.candidateSchemes
        .filter((sc) => this.budgetExceededIds.includes(sc.id))
        .map((sc) => sc.name)
        .join('、');
      this.pushHumanLog(`⚠️ 预算超限检测：${names} 估算总造价超出上限 ${cap} 万元（已如实标记）`);
    }
  }

  /** 重置中间状态（崩溃降级重跑前调用） */
  private resetState(): void {
    this.candidateSchemes = [];
    this.codeChecks = {};
    this.metrics = {};
    this.finalResult = null;
    this.actionLog = [];
    this.conclusions = [];
    this.correctionMeta = null;
    this.engine.reset();
  }

  /** 第一步：方案创作工程师（feedback 非空 = 校核回退闭环打回重出） */
  private async runArchitect(feedback?: string): Promise<void> {
    const useReal = this.config.mode === 'real';

    if (useReal) {
      // 真实模式：共享单例引擎；重出（feedback 非空）时在同一会话续写，保证推理连贯
      let prompt = buildAgentPrompt('architect', this.params) +
        '\n\n请调用 query_structure_systems 工具筛选出最适合本项目的 3 个候选结构方案，并给出简要的适用性评述。';
      // 人类在环：锁定方案与备注注入（首轮与重出都生效）
      if (this.humanOverrides?.lockedSchemeIds?.length) {
        const lockedNames = STRUCTURE_SYSTEM_LIBRARY
          .filter((sc) => this.humanOverrides!.lockedSchemeIds!.includes(sc.id))
          .map((sc) => sc.name)
          .join('、');
        prompt +=
          '\n\n## 🔒 工程师人工锁定（必须遵守）\n以下方案已被工程师锁定，必须保留为候选且不得替换：' +
          (lockedNames || this.humanOverrides.lockedSchemeIds.join('、')) +
          '。请确保选型结果中始终包含这些方案。';
      }
      if (this.humanOverrides?.notes) {
        prompt += '\n\n## 📝 工程师备注\n' + this.humanOverrides.notes;
      }
      if (feedback) {
        prompt +=
          '\n\n## ⚠️ 上一轮规范校核反馈（必须认真对待）\n' +
          feedback +
          '\n\n请重新选型：优先选择能通过上述规范校核的候选方案；若某方案确实难以满足，请替换为更合适的结构体系。';
      }
      const result = await this.engine.run(prompt, 'architect', { appendHistory: !!feedback });

      // 解析候选方案（从日志中找【最新】的 query_structure_systems 调用结果——
      // 引擎单例下日志跨轮累积，find 首条会拿到重出前的旧候选）
      const qsResult = [...this.engine.getActionLog()].reverse().find(
        (log) => log.tool === 'query_structure_systems' && log.type === 'tool_result'
      );
      if (qsResult?.result && typeof qsResult.result === 'object') {
        const r = qsResult.result as { candidates: Array<{ id: string; name: string }> };
        this.candidateSchemes = r.candidates
          .map((c) => STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === c.id))
          .filter((s): s is IStructureScheme => !!s);
      }

      this.actionLog.push(...result.actionLog);
      if (result.finalAnswer) {
        this.conclusions.push(`[Architect] ${result.finalAnswer.slice(0, 300)}`);
      }
    } else {
      // 演示模式
      const trace = new TraceEngine(this.params, this.weights);
      const { candidates, logs } = trace.runArchitect();
      this.candidateSchemes = candidates;
      this.actionLog.push(...logs);

      const conclusionEntry = logs.find((l) => l.type === 'conclusion');
      if (conclusionEntry) {
        this.conclusions.push(conclusionEntry.content);
      }
    }

    // 人类在环：锁定方案强制保留（工程师锁超越 LLM 选型结果）
    if (this.humanOverrides?.lockedSchemeIds?.length) {
      const missing = this.humanOverrides.lockedSchemeIds.filter(
        (id) => !this.candidateSchemes.some((sc) => sc.id === id)
      );
      for (const id of missing) {
        const lib = STRUCTURE_SYSTEM_LIBRARY.find((sc) => sc.id === id);
        if (lib && !this.candidateSchemes.some((sc) => sc.id === id)) {
          this.candidateSchemes.push(lib);
        }
      }
    }
  }

  /** 第二步：规范校核工程师 */
  private async runCode(): Promise<void> {
    const schemeIds = this.candidateSchemes.map((s) => s.id);
    const useReal = this.config.mode === 'real';

    if (useReal) {
      const prompt = buildAgentPrompt('code', this.params) +
        `\n\n候选方案：${this.candidateSchemes.map((s) => `${s.name}（${s.id}）`).join('、')}\n` +
        '\n请对每个候选方案逐一调用 check_seismic_requirements 和 check_fire_requirements 工具进行规范校核，给出逐条判定和条文依据。';
      const result = await this.engine.run(prompt, 'code');

      // 尝试从日志中提取 codeChecks（getActionLog 返回引擎全量日志，按工具名精确筛选不受前段影响）
      const allLogs = this.engine.getActionLog();
      const seisCallLogs = allLogs.filter(
        (log) => log.tool === 'check_seismic_requirements' && log.type === 'tool_call'
      );
      const fireCallLogs = allLogs.filter(
        (log) => log.tool === 'check_fire_requirements' && log.type === 'tool_call'
      );
      const seisResults = allLogs.filter(
        (log) => log.tool === 'check_seismic_requirements' && log.type === 'tool_result'
      );
      const fireResults = allLogs.filter(
        (log) => log.tool === 'check_fire_requirements' && log.type === 'tool_result'
      );
      // 用 toolCallId 精确配对调用与结果（fallback：按顺序 index），避免交错/缺失导致错位
      const pairByCallId = (calls: IAgentPipelineResult['actionLog'], results: IAgentPipelineResult['actionLog']) => {
        // 三级配对，杜绝 LLM 乱序调用导致错位：
        // ① toolCallId 精确配对（工具调用的唯一 ID，主路径）
        // ② 从 tool_result 日志自带的 callArgs 反查（结果日志数据自完备，不依赖调用日志 args）
        // ③ 按顺序索引（仅当前两者均缺失时的最后兜底）
        const resultByCallId = new Map<string, unknown>();
        results.forEach((r) => {
          if (r.toolCallId) resultByCallId.set(r.toolCallId, r.result);
        });
        const out = new Map<string, unknown>();
        calls.forEach((call, idx) => {
          const sysId = call.args?.systemId as string | undefined;
          if (!sysId) return;
          const byId = call.toolCallId ? resultByCallId.get(call.toolCallId) : undefined;
          if (byId !== undefined) { out.set(sysId, byId); return; }
          const byArgs = [...results].reverse().find((r) => r.callArgs?.systemId === sysId);
          if (byArgs?.result !== undefined) { out.set(sysId, byArgs.result); return; }
          const fallback = results[idx]?.result;
          if (fallback !== undefined) out.set(sysId, fallback);
        });
        return out;
      };
      const seisResultBySysId = pairByCallId(seisCallLogs, seisResults);
      const fireResultBySysId = pairByCallId(fireCallLogs, fireResults);
      schemeIds.forEach((id) => {
        this.codeChecks[id] = {
          seismic: seisResultBySysId.get(id) || null,
          fire: fireResultBySysId.get(id) || null,
        };
      });

      this.actionLog.push(...result.actionLog);
      if (result.finalAnswer) {
        this.conclusions.push(`[Code] ${result.finalAnswer.slice(0, 300)}`);
      }
    } else {
      // 演示模式
      const trace = new TraceEngine(this.params, this.weights);
      // 直接调用 runCode 即可，TraceEngine 的 runCode 不依赖 runArchitect 内部状态
      const { codeChecks, logs } = trace.runCode(schemeIds);
      this.codeChecks = codeChecks;
      this.actionLog.push(...logs);

      // ====== Multi-Agent 辩论环节：Code 挑刺 → Architect 回应 → Code 复核 ======
      const loopResult = trace.runDebateLoop(schemeIds, this.codeChecks);
      if (loopResult.loops > 0) {
        // 有调整：更新候选方案列表和校核结果
        const newSchemes = loopResult.finalSchemeIds
          .map((id) => STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === id))
          .filter((s): s is IStructureScheme => !!s);
        this.candidateSchemes = newSchemes;
        this.codeChecks = loopResult.finalCodeChecks;
        this.actionLog.push(...loopResult.logs);

        // 把回环元数据附加到结论里（供总工引用）
        this.correctionMeta = {
          loops: loopResult.loops,
          replacements: loopResult.replacements,
          allPass: loopResult.allPass,
        };
      }

      const conclusionEntry = logs.find((l) => l.type === 'conclusion');
      if (conclusionEntry) {
        this.conclusions.push(conclusionEntry.content);
      }
    }
  }

  /** 第三步：经济评估工程师 */
  private async runEconomist(): Promise<void> {
    const schemeIds = this.candidateSchemes.map((s) => s.id);
    const useReal = this.config.mode === 'real';

    if (useReal) {
      const prompt = buildAgentPrompt('economist', this.params) +
        `\n\n候选方案：${this.candidateSchemes.map((s) => `${s.name}（${s.id}）`).join('、')}\n` +
        '\n请对每个候选方案逐一调用 estimate_cost、estimate_schedule、estimate_precast_rate、estimate_carbon、assess_construction_risk 工具进行经济与绿色指标评估。';
      const result = await this.engine.run(prompt, 'economist');

      // 匹配 metrics：用 toolCallId 精确配对「systemId + toolName → result」，
      // 避免调用交错或某次结果缺失导致错位（fallback：按顺序 index）
      const toolNames = ['estimate_cost', 'estimate_schedule', 'estimate_precast_rate', 'estimate_carbon', 'assess_construction_risk'] as const;
      const callLogs = this.engine.getActionLog().filter(
        (log) => log.type === 'tool_call' && toolNames.includes(log.tool as typeof toolNames[number])
      );
      const resultLogs = this.engine.getActionLog().filter(
        (log) => log.type === 'tool_result' && toolNames.includes(log.tool as typeof toolNames[number])
      );
      const resultByCallId = new Map<string, unknown>();
      resultLogs.forEach((r) => {
        if (r.toolCallId) resultByCallId.set(r.toolCallId, r.result);
      });
      const resultMap = new Map<string, unknown>();
      callLogs.forEach((call, idx) => {
        const sysId = call.args?.systemId as string | undefined;
        if (sysId && call.tool) {
          // 三级配对（同 pairByCallId）：toolCallId → callArgs 反查 → 索引兜底
          const byId = call.toolCallId ? resultByCallId.get(call.toolCallId) : undefined;
          if (byId !== undefined) { resultMap.set(`${sysId}:${call.tool}`, byId); return; }
          const byArgs = [...resultLogs].reverse().find((r) => r.callArgs?.systemId === sysId && r.tool === call.tool);
          if (byArgs?.result !== undefined) { resultMap.set(`${sysId}:${call.tool}`, byArgs.result); return; }
          const fallback = resultLogs[idx]?.result;
          if (fallback !== undefined) resultMap.set(`${sysId}:${call.tool}`, fallback);
        }
      });
      schemeIds.forEach((id) => {
        this.metrics[id] = {
          cost: resultMap.get(`${id}:estimate_cost`) || null,
          schedule: resultMap.get(`${id}:estimate_schedule`) || null,
          precast: resultMap.get(`${id}:estimate_precast_rate`) || null,
          carbon: resultMap.get(`${id}:estimate_carbon`) || null,
          risk: resultMap.get(`${id}:assess_construction_risk`) || null,
        };
      });

      this.actionLog.push(...result.actionLog);
      if (result.finalAnswer) {
        this.conclusions.push(`[Economist] ${result.finalAnswer.slice(0, 300)}`);
      }
    } else {
      const trace = new TraceEngine(this.params, this.weights);
      const { metrics, logs } = trace.runEconomist(schemeIds);
      this.metrics = metrics;
      this.actionLog.push(...logs);

      const conclusionEntry = logs.find((l) => l.type === 'conclusion');
      if (conclusionEntry) {
        this.conclusions.push(conclusionEntry.content);
      }
    }
  }

  /** 第四步：总工评审 */
  private async runChief(): Promise<void> {
    const schemeIds = this.candidateSchemes.map((s) => s.id);
    const useReal = this.config.mode === 'real';

    if (useReal) {
      // 校核状态注入：Chief 仲裁时把规范校核结果作为关键决策因子（对齐演示模式"总工把关"）
      const violationsNow = this.collectViolations();
      const checkStatus = violationsNow.length > 0
        ? `\n\n## ⚠️ 校核状态（重要，仲裁必读）\n仍存在未通过规范校核的方案：${violationsNow
            .map((v) => `${v.schemeName}（${v.schemeId}）：${v.summary}`)
            .join('；')}。请在比选评分中如实反映该风险，并在风险提示中注明"该方案需人工复核后方可深化"。`
        : '\n\n## ✅ 校核状态\n所有候选方案均已通过（或经迭代修正通过）抗震与防火规范校核。';
      // 人类在环：预算约束 + 锁定标注 + 备注注入（Chief 仲裁必读）
      const cap = this.humanOverrides?.budgetCap;
      const budgetStatus = cap != null
        ? (this.budgetExceededIds.length > 0
            ? `\n\n## ⚙️ 人工预算约束（重要，仲裁必读）\n工程师设定预算上限 ${cap} 万元。以下方案估算总造价超出上限，请在评分与风险提示中如实反映，并优先推荐预算内方案：${this.candidateSchemes
                .filter((sc) => this.budgetExceededIds.includes(sc.id))
                .map((sc) => `${sc.name}（${sc.id}）`)
                .join('、')}。`
            : `\n\n## ⚙️ 人工预算约束\n工程师设定预算上限 ${cap} 万元，当前所有候选方案均在预算内。`)
        : '';
      const lockNote = this.humanOverrides?.lockedSchemeIds?.length
        ? `\n\n## 🔒 人工锁定方案\n${this.humanOverrides.lockedSchemeIds
            .map((id) => this.candidateSchemes.find((sc) => sc.id === id)?.name || id)
            .join('、')}已被工程师锁定，比选时须优先考虑，不得因评分而建议替换。`
        : '';
      const humanNote = this.humanOverrides?.notes
        ? `\n\n## 📝 工程师备注\n${this.humanOverrides.notes}`
        : '';
      const prompt = buildAgentPrompt('chief', this.params) +
        `\n\n候选方案：${this.candidateSchemes.map((s) => `${s.name}（${s.id}）`).join('、')}\n` +
        `\n权重配置：${JSON.stringify(this.weights)}\n` +
        checkStatus +
        budgetStatus +
        lockNote +
        humanNote +
        '\n请调用 compare_schemes 工具进行综合对比评分，调用时必须传入 weights 参数（与上述权重配置一致），然后给出最终结论。' +
        '\n\n**输出结构必须包含以下章节（按顺序）：**' +
        '\n1. 综合推荐方案及排序（含综合得分）' +
        '\n2. 推荐理由（至少3条核心理由）' +
        '\n3. 各方案优劣势对比' +
        '\n4. **🤔 总工反思（Reflection）** —— 必须包含以下4小节：' +
        '\n   - 4.1 反向质疑：主动挑推荐方案的毛病，列出2-3个潜在风险点（「如果我是总工，我会担心什么？」）' +
        '\n   - 4.2 置信度自评：给出置信度（高/中/低）并说明理由——哪些数据充分、哪些是估算、哪些不确定' +
        '\n   - 4.3 遗漏检查：自问「有没有遗漏什么重要因素？」——如场地条件、施工可行性、业主特殊需求' +
        '\n   - 4.4 改进方向：基于反思，给出「如果再做一轮，我会改进什么」' +
        '\n5. **⚠️ 风险提示** —— 必须包含：' +
        '\n   - 这个方案最可能出问题的地方是什么' +
        '\n   - 什么情况下需要重新评估（触发条件）' +
        '\n   - 后续深化设计时重点关注什么' +
        '\n6. 下一步优化建议' +
        // P1-1：把最终裁定权交还给总工 Agent（此前它的结论只被用来当文案，推荐方案由评分 argmax 决定）
        + DECISION_BLOCK_INSTRUCTION;
      const result = await this.engine.run(prompt, 'chief');

      // 从日志中提取 compare_schemes 结果
      const compareLog = this.engine.getActionLog().find(
        (log) => log.tool === 'compare_schemes' && log.type === 'tool_result'
      );
      const compareResult = compareLog?.result as
        | {
            recommended?: { schemeId?: string; schemeName?: string; overallScore?: number };
            ranking?: Array<{ schemeId: string; schemeName: string; score: number; breakdown: Record<string, number> }>;
          }
        | { error?: string }
        | undefined;

      this.actionLog.push(...result.actionLog);
      if (result.finalAnswer) {
        this.conclusions.push(result.finalAnswer);
      }

      // P1-1：最终推荐由「总工裁定 + 代码硬约束校验」共同决定，而不是直接取评分 argmax
      const ranking =
        (compareResult as { ranking?: IAgentPipelineResult['ranking'] } | undefined)?.ranking ?? [];
      const decision = this.runChiefArbitration(
        ranking,
        parseChiefDecision(result.finalAnswer || '')
      );

      this.finalResult = {
        schemes: this.candidateSchemes,
        recommended: {
          schemeId: decision.schemeId,
          schemeName: decision.schemeName,
          overallScore: decision.overallScore,
          reason: result.finalAnswer || '',
          decisionSource: decision.decisionSource,
          decisionNote: decision.decisionNote,
          scoreTopSchemeId: decision.scoreTopSchemeId,
          ...(decision.llmChoiceSchemeId ? { llmChoiceSchemeId: decision.llmChoiceSchemeId } : {}),
          ...(decision.llmConfidence ? { llmConfidence: decision.llmConfidence } : {}),
          ...(decision.decisiveFactor ? { decisiveFactor: decision.decisiveFactor } : {}),
          ...(decision.hardConstraintViolations
            ? { hardConstraintViolations: decision.hardConstraintViolations }
            : {}),
        },
        ranking,
        codeChecks: this.codeChecks,
        metrics: this.metrics,
        advice: this.withBudgetRisk(extractAdviceFromMarkdown(result.finalAnswer || '')),
        actionLog: [...this.actionLog],
        conclusions: [...this.conclusions],
        humanOverrides: this.humanOverrides || undefined,
        budgetExceeded: [...this.budgetExceededIds],
      };
    } else {
      const trace = new TraceEngine(this.params, this.weights);
      const { recommended, ranking, advice, logs } = trace.runChief(schemeIds, this.correctionMeta);
      this.actionLog.push(...logs);

      const conclusionEntry = logs.find((l) => l.type === 'conclusion');
      if (conclusionEntry) {
        this.conclusions.push(conclusionEntry.content);
      }

      // P1-1：演示轨迹同样走裁定层，保证两种模式下「硬约束能否决评分首选」的行为一致
      const traceDecision = this.runChiefArbitration(ranking, null, 'trace');

      this.finalResult = {
        schemes: this.candidateSchemes,
        recommended: {
          schemeId: traceDecision.schemeId || recommended.schemeId,
          schemeName: traceDecision.schemeName || recommended.schemeName,
          overallScore: traceDecision.overallScore || recommended.overallScore,
          reason: recommended.reason,
          decisionSource: traceDecision.decisionSource,
          decisionNote: traceDecision.decisionNote,
          scoreTopSchemeId: traceDecision.scoreTopSchemeId,
          ...(traceDecision.hardConstraintViolations
            ? { hardConstraintViolations: traceDecision.hardConstraintViolations }
            : {}),
        },
        ranking,
        codeChecks: this.codeChecks,
        metrics: this.metrics,
        advice: this.withBudgetRisk(advice),
        actionLog: [...this.actionLog],
        conclusions: [...this.conclusions],
        humanOverrides: this.humanOverrides || undefined,
        budgetExceeded: [...this.budgetExceededIds],
      };
    }
  }

  /**
   * P1-1：总工裁定 + 代码硬约束校验。
   *
   * 旧实现直接取 compare_schemes 返回的评分 argmax 作为最终推荐，总工 Agent 的四段推理
   * 只被用来生成 reason 文案——关掉大模型功能仍能保留约 95% 的产出。
   * 现改为：大模型裁定优先，但必须过强制性条文与人工锁定两道校验；
   * 被否决时留下条文级证据并写入行动日志，让回退在界面上真实可见。
   */
  private runChiefArbitration(
    ranking: IAgentPipelineResult['ranking'],
    llmDecision: IChiefDecisionBlock | null,
    fallbackSource?: TDecisionSource
  ): IArbitratedDecision {
    const decision = arbitrateChiefDecision({
      candidates: this.candidateSchemes.map((s) => ({ id: s.id, name: s.name })),
      ranking: ranking.map((r) => ({ schemeId: r.schemeId, score: r.score })),
      codeChecks: this.codeChecks,
      llmDecision,
      ...(this.humanOverrides?.lockedSchemeIds
        ? { lockedSchemeIds: this.humanOverrides.lockedSchemeIds }
        : {}),
      ...(fallbackSource ? { fallbackSource } : {}),
    });

    // 裁定被硬约束否决时写入一条可见日志——这是回退闭环最真实的触发源
    if (decision.decisionSource === 'constraint-override') {
      this.actionLog.push({
        step: this.actionLog.length + 1,
        type: 'conclusion',
        agent: 'chief',
        content: `⛔ 强制回退：${decision.decisionNote}`,
        timestamp: Date.now(),
      });
    } else if (
      decision.decisionSource === 'llm' &&
      decision.schemeId !== decision.scoreTopSchemeId
    ) {
      this.actionLog.push({
        step: this.actionLog.length + 1,
        type: 'conclusion',
        agent: 'chief',
        content: `🔀 工程判断生效：${decision.decisionNote}`,
        timestamp: Date.now(),
      });
    }

    return decision;
  }

  /** 预算超限风险注入 advice（HITL 预算约束在建议中如实反映） */
  private withBudgetRisk(advice: IAgentPipelineResult['advice']): IAgentPipelineResult['advice'] {
    const cap = this.humanOverrides?.budgetCap;
    if (cap != null && this.budgetExceededIds.length > 0) {
      const names = this.candidateSchemes
        .filter((sc) => this.budgetExceededIds.includes(sc.id))
        .map((sc) => sc.name)
        .join('、');
      advice.risks = [
        ...(advice.risks || []),
        `⚠️ 预算超限：${names} 估算总造价超出工程师设定的 ${cap} 万元上限，需调整预算或方案后复核`,
      ];
    }
    return advice;
  }

  /** 获取当前中间状态（可选用于流式展示） */
  getState() {
    return {
      params: this.params,
      candidateSchemes: this.candidateSchemes,
      codeChecks: this.codeChecks,
      metrics: this.metrics,
      actionLog: [...this.actionLog],
      conclusions: [...this.conclusions],
    };
  }
}

/**
 * 对外统一入口：运行完整 Agent 管线
 * 参数变更或重新生成时调用，返回完整管线结果
 */
export async function runAgentPipeline(
  params: IProjectParams,
  weights?: IWeightConfig,
  config?: Partial<IEngineConfig>,
  onProgress?: (actionLog: IAgentPipelineResult['actionLog'], agentIndex: number) => void,
  onDegrade?: (reason: string) => void,
  humanOverrides?: IHumanOverrides
): Promise<IAgentPipelineResult> {
  const pipeline = new AgentPipeline(params, weights, config, onProgress, onDegrade);
  if (humanOverrides) pipeline.setHumanOverride(humanOverrides);
  return pipeline.run();
}
