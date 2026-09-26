// useTypewriter — 行级打字机（Markdown 安全）
// 按「行」推进：已完成的行整体出现，避免半截 Markdown 语法导致渲染闪烁
// EXPORTS: useTypewriter

import { useEffect, useMemo, useRef, useState } from 'react';

export function useTypewriter(
  text: string,
  opts?: { lineDelay?: number; immediate?: boolean }
) {
  const { lineDelay = 90, immediate = false } = opts || {};
  const lines = useMemo(() => text.split('\n'), [text]);
  const [lineCount, setLineCount] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    startedRef.current = false;
    setLineCount(0);
    if (immediate || !text) {
      setLineCount(lines.length);
      return;
    }
    let alive = true;
    let idx = 0;
    const timer = setInterval(() => {
      if (!alive) return;
      idx += 1;
      setLineCount(idx);
      if (idx >= lines.length) {
        clearInterval(timer);
        startedRef.current = true;
      }
    }, lineDelay);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [text, immediate, lineDelay, lines.length]);

  const displayText = lines.slice(0, lineCount).join('\n');
  const done = lineCount >= lines.length;

  return { displayText, done, totalLines: lines.length };
}

export default useTypewriter;
