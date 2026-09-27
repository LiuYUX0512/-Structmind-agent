// DagMovieMode — DAG 电影模式（P0-2 核心）
// 15 秒全屏高光动画：节点亮起 → 规范回退 → 记忆注入 → 元认知反思
// 评审要点：同步字幕 + 顶部进度条 + 章节指示 + 跳过按钮 + 键盘导航 + 焦点环
// EXPORTS: DagMovieMode

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, SkipForward } from 'lucide-react';

interface DagMovieModeProps {
  open: boolean;
  onClose: () => void;
}

interface IScene {
  index: number;
  from: number;
  to: number;
  title: string;
  caption: string;
}

const TOTAL = 15;
const SCENES: IScene[] = [
  { index: 1, from: 0, to: 3, title: '协同开始', caption: '四个 Agent 开始协同，方案创作到总工评审流水接力' },
  { index: 2, from: 3, to: 7, title: '规范回退', caption: '规范校核发现违规，红色弧线打回 Architect 重新选型' },
  { index: 3, from: 7, to: 11, title: '记忆注入', caption: '命中历史教训，自动插入抗震预校核节点' },
  { index: 4, from: 11, to: 15, title: '元认知反思', caption: '总工反思执行轨迹，把教训写回经验库' },
];

const AGENTS = [
  { key: 'architect', label: '方案创作', x: 100, color: '#12A5B5' },
  { key: 'code', label: '规范校核', x: 300, color: '#E8930C' },
  { key: 'economist', label: '经济评估', x: 500, color: '#34d399' },
  { key: 'chief', label: '总工仲裁', x: 700, color: '#E8930C' },
];

