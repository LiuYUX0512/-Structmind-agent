// ---- plugin:solution_comparison_recommendation_1 ----
// ============================================================
// 插件 solution_comparison_recommendation_1 (方案对比推荐) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export type SolutionComparisonRecommendationOneInput = {
  /** 多个候选结构方案的详细信息及各项指标数据 */
  candidate_solutions: string;
  /** 方案评估的核心考量因素及权重优先级（可选） */
  evaluation_factors?: string;
};

/**
 * capabilityClient.load('solution_comparison_recommendation_1').callStream<SolutionComparisonRecommendationOneOutput>('textGenerate', input)
 * 每个 chunk 就是下面这个扁平对象，字段名与 SolutionComparisonRecommendationOneOutput 一致，外面没有 data / choices / message 包装：
 *   {"content":"示例文本","response":"示例文本"}
 * 逐段累加：
 *   for await (const chunk of stream) { result += chunk.content ?? ''; }
 */
export interface SolutionComparisonRecommendationOneOutput {
  /** 流式生成的 markdown 文本片段 */
  content?: string;
  /** 部分实现下的同义字段 */
  response?: string;
}
// ---- end:solution_comparison_recommendation_1 ----

// ---- plugin:civil_struct_qa_1 ----
// ============================================================
// 插件 civil_struct_qa_1 (结构智能问答) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export type CivilStructQaOneInput = {
  /** 当前项目的参数、方案等上下文信息 */
  project_context: string;
  /** 用户关于结构方案的问题 */
  user_question: string;
};

/**
 * capabilityClient.load('civil_struct_qa_1').callStream<CivilStructQaOneOutput>('textGenerate', input)
 * 每个 chunk 就是下面这个扁平对象，字段名与 CivilStructQaOneOutput 一致，外面没有 data / choices / message 包装：
 *   {"content":"示例文本","response":"示例文本"}
 * 逐段累加：
 *   for await (const chunk of stream) { result += chunk.content ?? ''; }
 */
export interface CivilStructQaOneOutput {
  /** 流式生成的 markdown 文本片段 */
  content?: string;
  /** 部分实现下的同义字段 */
  response?: string;
}
// ---- end:civil_struct_qa_1 ----

// ---- plugin:structure_scheme_generate_1 ----
// ============================================================
// 插件 structure_scheme_generate_1 (结构方案生成) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export type StructureSchemeGenerateOneInput = {
  /** 建筑项目参数，包括项目类型、高度、面积、地理位置、抗震设防要求、预算范围等关键信息 */
  project_params: string;
};

/**
 * capabilityClient.load('structure_scheme_generate_1').callStream<StructureSchemeGenerateOneOutput>('textGenerate', input)
 * 每个 chunk 就是下面这个扁平对象，字段名与 StructureSchemeGenerateOneOutput 一致，外面没有 data / choices / message 包装：
 *   {"content":"示例文本","response":"示例文本"}
 * 逐段累加：
 *   for await (const chunk of stream) { result += chunk.content ?? ''; }
 */
export interface StructureSchemeGenerateOneOutput {
  /** 流式生成的 markdown 文本片段 */
  content?: string;
  /** 部分实现下的同义字段 */
  response?: string;
}
// ---- end:structure_scheme_generate_1 ----