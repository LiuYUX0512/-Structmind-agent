import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ArrowDown, Sparkles, PenTool, Scale, RefreshCw, Award } from 'lucide-react';
import StructureWireframe3D from '@/components/StructureWireframe3D';
import { MOCK_PROJECT_PARAMS, type IProjectParams, type IStructureScheme } from '@/data/structure';

interface HeroSectionProps {
  onStart: () => void;
  /** 当前工程参数（未输入时用默认示例） */
  params?: IProjectParams | null;
  /** 当前选中的结构方案（用于 3D 预览随方案变化） */
  scheme?: IStructureScheme | null;
}

function HeroSection({ onStart, params, scheme }: HeroSectionProps) {
  const features = [
    { icon: PenTool, label: '方案创作', desc: '多体系智能生成', accent: 'primary' },
    { icon: Scale, label: '规范校核', desc: 'GB 55002 · 50011', accent: 'teal' },
    { icon: RefreshCw, label: '优化迭代', desc: '七维比选寻优', accent: 'amber' },
  ];

  // 展示用参数：用户已输入则用真实值，否则用默认示例（让首屏 3D 是"活的"）
  const displayParams = params || MOCK_PROJECT_PARAMS;
  const structureLabel = scheme?.name
    ? (scheme.name.includes('框架-剪力') ? 'FRAME-SHEARWALL' :
       scheme.name.includes('剪力墙') ? 'SHEARWALL' :
       scheme.name.includes('框架') ? 'FRAME' :
       scheme.name.includes('钢') ? 'STEEL' :
       scheme.name.includes('装配') ? 'PRECAST' :
       'STRUCTURE')
    : 'FRAME-SHEARWALL';

  return (
    <section
      id="top"
      className="relative w-full overflow-hidden bg-blueprint-fade pt-16 pb-16 md:pt-28 md:pb-24"
    >
      {/* 蓝图网格底纹 - 更细腻更淡 */}
      <div className="pointer-events-none absolute inset-0 bg-blueprint-grid-lg opacity-[0.15]" />

      {/* 大型径向光效 */}
      <div className="pointer-events-none absolute -top-32 left-1/4 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-primary/6 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-0 right-1/4 h-80 w-80 rounded-full bg-teal/5 blur-[100px]" />

      {/* 左上角工程图纸角标 */}
      <div className="pointer-events-none absolute left-4 top-4 hidden md:block">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 border-l-2 border-t-2 border-primary/40" />
          <span className="font-mono text-[10px] tracking-[0.25em] text-muted-foreground/70">
            DRAWING · TITLE SHEET
          </span>
        </div>
      </div>

      {/* 右上角工程图纸角标 */}
      <div className="pointer-events-none absolute right-4 top-4 hidden md:block">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-[0.25em] text-muted-foreground/70">
            SHEET 001 · REV. 2.0
          </span>
          <div className="h-3 w-3 border-r-2 border-t-2 border-primary/40" />
        </div>
      </div>

      {/* 左下角角标 */}
      <div className="pointer-events-none absolute bottom-4 left-4 hidden md:block">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 border-l-2 border-b-2 border-primary/40" />
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground/60">
            SCALE · NTS
          </span>
        </div>
      </div>

      {/* 右下角角标 */}
      <div className="pointer-events-none absolute bottom-4 right-4 hidden md:block">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground/60">
            智构 StructMind™
          </span>
          <div className="h-3 w-3 border-r-2 border-b-2 border-primary/40" />
        </div>
      </div>

      <div className="relative mx-auto max-w-[1600px] px-6">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-10">
          {/* 左侧：文字内容 */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col justify-center lg:col-span-7"
          >
            {/* 图号编号标签 */}
            <div className="mb-6 flex items-center gap-3">
              <span className="section-number text-sm font-semibold">DWG · SM-001</span>
              <span className="h-px w-16 bg-border" />
              <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
                DIGITAL ENGINEERING BLUEPRINT
              </span>
            </div>

            {/* 主标题 - 超大号 */}
            <div className="mb-2">
              <h1 className="text-[44px] font-black leading-[1.05] tracking-tight text-foreground sm:text-6xl md:text-7xl lg:text-[80px]">
                <span className="block text-sm font-bold tracking-[0.35em] text-teal md:text-base mb-4">
                  STRUCTURAL INTELLIGENCE
                </span>
                智构{' '}
                <span className="bg-gradient-to-r from-primary via-primary to-teal bg-clip-text text-transparent">
                  StructMind
                </span>
              </h1>
            </div>

            {/* Slogan */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.6 }}
              className="mb-5 flex items-center gap-3"
            >
              <div className="h-px flex-1 max-w-[40px] bg-amber/60" />
              <span className="text-base font-medium tracking-wide text-amber md:text-lg">
                为人民建好房 · 为工友谋幸福
              </span>
              <div className="h-px flex-1 max-w-[40px] bg-amber/60" />
            </motion.div>

            {/* 副标题 */}
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.6 }}
              className="mb-8 max-w-xl text-lg leading-relaxed text-foreground/70"
            >
              多 Agent 协同 · 结构方案智能优化工作台
              <br />
              <span className="text-foreground/50">
                基于土木工程专业知识库，让结构方案决策更科学、更高效
              </span>
            </motion.p>

            {/* 三个功能标签卡片 */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.6 }}
              className="mb-10 grid grid-cols-3 gap-3"
            >
              {features.map((f, i) => {
                const Icon = f.icon;
                const colorClass = {
                  primary: 'text-primary bg-primary/10 border-primary/30',
                  teal: 'text-teal bg-teal/10 border-teal/30',
                  amber: 'text-amber bg-amber/10 border-amber/30',
                }[f.accent as keyof typeof colorClass];

                return (
                  <motion.div
                    key={f.label}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.6 + i * 0.1 }}
                    whileHover={{ y: -3, transition: { duration: 0.2 } }}
                    className={`corner-marks relative flex flex-col items-start gap-2 border bg-card/70 p-4 backdrop-blur-sm blueprint-card`}
                    style={{ borderRadius: '6px' }}
                  >
                    <div className={`flex size-10 items-center justify-center ${colorClass} border`} style={{ borderRadius: '4px' }}>
                      <Icon className="size-5" strokeWidth={1.75} />
                    </div>
                    <div className="text-sm font-bold text-foreground">{f.label}</div>
                    <div className="font-mono text-[10px] leading-tight text-muted-foreground tracking-wide">
                      {f.desc}
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>

            {/* CTA 按钮 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.9, duration: 0.6 }}
              className="flex flex-wrap items-center gap-4"
            >
              <button
                onClick={onStart}
                className="group relative flex items-center gap-2 overflow-hidden bg-primary px-7 py-3.5 text-base font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all duration-300 hover:shadow-xl hover:shadow-primary/35 hover:-translate-y-0.5 active:translate-y-0"
                style={{ borderRadius: '4px' }}
              >
                <span className="relative z-10">开始方案比选</span>
                <ArrowDown className="relative z-10 size-5 transition-transform group-hover:translate-y-0.5" />
                {/* 光泽扫过 */}
                <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              </button>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs font-bold text-primary">01</span>
                  <span className="text-xs text-muted-foreground">参数</span>
                </div>
                <div className="h-px w-6 bg-border" />
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs font-bold text-teal">02</span>
                  <span className="text-xs text-muted-foreground">方案</span>
                </div>
                <div className="h-px w-6 bg-border" />
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs font-bold text-amber">03</span>
                  <span className="text-xs text-muted-foreground">对比</span>
                </div>
                <div className="h-px w-6 bg-border" />
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs font-bold text-muted-foreground/60">04</span>
                  <span className="text-xs text-muted-foreground">问答</span>
                </div>
              </div>
            </motion.div>

            {/* 底部参赛信息 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.1, duration: 0.6 }}
              className="mt-10 flex items-center gap-3"
            >
              <div className="flex size-8 items-center justify-center border border-amber/40 bg-amber/10" style={{ borderRadius: '3px' }}>
                <Award className="size-4 text-amber" strokeWidth={1.75} />
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">
                  第一届「海之子杯」AI 智能体挑战赛
                </div>
                <div className="font-mono text-[10px] tracking-wider text-muted-foreground">
                  智能设计与方案优化赛道 · 参赛作品
                </div>
              </div>
            </motion.div>
          </motion.div>

          {/* 右侧：动态等轴测线框建筑 */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 1, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex items-center justify-center lg:col-span-5"
          >
            <div className="relative mx-auto w-full max-w-[460px]">
              {/* 光晕背景 */}
              <div className="absolute inset-0 -z-10 scale-110 rounded-full bg-gradient-to-br from-primary/10 via-teal/5 to-transparent blur-3xl" />

              {/* 图纸卡片 */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.4, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                className="corner-marks-full relative overflow-hidden border border-primary/20 bg-card/60 p-2 shadow-xl shadow-primary/5 backdrop-blur-sm"
                style={{ borderRadius: '8px' }}
              >
                <span className="corner-tl" />
                <span className="corner-tr" />
                <span className="corner-bl" />
                <span className="corner-br" />

                {/* 动态等轴测建筑线框 - 可拖拽旋转/滚轮缩放，随参数与方案实时变化 */}
                <div
                  className="relative aspect-square w-full overflow-hidden"
                  style={{ borderRadius: '4px' }}
                >
                  <StructureWireframe3D params={displayParams} scheme={scheme} />
                </div>

                {/* 图纸标签 */}
                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal" />
                    STRUCTURE · ISOMETRIC
                  </span>
                  <span className="text-teal/80">SCALE 1:100</span>
                </div>
              </motion.div>

              {/* 底部信息栏 */}
              <div className="mt-2 flex items-center justify-between border-t border-border/50 px-1 py-2">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-amber" />
                  <span className="font-mono text-[10px] font-semibold text-foreground">
                    STRUCTMIND AI
                  </span>
                </div>
                <div className="font-mono text-[10px] text-muted-foreground">
                  {structureLabel} · {displayParams.floors}F
                </div>
              </div>

            {/* 浮动小卡 - 抗震等级 */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1, duration: 0.5 }}
              className="absolute -top-2 -right-2 border border-teal/30 bg-card/90 p-2.5 shadow-lg backdrop-blur-md"
              style={{ borderRadius: '4px' }}
            >
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center bg-teal/15 text-teal" style={{ borderRadius: '2px' }}>
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </svg>
                </div>
                <div>
                  <div className="font-mono text-[9px] tracking-wider text-muted-foreground">SEISMIC</div>
                  <div className="data-number text-sm font-bold text-foreground">{displayParams.seismicIntensity}° 设防</div>
                </div>
              </div>
            </motion.div>

            {/* 浮动小卡 - 方案数量 */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.2, duration: 0.5 }}
              className="absolute -bottom-2 -left-2 border border-amber/40 bg-card/90 p-2.5 shadow-lg backdrop-blur-md"
              style={{ borderRadius: '4px' }}
            >
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center bg-amber/15 text-amber" style={{ borderRadius: '2px' }}>
                  <Award className="h-3.5 w-3.5" strokeWidth={1.75} />
                </div>
                <div>
                  <div className="font-mono text-[9px] tracking-wider text-muted-foreground">3 SCHEMES</div>
                  <div className="data-number text-sm font-bold text-foreground">智能比选</div>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>
        </div>
      </div>
    </section>
  );
}

export default memo(HeroSection);
