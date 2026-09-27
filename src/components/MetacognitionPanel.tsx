// MetacognitionPanel — 总工反思看板（模块③，仪表盘化）
// 展示 Agent 对自身执行轨迹的评价，让评委一眼看到「AI 在反思自己的决策」
// 布局：圆形置信度仪表盘 + 轨迹指标 + 风险热力图 + 三段式策略反思卡片
// EXPORTS: MetacognitionPanel

import { memo } from 'react';
import { BrainCircuit, Activity, RefreshCw, Wrench, Coins, Target, TrendingUp } from 'lucide-react';
import type { IStrategyReflection, ITrajectoryMetrics } from '@/agent/types';

interface MetacognitionPanelProps {
  metacognition?: {
    metrics: ITrajectoryMetrics;
    reflection: IStrategyReflection;
  };
  confidence?: { level: string; score: number };
  risks?: string[];
}

const applyToLabel: Record<IStrategyReflection['applyTo'], string> = {
  planner: '规划层',
  tool: '工具层',
  prompt: '提示词层',
};

/** 风险热力图：从风险文本推断等级（红=高危 / 黄=中危 / 绿=低危） */
function classifyRisk(text: string): 'high' | 'medium' | 'low' {
  if (/超限|违规|不满足|破坏|倒塌|危险|致命/.test(text)) return 'high';
  if (/注意|关注|偏紧|接近|复核|潜在/.test(text)) return 'medium';
  return 'low';
}

/** 圆形置信度仪表盘（SVG 圆环） */
function ConfidenceGauge({ level, score }: { level: string; score: number }) {
  const r = 42;
  const circumference = 2 * Math.PI * r;
  const dash = (score / 100) * circumference;
  const color = level === '高' ? '#22c55e' : level === '低' ? '#ef4444' : '#f59e0b';
  const levelText = level === '高' ? '高置信' : level === '低' ? '低置信' : '中置信';

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg viewBox="0 0 100 100" className="size-24">
          <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(148,163,184,0.2)" strokeWidth="10" />
          <circle
            cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="10"
            strokeDasharray={`${dash} ${circumference}`} strokeLinecap="round"
            transform="rotate(-90 50 50)"
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />
          <text x="50" y="47" textAnchor="middle" dominantBaseline="central" fontSize="22" fontWeight="800" fill="currentColor">
            {score}
          </text>
          <text x="50" y="68" textAnchor="middle" fontSize="9" fill="rgba(148,163,184,0.9)">
            {levelText}
          </text>
        </svg>
      </div>
    </div>
  );
}

