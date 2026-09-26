import { memo, useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Building2,
  Layers,
  Ruler,
  Landmark,
  Mountain,
  Wallet,
  Sparkles,
  Gauge,
  RotateCcw,
  Key,
  Shield,
  AlertTriangle,
  Globe,
  Home,
  GraduationCap,
  Factory,
  MoveHorizontal,
  Zap,
  Lock,
  Unlock,
  Wind,
  Snowflake,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  MOCK_WEIGHT_CONFIG,
  type IProjectParams,
  type IWeightConfig,
  type IStructureScheme,
} from '@/data/structure';
import type { IHumanOverrides } from '@/agent/types';
import ApiKeyModal from '@/components/ApiKeyModal';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { getLlmConfig } from '@/components/ApiKeyModal';

interface ParamsSectionProps {
   onGenerate: (params: IProjectParams, weights: IWeightConfig, humanOverrides?: IHumanOverrides) => void;
   /** 最近一次生成的候选方案（供"锁定方案"多选使用） */
   latestSchemes?: IStructureScheme[];
   isGenerating: boolean;
   initialParams: IProjectParams | null;
   initialWeights: IWeightConfig;
   /** 表单重置计数器：外部改变时整体重挂载表单，用最新 initialParams 重新初始化 */
   formResetKey?: number;
   /** 被锁定的参数键集合 — 自主优化时不得改动 */
   lockedParams?: Partial<Record<keyof IProjectParams, boolean>>;
   /** 切换某参数的锁定状态 */
   onToggleLock?: (key: keyof IProjectParams) => void;
   /** 全局禁用（自动播放中锁住表单，防止用户操作打断播放） */
   disabled?: boolean;
 }

const BUILDING_TYPES = [
  { value: 'residential', label: '住宅建筑', desc: '高层/多层住宅' },
  { value: 'office', label: '办公建筑', desc: '写字楼/综合楼' },
  { value: 'school', label: '教学建筑', desc: '教学楼/宿舍' },
  { value: 'factory', label: '工业厂房', desc: '厂房/仓库' },
  { value: 'gymnasium', label: '大跨度建筑', desc: '体育馆/会展' },
];

const STRUCTURE_PREFERENCES = [
  { value: 'any', label: '不限（智能推荐）' },
  { value: 'frame', label: '框架结构' },
  { value: 'frame-shearwall', label: '框架-剪力墙' },
  { value: 'shearwall', label: '剪力墙结构' },
  { value: 'steel', label: '钢结构' },
  { value: 'prefabricated', label: '装配式结构' },
];

const SEISMIC_INTENSITIES = [
  { value: '6', label: '6 度设防' },
  { value: '7', label: '7 度设防' },
  { value: '8', label: '8 度设防' },
  { value: '9', label: '9 度设防' },
];

const SOIL_CATEGORIES = [
  { value: 'Ⅰ', label: 'Ⅰ 类（坚硬）' },
  { value: 'Ⅱ', label: 'Ⅱ 类（中硬）' },
  { value: 'Ⅲ', label: 'Ⅲ 类（中软）' },
  { value: 'Ⅳ', label: 'Ⅳ 类（软弱）' },
];

const GEOLOGY_TYPES = [
  { value: 'rock', label: '岩石地基' },
  { value: 'clay', label: '一般黏土' },
  { value: 'loess', label: '湿陷性黄土' },
  { value: 'fill', label: '人工填土' },
  { value: 'other', label: '其他地质' },
];

const WIND_PRESSURES = [
  { value: '0.3', label: '0.30 kN/㎡' },
  { value: '0.35', label: '0.35 kN/㎡' },
  { value: '0.4', label: '0.40 kN/㎡' },
  { value: '0.45', label: '0.45 kN/㎡' },
  { value: '0.55', label: '0.55 kN/㎡' },
  { value: '0.65', label: '0.65 kN/㎡' },
  { value: '0.75', label: '0.75 kN/㎡' },
];

const SNOW_PRESSURES = [
  { value: '0.15', label: '0.15 kN/㎡' },
  { value: '0.2', label: '0.20 kN/㎡' },
  { value: '0.25', label: '0.25 kN/㎡' },
  { value: '0.35', label: '0.35 kN/㎡' },
  { value: '0.45', label: '0.45 kN/㎡' },
  { value: '0.55', label: '0.55 kN/㎡' },
];

const FORTIFICATION_CATEGORIES = [
  { value: 'standard', label: '标准设防类（丙类）' },
  { value: 'key', label: '重点设防类（乙类）' },
  { value: 'special', label: '特殊设防类（甲类）' },
  { value: 'moderate', label: '适度设防类（丁类）' },
];

const WEIGHT_ITEMS = [
  {
    key: 'cost' as const,
    label: '造价经济性',
    description: '单方造价权重',
    icon: Wallet,
    color: 'from-cyan-500 to-teal-500',
  },
  {
    key: 'duration' as const,
    label: '工期效率',
    description: '建设周期权重',
    icon: Layers,
    color: 'from-sky-500 to-blue-500',
  },
  {
    key: 'safety' as const,
    label: '安全性能',
    description: '抗震·结构安全',
    icon: Shield,
    color: 'from-emerald-500 to-green-500',
  },
  {
    key: 'green' as const,
    label: '绿色低碳',
    description: '装配·碳排放',
    icon: Mountain,
    color: 'from-violet-500 to-indigo-500',
  },
];

const paramsSchema = z.object({
  buildingType: z.string().min(1, '请选择建筑类型'),
  floors: z.coerce.number().min(1, '层数必须大于 0'),
  area: z.coerce.number().min(100, '建筑面积过小'),
  structurePreference: z.string().min(1, '请选择结构体系'),
  seismicIntensity: z.string().min(1, '请选择设防烈度'),
  soilCategory: z.string().min(1, '请选择场地土类别'),
  mainSpan: z.coerce.number().min(1, '跨度必须大于 0'),
  budget: z.coerce.number().min(500, '预算过低'),
  geologyType: z.string().min(1, '请选择场地地质'),
   windPressure: z.string().min(1, '请选择基本风压'),
   snowPressure: z.string().min(1, '请选择基本雪压'),
   fortificationCategory: z.string().min(1, '请选择设防类别'),
   buildingHeight: z.coerce.number().min(1, '建筑高度必须大于 0'),
 });

