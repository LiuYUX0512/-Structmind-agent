// Agent 引擎统一入口
// EXPORTS:
//   types: IAgentActionLog, IAgentState, IAgentPipelineResult, IEngineConfig, IIntentResult, EIntentType, AgentType, SUB_AGENT_SPECS
//   tools: TOOL_REGISTRY, executeToolByName
//   pipeline: AgentPipeline, runAgentPipeline
//   dag-engine: DagScheduler, ITaskNode, IReplanInstruction, isReplan
//   planner: Planner, IPlanNodeSpec, IPlanContext
//   intent: IntentEngine, processAgentMessage, parseIntentByRules
//   real-engine: RealEngine, saveEngineConfig, loadEngineConfig, isRealModeAvailable
//   optimizer: runOptimization, generateOptimizationSuggestions, IOptimizationResult, IOptimizationGoal, IOptimizationIteration

export * from './types';
export { TOOL_REGISTRY, executeToolByName } from './tools';
export { AgentPipeline, runAgentPipeline } from './pipeline';
export {
  DagScheduler,
  isReplan,
  type ITaskNode,
  type IReplanInstruction,
  type IDagRunResult,
  type IDagSchedulerOptions,
} from './dag-engine';
export { Planner, type IPlanNodeSpec, type IPlanContext, type PlanNodeKind } from './planner';
export { IntentEngine, processAgentMessage, parseIntentByRules } from './intent';
export type { IConversationContext } from './intent';
export { RealEngine, saveEngineConfig, loadEngineConfig, isRealModeAvailable } from './real-engine';
export { TraceEngine } from './trace-engine';
export {
  runOptimization,
  generateOptimizationSuggestions,
  analyzeTradeoffs,
  type IOptimizationResult,
  type IOptimizationGoal,
  type IOptimizationIteration,
  type IOptimizationLever,
  type ITradeoffAnalysis,
} from './optimizer';
