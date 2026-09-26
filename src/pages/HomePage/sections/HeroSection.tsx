import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ArrowDown, Sparkles, PenTool, Scale, RefreshCw, Award } from 'lucide-react';

interface HeroSectionProps {
  onStart: () => void;
}

function HeroSection({ onStart }: HeroSectionProps) {
  const features = [
    { icon: PenTool, label: '方案创作', desc: '多体系智能生成', accent: 'primary' },
    { icon: Scale, label: '规范校核', desc: 'GB 55002 · 50011', accent: 'teal' },
    { icon: RefreshCw, label: '优化迭代', desc: '七维比选寻优', accent: 'amber' },
  ];

  // 生成建筑楼层线 - 用于背景装饰
  const floorLines = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => 100 + i * 28);
  }, []);

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

                {/* SVG 等轴测建筑线框 - 带淡入动画 */}
                <div
                  className="relative aspect-square w-full overflow-hidden"
                  style={{ borderRadius: '4px' }}
                >
                  {/* 网格底 */}
                  <div className="absolute inset-0 bg-blueprint-grid opacity-40" />

                  <svg
                    viewBox="0 0 400 400"
                    className="h-full w-full"
                    preserveAspectRatio="xMidYMid meet"
                  >
                    <defs>
                      {/* 青色发光效果 */}
                      <filter id="glow-teal" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
                        <feMerge>
                          <feMergeNode in="coloredBlur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                      {/* 琥珀色发光 */}
                      <filter id="glow-amber" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                        <feMerge>
                          <feMergeNode in="coloredBlur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                      {/* 渐隐渐变 */}
                      <linearGradient id="fadeTop" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
                        <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
                      </linearGradient>
                    </defs>

                    {/* 地面网格 */}
                    <g opacity="0.35">
                      {Array.from({ length: 13 }, (_, i) => {
                        const x = 50 + i * 25;
                        return (
                          <line
                            key={`gx-${i}`}
                            x1={x}
                            y1="340"
                            x2={x + 100}
                            y2="280"
                            stroke="#1e4d7b"
                            strokeWidth="0.5"
                          />
                        );
                      })}
                      {Array.from({ length: 9 }, (_, i) => {
                        const y = 280 + i * 8;
                        const xoff = i * 12.5;
                        return (
                          <line
                            key={`gy-${i}`}
                            x1={50 - xoff}
                            y1={y}
                            x2={350 - xoff}
                            y2={y}
                            stroke="#1e4d7b"
                            strokeWidth="0.5"
                          />
                        );
                      })}
                    </g>

                    {/* 建筑主体：楼板（半透明填充） */}
                    <g style={{ color: '#1e4d7b' }}>
                      {floorLines.map((topY, floorIdx) => {
                        const floorNum = floorLines.length - floorIdx;
                        const y = topY;
                        const isBottomReinforce = floorIdx >= floorLines.length - 2;
                        const fillOpacity = isBottomReinforce ? 0.18 : 0.08;
                        const strokeColor = isBottomReinforce ? '#E8930C' : '#12A5B5';
                        const strokeWidth = isBottomReinforce ? 1.5 : 0.8;

                        return (
                          <g key={`floor-${floorIdx}`}>
                            {/* 楼板填充 */}
                            <polygon
                              points={`130,${y} 270,${y - 45} 320,${y - 15} 180,${y + 30}`}
                              fill={isBottomReinforce ? 'rgba(232, 147, 12, 0.12)' : 'rgba(15, 76, 129, 0.06)'}
                              stroke={strokeColor}
                              strokeWidth={strokeWidth}
                              opacity="0.9"
                              filter={isBottomReinforce ? 'url(#glow-amber)' : undefined}
                            />
                            {/* 楼板厚度侧线 */}
                            <line
                              x1="270"
                              y1={y - 45}
                              x2="270"
                              y2={y - 40}
                              stroke={strokeColor}
                              strokeWidth={strokeWidth}
                              opacity="0.6"
                            />
                            <line
                              x1="320"
                              y1={y - 15}
                              x2="320"
                              y2={y - 10}
                              stroke={strokeColor}
                              strokeWidth={strokeWidth}
                              opacity="0.6"
                            />
                          </g>
                        );
                      })}
                    </g>

                    {/* 柱子（矩形截面感）- 青色发光 */}
                    <g filter="url(#glow-teal)">
                      {/* 前左柱 */}
                      <line x1="130" y1="100" x2="130" y2="370" stroke="#12A5B5" strokeWidth="2.5" opacity="0.9" />
                      {/* 前右柱 */}
                      <line x1="270" y1="55" x2="270" y2="325" stroke="#12A5B5" strokeWidth="2.5" opacity="0.9" />
                      {/* 后左柱 */}
                      <line x1="180" y1="130" x2="180" y2="400" stroke="#12A5B5" strokeWidth="1.5" opacity="0.5" />
                      {/* 后右柱 */}
                      <line x1="320" y1="85" x2="320" y2="355" stroke="#12A5B5" strokeWidth="1.5" opacity="0.5" />
                    </g>

                    {/* 梁线 - 每层 */}
                    <g opacity="0.75">
                      {floorLines.map((y, floorIdx) => {
                        const isBottom = floorIdx >= floorLines.length - 2;
                        return (
                          <g key={`beam-${floorIdx}`}>
                            {/* 前梁 */}
                            <line
                              x1="130"
                              y1={y}
                              x2="270"
                              y2={y - 45}
                              stroke={isBottom ? '#E8930C' : '#12A5B5'}
                              strokeWidth={isBottom ? 1.5 : 1}
                              filter={isBottom ? 'url(#glow-amber)' : undefined}
                            />
                            {/* 右梁 */}
                            <line
                              x1="270"
                              y1={y - 45}
                              x2="320"
                              y2={y - 15}
                              stroke={isBottom ? '#E8930C' : '#12A5B5'}
                              strokeWidth={isBottom ? 1.5 : 1}
                              filter={isBottom ? 'url(#glow-amber)' : undefined}
                            />
                            {/* 后梁（淡） */}
                            <line x1="180" y1={y + 30} x2="320" y2={y - 15} stroke="#12A5B5" strokeWidth="0.7" opacity="0.5" />
                            {/* 左梁（淡） */}
                            <line x1="130" y1={y} x2="180" y2={y + 30} stroke="#12A5B5" strokeWidth="0.7" opacity="0.5" />
                          </g>
                        );
                      })}
                    </g>

                    {/* 楼层编号标注 */}
                    <g className="font-mono" fontSize="9" fill="#64748b">
                      {floorLines.slice(0, 6).map((y, i) => (
                        <text
                          key={`fl-${i}`}
                          x="95"
                          y={y + 3}
                          textAnchor="end"
                          fill="#94a3b8"
                          style={{ fontSize: '9px', fontFamily: 'monospace' }}
                        >
                          {floorLines.length - i}F
                        </text>
                      ))}
                    </g>

                    {/* 底部加强区标注 */}
                    <g>
                      <line
                        x1="110"
                        y1="385"
                        x2="130"
                        y2="372"
                        stroke="#E8930C"
                        strokeWidth="1"
                        strokeDasharray="3 2"
                        filter="url(#glow-amber)"
                      />
                      <text
                        x="70"
                        y="395"
                        fill="#E8930C"
                        style={{ fontSize: '9px', fontFamily: 'monospace', fontWeight: 'bold' }}
                        filter="url(#glow-amber)"
                      >
                        底部加强区
                      </text>
                    </g>

                    {/* 屋顶装饰线 */}
                    <g opacity="0.6">
                      <polygon
                        points="155,75 245,42 270,57 180,90"
                        fill="none"
                        stroke="#12A5B5"
                        strokeWidth="0.8"
                        strokeDasharray="4 3"
                      />
                    </g>

                    {/* 建筑高度标注线 */}
                    <g opacity="0.5">
                      <line x1="345" y1="60" x2="345" y2="350" stroke="#64748b" strokeWidth="0.8" strokeDasharray="2 2" />
                      <polygon points="342,60 348,60 345,55" fill="#64748b" />
                      <polygon points="342,350 348,350 345,355" fill="#64748b" />
                      <text
                        x="355"
                        y="210"
                        fill="#64748b"
                        style={{ fontSize: '9px', fontFamily: 'monospace', writingMode: 'vertical-rl' }}
                      >
                        H ≈ 90m
                      </text>
                    </g>
                  </svg>

                  {/* 图纸标签 */}
                  <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal" />
                      STRUCTURE · ISOMETRIC
                    </span>
                    <span className="text-teal/80">SCALE 1:100</span>
                  </div>
                </div>

                {/* 底部信息栏 */}
                <div className="mt-2 flex items-center justify-between border-t border-border/50 px-1 py-2">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-amber" />
                    <span className="font-mono text-[10px] font-semibold text-foreground">
                      STRUCTMIND AI
                    </span>
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    FRAME-SHEARWALL · 30F
                  </div>
                </div>
              </motion.div>

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
                    <div className="data-number text-sm font-bold text-foreground">8° 设防</div>
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
