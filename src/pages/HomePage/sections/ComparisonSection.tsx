import { memo, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import CountUpOnView from '@/components/CountUpOnView';
import type { EChartsOption } from 'echarts';
import { motion } from 'framer-motion';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  BarChart3,
  Radar,
  Trophy,
  Sparkles,
  Loader2,
  Award,
  Target,
  Download,
  RefreshCw,
  Send,
  FileText,
  Copy,
  Check,
  TrendingUp,
  Leaf,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  Gauge,
  Landmark,
  Clock,
  Wallet,
  Hammer,
  Calculator,
  Lightbulb,
  BookOpen,
  Zap,
  TrendingDown,
  Layers,
  ArrowRight,
  Play,
  CheckCircle2,
  Scale,
  Gavel,
  Box,
  Lock,
} from 'lucide-react';
import {
  type IStructureScheme,
  type IRecommendation,
  type IWeightConfig,
  type IProjectParams,
  type INormCheckItem,
} from '@/data/structure';
import { CHART_COLORS, CHART_SEMANTIC } from '@/lib/chart-colors';
import StructureWireframe3D from '@/components/StructureWireframe3D';
import { analyzeTradeoffs } from '@/agent';
import type { ITradeoffAnalysis } from '@/agent';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { exportSchemeComparisonCsv } from '@/lib/export-csv';
import { downloadModelFiles } from '@/lib/model-export';

interface ComparisonSectionProps {
  schemes: IStructureScheme[];
  recommendation: IRecommendation | null;
  isRecommending: boolean;
  recommendationContent: string;
  selectedSchemeId: string | null;
  weights?: IWeightConfig;
  projectParams?: IProjectParams | null;
  onOptimize?: (requirement: string) => void;
  isOptimizing?: boolean;
  /** 自主优化结果 */
  optimizationResult?: import('@/agent').IOptimizationResult | null;
  /** 总工主动优化建议 */
  optimizationSuggestions?: { dimension: string; description: string; potential: string; type: string }[];
  /** 开始自主优化 */
  onStartOptimization?: (goal: import('@/agent').IOptimizationGoal, targetBudget?: number) => void;
  /** 是否正在优化中 */
  isAutoOptimizing?: boolean;
  /** 被锁定的参数（影响 3D 模型展示说明） */
  lockedParams?: Partial<Record<keyof IProjectParams, boolean>>;
  /** 规范校核结果（3D 违规警示） */
  codeChecks?: Record<string, unknown>;
}

const RADAR_DIMENSIONS = [
  { key: 'seismicPerformance', label: '抗震性能', max: 10 },
  { key: 'sustainability', label: '可持续性', max: 10 },
  { key: 'costScore', label: '造价经济', max: 10 },
  { key: 'durationScore', label: '工期优势', max: 10 },
  { key: 'easeScore', label: '施工便利', max: 10 },
  { key: 'precastScore', label: '装配率', max: 10 },
  { key: 'carbonScore', label: '低碳性能', max: 10 },
];

// ============ P1-1 决策溯源 ============
// 最终推荐不再是一个凭空出现的结论：它是谁定的、有没有被规范否决过、否决依据哪条条文，
// 都必须让工程师一眼看到。这既是对「AI 黑箱」最直接的回应，也是硬约束防线存在的证据。

const DECISION_SOURCE_META: Record<
  string,
  { label: string; tone: string; hint: string }
> = {
  llm: {
    label: '总工裁定',
    tone: 'border-teal/40 bg-teal/10 text-teal',
    hint: '由总工 Agent 在候选内独立裁定，非单纯取评分最高者',
  },
  'constraint-override': {
    label: '强制回退',
    tone: 'border-destructive/50 bg-destructive/10 text-destructive',
    hint: '原裁定违反强制性条文，被代码否决后改判',
  },
  'human-lock': {
    label: '工程师锁定',
    tone: 'border-info/40 bg-info/10 text-info',
    hint: '按人工锁定优先采用，AI 不得替换',
  },
  'score-fallback': {
    label: '评分兜底',
    tone: 'border-muted-foreground/40 bg-muted/40 text-muted-foreground',
    hint: '未取得有效裁定，按综合评分首选推荐',
  },
  trace: {
    label: '演示轨迹',
    tone: 'border-muted-foreground/40 bg-muted/40 text-muted-foreground',
    hint: '确定性演示脚本产出',
  },
};