type ParamsFormData = z.infer<typeof paramsSchema>;

function ParamsSection({
   onGenerate,
   latestSchemes,
   isGenerating,
   initialParams,
   initialWeights,
   formResetKey = 0,
   lockedParams = {},
   onToggleLock,
   disabled = false,
 }: ParamsSectionProps) {
  const [weights, setWeights] = useState<IWeightConfig>(initialWeights);
  const [apiModalOpen, setApiModalOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(() => {
    try {
      return !!getLlmConfig()?.apiKey;
    } catch {
      return false;
    }
  });

  const defaultValues: ParamsFormData = useMemo(() => {
    if (initialParams) {
      return {
        buildingType: initialParams.buildingType,
        floors: initialParams.floors,
        area: initialParams.area,
        structurePreference: initialParams.structurePreference,
        seismicIntensity: initialParams.seismicIntensity,
        soilCategory: initialParams.soilCategory,
         mainSpan: initialParams.mainSpan,
         budget: initialParams.budget,
         geologyType: initialParams.geologyType,
          windPressure: initialParams.windPressure,
          snowPressure: initialParams.snowPressure,
          fortificationCategory: initialParams.fortificationCategory,
          buildingHeight: initialParams.buildingHeight,
        };
     }
     return {
       buildingType: 'residential',
       floors: 30,
       area: 15000,
       structurePreference: 'any',
       seismicIntensity: '8',
       soilCategory: 'Ⅱ',
       mainSpan: 6,
       budget: 4500,
       geologyType: 'clay',
        windPressure: '0.4',
        snowPressure: '0.2',
        fortificationCategory: 'standard',
        buildingHeight: 90,
      };
  }, [initialParams]);

  const form = useForm<ParamsFormData>({
    resolver: zodResolver(paramsSchema) as unknown as Parameters<typeof useForm<ParamsFormData>>[0]['resolver'],
    defaultValues,
  });

  // 注意：**不要**用 useEffect + form.reset 监听 initialParams 变化
  // 之前的 bug：用户改了表单值后，任何导致 initialParams 引用变化的操作（如 setProjectParams）
  // 都会触发 form.reset 把用户输入偷偷覆盖回旧值，等于白改。
  // 正确做法：通过外部 formResetKey 变化触发整体重挂载来重置表单，
  // 日常用户输入与生成流程完全解耦，handleSubmit 永远拿 form 最新值。

  // initialWeights 变化时同步权重 state
  const totalWeight = weights.cost + weights.duration + weights.safety + weights.green;
  const weightsValid = totalWeight === 100;

  const handleWeightChange = (key: keyof IWeightConfig, value: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(value / 5) * 5));
    setWeights((prev) => ({ ...prev, [key]: clamped }));
  };

  const handleResetWeights = () => {
    setWeights(MOCK_WEIGHT_CONFIG);
  };

  // 预设案例一键填充并生成
  const handlePresetCase = (preset: IProjectParams) => {
    form.setValue('buildingType', preset.buildingType);
    form.setValue('floors', preset.floors);
    form.setValue('area', preset.area);
    form.setValue('structurePreference', preset.structurePreference);
    form.setValue('seismicIntensity', preset.seismicIntensity);
    form.setValue('soilCategory', preset.soilCategory);
    form.setValue('mainSpan', preset.mainSpan);
     form.setValue('budget', preset.budget);
     form.setValue('geologyType', preset.geologyType);
     form.setValue('windPressure', preset.windPressure);
     form.setValue('snowPressure', preset.snowPressure);
       form.setValue('fortificationCategory', preset.fortificationCategory);
       form.setValue('buildingHeight', preset.buildingHeight);
       // 直接触发生成
    const params: IProjectParams = {
      buildingType: preset.buildingType,
      floors: preset.floors,
      area: preset.area,
      structurePreference: preset.structurePreference,
      seismicIntensity: preset.seismicIntensity,
      soilCategory: preset.soilCategory,
       mainSpan: preset.mainSpan,
       budget: preset.budget,
       geologyType: preset.geologyType,
        windPressure: preset.windPressure,
        snowPressure: preset.snowPressure,
        fortificationCategory: preset.fortificationCategory,
        buildingHeight: preset.buildingHeight,
      };
      onGenerate(params, weights);
  };

  const PRESET_CASES = [
    {
      name: '西安·12层住宅',
      tag: '住宅 · 8度区 · 36m',
      icon: Home,
      desc: '12层框剪 · 6000㎡',
      params: {
        buildingType: 'residential' as IProjectParams['buildingType'],
        floors: 12,
        area: 6000,
        structurePreference: 'any',
        seismicIntensity: '8' as IProjectParams['seismicIntensity'],
        soilCategory: 'Ⅱ' as IProjectParams['soilCategory'],
        mainSpan: 6,
        budget: 4500,
        geologyType: 'clay',
        windPressure: '0.35',
        snowPressure: '0.2',
        fortificationCategory: 'standard',
        buildingHeight: 36,
      },
    },
    {
      name: '高校·教学楼',
      tag: '公建 · 7度区',
      icon: GraduationCap,
      desc: '5层框架 · 4500㎡',
      params: {
        buildingType: 'school' as IProjectParams['buildingType'],
        floors: 5,
        area: 4500,
        structurePreference: 'any',
        seismicIntensity: '7' as IProjectParams['seismicIntensity'],
        soilCategory: 'Ⅱ' as IProjectParams['soilCategory'],
        mainSpan: 8,
        budget: 3500,
        geologyType: 'clay',
        windPressure: '0.4',
        snowPressure: '0.25',
        fortificationCategory: 'key',
        buildingHeight: 19,
      },
    },
    {
      name: '工业·单层厂房',
      tag: '厂房 · 大跨度',
      icon: Factory,
      desc: '1层钢结构 · 24m跨',
      params: {
        buildingType: 'factory' as IProjectParams['buildingType'],
        floors: 1,
        area: 3600,
        structurePreference: 'steel',
        seismicIntensity: '7' as IProjectParams['seismicIntensity'],
        soilCategory: 'Ⅱ' as IProjectParams['soilCategory'],
        mainSpan: 24,
        budget: 4200,
        geologyType: 'clay',
        windPressure: '0.55',
        snowPressure: '0.35',
        fortificationCategory: 'standard',
        buildingHeight: 10,
      },
    },
  ];

  // ===== 人类在环（HITL）干预面板状态 =====
  const [hitlOpen, setHitlOpen] = useState(false);
  const [budgetCapInput, setBudgetCapInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [lockedIds, setLockedIds] = useState<string[]>([]);

  const toggleLock = (id: string) => {
    setLockedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  /** 应用干预并重跑：以当前表单参数 + 干预项触发新一轮生成 */
  const handleApplyIntervention = () => {
    if (!weightsValid) {
      toast.error('权重总和必须等于 100%，请调整后重试');
      return;
    }
    const values = form.getValues();
    const params: IProjectParams = {
      buildingType: values.buildingType as IProjectParams['buildingType'],
      floors: values.floors,
      area: values.area,
      structurePreference: values.structurePreference,
      seismicIntensity: values.seismicIntensity as IProjectParams['seismicIntensity'],
      soilCategory: values.soilCategory as IProjectParams['soilCategory'],
      mainSpan: values.mainSpan,
      budget: values.budget,
      geologyType: values.geologyType,
      windPressure: values.windPressure,
      snowPressure: values.snowPressure,
      fortificationCategory: values.fortificationCategory,
      buildingHeight: values.buildingHeight,
    };
    const overrides: IHumanOverrides = {};
    if (budgetCapInput.trim()) {
      const cap = Number(budgetCapInput);
      if (!Number.isFinite(cap) || cap <= 0) {
        toast.error('预算上限需为正数（单位：万元）');
        return;
      }
      overrides.budgetCap = cap;
    }
    if (lockedIds.length > 0) overrides.lockedSchemeIds = [...lockedIds];
    if (notesInput.trim()) overrides.notes = notesInput.trim();
    onGenerate(params, weights, Object.keys(overrides).length > 0 ? overrides : undefined);
  };

  const handleSubmit = (values: ParamsFormData) => {
    if (!weightsValid) {
      toast.error('权重总和必须等于 100%，请调整后重试');
      return;
    }
    const params: IProjectParams = {
      buildingType: values.buildingType as IProjectParams['buildingType'],
      floors: values.floors,
      area: values.area,
      structurePreference: values.structurePreference,
      seismicIntensity: values.seismicIntensity as IProjectParams['seismicIntensity'],
      soilCategory: values.soilCategory as IProjectParams['soilCategory'],
       mainSpan: values.mainSpan,
       budget: values.budget,
       geologyType: values.geologyType,
       windPressure: values.windPressure,
       snowPressure: values.snowPressure,
       fortificationCategory: values.fortificationCategory,
       buildingHeight: values.buildingHeight,
     };
     onGenerate(params, weights);
  };

  return (
    <section id="params" key={formResetKey} className="w-full py-14 md:py-16">
      <div className="mx-auto max-w-[1600px] px-6">
        {/* Section header - blueprint style */}
        <div className="mb-7">
          <div className="flex items-end justify-between gap-4">
            <div className="flex items-end gap-4">
              {/* Drawing number - 图号 */}
              <div className="flex flex-col items-center">
                <span className="font-mono text-5xl font-bold leading-none text-teal/90 tracking-tight">01</span>
                <span className="mt-1 font-mono text-[9px] tracking-[0.2em] text-muted-foreground">SC-A01</span>
              </div>
              <div className="h-12 w-px bg-border" />
              <div>
                <div className="font-mono text-[11px] tracking-[0.25em] text-muted-foreground uppercase">Project Parameters · 参数录入</div>
                <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                  项目参数配置
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  填写建筑核心参数，启动智能结构方案生成
                </p>
              </div>
            </div>
            <div className="hidden items-center gap-2 font-mono text-[10px] text-muted-foreground md:flex">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                CODE LOADED
              </span>
              <span className="text-border">|</span>
              <span className="tracking-wider">GB 55002 · 55008 · 55037</span>
            </div>
          </div>
          {/* Tick mark separator */}
           <div className="tick-decor mt-4" />
         </div>

           {/* Preset demo cases */}
           <div className="pres-card-pad mb-6">
           <div className="mb-3 flex items-center gap-2">
             <Zap className="h-3.5 w-3.5 text-amber" />
             <span className="text-xs font-semibold text-foreground">快速演示 · 一键加载案例</span>
             <span className="font-mono text-[10px] text-muted-foreground">DEMO PRESETS</span>
           </div>
           <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
             {PRESET_CASES.map((preset) => {
               const Icon = preset.icon;
               return (
                 <motion.button
                   key={preset.name}
                   whileHover={{ y: -2, scale: 1.01 }}
                   whileTap={{ scale: 0.98 }}
                   onClick={() => handlePresetCase(preset.params)}
                   disabled={isGenerating}
                  className="corner-marks group flex items-center gap-3 border border-border/60 bg-card/80 p-3 text-left blueprint-card disabled:opacity-50 disabled:cursor-not-allowed pres-big-button"
                    style={{ borderRadius: '4px' }}
                 >
                   <div className="flex size-10 shrink-0 items-center justify-center bg-primary/10 text-primary group-hover:bg-primary/15 transition-colors" style={{ borderRadius: '3px' }}>
                     <Icon className="size-5" strokeWidth={1.75} />
                   </div>
                   <div className="flex-1 min-w-0">
                     <div className="flex items-center gap-2">
                       <span className="text-sm font-semibold text-foreground">{preset.name}</span>
                       <span className="norm-badge !text-[9px] !px-1.5">{preset.tag}</span>
                     </div>
                     <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                       {preset.desc}
                     </div>
                   </div>
                   <div className="shrink-0 text-xs font-medium text-primary group-hover:translate-x-0.5 transition-transform">
                     生成 →
                   </div>
                 </motion.button>
               );
             })}
           </div>
         </div>

         {/* Main layout: form + side panel */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left: Form (8 cols) */}
          <Card className="corner-marks-full border-border/60 bg-card/85 shadow-sm blueprint-card lg:col-span-8 overflow-visible">
            <span className="corner-tl" />
            <span className="corner-tr" />
            <span className="corner-bl" />
            <span className="corner-br" />
            <CardHeader className="flex flex-row items-center gap-3 border-b border-border/40 pb-4">
              <div className="flex size-10 items-center justify-center bg-primary/15 text-primary" style={{ borderRadius: '3px' }}>
                <Building2 className="size-5" strokeWidth={1.75} />
              </div>
              <div className="flex-1">
                <CardTitle className="text-lg font-bold text-foreground">
                  项目参数配置
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  方案阶段估算输入 · 共 10 项核心参数
                </CardDescription>
              </div>
              <span className="norm-badge">PARAMS</span>
            </CardHeader>

            <CardContent className="pt-6">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleSubmit, () => {
                   const errs = form.formState.errors;
                   const firstKey = Object.keys(errs)[0];
                   toast.error(firstKey ? `参数不完整：${firstKey} 未填写或无效` : '请检查表单参数');
                 })} className={`space-y-5 ${disabled ? 'pointer-events-none opacity-60' : ''}`}>
                   {/* === 基本参数 === */}
                   <div className="flex items-center gap-2 mb-2">
                     <div className="h-px flex-1 bg-gradient-to-r from-primary/40 to-transparent" />
                     <span className="font-mono text-[10px] font-bold tracking-wider text-primary whitespace-nowrap">
                       § 01 · 基本参数
                     </span>
                     <div className="h-px flex-1 bg-gradient-to-l from-primary/40 to-transparent" />
                   </div>
                    {/* Row 1: Building type + floors + height + area */}
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <FormField
                      control={form.control}
                      name="buildingType"
                      render={({ field }) => (
                         <FormItem>
                           <div className="flex items-center justify-between">
                             <FormLabel className="pres-label text-xs font-medium text-muted-foreground">
                               建筑类型 <span className="text-destructive">*</span>
                             </FormLabel>
                             {onToggleLock && (
                               <button
                                 type="button"
                                 onClick={() => onToggleLock('buildingType')}
                                 className="text-muted-foreground transition-colors hover:text-primary"
                                 title={lockedParams.buildingType ? '取消锁定（优化时可调整）' : '锁定此参数（优化时不改）'}
                               >
                                 {lockedParams.buildingType ? (
                                   <Lock className="h-3.5 w-3.5 text-primary" />
                                 ) : (
                                   <Unlock className="h-3.5 w-3.5" />
                                 )}
                               </button>
                             )}
                           </div>
                           <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger className="h-11">
                                <SelectValue placeholder="请选择" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {BUILDING_TYPES.map((t) => (
                                <SelectItem key={t.value} value={t.value}>
                                  <div className="flex flex-col">
                                    <span className="text-sm">{t.label}</span>
                                    <span className="text-[10px] text-muted-foreground">
                                      {t.desc}
                                    </span>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="floors"
                      render={({ field }) => (
                         <FormItem>
                           <div className="flex items-center justify-between">
                             <FormLabel className="pres-label text-xs font-medium text-muted-foreground">
                               建筑层数 <span className="text-destructive">*</span>
                             </FormLabel>
                             {onToggleLock && (
                               <button
                                 type="button"
                                 onClick={() => onToggleLock('floors')}
                                 className="text-muted-foreground transition-colors hover:text-primary"
                                 title={lockedParams.floors ? '取消锁定（优化时可调整）' : '锁定此参数（优化时不改）'}
                               >
                                 {lockedParams.floors ? (
                                   <Lock className="h-3.5 w-3.5 text-primary" />
                                 ) : (
                                   <Unlock className="h-3.5 w-3.5" />
                                 )}
                               </button>
                             )}
                           </div>
                            <FormControl>
                              <div className="relative">
                                <Layers className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary/70" />
                                <Input
                                  type="number"
                                  className="h-11 pl-10 pr-10 font-mono text-base font-semibold tabular-nums"
                                  {...field}
                                  onChange={(e) => {
                                    field.onChange(e);
                                    const f = Number(e.target.value);
                                    if (f > 0 && !form.getValues('buildingHeight')) {
                                      form.setValue('buildingHeight', Math.round(f * 3 * 10) / 10);
                                    } else if (f > 0) {
                                      // 如果用户还没手动改过高度，自动按层数计算
                                      const currentHeight = form.getValues('buildingHeight');
                                      const expected = Math.round(f * 3 * 10) / 10;
                                      if (Math.abs(currentHeight - expected) < 0.15 || !currentHeight) {
                                        form.setValue('buildingHeight', expected);
                                      }
                                    }
                                  }}
                                />
                                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                  层
                                </span>
                              </div>
                            </FormControl>
                            <div className="mt-1 flex items-center gap-2">
                              <input
                                type="range"
                                min={1}
                                max={60}
                                step={1}
                                value={field.value || 1}
                                onChange={(e) => {
                                  const f = Number(e.target.value);
                                  field.onChange(f);
                                  if (f > 0 && !form.getValues('buildingHeight')) {
                                    form.setValue('buildingHeight', Math.round(f * 3 * 10) / 10);
                                  } else if (f > 0) {
                                    const currentHeight = form.getValues('buildingHeight');
                                    const expected = Math.round(f * 3 * 10) / 10;
                                    if (Math.abs(currentHeight - expected) < 0.15 || !currentHeight) {
                                      form.setValue('buildingHeight', expected);
                                    }
                                  }
                                }}
                                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-primary/20 accent-primary"
                              />
                              <span className="whitespace-nowrap rounded-sm border border-primary/25 bg-primary/5 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                推荐 3-12
                              </span>
                            </div>
                            <FormMessage />
                          </FormItem>
                       )}
                     />
                    <FormField
                      control={form.control}
                      name="buildingHeight"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between">
                            <FormLabel className="pres-label text-xs font-medium text-muted-foreground">
                              建筑高度 <span className="text-destructive">*</span>
                            </FormLabel>
                            {onToggleLock && (
                              <button
                                type="button"
                                onClick={() => onToggleLock('buildingHeight')}
                                className="text-muted-foreground transition-colors hover:text-primary"
                                title={lockedParams.buildingHeight ? '取消锁定（优化时可调整）' : '锁定此参数（优化时不改）'}
                              >
                                {lockedParams.buildingHeight ? (
                                  <Lock className="h-3.5 w-3.5 text-primary" />
                                ) : (
                                  <Unlock className="h-3.5 w-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                          <FormControl>
                            <div className="relative">
                              <Input
                                type="number"
                                step="0.1"
                                className="h-11 pr-8 font-mono text-base font-semibold tabular-nums"
                                {...field}
                              />
                              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                m
                              </span>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="area"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="pres-label text-xs font-medium text-muted-foreground">
                            建筑面积 <span className="text-destructive">*</span>
                          </FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                type="number"
                                className="h-11 pr-12 font-mono text-base font-semibold tabular-nums"
                                {...field}
                              />
                              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                ㎡
                              </span>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Row 2: Structure + seismic + soil + geology */}
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
                    <FormField
                      control={form.control}
                      name="structurePreference"
                      render={({ field }) => (
                         <FormItem>
                           <div className="flex items-center justify-between">
                             <FormLabel className="pres-label text-xs font-medium text-muted-foreground">
                               结构体系 <span className="text-destructive">*</span>
                             </FormLabel>
                             {onToggleLock && (
                               <button
                                 type="button"
                                 onClick={() => onToggleLock('structurePreference')}
                                 className="text-muted-foreground transition-colors hover:text-primary"
                                 title={lockedParams.structurePreference ? '取消锁定（优化时可调整）' : '锁定此参数（优化时不改）'}
                               >
                                 {lockedParams.structurePreference ? (
                                   <Lock className="h-3.5 w-3.5 text-primary" />
                                 ) : (
                                   <Unlock className="h-3.5 w-3.5" />
                                 )}
                               </button>
                             )}
                           </div>
                           <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger className="h-11">
                                <SelectValue placeholder="请选择" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {STRUCTURE_PREFERENCES.map((s) => (
                                <SelectItem key={s.value} value={s.value}>
                                  {s.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="seismicIntensity"
                      render={({ field }) => (
                         <FormItem>
                           <div className="flex items-center justify-between">
                             <FormLabel className="pres-label text-xs font-medium text-muted-foreground">
                               设防烈度 <span className="text-destructive">*</span>
                             </FormLabel>
                             {onToggleLock && (
                               <button
                                 type="button"
                                 onClick={() => onToggleLock('seismicIntensity')}
                                 className="text-muted-foreground transition-colors hover:text-primary"
                                 title={lockedParams.seismicIntensity ? '取消锁定（优化时可调整）' : '锁定此参数（优化时不改）'}
                               >
                                 {lockedParams.seismicIntensity ? (
                                   <Lock className="h-3.5 w-3.5 text-primary" />
                                 ) : (
                                   <Unlock className="h-3.5 w-3.5" />
                                 )}
                               </button>
                             )}
                           </div>
                           <Select onValueChange={field.onChange} defaultValue={field.value}>
                             <FormControl>
                               <SelectTrigger className="h-11">
                                 <SelectValue placeholder="请选择" />
                               </SelectTrigger>
                             </FormControl>
                             <SelectContent>
                               {SEISMIC_INTENSITIES.map((s) => (
                                 <SelectItem key={s.value} value={s.value}>
                                   {s.label}
                                 </SelectItem>
                               ))}
                             </SelectContent>
                           </Select>
                           <FormMessage />
                         </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="soilCategory"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="pres-label text-xs font-medium text-muted-foreground">
                            场地土类别 <span className="text-destructive">*</span>
                          </FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger className="h-11">
                                <SelectValue placeholder="请选择" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {SOIL_CATEGORIES.map((s) => (
                                <SelectItem key={s.value} value={s.value}>
                                  {s.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="geologyType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="pres-label text-xs font-medium text-muted-foreground">
                            场地地质 <span className="text-destructive">*</span>
                          </FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger className="h-11">
                                <SelectValue placeholder="请选择" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {GEOLOGY_TYPES.map((s) => (
                                <SelectItem key={s.value} value={s.value}>
                                  {s.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Row 3: Span + budget */}
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="mainSpan"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="pres-label text-xs font-medium text-muted-foreground">
                            主要跨度 <span className="text-destructive">*</span>
                          </FormLabel>
                          <FormControl>
                            <div className="relative">
                              <MoveHorizontal className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary/70" />
                              <Input
                                type="number"
                                className="h-11 pl-10 pr-8 font-mono text-base font-semibold tabular-nums"
                                {...field}
                              />
                              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                m
                              </span>
                            </div>
                          </FormControl>
                          <div className="mt-1 flex items-center gap-2">
                            <input
                              type="range"
                              min={3}
                              max={24}
                              step={0.5}
                              value={field.value || 6}
                              onChange={(e) => field.onChange(Number(e.target.value))}
                              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-primary/20 accent-primary"
                            />
                            <span className="whitespace-nowrap rounded-sm border border-primary/25 bg-primary/5 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                              推荐 6-12
                            </span>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="budget"
                      render={({ field }) => (
                         <FormItem>
                           <div className="flex items-center justify-between">
                             <FormLabel className="pres-label text-xs font-medium text-muted-foreground">
                               预算约束 <span className="text-destructive">*</span>
                             </FormLabel>
                             {onToggleLock && (
                               <button
                                 type="button"
                                 onClick={() => onToggleLock('budget')}
                                 className="text-muted-foreground transition-colors hover:text-primary"
                                 title={lockedParams.budget ? '取消锁定（优化时可调整）' : '锁定此参数（优化时不改）'}
                               >
                                 {lockedParams.budget ? (
                                   <Lock className="h-3.5 w-3.5 text-primary" />
                                 ) : (
                                   <Unlock className="h-3.5 w-3.5" />
                                 )}
                               </button>
                             )}
                           </div>
                           <FormControl>
                             <div className="relative">
                               <Input
                                 type="number"
                                 className="h-11 pr-14 font-mono text-base font-semibold tabular-nums"
                                 {...field}
                               />
                               <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                 元/㎡
                               </span>
                             </div>
                           </FormControl>
                           <FormMessage />
                         </FormItem>
                      )}
                    />
                   </div>

                   {/* === 荷载与设防 === */}
                   <div className="flex items-center gap-2 mt-2 mb-2">
                     <div className="h-px flex-1 bg-gradient-to-r from-amber/40 to-transparent" />
                     <span className="font-mono text-[10px] font-bold tracking-wider text-amber whitespace-nowrap">
                       § 02 · 荷载与设防
                     </span>
                     <div className="h-px flex-1 bg-gradient-to-l from-amber/40 to-transparent" />
                   </div>

                   {/* Advanced options - 更多荷载与设防选项 */}
                   <div className="rounded-lg border border-border/50 bg-background/30">
                     <button
                       type="button"
                       onClick={() => setAdvancedOpen((v) => !v)}
                       className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-accent/30"
                     >
                       <div className="flex items-center gap-2">
                         <Zap className="size-4 text-amber" />
                         <span className="text-sm font-medium text-foreground">
                           更多荷载与设防选项
                         </span>
                         <Badge variant="outline" className="text-[10px]">
                           3 项
                         </Badge>
                       </div>
                       {advancedOpen ? (
                         <ChevronUp className="size-4 text-muted-foreground" />
                       ) : (
                         <ChevronDown className="size-4 text-muted-foreground" />
                       )}
                     </button>
                     {advancedOpen && (
                       <div className="space-y-4 border-t border-border/40 px-4 py-4">
                         {/* Row: 风压 + 雪压 */}
                         <div className="grid grid-cols-2 gap-3">
                           <FormField
                             control={form.control}
                             name="windPressure"
                             render={({ field }) => (
                               <FormItem>
                                 <div className="flex items-center justify-between">
                                   <FormLabel className="pres-label text-xs font-medium text-muted-foreground">
                                     基本风压
                                   </FormLabel>
                                   {onToggleLock && (
                                     <button
                                       type="button"
                                       onClick={() => onToggleLock('windPressure')}
                                       className="text-muted-foreground transition-colors hover:text-primary"
                                       title={lockedParams.windPressure ? '取消锁定' : '锁定此参数'}
                                     >
                                       {lockedParams.windPressure ? (
                                         <Lock className="h-3.5 w-3.5 text-primary" />
                                       ) : (
                                         <Unlock className="h-3.5 w-3.5" />
                                       )}
                                     </button>
                                   )}
                                 </div>
                                 <Select onValueChange={field.onChange} defaultValue={field.value}>
                                   <FormControl>
                                     <SelectTrigger className="h-10">
                                       <SelectValue placeholder="请选择" />
                                     </SelectTrigger>
                                   </FormControl>
                                   <SelectContent>
                                     {WIND_PRESSURES.map((w) => (
                                       <SelectItem key={w.value} value={w.value}>
                                         {w.label}
                                       </SelectItem>
                                     ))}
                                   </SelectContent>
                                 </Select>
                                 <FormMessage />
                               </FormItem>
                             )}
                           />
                           <FormField
                             control={form.control}
                             name="snowPressure"
                             render={({ field }) => (
                               <FormItem>
                                 <div className="flex items-center justify-between">
                                   <FormLabel className="pres-label text-xs font-medium text-muted-foreground">
                                     基本雪压
                                   </FormLabel>
                                   {onToggleLock && (
                                     <button
                                       type="button"
                                       onClick={() => onToggleLock('snowPressure')}
                                       className="text-muted-foreground transition-colors hover:text-primary"
                                       title={lockedParams.snowPressure ? '取消锁定' : '锁定此参数'}
                                     >
                                       {lockedParams.snowPressure ? (
                                         <Lock className="h-3.5 w-3.5 text-primary" />
                                       ) : (
                                         <Unlock className="h-3.5 w-3.5" />
                                       )}
                                     </button>
                                   )}
                                 </div>
                                 <Select onValueChange={field.onChange} defaultValue={field.value}>
                                   <FormControl>
                                     <SelectTrigger className="h-10">
                                       <SelectValue placeholder="请选择" />
                                     </SelectTrigger>
                                   </FormControl>
                                   <SelectContent>
                                     {SNOW_PRESSURES.map((s) => (
                                       <SelectItem key={s.value} value={s.value}>
                                         {s.label}
                                       </SelectItem>
                                     ))}
                                   </SelectContent>
                                 </Select>
                                 <FormMessage />
                               </FormItem>
                             )}
                           />
                         </div>
                         {/* Row: 设防类别 */}
                         <FormField
                           control={form.control}
                           name="fortificationCategory"
                           render={({ field }) => (
                             <FormItem>
                               <div className="flex items-center justify-between">
                                 <FormLabel className="pres-label text-xs font-medium text-muted-foreground">
                                   抗震设防类别
                                 </FormLabel>
                                 {onToggleLock && (
                                   <button
                                     type="button"
                                     onClick={() => onToggleLock('fortificationCategory')}
                                     className="text-muted-foreground transition-colors hover:text-primary"
                                     title={lockedParams.fortificationCategory ? '取消锁定' : '锁定此参数'}
                                   >
                                     {lockedParams.fortificationCategory ? (
                                       <Lock className="h-3.5 w-3.5 text-primary" />
                                     ) : (
                                       <Unlock className="h-3.5 w-3.5" />
                                     )}
                                   </button>
                                 )}
                               </div>
                               <Select onValueChange={field.onChange} defaultValue={field.value}>
                                 <FormControl>
                                   <SelectTrigger className="h-10">
                                     <SelectValue placeholder="请选择" />
                                   </SelectTrigger>
                                 </FormControl>
                                 <SelectContent>
                                   {FORTIFICATION_CATEGORIES.map((c) => (
                                     <SelectItem key={c.value} value={c.value}>
                                       {c.label}
                                     </SelectItem>
                                   ))}
                                 </SelectContent>
                               </Select>
                               <p className="text-[11px] text-muted-foreground">
                                 重点/特殊设防类将提高抗震措施等级
                               </p>
                               <FormMessage />
                             </FormItem>
                           )}
                         />
                       </div>
                     )}
                   </div>

                   {/* API Config Bar */}
                  <div
                    className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
                      hasApiKey
                        ? 'border-success/40 bg-success/5'
                        : 'border-warning/40 bg-warning/5'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {hasApiKey ? (
                        <Shield className="size-5 text-success" />
                      ) : (
                        <AlertTriangle className="size-5 text-warning" />
                      )}
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          大模型推理能力{hasApiKey ? ' 已激活' : ' 未配置'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {hasApiKey
                            ? '方案生成与智能问答将调用您配置的大模型 API'
                            : '未配置时使用内置插件能力，建议配置以获得更专业的回答'}
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant={hasApiKey ? 'outline' : 'secondary'}
                      size="sm"
                      onClick={() => setApiModalOpen(true)}
                      className="gap-1.5"
                    >
                      <Key className="h-3.5 w-3.5" />
                      {hasApiKey ? '管理配置' : '配置 API 密钥'}
                    </Button>
                  </div>

                  {/* === 权重配置 === */}
                  <div className="flex items-center gap-2 mt-2 mb-2">
                    <div className="h-px flex-1 bg-gradient-to-r from-teal/40 to-transparent" />
                    <span className="font-mono text-[10px] font-bold tracking-wider text-teal whitespace-nowrap">
                      § 03 · 优化目标权重
                    </span>
                    <div className="h-px flex-1 bg-gradient-to-l from-teal/40 to-transparent" />
                  </div>

                  {/* Weight Section */}
                  <div className="rounded-lg border border-border/50 bg-background/30 p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary">
                          <Gauge className="size-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-foreground">
                            优化目标权重设置
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            调整各维度权重，影响综合推荐结果
                          </p>
                        </div>
                        <Badge
                          variant={weightsValid ? 'default' : 'destructive'}
                          className="ml-2 text-[10px]"
                        >
                          {totalWeight}%
                          {weightsValid ? ' ✓ 平衡' : ' 失衡'}
                        </Badge>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleResetWeights}
                        className="gap-1 text-xs"
                      >
                        <RotateCcw className="size-3" />
                        重置
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                      {WEIGHT_ITEMS.map((item) => {
                        const Icon = item.icon;
                        const value = weights[item.key];
                        return (
                          <div
                            key={item.key}
                            className="rounded-md border border-border/40 bg-card/60 p-3"
                          >
                            <div className="mb-2 flex items-center gap-2">
                              <div
                                className={`flex size-7 items-center justify-center rounded bg-gradient-to-br ${item.color} text-white`}
                              >
                                <Icon className="h-3.5 w-3.5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="truncate text-xs font-semibold text-foreground">
                                  {item.label}
                                </div>
                                <div className="truncate text-[10px] text-muted-foreground">
                                  {item.description}
                                </div>
                              </div>
                              <div className="flex items-center gap-0.5">
                                <input
                                  type="number"
                                  value={value}
                                  onChange={(e) =>
                                    handleWeightChange(item.key, Number(e.target.value))
                                  }
                                  className="h-6 w-11 rounded border border-input bg-background px-1 text-right text-xs font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                                  min={0}
                                  max={100}
                                  step={5}
                                />
                                <span className="text-[10px] text-muted-foreground">%</span>
                              </div>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              step={5}
                              value={value}
                              onChange={(e) =>
                                handleWeightChange(item.key, Number(e.target.value))
                              }
                              className="w-full accent-primary"
                            />
                          </div>
                        );
                      })}
                    </div>

                    {!weightsValid && (
                      <p className="mt-3 text-xs text-destructive">
                        四维权重之和必须为 100%，当前为 {totalWeight}%。请调整各维度权重。
                      </p>
                    )}
                  </div>

                   {/* Locked params note */}
                  {Object.values(lockedParams).some(Boolean) && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                      <Lock className="h-3.5 w-3.5 text-primary" />
                      <span className="text-xs text-foreground">
                        已锁定：
                        {Object.entries(lockedParams)
                          .filter(([, v]) => v)
                          .map(([k]) => {
                            const labelMap: Record<string, string> = {
                              buildingType: '建筑类型',
                              floors: '层数',
                              area: '面积',
                              structurePreference: '结构体系',
                              seismicIntensity: '设防烈度',
                              soilCategory: '场地土类别',
                              mainSpan: '主要跨度',
                              budget: '预算约束',
                              geologyType: '场地地质',
                            };
                            return labelMap[k] || k;
                          })
                          .join('、')}
                        <span className="text-muted-foreground"> — 自主优化时不改动这些参数</span>
                      </span>
                    </div>
                  )}

                  {/* Submit */}
                  <div className="flex flex-col items-center gap-2 pt-2">
                    <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                        <Button
                          type="submit"
                          size="lg"
                          disabled={isGenerating || !weightsValid || disabled}
                          className="btn-thick btn-thick-active h-12 min-w-[320px] gap-2 text-base font-semibold"
                        >
                          <Sparkles className="size-5" />
                          {isGenerating ? '方案生成中...' : disabled ? '播放中...' : '启动智能方案生成'}
                        </Button>
                    </motion.div>
                    {!weightsValid && !isGenerating && (
                      <p className="text-xs text-destructive">
                        请完整填写所有必填项后再生成
                      </p>
                    )}
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>

          {/* Right: Side info (4 cols) */}
          <div className="space-y-6 lg:col-span-4">
            {/* Quick info card - blueprint style */}
            <Card className="corner-marks-full border-border/60 bg-card/85 shadow-sm blueprint-card overflow-visible">
              <span className="corner-tl" />
              <span className="corner-tr" />
              <span className="corner-bl" />
              <span className="corner-br" />
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-bold">
                  <Landmark className="size-4 text-teal" strokeWidth={1.75} />
                  参数摘要
                </CardTitle>
                <CardDescription className="font-mono text-[10px] tracking-wider text-muted-foreground">INPUT SUMMARY · 实时计算</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <InfoRow icon={Building2} label="建筑类型" value={form.watch('buildingType') === 'residential' ? '住宅建筑' : form.watch('buildingType') === 'office' ? '办公建筑' : form.watch('buildingType') === 'school' ? '教学建筑' : form.watch('buildingType') === 'factory' ? '工业厂房' : '大跨度建筑'} />
                <InfoRow
                  icon={Layers}
                  label="层数 / 面积"
                  value={`${form.watch('floors')} 层 / ${Number(form.watch('area')).toLocaleString()} ㎡`}
                  mono
                />
                <InfoRow icon={Ruler} label="主要跨度" value={`${form.watch('mainSpan')} m`} mono />
                <InfoRow
                  icon={Landmark}
                  label="设防烈度"
                  value={`${form.watch('seismicIntensity')} 度`}
                />
                <InfoRow icon={Mountain} label="场地土类" value={form.watch('soilCategory') + ' 类'} />
                <InfoRow
                  icon={Wallet}
                  label="单方造价"
                  value={`${Number(form.watch('budget')).toLocaleString()} 元/㎡`}
                  mono
                />
                <InfoRow
                  icon={Globe}
                  label="场地地质"
                  value={
                    GEOLOGY_TYPES.find((g) => g.value === form.watch('geologyType'))?.label ?? ''
                  }
                />
              </CardContent>
            </Card>

            {/* Tips card - blueprint style */}
            <Card className="border-amber/30 bg-amber/[0.06] blueprint-card">
              <CardContent className="pt-5">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber" strokeWidth={1.75} />
                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    <div className="font-medium text-foreground">输入说明</div>
                    <p>
                      1. 层数为地上层数，不含地下室；
                      <br />
                      2. 面积为地上总建筑面积；
                      <br />
                      3. 本工具输出结果仅供方案阶段比选参考，正式设计需经专业结构计算软件复核。
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Expert intervention card - Human-in-the-Loop */}
            <Card className="border-teal/30 bg-teal/[0.05] blueprint-card">
              <CardContent className="pt-5">
                <div className="flex items-start gap-3">
                  <Shield className="mt-0.5 size-4 shrink-0 text-teal" strokeWidth={1.75} />
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold">
                        专家干预{' '}
                        <span className="font-mono text-[10px] tracking-wider text-muted-foreground">
                          HUMAN-IN-THE-LOOP
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setHitlOpen((v) => !v)}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {hitlOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      工程师在环：锁定方案 / 预算上限 / 备注，Agent 必须遵守
                    </p>
                    {hitlOpen && (
                      <div className="space-y-3 pt-1">
                        <div className="space-y-1">
                          <label className="text-[11px] text-muted-foreground">
                            预算上限（万元）— 超出将标记风险并如实反映
                          </label>
                          <Input
                            type="number"
                            min={0}
                            placeholder="如 8000"
                            value={budgetCapInput}
                            onChange={(e) => setBudgetCapInput(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] text-muted-foreground">
                            锁定方案（AI 不得替换）
                          </label>
                          {latestSchemes && latestSchemes.length > 0 ? (
                            <div className="space-y-1.5">
                              {latestSchemes.map((sc) => (
                                <label
                                  key={sc.id}
                                  className="flex cursor-pointer items-center gap-2 text-xs text-foreground/90"
                                >
                                  <input
                                    type="checkbox"
                                    checked={lockedIds.includes(sc.id)}
                                    onChange={() => toggleLock(sc.id)}
                                    className="accent-teal"
                                  />
                                  <span>{sc.name}</span>
                                </label>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[11px] text-muted-foreground">
                              先生成方案后，可在此锁定候选方案
                            </p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] text-muted-foreground">
                            备注（注入 Agent 的思考过程）
                          </label>
                          <textarea
                            rows={2}
                            placeholder="如：优先考虑装配式施工"
                            value={notesInput}
                            onChange={(e) => setNotesInput(e.target.value)}
                            className="w-full rounded-md border border-border/60 bg-background/60 px-3 py-2 text-xs outline-none transition-colors focus:border-teal/50"
                          />
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="w-full"
                          disabled={isGenerating || disabled}
                          onClick={handleApplyIntervention}
                        >
                          <Zap className="size-3.5" />
                          应用干预并重跑
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <ApiKeyModal
        open={apiModalOpen}
        onOpenChange={(v) => {
          setApiModalOpen(v);
          if (!v) {
            try {
              setHasApiKey(!!getLlmConfig()?.apiKey);
            } catch {
              /* ignore */
            }
          }
        }}
      />
      <Toaster richColors closeButton position="top-right" />
    </section>
  );
}

interface InfoRowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  mono?: boolean;
}

function InfoRow({ icon: Icon, label, value, mono }: InfoRowProps) {
  return (
    <div className="flex items-center justify-between border-b border-border/30 pb-2 last:border-0 last:pb-0">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-primary/70" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <span className={`text-xs font-semibold text-foreground ${mono ? 'font-mono tabular-nums' : ''}`}>
        {value}
      </span>
    </div>
  );
}

export default memo(ParamsSection);
