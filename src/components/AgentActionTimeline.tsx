// AgentActionTimeline — 行动时间线
// 按 actionLog 顺序渲染四种条目：think / tool_call / tool_result / conclusion
// 支持按 Agent 过滤、滚动定位、警示条目自动展开、演示模式逐步播放
// EXPORTS: AgentActionTimeline

import { memo, useRef, useEffect, useState, useImperativeHandle, forwardRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import React from 'react';
import {
  Brain,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  Wrench,
  Copy,
  Check,
  X,
  Layers,
  Loader2,
  Network,
  List,
  Sparkles,
} from 'lucide-react';
import type { IAgentActionLog, AgentType, ITrajectoryMetrics } from '@/agent/types';
import { SUB_AGENT_SPECS } from '@/agent/types';
import AgentFlowMap from '@/components/AgentFlowMap';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { copyToClipboard } from '@lark-apaas/client-toolkit-lite';
import { cn } from '@/lib/utils';

interface AgentActionTimelineProps {
  logs: IAgentActionLog[];
  /** 是否收起思考过程（答辩模式） */
  thinkingCollapsed?: boolean;
  /** 自动滚动到最新 */
  autoScroll?: boolean;
  /** 当前过滤的 Agent（null = 全部） */
  filterAgent?: AgentType | null;
  /** 取消过滤回调 */
  onClearFilter?: () => void;
  /** 播放模式：当前正在打字的 think 文本 */
  typingText?: string;
  /** 播放模式：正在播放的条目（可能是 think/tool_call/tool_result/conclusion 的"进行中"态） */
  playingLog?: IAgentActionLog | null;
  /** 播放模式：是否正在播放（用于显示思考/加载光标） */
  isPlaying?: boolean;
  /** 元认知轨迹指标（节点 token/耗时来源） */
  metrics?: ITrajectoryMetrics;
}

export interface AgentActionTimelineRef {
  scrollToAgent: (agent: AgentType) => void;
  expandAgentWarnings: (agent: AgentType) => void;
  scrollToBottom: () => void;
}

const AgentActionTimeline = forwardRef<AgentActionTimelineRef, AgentActionTimelineProps>(
  function AgentActionTimeline(
    {
      logs,
      thinkingCollapsed = false,
      autoScroll = true,
      filterAgent = null,
      onClearFilter,
      typingText = '',
      playingLog = null,
      isPlaying = false,
      metrics,
    },
    ref
  ) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());
    const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());
    const [viewMode, setViewMode] = useState<'map' | 'list'>('map');

    // 暴露给父组件的方法
    useImperativeHandle(ref, () => ({
      scrollToAgent: (agent: AgentType) => {
        const firstIdx = logs.findIndex((l) => l.agent === agent);
        if (firstIdx >= 0 && scrollRef.current) {
          const firstStep = logs[firstIdx].step;
          const el = itemRefs.current.get(firstStep);
          if (el) {
            const container = scrollRef.current;
            const top = el.offsetTop - 12;
            container.scrollTo({ top, behavior: 'smooth' });
          }
        }
      },
      expandAgentWarnings: (agent: AgentType) => {
        const warningSteps = new Set<number>();
        logs.forEach((log) => {
          if (log.agent === agent && log.type === 'tool_result') {
            const { status } = analyzeResultStatus(log.result);
            if (status === 'warning' || status === 'fail') {
              warningSteps.add(log.step);
            }
          }
        });
        if (warningSteps.size > 0) {
          setExpandedTools((prev) => {
            const next = new Set(prev);
            warningSteps.forEach((s) => next.add(s));
            return next;
          });
        }
      },
      scrollToBottom: () => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      },
    }));

    // 自动滚动到最新（播放模式下新增一条就滚到底）
    useEffect(() => {
      if (autoScroll && !filterAgent && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, [logs.length, autoScroll, filterAgent, typingText.length, playingLog?.step]);

    const toggleTool = (step: number) => {
      setExpandedTools((prev) => {
        const next = new Set(prev);
        if (next.has(step)) next.delete(step);
        else next.add(step);
        return next;
      });
    };

    const getAgentLabel = (agent?: AgentType): string => {
      if (!agent) return '';
      const spec = SUB_AGENT_SPECS[agent as keyof typeof SUB_AGENT_SPECS];
      return spec?.name || agent;
    };

    const getAgentCode = (agent?: AgentType): string => {
      if (!agent) return '';
      const map: Record<string, string> = {
        architect: 'A-1',
        code: 'A-2',
        economist: 'A-3',
        chief: 'A-4',
      };
      return map[agent] || '';
    };

    const agentColorMap: Record<string, string> = {
      architect: 'bg-teal/20 text-teal border-teal/30',
      code: 'bg-amber/20 text-amber border-amber/30',
      economist: 'bg-emerald/20 text-emerald border-emerald/30',
      chief: 'bg-gold/15 text-gold border-gold/30',
    };

    const agentBadgeColorMap: Record<string, string> = {
      architect: 'border-teal/40 bg-teal/10 text-teal shadow-[0_0_18px_-3px_rgba(34,211,238,0.6)]',
      code: 'border-amber/40 bg-amber/10 text-amber shadow-[0_0_18px_-3px_rgba(245,158,11,0.6)]',
      economist: 'border-emerald/40 bg-emerald/10 text-emerald shadow-[0_0_18px_-3px_rgba(52,211,153,0.6)]',
      chief: 'border-gold/40 bg-gold/10 text-gold shadow-[0_0_18px_-3px_rgba(234,179,8,0.65)]',
    };

    const visibleLogs = useMemo(() => {
      return thinkingCollapsed ? logs.filter((l) => l.type !== 'think') : logs;
    }, [logs, thinkingCollapsed]);

    // 过滤模式下，排序：选中 Agent 的 warning/fail 结果排在该 Agent 片段最前
    const orderedLogs = useMemo(() => {
      if (!filterAgent) return visibleLogs;

      const agentFirstIdx = visibleLogs.findIndex((l) => l.agent === filterAgent);
      if (agentFirstIdx < 0) return visibleLogs;

      const warningSteps = new Set<number>();
      visibleLogs.forEach((log) => {
        if (log.agent === filterAgent && log.type === 'tool_result') {
          const { status } = analyzeResultStatus(log.result);
          if (status === 'warning' || status === 'fail') {
            warningSteps.add(log.step);
          }
        }
      });

      if (warningSteps.size === 0) return visibleLogs;

      const before: IAgentActionLog[] = [];
      const agentItems: IAgentActionLog[] = [];
      const after: IAgentActionLog[] = [];
      let phase: 'before' | 'agent' | 'after' = 'before';

      for (const log of visibleLogs) {
        if (phase === 'before') {
          if (log.agent === filterAgent) {
            phase = 'agent';
            agentItems.push(log);
          } else {
            before.push(log);
          }
        } else if (phase === 'agent') {
          if (log.agent === filterAgent) {
            agentItems.push(log);
          } else {
            phase = 'after';
            after.push(log);
          }
        } else {
          after.push(log);
        }
      }

      const warnings = agentItems.filter(
        (l) => l.type === 'tool_result' && warningSteps.has(l.step)
      );
      const others = agentItems.filter(
        (l) => !(l.type === 'tool_result' && warningSteps.has(l.step))
      );

      return [...before, ...warnings, ...others, ...after];
    }, [visibleLogs, filterAgent]);

    const setItemRef = (step: number, el: HTMLDivElement | null) => {
      if (el) {
        itemRefs.current.set(step, el);
      } else {
        itemRefs.current.delete(step);
      }
    };

  const handleCopyResult = async (result: unknown) => {
    try {
      await copyToClipboard(JSON.stringify(result, null, 2));
      toast.success('结果已复制到剪贴板');
    } catch {
      toast.error('复制失败');
    }
  };

  // ============ 规范校核详情：条文原文 + 判定理由卡片 ============
  function renderNormCheckDetail(toolName: string | undefined, result: unknown): React.ReactElement | null {
    if (toolName === 'check_seismic_requirements') {
      const r = result as { checks?: Array<{ name: string; status: string; clauseText?: string; reason?: string; source?: string; requirement?: string; value?: string }> };
      const items = r.checks?.filter((c) => c.clauseText || c.reason) ?? [];
      if (items.length === 0) return null;
      return (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div
              key={i}
              className="rounded-md border border-border/50 bg-muted/30 p-2.5 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground sm:text-sm">{item.name}</span>
                <span
                  className={cn(
                    'shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium sm:text-xs',
                    item.status === 'pass' && 'bg-success/15 text-success',
                    item.status === 'warning' && 'bg-warning/20 text-warning-foreground',
                    item.status === 'fail' && 'bg-destructive/15 text-destructive'
                  )}
                >
                  {item.status === 'pass' ? '符合' : item.status === 'warning' ? '需注意' : '不符合'}
                </span>
              </div>
              {item.clauseText && (
                <div className="rounded-sm bg-background/80 px-2 py-1.5 sm:px-3 sm:py-2">
                  <div className="norm-detail-title text-[10px] font-medium text-primary/80 mb-0.5 sm:text-xs">▎条文原文</div>
                  <p className="text-[11px] leading-relaxed text-foreground/80 sm:text-sm">{item.clauseText}</p>
                </div>
              )}
              {item.reason && (
                <div className="rounded-sm bg-background/80 px-2 py-1.5 sm:px-3 sm:py-2">
                  <div className="norm-detail-title text-[10px] font-medium text-teal mb-0.5 sm:text-xs">▎判定理由</div>
                  <p className="text-[11px] leading-relaxed text-foreground/80 sm:text-sm">{item.reason}</p>
                </div>
              )}
              {item.source && (
                <div className="text-[10px] text-muted-foreground font-mono sm:text-xs">出处：{item.source}</div>
              )}
            </div>
          ))}
        </div>
      );
    }
    if (toolName === 'check_fire_requirements') {
      const r = result as { checks?: Array<{ article: string; status: string; clauseText?: string; reason?: string; source?: string }> };
      const items = r.checks?.filter((c) => c.clauseText || c.reason) ?? [];
      if (items.length === 0) return null;
      return (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="rounded-md border border-border/50 bg-muted/30 p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">{item.article}</span>
                <span
                  className={cn(
                    'shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium',
                    item.status === 'pass' && 'bg-success/15 text-success',
                    item.status === 'warning' && 'bg-warning/20 text-warning-foreground',
                    item.status === 'fail' && 'bg-destructive/15 text-destructive'
                  )}
                >
                  {item.status === 'pass' ? '符合' : item.status === 'warning' ? '需注意' : '不符合'}
                </span>
              </div>
              {item.clauseText && (
                <div className="rounded-sm bg-background/80 px-2 py-1.5">
                  <div className="text-[10px] font-medium text-primary/80 mb-0.5">▎条文原文</div>
                  <p className="text-[11px] leading-relaxed text-foreground/80">{item.clauseText}</p>
                </div>
              )}
              {item.reason && (
                <div className="rounded-sm bg-background/80 px-2 py-1.5">
                  <div className="text-[10px] font-medium text-teal mb-0.5">▎判定理由</div>
                  <p className="text-[11px] leading-relaxed text-foreground/80">{item.reason}</p>
                </div>
              )}
              {item.source && (
                <div className="text-[10px] text-muted-foreground font-mono">出处：{item.source}</div>
              )}
            </div>
          ))}
        </div>
      );
    }
    return null;
  }

    const filterAgentLabel = filterAgent ? getAgentLabel(filterAgent) : '';
    const filterAgentCode = filterAgent ? getAgentCode(filterAgent) : '';

    // 播放中是否显示思考光标（think 打字机尾部闪烁）
    const showTypingCursor = isPlaying && playingLog?.type === 'think' && typingText.length > 0;

    // 视图切换按钮
    const viewToggle = (
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-md border border-border/40 bg-background/50 p-0.5">
          <button
            type="button"
            onClick={() => setViewMode('map')}
            className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[10px] font-medium transition-colors ${
              viewMode === 'map'
                ? 'bg-teal/15 text-teal'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Network className="size-3" />
            思维导图
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[10px] font-medium transition-colors ${
              viewMode === 'list'
                ? 'bg-teal/15 text-teal'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <List className="size-3" />
            明细
          </button>
        </div>
        {viewMode === 'map' && (
          <span className="font-mono text-[9px] text-muted-foreground/60">
            CODE → ARCHITECT 打回显示红色弧线 · 右上「全屏」可放大（录屏推荐）
          </span>
        )}
      </div>
    );

    if (viewMode === 'map') {
      return (
        <div className="flex h-full flex-col">
          {viewToggle}
          <div
            className="pres-flow-map w-full flex-1 overflow-y-auto pr-1"
            style={{ maxHeight: '520px' }}
          >
            <AgentFlowMap
              logs={logs}
              playingStep={isPlaying ? playingLog?.step ?? null : null}
              isPlaying={isPlaying}
              metrics={metrics}
            />
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-full flex-col">
        {viewToggle}
        {/* 过滤状态条 */}
        <AnimatePresence>
          {filterAgent && (
            <motion.div
              key="filter-bar"
              initial={{ opacity: 0, height: 0, marginTop: -8 }}
              animate={{ opacity: 1, height: 'auto', marginTop: 0 }}
              exit={{ opacity: 0, height: 0, marginTop: -8 }}
              transition={{ duration: 0.25 }}
              className="mb-3 flex shrink-0 items-center justify-between gap-2 overflow-hidden"
            >
              <div className="flex items-center gap-2">
                <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground">正在查看：</span>
                <Badge
                  variant="outline"
                  className={`gap-1 text-[10px] font-medium ${agentBadgeColorMap[filterAgent] || ''}`}
                >
                  {filterAgentCode} · {filterAgentLabel}
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={onClearFilter}
              >
                <X className="size-3" />
                返回全部
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        <div
          ref={scrollRef}
          className="pres-timeline min-h-[320px] w-full flex-1 space-y-1.5 overflow-y-auto pr-2"
          style={{ maxHeight: '520px' }}
        >
          {orderedLogs.length === 0 && !isPlaying ? (
            <div className="flex h-[280px] flex-col items-center justify-center text-center">
              <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted/50">
                <Brain className="size-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">等待输入参数或选择案例</p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                填写项目参数并点击生成方案后，将显示 Agent 的完整思考与调用过程
              </p>
            </div>
          ) : (
            <>
              <AnimatePresence initial={false}>
                {orderedLogs.map((log, i) => {
                  const isLast = i === orderedLogs.length - 1;
                  const isFiltered = filterAgent && log.agent !== filterAgent;

                  if (log.type === 'think') {
                    // 记忆 / 元认知日志醒目展示（评委可见「系统在思考、在进化」）
                    const isMemLog = log.content?.startsWith('[Memory') || log.content?.startsWith('[Metacognition]');
                    return (
                      <div key={log.step} ref={(el) => setItemRef(log.step, el)}>
                        <motion.div
                          initial={{ opacity: 0, x: -10 }}
                          animate={{
                            opacity: isFiltered ? 0.25 : 1,
                            x: 0,
                          }}
                          transition={{ duration: 0.3 }}
                          className="relative flex gap-3 pl-1"
                        >
                          <div className="relative flex flex-col items-center">
                            <div className={`mt-1.5 size-2 shrink-0 rounded-full ring-2 ${isMemLog ? 'bg-gold ring-gold/30' : 'bg-teal/70 ring-teal/20'}`} />
                            {!isLast && <div className={`w-px flex-1 ${isMemLog ? 'bg-gold/20' : 'bg-teal/20'}`} />}
                          </div>
                          <div className="flex-1 pb-3">
                            <div className="mb-1 flex items-center gap-2">
                              <span
                                className={`timeline-badge inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[9px] font-medium ${
                                  isMemLog
                                    ? 'border-gold/40 bg-gold/10 text-gold shadow-[0_0_12px_-3px_rgba(234,179,8,0.6)]'
                                    : agentColorMap[log.agent || 'architect'] || agentColorMap.architect
                                }`}
                                style={{ borderRadius: '2px' }}
                              >
                                {isMemLog ? <Sparkles className="size-2.5" /> : <Lightbulb className="size-2.5" />}
                                {isMemLog ? (log.content?.startsWith('[Metacognition]') ? '元认知' : '记忆') : getAgentLabel(log.agent) + ' · 思考'}
                              </span>
                              <span className="font-mono text-[9px] text-muted-foreground/60">
                                STEP {String(log.step).padStart(2, '0')}
                              </span>
                            </div>
                            <div className={`whitespace-pre-wrap text-xs leading-relaxed ${isMemLog ? 'rounded-md border border-gold/20 bg-gold/[0.06] px-2.5 py-1.5 font-medium text-gold' : 'pres-think-text text-foreground/80'}`}>
                              {log.content}
                            </div>
                          </div>
                        </motion.div>
                      </div>
                    );
                  }

                  if (log.type === 'tool_call') {
                    return (
                      <div key={log.step} ref={(el) => setItemRef(log.step, el)}>
                        <motion.div
                          initial={{ opacity: 0, x: -10 }}
                          animate={{
                            opacity: isFiltered ? 0.25 : 1,
                            x: 0,
                          }}
                          transition={{ duration: 0.3 }}
                          className="relative flex gap-3 pl-1"
                        >
                          <div className="relative flex flex-col items-center">
                            <div className="mt-1.5 size-2 shrink-0 rounded-full bg-primary ring-2 ring-primary/20" />
                            {!isLast && <div className="w-px flex-1 bg-border/50" />}
                          </div>
                          <div className="flex-1 pb-3">
                            <div className="mb-1 flex items-center gap-2">
                              <span className="timeline-badge inline-flex items-center gap-1 border border-border/50 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                                <Wrench className="size-2.5 text-primary" />
                                {log.tool}
                              </span>
                              <span className="font-mono text-[9px] text-muted-foreground/60">
                                STEP {String(log.step).padStart(2, '0')}
                              </span>
                            </div>
                            {log.args && Object.keys(log.args).length > 0 && (
                              <div className="mt-1 rounded-md border border-dashed border-border/40 bg-background/40 px-2.5 py-2 font-mono text-[10px] text-muted-foreground">
                                {summarizeArgs(log.args)}
                              </div>
                            )}
                          </div>
                        </motion.div>
                      </div>
                    );
                  }

                  if (log.type === 'tool_result') {
                    const isExpanded = expandedTools.has(log.step);
                    const { status, statusColor } = analyzeResultStatus(log.result);
                    const isTopWarning =
                      filterAgent && log.agent === filterAgent && (status === 'warning' || status === 'fail');

                    return (
                      <div key={log.step} ref={(el) => setItemRef(log.step, el)}>
                        <motion.div
                          initial={{ opacity: 0, x: -10 }}
                          animate={{
                            opacity: isFiltered ? 0.25 : 1,
                            x: 0,
                          }}
                          transition={{ duration: 0.3 }}
                          className={`relative flex gap-3 pl-1 ${isTopWarning ? 'rounded-md bg-warning/[0.04] -mx-1 px-1' : ''}`}
                        >
                          <div className="relative flex flex-col items-center">
                            <div
                              className={`mt-1.5 size-2 shrink-0 rounded-full ring-2 ${
                                status === 'pass'
                                  ? 'bg-success ring-success/20'
                                  : status === 'warning'
                                    ? 'bg-warning ring-warning/20'
                                    : status === 'fail'
                                      ? 'bg-destructive ring-destructive/20'
                                      : 'bg-teal ring-teal/20'
                              }`}
                            />
                            {!isLast && <div className="w-px flex-1 bg-border/50" />}
                          </div>
                          <div className="flex-1 pb-3">
                            <div className="mb-1 flex items-center gap-2">
                              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                                <Cpu className="size-2.5" />
                                {log.tool} → 结果
                              </span>
                              {status !== 'neutral' && (
                                <span
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-medium ${statusColor}`}
                                  style={{ borderRadius: '2px' }}
                                >
                                  {status === 'pass' ? (
                                    <CheckCircle2 className="size-2.5" />
                                  ) : (
                                    <AlertTriangle className="size-2.5" />
                                  )}
                                  {status === 'pass' ? '符合' : status === 'warning' ? '需注意' : '不符合'}
                                </span>
                              )}
                              <button
                                onClick={() => toggleTool(log.step)}
                                className="ml-auto inline-flex items-center gap-0.5 text-[9px] text-muted-foreground hover:text-foreground"
                              >
                                {isExpanded ? (
                                  <>
                                    收起 <ChevronUp className="size-2.5" />
                                  </>
                                ) : (
                                  <>
                                    展开 <ChevronDown className="size-2.5" />
                                  </>
                                )}
                              </button>
                            </div>
                             <div className="timeline-result-text text-xs text-foreground/80">{log.content}</div>
                            {isExpanded && log.result && (
                              <div className="mt-2 space-y-2">
                                {renderNormCheckDetail(log.tool, log.result)}
                                <div className="relative">
                                  <pre className="max-h-[180px] overflow-auto rounded-md border border-border/40 bg-background/60 p-2.5 font-mono text-[10px] leading-relaxed text-foreground/70">
                                    {JSON.stringify(log.result, null, 2)}
                                  </pre>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="!absolute right-1 top-1 h-6 w-6"
                                    onClick={() => handleCopyResult(log.result)}
                                  >
                                    <Copy className="size-3" />
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      </div>
                    );
                  }

                  if (log.type === 'conclusion') {
                    return (
                      <div key={log.step} ref={(el) => setItemRef(log.step, el)}>
                        <motion.div
                          initial={{ opacity: 0, scale: 0.98 }}
                          animate={{
                            opacity: isFiltered ? 0.25 : 1,
                            scale: isFiltered ? 0.98 : 1,
                          }}
                          transition={{ duration: 0.4 }}
                          className="relative mb-2 ml-1"
                        >
                          <div className="relative overflow-hidden rounded-md border border-primary/30 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-3">
                            <div className="mb-1.5 flex items-center gap-2">
                              <span className="inline-flex items-center gap-1.5 border border-primary/40 bg-primary/20 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-primary">
                                <CheckCircle2 className="size-3" />
                                {getAgentLabel(log.agent)} · 结论
                              </span>
                              <span className="font-mono text-[9px] text-primary/60">
                                STEP {String(log.step).padStart(2, '0')}
                              </span>
                            </div>
                            <div className="pres-think-text whitespace-pre-wrap text-sm font-medium leading-relaxed text-foreground">
                              {log.content}
                            </div>
                          </div>
                          {!isLast && <div className="ml-2 mt-1 h-3 w-px bg-border/50" />}
                        </motion.div>
                      </div>
                    );
                  }

                  return null;
                })}
              </AnimatePresence>

              {/* 正在播放的条目（打字机 / 工具调用中） */}
              {isPlaying && playingLog && (
                <div key={`playing-${playingLog.step}`} className="relative flex gap-3 pl-1">
                  <div className="relative flex flex-col items-center">
                    <div className="mt-1.5 size-2 shrink-0 animate-pulse rounded-full bg-teal/80 ring-2 ring-teal/30" />
                    <div className="w-px flex-1 bg-teal/30" />
                  </div>
                  <div className="flex-1 pb-3">
                    {playingLog.type === 'think' && (
                      <>
                        <div className="mb-1 flex items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[9px] font-medium ${agentColorMap[playingLog.agent || 'architect'] || agentColorMap.architect}`}
                            style={{ borderRadius: '2px' }}
                          >
                            <Lightbulb className="size-2.5" />
                            {getAgentLabel(playingLog.agent)} · 思考中
                          </span>
                          <span className="font-mono text-[9px] text-muted-foreground/60">
                            STEP {String(playingLog.step).padStart(2, '0')}
                          </span>
                        </div>
                        <div className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/80">
                          {typingText}
                          {showTypingCursor && (
                            <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-teal/70 align-middle" />
                          )}
                        </div>
                      </>
                    )}

                    {playingLog.type === 'tool_call' && (
                      <>
                        <div className="mb-1 flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 border border-border/50 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                            <Loader2 className="size-2.5 animate-spin text-primary" />
                            {playingLog.tool}
                          </span>
                          <span className="font-mono text-[9px] text-muted-foreground/60">
                            调用中 · STEP {String(playingLog.step).padStart(2, '0')}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex gap-0.5">
                            <span className="h-1 w-1 animate-bounce rounded-full bg-primary/50 [animation-delay:-0.3s]" />
                            <span className="h-1 w-1 animate-bounce rounded-full bg-primary/50 [animation-delay:-0.15s]" />
                            <span className="h-1 w-1 animate-bounce rounded-full bg-primary/50" />
                          </div>
                          <span className="text-[10px] text-muted-foreground">{describeToolCall(playingLog.tool)}</span>
                        </div>
                      </>
                    )}

                    {playingLog.type === 'tool_result' && (
                      <>
                        <div className="mb-1 flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                            <Cpu className="size-2.5" />
                            {playingLog.tool} → 结果
                          </span>
                          <span className="font-mono text-[9px] text-muted-foreground/60">
                            解析中
                          </span>
                        </div>
                        <div className="text-xs text-foreground/60">正在整理计算结果...</div>
                      </>
                    )}

                    {playingLog.type === 'conclusion' && (
                      <div className="relative overflow-hidden rounded-md border border-primary/40 bg-gradient-to-r from-primary/15 via-primary/8 to-transparent p-3">
                        <div className="mb-1.5 flex items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 border border-primary/40 bg-primary/20 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-primary">
                            <Loader2 className="size-3 animate-spin" />
                            {getAgentLabel(playingLog.agent)} · 结论生成中
                          </span>
                        </div>
                        <div className="flex gap-1">
                          <span className="h-1 w-4 animate-pulse rounded-full bg-primary/40" />
                          <span className="h-1 w-6 animate-pulse rounded-full bg-primary/30 [animation-delay:0.2s]" />
                          <span className="h-1 w-3 animate-pulse rounded-full bg-primary/20 [animation-delay:0.4s]" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }
);

/** 工具参数摘要（简短可读） */
function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  Object.entries(args).forEach(([key, value]) => {
    if (typeof value === 'object' && value !== null) {
      parts.push(`${key}: {...}`);
    } else if (typeof value === 'string') {
      const short = value.length > 30 ? value.slice(0, 30) + '...' : value;
      parts.push(`${key}: "${short}"`);
    } else {
      parts.push(`${key}: ${String(value)}`);
    }
  });
  return parts.join(', ');
}

/** 分析结果状态（三态） */
function analyzeResultStatus(result: unknown): {
  status: 'pass' | 'warning' | 'fail' | 'neutral';
  statusColor: string;
} {
  if (!result || typeof result !== 'object') {
    return { status: 'neutral', statusColor: '' };
  }
  const r = result as Record<string, unknown>;

  if (typeof r.failCount === 'number' && r.failCount > 0) {
    return { status: 'fail', statusColor: 'bg-destructive/15 text-destructive' };
  }
  if (typeof r.warningCount === 'number' && r.warningCount > 0) {
    return { status: 'warning', statusColor: 'bg-warning/15 text-warning' };
  }
  if (typeof r.passCount === 'number') {
    return { status: 'pass', statusColor: 'bg-success/15 text-success' };
  }
  if (r.foundationType && r.suitability === 'high') {
    return { status: 'pass', statusColor: 'bg-success/15 text-success' };
  }
  if (r.suitability === 'medium') {
    return { status: 'warning', statusColor: 'bg-warning/15 text-warning' };
  }
  if (r.suitability === 'low') {
    return { status: 'fail', statusColor: 'bg-destructive/15 text-destructive' };
  }

  return { status: 'neutral', statusColor: '' };
}

/** 工具调用的可读描述（思考气泡文案） */
function describeToolCall(tool?: string): string {
  if (!tool) return '正在调用工具...';
  const map: Record<string, string> = {
    check_seismic_requirements: '正在查阅 GB 55002 抗震规范...',
    check_fire_requirements: '正在查阅 GB 55037 防火规范...',
    estimate_cost: '正在测算工程成本...',
    estimate_carbon: '正在估算建材生产与运输碳排放...',
    check_foundation: '正在评估地基基础方案...',
    check_frame: '正在校核框架结构选型...',
    check_wind: '正在核算风荷载作用...',
  };
  if (map[tool]) return map[tool];
  const pretty = tool.replace('check_', '').replaceAll('_', ' ');
  return `正在执行 ${pretty}...`;
}

export default memo(AgentActionTimeline);
