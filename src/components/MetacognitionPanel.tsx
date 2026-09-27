// MetacognitionPanel — 总工反思看板（模块③）
// 展示 Agent 对自身执行轨迹的评价：轨迹指标 / 置信度 / 风险 / 策略反思
// 让评委一眼看到「AI 在反思自己的决策」，而非只输出结果
// EXPORTS: MetacognitionPanel

import { memo } from 'react';
import { Gauge, Activity, BrainCircuit, RefreshCw, Timer, Coins, Wrench } from 'lucide-react';
import type { IStrategyReflection, ITrajectoryMetrics } from '@/agent/types';

interface MetacognitionPanelProps {
  /** 元认知结果（可选，旧版/降级时可能没有） */
  metacognition?: {
    metrics: ITrajectoryMetrics;
    reflection: IStrategyReflection;
  };
  /** 置信度自评（来自 advice.confidence） */
  confidence?: { level: string; score: number };
  /** 风险点列表（来自 advice.risks） */
  risks?: string[];
}

const applyToLabel: Record<IStrategyReflection['applyTo'], string> = {
  planner: '规划层',
  tool: '工具层',
  prompt: '提示词层',
};

function MetacognitionPanel({ metacognition, confidence, risks }: MetacognitionPanelProps) {
  if (!metacognition) {
    return null;
  }

  const { metrics, reflection } = metacognition;
  const level = confidence?.level ?? '中';
  const levelColor =
    level === '高' ? 'text-success' : level === '低' ? 'text-destructive' : 'text-warning';
  const levelScore = confidence?.score ?? 70;

  // 节点耗时（ms → s）
  const durations = Object.entries(metrics.nodeDurations).map(([k, ms]) => ({
    agent: k,
    seconds: (ms / 1000).toFixed(1),
  }));

  return (
    <div className="space-y-3">
      {/* 标题 */}
      <div className="flex items-center gap-2">
        <BrainCircuit className="size-4 text-gold" />
        <span className="text-sm font-semibold text-foreground">总工反思看板</span>
        <span className="text-[10px] text-muted-foreground">（Agent 评价自己的执行轨迹）</span>
      </div>

      {/* 轨迹指标 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-md border border-border/50 bg-background/40 p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <RefreshCw className="size-3" />
            回退循环
          </div>
          <div className="mt-1 text-lg font-bold text-foreground">{metrics.totalLoops}</div>
          <div className="text-[10px] text-muted-foreground">轮</div>
        </div>
        <div className="rounded-md border border-border/50 bg-background/40 p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Wrench className="size-3" />
            工具调用
          </div>
          <div className="mt-1 text-lg font-bold text-foreground">{metrics.toolCallCount}</div>
          <div className="text-[10px] text-muted-foreground">次</div>
        </div>
        <div className="rounded-md border border-border/50 bg-background/40 p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Coins className="size-3" />
            Token 估算
          </div>
          <div className="mt-1 text-lg font-bold text-foreground">{metrics.tokenEstimate.toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground">token</div>
        </div>
        <div className="rounded-md border border-border/50 bg-background/40 p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Activity className="size-3" />
            运行状态
          </div>
          <div className={`mt-1 text-lg font-bold ${metrics.degraded ? 'text-destructive' : 'text-success'}`}>
            {metrics.degraded ? '降级' : '健康'}
          </div>
          <div className="text-[10px] text-muted-foreground">{metrics.degraded ? '真实模式崩溃兜底' : '无降级'}</div>
        </div>
      </div>

      {/* 置信度仪表盘（简化：进度条 + 色块） */}
      <div className="rounded-md border border-border/50 bg-background/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <Gauge className="size-3.5 text-teal" />
            置信度自评
          </div>
          <span className={`text-sm font-bold ${levelColor}`}>{level}（{levelScore}）</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted/60">
          <div
            className={`h-full rounded-full transition-all ${level === '高' ? 'bg-success' : level === '低' ? 'bg-destructive' : 'bg-warning'}`}
            style={{ width: `${levelScore}%` }}
          />
        </div>
      </div>

      {/* 节点耗时 */}
      {durations.length > 0 && (
        <div className="rounded-md border border-border/50 bg-background/40 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
            <Timer className="size-3.5 text-teal" />
            各节点耗时
          </div>
          <div className="space-y-1.5">
            {durations.map((d) => (
              <div key={d.agent} className="flex items-center gap-2">
                <span className="w-20 shrink-0 font-mono text-[10px] text-muted-foreground">{d.agent}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/60">
                  <div
                    className="h-full rounded-full bg-teal/70"
                    style={{ width: `${Math.min(100, Number(d.seconds) * 10)}%` }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right font-mono text-[10px] text-muted-foreground">{d.seconds}s</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 风险热力图（简化：风险点色块列表） */}
      {risks && risks.length > 0 && (
        <div className="rounded-md border border-border/50 bg-background/40 p-3">
          <div className="mb-2 text-xs font-medium text-foreground">风险提示</div>
          <div className="flex flex-wrap gap-1.5">
            {risks.map((r, i) => (
              <span
                key={i}
                className="rounded-sm border border-destructive/30 bg-destructive/10 px-2 py-1 text-[10px] text-destructive"
              >
                {r.slice(0, 40)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 策略反思日志 */}
      <div className="rounded-md border border-gold/30 bg-gradient-to-r from-gold/10 via-gold/5 to-transparent p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-gold">
            <BrainCircuit className="size-3.5" />
            策略反思（作用于 {applyToLabel[reflection.applyTo]}）
          </div>
          {reflection.applyTo === 'planner' && (
            <span className="rounded-sm border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[10px] text-gold">
              已写入经验库，下次自动改 DAG
            </span>
          )}
        </div>
        <div className="space-y-1.5 text-xs leading-relaxed">
          <div className="text-foreground/90">
            <span className="font-semibold text-foreground">观察：</span>{reflection.observation}
          </div>
          <div className="text-foreground/90">
            <span className="font-semibold text-foreground">归因：</span>{reflection.diagnosis}
          </div>
          <div className="text-gold">
            <span className="font-semibold">教训：</span>{reflection.lesson}
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(MetacognitionPanel);
