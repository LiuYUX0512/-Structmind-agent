// AgentPipelineView — 多 Agent 协同流水线视图（视觉升级版）
// 横向展示四个子 Agent 卡片：方案创作 → 规范校核 → 经济评估 → 总工评审
// 每个卡片独特颜色标识，卡片间箭头连接，当前执行有呼吸动效
// EXPORTS: AgentPipelineView

import { memo } from 'react';
import { motion } from 'framer-motion';
import {
  Building2,
  FileCheck2,
  Wallet,
  Crown,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Brain,
  Cog,
  RotateCcw,
  ChevronRight,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SUB_AGENT_SPECS, type AgentType, type IAgentActionLog } from '@/agent/types';

interface AgentPipelineViewProps {
  currentAgentIndex: number;
  actionLog: IAgentActionLog[];
  isDemoMode: boolean;
  selectedAgent: AgentType | null;
  onSelectAgent: (agent: AgentType) => void;
  warningViewedAgents: Set<AgentType>;
  onMarkWarningViewed: (agent: AgentType) => void;
  isPlaying?: boolean;
  onReplay?: () => void;
  canReplay?: boolean;
}

const AGENT_ORDER: AgentType[] = ['architect', 'code', 'economist', 'chief'];

const AGENT_ICONS = {
  architect: Building2,
  code: FileCheck2,
  economist: Wallet,
  chief: Crown,
};

const AGENT_CODES = {
  architect: 'A-1',
  code: 'A-2',
  economist: 'A-3',
  chief: 'A-4',
};

// 每个 Agent 的主题色（用于 icon 背景、选中态、呼吸效果）
const AGENT_THEME = {
  architect: {
    bg: 'bg-primary/15',
    text: 'text-primary',
    border: 'border-primary',
    ring: 'ring-primary/20',
    shadow: 'shadow-primary/15',
    glow: 'rgba(15, 76, 129, 0.3)',
    label: 'architect-blue',
  },
  code: {
    bg: 'bg-amber/15',
    text: 'text-amber',
    border: 'border-amber',
    ring: 'ring-amber/20',
    shadow: 'shadow-amber/15',
    glow: 'rgba(232, 147, 12, 0.3)',
    label: 'code-amber',
  },
  economist: {
    bg: 'bg-teal/15',
    text: 'text-teal',
    border: 'border-teal',
    ring: 'ring-teal/20',
    shadow: 'shadow-teal/15',
    glow: 'rgba(18, 165, 181, 0.3)',
    label: 'economist-teal',
  },
  chief: {
    bg: 'bg-[#0c4a6e]/15',
    text: 'text-[#0c4a6e]',
    border: 'border-[#0c4a6e]',
    ring: 'ring-[#0c4a6e]/20',
    shadow: 'shadow-[#0c4a6e]/15',
    glow: 'rgba(12, 74, 110, 0.3)',
    label: 'chief-deep',
  },
};

