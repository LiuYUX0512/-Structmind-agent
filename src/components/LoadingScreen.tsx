import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Building2, Cpu, Layers, ShieldCheck, Zap } from 'lucide-react';

interface LoadingScreenProps {
  onComplete: () => void;
  minDuration?: number;
}

export default function LoadingScreen({ onComplete, minDuration = 1800 }: LoadingScreenProps) {
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('初始化结构计算引擎...');
  const [phase, setPhase] = useState(0);

  // 用 ref 保存 onComplete，避免父组件重渲染导致 effect 重跑、进度被重置
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const phases = [
    { text: '初始化结构计算引擎...', icon: Cpu },
    { text: '加载建筑规范数据库...', icon: Building2 },
    { text: '校准抗震分析模型...', icon: ShieldCheck },
    { text: '装配智能优化算法...', icon: Layers },
    { text: '准备就绪', icon: Zap },
  ];

  useEffect(() => {
    const startTime = Date.now();
    let rafId: number;
    let timeoutId: number | null = null;

    const tick = () => {
      const elapsed = Date.now() - startTime;
      const p = Math.min((elapsed / minDuration) * 100, 100);
      setProgress(p);

      const phaseIndex = Math.min(
        Math.floor((p / 100) * phases.length),
        phases.length - 1
      );
      setPhase(phaseIndex);
      setStatusText(phases[phaseIndex].text);

      if (p < 100) {
        rafId = requestAnimationFrame(tick);
      } else {
        timeoutId = window.setTimeout(() => onCompleteRef.current?.(), 200);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [minDuration]);

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease: 'easeInOut' }}
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-gradient-to-br from-[#0a1628] via-[#0d1f35] to-[#0a1628]"
    >
      {/* Blueprint grid background */}
      <div className="absolute inset-0 opacity-[0.08]">
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
           <defs>
             <pattern id="blueprintGrid" width="40" height="40" patternUnits="userSpaceOnUse">
               <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#2DD4BF" strokeWidth="0.5" />
             </pattern>
             <pattern id="blueprintGridMajor" width="200" height="200" patternUnits="userSpaceOnUse">
               <path d="M 200 0 L 0 0 0 200" fill="none" stroke="#2DD4BF" strokeWidth="1" />
             </pattern>
           </defs>
          <rect width="100%" height="100%" fill="url(#blueprintGrid)" />
          <rect width="100%" height="100%" fill="url(#blueprintGridMajor)" />
        </svg>
      </div>

      {/* Radial glow */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="h-[600px] w-[600px] rounded-full bg-primary/20 blur-[120px]" />
      </div>

      {/* Floating structural lines */}
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        <svg className="h-full w-full" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
          <defs>
             <linearGradient id="lineGrad1" x1="0%" y1="0%" x2="100%" y2="0%">
               <stop offset="0%" stopColor="transparent" />
               <stop offset="50%" stopColor="#2DD4BF" stopOpacity="0.5" />
               <stop offset="100%" stopColor="transparent" />
             </linearGradient>
             <linearGradient id="lineGrad2" x1="0%" y1="0%" x2="0%" y2="100%">
               <stop offset="0%" stopColor="transparent" />
               <stop offset="50%" stopColor="#5EEAD4" stopOpacity="0.35" />
               <stop offset="100%" stopColor="transparent" />
             </linearGradient>
          </defs>
          {/* Horizontal scanning lines */}
          {[...Array(6)].map((_, i) => (
            <motion.line
              key={`h-${i}`}
              x1="0"
              y1={100 + i * 120}
              x2="1200"
              y2={100 + i * 120}
              stroke="url(#lineGrad1)"
              strokeWidth="1"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: [0, 0.6, 0] }}
              transition={{
                pathLength: { duration: 2, delay: i * 0.15, ease: 'easeInOut' },
                opacity: { duration: 2, delay: i * 0.15, ease: 'easeInOut' },
                repeat: Infinity,
                repeatDelay: 0.5,
              }}
            />
          ))}
          {/* Vertical structure lines */}
          {[...Array(8)].map((_, i) => (
            <motion.line
              key={`v-${i}`}
              x1={100 + i * 140}
              y1="0"
              x2={100 + i * 140}
              y2="800"
              stroke="url(#lineGrad2)"
              strokeWidth="0.5"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: [0, 0.4, 0] }}
              transition={{
                pathLength: { duration: 2.5, delay: i * 0.1 + 0.3, ease: 'easeInOut' },
                opacity: { duration: 2.5, delay: i * 0.1 + 0.3, ease: 'easeInOut' },
                repeat: Infinity,
                repeatDelay: 0.8,
              }}
            />
          ))}
          {/* Structural nodes */}
          {[...Array(12)].map((_, i) => (
            <motion.circle
              key={`node-${i}`}
              cx={120 + (i % 6) * 180}
              cy={180 + Math.floor(i / 6) * 440}
              r="3"
               fill="#2DD4BF"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: [0, 1.5, 1], opacity: [0, 1, 0.6] }}
              transition={{
                duration: 1.5,
                delay: 0.2 + i * 0.1,
                repeat: Infinity,
                repeatType: 'reverse',
                repeatDelay: 1,
              }}
            />
          ))}
        </svg>
      </motion.div>

      {/* Center content */}
      <div className="relative z-10 flex flex-col items-center gap-10 px-6">
        {/* Logo / Icon */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
        >
          {/* Outer ring */}
          <motion.div
            className="absolute inset-0 rounded-full border border-primary/30"
            animate={{ scale: [1, 1.3, 1], opacity: [0.6, 0, 0.6] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute inset-0 rounded-full border border-primary/20"
            animate={{ scale: [1, 1.5, 1], opacity: [0.4, 0, 0.4] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
          />
          {/* Icon container */}
          <div className="relative flex size-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 backdrop-blur-sm ring-1 ring-primary/40">
            <Building2 className="size-10 text-primary" strokeWidth={1.5} />
            {/* Corner decorations */}
            <div className="absolute -left-0.5 -top-0.5 h-3 w-3 border-l-2 border-t-2 border-primary" />
            <div className="absolute -right-0.5 -top-0.5 h-3 w-3 border-r-2 border-t-2 border-primary" />
            <div className="absolute -bottom-0.5 -left-0.5 h-3 w-3 border-b-2 border-l-2 border-primary" />
            <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 border-b-2 border-r-2 border-primary" />
          </div>
        </motion.div>

        {/* Title */}
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="text-center"
        >
           <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">
              智构 <span className="text-primary">StructMind</span>
            </h1>
           <p className="mt-2 text-xs tracking-widest text-cyan-200/60">
              INTELLIGENT STRUCTURAL SCHEME OPTIMIZATION
            </p>
           <div className="mt-2 flex items-center justify-center gap-3 font-mono text-[10px] text-cyan-300/50">
              <span>DWG·SC-001</span>
              <span className="h-1 w-1 rounded-full bg-primary/50" />
              <span>REV·2.0</span>
              <span className="h-1 w-1 rounded-full bg-primary/50" />
              <span>GB 55002/55008</span>
           </div>
           <div className="mt-2 flex items-center justify-center gap-3 text-[10px] text-cyan-300/50">
             <span>多权重点位</span>
             <span className="h-1 w-1 rounded-full bg-primary/50" />
             <span>规范校验</span>
             <span className="h-1 w-1 rounded-full bg-primary/50" />
             <span>智能比选</span>
           </div>
        </motion.div>

        {/* Progress bar */}
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="w-[320px] space-y-3"
        >
          {/* Bar track */}
          <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-white/10">
            <motion.div
              className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-primary via-cyan-300 to-primary"
              style={{ width: `${progress}%` }}
              transition={{ duration: 0.05 }}
            />
            {/* Glow effect */}
            <motion.div
              className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-primary/50 blur-md"
              style={{ left: `calc(${progress}% - 8px)` }}
              transition={{ duration: 0.05 }}
            />
          </div>

          {/* Status text + percentage */}
          <div className="flex items-center justify-between text-xs">
             <div className="flex items-center gap-2 text-cyan-200/80">
              <AnimatePresence mode="wait">
                <motion.span
                  key={phase}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.25 }}
                  className="font-mono tracking-wide"
                >
                  {statusText}
                </motion.span>
              </AnimatePresence>
            </div>
            <span className="font-mono text-xs font-medium text-primary tabular-nums">
              {Math.round(progress)}%
            </span>
          </div>
        </motion.div>

        {/* Phase indicators */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="flex items-center gap-2"
        >
          {phases.map((p, i) => {
            const Icon = p.icon;
            const isActive = i === phase;
            const isDone = i < phase;
            return (
              <motion.div
                key={i}
                className={`flex size-8 items-center justify-center rounded-lg border transition-all ${
                  isDone
                    ? 'border-primary/60 bg-primary/20 text-primary'
                    : isActive
                      ? 'border-primary bg-primary/30 text-primary shadow-lg shadow-primary/30'
                      : 'border-white/10 bg-white/5 text-white/30'
                }`}
                animate={
                  isActive
                    ? { scale: [1, 1.05, 1] }
                    : {}
                }
                transition={{ duration: 0.6, repeat: isActive ? Infinity : 0 }}
              >
                <Icon className="size-4" strokeWidth={isActive ? 2.5 : 2} />
              </motion.div>
            );
          })}
        </motion.div>

        {/* Bottom tagline */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 1 }}
           className="text-[11px] tracking-[0.25em] text-cyan-300/40 uppercase"
        >
          为人民建好房 · 为工友谋幸福
        </motion.p>
      </div>
    </motion.div>
  );
}
