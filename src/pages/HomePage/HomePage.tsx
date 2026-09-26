import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { capabilityClient, scopedStorage, logger } from '@lark-apaas/client-toolkit-lite';
import { toast } from 'sonner';
import { Download, Upload, AlertTriangle, Presentation, FileText, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sortSchemesByRanking } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import ReportPrintView from '@/components/ReportPrintView';
import StepNav from '@/components/StepNav';
import LoadingScreen from '@/components/LoadingScreen';
import AgentConfigPanel from '@/components/AgentConfigPanel';
import HeroSection from './sections/HeroSection';
import ParamsSection from './sections/ParamsSection';
import SchemesSection from './sections/SchemesSection';
import ComparisonSection from './sections/ComparisonSection';
import ChatSection from './sections/ChatSection';
import { getLlmConfig, streamLlmChat } from '@/components/ApiKeyModal';
import type {
  CivilStructQaOneInput,
  CivilStructQaOneOutput,
  SolutionComparisonRecommendationOneInput,
  SolutionComparisonRecommendationOneOutput,
  StructureSchemeGenerateOneInput,
  StructureSchemeGenerateOneOutput,
} from '@shared/plugin-types';
import {
  generateSchemesFromParams,
  MOCK_PROJECT_PARAMS,
  MOCK_RECOMMENDATION,
  MOCK_CHAT_MESSAGES,
  MOCK_WEIGHT_CONFIG,
  THINKING_STEPS_TEMPLATE,
  calculateBuildingHeight,
  checkExtremeParams,
  estimatePrecastRate,
  estimateCarbonEmission,
  estimateDuration,
  estimateCost,
  estimateConstructionRisk,
  type IProjectParams,
  type IStructureScheme,
  type IRecommendation,
  type IChatMessage,
  type IWeightConfig,
  type IThinkingStep,
  type IExtremeParamAlert,
} from '@/data/structure';
import {
  runAgentPipeline,
  processAgentMessage,
  parseIntentByRules,
  loadEngineConfig,
  runOptimization,
  generateOptimizationSuggestions,
  type IAgentActionLog,
  type IIntentResult,
  type IAgentPipelineResult,
  type IConversationContext,
  type IOptimizationResult,
  type IOptimizationGoal,
} from '@/agent';

const STORAGE_KEY_PARAMS = '__structopt_project_params';
const STORAGE_KEY_WEIGHTS = '__structopt_weights';
const STORAGE_KEY_CHAT = '__structopt_chat_messages';
const STORAGE_KEY_PIPELINE = '__structopt_pipeline_result';
const STORAGE_KEY_PRESENTATION = '__structopt_presentation_mode';
const EXPORT_FORMAT_VERSION = 1;
const STORAGE_VERSION = 2;

// Plugin instance IDs
const PLUGIN_SCHEME_GENERATE = 'structure_scheme_generate_1';
const PLUGIN_RECOMMENDATION = 'solution_comparison_recommendation_1';
const PLUGIN_QA = 'civil_struct_qa_1';

/** 把候选方案列表序列化为「方案对比推荐」插件入参文本 */
function buildCandidateSolutionsText(schemes: IStructureScheme[]): string {
  return schemes
    .map(
      (s, i) =>
        `方案${i + 1}：${s.name}\n` +
        `体系说明：${s.description}\n` +
        `适用场景：${s.applicableScenarios}\n` +
        `优点：${s.advantages.join('；')}\n` +
        `缺点：${s.disadvantages.join('；')}\n` +
        `指标：造价 ${s.metrics.cost} 元/㎡；工期 ${s.metrics.duration} 月；` +
        `抗震性能 ${s.metrics.seismicPerformance}/10；施工难度 ${s.metrics.constructionDifficulty}/10；` +
        `可持续性 ${s.metrics.sustainability}/10`
    )
    .join('\n\n');
}

