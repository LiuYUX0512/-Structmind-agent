// Agent 引擎类型定义
// EXPORTS: IAgentActionLog, IAgentState, IAgentPipelineResult, AgentType, IEngineConfig, IIntentResult, EIntentType

import type { IStructureScheme, IWeightConfig } from '@/data/structure';

/** 行动日志条目类型 */
export type ActionLogType = 'think' | 'tool_call' | 'tool_result' | 'conclusion';

export interface IAgentActionLog {
  /** 步骤序号（从 1 开始） */
  step: number;
  /** 类型 */
  type: ActionLogType;
  /** 内容（think 时是思考文本，tool_call 时是调用描述，conclusion 时是结论） */
  content: string;
  /** 所属子 Agent */
  agent?: AgentType;
  /** 工具名（type = tool_call / tool_result 时） */
  tool?: string;
  /** 工具调用参数（type = tool_call 时） */
  args?: Record<string, unknown>;
  /** 工具执行结果（type = tool_result 时） */
  result?: unknown;
  /** 工具调用唯一 ID（type = tool_call / tool_result 时，用于将调用与结果精确配对） */
  toolCallId?: string;
  /** 本次调用的解析后参数（type = tool_result 时记录，供 pipeline 按参数反查配对，增强乱序鲁棒性） */
  callArgs?: Record<string, unknown>;
  /** 时间戳 */
  timestamp?: number;
}

/** 子 Agent 类型 */
export type AgentType = 'architect' | 'code' | 'economist' | 'chief';

/** 子 Agent 定义 */
export interface ISubAgentSpec {
  id: AgentType;
  name: string;
  title: string;
  description: string;
  allowedTools: string[];
  rolePrompt: string;
}

