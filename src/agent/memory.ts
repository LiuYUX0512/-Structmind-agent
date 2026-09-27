// 记忆系统（模块②）—— 主动式记忆，而非被动 RAG
//
// 三个子系统（对应蓝图 L2 的注入源）：
//   1. 短期记忆：事件驱动压缩。Agent 轨迹超阈值 → compress() 提炼 3~5 条事实摘要，
//      注入下一个 Agent，原始日志归档。
//   2. 长期记忆：主动注入。runAgentPipeline 启动时扫描参数，命中历史偏好则主动
//      拼接记忆提示（不等 Planner 询问）。
//   3. 经验记忆：闭环激活。Chief 的策略反思 → 结构化经验 → 下次 Planner 真实修改
//      DAG 拓扑（如 Architect 后插入预校核节点）。
//
// 零重依赖约束：词频向量（1-gram + 2-gram）+ 余弦相似度，localStorage（scopedStorage）
//   持久化。IEmbedder 接口保留，未来可无缝替换真 embedding RAG。
//
// 关键约束：
//   - trigger 必须是纯函数（只依赖传入 ctx，禁止读 localStorage / 发网络请求），
//     保证回归可测。持久化时 trigger 不可序列化，由 conditions 重建。
//   - 冷启动：本地库为空时静默生成默认偏好/经验，不报错。
//
// EXPORTS: IEmbedder, BagOfWordsEmbedder, estimateTokens,
//          ICompressor, RuleCompressor, LlmCompressor,
//          IPreference, IExperience, IExperienceCondition, IMemoryTriggerContext,
//          IMemoryEvent, MemorySystem, matchesConditions, tokenize

import type { IAgentActionLog } from './types';
import type { IProjectParams } from '@/data/structure';
import { scopedStorage, logger } from '@lark-apaas/client-toolkit-lite';

// ============ 存储键 ============

const PREF_KEY = 'agent_memory_preferences';
const EXP_KEY = 'agent_memory_experiences';

// ============ 词频向量 Embedder ============

/** 向量化接口（默认词频向量，未来可替换真 embedding RAG） */
export interface IEmbedder {
  /** 文本 → 稠密向量（固定维度，哈希桶） */
  embed(text: string): number[];
  /** 余弦相似度 */
  similarity(a: number[], b: number[]): number;
}

/** 中文 1-gram + 2-gram 切词（纯函数，可测试） */
export function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const tokens: string[] = [];
  const cjk = normalized.match(/[\u4e00-\u9fa5]+/g) ?? [];
  const latin = normalized.match(/[a-z0-9]+/g) ?? [];
  for (const seg of cjk) {
    for (const ch of seg) tokens.push(ch); // 1-gram
    for (let i = 0; i < seg.length - 1; i++) tokens.push(seg.slice(i, i + 2)); // 2-gram
  }
  for (const w of latin) tokens.push(w);
  return tokens;
}

function hashToken(token: string, dim: number): number {
  let h = 0;
  for (let i = 0; i < token.length; i++) {
    h = (h * 31 + token.charCodeAt(i)) >>> 0;
  }
  return h % dim;
}

/** 词频向量（1-gram + 2-gram，哈希到固定维度，零外部依赖） */
export class BagOfWordsEmbedder implements IEmbedder {
  private readonly dim: number;

  constructor(dim = 256) {
    this.dim = dim;
  }

  embed(text: string): number[] {
    const vec = new Array<number>(this.dim).fill(0);
    for (const t of tokenize(text)) {
      vec[hashToken(t, this.dim)] += 1;
    }
    return vec;
  }

  similarity(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < n; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }
}

// ============ Token 估算（零 tokenizer 依赖） ============

/** 保守估算 token 数：中文 ≈ 1 token/字，英文/数字 ≈ 4 字符/token */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fa5]/.test(ch)) cjk++;
    else if (!/\s/.test(ch)) other++;
  }
  return Math.ceil(cjk + other / 4);
}

// ============ 压缩器 ============

export interface ICompressor {
  /** 把日志提炼成 3~5 条事实摘要 */
  compress(logs: IAgentActionLog[]): Promise<string[]>;
}

/**
 * 确定性规则压缩（trace 模式 / 无 LLM 时兜底）。
 * 红线 1：压缩只抽取既有事实（结论 + 工具调用要点），绝不编造。
 */
