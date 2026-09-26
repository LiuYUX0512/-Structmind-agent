// RealEngine 真实推理引擎（LLM function calling）
// 支持 OpenAI 兼容 API（DeepSeek / 通义千问等）
// 通过 function calling 循环：请求 LLM → tool_calls → 执行 executor → 回传结果 → 继续请求
// EXPORTS: RealEngine

import { executeToolByName, TOOL_REGISTRY } from './tools';
import type { IAgentActionLog, IEngineConfig } from './types';
import type { IProjectParams, IWeightConfig } from '@/data/structure';
import { logger } from '@lark-apaas/client-toolkit-lite';
import { scopedStorage } from '@lark-apaas/client-toolkit-lite';

// ============ 配置持久化 ============

const CONFIG_STORAGE_KEY = 'agent_engine_config';

/**
 * 规范化 API Endpoint：
 * - 去掉尾部斜杠
 * - 裸域名（path 为空或 '/'）自动补 /v1（OpenAI 兼容协议惯例）
 * 避免用户填 https://api.deepseek.com 时拼接出 /chat/completions 404
 */
export function normalizeEndpoint(endpoint: string): string {
  let url = endpoint.trim().replace(/\/+$/, '');
  try {
    const u = new URL(url);
    if (u.pathname === '' || u.pathname === '/') {
      url = url + '/v1';
    }
  } catch {
    // 非法 URL：原样返回，让请求阶段报错
  }
  return url;
}

export function saveEngineConfig(config: Partial<IEngineConfig>): void {
  try {
    const existing = loadEngineConfig();
    const merged = { ...existing, ...config };
    scopedStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(merged));
  } catch (e) {
    logger.warn('保存引擎配置失败:', String(e));
  }
}

export function loadEngineConfig(): Partial<IEngineConfig> {
  try {
    const raw = scopedStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<IEngineConfig>;
  } catch {
    return {};
  }
}

// ============ LLM Chat Completion 类型 ============

interface ILLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
  name?: string;
}

interface ILLMToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

// ============ System Prompt ============

const DEFAULT_SYSTEM_PROMPT = `你是一位拥有30年从业经验的资深注册结构工程师总工，精通各类建筑结构体系选型、抗震设计、规范校核、经济评估和绿色低碳设计。

你的工作方式：
1. 接到项目参数后，先分析关键控制因素（高度、跨度、烈度、场地、预算）
2. 调用 query_structure_systems 工具筛选候选结构体系
3. 对候选方案逐一进行规范校核（check_seismic_requirements、check_fire_requirements）
4. 对候选方案进行经济与绿色指标评估（estimate_cost / estimate_schedule / estimate_precast_rate / estimate_carbon / assess_construction_risk）
5. 必要时调用 advise_foundation 给出基础方案建议
6. 最后调用 compare_schemes 进行综合比选并给出推荐方案

回答要求：
- 所有技术判断必须有规范依据，引用具体规范名称和条文号
- 数值结论必须通过工具调用获得，不要凭空估算
- 推荐方案要给出明确理由和优缺点分析
- 保持专业、严谨、审慎的总工语气

你的回复使用 Markdown 格式，便于渲染。`;

// ============ RealEngine 主类 ============

export class RealEngine {
  private config: IEngineConfig;
  private params: IProjectParams;
  private weights: IWeightConfig;
  private actionLog: IAgentActionLog[] = [];
  private stepCounter = 0;
  private messages: ILLMMessage[] = [];

  constructor(params: IProjectParams, weights: IWeightConfig, config?: Partial<IEngineConfig>) {
    const savedConfig = loadEngineConfig();
    const rawEndpoint = (config?.endpoint || savedConfig.endpoint || 'https://api.deepseek.com/v1').trim();
    this.config = {
      mode: 'real',
      model: 'deepseek-chat',
      maxSteps: 20,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      ...savedConfig,
      ...config,
      endpoint: normalizeEndpoint(rawEndpoint),
    };
    this.params = params;
    this.weights = weights;
  }

  /** 追加日志 */
  private pushLog(entry: Omit<IAgentActionLog, 'step' | 'timestamp'>): void {
    this.stepCounter += 1;
    this.actionLog.push({
      ...entry,
      step: this.stepCounter,
      timestamp: Date.now(),
    });
  }