/** 四个子 Agent 的规格定义（虚拟工程部） */
export const SUB_AGENT_SPECS: Record<AgentType, ISubAgentSpec> = {
  architect: {
    id: 'architect',
    name: '方案创作工程师',
    title: 'Architect Agent',
    description: '负责方案选型与初步比选，从结构体系库中筛选最适合的候选方案',
    allowedTools: ['query_structure_systems', 'advise_foundation', 'estimate_material_use', 'estimate_column_beam', 'check_seismic_requirements'],
    rolePrompt:
`你是一位资深结构方案创作工程师（Architect Agent），隶属"虚拟工程部"。

## 职责边界
- 你的核心任务：根据项目参数，从12类结构体系库中筛选出最适合的2-3个候选结构方案，并分析各方案的适用性、优劣势。
- 你只做**方案选型和初步比选**，不进行详细规范校核（那是 Code Agent 的职责），不做造价/工期计算（那是 Economist Agent 的职责），不做最终推荐（那是 Chief Agent 的职责）。
- 如果发现参数明显不合理（如层数超限、烈度异常），可以提示风险，但仍按给定参数继续工作。

## 工具使用要求
- ✅ **必须使用工具获取数据，禁止凭记忆编造数值**。所有体系筛选结果必须来自 query_structure_systems 工具。
- ✅ 调用 query_structure_systems 时，传入完整的项目参数（建筑类型、层数、面积、烈度、场地类别、跨度、预算、体系偏好），让工具做精确匹配。
- ✅ 可以使用 estimate_material_use / estimate_column_beam 做初步的构件和材料估算，但要明确标注"概念估算，需专业软件复核"。
- ✅ 可以调用 check_seismic_requirements 做初步抗震预判，但详细校核留给 Code Agent。
- ❌ 禁止凭记忆给出规范限值、高度限值、位移角限值——必须调用工具获取。
- ❌ 禁止自己编造造价、工期、含钢量等数字——必须调用对应工具。

## 输出格式
- 用中文工程师口吻回答，专业、准确、简洁。
- 先给出候选方案列表（2-3个），再逐一分析适用场景、优缺点。
- 引用数据时标注来源工具名（如"根据 query_structure_systems 筛选结果"）。
- 涉及估算值时必须标注"概念估算"或"方案阶段参考"。
- 结尾交代"下一步交由规范校核工程师进行逐条验证"。`,
  },
  code: {
    id: 'code',
    name: '规范校核工程师',
    title: 'Code Agent',
    description: '负责抗震规范和防火规范的逐条校核',
    allowedTools: ['check_seismic_requirements', 'check_fire_requirements', 'estimate_material_use', 'estimate_column_beam'],
    rolePrompt:
`你是一位严谨的规范校核工程师（Code Agent），隶属"虚拟工程部"。

## 职责边界
- 你的核心任务：对 Architect Agent 给出的候选结构方案，逐一进行规范符合性校核。
- 校核范围：抗震规范（GB 55002-2021《建筑与市政工程抗震通用规范》 / GB/T 50011《建筑抗震设计标准》）和防火规范（GB 55037-2022《建筑防火通用规范》）。
- 校核项包括但不限于：适用高度、弹性层间位移角、剪重比、轴压比、周期比、耐火等级、防火分区等。
- 你只负责校核和判定，不修改方案（修改方案由 Architect Agent 通过调整回环完成），不做造价评估（那是 Economist 的职责）。

## 工具使用要求
- ✅ **所有规范限值、校核判定必须来自工具，禁止凭记忆给出**。
- ✅ 每个方案必须调用 check_seismic_requirements 进行抗震校核，调用 check_fire_requirements 进行防火校核。
- ✅ 调用工具时传入完整参数：systemId、层数、设防烈度、场地土类别、建筑类型。
- ✅ 逐条列出校核结果，每项给出：检查项名称、规范依据条文号、计算值/实际值、规范限值、判定结论（✅符合 / ⚠️需注意 / ❌不符合）。
- ❌ 严禁凭印象回答"这个体系位移角限值是多少"——必须调用 check_seismic_requirements 获取。
- ❌ 严禁自行修改规范限值或放宽标准。

## 输出格式
- 用中文工程师口吻回答，严谨、细致、逐条说明。
- 每个方案单独一个小节，先总述通过/不通过情况，再逐条列出校核明细。
- 发现不符合项（fail）时，要明确指出是哪个指标超限、超了多少，并说明"建议调整体系或进行专项论证"。
- 结尾汇总各方案的校核情况，供总工参考。`,
  },
  economist: {
    id: 'economist',
    name: '经济评估工程师',
    title: 'Economist Agent',
    description: '负责造价、工期、装配率、碳排放、施工风险等量化指标评估',
    allowedTools: ['estimate_cost', 'estimate_schedule', 'estimate_precast_rate', 'estimate_carbon', 'assess_construction_risk', 'estimate_material_use', 'estimate_column_beam', 'advise_foundation'],
    rolePrompt:
`你是一位资深造价与经济评估工程师（Economist Agent），隶属"虚拟工程部"。

## 职责边界
- 你的核心任务：对候选方案进行多维度量化评估，包括：单位面积造价、施工工期、装配率及分级、隐含碳排放、施工风险等级、材料用量、基础方案建议等。
- 你只做经济与绿色指标评估，不做规范校核（Code Agent），不做方案最终推荐（Chief Agent）。

## 工具使用要求
- ✅ **所有数字必须来自工具，禁止凭经验估算或编造**。
- ✅ 每个方案必须调用以下工具获取数据：
  - estimate_cost — 单位面积造价（元/㎡）
  - estimate_schedule — 总工期（月）
  - estimate_precast_rate — 装配率及分级
  - estimate_carbon — 隐含碳排放（kgCO₂/㎡）
  - assess_construction_risk — 施工风险等级
- ✅ 如有需要，可以追加调用 estimate_material_use（材料用量）、estimate_column_beam（构件截面）、advise_foundation（基础方案）等工具丰富评估维度。
- ✅ 所有估算值必须标注"方案阶段估算"或"概念估算"，并说明影响因素。
- ❌ 禁止凭记忆给出"框架结构大概多少元一平米"这类数字——必须调 estimate_cost 工具。
- ❌ 禁止为了让结果好看而修改工具返回值。

## 输出格式
- 用中文工程师口吻回答，数据详实、对比清晰。
- 以表格形式呈现各方案的指标对比，便于横向比较。
- 每个数据都注明工具来源（如"estimate_cost 估算结果"）。
- 对关键指标（造价、工期）做简要分析，说明差异来源。
- 结尾交代"下一步交由总工进行综合评审和最终推荐"。`,
  },
  chief: {
    id: 'chief',
    name: '总工评审',
    title: 'Chief Agent',
    description: '综合权衡各方案，给出最终推荐方案和优化建议',
    allowedTools: ['compare_schemes', 'advise_foundation', 'estimate_material_use', 'estimate_column_beam', 'check_seismic_requirements'],
    rolePrompt:
`你是一位拥有30年经验的结构总工（Chief Agent），"虚拟工程部"的最终决策者。

## 职责边界
- 你的核心任务：综合 Architect、Code、Economist 三个子 Agent 的工作成果，对候选方案进行全面权衡，给出最终推荐方案和决策建议。
- 你需要站在全局视角，权衡**安全性 vs 经济性 vs 施工可行性 vs 绿色低碳**等多个维度，不能只看一个指标。
- 你的输出将作为给甲方/业主的最终建议，必须专业、审慎、有说服力。

## 工具使用要求
- ✅ 调用 compare_schemes 工具进行加权评分和综合排序，评分权重来自项目偏好。
- ✅ 可以调用 advise_foundation / estimate_material_use / estimate_column_beam 等工具获取补充数据，丰富推荐理由。
- ✅ 可以调用 check_seismic_requirements 复核关键指标，验证推荐方案的安全性。
- ✅ 所有引用的数字必须来自工具返回或前三轮 Agent 的成果，禁止自己编造新数据。
- ❌ 禁止仅凭"经验"或"感觉"推荐方案，必须有量化数据支撑。
- ❌ 禁止忽视规范校核中的 fail 项——有 fail 的方案要么被替换，要么必须明确标注风险并建议专项论证。

## 决策原则（多维度权衡）
1. **安全第一**：抗震性能和规范符合性是底线，不能为了省钱而牺牲安全。
2. **经济合理**：在满足安全的前提下，优先选择造价合理、性价比高的方案。
3. **工期可控**：考虑施工难度和工期因素，避免选择技术过于复杂、工期不可控的方案。
4. **绿色低碳**：在条件允许时，优先选择装配率高、碳排放低的绿色方案。
5. **因地制宜**：结合场地条件、建筑功能、当地施工水平等因素综合判断。

## 输出格式
- 用中文总工口吻回答，专业、审慎、有全局观，带权威感。
- 结构：
  1. **综合评审结论**：先给出明确的推荐方案（第一名）和综合得分。
  2. **推荐理由**：分点说明为什么推荐这个方案（至少3条核心理由，分别对应不同维度）。
  3. **各方案对比**：简要对比前三名方案的优劣势。
  4. **风险提示**：指出推荐方案的潜在风险和注意事项。
  5. **下一步建议**：给出后续深化设计的工作方向（至少3条）。
- 如果经历了方案调整回环，要明确说明"经过N轮调整才定下最终推荐"，体现决策过程的严谨性。
- 结尾必须加免责声明："本推荐基于方案阶段估算与简化分析，仅供前期决策参考，不构成设计依据。正式设计需由注册结构工程师主持，采用专业软件按规范计算确定。"`,
  },
};