export class RuleCompressor implements ICompressor {
  async compress(logs: IAgentActionLog[]): Promise<string[]> {
    const facts: string[] = [];

    // 1. 结论
    for (const log of logs) {
      if (log.type === 'conclusion' && log.content) {
        facts.push(log.content.slice(0, 120));
        if (facts.length >= 5) break;
      }
    }

    // 2. 工具调用要点
    const tools = new Set<string>();
    for (const log of logs) {
      if (log.type === 'tool_call' && log.tool) tools.add(log.tool);
    }
    if (tools.size > 0 && facts.length < 5) {
      facts.push(`本阶段调用工具：${[...tools].join('、')}`);
    }

    // 3. 关键 think（含「未通过」「超限」「违规」等判定语义）
    if (facts.length < 5) {
      for (const log of logs) {
        if (log.type === 'think' && log.content && /未通过|超限|违规|不满足|风险|建议/.test(log.content)) {
          facts.push(log.content.slice(0, 120));
          if (facts.length >= 5) break;
        }
      }
    }

    // 4. 兜底：日志既无结论也无关键词时，抽取前几条非空内容（保证压缩永不产出空摘要）
    if (facts.length === 0) {
      for (const log of logs) {
        if (log.content && log.content.trim()) {
          facts.push(log.content.slice(0, 120));
          if (facts.length >= 3) break;
        }
      }
    }

    return facts.slice(0, 5);
  }
}

/**
 * LLM 压缩（real 模式）。
 * 关键隔离：summarize 是「独立无状态请求」——不复用主链路的 messages，
 * 不写回 actionLog。由调用方传入（pipeline 复用 RealEngine 的 endpoint/apiKey，
 * 但独立发起一次性请求）。
 */
export class LlmCompressor implements ICompressor {
  constructor(private readonly summarize: (text: string, instruction: string) => Promise<string>) {}

  async compress(logs: IAgentActionLog[]): Promise<string[]> {
    const text = logs
      .map((l) => `[${l.type}]${l.agent ? `(${l.agent})` : ''} ${l.tool ? `tool=${l.tool} ` : ''}${l.content ?? ''}`)
      .join('\n')
      .slice(0, 8000);
    const instruction =
      '你是记忆压缩器。请把下面的 Agent 执行日志提炼成 3~5 条事实摘要，每条一句话，只陈述既有事实，严禁编造。用换行分隔，不要编号、不要多余解释。';
    try {
      const summary = await this.summarize(text, instruction);
      return summary
        .split('\n')
        .map((s) => s.replace(/^[-*•\d.、\s]+/, '').trim())
        .filter((s) => s.length > 2)
        .slice(0, 5);
    } catch (e) {
      // 摘要失败不阻断主链路：降级为规则压缩
      logger.warn('LLM 摘要失败，降级为规则压缩:', String(e));
      return new RuleCompressor().compress(logs);
    }
  }
}

// ============ 长期偏好 ============

export interface IPreference {
  id: string;
  /** 特征键（分桶检索） */
  featureKey: string;
  /** 偏好原文（用于展示与向量化） */
  text: string;
  /** 来源 */
  source: 'auto' | 'manual';
  /** 命中次数（排序用） */
  hits: number;
  ts: number;
}

// ============ 经验记忆 ============

/** trigger 的纯函数输入（只包含判断所需字段，可序列化） */
export interface IMemoryTriggerContext {
  params: IProjectParams;
  realMode: boolean;
  allowRecheck: boolean;
}

export type ExperienceField =
  | 'seismicIntensity'
  | 'floors'
  | 'budget'
  | 'structurePreference'
  | 'realMode'
  | 'allowRecheck';

export interface IExperienceCondition {
  field: ExperienceField;
  op: 'eq' | 'gte' | 'lte';
  value: string | number | boolean;
}

export interface IExperience {
  id: string;
  /** 拓扑操作类型 */
  kind: 'insert-precheck' | 'skip-node' | 'reorder';
  /** 作用于哪个节点 */
  applyTo: string;
  /** 人类可读教训 */
  lesson: string;
  /** 特征键（分桶） */
  featureKey: string;
  /** 声明式激活条件（可序列化，持久化用） */
  conditions: IExperienceCondition[];
  ts: number;
  /**
   * 运行时纯函数 trigger（不持久化，由 conditions 重建）。
   * 纯函数约束：只依赖传入 ctx，禁止读 localStorage / 发网络请求。
   */
  trigger: (ctx: IMemoryTriggerContext) => boolean;
}

