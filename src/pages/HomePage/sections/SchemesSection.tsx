// SchemesSection — Agent 工作台
// 模式与状态条 + 多Agent流水线 + 行动时间线 + 思维链控制 + 结果方案卡片
// EXPORTS: SchemesSection

import { memo, useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2,
  CheckCircle2,
  Shield,
  Leaf,
  Hammer,
  ChevronRight,
  AlertTriangle,
  Eye,
  EyeOff,
  FastForward,
  Play,
  Pause,
  Sparkles,
  RotateCcw,
  Settings,
  Bot,
  ArrowRight,
  Award,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import AgentPipelineView from '@/components/AgentPipelineView';
import AgentActionTimeline from '@/components/AgentActionTimeline';
import type {
  IStructureScheme,
  IExtremeParamAlert,
} from '@/data/structure';
import { SUB_AGENT_SPECS, type IAgentActionLog, type AgentType, type ITrajectoryMetrics } from '@/agent/types';
import type { AgentActionTimelineRef } from '@/components/AgentActionTimeline';
import { useActionPlayer } from '@/hooks/use-action-player';

interface SchemesSectionProps {
  schemes: IStructureScheme[];
  isGenerating: boolean;
  selectedSchemeId: string | null;
  onSelectScheme: (id: string) => void;
  actionLog: IAgentActionLog[];
  /** 元认知轨迹指标（节点 token/耗时来源） */
  metrics?: ITrajectoryMetrics;
  /** 当前 Agent 索引 (0=未开始, 1-4=已完成/进行中的agent数) */
  currentAgentIndex: number;
  /** 是否演示轨迹模式 */
  isDemoMode: boolean;
  /** 收起思考过程 */
  thinkingCollapsed: boolean;
  onToggleThinking: () => void;
  /** 跳过动画 */
  onSkipAnimation?: () => void;
  /** 逐步播放暂停/继续 */
  isPaused?: boolean;
  onTogglePause?: () => void;
  /** 重跑 */
  onRestart?: () => void;
  /** 打开 Agent 配置 */
  onOpenConfig?: () => void;
  extremeAlert: IExtremeParamAlert | null;
  generatedContent: string;
   /** 播放完成回调（演示模式播放引擎播完所有条目） */
   onPlayFinished?: () => void;
   /** 播放状态变化回调（true=正在播放中，false=播放结束/未播放） */
   onPlayerActiveChange?: (isActive: boolean) => void;
 }

function getStructureSystemLabel(name: string): string {
  if (name.includes('框架-剪力') || name.includes('框剪')) return '框架-剪力墙结构';
  if (name.includes('剪力墙')) return '剪力墙结构';
  if (name.includes('框架')) return '框架结构';
  if (name.includes('钢')) return '钢结构';
  if (name.includes('装配')) return '装配式结构';
  return name;
}

function getSeismicLabel(level: number): string {
  if (level >= 9) return '特一级';
  if (level >= 8) return '一级';
  if (level >= 7) return '二级';
  if (level >= 6) return '三级';
  return '四级';
}

function getDifficultyLabel(level: number): string {
  if (level <= 3) return '易';
  if (level <= 6) return '中';
  if (level <= 8) return '难';
  return '极难';
}

function SchemesSection({
  schemes,
  isGenerating,
  selectedSchemeId,
  onSelectScheme,
  actionLog,
  metrics,
  currentAgentIndex,
  isDemoMode,
  thinkingCollapsed,
  onToggleThinking,
  onSkipAnimation,
  isPaused,
  onTogglePause,
  onRestart,
  onOpenConfig,
  extremeAlert,
  generatedContent,
   onPlayFinished,
   onPlayerActiveChange,
 }: SchemesSectionProps) {
  const [selectedAgent, setSelectedAgent] = useState<AgentType | null>(null);
  const [warningViewedAgents, setWarningViewedAgents] = useState<Set<AgentType>>(new Set());
  const [skippedManually, setSkippedManually] = useState(false);
  const timelineRef = useRef<AgentActionTimelineRef>(null);

  const {
    completedLogs: playedLogs,
    currentPlayingLog,
    currentTypingText,
    agentIndex: playedAgentIndex,
    finished: playerFinished,
    skip: skipPlayer,
    replay: replayPlayer,
   } = useActionPlayer({
     fullLogs: actionLog,
     // 关键修复：播放器启用条件 = 演示模式 + 有日志 + 未手动跳过
     // 之前依赖 isGenerating，但 trace 模式管线是同步的，瞬间执行完 isGenerating 可能还没反应过来就结束了
     // 导致播放器从未启用，完整日志直接全显示，完全看不到过程
     enabled: isDemoMode && actionLog.length > 0 && !skippedManually,
     paused: !!isPaused,
     thinkCharMs: 26,
     thinkHoldMs: 2500,
     toolCallMs: 1500,
     toolResultDelayMs: 300,
     toolResultHoldMs: 3000,
     conclusionDelayMs: 600,
     conclusionHoldMs: 5000,
     agentGapMs: 2000,
     keyPointDelayMs: 1000,
   });

  // 播放器是否处于活跃播放状态（启用中 + 未播完 + 未手动跳过）
  const playerEnabled = isDemoMode && actionLog.length > 0 && !skippedManually;

  // 新一次生成（actionLog 从有到无到有）时重置手动跳过状态
  useEffect(() => {
    if (isDemoMode && actionLog.length === 0) {
      setSkippedManually(false);
    }
  }, [actionLog.length, isDemoMode]);

  const handleSkip = useCallback(() => {
    setSkippedManually(true);
    skipPlayer();
    onSkipAnimation?.();
  }, [skipPlayer, onSkipAnimation]);

  // 实际展示的日志：演示播放中用播放过的；否则用全量
  const displayLogs = playerEnabled ? playedLogs : actionLog;
  const displayAgentIndex = playerEnabled ? playedAgentIndex : currentAgentIndex;
  const isPlayerActive = playerEnabled && !playerFinished;

   // 播放状态变化时通知父组件（用于播放锁）
   useEffect(() => {
     onPlayerActiveChange?.(isPlayerActive);
   }, [isPlayerActive, onPlayerActiveChange]);

   const showTimeline = displayLogs.length > 0 || isPlayerActive || isGenerating;

   // 播放完成时同步状态（便于外部感知）—— 播完后再停 3 秒让用户读完，再解锁
   useEffect(() => {
     if (playerEnabled && playerFinished) {
       // 播放完毕，滚动到最底
       timelineRef.current?.scrollToBottom();
       // 延迟 3 秒再通知外部解锁（给观众留时间读最终结论）
       const t = window.setTimeout(() => {
         onPlayFinished?.();
       }, 3000);
       return () => window.clearTimeout(t);
     }
   }, [playerEnabled, playerFinished, onPlayFinished]);

  const handleSelectAgent = useCallback(
    (agent: AgentType) => {
      setSelectedAgent(agent);
      // 滚动到该 Agent 第一条行动
      requestAnimationFrame(() => {
        timelineRef.current?.scrollToAgent(agent);
      });
    },
    []
  );

  const handleClearFilter = useCallback(() => {
    setSelectedAgent(null);
  }, []);

  const handleMarkWarningViewed = useCallback((agent: AgentType) => {
    setWarningViewedAgents((prev) => {
      const next = new Set(prev);
      next.add(agent);
      return next;
    });
    // 展开该 Agent 所有警示条目
    requestAnimationFrame(() => {
      timelineRef.current?.expandAgentWarnings(agent);
    });
  }, []);

  if (schemes.length === 0 && !isGenerating && actionLog.length === 0) {
    return (
      <section id="schemes" className="w-full py-14 md:py-16">
        <div className="mx-auto max-w-[1600px] px-6">
          {/* Section header */}
          <div className="mb-7">
            <div className="flex items-end justify-between gap-4">
              <div className="flex items-end gap-4">
                <div className="flex flex-col items-center">
                  <span className="font-mono text-5xl font-bold leading-none text-teal/90 tracking-tight">02</span>
                  <span className="mt-1 font-mono text-[9px] tracking-[0.2em] text-muted-foreground">SC-B02</span>
                </div>
                <div className="h-12 w-px bg-border" />
                <div>
                  <div className="font-mono text-[11px] tracking-[0.25em] text-muted-foreground uppercase">Agent Workbench · 智能体工作台</div>
                  <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                    方案生成与多 Agent 协同
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    四子 Agent 协同推理，全程可解释的工程决策过程
                  </p>
                </div>
              </div>
            </div>
            <div className="tick-decor mt-4" />
          </div>

          <Card className="corner-marks border-dashed border-2 border-border/60 bg-card/30 py-16">
            <CardContent className="flex flex-col items-center justify-center text-center">
              <div className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Building2 className="size-8" strokeWidth={1.5} />
              </div>
              <p className="mb-1 text-lg font-semibold text-foreground">Agent 工作台就绪</p>
              <p className="max-w-md text-sm text-muted-foreground">
                请在参数控制台填写项目信息并启动方案生成引擎，
                将在此展示多 Agent 协同推理过程与候选结构方案。
              </p>
              <div className="mt-4 flex items-center gap-3 text-[10px] text-muted-foreground">
                <Badge variant="outline" className="border-amber/40 bg-amber/10 text-amber font-mono">
                  演示轨迹模式
                </Badge>
                <span>·</span>
                <span>真实计算 + 专家思考模板</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    );
  }

  return (
    <section id="schemes" className="w-full py-14 md:py-16">
      <div className="mx-auto max-w-[1600px] px-6">
        {/* Section header */}
        <div className="mb-6">
          <div className="flex items-end justify-between gap-4">
            <div className="flex items-end gap-4">
              <div className="flex flex-col items-center">
                <span className="font-mono text-5xl font-bold leading-none text-teal/90 tracking-tight">02</span>
                <span className="mt-1 font-mono text-[9px] tracking-[0.2em] text-muted-foreground">SC-B02</span>
              </div>
              <div className="h-12 w-px bg-border" />
              <div>
                <div className="font-mono text-[11px] tracking-[0.25em] text-muted-foreground uppercase">Agent Workbench · 智能体工作台</div>
                <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                  方案生成与多 Agent 协同
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  四子 Agent 流水线推理，工具调用与思维过程全程可追溯
                </p>
              </div>
            </div>
            {schemes.length > 0 && !isGenerating && (
              <div className="flex items-center gap-2 font-mono text-[11px] text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                {schemes.length} SCHEMES · READY
              </div>
            )}
          </div>
          <div className="tick-decor mt-4" />
        </div>

        {/* Extreme param alert */}
        <AnimatePresence>
          {extremeAlert?.isExtreme && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-6 rounded-lg border border-warning/40 bg-warning/10 p-4"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
                <div className="flex-1">
                  <div className="mb-1 text-sm font-semibold text-foreground">
                    极端参数提示
                  </div>
                  <p className="text-xs text-muted-foreground">{extremeAlert.suggestion}</p>
                  {extremeAlert.reasons.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-[11px] text-warning/80">
                      {extremeAlert.reasons.map((r, i) => (
                        <li key={i}>· {r}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Agent Pipeline */}
        {showTimeline && (
          <Card className="corner-marks mb-6 border-border/60 bg-card/90">
            <CardContent className="p-4 md:p-5">
              <AgentPipelineView
                currentAgentIndex={displayAgentIndex}
                actionLog={displayLogs}
                isDemoMode={isDemoMode}
                selectedAgent={selectedAgent}
                onSelectAgent={handleSelectAgent}
                warningViewedAgents={warningViewedAgents}
                onMarkWarningViewed={handleMarkWarningViewed}
                isPlaying={isPlayerActive}
                onReplay={replayPlayer}
                canReplay={!isGenerating && isDemoMode && actionLog.length > 0}
              />
            </CardContent>
          </Card>
        )}

        {/* 思维链控制条 + 行动时间线 */}
        {showTimeline && (
          <Card className="corner-marks mb-6 border-border/60 bg-card/90">
            <CardHeader className="flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Building2 className="size-4 text-teal" strokeWidth={1.75} />
                  行动时间线
                </CardTitle>
                <CardDescription className="font-mono text-[10px] tracking-wider">
                  ACTION LOG · 共 {actionLog.length} 步
                </CardDescription>
              </div>
              <div className="flex items-center gap-1.5">
                {/* 收起/展开思考 */}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 border-border/50 px-2 text-[10px]"
                  onClick={onToggleThinking}
                >
                  {thinkingCollapsed ? (
                    <>
                      <Eye className="size-3" />
                      展开思考
                    </>
                  ) : (
                    <>
                      <EyeOff className="size-3" />
                      收起思考
                    </>
                  )}
                </Button>
                {/* 暂停/继续 */}
                {isGenerating && onTogglePause && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 border-border/50 px-2 text-[10px]"
                    onClick={onTogglePause}
                  >
                    {isPaused ? (
                      <>
                        <Play className="size-3" />
                        继续
                      </>
                    ) : (
                      <>
                        <Pause className="size-3" />
                        暂停
                      </>
                    )}
                  </Button>
                )}
                 {/* 跳过按钮：右下角浮动（大屏演示时醒目） */}
                 {isDemoMode && actionLog.length > 0 && !playerFinished && onSkipAnimation && isPlayerActive && (
                   <motion.button
                     initial={{ opacity: 0, y: 20, scale: 0.9 }}
                     animate={{ opacity: 1, y: 0, scale: 1 }}
                     transition={{ delay: 0.5, type: 'spring', stiffness: 250, damping: 20 }}
                     onClick={handleSkip}
                     className="!fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 backdrop-blur hover:bg-primary/90 hover-elevate active-elevate-2"
                   >
                     <FastForward className="size-4" />
                     跳过播放
                   </motion.button>
                 )}
                {/* 重跑 */}
                {!isGenerating && onRestart && schemes.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 border-border/50 px-2 text-[10px]"
                    onClick={onRestart}
                  >
                    <RotateCcw className="size-3" />
                    重跑
                  </Button>
                )}
                {/* 配置 */}
                {onOpenConfig && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 border-border/50 px-2 text-[10px]"
                    onClick={onOpenConfig}
                  >
                    <Settings className="size-3" />
                    Agent 设置
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {/* 点击了尚未启动/无日志的 Agent 时，展示其角色说明，避免"点了没反应" */}
              {selectedAgent && displayLogs.filter((l) => l.agent === selectedAgent).length === 0 && (
                <div className="mb-3 rounded-lg border border-border/50 bg-card/60 p-4">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="font-mono text-[10px] font-bold tracking-wider text-primary">
                      {SUB_AGENT_SPECS[selectedAgent].id.toUpperCase()}
                    </span>
                    <span className="text-sm font-semibold text-foreground">
                      {SUB_AGENT_SPECS[selectedAgent].name}
                    </span>
                    <Badge variant="outline" className="border-border/40 text-[9px] font-mono text-muted-foreground">
                      {SUB_AGENT_SPECS[selectedAgent].title}
                    </Badge>
                  </div>
                  <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
                    {SUB_AGENT_SPECS[selectedAgent].description}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {SUB_AGENT_SPECS[selectedAgent].allowedTools.map((t) => (
                      <span key={t} className="rounded border border-border/40 bg-muted/40 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <AgentActionTimeline
                ref={timelineRef}
                logs={displayLogs}
                thinkingCollapsed={thinkingCollapsed}
                autoScroll={!selectedAgent}
                filterAgent={selectedAgent}
                onClearFilter={handleClearFilter}
                typingText={currentTypingText}
                playingLog={currentPlayingLog}
                isPlaying={isPlayerActive}
                metrics={metrics}
              />
            </CardContent>
          </Card>
        )}

        {/* 方案卡片结果区（播放完成 / 非播放模式 时显示） */}
        {schemes.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: playerEnabled && !playerFinished ? 0 : 1, y: playerEnabled && !playerFinished ? 10 : 0 }}
            transition={{ duration: 0.5, delay: playerEnabled ? 0.2 : 0 }}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="h-px w-6 bg-primary/50" />
                <span className="font-mono text-[10px] font-bold tracking-[0.2em] text-primary">
                  生成结果 · GENERATED SCHEMES
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
                  {schemes.length} 套候选方案
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById('chat')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="group gap-1.5 border-teal/40 bg-teal/5 text-teal hover:bg-teal/10 hover:text-teal"
                >
                  <Bot className="h-3.5 w-3.5" />
                  <span className="hidden text-xs sm:inline">有问题问工程师</span>
                  <span className="text-xs sm:hidden">问AI</span>
                  <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {schemes.map((scheme, index) => {
                const isSelected = scheme.id === selectedSchemeId;
                const rank = index + 1;
                const isRecommended = rank === 1;
                return (
                  <motion.div
                    key={scheme.id}
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: index * 0.12, ease: [0.16, 1, 0.3, 1] }}
                    whileHover={{ y: -6, transition: { duration: 0.25, ease: 'easeOut' } }}
                    layout
                  >
                    <Card
                      onClick={() => onSelectScheme(scheme.id)}
                      className={`corner-marks-full group relative h-full cursor-pointer overflow-hidden transition-all duration-300 blueprint-card ${
                        isSelected
                          ? 'border-primary ring-2 ring-primary/20 shadow-lg shadow-primary/10'
                          : isRecommended
                            ? 'border-amber/50 ring-1 ring-amber/20 shadow-md shadow-amber/10 hover:border-amber/70 hover:shadow-lg hover:shadow-amber/15'
                            : 'border-border/60 hover:border-border hover:shadow-md'
                      } bg-card/95`}
                    >
                      <span className="corner-tl" />
                      <span className="corner-tr" />
                      <span className="corner-bl" />
                      <span className="corner-br" />
                      {/* Rank tab - 更大更醒目 */}
                      <div
                        className={`absolute -top-px left-4 z-10 px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider ${
                          rank === 1
                            ? 'bg-amber text-amber-foreground shadow-md shadow-amber/20'
                            : rank === 2
                              ? 'bg-teal text-white'
                              : 'bg-muted text-muted-foreground'
                        }`}
                        style={{ borderRadius: '0 0 3px 3px' }}
                      >
                        SCH-0{rank}
                      </div>
                      {/* 推荐方案顶部琥珀色梁式色带 */}
                      {isRecommended && (
                        <div className="absolute left-0 top-0 right-0 h-1.5 bg-gradient-to-r from-amber via-amber/80 to-amber/40" />
                      )}
                      {/* 推荐角标 */}
                      {isRecommended && (
                        <div className="absolute right-0 top-0 z-10">
                          <div className="flex items-center gap-1 bg-amber px-2 py-0.5 text-[10px] font-bold text-amber-foreground shadow-md"
                            style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 8% 100%)', paddingLeft: '16px', borderBottomLeftRadius: '2px' }}
                          >
                            <Award className="size-3" />
                            <span>推荐</span>
                          </div>
                        </div>
                      )}

                      <CardContent className="p-5 pt-6">
                        {/* Header */}
                        <div className="mb-3 mt-1">
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`flex size-9 items-center justify-center ${
                                rank === 1
                                  ? 'bg-amber/15 text-amber'
                                  : rank === 2
                                    ? 'bg-teal/15 text-teal'
                                    : 'bg-muted text-muted-foreground'
                              }`}
                              style={{ borderRadius: '3px' }}
                            >
                              <Building2 className="h-[18px] w-[18px]" strokeWidth={1.75} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="truncate text-base font-bold text-foreground">
                                {scheme.name}
                              </h3>
                              <div className="truncate font-mono text-[10px] text-muted-foreground tracking-wide">
                                {getStructureSystemLabel(scheme.name)}
                              </div>
                            </div>
                          </div>
                        </div>

                        <p className="mb-3 line-clamp-2 text-[11px] text-muted-foreground">
                          {scheme.description}
                        </p>

                        {/* Big metrics - 更大字号更突出 */}
                        <div className="mb-3 flex items-end justify-between border-y border-border/50 py-3.5">
                          <div>
                            <div className="font-mono text-[10px] tracking-wider text-muted-foreground">
                              COST · 单方造价
                            </div>
                            <div className="mt-1 flex items-baseline gap-0.5">
                              <span
                                className={`data-number text-2xl font-black ${
                                  rank === 1 ? 'text-amber' : 'text-foreground'
                                }`}
                              >
                                ¥{scheme.metrics.cost.toLocaleString()}
                              </span>
                              <span className="text-[11px] text-muted-foreground">/㎡</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono text-[10px] tracking-wider text-muted-foreground">
                              DURATION
                            </div>
                            <div className="data-number mt-1 text-xl font-bold text-foreground">
                              {scheme.metrics.duration}
                              <span className="text-[10px] font-normal text-muted-foreground"> 月</span>
                            </div>
                          </div>
                        </div>

                        {/* Mini metrics */}
                        <div className="grid grid-cols-3 gap-2">
                          <MiniMetric
                            icon={Shield}
                            label="抗震"
                            value={getSeismicLabel(scheme.metrics.seismicPerformance)}
                            color="text-emerald-400"
                          />
                          <MiniMetric
                            icon={Hammer}
                            label="施工难度"
                            value={getDifficultyLabel(scheme.metrics.constructionDifficulty)}
                            color="text-amber-400"
                          />
                          <MiniMetric
                            icon={Leaf}
                            label="碳排放"
                            value={`${scheme.metrics.carbonEmission}`}
                            unit="kg"
                            color="text-green-400"
                          />
                        </div>

                        {/* Pros hint */}
                        <div className="mt-3 space-y-1.5 text-[11px]">
                          <div className="flex items-start gap-1.5">
                            <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-success" />
                            <span className="text-muted-foreground line-clamp-1">
                              {scheme.advantages[0]}
                            </span>
                          </div>
                        </div>

                        {/* Bottom indicators */}
                        <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/50 pt-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[9px] tracking-wider text-muted-foreground">
                              PRECAST
                            </span>
                            <span className="text-[11px] font-semibold text-teal tabular-nums">
                              {scheme.metrics.precastRate.rate}%
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              · {scheme.metrics.precastRate.grade}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <AlertTriangle className="size-3 text-amber-500" />
                            <span className="font-mono text-[9px] tracking-wider text-muted-foreground">
                              RISK
                            </span>
                            <span className={`text-[11px] font-semibold tabular-nums ${
                              scheme.metrics.safetyRisk === 'low'
                                ? 'text-success'
                                : scheme.metrics.safetyRisk === 'medium'
                                ? 'text-warning'
                                : 'text-destructive'
                            }`}>
                              {scheme.metrics.safetyRisk === 'low'
                                ? '低'
                                : scheme.metrics.safetyRisk === 'medium'
                                ? '中'
                                : '高'}
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </div>
    </section>
  );
}

interface MiniMetricProps {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
}

function MiniMetric({ icon: Icon, label, value, unit, color }: MiniMetricProps) {
  return (
    <div className="border border-border/40 bg-background/40 p-2" style={{ borderRadius: '3px' }}>
      <div className="mb-1 flex items-center gap-1">
        <Icon className={`size-3 ${color ?? 'text-muted-foreground'}`} strokeWidth={1.75} />
        <span className="font-mono text-[8px] tracking-wider text-muted-foreground uppercase">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-0.5">
        <span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
        {unit && <span className="text-[9px] text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

export default memo(SchemesSection);