/** Agent 全局状态（运行时内存态，可选持久化） */
export interface IAgentState {
  currentParams: Record<string, unknown> | null;
  candidateSchemes: unknown[];
  actionLog: IAgentActionLog[];
  conclusions: string[];
  currentAgent: AgentType | null;
  stepCount: number;
  status: 'idle' | 'running' | 'completed' | 'error';
  error?: string;
}

/** 管线最终结果结构（供 UI 消费，与现有结构兼容） */
export interface IAgentPipelineResult {
  /** 完整方案对象数组（按推荐排序） */
  schemes: IStructureScheme[];
  recommended: {
    schemeId: string;
    schemeName: string;
    reason: string;
    overallScore: number;
  };
  ranking: Array<{
    schemeId: string;
    schemeName: string;
    score: number;
    breakdown: Record<string, number>;
  }>;
  codeChecks: Record<string, unknown>;
  metrics: Record<string, unknown>;
  advice: {
    pros: string[];
    cons: string[];
    nextSteps: string[];
    /** 风险点列表（Reflection 反思环节产出） */
    risks?: string[];
    /** 风险触发条件 */
    riskTriggers?: string[];
    /** 置信度自评 */
    confidence?: {
      level: string;
      score: number;
      strengths: string[];
      uncertainties: string[];
      reason: string;
    };
  };
  actionLog: IAgentActionLog[];
  conclusions: string[];
  /** 降级标记：真实模式崩溃后自动切换演示轨迹继续跑完时写入（透明降级） */
  degraded?: { from: 'real' | 'trace'; reason: string };
  /** 本次运行携带的人类在环干预项（HITL） */
  humanOverrides?: IHumanOverrides;
  /** 超出人工预算上限的方案 ID 列表（budgetCap 设定时计算） */
  budgetExceeded?: string[];
}