/** 纯函数：条件匹配（经验激活判断，可测试） */
export function matchesConditions(conditions: IExperienceCondition[], ctx: IMemoryTriggerContext): boolean {
  return conditions.every((c) => {
    const val = readField(c.field, ctx);
    if (val == null) return false;
    switch (c.op) {
      case 'eq':
        return val === c.value || String(val) === String(c.value);
      case 'gte': {
        // 数值比较：字段可能是字符串（如 seismicIntensity='8'），统一 Number 化
        const num = Number(val);
        return !Number.isNaN(num) && num >= Number(c.value);
      }
      case 'lte': {
        const num = Number(val);
        return !Number.isNaN(num) && num <= Number(c.value);
      }
      default:
        return false;
    }
  });
}

function readField(field: ExperienceField, ctx: IMemoryTriggerContext): string | number | boolean | undefined {
  switch (field) {
    case 'seismicIntensity':
      return ctx.params.seismicIntensity;
    case 'floors':
      return ctx.params.floors;
    case 'budget':
      return ctx.params.budget;
    case 'structurePreference':
      return ctx.params.structurePreference;
    case 'realMode':
      return ctx.realMode;
    case 'allowRecheck':
      return ctx.allowRecheck;
    default:
      return undefined;
  }
}

// ============ 记忆事件（供 pipeline 转成 actionLog，记忆可见化） ============

export interface IMemoryEvent {
  kind: 'compress' | 'preference-inject' | 'experience-activate' | 'experience-store' | 'cold-start';
  message: string;
}

// ============ 冷启动默认库 ============

/** 全局默认偏好（冷启动：本地库为空时静默注入，不报错） */
function defaultPreferences(): IPreference[] {
  const now = Date.now();
  return [
    {
      id: 'default-high-intensity',
      featureKey: 'seismic-8',
      text: '高烈度区（8度及以上）项目，优先考虑抗震性能更优的剪力墙 / 框架-剪力墙体系',
      source: 'manual',
      hits: 0,
      ts: now,
    },
    {
      id: 'default-low-budget',
      featureKey: 'budget-low',
      text: '预算紧张的项目，优先控制结构造价，兼顾工期',
      source: 'manual',
      hits: 0,
      ts: now,
    },
  ];
}

/** 内置默认经验（trigger 纯函数由 rebuildTrigger 重建，冷启动用） */
function defaultExperiences(): Array<Omit<IExperience, 'trigger'>> {
  const now = Date.now();
  return [
    {
      id: 'default-precheck-high-intensity',
      kind: 'insert-precheck',
      applyTo: 'architect',
      lesson: '高烈度区框架结构易在选型阶段埋下校核违规，宜在选型后立即预校核',
      featureKey: 'seismic-8',
      conditions: [
        { field: 'seismicIntensity', op: 'gte', value: 8 },
        { field: 'realMode', op: 'eq', value: true },
      ],
      ts: now,
    },
  ];
}

// ============ 记忆系统主类 ============

export class MemorySystem {
  private readonly embedder: IEmbedder;
  private preferences: IPreference[] = [];
  private experiences: IExperience[] = [];

  constructor(embedder?: IEmbedder) {
    this.embedder = embedder ?? new BagOfWordsEmbedder();
    this.load();
  }

  // ---------- 持久化 ----------

  private load(): void {
    this.preferences = this.readJSON<IPreference[]>(PREF_KEY) ?? [];
    this.experiences = this.readJSON<Array<Omit<IExperience, 'trigger'>>>(EXP_KEY)?.map(rebuildTrigger) ?? [];
    // 冷启动：本地库为空时静默生成默认库（不报错）
    if (this.preferences.length === 0) {
      this.preferences = defaultPreferences();
      this.writeJSON(PREF_KEY, this.preferences);
    }
    if (this.experiences.length === 0) {
      this.experiences = defaultExperiences().map(rebuildTrigger);
      this.persistExperiences();
    }
  }