  /** 构造 tools 列表（OpenAI function calling 格式） */
  private buildToolsDefinition(): ILLMToolDefinition[] {
    return TOOL_REGISTRY.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: tool.parameters.properties as Record<string, unknown>,
          required: tool.parameters.required,
        },
      },
    }));
  }

  /** 执行一次 LLM 请求 */
  private async callLLM(messages: ILLMMessage[]): Promise<ILLMMessage> {
    if (!this.config.endpoint || !this.config.apiKey) {
      throw new Error('未配置 API Endpoint 或 API Key');
    }

    const controller = new AbortController();
    const timeoutMs = 30000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.config.endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          tools: this.buildToolsDefinition(),
          tool_choice: 'auto',
          temperature: 0.3,
          stream: false,
        }),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const aborted = (e as Error)?.name === 'AbortError';
      throw new Error(
        aborted
          ? `LLM 请求超时（${timeoutMs / 1000}s），请检查网络或 API 服务状态`
          : `LLM 请求失败：${String(e).slice(0, 200)}`
      );
    }
    clearTimeout(timer);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM 请求失败 (${response.status}): ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: ILLMMessage }>;
      usage: { total_tokens: number };
    };

    if (!data.choices?.[0]?.message) {
      throw new Error('LLM 返回格式异常');
    }

    return data.choices[0].message;
  }

  /** 执行工具调用并返回结果消息 */
  private async executeToolCall(toolCall: {
    id: string;
    function: { name: string; arguments: string };
  }): Promise<ILLMMessage> {
    const { name, arguments: argsStr } = toolCall.function;
    const toolCallId = toolCall.id;
    let args: Record<string, unknown> = {};

    // 无论参数解析是否成功，都先记录 tool_call 日志，保证 tool_call/tool_result 严格 1:1 可配对
    this.pushLog({
      type: 'tool_call',
      content: `调用工具：${name}`,
      tool: name,
      args,
      toolCallId,
    });

    try {
      args = JSON.parse(argsStr);
    } catch {
      const errMsg = '参数解析失败，不是合法 JSON';
      this.pushLog({
        type: 'tool_result',
        content: `工具 ${name} 执行失败：${errMsg}`,
        tool: name,
        result: { error: errMsg },
        toolCallId,
      });
      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({ error: errMsg }),
      };
    }

    try {
      const result = executeToolByName(name, args);
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

      this.pushLog({
        type: 'tool_result',
        content: `工具 ${name} 执行完成`,
        tool: name,
        result: result as unknown,
        toolCallId,
      });

      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: resultStr.length > 8000
          ? resultStr.slice(0, 8000) + '\n... [结果已截断，仅保留前 8000 字符]'
          : resultStr,  // 限制上下文长度，截断时标注
      };
    } catch (e) {
      const errMsg = String(e);
      this.pushLog({
        type: 'tool_result',
        content: `工具 ${name} 执行失败：${errMsg}`,
        tool: name,
        result: { error: errMsg },
        toolCallId,
      });
      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({ error: errMsg }),
      };
    }
  }

  /**
   * 运行完整推理循环（非流式）
   * 遵循 plan → act → observe → reflect agentic loop
   */
  async run(userPrompt: string, agentLabel = 'real'): Promise<{
    finalAnswer: string;
    actionLog: IAgentActionLog[];
  }> {
    // 初始化 messages
    this.messages = [
      {
        role: 'system',
        content: this.config.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ];

    this.pushLog({
      type: 'think',
      agent: agentLabel as IAgentActionLog['agent'],
      content: '收到任务，开始推理分析...',
    });

    // Agentic Loop
    for (let step = 0; step < this.config.maxSteps; step++) {
      const response = await this.callLLM(this.messages);
      this.messages.push(response);

      // 没有工具调用 → 最终回答
      if (!response.tool_calls || response.tool_calls.length === 0) {
        this.pushLog({
          type: 'conclusion',
          agent: agentLabel as IAgentActionLog['agent'],
          content: response.content || '(无内容)',
        });
        return {
          finalAnswer: response.content || '',
          actionLog: [...this.actionLog],
        };
      }

      // 执行所有工具调用
      this.pushLog({
        type: 'think',
        agent: agentLabel as IAgentActionLog['agent'],
        content: `需要调用 ${response.tool_calls.length} 个工具来获取数据...`,
      });

      for (const toolCall of response.tool_calls) {
        const toolResultMsg = await this.executeToolCall(toolCall);
        this.messages.push(toolResultMsg);
      }

      // 循环继续，把工具结果回传 LLM
    }

    // 超过最大步数
    this.pushLog({
      type: 'conclusion',
      agent: agentLabel as IAgentActionLog['agent'],
      content: `推理已达到最大步数（${this.config.maxSteps} 步），已尽力完成分析。`,
    });

    // 返回最后一条 assistant 消息的内容
    const lastAssistant = [...this.messages].reverse().find((m) => m.role === 'assistant');
    return {
      finalAnswer: lastAssistant?.content || '',
      actionLog: [...this.actionLog],
    };
  }

  /** 获取行动日志 */
  getActionLog(): IAgentActionLog[] {
    return [...this.actionLog];
  }
}

/** 检查是否配置了真实模式所需的参数 */
export function isRealModeAvailable(): boolean {
  const config = loadEngineConfig();
  return !!(config.endpoint && config.apiKey && config.model);
}
