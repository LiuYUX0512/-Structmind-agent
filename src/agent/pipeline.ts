// 多 Agent 协同管线（虚拟工程部）
// 四个子 Agent 按顺序执行：ArchitectAgent → CodeAgent → EconomistAgent → ChiefAgent
// 每个 Agent 有独立职责、允许调用的工具集、独立 actionLog 片段
// 最终产出统一结果结构 IAgentPipelineResult 供 UI 消费
// EXPORTS: AgentPipeline, runAgentPipeline

import { TraceEngine } from './trace-engine';
import { RealEngine, isRealModeAvailable } from './real-engine';
import {
  SUB_AGENT_SPECS,
  type IAgentPipelineResult,
  type AgentType,
  type IEngineConfig,
} from './types';
import type { IProjectParams, IWeightConfig, IStructureScheme } from '@/data/structure';
import { STRUCTURE_SYSTEM_LIBRARY, MOCK_WEIGHT_CONFIG } from '@/data/structure';

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
    const re = new RegExp(`(?:#{1,6}\s*)?[\d.]*\s*${esc}[^\n]*\n([\s\S]*?)(?=\n\s*(?:#{1,6}|$))`, 'i');
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

  private onProgress?: (actionLog: IAgentPipelineResult['actionLog'], agentIndex: number) => void;

  constructor(
    params: IProjectParams,
    weights?: IWeightConfig,
    config?: Partial<IEngineConfig>,
    onProgress?: (actionLog: IAgentPipelineResult['actionLog'], agentIndex: number) => void
  ) {
    this.params = params;
    this.weights = weights || MOCK_WEIGHT_CONFIG;
    this.config = config || {};
    this.onProgress = onProgress;
  }

  /** 阶段进度回调（供 UI 逐步展示真实模式的思考过程） */
  private emitProgress(agentIndex: number): void {
    this.onProgress?.([...this.actionLog], agentIndex);
  }

  /** 运行完整管线 */
  async run(): Promise<IAgentPipelineResult> {
    // 强制真实模式校验：用户指定 real 但配置不足时直接报错，不静默降级
    if (this.config.mode === 'real' && !isRealModeAvailable()) {
      throw new Error(
        '真实推理模式不可用：缺少有效的 API Key / 接口地址 / 模型名称。请在配置面板中填写完整，或切换到演示轨迹模式。'
      );
    }

    // 按顺序执行四个子 Agent，每完成一个阶段即回调进度（真实模式逐步展示思考过程）
    await this.runArchitect();
    this.emitProgress(1);
    await this.runCode();
    this.emitProgress(2);
    await this.runEconomist();
    this.emitProgress(3);
    await this.runChief();
    this.emitProgress(4);

    if (!this.finalResult) {
      throw new Error('管线运行异常，未生成最终结果');
    }
    return this.finalResult;
  }

  /** 第一步：方案创作工程师 */
  private async runArchitect(): Promise<void> {
    const useReal = this.config.mode === 'real' && isRealModeAvailable();

    if (useReal) {
      // 真实模式
      const engine = new RealEngine(this.params, this.weights, this.config);
      const prompt = buildAgentPrompt('architect', this.params) +
        '\n\n请调用 query_structure_systems 工具筛选出最适合本项目的 3 个候选结构方案，并给出简要的适用性评述。';
      const result = await engine.run(prompt, 'architect');

      // 解析候选方案（从日志中找 query_structure_systems 的调用结果）
      const qsResult = engine.getActionLog().find(
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
  }

  /** 第二步：规范校核工程师 */
  private async runCode(): Promise<void> {
    const schemeIds = this.candidateSchemes.map((s) => s.id);
    const useReal = this.config.mode === 'real' && isRealModeAvailable();

    if (useReal) {
      const engine = new RealEngine(this.params, this.weights, this.config);
      const prompt = buildAgentPrompt('code', this.params) +
        `\n\n候选方案：${this.candidateSchemes.map((s) => s.name).join('、')}\n` +
        '\n请对每个候选方案逐一调用 check_seismic_requirements 和 check_fire_requirements 工具进行规范校核，给出逐条判定和条文依据。';
      const result = await engine.run(prompt, 'code');

      // 尝试从日志中提取 codeChecks
      const allLogs = engine.getActionLog();
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
        const resultByCallId = new Map<string, unknown>();
        results.forEach((r) => {
          if (r.toolCallId) resultByCallId.set(r.toolCallId, r.result);
        });
        const out = new Map<string, unknown>();
        calls.forEach((call, idx) => {
          const sysId = call.args?.systemId as string | undefined;
          if (!sysId) return;
          const result = call.toolCallId ? resultByCallId.get(call.toolCallId) : results[idx]?.result;
          if (result !== undefined) out.set(sysId, result);
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
    const useReal = this.config.mode === 'real' && isRealModeAvailable();

    if (useReal) {
      const engine = new RealEngine(this.params, this.weights, this.config);
      const prompt = buildAgentPrompt('economist', this.params) +
        `\n\n候选方案：${this.candidateSchemes.map((s) => s.name).join('、')}\n` +
        '\n请对每个候选方案逐一调用 estimate_cost、estimate_schedule、estimate_precast_rate、estimate_carbon、assess_construction_risk 工具进行经济与绿色指标评估。';
      const result = await engine.run(prompt, 'economist');

      // 匹配 metrics：用 toolCallId 精确配对「systemId + toolName → result」，
      // 避免调用交错或某次结果缺失导致错位（fallback：按顺序 index）
      const toolNames = ['estimate_cost', 'estimate_schedule', 'estimate_precast_rate', 'estimate_carbon', 'assess_construction_risk'] as const;
      const callLogs = engine.getActionLog().filter(
        (log) => log.type === 'tool_call' && toolNames.includes(log.tool as typeof toolNames[number])
      );
      const resultLogs = engine.getActionLog().filter(
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
          const result = call.toolCallId ? resultByCallId.get(call.toolCallId) : resultLogs[idx]?.result;
          if (result !== undefined) resultMap.set(`${sysId}:${call.tool}`, result);
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
    const useReal = this.config.mode === 'real' && isRealModeAvailable();

    if (useReal) {
      const engine = new RealEngine(this.params, this.weights, this.config);
      const prompt = buildAgentPrompt('chief', this.params) +
        `\n\n候选方案：${this.candidateSchemes.map((s) => s.name).join('、')}\n` +
        `\n权重配置：${JSON.stringify(this.weights)}\n` +
        '\n请调用 compare_schemes 工具进行综合对比评分，然后给出最终结论。' +
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
        '\n6. 下一步优化建议';
      const result = await engine.run(prompt, 'chief');

      // 从日志中提取 compare_schemes 结果
      const compareLog = engine.getActionLog().find(
        (log) => log.tool === 'compare_schemes' && log.type === 'tool_result'
      );
      const compareResult = compareLog?.result as {
        recommended: { schemeId: string; schemeName: string; overallScore: number };
        ranking: Array<{ schemeId: string; schemeName: string; score: number; breakdown: Record<string, number> }>;
      } | undefined;

      this.actionLog.push(...result.actionLog);
      if (result.finalAnswer) {
        this.conclusions.push(result.finalAnswer);
      }

      this.finalResult = {
        schemes: this.candidateSchemes,
        recommended: {
          schemeId: compareResult?.recommended.schemeId || schemeIds[0],
          schemeName: compareResult?.recommended.schemeName || this.candidateSchemes[0]?.name || '',
          overallScore: compareResult?.recommended.overallScore || 0,
          reason: result.finalAnswer || '',
        },
        ranking: compareResult?.ranking || [],
        codeChecks: this.codeChecks,
        metrics: this.metrics,
        advice: extractAdviceFromMarkdown(result.finalAnswer || ''),
        actionLog: [...this.actionLog],
        conclusions: [...this.conclusions],
      };
    } else {
      const trace = new TraceEngine(this.params, this.weights);
      const { recommended, ranking, advice, logs } = trace.runChief(schemeIds, this.correctionMeta);
      this.actionLog.push(...logs);

      const conclusionEntry = logs.find((l) => l.type === 'conclusion');
      if (conclusionEntry) {
        this.conclusions.push(conclusionEntry.content);
      }

      this.finalResult = {
        schemes: this.candidateSchemes,
        recommended,
        ranking,
        codeChecks: this.codeChecks,
        metrics: this.metrics,
        advice,
        actionLog: [...this.actionLog],
        conclusions: [...this.conclusions],
      };
    }
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
  onProgress?: (actionLog: IAgentPipelineResult['actionLog'], agentIndex: number) => void
): Promise<IAgentPipelineResult> {
  const pipeline = new AgentPipeline(params, weights, config, onProgress);
  return pipeline.run();
}