/** 调用「方案对比推荐」插件实例，流式生成综合推荐分析（markdown） */
async function streamRecommendationFromPlugin(
  schemes: IStructureScheme[],
  weights: IWeightConfig,
  onChunk: (fullText: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const input: SolutionComparisonRecommendationOneInput = {
    candidate_solutions: buildCandidateSolutionsText(schemes),
    evaluation_factors: `评估权重优先级：成本 ${weights.cost}%、工期 ${weights.duration}%、安全 ${weights.safety}%、绿色低碳 ${weights.green}%`,
  };

  const stream = capabilityClient
    .load(PLUGIN_RECOMMENDATION)
    .callStream<SolutionComparisonRecommendationOneOutput>('textGenerate', input);

  let full = '';
  for await (const chunk of stream) {
    if (signal?.aborted) break;
    const piece = chunk.content ?? chunk.response ?? '';
    if (piece) {
      full += piece;
      onChunk(full);
    }
  }
  return full;
}

/** 调用「结构方案生成」插件实例，流式生成候选方案详细分析（markdown） */
async function streamSchemesFromPlugin(
  projectParams: string,
  onChunk: (fullText: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const input: StructureSchemeGenerateOneInput = {
    project_params: projectParams,
  };

  const stream = capabilityClient
    .load(PLUGIN_SCHEME_GENERATE)
    .callStream<StructureSchemeGenerateOneOutput>('textGenerate', input);

  let full = '';
  for await (const chunk of stream) {
    if (signal?.aborted) break;
    const piece = chunk.content ?? chunk.response ?? '';
    if (piece) {
      full += piece;
      onChunk(full);
    }
  }
  return full;
}

/** 调用「结构智能问答」插件实例，流式生成专业解答（markdown） */
async function streamAnswerFromPlugin(
  projectContext: string,
  userQuestion: string,
  onChunk: (fullText: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const input: CivilStructQaOneInput = {
    project_context: projectContext,
    user_question: userQuestion,
  };

  const stream = capabilityClient
    .load(PLUGIN_QA)
    .callStream<CivilStructQaOneOutput>('textGenerate', input);

  let full = '';
  for await (const chunk of stream) {
    if (signal?.aborted) break;
    const piece = chunk.content ?? chunk.response ?? '';
    if (piece) {
      full += piece;
      onChunk(full);
    }
  }
  return full;
}

export default function HomePage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [projectParams, setProjectParams] = useState<IProjectParams | null>(null);
  const [weights, setWeights] = useState<IWeightConfig>(MOCK_WEIGHT_CONFIG);
  const [lockedParams, setLockedParams] = useState<Partial<Record<keyof IProjectParams, boolean>>>({});
  const [schemes, setSchemes] = useState<IStructureScheme[]>([]);
  const [recommendation, setRecommendation] = useState<IRecommendation | null>(null);
  const [chatMessages, setChatMessages] = useState<IChatMessage[]>([]);
  const [selectedSchemeId, setSelectedSchemeId] = useState<string | null>(null);
  const [playerFinished, setPlayerFinished] = useState(false);
  const [thinkingSteps, setThinkingSteps] = useState<IThinkingStep[]>([]);
  const [extremeAlert, setExtremeAlert] = useState<IExtremeParamAlert | null>(null);

  // Generation states
  const [isGeneratingSchemes, setIsGeneratingSchemes] = useState(false);
  const [isGeneratingRec, setIsGeneratingRec] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationResult, setOptimizationResult] = useState<IOptimizationResult | null>(null);
  const [visibleIteration, setVisibleIteration] = useState<number>(0); // 当前展示到第几轮
  const [paramsFormKey, setParamsFormKey] = useState(0); // 递增触发 ParamsSection 整体重挂载重置表单
  const [isAutoOptimizing, setIsAutoOptimizing] = useState(false);
  const [optimizeSuggestions, setOptimizeSuggestions] = useState<ReturnType<typeof generateOptimizationSuggestions>>([]);
  const [presentationMode, setPresentationMode] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<Record<string, unknown> | null>(null);
  const [schemeContent, setSchemeContent] = useState('');
  const [recommendationContent, setRecommendationContent] = useState('');

  const [isInitialLoading, setIsInitialLoading] = useState(true);

  // Agent 工作台状态
  const [actionLog, setActionLog] = useState<IAgentActionLog[]>([]);
  const [currentAgentIndex, setCurrentAgentIndex] = useState(0);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [isPlayerPlaying, setIsPlayerPlaying] = useState(false); // 播放锁：正在自动播放中禁用其他交互
   const [showDemoBanner, setShowDemoBanner] = useState(false);
  const [thinkingCollapsed, setThinkingCollapsed] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [agentConfig, setAgentConfig] = useState({
    apiBase: '',
    model: 'deepseek-chat',
    apiKey: '',
    mode: 'auto' as 'auto' | 'real' | 'demo',
  });
  const [currentIntent, setCurrentIntent] = useState<IIntentResult | null>(null);
  const [agentContext, setAgentContext] = useState<IConversationContext | null>(null);

  const thinkingTimerRef = useRef<number | null>(null);
  const thinkingCancelledRef = useRef(false);
  const generateAbortRef = useRef<AbortController | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);

  // 清理所有异步资源（组件卸载时）
  useEffect(() => {
    return () => {
      // 取消思考动画
      thinkingCancelledRef.current = true;
      if (thinkingTimerRef.current) {
        clearTimeout(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
      // 取消生成流
      generateAbortRef.current?.abort();
      // 取消对话流
      chatAbortRef.current?.abort();
    };
  }, []);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      // 加载 Agent 引擎配置（与 real-engine 同一份数据源）
      const engineCfg = loadEngineConfig();
      if (engineCfg.endpoint || engineCfg.apiKey || engineCfg.model || engineCfg.mode) {
        setAgentConfig({
          apiBase: engineCfg.endpoint || '',
          model: engineCfg.model || 'deepseek-chat',
          apiKey: engineCfg.apiKey || '',
          mode: (engineCfg.mode === 'trace' ? 'demo' : (engineCfg.mode || 'auto')) as 'auto' | 'real' | 'demo',
        });
      }

      const savedParams = scopedStorage.getItem(STORAGE_KEY_PARAMS);
      if (savedParams) {
        const parsed = JSON.parse(savedParams);
        // 兼容旧数据：补齐 geologyType 字段
        if (!parsed.geologyType) {
          parsed.geologyType = 'clay';
        }
        setProjectParams(parsed);
      }
      const savedWeights = scopedStorage.getItem(STORAGE_KEY_WEIGHTS);
      if (savedWeights) {
        setWeights(JSON.parse(savedWeights));
      }
      const savedChat = scopedStorage.getItem(STORAGE_KEY_CHAT);
      if (savedChat) {
        const chatArr = JSON.parse(savedChat);
        if (Array.isArray(chatArr) && chatArr.length > 0) {
          // 仅恢复最近 20 条
          const limited = chatArr.slice(-20);
          setChatMessages(limited);
        }
      }

      // 恢复管线结果（方案集/推荐/排序/指标）
      const savedPipeline = scopedStorage.getItem(STORAGE_KEY_PIPELINE);
      if (savedPipeline) {
        try {
          const pipeData = JSON.parse(savedPipeline);
          // 版本兼容：版本不匹配或字段缺失时不清空但跳过恢复（保持可演示）
          if (pipeData.version !== STORAGE_VERSION) {
            logger.info(`Pipeline storage version mismatch (${pipeData.version} vs ${STORAGE_VERSION}), skipping restore`);
          } else if (pipeData.result && pipeData.result.schemes && pipeData.result.ranking) {
            const r: IAgentPipelineResult = pipeData.result;
            const sortedSchemes = sortSchemesByRanking(r.schemes, r.ranking);
            setSchemes(sortedSchemes);
            setSelectedSchemeId(r.recommended?.schemeId || null);
            setRecommendation({
              schemeId: r.recommended.schemeId,
              schemeName: r.recommended.schemeName,
              reason: r.recommended.reason || '基于加权评分的综合推荐。',
              overallScore: r.recommended.overallScore,
              weightedScores: r.ranking.map((x) => ({
                schemeId: x.schemeId,
                schemeName: x.schemeName,
                score: x.score,
                breakdown: x.breakdown,
              })),
            });
            // 恢复数据但不启动播放：actionLog 先清空，避免播放器自动启动
            // 用户点击「重放」或重新生成时才开始播放
            setActionLog([]);
            setCurrentAgentIndex(4);
            setAgentContext({
              currentParams: pipeData.params || projectParams || MOCK_PROJECT_PARAMS,
              weights: pipeData.weights || MOCK_WEIGHT_CONFIG,
              lastResult: r,
            });
            const schemeMd = r.schemes
              .map(
                (s, i) =>
                  `## 方案${i + 1}：${s.name}\n\n${s.description}\n\n**造价**：${s.metrics.cost} 元/㎡\n**工期**：${s.metrics.duration} 个月\n**抗震性能**：${s.metrics.seismicPerformance}/10\n**施工难度**：${s.metrics.constructionDifficulty}/10\n**可持续性**：${s.metrics.sustainability}/10`
              )
              .join('\n\n');
            setSchemeContent(schemeMd);
            setRecommendationContent(r.recommended.reason || '');
          }
        } catch (pipeErr) {
          logger.warn('Failed to parse saved pipeline, cleaning up:', String(pipeErr));
          try { scopedStorage.removeItem(STORAGE_KEY_PIPELINE); } catch { /* ignore */ }
        }
      }
    } catch (e) {
      logger.warn('Failed to load saved data:', String(e));
    }
  }, []);

  const paramsFormFirstLoadedRef = useRef(false);

  // 首次加载：当 projectParams 从 null 变成有值（localStorage 异步回填）时，
  // 触发 ParamsSection 重挂载，让 useForm 用最新 initialParams 初始化 defaultValues。
  // **仅首次** — 后续用户改参数再点生成时，setProjectParams 不应该重置表单，
  // 否则用户输入的新值会被旧值覆盖（P0 bug）。
  useEffect(() => {
    if (projectParams && !paramsFormFirstLoadedRef.current) {
      paramsFormFirstLoadedRef.current = true;
      setParamsFormKey((k) => k + 1);
    }
  }, [projectParams]);

  // Save to localStorage
  useEffect(() => {
    if (projectParams) {
      try {
        scopedStorage.setItem(STORAGE_KEY_PARAMS, JSON.stringify(projectParams));
      } catch (e) {
        logger.warn('Failed to save params:', String(e));
      }
    }
  }, [projectParams]);

  useEffect(() => {
    try {
      scopedStorage.setItem(STORAGE_KEY_WEIGHTS, JSON.stringify(weights));
    } catch (e) {
      logger.warn('Failed to save weights:', String(e));
    }
  }, [weights]);

  useEffect(() => {
    if (chatMessages.length > 0) {
      try {
        // 仅保存最近 20 条，避免 localStorage 膨胀
        const toSave = chatMessages.slice(-20);
        scopedStorage.setItem(STORAGE_KEY_CHAT, JSON.stringify(toSave));
      } catch (e) {
        logger.warn('Failed to save chat:', String(e));
      }
    }
  }, [chatMessages]);

  // 保存管线结果（方案集/推荐/排序/指标 + 当前 params + weights）
  useEffect(() => {
    if (agentContext?.lastResult && agentContext.lastResult.schemes.length > 0) {
      try {
        const payload = {
          version: STORAGE_VERSION,
          savedAt: Date.now(),
          result: agentContext.lastResult,
          params: agentContext.currentParams,
          weights: agentContext.weights,
        };
        scopedStorage.setItem(STORAGE_KEY_PIPELINE, JSON.stringify(payload));
      } catch (e) {
        logger.warn('Failed to save pipeline result:', String(e));
      }
    }
   }, [agentContext]);

   // 大屏模式：从 localStorage 恢复，并同步到 document.documentElement 的 data 属性
   useEffect(() => {
     try {
       const saved = scopedStorage.getItem(STORAGE_KEY_PRESENTATION);
       if (saved === '1') {
         setPresentationMode(true);
       }
     } catch { /* ignore */ }
   }, []);

   useEffect(() => {
     const root = document.documentElement;
     if (presentationMode) {
       root.setAttribute('data-presentation', 'true');
     } else {
       root.removeAttribute('data-presentation');
     }
     try {
       scopedStorage.setItem(STORAGE_KEY_PRESENTATION, presentationMode ? '1' : '0');
     } catch { /* ignore */ }
   }, [presentationMode]);

   const handleTogglePresentation = useCallback(() => {
     setPresentationMode((v) => !v);
     toast.info(presentationMode ? '已退出大屏模式' : '已进入大屏模式');
   }, [presentationMode]);

   // ========== 工程导出 / 导入 ==========
   const handleExportPDF = useCallback(() => {
     if (schemes.length === 0 || !recommendation) {
       toast.warning('请先生成方案再导出报告');
       return;
     }
     // 触发浏览器打印
     setTimeout(() => {
       window.print();
     }, 100);
     toast.success('报告已生成，正在打开打印预览');
   }, [schemes, recommendation]);

   const handleExportProject = useCallback(() => {
     if (!projectParams) {
       toast.warning('当前无工程数据可导出');
       return;
     }
     const payload = {
       version: EXPORT_FORMAT_VERSION,
       exportedAt: new Date().toISOString(),
       app: 'struct-mind',
       projectParams,
       weights,
       schemes,
       recommendation,
       actionLog,
       chatMessages: chatMessages.slice(-50),
       optimizationResult,
       optimizeSuggestions,
       agentContext: agentContext ? {
         currentParams: agentContext.currentParams,
         weights: agentContext.weights,
         lastResult: agentContext.lastResult,
       } : null,
     };
     const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
     const url = URL.createObjectURL(blob);
     const a = document.createElement('a');
     const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
     const projName = projectParams.buildingType ? `${projectParams.buildingType}${projectParams.floors}层` : '工程';
     a.href = url;
     a.download = `智构StructMind_${projName}_${dateStr}.json`;
     document.body.appendChild(a);
     a.click();
     document.body.removeChild(a);
     URL.revokeObjectURL(url);
     toast.success('工程文件已导出');
   }, [projectParams, weights, schemes, recommendation, actionLog, chatMessages, optimizationResult, optimizeSuggestions, agentContext]);

   const handleImportFile = useCallback((file: File) => {
     const reader = new FileReader();
     reader.onload = () => {
       try {
         const data = JSON.parse(String(reader.result));
         if (data.app !== 'struct-mind' || typeof data.version !== 'number') {
           toast.error('文件格式无效：不是智构 StructMind 工程文件');
           return;
         }
         if (!data.projectParams) {
           toast.error('文件缺少项目参数数据');
           return;
         }
         setPendingImport(data);
         setImportDialogOpen(true);
       } catch {
         toast.error('文件解析失败，请确认是有效的 JSON 工程文件');
       }
     };
     reader.readAsText(file);
   }, []);

   const handleConfirmImport = useCallback(() => {
     if (!pendingImport) return;
     const data = pendingImport as Record<string, unknown> & {
       projectParams: IProjectParams;
       weights: IWeightConfig;
       schemes: IStructureScheme[];
       recommendation: IRecommendation | null;
       actionLog: IAgentActionLog[];
       chatMessages: IChatMessage[];
       optimizationResult: IOptimizationResult | null;
       optimizeSuggestions: ReturnType<typeof generateOptimizationSuggestions>;
       agentContext: IConversationContext | null;
     };

      // 恢复参数与权重
      if (data.projectParams) setProjectParams(data.projectParams);
      if (data.weights) setWeights(data.weights);
      // 导入的参数需要同步到表单（整体重挂载，用最新 initialParams 初始化）
      setParamsFormKey((k) => k + 1);
     if (Array.isArray(data.schemes)) setSchemes(data.schemes);
     if (data.recommendation) {
       setRecommendation(data.recommendation);
       setSelectedSchemeId(data.recommendation.schemeId);
     } else {
       setRecommendation(null);
       setSelectedSchemeId(null);
     }
     if (Array.isArray(data.actionLog)) {
       setActionLog(data.actionLog);
       if (data.actionLog.length > 0) setCurrentAgentIndex(4);
     }
     if (Array.isArray(data.chatMessages)) setChatMessages(data.chatMessages.slice(-50));
     if (data.optimizationResult) {
       setOptimizationResult(data.optimizationResult);
       setVisibleIteration(data.optimizationResult.iterations?.length - 1 || 0);
     } else {
       setOptimizationResult(null);
     }
     if (Array.isArray(data.optimizeSuggestions)) setOptimizeSuggestions(data.optimizeSuggestions);

     // 重建 agentContext
     if (data.agentContext?.lastResult) {
       setAgentContext({
         currentParams: data.agentContext.currentParams || data.projectParams || MOCK_PROJECT_PARAMS,
         weights: data.agentContext.weights || data.weights || MOCK_WEIGHT_CONFIG,
         lastResult: data.agentContext.lastResult as IAgentPipelineResult,
       });
     }

     // 重建方案内容文案（用于 SchemesSection 流式展示）
     if (Array.isArray(data.schemes) && data.schemes.length > 0) {
        const schemeMd = data.schemes
          .map((s: IStructureScheme, i: number) => {
            const adv = Array.isArray(s.advantages) && s.advantages.length > 0
              ? s.advantages.map((a: string) => `- ${a}`).join('\n')
              : '';
            const dis = Array.isArray(s.disadvantages) && s.disadvantages.length > 0
              ? s.disadvantages.map((d: string) => `- ${d}`).join('\n')
              : '';
            return `## 方案${i + 1}：${s.name}

${s.description}

**适用场景**：${s.applicableScenarios || '—'}

**优点**：
${adv || '- （待补充）'}

**缺点**：
${dis || '- （待补充）'}

**造价**：${s.metrics.cost} 元/㎡
**工期**：${s.metrics.duration} 个月
**抗震性能**：${s.metrics.seismicPerformance}/10
**施工难度**：${s.metrics.constructionDifficulty}/10
**可持续性**：${s.metrics.sustainability}/10`;
          })
          .join('\n\n');
       setSchemeContent(schemeMd);
       setRecommendationContent(data.recommendation?.reason || '');
       setPlayerFinished(true);
       setIsGeneratingSchemes(false);
       setIsGeneratingRec(false);
     }

     setImportDialogOpen(false);
     setPendingImport(null);
     toast.success('工程文件导入成功');
      // 滚到方案区（两帧后等 DOM 更新完）
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.getElementById('schemes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
   }, [pendingImport]);

   // Scroll spy for step indicator
  useEffect(() => {
    const sections = ['params', 'schemes', 'comparison', 'chat'];
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            const stepIndex = sections.indexOf(id);
            if (stepIndex >= 0) {
              setCurrentStep(stepIndex + 1);
            }
          }
        });
      },
      { threshold: 0.3, rootMargin: '-100px 0px 0px 0px' }
    );

    sections.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  const scrollToParams = useCallback(() => {
    document.getElementById('params')?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Simulate thinking steps animation (支持取消，避免重复调用时多条链并行)
  const cancelThinkingSteps = useCallback(() => {
    thinkingCancelledRef.current = true;
    if (thinkingTimerRef.current) {
      clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
  }, []);

  const runThinkingSteps = useCallback((onComplete?: () => void) => {
    // 先取消旧链
    cancelThinkingSteps();
    thinkingCancelledRef.current = false;

    setThinkingSteps(THINKING_STEPS_TEMPLATE.map((s) => ({ ...s, status: 'pending' })));

    let stepIndex = 0;
    const totalSteps = THINKING_STEPS_TEMPLATE.length;

    const runNext = () => {
      if (thinkingCancelledRef.current) return;
      if (stepIndex >= totalSteps) {
        if (onComplete && !thinkingCancelledRef.current) onComplete();
        return;
      }

      setThinkingSteps((prev) =>
        prev.map((s, i) => (i === stepIndex ? { ...s, status: 'active' } : s))
      );

      thinkingTimerRef.current = window.setTimeout(() => {
        if (thinkingCancelledRef.current) return;
        setThinkingSteps((prev) =>
          prev.map((s, i) => (i === stepIndex ? { ...s, status: 'done' } : s))
        );
        stepIndex++;
        runNext();
      }, 150 + Math.random() * 150);
    };

    runNext();
  }, [cancelThinkingSteps]);

  // Calculate weighted score - 所有维度统一归一化到 0~10 分，确保权重比例与实际影响力一致
  // 维度：造价（逆）、工期（逆）、抗震性能（正）、施工难度（逆）、绿色综合（正）
  const calculateWeightedScores = useCallback(
    (schemeList: IStructureScheme[], w: IWeightConfig) => {
      if (schemeList.length === 0) return [];

      const costs = schemeList.map((s) => s.metrics.cost);
      const durations = schemeList.map((s) => s.metrics.duration);
      const carbons = schemeList.map((s) => s.metrics.carbonEmission);
      const difficulties = schemeList.map((s) => s.metrics.constructionDifficulty);
      const maxCost = Math.max(...costs);
      const minCost = Math.min(...costs);
      const maxDuration = Math.max(...durations);
      const minDuration = Math.min(...durations);
      const maxCarbon = Math.max(...carbons);
      const minCarbon = Math.min(...carbons);
      const maxDifficulty = Math.max(...difficulties);
      const minDifficulty = Math.min(...difficulties);

      // 归一化工具函数：正向（值越大分越高）和逆向（值越小分越高）
      const normInverse = (val: number, min: number, max: number) =>
        max === min ? 5 : 10 - ((val - min) / (max - min)) * 10; // 0~10，值小=分高

      return schemeList.map((s) => {
        // 造价：逆指标，0~10 分
        const costScore = normInverse(s.metrics.cost, minCost, maxCost);
        // 工期：逆指标，0~10 分
        const durationScore = normInverse(s.metrics.duration, minDuration, maxDuration);
        // 抗震性能：1~10 分直接使用（已在该范围）
        const safetyScore = Math.max(0, Math.min(10, s.metrics.seismicPerformance));
        // 施工难度：逆指标（越易越好），0~10 分
        const difficultyScore = normInverse(s.metrics.constructionDifficulty, minDifficulty, maxDifficulty);
        // 碳排放：逆指标，0~10 分
        const carbonScore = normInverse(s.metrics.carbonEmission, minCarbon, maxCarbon);
        // 装配率：正指标，0~10 分（0~100% → 0~10）
        const precastScore = Math.max(0, Math.min(10, s.metrics.precastRate.rate / 10));
        // 绿色综合：可持续性(0.4) + 碳排放(0.35) + 装配率(0.25)
        const sustainabilityScore = Math.max(0, Math.min(10, s.metrics.sustainability));
        const greenScore =
          sustainabilityScore * 0.4 + carbonScore * 0.35 + precastScore * 0.25;

        // 总权重（safety 已隐含抗震+施工难度，按 6:4 拆分）
        // 权重配置中的 safety 权重拆分为：抗震性能 60% + 施工难度 40%
        const safetyComposite = safetyScore * 0.6 + difficultyScore * 0.4;

        const totalWeight = w.cost + w.duration + w.safety + w.green;
        const overallScore =
          (costScore * w.cost +
            durationScore * w.duration +
            safetyComposite * w.safety +
            greenScore * w.green) /
          totalWeight;

        return {
          schemeId: s.id,
          schemeName: s.name,
          score: parseFloat(overallScore.toFixed(2)),
          breakdown: {
            cost: parseFloat(costScore.toFixed(2)),
            duration: parseFloat(durationScore.toFixed(2)),
            safety: parseFloat(safetyComposite.toFixed(2)),
            green: parseFloat(greenScore.toFixed(2)),
            seismic: parseFloat(safetyScore.toFixed(2)),
            difficulty: parseFloat(difficultyScore.toFixed(2)),
          },
        };
      });
    },
    []
  );

  const buildParamsText = useCallback((params: IProjectParams) => {
    const buildingTypeMap: Record<string, string> = {
      residential: '住宅',
      office: '办公楼',
      school: '教学楼',
      factory: '厂房',
      gymnasium: '体育馆',
    };
    const structureMap: Record<string, string> = {
      frame: '框架结构',
      'frame-shearwall': '框架-剪力墙结构',
      shearwall: '剪力墙结构',
      steel: '钢结构',
      prefabricated: '装配式结构',
      any: '不限（智能推荐）',
    };
    const geologyMap: Record<string, string> = {
      loess: '湿陷性黄土',
      clay: '一般黏土',
      rock: '岩石地基',
      fill: '填土/其他',
    };
    const height = calculateBuildingHeight(params.floors);
    return `建筑类型：${buildingTypeMap[params.buildingType] || params.buildingType}
 建筑层数：${params.floors} 层（估算高度约 ${height} m）
 建筑面积：${params.area} 平方米
 结构体系偏好：${structureMap[params.structurePreference] || params.structurePreference}
 抗震设防烈度：${params.seismicIntensity}度
 场地土类别：${params.soilCategory}类
 场地地质条件：${geologyMap[params.geologyType] || params.geologyType || '一般黏土'}
 主要跨度：${params.mainSpan} 米
 预算约束：${params.budget} 元/平方米`;
  }, []);



  /** 跳过思考动画：立即把所有步骤标记为完成 */
  const handleSkipAnimation = useCallback(() => {
    thinkingCancelledRef.current = true;
    if (thinkingTimerRef.current) {
      clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    setThinkingSteps((prev) => prev.map((s) => ({ ...s, status: 'done' as const })));
  }, []);

  const doGenerate = useCallback(
    async (params: IProjectParams, w: IWeightConfig, extraPrompt?: string) => {
      // 取消上一次生成
      generateAbortRef.current?.abort();
      const controller = new AbortController();
      generateAbortRef.current = controller;

      setIsGeneratingSchemes(true);
      setIsGeneratingRec(true);
      setSchemeContent('');
      setRecommendationContent('');
      setSchemes([]);
      setRecommendation(null);
      setExtremeAlert(null);
      setActionLog([]);
      setCurrentAgentIndex(0);
      setIsPaused(false);
      setPlayerFinished(false);

      // Scroll to schemes
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.getElementById('schemes')?.scrollIntoView({ behavior: 'smooth' });
        });
      });

      // 极端参数检查
      const extreme = checkExtremeParams(params);
      setExtremeAlert(extreme);

      // 判断模式
      const hasKey = Boolean(agentConfig.apiKey.trim());
      const useReal = 
        agentConfig.mode === 'real' ||
        (agentConfig.mode === 'auto' && hasKey);
      setIsDemoMode(!useReal);

      try {
        // 构造引擎配置
        const engineConfig = useReal
          ? {
              mode: 'real' as const,
              endpoint: agentConfig.apiBase || undefined,
              model: agentConfig.model || undefined,
              apiKey: agentConfig.apiKey || undefined,
              maxSteps: 20,
            }
          : { mode: 'trace' as const, maxSteps: 20 };

        // 完整管线运行
        const result: IAgentPipelineResult = await runAgentPipeline(
          params,
          w,
          engineConfig
        );

        if (controller.signal.aborted) return;

        // 一次性设置 actionLog（演示模式是同步的，未来可以做流式）
        setActionLog(result.actionLog);
        setCurrentAgentIndex(4);

        // 设置方案列表（按 ranking 顺序排列）
        if (result.schemes && result.schemes.length > 0) {
          const sortedSchemes = sortSchemesByRanking(result.schemes, result.ranking);
          setSchemes(sortedSchemes);
          setSelectedSchemeId(result.recommended.schemeId);
        }

        // 设置推荐
        setRecommendation({
          schemeId: result.recommended.schemeId,
          schemeName: result.recommended.schemeName,
          reason: result.recommended.reason || '基于加权评分的综合推荐。',
          overallScore: result.recommended.overallScore,
          weightedScores: result.ranking.map((r) => ({
            schemeId: r.schemeId,
            schemeName: r.schemeName,
            score: r.score,
            breakdown: r.breakdown,
          })),
          });

        // 总工主动优化建议分析
        const topScheme = result.schemes.find((s) => s.id === result.recommended.schemeId);
        if (topScheme) {
          const suggestions = generateOptimizationSuggestions(topScheme, params, w);
          setOptimizeSuggestions(suggestions);
        } else {
          setOptimizeSuggestions([]);
        }

        // 更新 agent 对话上下文
        setAgentContext({
          currentParams: params,
          weights: w,
          lastResult: result,
        });

        // 生成方案分析 Markdown（给 ComparisonSection 用）
        const schemeMd = result.schemes
          .map(
            (s, i) =>
              `## 方案${i + 1}：${s.name}\n\n${s.description}\n\n**造价**：${s.metrics.cost} 元/㎡\n**工期**：${s.metrics.duration} 个月\n**抗震性能**：${s.metrics.seismicPerformance}/10\n**施工难度**：${s.metrics.constructionDifficulty}/10\n**可持续性**：${s.metrics.sustainability}/10`
          )
          .join('\n\n');
        setSchemeContent(schemeMd);
        // 先展示本地构造的方案摘要，再调用「结构方案生成」插件流式生成详细方案分析覆盖展示
        void streamSchemesFromPlugin(
          buildParamsText(params),
          (fullText) => {
            if (!controller.signal.aborted) setSchemeContent(fullText);
          },
          controller.signal
        ).catch((pluginError) => {
          logger.warn('结构方案生成插件调用失败:', String(pluginError).slice(0, 200));
          toast.error('方案生成失败，请检查参数或稍后重试');
        });
        // 先给出加权评分的简要推荐理由，再调用「方案对比推荐」插件流式生成详细对比分析
        setRecommendationContent(result.recommended.reason || '');
        if (result.schemes.length > 0) {
          void streamRecommendationFromPlugin(
            result.schemes,
            w,
            (fullText) => {
              if (!controller.signal.aborted) setRecommendationContent(fullText);
            },
            controller.signal
          ).catch((pluginError) => {
            logger.warn('方案对比推荐插件调用失败:', String(pluginError).slice(0, 200));
            toast.error('推荐生成失败，已保留加权评分推荐理由');
          });
        }

        // 演示模式下：isGeneratingSchemes 保持 true 直到播放完成，让方案卡片/对比区保持 loading 态
        // 避免 actionLog 一到、方案数据也同时 set，方案卡片抢先显示出来
        // 注意：这里用 useReal 本地变量反推，而不是 isDemoMode state —— isDemoMode 是闭包陈旧值（set 之后要等下次 render 才更新）
        const isTraceMode = !useReal;
        if (isTraceMode && result.actionLog.length > 0) {
          // 不立即关 isGenerating，等播放完成回调再关
          // playerFinished 回调由 SchemesSection 通过 onPlayFinished 触发
        } else {
          setIsGeneratingSchemes(false);
          setIsGeneratingRec(false);
        }
        toast.success('方案生成完成');
      } catch (error) {
        const errMsg = String(error).slice(0, 200);
        logger.warn('Agent pipeline failed:', errMsg);

        // 如果是真实模式失败，回退到演示轨迹模式（保证四 Agent 协同过程仍然可见）
        if (useReal) {
          try {
            logger.info('Agent real mode failed, falling back to trace demo mode');
            const fallbackResult: IAgentPipelineResult = await runAgentPipeline(
              params,
              w,
              { mode: 'trace', maxSteps: 20 }
            );

            if (controller.signal.aborted) return;

            setActionLog(fallbackResult.actionLog);
            setCurrentAgentIndex(4);
            setIsDemoMode(true);

            if (fallbackResult.schemes && fallbackResult.schemes.length > 0) {
              const sortedSchemes = sortSchemesByRanking(fallbackResult.schemes, fallbackResult.ranking);
              setSchemes(sortedSchemes);
              setSelectedSchemeId(fallbackResult.recommended.schemeId);
            }

            setRecommendation({
              schemeId: fallbackResult.recommended.schemeId,
              schemeName: fallbackResult.recommended.schemeName,
              reason: fallbackResult.recommended.reason || '基于加权评分的综合推荐。',
              overallScore: fallbackResult.recommended.overallScore,
              weightedScores: fallbackResult.ranking.map((r) => ({
                schemeId: r.schemeId,
                schemeName: r.schemeName,
                score: r.score,
                breakdown: r.breakdown,
              })),
            });

            setAgentContext({
              currentParams: params,
              weights: w,
              lastResult: fallbackResult,
            });

            const schemeMd = fallbackResult.schemes
              .map(
                (s, i) =>
                  `## 方案${i + 1}：${s.name}\n\n${s.description}\n\n**造价**：${s.metrics.cost} 元/㎡\n**工期**：${s.metrics.duration} 个月\n**抗震性能**：${s.metrics.seismicPerformance}/10\n**施工难度**：${s.metrics.constructionDifficulty}/10\n**可持续性**：${s.metrics.sustainability}/10`
              )
              .join('\n\n');
            setSchemeContent(schemeMd);
            setRecommendationContent(fallbackResult.recommended.reason || '');

             setIsGeneratingSchemes(false);
             setIsGeneratingRec(false);
             setShowDemoBanner(true);
             toast.error(
               `API 连接失败，已切换至本地轻量推理引擎。\n原因：${errMsg.split('\n')[0]}`,
               { duration: 6000 }
             );
             return;
          } catch (fallbackError) {
            logger.warn('Trace fallback also failed:', String(fallbackError).slice(0, 200));
          }
        }

        // 最终兜底：规则引擎（演示模式也失败时才走这里）
        const calculatedSchemes = generateSchemesFromParams(params);
        const weightedScores = calculateWeightedScores(calculatedSchemes, w);
        const bestScore = weightedScores.reduce((best, s) =>
          s.score > best.score ? s : best
        );

        setSchemes(calculatedSchemes);
        setSelectedSchemeId(bestScore.schemeId);
        setRecommendation({
          schemeId: bestScore.schemeId,
          schemeName: calculatedSchemes.find((s) => s.id === bestScore.schemeId)?.name || '',
          reason:
            `> 注：Agent 管线异常，已降级为规则引擎计算结果。\n\n` +
            `基于四维权重（成本${w.cost}%、工期${w.duration}%、安全${w.safety}%、绿色${w.green}%），` +
            `${calculatedSchemes.find((s) => s.id === bestScore.schemeId)?.name}以 ${bestScore.score} 分的综合得分排名第一。`,
          overallScore: bestScore.score,
          weightedScores,
        });
        setActionLog([]);
        setIsDemoMode(true);
        setShowDemoBanner(true);
       setIsGeneratingSchemes(false);
      setIsGeneratingRec(false);
      setPlayerFinished(false);
      toast.error(`方案生成失败：${errMsg.split('\n')[0]}`, { duration: 5000 });
      }
    },
    [agentConfig, calculateWeightedScores, generateSchemesFromParams]
  );

  const handleGenerate = useCallback(
    (params: IProjectParams, w: IWeightConfig) => {
      setProjectParams(params);
      setWeights(w);
      doGenerate(params, w);
    },
    [doGenerate]
  );

  const handleOptimize = useCallback(
     async (requirement: string) => {
       if (!projectParams) {
         toast.error('请先输入项目参数');
         return;
       }
       setIsOptimizing(true);
       await doGenerate(projectParams, weights, requirement);
       setIsOptimizing(false);

       // Scroll to schemes
       document.getElementById('schemes')?.scrollIntoView({ behavior: 'smooth' });
     },
     [projectParams, weights, doGenerate]
   );

   // 自主优化：从当前推荐方案出发，跑多轮迭代
   const handleStartOptimization = useCallback(
     async (goal: IOptimizationGoal, targetBudget?: number) => {
       if (!projectParams || !recommendation || schemes.length === 0) {
         toast.error('请先生成方案再进行优化');
         return;
       }

       const baseScheme = schemes.find((s) => s.id === recommendation.schemeId);
       if (!baseScheme) {
         toast.error('未找到基准方案');
         return;
       }

       setIsAutoOptimizing(true);
       setOptimizationResult(null);
       setVisibleIteration(0);

       // 滚动到对比区
       document.getElementById('comparison')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

       // 先算出完整优化结果
       let fullResult: IOptimizationResult;
       try {
          fullResult = runOptimization(baseScheme, projectParams, weights, goal, targetBudget, 4, lockedParams);
       } catch (error) {
         toast.error('优化失败：' + String(error).slice(0, 50));
         setIsAutoOptimizing(false);
         return;
       }

       // 逐轮播放：第 0 轮（基准）立刻显示，然后每 700ms 推进一轮
       const totalRounds = fullResult.iterations.length - 1; // 不含基准
       const perRoundDelay = 700;

       // 第 0 轮：基准方案立刻显示
       setOptimizationResult({
         ...fullResult,
         iterations: [fullResult.iterations[0]],
         summary: { ...fullResult.summary, totalRounds: totalRounds, acceptedRounds: 0 },
       });
       setVisibleIteration(0);

       for (let i = 1; i <= totalRounds; i++) {
         await new Promise((r) => setTimeout(r, perRoundDelay));
         const currentIters = fullResult.iterations.slice(0, i + 1);
         const acceptedCount = currentIters.filter((it) => it.decision === 'accepted').length;
         const lastIter = currentIters[currentIters.length - 1];
         setOptimizationResult({
           ...fullResult,
           iterations: currentIters,
           finalScheme: lastIter.scheme || fullResult.finalScheme,
           summary: {
             ...fullResult.summary,
             totalRounds: totalRounds,
             acceptedRounds: acceptedCount,
           },
         });
         setVisibleIteration(i);
       }

       // 播放完成：显示完整结果
       setOptimizationResult(fullResult);
       setVisibleIteration(totalRounds);

       // 把最终优化方案也同步到推荐（让用户可以继续对比）
       const finalScheme = fullResult.finalScheme;
       if (fullResult.summary.acceptedRounds > 0) {
         const finalSchemes = [finalScheme, ...schemes.filter((s) => s.id !== finalScheme.id)];
         setSchemes(finalSchemes);
         setRecommendation({
           schemeId: finalScheme.id,
           schemeName: finalScheme.name,
           reason: recommendation.reason + `\n\n> **自主优化结果**：经过 ${fullResult.summary.totalRounds} 轮迭代，${fullResult.summary.keyInsight}。`,
           overallScore: recommendation.overallScore,
           weightedScores: recommendation.weightedScores,
         });
       }

       toast.success(
         fullResult.summary.goalAchieved
           ? `优化完成，目标已达成！${fullResult.summary.acceptedRounds} 轮有效迭代`
           : `优化完成，共 ${fullResult.summary.totalRounds} 轮迭代`
       );

       // 重新生成优化建议（基于优化后的最终方案）
       const newSuggestions = generateOptimizationSuggestions(finalScheme, projectParams, weights);
       setOptimizeSuggestions(newSuggestions);
       setIsAutoOptimizing(false);
     },
     [projectParams, recommendation, schemes, weights]
   );

   const handleSendMessage = useCallback(
    async (message: string) => {
      // 取消上一次问答的流式输出
      chatAbortRef.current?.abort();
      const controller = new AbortController();
      chatAbortRef.current = controller;

      const userMsg: IChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        content: message,
        timestamp: Date.now(),
      };

      setChatMessages((prev) => [...prev, userMsg]);
      setIsChatLoading(true);

      try {
        // 构造对话上下文
        const context: IConversationContext = agentContext || {
          currentParams: projectParams || MOCK_PROJECT_PARAMS,
          weights,
          lastResult: null,
        };

        // 意图识别 + 处理
        const result = await processAgentMessage(message, context);
        setCurrentIntent(result.intent);
        setAgentContext(result.newContext);

        // 如果触发了重新生成（REGENERATE 或 CHANGE_PARAMS 都可能带 regenerated），同步刷新 Agent 工作台与方案
        if (result.regenerated) {
          const r = result.regenerated;
          setActionLog(r.actionLog);
          setCurrentAgentIndex(4);
          if (r.schemes && r.schemes.length > 0) {
            const sortedSchemes = sortSchemesByRanking(r.schemes, r.ranking);
            setSchemes(sortedSchemes);
            setSelectedSchemeId(r.recommended.schemeId);
          }
          setRecommendation({
            schemeId: r.recommended.schemeId,
            schemeName: r.recommended.schemeName,
            reason: r.recommended.reason || '基于加权评分的综合推荐。',
            overallScore: r.recommended.overallScore,
            weightedScores: r.ranking.map((x) => ({
              schemeId: x.schemeId,
              schemeName: x.schemeName,
              score: x.score,
              breakdown: x.breakdown,
            })),
          });
          const schemeMd = r.schemes
            .map(
              (s, i) =>
                `## 方案${i + 1}：${s.name}\n\n${s.description}\n\n**造价**：${s.metrics.cost} 元/㎡\n**工期**：${s.metrics.duration} 个月\n**抗震性能**：${s.metrics.seismicPerformance}/10\n**施工难度**：${s.metrics.constructionDifficulty}/10\n**可持续性**：${s.metrics.sustainability}/10`
            )
            .join('\n\n');
          setSchemeContent(schemeMd);
          setRecommendationContent(r.recommended.reason || '');
          // 滚动到方案区
          document.getElementById('schemes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        // 如果触发了参数变更，更新项目参数（CHANGE_PARAMS 同时带 updatedParams 和 regenerated）
        if (result.updatedParams) {
          setProjectParams(result.updatedParams);
          // AI 改了参数 → 同步回表单让用户看到最新值
          // 通过递增 paramsFormKey 触发 ParamsSection 整体重挂载
          setParamsFormKey((k) => k + 1);
        }

        // 回复：先展示本地简要回复，再调用「结构智能问答」插件流式生成专业解答覆盖
        const assistantId = (Date.now() + 1).toString();
        setChatMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: 'assistant',
            content: result.reply,
            timestamp: Date.now(),
          },
        ]);
        const qaContext = [
          `【当前项目参数】\n${buildParamsText(context.currentParams)}`,
          `【评估权重】成本 ${weights.cost}% / 工期 ${weights.duration}% / 安全 ${weights.safety}% / 绿色低碳 ${weights.green}%`,
          `【候选方案】\n${schemes.length > 0 ? buildCandidateSolutionsText(schemes) : '暂无已生成的候选方案'}`,
          `【最近对话】\n${chatMessages.slice(-6).map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`).join('\n') || '（无）'}`,
        ].join('\n\n');
        void streamAnswerFromPlugin(
          qaContext,
          message,
          (fullText) => {
            if (!controller.signal.aborted) {
              setChatMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: fullText } : m)));
            }
          },
          controller.signal
        ).catch((pluginError) => {
          logger.warn('结构智能问答插件调用失败:', String(pluginError).slice(0, 200));
          toast.error('智能体暂不可用，请稍后再试');
        });
      } catch (error) {
        logger.warn('Chat intent failed:', String(error).slice(0, 200));
        // 兜底：根据问题类型给一句有信息量的简要回应，再说明能力边界
        const q = message.toLowerCase();
        let hint = '';
        if (q.includes('木结构') || q.includes('木构')) {
          hint = '关于木结构：常规住宅/办公楼通常优先考虑混凝土或钢结构体系。木结构在低层建筑（3层及以下）中具有自重轻、施工快、环保等优势，但在高层和高烈度区应用受规范限制较多，需专项论证。';
        } else if (q.includes('地铁') || q.includes('减振') || q.includes('隔震') || q.includes('震动')) {
          hint = '关于地铁振动：紧邻地铁的项目需做环境振动评估，可通过设置隔震层、采用浮筑楼板、加强结构刚度等措施降低振动影响，具体需结合场地实测数据分析。';
        } else if (q.includes('预算') || q.includes('钱') || q.includes('成本') || q.includes('造价')) {
          hint = '关于造价控制：可从结构体系选型（如优先选用规则的框架-剪力墙）、控制含钢量、优化柱网布置、采用装配式构件等方向切入降低造价。';
        } else if (q.includes('能不能') || q.includes('可以吗') || q.includes('可行')) {
          hint = '感谢您的提问。结构方案是否可行需要结合具体项目条件（层数、烈度、场地、荷载等）综合判断，建议先在参数区填写项目信息后生成方案对比。';
        } else {
          hint = '感谢您的提问。基于当前项目参数，我可以为您提供方案对比、规范查询、参数调整建议等服务。';
        }
        const fallbackMsg: IChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `${hint}\n\n> 说明：这个问题涉及的专业领域较深，我目前的能力边界还覆盖不到完全精准的解答，具体实施建议咨询专业结构工程师。`,
          timestamp: Date.now(),
        };
        setChatMessages((prev) => [...prev, fallbackMsg]);
        // 兜底回复之后同样尝试调用「结构智能问答」插件，流式生成专业解答覆盖
        const qaContext = [
          `【当前项目参数】\n${buildParamsText(projectParams || MOCK_PROJECT_PARAMS)}`,
          `【评估权重】成本 ${weights.cost}% / 工期 ${weights.duration}% / 安全 ${weights.safety}% / 绿色低碳 ${weights.green}%`,
          `【候选方案】\n${schemes.length > 0 ? buildCandidateSolutionsText(schemes) : '暂无已生成的候选方案'}`,
          `【最近对话】\n${chatMessages.slice(-6).map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`).join('\n') || '（无）'}`,
        ].join('\n\n');
        void streamAnswerFromPlugin(
          qaContext,
          message,
          (fullText) => {
            if (!controller.signal.aborted) {
              setChatMessages((prev) => prev.map((m) => (m.id === fallbackMsg.id ? { ...m, content: fullText } : m)));
            }
          },
          controller.signal
        ).catch((pluginError) => {
          logger.warn('结构智能问答插件调用失败:', String(pluginError).slice(0, 200));
          toast.error('智能体暂不可用，请稍后再试');
        });
      } finally {
        setIsChatLoading(false);
      }
    },
    [agentContext, projectParams, weights, schemes, buildParamsText, doGenerate]
  );

  const handleReset = useCallback(() => {
    setProjectParams(null);
    setWeights(MOCK_WEIGHT_CONFIG);
    setSchemes([]);
    setRecommendation(null);
    setChatMessages([]);
    setSelectedSchemeId(null);
    setSchemeContent('');
    setRecommendationContent('');
    setThinkingSteps([]);
    setExtremeAlert(null);
    setCurrentStep(1);
    setAgentContext(null);
    setActionLog([]);
    setCurrentAgentIndex(0);
    setOptimizationResult(null);
    setOptimizeSuggestions([]);
    setVisibleIteration(0);
    setIsPaused(false);
    setPlayerFinished(false);
    setIsDemoMode(true);
    setShowDemoBanner(false);
    setThinkingCollapsed(false);
    setParamsFormKey((k) => k + 1); // 触发 ParamsSection 表单整体重挂载，用最新 initialParams 重新初始化
    try {
      scopedStorage.removeItem(STORAGE_KEY_PARAMS);
      scopedStorage.removeItem(STORAGE_KEY_WEIGHTS);
      scopedStorage.removeItem(STORAGE_KEY_CHAT);
      scopedStorage.removeItem(STORAGE_KEY_PIPELINE);
    } catch (e) {
      logger.warn('Reset storage failed:', String(e));
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast.info('已重置所有数据');
  }, []);

  const handleToggleLock = useCallback((key: keyof IProjectParams) => {
    setLockedParams((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  const handleSelectScheme = useCallback((id: string) => {
    setSelectedSchemeId(id);
  }, []);

  return (
    <>
      <AnimatePresence>
        {isInitialLoading && (
          <LoadingScreen onComplete={() => setIsInitialLoading(false)} />
        )}
      </AnimatePresence>
      <div className="min-h-screen bg-blueprint-fade text-foreground">
      {/* Global blueprint grid overlay */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-blueprint-grid opacity-[0.4]" />
      <div className="pointer-events-none fixed inset-0 z-0 bg-gradient-to-b from-background/60 via-background/80 to-background" />
       <StepNav currentStep={currentStep} onReset={handleReset} presentationMode={presentationMode} onTogglePresentation={handleTogglePresentation} />

       {/* 演示模式提示条 */}
       <AnimatePresence>
         {showDemoBanner && (
           <motion.div
             initial={{ opacity: 0, y: -20 }}
             animate={{ opacity: 1, y: 0 }}
             exit={{ opacity: 0, y: -20 }}
             transition={{ duration: 0.3 }}
             className="relative z-40 w-full border-b border-amber/30 bg-amber/15 backdrop-blur-sm"
           >
             <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-6 py-2.5">
               <div className="flex items-center gap-3">
                 <AlertTriangle className="size-4 shrink-0 text-amber" />
                 <div className="text-sm">
                   <span className="font-medium text-amber-foreground">当前为本地演示模式</span>
                   <span className="ml-2 text-amber-foreground/80">
                     结果由内置规则引擎生成，仅供参考。建议配置 API 密钥以获得完整 AI 推理能力。
                   </span>
                 </div>
               </div>
               <Button
                 variant="ghost"
                 size="sm"
                 onClick={() => setShowDemoBanner(false)}
                 className="shrink-0 text-amber-foreground/70 hover:bg-amber/20 hover:text-amber-foreground"
               >
                 知道了
               </Button>
             </div>
           </motion.div>
         )}
       </AnimatePresence>

      <main className="relative z-10 space-y-16 md:space-y-20 pb-4">
        <HeroSection onStart={scrollToParams} />
         <ParamsSection
           onGenerate={handleGenerate}
           isGenerating={isGeneratingSchemes}
           initialParams={projectParams}
           initialWeights={weights}
           formResetKey={paramsFormKey}
           lockedParams={lockedParams}
           onToggleLock={handleToggleLock}
           disabled={isPlayerPlaying}
         />
        <SchemesSection
          schemes={schemes}
          isGenerating={isGeneratingSchemes}
          generatedContent={schemeContent}
          selectedSchemeId={selectedSchemeId}
          onSelectScheme={handleSelectScheme}
          actionLog={actionLog}
          currentAgentIndex={currentAgentIndex}
          isDemoMode={isDemoMode}
          thinkingCollapsed={thinkingCollapsed}
          onToggleThinking={() => setThinkingCollapsed((v) => !v)}
          extremeAlert={extremeAlert}
           onPlayFinished={() => {
             setPlayerFinished(true);
             // 播放完成后再关闭生成态，方案卡片/对比区才淡入显示
             setIsGeneratingSchemes(false);
             setIsGeneratingRec(false);
             setIsPlayerPlaying(false);
           }}
           onPlayerActiveChange={(active) => setIsPlayerPlaying(active)}
           onSkipAnimation={() => {
            // 演示模式：直接展示完整管线
            setCurrentAgentIndex(4);
          }}
          isPaused={isPaused}
          onTogglePause={() => setIsPaused((v) => !v)}
          onRestart={() => doGenerate(projectParams || MOCK_PROJECT_PARAMS, weights)}
          onOpenConfig={() => setConfigOpen(true)}
        />
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <ComparisonSection
             schemes={schemes}
             recommendation={recommendation}
             isRecommending={isGeneratingRec}
             recommendationContent={recommendationContent}
             selectedSchemeId={selectedSchemeId}
             weights={weights}
             projectParams={projectParams}
             onOptimize={handleOptimize}
             isOptimizing={isOptimizing}
             optimizationResult={optimizationResult}
             optimizationSuggestions={optimizeSuggestions}
              onStartOptimization={handleStartOptimization}
              isAutoOptimizing={isAutoOptimizing}
              lockedParams={lockedParams}
            />
        </motion.div>
        <ChatSection
          messages={chatMessages}
          isLoading={isChatLoading}
          onSendMessage={handleSendMessage}
          params={projectParams}
          schemes={schemes}
          recommendedSchemeId={recommendation?.schemeId}
          currentIntent={currentIntent}
          onOpenConfig={() => setConfigOpen(true)}
        />
      </main>

      {/* Blueprint Title Block Footer - 工程图签栏 */}
      <footer className="relative z-10 w-full border-t border-border/60 bg-card/80 py-8 backdrop-blur-sm">
        <div className="mx-auto max-w-[1600px] px-6">
          <div className="mx-auto max-w-2xl rounded-lg border border-border/70 bg-background/60 p-4 shadow-sm">
            {/* Title block header row */}
            <div className="mb-3 flex items-center justify-between border-b border-border/60 pb-2">
              <div className="font-mono text-[10px] tracking-wider text-muted-foreground">TITLE BLOCK · 图签栏</div>
              <div className="font-mono text-[10px] tracking-wider text-primary">SC-01</div>
            </div>
            {/* Main title area */}
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-base font-bold tracking-tight text-foreground">智构 StructMind</div>
                <div className="mt-0.5 font-mono text-[10px] tracking-wider text-muted-foreground">STRUCTURAL SCHEME OPTIMIZATION WORKBENCH</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-xs font-semibold text-primary">V2.0</div>
                <div className="font-mono text-[10px] text-muted-foreground">2026.09</div>
              </div>
            </div>
            {/* Standards reference row */}
            <div className="mb-3 border-t border-dashed border-border/50 pt-3">
              <div className="mb-1.5 font-mono text-[10px] tracking-wider text-muted-foreground">规范依据 · APPLICABLE CODES</div>
              <div className="flex flex-wrap gap-1.5">
                <span className="norm-badge norm-badge-mandatory">GB 55002-2021</span>
                <span className="norm-badge norm-badge-mandatory">GB 55008-2021</span>
                <span className="norm-badge norm-badge-mandatory">GB 55037-2022</span>
                <span className="norm-badge">GB/T 50011</span>
                <span className="norm-badge">GB/T 50010</span>
                <span className="norm-badge">JGJ 3-2010</span>
              </div>
            </div>
            {/* Bottom row */}
             <div className="flex items-center justify-between border-t border-dashed border-border/50 pt-3">
               <div className="text-[11px] text-muted-foreground">西安建筑科技大学</div>
               <div className="font-mono text-[10px] text-muted-foreground/70">为人民建好房 · 为工友谋幸福</div>
             </div>
              {/* 导入 / 导出 按钮行 */}
              <div className="mt-3 flex items-center justify-center gap-2 border-t border-dashed border-border/50 pt-3">
                <input
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  id="project-import-input"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleImportFile(f);
                    e.target.value = '';
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportPDF}
                  disabled={schemes.length === 0 || !recommendation}
                  className="gap-1.5 border-border/60 text-xs"
                >
                  <FileText className="h-3.5 w-3.5" />
                  导出报告
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportProject}
                  className="gap-1.5 border-border/60 text-xs"
                >
                  <Download className="h-3.5 w-3.5" />
                  导出工程
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById('project-import-input')?.click()}
                  className="gap-1.5 border-border/60 text-xs"
                >
                  <Upload className="h-3.5 w-3.5" />
                  导入工程
                </Button>
              </div>
           </div>
           <p className="mt-4 text-center text-[11px] text-muted-foreground/60">
             第一届"海之子杯"AI 智能体挑战赛参赛作品 © 2026
           </p>
         </div>

         {/* 答辩 FAQ */}
         <div className="mx-auto mt-10 max-w-3xl px-6">
           <div className="mb-4 flex items-center gap-2">
             <HelpCircle className="size-4 text-primary" />
             <span className="text-sm font-semibold text-foreground">答辩常见问题 FAQ</span>
             <span className="font-mono text-[10px] text-muted-foreground">JUDGE Q&A</span>
           </div>
           <Accordion type="single" collapsible className="space-y-2">
             <AccordionItem value="q1" className="corner-marks border border-border/60 bg-card/70 px-4 blueprint-card">
               <AccordionTrigger className="text-sm font-medium text-foreground hover:no-underline py-3">
                 1. 你这和盈建科、PKPM 有什么区别？
               </AccordionTrigger>
               <AccordionContent className="text-sm text-muted-foreground leading-relaxed pb-4">
                 <p className="mb-2">
                   <strong className="text-foreground">定位不同</strong>：盈建科、PKPM 是<strong className="text-primary">校核工具</strong>，
                   面向施工图设计阶段，做精确的内力分析和构件验算；
                   我们是<strong className="text-primary">方案阶段的探索大脑</strong>，
                   面向建筑方案前期，做快速试错和多目标寻优。
                 </p>
                 <p>
                   <strong className="text-foreground">关系互补</strong>：工程师在方案阶段先用我们的工具快速筛选出 2-3 个最优候选体系，
                   再交给 YJK / PKPM / SAP2000 等专业软件做详细设计和施工图。
                   这样可以大幅减少方案阶段的反复推倒重来，提高设计效率。
                 </p>
               </AccordionContent>
             </AccordionItem>
             <AccordionItem value="q2" className="corner-marks border border-border/60 bg-card/70 px-4 blueprint-card">
               <AccordionTrigger className="text-sm font-medium text-foreground hover:no-underline py-3">
                 2. AI 出了结构事故谁负责？
               </AccordionTrigger>
               <AccordionContent className="text-sm text-muted-foreground leading-relaxed pb-4">
                 <p className="mb-2">
                   <strong className="text-foreground">Human-in-the-loop 架构</strong>：
                   所有 AI 推荐仅作为前期决策<strong className="text-primary">参考辅助</strong>，
                   最终决策权永远在持证工程师手中。
                 </p>
                 <p className="mb-2">
                   <strong className="text-foreground">责任边界清晰</strong>：
                   正式结构设计必须由<strong className="text-primary">注册结构工程师</strong>主持，
                   采用经认证的专业分析软件，按照现行国家规范计算确定。
                   本工具不替代任何法定设计程序。
                 </p>
                 <p>
                   <strong className="text-foreground">合规机制</strong>：
                   我们在架构中引入了规则引擎做规范校核，大模型只负责交互和调度，
                   不参与具体数值计算，从根本上杜绝"幻觉"导致的安全问题。
                 </p>
               </AccordionContent>
             </AccordionItem>
             <AccordionItem value="q3" className="corner-marks border border-border/60 bg-card/70 px-4 blueprint-card">
               <AccordionTrigger className="text-sm font-medium text-foreground hover:no-underline py-3">
                 3. 大模型怎么保证符合国家规范？
               </AccordionTrigger>
               <AccordionContent className="text-sm text-muted-foreground leading-relaxed pb-4">
                 <p className="mb-2">
                   <strong className="text-foreground">工具 + 规则引擎双重锁定</strong>：
                   大模型（LLM）只负责任务调度、自然语言交互和方案解释，
                   <strong className="text-primary">不参与任何具体数值计算</strong>。
                 </p>
                 <p className="mb-2">
                   <strong className="text-foreground">硬编码规范限值</strong>：
                   所有规范限值（位移角限值、剪重比、周期比、高度限值等）
                   均由<strong className="text-primary">硬编码的规则引擎</strong>执行，
                   严格依据 GB 55002、GB/T 50011、GB 55008、JGJ 3 等现行规范。
                 </p>
                 <p>
                   <strong className="text-foreground">可追溯计算链</strong>：
                   每一项校核都有完整的「规范依据 → 输入参数 → 计算公式 → 判定结果」链路，
                   可审计、可验证，从架构上杜绝大模型幻觉。
                 </p>
               </AccordionContent>
             </AccordionItem>
           </Accordion>
         </div>
      {/* 导入确认对话框 */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber" />
              导入工程确认
            </DialogTitle>
            <DialogDescription>
              导入将覆盖当前所有工程数据（参数、方案、对话、优化路径），此操作不可撤销。
              {pendingImport && (
                <div className="mt-3 rounded-md border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
                  <div className="mb-1 font-medium text-foreground">
                    文件信息
                  </div>
                  <div className="space-y-0.5 font-mono">
                    <div>版本：v{(pendingImport as Record<string, unknown>).version as number}</div>
                    <div>导出时间：{new Date((pendingImport as Record<string, unknown>).exportedAt as string).toLocaleString('zh-CN')}</div>
                  </div>
                </div>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>取消</Button>
            <Button variant="default" onClick={handleConfirmImport}>确认导入</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Agent 配置面板 */}
      <AgentConfigPanel
        open={configOpen}
        onOpenChange={setConfigOpen}
        config={agentConfig}
        onSave={setAgentConfig}
      />
       </footer>

       {/* ====== 打印报告视图（仅打印时显示）====== */}
       <div className="print-only">
         <ReportPrintView
           params={projectParams}
           schemes={schemes}
           recommendation={recommendation}
           weights={weights}
           isDemoMode={isDemoMode}
         />
       </div>

       {/* 打印专用样式 */}
       <style>{`
         @media print {
           body * {
             visibility: hidden;
           }
           .print-only, .print-only * {
             visibility: visible;
           }
           .print-only {
             position: absolute;
             left: 0;
             top: 0;
             width: 100%;
           }
           .print-report {
             font-size: 12pt;
             line-height: 1.6;
             color: #000;
           }
           .report-section {
             page-break-before: always;
             padding-top: 0;
           }
           .report-cover {
             height: 90vh;
             display: flex;
             flex-direction: column;
             justify-content: center;
           }
           @page {
             size: A4;
             margin: 20mm 15mm;
           }
         }
       `}</style>
     </div>
     </>
   );
 }