function AgentPipelineView({
  currentAgentIndex,
  actionLog,
  isDemoMode,
  selectedAgent,
  onSelectAgent,
  warningViewedAgents,
  onMarkWarningViewed,
  isPlaying = false,
  onReplay,
  canReplay = false,
}: AgentPipelineViewProps) {
  const getAgentStatus = (idx: number): 'pending' | 'active' | 'done' | 'warning' => {
    if (idx < currentAgentIndex) {
      const agentId = AGENT_ORDER[idx];
      const agentLogs = actionLog.filter(
        (l) => l.agent === agentId && l.type === 'tool_result'
      );
      const hasFail = agentLogs.some((l) => {
        const r = l.result as Record<string, unknown> | undefined;
        return r && (r.failCount as number) > 0;
      });
      const hasWarning = agentLogs.some((l) => {
        const r = l.result as Record<string, unknown> | undefined;
        return r && (r.warningCount as number) > 0;
      });
      return hasFail || hasWarning ? 'warning' : 'done';
    }
    if (idx === currentAgentIndex && currentAgentIndex < 4) return 'active';
    return 'pending';
  };

  const getAgentSummary = (idx: number): string => {
    const agentId = AGENT_ORDER[idx];
    const agentLogs = actionLog.filter((l) => l.agent === agentId);
    const conclusion = agentLogs.find((l) => l.type === 'conclusion');
    if (conclusion) {
      return conclusion.content.split('\n')[0].slice(0, 38);
    }
    const toolResults = agentLogs.filter((l) => l.type === 'tool_result').length;
    if (toolResults > 0) {
      return `已调用 ${toolResults} 个工具`;
    }
    return '';
  };

  const handleCardClick = (agentId: AgentType, status: string) => {
    onSelectAgent(agentId);
    if (status === 'warning' && !warningViewedAgents.has(agentId)) {
      onMarkWarningViewed(agentId);
    }
  };

  return (
    <div className="w-full">
      <div className="pres-agent-grid grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-4">
        {AGENT_ORDER.map((agentId, idx) => {
          const spec = SUB_AGENT_SPECS[agentId as keyof typeof SUB_AGENT_SPECS];
          const Icon = AGENT_ICONS[agentId as keyof typeof AGENT_ICONS];
          const status = getAgentStatus(idx);
          const summary = getAgentSummary(idx);
          const isSelected = selectedAgent === agentId;
          const isClickable = status !== 'pending';
          const showStrongBreath = status === 'warning' && !warningViewedAgents.has(agentId);
          const theme = AGENT_THEME[agentId as keyof typeof AGENT_THEME];
          const code = AGENT_CODES[agentId as keyof typeof AGENT_CODES];

          const statusIcon =
            status === 'done' ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            ) : status === 'active' ? (
              <Brain className="h-3.5 w-3.5" />
            ) : status === 'warning' ? (
              <AlertTriangle className="h-3.5 w-3.5 text-warning" />
            ) : (
              <Clock className="h-3.5 w-3.5 text-muted-foreground/50" />
            );

          const statusLabel =
            status === 'done'
              ? '已完成'
              : status === 'active'
                ? '进行中'
                : status === 'warning'
                  ? '有警示'
                  : '等待中';

          return (
            <div key={agentId} className="relative">
              <Card
                onClick={isClickable ? () => handleCardClick(agentId, status) : undefined}
                className={`pres-agent-card group corner-marks relative h-full overflow-hidden transition-all duration-300 blueprint-card ${
                  isClickable ? 'cursor-pointer' : 'cursor-default'
                } ${
                  isSelected
                    ? `${theme.border} ${theme.ring} ring-2 shadow-md ${theme.shadow} bg-white`
                    : status === 'active'
                      ? `${theme.border}/60 ${theme.ring} ring-1 shadow-sm ${theme.shadow} bg-white`
                      : status === 'done'
                        ? 'border-border/60 bg-card/90 hover:border-border hover:shadow-sm'
                        : status === 'warning'
                          ? 'border-warning/50 bg-warning/[0.05]'
                          : 'border-border/30 bg-card/40 opacity-60'
                }`}
              >
                {/* 顶部色带 - 标识各 Agent 专属颜色 */}
                <div className={`absolute left-0 right-0 top-0 h-1 ${theme.bg.replace('/15', '')}`} style={{ opacity: 0.7 }} />

                {/* 警示强呼吸效果 */}
                {showStrongBreath && (
                  <motion.div
                    className="pointer-events-none absolute inset-0 rounded-xl"
                    animate={{
                      boxShadow: [
                        `0 0 0 0 ${theme.glow.replace('0.3', '0')}`,
                        `0 0 0 6px ${theme.glow}`,
                        `0 0 0 0 ${theme.glow.replace('0.3', '0')}`,
                      ],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                  />
                )}

                {/* active 状态呼吸发光 */}
                {status === 'active' && (
                  <motion.div
                    className="pointer-events-none absolute inset-0 rounded-xl"
                    animate={{
                      boxShadow: [
                        `0 0 0 0 ${theme.glow.replace('0.3', '0')}`,
                        `0 0 0 4px ${theme.glow}`,
                        `0 0 0 0 ${theme.glow.replace('0.3', '0')}`,
                      ],
                    }}
                    transition={{
                      duration: 2.2,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                  />
                )}

                <div className="p-3 pt-4 md:p-4 md:pt-5">
                  {/* Header */}
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className={`font-mono text-[10px] font-bold tracking-wider ${theme.text}`}>
                      {code}
                    </span>
                    <Badge
                      variant="outline"
                      className={`h-5 px-1.5 text-[9px] font-medium transition-colors ${
                        status === 'active'
                          ? `${theme.border}/40 ${theme.bg} ${theme.text}`
                          : status === 'done'
                            ? 'border-success/40 bg-success/10 text-success'
                            : status === 'warning'
                              ? 'border-warning/40 bg-warning/10 text-warning'
                              : 'border-border/40 text-muted-foreground'
                      }`}
                    >
                      <span className="mr-1 inline-flex">{statusIcon}</span>
                      {statusLabel}
                    </Badge>
                  </div>

                  {/* Icon + Name - 大图标更醒目 */}
                  <div className="mb-2.5 flex items-center gap-3">
                    <div
                      className={`flex size-11 shrink-0 items-center justify-center transition-all duration-300 ${
                        isSelected || status === 'active'
                          ? `${theme.bg} ${theme.text}`
                          : status === 'done'
                            ? 'bg-primary/12 text-primary'
                            : status === 'warning'
                              ? 'bg-warning/20 text-warning'
                              : 'bg-muted text-muted-foreground'
                      }`}
                      style={{ borderRadius: '4px' }}
                    >
                      {status === 'active' ? (
                        <motion.div
                          animate={{ rotate: [0, 12, -12, 0] }}
                          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                          className={theme.text}
                        >
                          <Cog className="size-5" />
                        </motion.div>
                      ) : (
                        <Icon className="size-5" strokeWidth={1.75} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="agent-name text-sm font-bold text-foreground">
                        {spec.name}
                      </div>
                      <div className="truncate font-mono text-[9px] text-muted-foreground tracking-wide">
                        {spec.title}
                      </div>
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="agent-summary min-h-[36px] text-[11px] leading-relaxed text-muted-foreground">
                    {summary || (
                      <span className="text-muted-foreground/50 italic">
                        {status === 'pending' ? '待启动...' : '分析进行中...'}
                      </span>
                    )}
                  </div>

                  {/* 可点击提示 */}
                  {isClickable && (
                    <div className="mt-2 flex items-center justify-end">
                      <span className={`font-mono text-[8px] tracking-wider transition-colors group-hover:${theme.text} text-muted-foreground/60`}>
                        点击查看 →
                      </span>
                    </div>
                  )}
                </div>

                {/* Active 状态底部进度条 */}
                {status === 'active' && (
                  <motion.div
                    className={`absolute bottom-0 left-0 right-0 h-0.5 ${theme.bg.replace('/15', '')}`}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 1.5, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }}
                    style={{ transformOrigin: 'left', opacity: 0.8 }}
                  />
                )}

                {/* 选中状态底部条 */}
                {isSelected && status !== 'active' && (
                  <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${theme.bg.replace('/15', '')}`} style={{ opacity: 0.7 }} />
                )}
              </Card>

              {/* 箭头连接线（除最后一个）- 更醒目 */}
              {idx < AGENT_ORDER.length - 1 && (
                <div className="absolute top-1/2 -right-2.5 z-10 hidden -translate-y-1/2 md:flex items-center">
                  <motion.div
                    className="flex items-center justify-center"
                    animate={
                      status === 'done' || status === 'warning'
                        ? { x: [0, 2, 0] }
                        : {}
                    }
                    transition={{
                      duration: 1.5,
                      repeat: status === 'done' || status === 'warning' ? Infinity : 0,
                      ease: 'easeInOut',
                    }}
                  >
                    <div
                      className={`h-px w-4 ${
                        status === 'done' || status === 'warning'
                          ? 'bg-teal/60'
                          : 'bg-border/50'
                      }`}
                    />
                    <ChevronRight
                      className={`size-3 -ml-1 ${
                        status === 'done' || status === 'warning'
                          ? 'text-teal/80'
                          : 'text-border/60'
                      }`}
                      strokeWidth={2}
                    />
                  </motion.div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Mode indicator + progress */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-3">
        <div className="flex items-center gap-2">
          <Badge
            className={`gap-1 text-[10px] font-medium ${
              actionLog.length === 0
                ? 'border-muted-foreground/30 bg-muted/40 text-muted-foreground'
                : isDemoMode
                  ? 'border-amber/40 bg-amber/10 text-amber'
                  : 'border-teal/40 bg-teal/10 text-teal'
            }`}
            variant="outline"
          >
            {actionLog.length === 0
              ? '待启动 · 尚未运行'
              : isDemoMode ? '演示轨迹模式 · 计算真实' : '真实推理模式 · LLM 接入'}
          </Badge>
          <span className="font-mono text-[10px] text-muted-foreground">
            {actionLog.length === 0
              ? '填写参数并生成方案后，四 Agent 将协同推理'
              : isDemoMode ? '思考内容为专家模板动态组合' : '由大模型驱动 function calling'}
          </span>
          {canReplay && onReplay && (
            <button
              onClick={onReplay}
              className="ml-1 inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
              title="重新播放过程"
            >
              <RotateCcw className="size-3" />
              重新播放
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
          <span>管线进度</span>
          <span className="text-primary font-bold">
            {Math.min(currentAgentIndex, 4)} / 4
          </span>
          <span>Agent</span>
        </div>
      </div>
    </div>
  );
}

export default memo(AgentPipelineView);