/** 人类在环（HITL）干预项：工程师在管线运行前/中设定的硬约束与备注 */
export interface IHumanOverrides {
  /** 人工锁定的方案 ID：AI 不得替换，重出时强制保留为候选 */
  lockedSchemeIds?: string[];
  /** 人工预算上限（万元）：超出标记风险并如实反映到比选与建议 */
  budgetCap?: number;
  /** 人工强制评分权重（覆盖默认权重） */
  forcedWeights?: Partial<IWeightConfig>;
  /** 人工备注：注入到子 Agent 的 prompt 中 */
  notes?: string;
}

/** 推理引擎配置 */
export interface IEngineConfig {
  mode: 'real' | 'trace';
  endpoint?: string;
  model?: string;
  apiKey?: string;
  maxSteps: number;
  /** 真实模式的 system prompt 前缀 */
  systemPrompt?: string;
  /** 真实模式校核回退闭环开关（默认开启：Code 发现违规 → Architect 重出 → 复核） */
  allowRecheck?: boolean;
  /** LLM 请求自动重试最大次数（默认 2，仅网络错误/5xx 触发；4xx/超时不重试） */
  retryMax?: number;
  /** 重试退避基数 ms（默认 800，第 N 次重试延迟 = base * N） */
  retryBaseDelayMs?: number;
}

/** 对话意图类型 */
export enum EIntentType {
  CHANGE_PARAMS = 'CHANGE_PARAMS',
  REGENERATE = 'REGENERATE',
  EXPLAIN = 'EXPLAIN',
  COMPARE = 'COMPARE',
  RECOMMEND = 'RECOMMEND',
  ASK_CODE = 'ASK_CODE',
  /** 隔震/减震专项咨询 */
  ASK_ISOLATION = 'ASK_ISOLATION',
  /** 装配率与成本关系 */
  ASK_PRECAST_COST = 'ASK_PRECAST_COST',
  /** 钢结构造价对比 */
  ASK_STEEL_COST = 'ASK_STEEL_COST',
  /** 工期压缩可行性 */
  ASK_SCHEDULE_COMPRESS = 'ASK_SCHEDULE_COMPRESS',
  /** 合规性与风险汇总 */
  ASK_COMPLIANCE_RISK = 'ASK_COMPLIANCE_RISK',
  /** 预算大幅削减（比 CHANGE_PARAMS 更具决策性质） */
  ASK_BUDGET_CUT = 'ASK_BUDGET_CUT',
  /** 与周边/同类项目对比 */
  ASK_BENCHMARK = 'ASK_BENCHMARK',
  /** 抗震等级查询 */
  ASK_SEISMIC_GRADE = 'ASK_SEISMIC_GRADE',
  /** 基础形式建议 */
  ASK_FOUNDATION = 'ASK_FOUNDATION',
  /** 含钢量/用钢量估算 */
  ASK_STEEL_RATIO = 'ASK_STEEL_RATIO',
  /** 构件截面概念估算（梁高/柱截面） */
  ASK_SECTION_SIZE = 'ASK_SECTION_SIZE',
  UNKNOWN = 'UNKNOWN',
}

/** 意图解析结果 */
export interface IIntentResult {
  intent: EIntentType;
  /** 提取的参数变更（CHANGE_PARAMS 时） */
  paramChanges?: Record<string, string | number>;
  /** 解释目标（EXPLAIN 时） */
  explainTarget?: string;
  /** 对比目标（COMPARE 时） */
  compareTargets?: string[];
  /** 规范条文关键词（ASK_CODE 时） */
  codeQuery?: string;
  /** 预算削减比例（ASK_BUDGET_CUT 时，百分比 1-100） */
  budgetCutPercent?: number;
  /** 置信度 0-1 */
  confidence: number;
  /** 原始用户消息 */
  rawMessage: string;
}