  private readJSON<T>(key: string): T | null {
    try {
      const raw = scopedStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private writeJSON(key: string, value: unknown): void {
    try {
      scopedStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      logger.warn('记忆持久化失败:', String(e));
    }
  }

  private persistExperiences(): void {
    // trigger 函数不可序列化，剥离后存储
    this.writeJSON(
      EXP_KEY,
      this.experiences.map(({ trigger: _t, ...rest }) => rest)
    );
  }

  // ---------- 短期记忆：事件驱动压缩 ----------

  /** 检查是否需要压缩；超阈值则压缩并返回摘要 + 事件 */
  async maybeCompress(
    logs: IAgentActionLog[],
    threshold: number,
    compressor: ICompressor
  ): Promise<{ triggered: boolean; summary?: string; event?: IMemoryEvent }> {
    const text = logs.map((l) => l.content ?? '').join('\n');
    const tokens = estimateTokens(text);
    if (tokens <= threshold) {
      return { triggered: false };
    }

    const facts = await compressor.compress(logs);
    const summary = facts.map((f) => `· ${f}`).join('\n');
    return {
      triggered: true,
      summary,
      event: {
        kind: 'compress',
        message: `[Memory] 检测到上下文过长（约 ${tokens} token，阈值 ${threshold}），已自动压缩为 ${facts.length} 条事实摘要`,
      },
    };
  }

  // ---------- 长期记忆：主动注入 ----------

  /** 扫描参数 → 命中历史偏好（词频向量 + 余弦相似度） */
  scanPreferences(params: IProjectParams): { prefs: IPreference[]; events: IMemoryEvent[] } {
    const query = buildPreferenceQuery(params);
    const qvec = this.embedder.embed(query);
    const scored = this.preferences
      .map((p) => ({ p, sim: this.embedder.similarity(qvec, this.embedder.embed(p.text)) }))
      .filter((x) => x.sim > 0.05)
      .sort((a, b) => b.sim - a.sim || b.p.hits - a.p.hits)
      .slice(0, 3);

    const events: IMemoryEvent[] = [];
    if (scored.length > 0) {
      const first = scored[0];
      events.push({
        kind: 'preference-inject',
        message: `[Memory] 已注入历史偏好：${first.p.text.slice(0, 60)}`,
      });
    }
    return { prefs: scored.map((x) => x.p), events };
  }

  /** 生成偏好提示文本（注入子 Agent prompt / Planner 上下文） */
  buildPreferenceHint(prefs: IPreference[]): string {
    if (prefs.length === 0) return '';
    return '⚠️ 记忆提示：\n' + prefs.map((p) => `- ${p.text}`).join('\n');
  }

  /** 主动写入：运行结束后提炼一句偏好存入库（不等用户手动存） */
  storePreference(text: string, featureKey: string): IPreference {
    const pref: IPreference = {
      id: `pref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      featureKey,
      text,
      source: 'auto',
      hits: 0,
      ts: Date.now(),
    };
    this.preferences.push(pref);
    // 去重：相似文本只保留最新
    const deduped = this.preferences.filter(
      (p, i, arr) => arr.findIndex((x) => this.embedder.similarity(this.embedder.embed(x.text), this.embedder.embed(p.text)) > 0.9) === i
    );
    this.preferences = deduped.slice(-20);
    this.writeJSON(PREF_KEY, this.preferences);
    return pref;
  }

  // ---------- 经验记忆：闭环激活 ----------

  /** 读取命中当前上下文的经验（供 Planner 修改拓扑） */
  recallExperiences(ctx: IMemoryTriggerContext): { experiences: IExperience[]; events: IMemoryEvent[] } {
    const hit = this.experiences.filter((e) => e.trigger(ctx));
    const events = hit.map((e) => ({
      kind: 'experience-activate' as const,
      message: `[Memory] 触发经验闭环：${e.lesson.slice(0, 60)}`,
    }));
    return { experiences: hit, events };
  }

  /** 存入经验（Chief 反思 → 结构化经验） */
  storeExperience(exp: Omit<IExperience, 'trigger'>): IExperience {
    const full = rebuildTrigger(exp);
    this.experiences.push(full);
    this.experiences = this.experiences.slice(-30);
    this.persistExperiences();
    return full;
  }

  /** 测试辅助：清空记忆（回归隔离用） */
  clear(): void {
    this.preferences = [];
    this.experiences = [];
    scopedStorage.removeItem(PREF_KEY);
    scopedStorage.removeItem(EXP_KEY);
  }
}

// ============ 辅助 ============

function rebuildTrigger(data: Omit<IExperience, 'trigger'>): IExperience {
  return {
    ...data,
    trigger: (ctx: IMemoryTriggerContext) => matchesConditions(data.conditions, ctx),
  };
}

/** 从参数构造检索 query（提取特征键相关字段） */
function buildPreferenceQuery(params: IProjectParams): string {
  const parts: string[] = [];
  if (params.buildingType) parts.push(`建筑类型${params.buildingType}`);
  if (params.seismicIntensity) parts.push(`设防烈度${params.seismicIntensity}度`);
  if (params.floors) parts.push(`${params.floors}层`);
  if (params.budget) parts.push(`预算${params.budget}`);
  if (params.structurePreference && params.structurePreference !== 'any') {
    parts.push(`体系偏好${params.structurePreference}`);
  }
  if (params.soilCategory) parts.push(`场地${params.soilCategory}类`);
  return parts.join(' ');
}