function MetacognitionPanel({ metacognition, confidence, risks }: MetacognitionPanelProps) {
  if (!metacognition) return null;

  const { metrics, reflection } = metacognition;
  const level = confidence?.level ?? '中';
  const score = confidence?.score ?? 70;
  const durations = Object.entries(metrics.nodeDurations).map(([k, ms]) => ({ agent: k, seconds: ms / 1000 }));

  return (
    <div className="glass-card p-card">
      {/* 标题 */}
      <div className="mb-4 flex items-center gap-2">
        <BrainCircuit className="size-4 text-gold" />
        <span className="text-sm font-semibold text-foreground">总工反思看板</span>
        <span className="text-[10px] text-muted-foreground">（Agent 评价自己的执行轨迹）</span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 左：圆形置信度 + 轨迹指标 */}
        <div className="space-y-3">
          <div className="flex items-center justify-around rounded-md border border-border/50 bg-background/40 p-3">
            <ConfidenceGauge level={level} score={score} />
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <RefreshCw className="size-3.5 text-teal" />
                <span className="text-muted-foreground">回退循环</span>
                <span className="ml-auto font-bold text-foreground">{metrics.totalLoops} 轮</span>
              </div>
              <div className="flex items-center gap-2">
                <Wrench className="size-3.5 text-teal" />
                <span className="text-muted-foreground">工具调用</span>
                <span className="ml-auto font-bold text-foreground">{metrics.toolCallCount} 次</span>
              </div>
              <div className="flex items-center gap-2">
                <Coins className="size-3.5 text-teal" />
                <span className="text-muted-foreground">Token</span>
                <span className="ml-auto font-bold text-foreground">{metrics.tokenEstimate.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-2">
                <Activity className="size-3.5 text-teal" />
                <span className="text-muted-foreground">状态</span>
                <span className={`ml-auto font-bold ${metrics.degraded ? 'text-destructive' : 'text-success'}`}>
                  {metrics.degraded ? '降级' : '健康'}
                </span>
              </div>
            </div>
          </div>

          {/* 节点耗时 */}
          {durations.length > 0 && (
            <div className="rounded-md border border-border/50 bg-background/40 p-3">
              <div className="mb-2 text-[10px] font-medium text-muted-foreground">各节点耗时</div>
              <div className="space-y-1.5">
                {durations.map((d) => (
                  <div key={d.agent} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 font-mono text-[10px] text-muted-foreground">{d.agent}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/60">
                      <div className="h-full rounded-full bg-teal/70" style={{ width: `${Math.min(100, d.seconds * 10)}%` }} />
                    </div>
                    <span className="w-12 shrink-0 text-right font-mono text-[10px] text-muted-foreground">{d.seconds.toFixed(1)}s</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 中：风险热力图 */}
        <div className="rounded-md border border-border/50 bg-background/40 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
            <Target className="size-3.5 text-destructive" />
            风险热力图
          </div>
          {risks && risks.length > 0 ? (
            <div className="grid grid-cols-1 gap-1.5">
              {risks.map((r, i) => {
                const cls = classifyRisk(r);
                const color = cls === 'high' ? 'border-destructive/40 bg-destructive/10 text-destructive' : cls === 'medium' ? 'border-warning/40 bg-warning/10 text-warning' : 'border-success/40 bg-success/10 text-success';
                const dot = cls === 'high' ? 'bg-destructive' : cls === 'medium' ? 'bg-warning' : 'bg-success';
                return (
                  <div key={i} className={`flex items-start gap-2 rounded-sm border px-2 py-1.5 ${color}`}>
                    <span className={`mt-1 size-1.5 shrink-0 rounded-full ${dot}`} />
                    <span className="text-[11px] leading-relaxed">{r.slice(0, 48)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground/60">本次运行未发现显著风险</div>
          )}
        </div>

        {/* 右：三段式策略反思 */}
        <div className="rounded-md border border-gold/30 bg-gradient-to-b from-gold/10 via-gold/5 to-transparent p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gold">
            <TrendingUp className="size-3.5" />
            策略反思
            <span className="ml-auto rounded-sm border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[9px] text-gold">
              作用于 {applyToLabel[reflection.applyTo]}
            </span>
          </div>

          {/* 三段：诊断 → 教训 → 应用 */}
          <div className="space-y-1.5">
            <div className="rounded-sm border-l-2 border-foreground/40 bg-background/40 px-2 py-1.5">
              <div className="text-[9px] font-semibold text-muted-foreground">🔍 诊断</div>
              <div className="text-[11px] leading-relaxed text-foreground/80">{reflection.diagnosis}</div>
            </div>
            <div className="rounded-sm border-l-2 border-gold/50 bg-gold/[0.06] px-2 py-1.5">
              <div className="text-[9px] font-semibold text-gold">💡 教训</div>
              <div className="text-[11px] leading-relaxed text-gold">{reflection.lesson}</div>
            </div>
            <div className="rounded-sm border-l-2 border-teal/50 bg-teal/[0.06] px-2 py-1.5">
              <div className="text-[9px] font-semibold text-teal">⚙️ 应用</div>
              <div className="text-[11px] leading-relaxed text-foreground/80">
                {reflection.applyTo === 'planner' ? '已写入经验库，下次运行自动修改 DAG 拓扑' : reflection.trigger}
              </div>
            </div>
          </div>

          {reflection.applyTo === 'planner' && (
            <div className="mt-2 flex items-center gap-1.5 rounded-sm border border-gold/30 bg-gold/10 px-2 py-1 text-[10px] text-gold">
              <BrainCircuit className="size-3" />
              闭环已激活：本次教训将影响下一次规划
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(MetacognitionPanel);
