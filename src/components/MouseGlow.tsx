// MouseGlow — 全站鼠标跟随光晕（聚光灯效果）
// 青色→透明 300px 径向渐变，pointer-events:none + mix-blend-mode:screen
// 触屏设备自动禁用；rAF 由 React 状态驱动（单元素开销可忽略）
// EXPORTS: MouseGlow

import { useEffect, useState } from 'react';

export default function MouseGlow() {
  const [pos, setPos] = useState({ x: -999, y: -999 });
  const [on, setOn] = useState(false);

  useEffect(() => {
    // 触屏 / 无精确指针设备跳过
    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(pointer: coarse)').matches) return;
    let raf = 0;
    let last = { x: -999, y: -999 };
    const onMove = (e: MouseEvent) => {
      last = { x: e.clientX, y: e.clientY };
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          setPos(last);
          setOn(true);
        });
      }
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[5] hidden md:block"
      style={{ opacity: on ? 1 : 0, transition: 'opacity 0.6s ease' }}
    >
      <div
        className="absolute h-[300px] w-[300px] rounded-full"
        style={{
          left: pos.x - 150,
          top: pos.y - 150,
          background:
            'radial-gradient(circle, rgba(34,211,238,0.14) 0%, rgba(34,211,238,0.05) 42%, transparent 72%)',
          mixBlendMode: 'screen',
          willChange: 'left, top',
        }}
      />
    </div>
  );
}