function DecisionTraceLine({ recommendation }: { recommendation: IRecommendation }) {
  const meta = DECISION_SOURCE_META[recommendation.decisionSource ?? ''] ?? null;
  if (!meta) return null;
  const violations = recommendation.hardConstraintViolations ?? [];

  return (
    <div className="mt-2 space-y-1.5 rounded-md border border-amber/25 bg-amber/[0.06] px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
          DECISION TRACE · 决策溯源
        </span>
        <span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${meta.tone}`}>
          {meta.label}
        </span>
        {recommendation.llmConfidence && (
          <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
            置信度：{recommendation.llmConfidence === 'high' ? '高' : recommendation.llmConfidence === 'medium' ? '中' : '低'}
          </span>
        )}
        {recommendation.scoreTopSchemeId &&
          recommendation.scoreTopSchemeId !== recommendation.schemeId && (
            <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
              评分首选：{recommendation.scoreTopSchemeId}
            </span>
          )}
      </div>
      {recommendation.decisionNote && (
        <p className="text-xs leading-relaxed text-foreground/85">{recommendation.decisionNote}</p>
      )}
      {violations.length > 0 && (
        <ul className="space-y-0.5">
          {violations.map((v) => (
            <li key={v} className="text-[11px] leading-relaxed text-destructive">
              ⛔ {v}
            </li>
          ))}
        </ul>
      )}
      {!recommendation.decisionNote && (
        <p className="text-xs leading-relaxed text-muted-foreground">{meta.hint}</p>
      )}
    </div>
  );
}

function ComparisonSection({
  schemes,
  recommendation,
  isRecommending,
  recommendationContent,
  selectedSchemeId,
  weights,
  projectParams,
  onOptimize,
  isOptimizing,
  optimizationResult,
  optimizationSuggestions = [],
  onStartOptimization,
  isAutoOptimizing,
  lockedParams = {},
  codeChecks,
}: ComparisonSectionProps) {
  const hasSchemes = schemes.length > 0;
  const [optimizeInput, setOptimizeInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState('radar');
  const [optimizeDialogOpen, setOptimizeDialogOpen] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<'cost' | 'duration' | 'precast' | 'green' | 'safety'>('cost');
  const [targetBudget, setTargetBudget] = useState('3500');

  const recommendedScheme = useMemo(
    () =>
      hasSchemes && recommendation
        ? schemes.find((s) => s.id === recommendation.schemeId) ?? null
        : null,
    [hasSchemes, recommendation, schemes],
  );

  const displayedScheme = useMemo(() => {
    if (selectedSchemeId) {
      return schemes.find((s) => s.id === selectedSchemeId) ?? recommendedScheme ?? null;
    }
    return recommendedScheme ?? null;
  }, [selectedSchemeId, schemes, recommendedScheme]);

  // 总工分歧权衡分析
  const tradeoff: ITradeoffAnalysis | null = useMemo(() => {
    if (!hasSchemes || !recommendation || !weights) return null;
    return analyzeTradeoffs(schemes, weights, recommendation);
  }, [hasSchemes, recommendation, schemes, weights]);

  // Normalize metrics to 0-10 scale for radar
  const radarData = useMemo(() => {
    if (schemes.length === 0) return [];
    const costs = schemes.map((s) => s.metrics.cost);
    const durations = schemes.map((s) => s.metrics.duration);
    const carbons = schemes.map((s) => s.metrics.carbonEmission);
    const maxCost = Math.max(...costs);
    const minCost = Math.min(...costs);
    const maxDuration = Math.max(...durations);
    const minDuration = Math.min(...durations);
    const maxCarbon = Math.max(...carbons);
    const minCarbon = Math.min(...carbons);

    return schemes.map((s) => {
      const costScore =
        maxCost === minCost
          ? 8
          : 10 - ((s.metrics.cost - minCost) / (maxCost - minCost)) * 5;
      const durationScore =
        maxDuration === minDuration
          ? 8
          : 10 - ((s.metrics.duration - minDuration) / (maxDuration - minDuration)) * 5;
      const easeScore = 10 - s.metrics.constructionDifficulty;
      const precastScore = s.metrics.precastRate.rate / 10;
      const carbonScore =
        maxCarbon === minCarbon
          ? 8
          : 10 - ((s.metrics.carbonEmission - minCarbon) / (maxCarbon - minCarbon)) * 4;

      return {
        name: s.name,
        values: [
          s.metrics.seismicPerformance,
          s.metrics.sustainability,
          costScore,
          durationScore,
          easeScore,
          precastScore,
          carbonScore,
        ],
      };
    });
  }, [schemes]);

  const radarOption: EChartsOption = useMemo(
    () => ({
      tooltip: {
        trigger: 'item',
        backgroundColor: CHART_SEMANTIC.tooltipBg,
        borderColor: 'rgba(15,76,129,0.2)',
        borderWidth: 1,
        textStyle: { color: CHART_SEMANTIC.text, fontSize: 12 },
        formatter: (p: unknown) => {
          const pp = p as { name?: string; value?: number[]; marker?: string };
          if (!pp || !Array.isArray(pp.value)) return '';
          const rows = RADAR_DIMENSIONS.map((d, i) => `${d.label}：${pp.value?.[i]?.toFixed?.(1) ?? pp.value?.[i] ?? '—'}`);
          return `<b>${pp.marker ?? ''} ${pp.name ?? ''}</b><br/>` + rows.join('<br/>');
        },
      },
      legend: {
        type: 'scroll',
        bottom: 8,
        itemGap: 16,
        textStyle: { fontSize: 12, color: CHART_SEMANTIC.textMuted },
        inactiveColor: 'rgba(148,163,184,0.2)',
      },
      radar: {
        indicator: RADAR_DIMENSIONS.map((d) => ({ name: d.label, max: d.max })),
        center: ['50%', '46%'],
        radius: '52%',
        splitNumber: 5,
        axisName: {
          fontSize: 12,
          color: CHART_SEMANTIC.text,
          fontWeight: 500,
        },
        axisNameGap: 8,
        splitLine: { lineStyle: { color: 'rgba(15,76,129,0.16)' } },
        splitArea: { areaStyle: { color: ['rgba(15,76,129,0.015)', 'rgba(15,76,129,0.045)'] } },
        axisLine: { lineStyle: { color: 'rgba(15,76,129,0.28)' } },
      },
       series: [
         {
           type: 'radar',
           data: radarData.map((item, i) => {
             // 推荐方案（第1个）用琥珀橙高亮，其余按顺序深蓝/工程青/天空蓝
             const color =
               i === 0
                 ? CHART_SEMANTIC.warning
                 : CHART_COLORS[(i - 1) % (CHART_COLORS.length - 1)];
             return {
               name: item.name,
               value: item.values,
               areaStyle: { opacity: i === 0 ? 0.25 : 0.12 },
               lineStyle: { width: i === 0 ? 2.5 : 1.5, color },
               itemStyle: { color },
               emphasis: {
                 lineStyle: { width: 3.5, color },
                 itemStyle: { color, borderColor: color, borderWidth: 2.5, shadowBlur: 12, shadowColor: 'rgba(15,76,129,0.35)' },
                 areaStyle: { opacity: 0.4 },
               },
             };
           }),
         },
       ],
    }),
    [radarData],
  );

  const barOption: EChartsOption = useMemo(
    () => ({
       tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: CHART_SEMANTIC.tooltipBg, borderColor: 'rgba(15,76,129,0.2)', borderWidth: 1, textStyle: { color: CHART_SEMANTIC.text } },
       legend: {
         type: 'scroll',
         bottom: 6,
         itemGap: 16,
         textStyle: { fontSize: 12, color: CHART_SEMANTIC.textMuted },
         inactiveColor: 'rgba(148,163,184,0.3)',
       },
       grid: { left: '4%', right: '6%', bottom: 72, top: 20, containLabel: true },
       xAxis: {
         type: 'category',
         data: schemes.map((s) => s.name),
         axisLabel: { fontSize: 11, color: CHART_SEMANTIC.textMuted },
         axisLine: { lineStyle: { color: 'rgba(15,76,129,0.2)' } },
       },
       yAxis: [
        { type: 'value', name: '造价 (元/㎡)', position: 'left', nameTextStyle: { fontSize: 12, color: CHART_SEMANTIC.textMuted, padding: [0, 0, 6, 0] }, axisLabel: { color: CHART_SEMANTIC.textMuted }, splitLine: { lineStyle: { color: CHART_SEMANTIC.gridLine } } },
        { type: 'value', name: '工期 (月)', position: 'right', nameTextStyle: { fontSize: 12, color: CHART_SEMANTIC.textMuted, padding: [0, 0, 6, 0] }, axisLabel: { color: CHART_SEMANTIC.textMuted }, splitLine: { show: false } },
      ],
      series: [
        {
          name: '造价',
          type: 'bar',
          data: schemes.map((s) => s.metrics.cost),
          yAxisIndex: 0,
          itemStyle: { color: CHART_COLORS[0], borderRadius: [4, 4, 0, 0] },
          barWidth: '25%',
        },
        {
          name: '工期',
          type: 'bar',
          data: schemes.map((s) => s.metrics.duration),
          yAxisIndex: 1,
          itemStyle: { color: CHART_COLORS[2], borderRadius: [4, 4, 0, 0] },
          barWidth: '25%',
        },
      ],
    }),
    [schemes],
  );

  const perfBarOption: EChartsOption = useMemo(
    () => ({
       tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: CHART_SEMANTIC.tooltipBg, borderColor: 'rgba(15,76,129,0.2)', borderWidth: 1, textStyle: { color: CHART_SEMANTIC.text } },
       legend: {
         type: 'scroll',
         bottom: 6,
         itemGap: 12,
         textStyle: { fontSize: 11, color: CHART_SEMANTIC.textMuted },
         inactiveColor: 'rgba(148,163,184,0.3)',
       },
       grid: { left: '4%', right: '4%', bottom: 72, top: 20, containLabel: true },
       xAxis: {
         type: 'category',
         data: schemes.map((s) => s.name),
         axisLabel: {
           fontSize: 11,
           interval: 0,
           rotate: 25,
           margin: 12,
           overflow: 'truncate',
           width: 80,
           color: CHART_SEMANTIC.textMuted,
         },
         axisLine: { lineStyle: { color: 'rgba(15,76,129,0.2)' } },
       },
       yAxis: {
         type: 'value',
         name: '评分 (10分制)',
        max: 10,
        nameTextStyle: { fontSize: 12, color: CHART_SEMANTIC.textMuted, padding: [0, 0, 6, 0] },
        axisLabel: { color: CHART_SEMANTIC.textMuted },
        splitLine: { lineStyle: { color: CHART_SEMANTIC.gridLine } },
      },
       series: [
         {
           name: '抗震性能',
           type: 'bar',
           data: schemes.map((s) => s.metrics.seismicPerformance),
           itemStyle: { color: CHART_COLORS[1], borderRadius: [4, 4, 0, 0] },
           barWidth: '11%',
         },
         {
           name: '施工难度',
           type: 'bar',
           data: schemes.map((s) => s.metrics.constructionDifficulty),
           itemStyle: { color: CHART_COLORS[3], borderRadius: [4, 4, 0, 0] },
           barWidth: '11%',
         },
         {
           name: '施工安全风险',
           type: 'bar',
           data: schemes.map((s) =>
             s.metrics.safetyRisk === 'low' ? 2 : s.metrics.safetyRisk === 'medium' ? 5 : 8,
           ),
           itemStyle: { color: CHART_SEMANTIC.warning },
           barWidth: '11%',
         },
         {
           name: '可持续性',
           type: 'bar',
           data: schemes.map((s) => s.metrics.sustainability),
           itemStyle: { color: CHART_COLORS[4], borderRadius: [4, 4, 0, 0] },
           barWidth: '11%',
         },
         {
           name: '装配率(÷10)',
           type: 'bar',
           data: schemes.map((s) => s.metrics.precastRate.rate / 10),
           itemStyle: { color: CHART_COLORS[2], borderRadius: [4, 4, 0, 0] },
           barWidth: '11%',
         },
       ],
    }),
    [schemes],
  );

  const greenBarOption: EChartsOption = useMemo(
    () => ({
       tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: CHART_SEMANTIC.tooltipBg, borderColor: 'rgba(15,76,129,0.2)', borderWidth: 1, textStyle: { color: CHART_SEMANTIC.text } },
       legend: {
         type: 'scroll',
         bottom: 6,
         itemGap: 16,
         textStyle: { fontSize: 11, color: CHART_SEMANTIC.textMuted },
         inactiveColor: 'rgba(148,163,184,0.3)',
       },
       grid: { left: '4%', right: '6%', bottom: 72, top: 20, containLabel: true },
       xAxis: {
         type: 'category',
         data: schemes.map((s) => s.name),
         axisLabel: {
           fontSize: 11,
           interval: 0,
           rotate: 25,
           margin: 12,
           overflow: 'truncate',
           width: 80,
           color: CHART_SEMANTIC.textMuted,
         },
         axisLine: { lineStyle: { color: 'rgba(15,76,129,0.2)' } },
       },
       yAxis: [
        {
          type: 'value',
          name: '碳排放 (kgCO₂/㎡)',
          nameTextStyle: { fontSize: 12, color: CHART_SEMANTIC.textMuted, padding: [0, 0, 6, 0] },
          axisLabel: { color: CHART_SEMANTIC.textMuted },
          splitLine: { lineStyle: { color: CHART_SEMANTIC.gridLine } },
        },
        {
          type: 'value',
          name: '装配率 (%)',
          max: 100,
          nameTextStyle: { fontSize: 12, color: CHART_SEMANTIC.textMuted, padding: [0, 0, 6, 0] },
          axisLabel: { color: CHART_SEMANTIC.textMuted },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '单位面积碳排放',
          type: 'bar',
          data: schemes.map((s) => s.metrics.carbonEmission),
          yAxisIndex: 0,
          itemStyle: { color: CHART_COLORS[4], borderRadius: [4, 4, 0, 0] },
          barWidth: '30%',
        },
        {
          name: '预制装配率',
          type: 'bar',
          data: schemes.map((s) => s.metrics.precastRate.rate),
          yAxisIndex: 1,
          itemStyle: { color: CHART_COLORS[2], borderRadius: [4, 4, 0, 0] },
          barWidth: '30%',
        },
      ],
    }),
    [schemes],
  );

  const generateReportText = (): string => {
    const lines: string[] = [];
    lines.push('========================================');
    lines.push('       结构方案比选分析报告');
    lines.push('========================================');
    lines.push('');
    if (projectParams) {
      lines.push(`【项目基本信息】`);
      lines.push(`建筑类型：${projectParams.buildingType}`);
      lines.push(`建筑层数：${projectParams.floors} 层`);
      lines.push(`建筑面积：${projectParams.area} ㎡`);
      lines.push(`设防烈度：${projectParams.seismicIntensity} 度`);
      lines.push(`场地土类：${projectParams.soilCategory} 类`);
      lines.push(`主要跨度：${projectParams.mainSpan} m`);
      lines.push(`预算约束：${projectParams.budget} 元/㎡`);
      lines.push('');
    }
    lines.push(`【候选方案对比】`);
    schemes.forEach((s, i) => {
      lines.push(`${i + 1}. ${s.name}`);
      lines.push(`   造价：${s.metrics.cost} 元/㎡ | 工期：${s.metrics.duration} 个月`);
      lines.push(`   抗震性能：${s.metrics.seismicPerformance}/10`);
      lines.push(`   施工难度：${s.metrics.constructionDifficulty}/10`);
      lines.push(`   可持续性：${s.metrics.sustainability}/10`);
      lines.push(`   装配率：${s.metrics.precastRate.rate}%（${s.metrics.precastRate.grade}）`);
      lines.push(`   碳排放：${s.metrics.carbonEmission} kgCO₂/㎡`);
      lines.push(`   优点：${s.advantages.join('；')}`);
      lines.push(`   缺点：${s.disadvantages.join('；')}`);
      lines.push('');
    });
    lines.push(`【AI 推荐方案】`);
    lines.push(`推荐方案：${recommendation?.schemeName || '-'}`);
    lines.push(`综合评分：${recommendation ? recommendation.overallScore.toFixed(1) : '-'} / 10`);
    lines.push('');
    lines.push(`推荐理由：`);
    lines.push(recommendation?.reason ? recommendation.reason.replace(/\*\*/g, '').replace(/#/g, '') : '');
    lines.push('');
    lines.push('========================================');
    lines.push(`生成时间：${new Date().toLocaleString('zh-CN')}`);
    lines.push('注：本报告由 AI 智能体辅助生成，仅供方案阶段参考');
    return lines.join('\n');
  };

  // 优化路径折线图 option
  const optimPathOption: EChartsOption = useMemo(() => {
    if (!optimizationResult || optimizationResult.iterations.length === 0) {
      return {};
    }
    // 只展示被采纳的轮次 + 基准（rejected 的点用回退后的值，即跟上一轮相同）
    const iters = optimizationResult.iterations;
    const xLabels: string[] = [];
    const costData: number[] = [];
    const durationData: number[] = [];
    const precastData: number[] = [];
    let lastCost = 0;
    let lastDuration = 0;
    let lastPrecast = 0;
    iters.forEach((iter) => {
      if (iter.decision === 'baseline') {
        xLabels.push('基准');
      } else {
        xLabels.push(`轮${iter.round}`);
      }
      const scheme = iter.scheme;
      if (scheme) {
        if (iter.decision === 'rejected') {
          // 被回退，值跟上一轮相同（保持水平）
          costData.push(lastCost);
          durationData.push(lastDuration);
          precastData.push(lastPrecast);
        } else {
          lastCost = scheme.metrics.cost;
          lastDuration = scheme.metrics.duration;
          lastPrecast = scheme.metrics.precastRate.rate;
          costData.push(scheme.metrics.cost);
          durationData.push(scheme.metrics.duration);
          precastData.push(scheme.metrics.precastRate.rate);
        }
      }
    });

    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: CHART_SEMANTIC.tooltipBg,
        borderColor: 'rgba(15,76,129,0.2)',
        borderWidth: 1,
        textStyle: { color: CHART_SEMANTIC.text, fontSize: 14 },
      },
      legend: {
        show: true,
        top: 2,
        textStyle: { fontSize: 13, color: CHART_SEMANTIC.textMuted },
        itemGap: 20,
      },
      grid: { left: '3%', right: '4%', bottom: '12%', top: '18%', containLabel: true },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { fontSize: 13, color: CHART_SEMANTIC.textMuted },
        axisLine: { lineStyle: { color: 'rgba(15,76,129,0.2)' } },
      },
      yAxis: [
        {
          type: 'value',
          name: '造价 (元/㎡)',
          nameTextStyle: { fontSize: 12, color: CHART_SEMANTIC.textMuted, padding: [0, 0, 6, 0] },
          axisLabel: { fontSize: 12, color: CHART_SEMANTIC.textMuted },
          splitLine: { lineStyle: { color: CHART_SEMANTIC.gridLine } },
        },
        {
          type: 'value',
          name: '工期 (月) / 装配率 (%)',
          nameTextStyle: { fontSize: 12, color: CHART_SEMANTIC.textMuted, padding: [0, 0, 6, 0] },
          axisLabel: { fontSize: 12, color: CHART_SEMANTIC.textMuted },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '造价',
          type: 'line',
          data: costData,
          yAxisIndex: 0,
          smooth: true,
          symbol: 'circle',
          symbolSize: 8,
          lineStyle: { width: 2.5, color: CHART_COLORS[0] },
          itemStyle: { color: CHART_COLORS[0] },
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(21, 77, 135, 0.18)' }, { offset: 1, color: 'rgba(21, 77, 135, 0.02)' }] } },
        },
        {
          name: '工期',
          type: 'line',
          data: durationData,
          yAxisIndex: 1,
          smooth: true,
          symbol: 'diamond',
          symbolSize: 8,
          lineStyle: { width: 2, color: '#0d9488' },
          itemStyle: { color: '#0d9488' },
        },
        {
          name: '装配率',
          type: 'line',
          data: precastData,
          yAxisIndex: 1,
          smooth: true,
          symbol: 'rect',
          symbolSize: 7,
          lineStyle: { width: 2, color: CHART_SEMANTIC.warning, type: 'dashed' },
          itemStyle: { color: CHART_SEMANTIC.warning },
        },
      ],
    };
  }, [optimizationResult]);

  const handleCopyReport = async () => {
    const text = generateReportText();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('报告已复制到剪贴板');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('复制失败，请手动选择复制');
    }
  };

  const handlePrintReport = () => {
    const text = generateReportText();
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) {
      handleCopyReport();
      toast.info('浏览器拦截了打印弹窗，报告已复制到剪贴板');
      return;
    }
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>结构方案比选报告</title>
  <style>
    @media print { body { margin: 0; } }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft Yahei', monospace;
      padding: 40px;
      white-space: pre-wrap;
      word-break: break-all;
      line-height: 1.7;
      font-size: 14px;
      color: #1e293b;
    }
    h1 {
      text-align: center;
      font-size: 22px;
      margin: 0 0 24px 0;
      color: #1e40af;
      border-bottom: 2px solid #1e40af;
      padding-bottom: 12px;
    }
    .meta {
      text-align: center;
      color: #64748b;
      font-size: 12px;
      margin-bottom: 24px;
    }
  </style>
</head>
<body>
  <h1>结构方案比选报告</h1>
  <div class="meta">生成时间：${new Date().toLocaleString('zh-CN')}</div>
  <div>${text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</div>
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 300);
    };
  <\/script>
</body>
</html>`;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const handleOptimize = () => {
    if (!optimizeInput.trim() || !onOptimize) return;
    onOptimize(optimizeInput.trim());
    setOptimizeInput('');
  };

  // 规范校核：当前选中的方案
  const [normCheckSchemeIdx, setNormCheckSchemeIdx] = useState(0);

  // 当前方案的规范校核结果
  const currentNormScheme = useMemo(() => {
    if (!hasSchemes) return null;
    const idx = Math.min(normCheckSchemeIdx, schemes.length - 1);
    return schemes[idx] || null;
  }, [hasSchemes, normCheckSchemeIdx, schemes]);

  // Aggregate norm compliance from selected scheme
  const allNormChecks = useMemo(() => {
    if (!currentNormScheme?.normCompliance) return [];
    return currentNormScheme.normCompliance.checks;
  }, [currentNormScheme]);

  const passCount = allNormChecks.filter((c) => c.status === 'pass').length;
  const warnCount = allNormChecks.filter((c) => c.status === 'warning').length;
  const failCount = allNormChecks.filter((c) => c.status === 'fail').length;

  return (
    <section id="comparison" className="w-full py-14 md:py-16">
      <div className="mx-auto max-w-[1600px] px-6">
        {/* Section Header - blueprint style */}
        <div className="mb-7">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div className="flex items-end gap-4">
              <div className="flex flex-col items-center">
                <span className="font-mono text-5xl font-bold leading-none tracking-tight text-teal/90">03</span>
                <span className="mt-1 font-mono text-[9px] tracking-[0.2em] text-muted-foreground">SC-C03</span>
              </div>
              <div className="h-12 w-px bg-border" />
              <div>
                <div className="font-mono text-[11px] tracking-[0.25em] text-muted-foreground uppercase">Multi-Dim Comparison · 多维对比</div>
                <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                  综合比选分析
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  七维雷达对比 + 规范校核 + 智能推荐
                </p>
              </div>
            </div>
            {weights && (
              <div className="flex items-center gap-2 border border-border/50 bg-card/60 px-3 py-2 blueprint-card" style={{ borderRadius: '4px' }}>
                <TrendingUp className="h-3.5 w-3.5 text-teal" strokeWidth={1.75} />
                <span className="font-mono text-[9px] tracking-wider text-muted-foreground">WEIGHTS</span>
                <div className="flex items-center gap-1.5">
                  <span className="norm-badge !text-[10px]">造价 {weights.cost}%</span>
                  <span className="norm-badge !text-[10px] !border-teal/40 !text-teal">工期 {weights.duration}%</span>
                  <span className="norm-badge !text-[10px] !border-success/40 !text-success">安全 {weights.safety}%</span>
                  <span className="norm-badge !text-[10px] !border-amber/40 !text-amber">绿色 {weights.green}%</span>
                </div>
              </div>
            )}
          </div>
          <div className="tick-decor mt-4" />
        </div>

        {/* Decision summary card - 终局摘要 */}
        {hasSchemes && recommendedScheme && recommendation && !isRecommending && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="mb-6 border-2 border-amber/50 bg-gradient-to-br from-amber/[0.10] via-card to-card shadow-md blueprint-card"
            style={{ borderRadius: '6px' }}
          >
            <div className="flex flex-col gap-3 p-5 md:p-6 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-4">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-amber/20">
                  <Award className="size-6 text-amber" strokeWidth={1.75} />
                </div>
                <div className="min-w-0 space-y-1.5">
                  <div className="font-mono text-[11px] tracking-widest text-amber">
                    FINAL DECISION · 方案决策摘要
                  </div>
                  <h2 className="text-xl font-bold leading-tight text-foreground md:text-2xl">
                    推荐：<span className="text-amber">{recommendedScheme.name}</span>
                    ，因为{' '}
                    <span className="font-semibold">
                      {recommendation.reason
                        .split(/[。！？.!?]/)[0]
                        .replace(/^\s*[一二三四五、1-9.、-]+\s*/, '')
                        .slice(0, 28)}
                      …
                    </span>
                  </h2>
                  <p className="text-sm leading-relaxed text-muted-foreground md:text-base">
                    代价是{' '}
                    <span className="font-medium text-foreground">
                      {recommendedScheme.disadvantages[0] || '造价相对较高'}
                    </span>
                    ，需在方案阶段重点关注。
                  </p>
                  {recommendation.decisionSource && (
                    <DecisionTraceLine recommendation={recommendation} />
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3 border-t border-amber/20 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
                <div className="text-center">
                  <div className="font-mono text-[9px] tracking-wider text-muted-foreground">综合评分</div>
                  <div className="data-number text-3xl font-black text-amber">
                    {recommendation.overallScore.toFixed(1)}
                  </div>
                </div>
                <div className="h-10 w-px bg-amber/20" />
                <div className="text-center">
                  <div className="font-mono text-[9px] tracking-wider text-muted-foreground">造价（元/㎡）</div>
                  <div
                    className={`data-number flex items-baseline justify-center gap-1 rounded-md border px-3 py-1.5 font-mono text-[52px] font-black leading-none md:text-[64px] ${
                      projectParams?.budget
                        ? recommendedScheme.metrics.cost <= projectParams.budget
                          ? 'border-success/40 bg-success/10 text-success'
                          : 'border-destructive/40 bg-destructive/10 text-destructive'
                        : 'border-primary/25 bg-primary/[0.06] text-foreground'
                    }`}
                  >
                    <span className="self-start pt-1 text-lg font-semibold text-inherit opacity-80">¥</span>
                    <CountUpOnView
                      value={recommendedScheme.metrics.cost}
                      duration={1000}
                      className="tabular-nums tracking-tight"
                    />
                  </div>
                  {projectParams?.budget ? (
                    <div
                      className={`mt-1 inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                        recommendedScheme.metrics.cost <= projectParams.budget
                          ? 'bg-success/15 text-success'
                          : 'bg-destructive/15 text-destructive'
                      }`}
                    >
                      {recommendedScheme.metrics.cost <= projectParams.budget ? '✓ 低于预算' : '✕ 超出预算'}
                      <span className="opacity-70">预算 {projectParams.budget.toLocaleString()}</span>
                    </div>
                  ) : (
                    <div className="mt-1 text-[10px] text-muted-foreground">未设预算约束</div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* 总工仲裁：分歧权衡 + 3D预览 */}
        {hasSchemes && recommendedScheme && recommendation && !isRecommending && tradeoff && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-12"
          >
            {/* 左：总工分歧权衡 */}
            <Card className="corner-marks shadow-diffuse border-border/60 bg-card/80 blueprint-card lg:col-span-7">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <Gavel className="size-4 text-amber" strokeWidth={1.75} />
                  总工仲裁 · 分歧与权衡
                </CardTitle>
                <CardDescription className="text-xs">
                  {tradeoff.hasConflict
                    ? `发现 ${tradeoff.conflicts.length} 处核心分歧，按当前权重综合判定`
                    : '方案间无显著分歧，推荐结论明确'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                {tradeoff.conflicts.length > 0 ? (
                  <div className="space-y-3">
                    {tradeoff.conflicts.map((c, idx) => (
                      <div
                        key={idx}
                        className="rounded-md border border-border/50 bg-background/40 p-3"
                      >
                        <div className="mb-2 flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px] font-medium">
                            分歧 {idx + 1}
                          </Badge>
                          <span className="text-sm font-semibold text-foreground">
                            {c.dimensions[0]} vs {c.dimensions[1]}
                          </span>
                        </div>
                        <p className="text-xs leading-relaxed text-muted-foreground">{c.description}</p>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                          <div className="rounded bg-primary/5 px-2 py-1.5">
                            <div className="font-semibold text-primary">{c.schemeA.name}</div>
                            <div className="text-muted-foreground">
                              {c.schemeA.advantage}：
                              <span className="font-mono font-medium text-foreground">
                                {c.gapA.toFixed(c.gapA < 10 ? 1 : 0)} {c.unitA}
                              </span>
                            </div>
                          </div>
                          <div className="rounded bg-amber/10 px-2 py-1.5">
                            <div className="font-semibold text-amber">{c.schemeB.name}</div>
                            <div className="text-muted-foreground">
                              {c.schemeB.advantage}：
                              <span className="font-mono font-medium text-foreground">
                                {c.gapB.toFixed(c.gapB < 10 ? 1 : 0)} {c.unitB}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-md border border-success/30 bg-success/5 p-3">
                    <CheckCircle2 className="size-5 text-success" />
                    <p className="text-xs text-foreground">
                      两方案综合差距不明显，推荐方案在多数维度均占优，无显著权衡冲突。
                    </p>
                  </div>
                )}
                <div className="space-y-2 border-t border-border/40 pt-3">
                  <div className="flex items-start gap-2">
                    <Scale className="mt-0.5 size-4 shrink-0 text-teal" strokeWidth={1.75} />
                    <div>
                      <div className="text-xs font-semibold text-foreground">权重决策依据</div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {tradeoff.decisionBasedOnWeights}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <TrendingUp className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={1.75} />
                    <div>
                      <div className="text-xs font-semibold text-foreground">权重敏感性</div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {tradeoff.weightSensitivity}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 右：3D 结构线框预览 */}
            <Card className="corner-marks border-border/60 bg-card/80 blueprint-card lg:col-span-5">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <Box className="h-4 w-4 text-primary" strokeWidth={1.75} />
                   方案 3D 预览
                   <Badge variant="outline" className="ml-auto text-[10px]">
                    {displayedScheme ? displayedScheme.name : '结构体系示意'}
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  基于工程参数的结构线框示意，拖拽旋转 / 滚轮缩放
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div
                  className="relative h-[320px] w-full overflow-hidden"
                  style={{ borderRadius: '0 0 6px 6px' }}
                >
                  {projectParams ? (
                    <StructureWireframe3D params={projectParams} scheme={displayedScheme} codeChecks={codeChecks} />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      等待输入参数
                    </div>
                  )}
                  {Object.values(lockedParams).some(Boolean) && (
                    <div className="absolute left-3 top-3 flex items-center gap-1 rounded border border-primary/30 bg-background/90 px-2 py-1 text-[10px] text-primary backdrop-blur">
                      <Lock className="size-3" />
                      已锁定参数
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* KPI summary row */}
        {hasSchemes && !isRecommending && (
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <KpiCard
              icon={Wallet}
              label="最低造价"
              value={`¥${Math.min(...schemes.map((s) => s.metrics.cost)).toLocaleString()}`}
              unit="元/㎡"
              accent="primary"
            />
            <KpiCard
              icon={Clock}
              label="最短工期"
              value={String(Math.min(...schemes.map((s) => s.metrics.duration)))}
              unit="个月"
              accent="secondary"
            />
            <KpiCard
              icon={Calculator}
              label="规范校验"
              value={allNormChecks.length > 0 ? `${passCount}/${allNormChecks.length}` : '-'}
              unit="通过项"
              accent="success"
            />
            <KpiCard
              icon={Trophy}
              label="综合推荐"
              value={recommendation?.overallScore.toFixed(1) ?? '-'}
              unit="综合得分"
              accent="warning"
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
           {/* Main chart - 8 cols - blueprint */}
           <Card className="corner-marks border-border/60 bg-card/80 blueprint-card lg:col-span-8">
               <CardHeader className="flex flex-row items-start justify-between pb-3">
                 <div>
                   <CardTitle className="flex items-center gap-2 text-base font-semibold">
                     <Radar className="size-4 text-primary" strokeWidth={1.75} />
                     多维度方案对比分析
                   </CardTitle>
                   <CardDescription className="font-mono text-[10px] tracking-wider">
                     7-DIMENSIONAL COMPARISON
                   </CardDescription>
                 </div>
                 {hasSchemes && (
                   <Button
                     variant="outline"
                     size="sm"
                     onClick={() => {
                       try {
                         exportSchemeComparisonCsv(schemes, recommendation);
                         toast.success('对比表已导出');
                       } catch (err) {
                         toast.error('导出失败：' + String(err).slice(0, 40));
                       }
                     }}
                     className="gap-1.5"
                   >
                     <Download className="h-3.5 w-3.5" />
                     导出对比表
                   </Button>
                 )}
               </CardHeader>
             <CardContent>
               {!hasSchemes && !isRecommending ? (
                 <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                   <div className="flex size-14 items-center justify-center rounded-full bg-muted/60">
                     <BarChart3 className="size-6 text-muted-foreground" />
                   </div>
                   <div className="space-y-1">
                     <h4 className="text-sm font-semibold text-foreground">暂无对比数据</h4>
                     <p className="max-w-sm text-xs text-muted-foreground">
                       请先在参数控制台填写项目信息并启动生成，系统将自动绘制多维度对比图表。
                     </p>
                   </div>
                 </div>
               ) : isRecommending ? (
                 <div className="space-y-4 py-6">
                   <Skeleton className="mx-auto h-8 w-2/5" />
                   <Skeleton className="h-[300px] w-full rounded-xl" />
                   <div className="grid grid-cols-3 gap-3">
                     <Skeleton className="h-20 w-full rounded-md" />
                     <Skeleton className="h-20 w-full rounded-md" />
                     <Skeleton className="h-20 w-full rounded-md" />
                   </div>
                 </div>
               ) : hasSchemes ? (
                <div className="w-full">
                  {/* Tab bar */}
                  <div
                    role="tablist"
                    className="mb-4 grid w-full grid-cols-2 gap-1.5 rounded-lg border border-border/50 bg-background/40 p-[3px] sm:grid-cols-4 sm:gap-0"
                  >
                    {[
                      { value: 'radar', label: '雷达图', icon: Radar },
                      { value: 'bar-cost', label: '造价工期', icon: BarChart3 },
                      { value: 'bar-perf', label: '性能指标', icon: Target },
                      { value: 'bar-green', label: '绿色低碳', icon: Leaf },
                    ].map((tab) => {
                      const Icon = tab.icon;
                      const isActive = activeTab === tab.value;
                      return (
                        <button
                          key={tab.value}
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          onClick={() => setActiveTab(tab.value)}
                          className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs transition-all sm:text-sm ${
                            isActive
                              ? 'bg-primary/20 font-medium text-primary shadow-sm'
                              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          <span className="whitespace-nowrap">{tab.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* All charts rendered once, toggled by CSS visibility (避免反复 dispose/init) */}
                  <div className="relative w-full">
                      <div className={activeTab === 'radar' ? 'block w-full overflow-x-auto' : 'hidden'}>
                       <ReactECharts
                        option={radarOption}
                        style={{ height: 340, minWidth: 360 }}
                        opts={{ renderer: 'svg' }}
                      />
                      </div>
                      <div className={activeTab === 'bar-cost' ? 'block w-full overflow-x-auto' : 'hidden'}>
                        <ReactECharts
                          option={barOption}
                          style={{ height: 340, minWidth: 360 }}
                          opts={{ renderer: 'svg' }}
                        />
                      </div>
                     <div className={activeTab === 'bar-perf' ? 'block' : 'hidden'}>
                       <ReactECharts
                         option={perfBarOption}
                         className="pres-chart-minh h-[380px] w-full md:h-[440px]"
                        notMerge
                      />
                    </div>
                    <div className={activeTab === 'bar-green' ? 'block' : 'hidden'}>
                      <ReactECharts
                         option={greenBarOption}
                         className="pres-chart-minh h-[380px] w-full md:h-[440px]"
                        notMerge
                      />
                    </div>
                   </div>
                 </div>
               ) : null}
             </CardContent>
          </Card>

          {/* Right: Recommendation + Norm Compliance (4 cols) */}
          <div className="space-y-6 lg:col-span-4">
            {/* Recommendation Card - blueprint amber accent */}
            <Card className="corner-marks-full relative overflow-hidden border-amber/40 bg-gradient-to-br from-amber/[0.08] via-card to-card blueprint-card">
              <span className="corner-tl" style={{ borderColor: 'hsl(37 89% 48% / 0.5)' }} />
              <span className="corner-tr" style={{ borderColor: 'hsl(37 89% 48% / 0.5)' }} />
              <span className="corner-bl" style={{ borderColor: 'hsl(37 89% 48% / 0.5)' }} />
              <span className="corner-br" style={{ borderColor: 'hsl(37 89% 48% / 0.5)' }} />
              {/* Top amber accent line */}
              <div className="absolute left-0 top-0 right-0 h-0.5 bg-gradient-to-r from-amber via-amber/60 to-transparent" />
              {/* RECOMMENDED tab */}
              <div className="absolute -top-px right-4 z-10 bg-amber px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-amber-foreground" style={{ borderRadius: '0 0 2px 2px' }}>
                RECOMMENDED
              </div>

              <CardHeader className="pb-3 pt-4">
                <div className="flex items-center gap-3">
                  <div
                    className="flex size-10 items-center justify-center bg-amber/20 text-amber"
                    style={{ borderRadius: '3px' }}
                  >
                    <Trophy className="size-5" strokeWidth={1.75} />
                  </div>
                  <div>
                    <div className="font-mono text-[10px] tracking-wider text-amber">SCHEME · RECOMMENDED</div>
                    <CardTitle className="text-base font-semibold">综合推荐方案</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {!hasSchemes && !isRecommending ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                    <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
                      <Trophy className="size-5 text-primary/60" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-sm font-semibold text-foreground">等待推荐结果</h4>
                      <p className="max-w-xs text-xs text-muted-foreground">
                        生成方案后，AI 将基于综合评分自动推荐最优方案。
                      </p>
                    </div>
                  </div>
                ) : isRecommending ? (
                  <div className="space-y-3 py-2">
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <Skeleton className="h-14 w-full rounded-md" />
                      <Skeleton className="h-14 w-full rounded-md" />
                    </div>
                  </div>
                ) : (
                  <>
                    {isRecommending && !recommendedScheme ? (
                      <div className="space-y-3">
                        <Skeleton className="h-6 w-1/2" />
                        <div className="grid grid-cols-2 gap-2">
                          <Skeleton className="h-14 w-full rounded-md" />
                          <Skeleton className="h-14 w-full rounded-md" />
                        </div>
                      </div>
                    ) : null}
                    {recommendedScheme && (
                       <motion.div
                         initial={{ opacity: 0, y: 10 }}
                         animate={{ opacity: 1, y: 0 }}
                         className="border border-border/50 bg-background/50 p-4"
                         style={{ borderRadius: '4px' }}
                       >
                         <div className="mb-3 flex items-center justify-between border-b border-border/40 pb-2">
                           <h3 className="text-lg font-bold text-foreground">
                             {recommendedScheme.name}
                           </h3>
                           <span className="flex items-center gap-1 bg-amber/20 px-2 py-0.5 font-mono text-[10px] font-bold text-amber" style={{ borderRadius: '2px' }}>
                             <Award className="size-3" strokeWidth={2} />
                             OPTIMAL
                           </span>
                         </div>
                         <div className="grid grid-cols-2 gap-2.5">
                           <div className="border border-border/40 bg-card/60 p-2.5" style={{ borderRadius: '3px' }}>
                             <div className="font-mono text-[9px] tracking-wider text-muted-foreground">SCORE</div>
                             <div className="mt-0.5 flex items-baseline gap-0.5">
                               <span className="data-number text-2xl font-bold text-amber">
                                 {recommendation?.overallScore
                                   ? recommendation.overallScore.toFixed(1)
                                   : '-'}
                               </span>
                               <span className="text-[10px] text-muted-foreground">/10</span>
                             </div>
                           </div>
                           <div className="border border-border/40 bg-card/60 p-2.5" style={{ borderRadius: '3px' }}>
                             <div className="font-mono text-[9px] tracking-wider text-muted-foreground">COST</div>
                             <div className="mt-0.5 flex items-baseline gap-0.5">
                               <span className="data-number text-xl font-bold text-foreground">
                                 {recommendedScheme.metrics.cost.toLocaleString()}
                               </span>
                               <span className="text-[9px] text-muted-foreground">元/㎡</span>
                             </div>
                           </div>
                           <div className="border border-border/40 bg-card/60 p-2.5" style={{ borderRadius: '3px' }}>
                             <div className="font-mono text-[9px] tracking-wider text-muted-foreground">DURATION</div>
                             <div className="mt-0.5 flex items-baseline gap-0.5">
                               <span className="data-number text-lg font-bold text-foreground">
                                 {recommendedScheme.metrics.duration}
                               </span>
                               <span className="text-[9px] text-muted-foreground">月</span>
                             </div>
                           </div>
                           <div className="border border-border/40 bg-card/60 p-2.5" style={{ borderRadius: '3px' }}>
                             <div className="font-mono text-[9px] tracking-wider text-muted-foreground">CARBON</div>
                             <div className="mt-0.5 flex items-baseline gap-0.5">
                               <span className="data-number text-lg font-bold text-foreground">
                                 {recommendedScheme.metrics.carbonEmission}
                               </span>
                               <span className="text-[9px] text-muted-foreground">kg/㎡</span>
                             </div>
                           </div>
                         </div>
                         {projectParams && (
                           <div className="mt-3 flex flex-col gap-1.5 border-t border-border/40 pt-2.5">
                             <Button
                               variant="outline"
                               size="sm"
                               className="w-full gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
                               onClick={() => {
                                 try {
                                   const r = downloadModelFiles(projectParams, recommendedScheme);
                                   toast.success('已导出建模文件 ' + r.jsonName);
                                 } catch (err) {
                                   toast.error('导出失败：' + String(err).slice(0, 40));
                                 }
                               }}
                             >
                               <Download className="h-3.5 w-3.5" />
                               导出为结构建模文件
                             </Button>
                             <p className="font-mono text-[9px] leading-relaxed text-muted-foreground">
                               PKPM / YJK 前哨 · 含轴线 / 层高 / 截面与导入指引，可直接用于专业软件初步建模
                             </p>
                           </div>
                         )}
                       </motion.div>
                    )}

                    <div className="rounded-md border-2 border-amber/30 bg-gradient-to-br from-amber/[0.06] to-card p-4 shadow-sm">
                      <div className="mb-3 flex items-center gap-2">
                        <div className="flex size-6 items-center justify-center rounded bg-amber/20">
                          <Sparkles className="h-3.5 w-3.5 text-amber" />
                        </div>
                        <h3 className="text-sm font-bold text-foreground">
                          AI 推荐理由
                        </h3>
                        {isRecommending && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-auto" />
                        )}
                      </div>
                    <div className="text-sm leading-relaxed text-foreground">
                         {recommendationContent || recommendation?.reason ? (
                           <div className="prose prose-sm max-w-none text-foreground dark:prose-invert prose-headings:text-base prose-headings:font-bold prose-p:text-sm prose-p:my-1.5 prose-strong:text-amber">
                             <ReactMarkdown remarkPlugins={[remarkGfm]}>
                               {recommendationContent || recommendation?.reason}
                             </ReactMarkdown>
                           </div>
                         ) : (
                           <span className="text-muted-foreground">分析中...</span>
                         )}
                       </div>

                     {/* 总工主动优化建议 */}
                     {optimizationSuggestions.length > 0 && recommendedScheme && (
                       <div className="mt-4 rounded-md border-2 border-teal/40 bg-gradient-to-br from-teal/[0.06] to-card p-4 shadow-sm">
                         <div className="mb-2.5 flex items-center gap-2">
                           <div className="flex size-6 items-center justify-center rounded bg-teal/20">
                             <Lightbulb className="h-3.5 w-3.5 text-teal" />
                           </div>
                           <h3 className="text-sm font-bold text-foreground">
                             优化空间分析
                           </h3>
                           <Badge variant="outline" className="ml-auto border-teal/40 bg-teal/10 text-[10px] text-teal">
                             总工建议
                           </Badge>
                         </div>
                         <div className="space-y-2.5">
                           {optimizationSuggestions.map((s) => {
                             const IconComp = s.type === 'cost' ? Wallet : s.type === 'duration' ? Clock : s.type === 'precast' ? Layers : s.type === 'green' ? Leaf : ShieldCheck;
                             const colorClass = s.type === 'cost' ? 'text-amber' : s.type === 'duration' ? 'text-primary' : s.type === 'precast' ? 'text-purple-700' : s.type === 'green' ? 'text-emerald-700' : 'text-red-700';
                             return (
                               <div key={s.dimension} className="flex gap-2.5 rounded border border-border/60 bg-card/70 p-2.5">
                                 <div className={`flex size-7 shrink-0 items-center justify-center rounded ${colorClass.replace('text-', 'bg-')}/15 ${colorClass}`}>
                                   <IconComp className="h-3.5 w-3.5" />
                                 </div>
                                 <div className="min-w-0 flex-1 text-xs leading-relaxed text-foreground">
                                   <div className="mb-0.5 flex items-center gap-2">
                                     <span className="font-semibold text-foreground">{s.dimension}</span>
                                     <span className={`font-mono text-[10px] ${colorClass}`}>{s.potential}</span>
                                   </div>
                                   <p className="text-muted-foreground">{s.description}</p>
                                 </div>
                               </div>
                             );
                           })}
                         </div>
                       </div>
                     )}
                    </div>

                     {/* Action Buttons */}
                     <div className="space-y-2">
                       <Button
                         onClick={() => setOptimizeDialogOpen(true)}
                         disabled={!recommendedScheme || isAutoOptimizing}
                         className="w-full gap-2"
                         style={{ borderRadius: '3px' }}
                       >
                         <Zap className="size-4" />
                         {isAutoOptimizing ? (
                           <><Loader2 className="size-4 animate-spin" /> 优化中...</>
                         ) : (
                           <>我要优化这个方案</>
                         )}
                       </Button>
                       <div className="flex gap-2">
                         <Button
                           variant="secondary"
                           size="sm"
                           onClick={handleCopyReport}
                           className="flex-1 gap-1"
                           disabled={!recommendation}
                         >
                           {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                           {copied ? '已复制' : '复制报告'}
                         </Button>
                         <Button
                           variant="secondary"
                           size="sm"
                           onClick={handlePrintReport}
                           className="flex-1 gap-1"
                           disabled={!recommendation}
                         >
                           <FileText className="h-3.5 w-3.5" />
                           打印报告
                         </Button>
                       </div>
                      </div>

                     {/* 优化模式选择 Dialog */}
                     <Dialog open={optimizeDialogOpen} onOpenChange={setOptimizeDialogOpen}>
                       <DialogContent className="sm:max-w-lg">
                         <DialogHeader>
                           <DialogTitle className="flex items-center gap-2 text-foreground">
                             <Zap className="size-5 text-amber" />
                             选择优化目标
                           </DialogTitle>
                           <DialogDescription>
                             系统将自动执行多轮迭代优化，每轮调整一个杠杆后重算指标，保留改善的、回退恶化的。
                           </DialogDescription>
                         </DialogHeader>

                         <div className="space-y-3">
                           {[
                             { key: 'cost', icon: Wallet, label: '成本优先', desc: '以降低造价为核心目标，尝试更经济的体系、减小跨度', color: 'text-amber border-amber/40 bg-amber/5' },
                             { key: 'duration', icon: Clock, label: '工期优先', desc: '以缩短工期为核心目标，优先采用装配式体系', color: 'text-primary border-primary/40 bg-primary/5' },
                             { key: 'precast', icon: Layers, label: '装配率优先', desc: '以提高装配率为核心目标，优先采用PC/装配式钢结构', color: 'text-purple-700 border-purple-500/40 bg-purple-500/5' },
                             { key: 'green', icon: Leaf, label: '绿色低碳优先', desc: '以降低隐含碳排放为核心目标，优先钢结构/木结构', color: 'text-emerald-700 border-emerald-500/40 bg-emerald-500/5' },
                             { key: 'safety', icon: ShieldCheck, label: '安全冗余优先', desc: '以提升抗震性能为核心目标，尝试更高等级结构体系', color: 'text-red-700 border-red-500/40 bg-red-500/5' },
                           ].map((item) => {
                             const IconComp = item.icon;
                             const selected = selectedGoal === item.key;
                             return (
                               <button
                                 key={item.key}
                                 onClick={() => setSelectedGoal(item.key as typeof selectedGoal)}
                                 className={`flex w-full items-start gap-3 rounded-md border p-3 text-left transition-all ${
                                   selected
                                     ? item.color + ' shadow-sm'
                                     : 'border-border/60 bg-card hover:border-border hover:bg-muted/30'
                                 }`}
                               >
                                 <div className={`flex size-9 shrink-0 items-center justify-center rounded ${selected ? item.color.replace('text-', 'bg-').replace('border-', '').replace('bg-', '').split(' ')[0] + '/20' : 'bg-muted/40 text-muted-foreground'}`}>
                                   <IconComp className="size-4" />
                                 </div>
                                 <div className="min-w-0 flex-1">
                                   <div className="text-sm font-semibold text-foreground">{item.label}</div>
                                   <div className="mt-0.5 text-xs text-muted-foreground">{item.desc}</div>
                                 </div>
                                 <CheckCircle2 className={`size-5 shrink-0 ${selected ? item.color.split(' ')[0] : 'text-transparent'}`} />
                               </button>
                             );
                           })}

                           {selectedGoal === 'cost' && (
                             <div className="rounded-md border border-border/60 bg-muted/20 p-3">
                               <div className="mb-1.5 text-xs font-medium text-foreground">目标预算（元/㎡）</div>
                               <div className="flex items-center gap-2">
                                 <Input
                                   type="number"
                                   value={targetBudget}
                                   onChange={(e) => setTargetBudget(e.target.value)}
                                   className="font-mono"
                                   placeholder="3500"
                                 />
                                 <span className="text-xs text-muted-foreground">元/㎡</span>
                               </div>
                               <p className="mt-1 text-[10px] text-muted-foreground">
                                 系统将尝试通过体系切换、跨度调整等手段，让造价尽量接近或低于该目标。
                               </p>
                             </div>
                           )}
                         </div>

                         <DialogFooter>
                           <Button
                             variant="outline"
                             onClick={() => setOptimizeDialogOpen(false)}
                             disabled={isAutoOptimizing}
                           >
                             取消
                           </Button>
                           <Button
                             onClick={() => {
                               if (!onStartOptimization) return;
                               setOptimizeDialogOpen(false);
                               onStartOptimization(
                                 selectedGoal,
                                 selectedGoal === 'cost' && targetBudget ? Number(targetBudget) : undefined
                               );
                             }}
                             disabled={isAutoOptimizing || !onStartOptimization}
                             className="gap-2"
                           >
                             <Play className="size-4" />
                             开始优化
                           </Button>
                         </DialogFooter>
                       </DialogContent>
                     </Dialog>
                   </>
                 )}
               </CardContent>
             </Card>

             {/* 优化路径可视化 */}
             {optimizationResult && (
               <Card className="border-primary/30 bg-gradient-to-br from-primary/[0.06] via-card to-card blueprint-card">
                 <CardHeader className="pb-3">
                   <CardTitle className="flex items-center gap-2 text-base">
                     <RefreshCw className="size-4 text-primary" />
                     优化路径
                     <Badge className="ml-auto bg-primary/15 text-[10px] text-primary">
                       {optimizationResult.summary.totalRounds} 轮迭代
                     </Badge>
                   </CardTitle>
                   <CardDescription className="text-xs">
                     {optimizationResult.summary.keyInsight}
                   </CardDescription>
                 </CardHeader>
                 <CardContent className="space-y-4">
                   {/* 关键指标对比 */}
                   <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                     {[
                       { label: '造价', before: optimizationResult.summary.originalCost, after: optimizationResult.summary.finalCost, unit: '元/㎡', isBetter: (b, a) => a < b, formatter: (v) => Math.round(v).toLocaleString(), type: 'cost' },
                       { label: '工期', before: optimizationResult.summary.originalDuration, after: optimizationResult.summary.finalDuration, unit: '月', isBetter: (b, a) => a < b, formatter: (v) => v.toFixed(1), type: 'duration' },
                       { label: '装配率', before: optimizationResult.summary.originalPrecastRate, after: optimizationResult.summary.finalPrecastRate, unit: '%', isBetter: (b, a) => a > b, formatter: (v) => v.toFixed(0), type: 'precast' },
                       { label: '碳排', before: optimizationResult.summary.originalCarbon, after: optimizationResult.summary.finalCarbon, unit: 'kg/㎡', isBetter: (b, a) => a < b, formatter: (v) => Math.round(v), type: 'carbon' },
                     ].map((m) => {
                       const diff = m.after - m.before;
                       const better = m.isBetter(m.before, m.after);
                       return (
                         <div key={m.label} className="rounded border border-border/50 bg-card/70 p-2.5">
                           <div className="font-mono text-[9px] tracking-wider text-muted-foreground">{m.label.toUpperCase()}</div>
                           <div className="mt-0.5 flex items-baseline gap-1">
                             <span className="data-number text-base font-bold text-foreground">{m.formatter(m.after)}</span>
                             <span className="text-[10px] text-muted-foreground">{m.unit}</span>
                           </div>
                           <div className={`mt-0.5 flex items-center gap-0.5 text-[10px] font-medium ${better ? 'text-success' : 'text-destructive'}`}>
                             {better ? <TrendingDown className="size-3" /> : <TrendingUp className="size-3" />}
                             <span>
                               {diff > 0 ? '+' : ''}{diff.toFixed(1)}
                               {m.unit === '月' ? '月' : m.unit === '%' ? 'pt' : m.unit === 'kg/㎡' ? 'kg' : '元'}
                             </span>
                           </div>
                         </div>
                       );
                     })}
                   </div>

                    {/* 优化路径折线图 */}
                    <div className="rounded border border-border/50 bg-card/70 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="font-mono text-[10px] tracking-wider text-muted-foreground">
                          OPTIMIZATION TREND · 指标趋势
                        </div>
                        <div className="flex gap-3 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-primary" />造价</span>
                          <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-teal" />工期</span>
                          <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-amber" />装配率</span>
                        </div>
                      </div>
                        <div className="w-full overflow-x-auto">
                          <ReactECharts
                            option={optimPathOption}
                            style={{ height: 300, minWidth: 360 }}
                            opts={{ renderer: 'svg' }}
                          />
                        </div>
                    </div>

                    {/* 迭代时间线 */}
                    <div className="space-y-2">
                      <div className="font-mono text-[10px] tracking-wider text-muted-foreground">
                        ITERATION PATH · 迭代过程
                      </div>
                     <div className="space-y-1.5">
                       {optimizationResult.iterations.map((iter, idx) => {
                         const isAccepted = iter.decision === 'accepted';
                         const isBaseline = iter.decision === 'baseline';
                         return (
                           <div
                             key={iter.round}
                             className={`flex gap-3 rounded border p-2.5 ${isBaseline ? 'border-amber/40 bg-amber/[0.05]' : isAccepted ? 'border-success/40 bg-success/[0.04]' : 'border-border/40 bg-muted/20 opacity-70'}`}
                           >
                             <div className={`flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold ${isBaseline ? 'bg-amber/20 text-amber' : isAccepted ? 'bg-success/20 text-success' : 'bg-muted-foreground/20 text-muted-foreground'}`}>
                               {iter.round}
                             </div>
                             <div className="min-w-0 flex-1 text-xs leading-relaxed">
                               <div className="mb-0.5 flex items-center gap-1.5">
                                 <span className="font-semibold text-foreground">
                                   {isBaseline ? '基准方案' : iter.lever?.description}
                                 </span>
                                 <Badge variant="outline" className={`text-[9px] ${isBaseline ? 'border-amber/40 text-amber' : isAccepted ? 'border-success/40 text-success' : 'border-muted-foreground/40 text-muted-foreground'}`}>
                                   {isBaseline ? 'BASELINE' : isAccepted ? 'ACCEPTED' : 'REJECTED'}
                                 </Badge>
                               </div>
                               {iter.delta && (
                                 <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                                   <span className={iter.delta.cost < 0 ? 'text-success' : iter.delta.cost > 0 ? 'text-destructive' : ''}>
                                     造价 {iter.delta.cost > 0 ? '+' : ''}{Math.round(iter.delta.cost)}
                                   </span>
                                   <span className={iter.delta.duration < 0 ? 'text-success' : iter.delta.duration > 0 ? 'text-destructive' : ''}>
                                     工期 {iter.delta.duration > 0 ? '+' : ''}{iter.delta.duration.toFixed(1)}
                                   </span>
                                   <span className={iter.delta.precastRate > 0 ? 'text-success' : iter.delta.precastRate < 0 ? 'text-destructive' : ''}>
                                     装配率 {iter.delta.precastRate > 0 ? '+' : ''}{iter.delta.precastRate.toFixed(1)}%
                                   </span>
                                   <span className={iter.delta.carbon < 0 ? 'text-success' : iter.delta.carbon > 0 ? 'text-destructive' : ''}>
                                     碳排 {iter.delta.carbon > 0 ? '+' : ''}{Math.round(iter.delta.carbon)}
                                   </span>
                                 </div>
                               )}
                                <div className="mt-1 text-[11px] text-muted-foreground">
                                  {iter.decisionReason}
                                </div>
                                {iter.selfAssessment && iter.selfAssessment.verdict !== 'continue' && (
                                  <div className={`mt-1.5 rounded border px-2 py-1 text-[10px] leading-snug ${
                                    iter.selfAssessment.verdict === 'stop_target_met'
                                      ? 'border-success/40 bg-success/[0.04] text-success'
                                      : iter.selfAssessment.verdict === 'stop_diminishing'
                                        ? 'border-amber/40 bg-amber/[0.04] text-amber'
                                        : 'border-muted-foreground/30 bg-muted/30 text-muted-foreground'
                                  }`}>
                                    <span className="font-mono font-semibold">AGENT SELF-ASSESS · </span>
                                    {iter.selfAssessment.summary.includes('自评')
                                      ? iter.selfAssessment.summary.slice(iter.selfAssessment.summary.indexOf('自评'))
                                      : iter.selfAssessment.summary}
                                  </div>
                                )}
                             </div>
                           </div>
                         );
                       })}
                     </div>
                   </div>

                   {/* 目标达成 */}
                   {optimizationResult.iterations[optimizationResult.iterations.length - 1]?.goalProgress && (
                     <div className={`rounded-md border p-3 ${optimizationResult.summary.goalAchieved ? 'border-success/40 bg-success/[0.06]' : 'border-amber/40 bg-amber/[0.06]'}`}>
                       <div className="flex items-center gap-2 text-sm">
                         {optimizationResult.summary.goalAchieved ? (
                           <CheckCircle2 className="size-4 text-success" />
                         ) : (
                           <AlertTriangle className="size-4 text-amber" />
                         )}
                         <span className="font-semibold text-foreground">
                           {optimizationResult.summary.goalAchieved ? '目标已达成' : '未达到设定目标'}
                         </span>
                         <span className="ml-auto text-xs text-muted-foreground">
                           {optimizationResult.iterations[optimizationResult.iterations.length - 1]?.goalProgress?.target}
                         </span>
                       </div>
                     </div>
                   )}
                 </CardContent>
               </Card>
             )}

             {/* Norm Compliance Card - blueprint */}
             <Card className="corner-marks border-border/60 bg-card/80 blueprint-card">
               <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <Landmark className="size-4 text-primary" strokeWidth={1.75} />
                    规范校核
                    <span
                      className={`ml-auto px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider ${
                        failCount > 0
                          ? 'bg-destructive/15 text-destructive'
                          : warnCount > 0
                            ? 'bg-amber/20 text-amber'
                            : 'bg-success/15 text-success'
                      }`}
                      style={{ borderRadius: '2px' }}
                    >
                      {failCount > 0 ? 'NON-COMPLIANT' : warnCount > 0 ? 'CAUTION' : 'ALL PASS'}
                    </span>
                  </CardTitle>
                  <CardDescription className="font-mono text-[10px] tracking-wider">
                    CODE COMPLIANCE · GB 55002/55008
                  </CardDescription>
                  {/* 方案切换 tab */}
                  {hasSchemes && schemes.length > 1 && (
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/40 pt-3">
                      {schemes.map((s, idx) => {
                        const isActive = idx === normCheckSchemeIdx;
                        const isRecommended = s.id === recommendation?.schemeId;
                        return (
                          <button
                            key={s.id}
                            onClick={() => setNormCheckSchemeIdx(idx)}
                            className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium transition-colors ${
                              isActive
                                ? 'bg-primary/15 text-primary shadow-sm'
                                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                            }`}
                            style={{ borderRadius: '3px' }}
                          >
                            <span className="font-mono text-[9px] opacity-60">S{idx + 1}</span>
                            <span className="truncate max-w-[100px]">{s.name}</span>
                            {isRecommended && (
                              <span className="shrink-0 text-[9px] text-amber">★</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
               </CardHeader>
               <CardContent className="space-y-2">
                 {isRecommending ? (
                   <div className="space-y-2 py-1">
                     <Skeleton className="h-5 w-full rounded-sm" />
                     <Skeleton className="h-5 w-11/12 rounded-sm" />
                     <Skeleton className="h-5 w-10/12 rounded-sm" />
                     <Skeleton className="h-5 w-9/12 rounded-sm" />
                   </div>
                 ) : allNormChecks.length === 0 ? (
                   <div className="py-4 text-center text-xs text-muted-foreground">
                     方案生成后显示规范校验结果
                   </div>
                 ) : (
                   allNormChecks.map((check, i) => (
                     <NormCheckRow key={i} check={check} />
                   ))
                 )}
              </CardContent>
            </Card>
          </div>
        </div>

         {/* Metric Estimation Basis - blueprint */}
         <Card className="corner-marks mt-6 border-border/60 bg-card/80 blueprint-card">
           <CardHeader className="pb-2">
             <CardTitle className="flex items-center gap-2 text-sm font-semibold">
               <Calculator className="size-4 text-teal" strokeWidth={1.75} />
               指标估算依据
               <span className="norm-badge ml-2">METHODOLOGY</span>
             </CardTitle>
             <CardDescription className="font-mono text-[10px] tracking-wider">
               工程经验估算模型 · 点击展开查看计算口径
             </CardDescription>
           </CardHeader>
          <CardContent className="pt-0">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="duration" className="border-border/40">
                <AccordionTrigger className="py-3 text-sm font-medium text-foreground hover:no-underline">
                  <span className="flex items-center gap-2">
                    <Clock className="size-4 text-secondary" />
                    工期估算（月）
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-xs leading-relaxed text-muted-foreground">
                  <div className="space-y-2">
                    <p>
                      <strong className="text-foreground">计算公式：</strong>
                      工期 = 基础施工期 + 主体施工期 + 装修安装期
                    </p>
                    <ul className="list-disc space-y-1 pl-5">
                      <li><strong>基础工期</strong>：低层 1-2 个月，多层 2-3.5 个月，高层 3.5-6 个月（随层数递增）</li>
                      <li><strong>主体工期</strong>：按结构体系施工效率推算（现浇框架 ≈ 900 ㎡/月，钢结构 ≈ 1300 ㎡/月），结合单层面积与层数计算月进度</li>
                      <li><strong>装修安装期</strong>：小项目约 1 个月，大中型项目 2-4 个月（钢结构与装配式因穿插施工效率更高，缩减 10-15%）</li>
                    </ul>
                    <p className="pt-1">
                      <strong className="text-foreground">参考工程经验：</strong>
                      300㎡ 2 层框架 ≈ 2.5-4 月；3000㎡ 6 层框架 ≈ 6-9 月；10000㎡ 18 层框剪 ≈ 12-16 月；20000㎡ 30 层剪力墙 ≈ 18-24 月。
                    </p>
                    <p className="text-warning/80">
                      ⚠️ 本工具工期为结构主体施工估算，不含方案设计、报建审批及精装园林工程。
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="cost" className="border-border/40">
                <AccordionTrigger className="py-3 text-sm font-medium text-foreground hover:no-underline">
                  <span className="flex items-center gap-2">
                    <Wallet className="size-4 text-primary" />
                    造价估算（元/㎡）
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-xs leading-relaxed text-muted-foreground">
                  <div className="space-y-2">
                    <p>
                      <strong className="text-foreground">计算公式：</strong>
                      单方造价 = 基准造价 × 高度修正系数 × 烈度修正系数 × 场地修正系数
                    </p>
                    <ul className="list-disc space-y-1 pl-5">
                      <li><strong>基准造价</strong>（10 层 / 7 度 / Ⅱ 类场地）：框架 2800、框剪 3800、剪力墙 4400、钢结构 5500、装配式 4200 元/㎡</li>
                      <li><strong>高度修正</strong>：10 层以上每增加 1 层造价 +1.2%（竖向构件材料增加）；5 层以下 × 0.92</li>
                      <li><strong>烈度修正</strong>：以 7 度为基准，每增减 1 度造价 ±4%</li>
                      <li><strong>场地修正</strong>：Ⅰ 类 × 0.97、Ⅲ 类 × 1.05、Ⅳ 类 × 1.1（基础造价影响）</li>
                    </ul>
                    <p className="pt-1">
                      <strong className="text-foreground">数据口径：</strong>
                      结构主体建安工程费（含混凝土、钢筋、模板、脚手架、基础工程），不含精装修、机电设备、土地及室外工程。
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="carbon" className="border-border/40">
                <AccordionTrigger className="py-3 text-sm font-medium text-foreground hover:no-underline">
                  <span className="flex items-center gap-2">
                    <Leaf className="size-4 text-success" />
                    碳排放估算（kgCO₂/㎡）
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-xs leading-relaxed text-muted-foreground">
                  <div className="space-y-2">
                    <p>
                      <strong className="text-foreground">数据来源：</strong>
                      基于中国生命周期基础数据库（CLCD）及 ICE 数据库经验值，取建筑结构主体的隐含碳（建材生产 + 运输 + 施工阶段），不含运营阶段碳排放。
                    </p>
                    <ul className="list-disc space-y-1 pl-5">
                      <li>现浇混凝土框架：约 500-600 kgCO₂/㎡</li>
                      <li>剪力墙结构：约 600-700 kgCO₂/㎡（墙体混凝土用量大）</li>
                      <li>钢结构：约 450-500 kgCO₂/㎡（钢材隐含碳高但用量少，且可回收）</li>
                      <li>装配式混凝土：约 480-520 kgCO₂/㎡（减少现场浪费）</li>
                    </ul>
                    <p className="pt-1">
                      <strong className="text-foreground">层数修正：</strong>
                      每增加 10 层，单位面积碳排约 +3%（竖向构件占比增大）。
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="norm" className="border-border/40">
                <AccordionTrigger className="py-3 text-sm font-medium text-foreground hover:no-underline">
                  <span className="flex items-center gap-2">
                     <Landmark className="size-4 text-teal" strokeWidth={1.75} />
                    规范校验指标
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-xs leading-relaxed text-muted-foreground">
                  <div className="space-y-2">
                    <p>规范校验基于以下国家标准，采用经验公式估算：</p>
                    <ul className="list-disc space-y-1 pl-5">
                      <li><strong>层间位移角</strong>：GB/T 50011-2010（2024局部修订）表 5.5.1，及强制性通用规范 GB 55002-2021 第 5.1.1 条；按结构体系取限值（框架 1/550、框剪 1/800、剪力墙 1/1000）</li>
                      <li><strong>剪重比</strong>：GB 55002-2021《建筑与市政工程抗震通用规范》第 4.2.3 条（强制性）及 GB/T 50011 表 5.2.5，楼层最小地震剪力系数，按烈度与结构体系查表</li>
                      <li><strong>周期比 Tt/T1</strong>：JGJ 3-2010《高层建筑混凝土结构技术规程》第 3.4.5 条，扭转周期与平动周期比限值</li>
                      <li><strong>高度适用范围</strong>：GB/T 50011 表 6.1.1（混凝土结构）/表 8.1.1（钢结构）/表 7.1.2（砌体），各结构体系最大适用高度</li>
                    </ul>
                    <p className="text-warning/80 pt-1">
                      ⚠️ 校验结果为经验估算值，仅用于方案阶段初步判断，实际设计需以专业计算软件分析为准。
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>

        {/* Iterative Optimization */}
        <Card className="mt-6 border-border/50 bg-card/60 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <RefreshCw className="size-4 text-primary" />
              多轮迭代优化
              <Badge variant="outline" className="ml-2 text-[10px]">
                基于当前方案继续优化
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              输入新的约束条件或优化目标，AI 将基于当前项目参数重新调整方案
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                placeholder="例如：预算降低30%、更侧重施工速度、抗震性能优先、减少钢材用量等"
                value={optimizeInput}
                onChange={(e) => setOptimizeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleOptimize();
                }}
                className="flex-1"
                disabled={isOptimizing}
              />
              <Button
                onClick={handleOptimize}
                disabled={isOptimizing || !optimizeInput.trim() || !onOptimize}
                className="gap-2"
              >
                {isOptimizing ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    优化中...
                  </>
                ) : (
                  <>
                    <Send className="size-4" />
                    重新优化
                  </>
                )}
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="text-xs text-muted-foreground">快捷指令：</span>
              {['预算降低30%', '更侧重施工速度', '抗震性能优先', '追求绿色可持续'].map(
                (cmd) => (
                  <button
                    key={cmd}
                    onClick={() => setOptimizeInput(cmd)}
                    className="rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                  >
                    {cmd}
                  </button>
                ),
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="text-xs font-medium text-primary/80">反事实推演：</span>
              {[
                '如果把层数从 30 降到 20 会怎样',
                '剪力墙换成框剪会怎么样',
                '假如设防烈度降到 7 度',
              ].map((cmd) => (
                <button
                  key={cmd}
                  onClick={() => setOptimizeInput(cmd)}
                  title="假设性提问不会改动当前参数，只做推演对比"
                  className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs text-primary transition-colors hover:border-primary/60 hover:bg-primary/10"
                >
                  {cmd}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function NormCheckRow({ check }: { check: INormCheckItem }) {
  const Icon =
    check.status === 'pass'
      ? ShieldCheck
      : check.status === 'warning'
        ? AlertTriangle
        : XCircle;
  const colorClass =
    check.status === 'pass'
      ? 'text-success bg-success/10 border-success/30'
      : check.status === 'warning'
        ? 'text-warning bg-warning/10 border-warning/30'
        : 'text-destructive bg-destructive/10 border-destructive/30';

  const statusLabel =
    check.status === 'pass' ? '符合' : check.status === 'warning' ? '需注意' : '不符合';

  const hasDetail = check.clauseText || check.reason || check.source || check.calcChain;

  return (
    <div
      className={`rounded-md border overflow-hidden transition-all ${
        check.status === 'pass'
          ? 'border-success/20'
          : check.status === 'warning'
            ? 'border-warning/20'
            : 'border-destructive/20'
      }`}
    >
      <Accordion type="single" collapsible className="w-full">
        <AccordionItem value="detail" className="border-0">
          <AccordionTrigger className="hover:no-underline px-3 py-3 hover:bg-muted/30 transition-colors">
            <div className="flex items-center gap-3 w-full pr-2">
              <div
                className={`flex size-7 shrink-0 items-center justify-center rounded-md border ${colorClass}`}
              >
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground">{check.name}</span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      check.status === 'pass'
                        ? 'bg-success/20 text-success'
                        : check.status === 'warning'
                          ? 'bg-warning/20 text-warning'
                          : 'bg-destructive/20 text-destructive'
                    }`}
                  >
                    {statusLabel}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1">{check.description}</p>
                {check.value && check.requirement && (
                  <div className="mt-1 flex gap-3 text-[10px] text-muted-foreground/80">
                    <span>
                      计算值：<span className="font-mono font-semibold text-foreground">{check.value}</span>
                    </span>
                    <span>
                      限值：<span className="font-mono text-foreground/80">{check.requirement}</span>
                    </span>
                  </div>
                )}
              </div>
            </div>
          </AccordionTrigger>

          {hasDetail && (
            <AccordionContent className="px-3 pb-3">
              <div className="ml-10 space-y-2.5 border-l-2 border-border/60 pl-3">
                {check.clauseText && (
                  <div className="rounded-md border border-border/40 bg-muted/30 p-2.5">
                    <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold text-primary">
                      <FileText className="size-3" />
                      条文原文
                    </div>
                    <p className="text-[11px] leading-relaxed text-foreground/90">
                      {check.clauseText}
                    </p>
                  </div>
                )}

                {check.reason && (
                  <div className="rounded-md border border-border/40 bg-muted/30 p-2.5">
                    <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold text-teal">
                      <Lightbulb className="size-3" />
                      判定理由
                    </div>
                    <p className="text-[11px] leading-relaxed text-foreground/90">
                      {check.reason}
                    </p>
                  </div>
                )}

                {check.source && (
                  <div className="rounded-md border border-border/40 bg-muted/30 p-2.5">
                    <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold text-amber">
                      <BookOpen className="size-3" />
                      规范出处
                    </div>
                    <p className="text-[11px] font-mono leading-relaxed text-foreground/90">
                      {check.source}
                    </p>
                  </div>
                )}

                {check.calcChain && (
                  <div className="rounded-md border border-border/40 bg-background/50 p-2.5">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold text-secondary-foreground">
                      <Calculator className="size-3" />
                      计算过程
                    </div>
                    <div className="space-y-1 text-[11px] text-foreground/85">
                      <div className="flex gap-2">
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground w-14">依据</span>
                        <span>{check.calcChain.basis}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground w-14">输入</span>
                        <span className="font-mono">{check.calcChain.input}</span>
                      </div>
                      {check.calcChain.formula && (
                        <div className="flex gap-2">
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground w-14">公式</span>
                          <span className="font-mono text-primary">{check.calcChain.formula}</span>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground w-14">结果</span>
                        <span className="font-mono font-semibold text-foreground">{check.calcChain.result}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </AccordionContent>
          )}
        </AccordionItem>
      </Accordion>
    </div>
  );
}

interface KpiCardProps {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: string;
  unit: string;
  accent: 'primary' | 'secondary' | 'success' | 'warning';
}

function KpiCard({ icon: Icon, label, value, unit, accent }: KpiCardProps) {
  const accentColor = {
    primary: 'text-primary',
    secondary: 'text-teal',
    success: 'text-success',
    warning: 'text-amber',
  }[accent];

  return (
    <Card className="corner-marks border-border/60 bg-card/80 blueprint-card">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[9px] tracking-wider text-muted-foreground uppercase">
              {label}
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="data-number text-2xl font-bold tabular-nums text-foreground">
                {value}
              </span>
              <span className="text-[10px] text-muted-foreground">{unit}</span>
            </div>
          </div>
          <div className={`flex size-9 items-center justify-center bg-background/60 ${accentColor}`} style={{ borderRadius: '3px' }}>
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default memo(ComparisonSection);
