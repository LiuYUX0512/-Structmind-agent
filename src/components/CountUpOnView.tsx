import { memo, useEffect, useRef, useState } from 'react';

/**
 * CountUpOnView — 滚动进入视口后从 0 快速跳动到目标值（自研，零依赖）
 * 用 IntersectionObserver 触发 + requestAnimationFrame 缓动（easeOutCubic）
 * 替代 react-countup，避免新增依赖破坏纯前端构建
 */
interface CountUpOnViewProps {
  /** 目标数值 */
  value: number;
  /** 跳动时长（ms） */
  duration?: number;
  /** 前缀，如 "12+" 里的 "+" 应放 suffix，前缀如 "¥" */
  prefix?: string;
  /** 后缀，如 "+"、"%" */
  suffix?: string;
  /** 小数位 */
  decimals?: number;
  className?: string;
}

function CountUpOnView({ value, duration = 1200, prefix = '', suffix = '', decimals = 0, className }: CountUpOnViewProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setDisplay(value);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !started.current) {
          started.current = true;
          const t0 = performance.now();
          const tick = (now: number) => {
            const p = Math.min((now - t0) / duration, 1);
            // easeOutCubic
            const eased = 1 - Math.pow(1 - p, 3);
            setDisplay(Math.round(value * eased * Math.pow(10, decimals)) / Math.pow(10, decimals));
            if (p < 1) requestAnimationFrame(tick);
            else setDisplay(value);
          };
          requestAnimationFrame(tick);
          io.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [value, duration, decimals]);

  const formatted = display.toFixed(decimals);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}

export default memo(CountUpOnView);