function MovieScene({ scene }: { scene: number }) {
  return (
    <svg viewBox="0 0 800 300" className="h-full max-h-[420px] w-full" role="img" aria-label="DAG 执行动画">
      {/* 泳道连线 */}
      {AGENTS.map((a, i) => (
        <line key={a.key} x1={a.x} y1={150} x2={AGENTS[Math.min(i + 1, 3)].x} y2={150} stroke="rgba(15,76,129,0.15)" strokeWidth={2} />
      ))}

      {/* 节点逐个亮起（镜头1） */}
      {AGENTS.map((a, i) => (
        <motion.g
          key={a.key}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: scene >= 1 ? 1 : 0, scale: 1 }}
          transition={{ delay: i * 0.35, duration: 0.4 }}
        >
          <circle cx={a.x} cy={150} r={30} fill={a.color} opacity={0.15} />
          <circle cx={a.x} cy={150} r={30} fill="none" stroke={a.color} strokeWidth={2} />
          <text x={a.x} y={146} textAnchor="middle" fontSize={16} fontWeight={700} fill="var(--foreground)">
            {['A1', 'A2', 'A3', 'A4'][i]}
          </text>
          <text x={a.x} y={198} textAnchor="middle" fontSize={12} fill="var(--muted-foreground)">
            {a.label}
          </text>
        </motion.g>
      ))}

      {/* 镜头2：Code 变红 + 回退弧线 */}
      <AnimatePresence>
        {scene >= 2 && (
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <circle cx={300} cy={150} r={34} fill="none" stroke="#EF4444" strokeWidth={3} />
            <path
              d="M 300 120 C 300 60, 100 60, 100 120"
              fill="none"
              stroke="#EF4444"
              strokeWidth={2.5}
              strokeDasharray="6 5"
            />
            <motion.g
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.2, ease: 'easeInOut' }}
            >
              <text x={200} y={52} textAnchor="middle" fontSize={13} fontWeight={700} fill="#EF4444">
                ⚠ 打回重算
              </text>
            </motion.g>
          </motion.g>
        )}
      </AnimatePresence>

      {/* 镜头3：记忆浮层飞入 */}
      <AnimatePresence>
        {scene >= 3 && (
          <motion.g
            initial={{ x: 80, y: -60, opacity: 0 }}
            animate={{ x: 0, y: 0, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          >
            <rect x={60} y={60} width={130} height={40} rx={8} fill="rgba(18,165,181,0.18)" stroke="#12A5B5" strokeWidth={1.5} />
            <text x={125} y={85} textAnchor="middle" fontSize={12} fontWeight={600} fill="#0e7c8a">
              🧠 记忆注入 · 预校核
            </text>
          </motion.g>
        )}
      </AnimatePresence>

      {/* 镜头4：金色反思卡弹出 */}
      <AnimatePresence>
        {scene >= 4 && (
          <motion.g
            initial={{ scale: 0.5, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          >
            <rect x={620} y={200} width={170} height={64} rx={10} fill="rgba(232,147,12,0.16)" stroke="#E8930C" strokeWidth={2} />
            <text x={705} y={225} textAnchor="middle" fontSize={13} fontWeight={700} fill="#b8780a">
              🔄 元认知反思
            </text>
            <text x={705} y={245} textAnchor="middle" fontSize={11} fill="#8a5a08">
              教训写回经验库
            </text>
          </motion.g>
        )}
      </AnimatePresence>
    </svg>
  );
}

function DagMovieMode({ open, onClose }: DagMovieModeProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 启动 / 重置
  useEffect(() => {
    if (!open) return;
    setCurrentTime(0);
    setPlaying(true);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [open]);

  // 时间推进
  useEffect(() => {
    if (!open) return;
    timerRef.current = setInterval(() => {
      setCurrentTime((t) => {
        if (!playing) return t;
        if (t >= TOTAL) {
          if (timerRef.current) clearInterval(timerRef.current);
          onClose();
          return t;
        }
        return t + 0.1;
      });
    }, 100);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [open, playing, onClose]);

  // 键盘导航：ESC 退出 / Space 播放暂停 / 左右方向键切段
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowRight') {
        setCurrentTime((t) => Math.min(TOTAL, t + 2));
      } else if (e.key === 'ArrowLeft') {
        setCurrentTime((t) => Math.max(0, t - 2));
      }
    },
    [onClose]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  if (!open) return null;

  const scene = SCENES.find((s) => currentTime >= s.from && currentTime < s.to) ?? SCENES[SCENES.length - 1];
  const progress = Math.min(100, (currentTime / TOTAL) * 100);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background/95 backdrop-blur-xl">
      {/* 顶部进度条（15 秒时间轴） */}
      <div className="h-1.5 w-full bg-muted/40">
        <motion.div
          className="h-full bg-teal"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.1, ease: 'linear' }}
        />
      </div>

      {/* 顶部：章节指示 + 播放/跳过 */}
      <div className="flex items-center justify-between px-8 py-4">
        <span className="text-caption font-mono text-muted-foreground">
          {scene.index}/4 · {scene.title}
        </span>
        <div className="flex items-center gap-element">
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="flex items-center gap-1.5 rounded-md border border-border/60 bg-card/60 px-3 py-1.5 text-xs text-foreground transition hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2"
            aria-label={playing ? '暂停' : '播放'}
          >
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {playing ? '暂停' : '播放'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-md border border-amber/50 bg-amber/10 px-3 py-1.5 text-xs text-amber transition hover:bg-amber/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2"
            aria-label="跳过演示"
          >
            <SkipForward className="size-3.5" />
            跳过
          </button>
        </div>
      </div>

      {/* 中央动画 */}
      <div className="flex flex-1 items-center justify-center px-8">
        <MovieScene scene={scene.index} />
      </div>

      {/* 底部字幕 */}
      <div className="pb-14 text-center">
        <AnimatePresence mode="wait">
          <motion.p
            key={scene.index}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4 }}
            className="text-title text-foreground"
          >
            {scene.caption}
          </motion.p>
        </AnimatePresence>
        <p className="mt-2 text-caption text-muted-foreground">
          提示：Space 播放/暂停 · ←→ 切换片段 · ESC 退出
        </p>
      </div>
    </div>
  );
}

export default memo(DagMovieMode);
