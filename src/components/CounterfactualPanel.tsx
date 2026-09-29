// CounterfactualPanel — 「如果…会怎样」滑杆式实时反事实推演
//
// 引擎 `src/data/counterfactual.ts` 早已实现（809 行、有 45 项回归），
// 但此前只有「聊天意图 → intent.ts」一条消费者，整套推演没有直接 UI。
// 本组件是它第一个直接 UI 消费者：拖动任一参数即可实时看到
//   · 哪些**强制性条文**会从合规翻成违规（或解除）
//   · 七维指标各自变化多少、方向是变好还是变差
// 只做推演，不写回任何参数。
// EXPORTS: CounterfactualPanel

import { useMemo, useState } from 'react';
import {
  SlidersHorizontal,
  RotateCcw,
  AlertTriangle,
  ShieldCheck,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Info,
} from 'lucide-react';
import { simulateCounterfactual } from '@/data/counterfactual';
import type { IProjectParams } from '@/data/structure';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';

interface CounterfactualPanelProps {
  /** 基线参数（推演的起点，不会被修改） */
  params: IProjectParams;
  /** 参与推演的候选体系 id */
  schemeIds: string[];
  /** 体系 id → 体系名称 */
  systemNames?: Record<string, string>;
  /** 当前推荐体系 id（用于标注与指标明细） */
  recommendationId?: string | null;
}

const INTENSITIES = ['6', '7', '8', '9'];

/** 比例型滑杆（面积/预算）：0.5× ~ 2.0× */
const RATIO_MIN = 0.5;
const RATIO_MAX = 2;
const RATIO_STEP = 0.05;

const fmtRatio = (r: number) => `${r >= 1 ? '+' : ''}${Math.round((r - 1) * 100)}%`;

const DIRECTION_META = {
  good: { icon: TrendingUp, cls: 'text-success', label: '变好' },
  bad: { icon: TrendingDown, cls: 'text-destructive', label: '变差' },
  neutral: { icon: Minus, cls: 'text-muted-foreground', label: '持平' },
} as const;

const FLIP_META: Record<
  string,
  { cls: string; dot: string; label: string; criticalCls: string }
> = {
  'new-violation': { cls: 'text-destructive', dot: 'bg-destructive', label: '新增违规', criticalCls: 'border-destructive/50 bg-destructive/10' },
  resolved: { cls: 'text-success', dot: 'bg-success', label: '违规解除', criticalCls: 'border-success/40 bg-success/10' },
  'new-warning': { cls: 'text-amber', dot: 'bg-amber', label: '新增提醒', criticalCls: 'border-amber/40 bg-amber/10' },
  'cleared-warning': { cls: 'text-teal', dot: 'bg-teal', label: '提醒消除', criticalCls: 'border-teal/40 bg-teal/10' },
  'severity-up': { cls: 'text-destructive', dot: 'bg-destructive', label: '严重性上升', criticalCls: 'border-destructive/50 bg-destructive/10' },
};

const VERDICT_META: Record<string, { cls: string; label: string }> = {
  improved: { cls: 'border-success/40 bg-success/10 text-success', label: '整体改善' },
  worsened: { cls: 'border-destructive/40 bg-destructive/10 text-destructive', label: '整体恶化' },
  mixed: { cls: 'border-amber/40 bg-amber/10 text-amber', label: '有得有失' },
  unchanged: { cls: 'border-border/60 bg-muted/30 text-muted-foreground', label: '基本不变' },
};

const CounterfactualPanel = ({
  params,
  schemeIds,
  systemNames = {},
  recommendationId = null,
}: CounterfactualPanelProps) => {
  const [floors, setFloors] = useState(params.floors);
  const [mainSpan, setMainSpan] = useState(params.mainSpan);
  const [intensity, setIntensity] = useState(params.seismicIntensity);
  const [areaRatio, setAreaRatio] = useState(1);
  const [budgetRatio, setBudgetRatio] = useState(1);

  const baseArea = params.area || 1;
  const baseBudget = params.budget || 1;

  const isDirty =
    floors !== params.floors ||
    mainSpan !== params.mainSpan ||
    intensity !== params.seismicIntensity ||
    areaRatio !== 1 ||
    budgetRatio !== 1;

  const reset = () => {
    setFloors(params.floors);
    setMainSpan(params.mainSpan);
    setIntensity(params.seismicIntensity);
    setAreaRatio(1);
    setBudgetRatio(1);
  };

  const report = useMemo(() => {
    if (!isDirty || schemeIds.length === 0) return null;
    const after: IProjectParams = {
      ...params,
      floors,
      mainSpan,
      seismicIntensity: intensity,
      area: Math.round(baseArea * areaRatio),
      budget: Math.round(baseBudget * budgetRatio),
    };
    const bits: string[] = [];
    if (floors !== params.floors) bits.push(`层数从 ${params.floors} 改为 ${floors}`);
    if (intensity !== params.seismicIntensity) bits.push(`设防烈度从 ${params.seismicIntensity} 度改为 ${intensity} 度`);
    if (mainSpan !== params.mainSpan) bits.push(`跨度从 ${params.mainSpan}m 改为 ${mainSpan}m`);
    if (areaRatio !== 1) bits.push(`建筑面积${fmtRatio(areaRatio)}`);
    if (budgetRatio !== 1) bits.push(`预算${fmtRatio(budgetRatio)}`);
    return simulateCounterfactual(
      `如果${bits.join('、')}会怎样`,
      params,
      after,
      schemeIds,
      recommendationId ?? undefined
    );
  }, [isDirty, schemeIds, params, floors, mainSpan, intensity, areaRatio, budgetRatio, baseArea, baseBudget, recommendationId]);

  // 只展示「有变化」的体系，避免推演结果被无变化的体系淹没
  const flipped = report?.results.filter((r) => r.checkFlips.length > 0) ?? [];
  const recommendation =
    report?.results.find((r) => r.isCurrentRecommendation) ?? report?.results[0] ?? null;

  return (
    <Card className="corner-marks border-border/60 bg-card/80 blueprint-card">
      <CardContent className="p-4 md:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-primary" />
            <span className="font-mono text-[11px] tracking-widest text-foreground">
              WHAT-IF · 反事实推演
            </span>
            <span className="text-[11px] text-muted-foreground">
              拖动参数，实时看哪条强条会破 · 不改动当前工程
            </span>
          </div>
          {isDirty && (
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
              className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="size-3" />
              复位
            </Button>
          )}
        </div>

        {/* ---------- 参数滑杆 ---------- */}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Knob
            label="层数"
            value={`${floors} 层`}
            changed={floors !== params.floors}
            base={`原 ${params.floors}`}
          >
            <Slider
              value={[floors]}
              onValueChange={([v]) => setFloors(v)}
              min={1}
              max={60}
              step={1}
            />
          </Knob>

          <Knob
            label="设防烈度"
            value={`${intensity} 度`}
            changed={intensity !== params.seismicIntensity}
            base={`原 ${params.seismicIntensity} 度`}
          >
            <div className="flex gap-1">
              {INTENSITIES.map((lv) => (
                <button
                  key={lv}
                  type="button"
                  onClick={() => setIntensity(lv)}
                  className={`flex-1 rounded-sm border px-2 py-1 font-mono text-[11px] transition-colors ${
                    intensity === lv
                      ? 'border-primary/60 bg-primary/10 text-primary'
                      : 'border-border/50 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {lv}
                </button>
              ))}
            </div>
          </Knob>

          <Knob
            label="柱网跨度"
            value={`${mainSpan.toFixed(1)} m`}
            changed={mainSpan !== params.mainSpan}
            base={`原 ${params.mainSpan}m`}
          >
            <Slider
              value={[mainSpan]}
              onValueChange={([v]) => setMainSpan(Math.round(v * 10) / 10)}
              min={4}
              max={15}
              step={0.2}
            />
          </Knob>

          <Knob
            label="建筑面积"
            value={fmtRatio(areaRatio)}
            changed={areaRatio !== 1}
            base={`原 ${baseArea.toLocaleString()} ㎡`}
          >
            <Slider
              value={[areaRatio]}
              onValueChange={([v]) => setAreaRatio(Math.round(v * 100) / 100)}
              min={RATIO_MIN}
              max={RATIO_MAX}
              step={RATIO_STEP}
            />
          </Knob>

          <Knob
            label="预算"
            value={fmtRatio(budgetRatio)}
            changed={budgetRatio !== 1}
            base={`原 ${baseBudget.toLocaleString()}`}
          >
            <Slider
              value={[budgetRatio]}
              onValueChange={([v]) => setBudgetRatio(Math.round(v * 100) / 100)}
              min={RATIO_MIN}
              max={RATIO_MAX}
              step={RATIO_STEP}
            />
          </Knob>
        </div>

        {/* ---------- 推演结果 ---------- */}
        {!report && (
          <div className="mt-4 flex items-center gap-2 rounded-md border border-dashed border-border/60 bg-background/40 px-3 py-3 text-[11px] text-muted-foreground">
            <Info className="size-3.5 shrink-0" />
            当前为基线状态。拖动上方任一参数即可开始推演。
          </div>
        )}

        {report && (
          <div className="mt-4 space-y-3">
            {/* 改动摘要 */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">本次改动：</span>
              {report.changes.map((c) => (
                <Badge
                  key={String(c.field)}
                  variant="outline"
                  className="gap-1 border-primary/40 bg-primary/5 text-[10px] text-primary"
                >
                  {c.label}
                  <span className="text-muted-foreground">{String(c.from)}</span>
                  <ArrowRight className="size-2.5" />
                  <span className="font-semibold">{String(c.to)}</span>
                </Badge>
              ))}
              {report.changes.length === 0 && (
                <span className="text-[11px] text-muted-foreground">无（参数未变）</span>
              )}
            </div>

            {/* 强条翻转总览 */}
            {report.hasCriticalFlip ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/45 bg-destructive/10 px-3 py-2.5">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <div className="text-[11px] text-destructive">
                  <div className="font-semibold">存在强制性条文翻转</div>
                  <div className="mt-0.5 text-destructive/85">
                    {report.newlyViolating.length > 0
                      ? `变化后新增违规：${report.newlyViolating
                          .map((id) => systemNames[id] ?? id)
                          .join('、')}`
                      : '有体系的违规状态发生变化，详见下方逐条判定。'}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2.5">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
                <div className="text-[11px] text-success">
                  没有强制性条文被打破，仍满足全部强条。
                </div>
              </div>
            )}

            {/* 逐体系判定翻转 */}
            {flipped.length > 0 && (
              <div className="space-y-2">
                {flipped.map((r) => (
                  <div
                    key={r.systemId}
                    className="rounded-md border border-border/50 bg-background/50 p-3"
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[12px] font-semibold text-foreground">
                        {r.systemName || systemNames[r.systemId] || r.systemId}
                        {r.isCurrentRecommendation && (
                          <span className="ml-1.5 text-[10px] font-normal text-primary">
                            （当前推荐）
                          </span>
                        )}
                      </span>
                      <span
                        className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-medium ${
                          VERDICT_META[r.verdict]?.cls ?? ''
                        }`}
                      >
                        {VERDICT_META[r.verdict]?.label ?? r.verdict}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      {r.checkFlips.map((f) => {
                        const meta = FLIP_META[f.kind] ?? FLIP_META['new-warning'];
                        return (
                          <div
                            key={`${r.systemId}-${f.name}`}
                            className={`rounded-sm border px-2 py-1.5 ${meta.criticalCls}`}
                          >
                            <div className="flex items-center gap-1.5">
                              <span className={`size-1.5 rounded-full ${meta.dot}`} />
                              <span className={`text-[11px] font-medium ${meta.cls}`}>
                                {meta.label}
                              </span>
                              <span className="text-[11px] text-foreground/85">{f.name}</span>
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {f.before} → {f.after}
                              </span>
                              {f.mandatory && (
                                <span className="ml-auto rounded-sm bg-destructive/15 px-1 text-[9px] font-semibold text-destructive">
                                  强条
                                </span>
                              )}
                            </div>
                            {f.evidence && (
                              <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                                {f.evidence}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 推荐方案的指标变化 */}
            {recommendation && recommendation.metricDeltas.length > 0 && (
              <div className="rounded-md border border-border/50 bg-background/50 p-3">
                <div className="mb-2 text-[11px] font-semibold text-secondary-foreground">
                  指标变化 · {recommendation.systemName}
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {recommendation.metricDeltas.slice(0, 6).map((m) => {
                    const meta = DIRECTION_META[m.direction];
                    const Icon = meta.icon;
                    return (
                      <div
                        key={m.key}
                        className="flex items-baseline justify-between gap-2 border-b border-border/30 pb-1 last:border-0"
                      >
                        <span className="text-[11px] text-muted-foreground">{m.label}</span>
                        <span className="flex items-baseline gap-1 font-mono text-[11px]">
                          <span className="text-muted-foreground/70">{m.before}</span>
                          <ArrowRight className="size-2.5 text-muted-foreground/60" />
                          <span className="text-foreground">{m.after}</span>
                          <span className={`ml-0.5 ${meta.cls}`}>
                            <Icon className="inline size-3" />
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
                {recommendation.summary && (
                  <div className="mt-2 text-[11px] leading-relaxed text-foreground/80">
                    {recommendation.summary}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

/** 单个参数调节行 */
function Knob({
  label,
  value,
  changed,
  base,
  children,
}: {
  label: string;
  value: string;
  changed: boolean;
  base: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border/40 bg-background/40 px-2.5 py-2">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span className="flex items-baseline gap-1.5">
          <span
            className={`font-mono text-[12px] font-semibold ${
              changed ? 'text-primary' : 'text-foreground/70'
            }`}
          >
            {value}
          </span>
          <span className="font-mono text-[9px] text-muted-foreground/70">{base}</span>
        </span>
      </div>
      {children}
    </div>
  );
}

export default CounterfactualPanel;
