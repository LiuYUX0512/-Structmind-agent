// DebatePanel — 多智能体辩论看板
// 将真实/演示模式 actionLog 中的「Code 挑刺 → Architect 回应 → Chief 仲裁」辩论轨迹
// 以左右分栏对话气泡可视化（红卡=规范校核提出问题，蓝卡=方案创作回应，金卡=总工仲裁）
// 数据源：actionLog 中带「第N轮辩论」标记的 think 条目；无辩论时展示"校核全部通过"
// EXPORTS: DebatePanel

import { memo, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, PenTool, Scale, CheckCircle2, MessageSquareWarning, CornerDownRight } from 'lucide-react';
import type { IAgentActionLog } from '@/agent/types';
import { cn } from '@/lib/utils';

interface DebatePanelProps {
  logs: IAgentActionLog[];
  /** 总工仲裁结论（Chief） */
  verdict?: { schemeName: string; overallScore: number; reason: string } | null;
}

interface IDebateItem {
  loop: number;
  role: 'code' | 'architect';
  title: string;
  content: string;
}

/** 从 actionLog 提取辩论条目（演示/真实模式共用的日志标记：第N轮辩论） */
export function extractDebateItems(logs: IAgentActionLog[]): IDebateItem[] {
  return logs
    .filter(
      (l) =>
        l.type === 'think' &&
        typeof l.content === 'string' &&
        /第\s*\d+\s*轮辩论/.test(l.content) &&
        /Code 挑刺|Architect 回应/.test(l.content)
    )
    .map((l) => {
      const content = l.content as string;
      const loop = Number(content.match(/第\s*(\d+)\s*轮辩论/)?.[1] ?? 1);
      const role = content.includes('Code 挑刺') ? ('code' as const) : ('architect' as const);
      const titleM = content.match(/第\s*\d+\s*轮辩论 · (?:Code 挑刺|Architect 回应)([^\n]*)/);
      return {
        loop,
        role,
        title: (titleM?.[1] || '').trim(),
        content: content.replace(/【第\s*\d+\s*轮辩论 · [^】]*】\n?/, '').trim(),
      };
    })
    .sort((a, b) => a.loop - b.loop);
}

/** 从日志提取"校核未通过"的挑战（真实模式回退时，LLM 思考/反馈文本里含该标记） */
function extractRealDebateItems(logs: IAgentActionLog[]): IDebateItem[] {
  const out: IDebateItem[] = [];
  let loop = 1;
  for (const l of logs) {
    if (l.type !== 'think' || typeof l.content !== 'string') continue;
    const c = l.content as string;
    if (/校核未通过|存在.*不符合|不满足规范/.test(c) && /第\s*\d+\s*轮/.test(c)) {
      out.push({ loop, role: 'code', title: '', content: c });
    }
  }
  return out;
}

const DebatePanel = memo(function DebatePanel({ logs, verdict }: DebatePanelProps) {
  const items = useMemo(() => {
    const structured = extractDebateItems(logs);
    if (structured.length > 0) return structured;
    return extractRealDebateItems(logs);
  }, [logs]);

  const rounds = useMemo(() => {
    const map = new Map<number, { code?: IDebateItem; architect?: IDebateItem }>();
    for (const it of items) {
      const r = map.get(it.loop) || {};
      if (it.role === 'code') r.code = it;
      else r.architect = it;
      map.set(it.loop, r);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [items]);

  const hasDebate = rounds.length > 0;

  return (
    <div className="w-full rounded-2xl border border-slate-200 bg-white/80 shadow-sm backdrop-blur">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquareWarning className="h-4 w-4 text-indigo-500" />
          <span className="text-sm font-semibold text-slate-800">多智能体辩论看板</span>
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
            Multi-Agent Debate
          </span>
        </div>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            hasDebate ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'
          )}
        >
          {hasDebate ? `${rounds.length} 轮交锋` : '校核全部通过'}
        </span>
      </div>

      <div className="space-y-4 px-4 py-4">
        {!hasDebate && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <div className="text-xs leading-relaxed text-emerald-700">
              <span className="font-semibold">规范校核全部通过</span>
              —— Code Agent 未发现违规项，无需回退重出，方案直接进入总工仲裁环节。
            </div>
          </motion.div>
        )}

        <AnimatePresence>
          {rounds.map(([loop, r]) => (
            <motion.div
              key={`debate-${loop}`}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: (loop - 1) * 0.12 }}
              className="space-y-3"
            >
              {/* 轮次头 */}
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-white">
                  第 {loop} 轮
                </span>
                <span className="text-[11px] text-slate-400">规范校核 → 方案调整 → 复核</span>
              </div>

              {/* Code 挑刺（红卡，左侧） */}
              {r.code && (
                <div className="flex justify-start">
                  <div className="max-w-[92%]">
                    <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-rose-600">
                      <AlertTriangle className="h-3 w-3" />
                      规范校核工程师 · Code Agent
                      {r.code.title && <span className="text-slate-400">（{r.code.title}）</span>}
                    </div>
                    <div className="rounded-xl rounded-tl-sm border border-rose-200 bg-rose-50/80 p-3 text-xs leading-relaxed text-slate-700 shadow-sm">
                      <pre className="whitespace-pre-wrap font-sans">{r.code.content}</pre>
                    </div>
                  </div>
                </div>
              )}

              {/* 箭头 */}
              {r.code && r.architect && (
                <div className="flex items-center justify-center gap-1 text-slate-300">
                  <CornerDownRight className="h-4 w-4" />
                  <span className="text-[10px] uppercase tracking-widest">rework</span>
                </div>
              )}

              {/* Architect 回应（蓝卡，右侧） */}
              {r.architect && (
                <div className="flex justify-end">
                  <div className="max-w-[92%]">
                    <div className="mb-1 flex items-center justify-end gap-1.5 text-[11px] font-medium text-sky-600">
                      方案创作工程师 · Architect Agent
                      {r.architect.title && <span className="text-slate-400">（{r.architect.title}）</span>}
                      <PenTool className="h-3 w-3" />
                    </div>
                    <div className="rounded-xl rounded-tr-sm border border-sky-200 bg-sky-50/80 p-3 text-xs leading-relaxed text-slate-700 shadow-sm">
                      <pre className="whitespace-pre-wrap font-sans">{r.architect.content}</pre>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Chief 仲裁（金卡） */}
        {verdict && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: rounds.length * 0.12 + 0.1 }}
            className="rounded-xl border border-amber-300 bg-gradient-to-r from-amber-50 to-yellow-50/70 p-3 shadow-sm"
          >
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-amber-700">
              <Scale className="h-3.5 w-3.5" />
              总工仲裁 · Chief Agent
            </div>
            <div className="text-xs leading-relaxed text-slate-700">
              综合造价、工期、碳排放与规范校核结果，最终推荐{' '}
              <span className="font-bold text-amber-700">{verdict.schemeName}</span>
              ，综合得分 <span className="font-bold">{verdict.overallScore.toFixed(1)}</span> / 10。
            </div>
            {verdict.reason && (
              <div className="mt-1.5 line-clamp-3 text-[11px] text-slate-500">{verdict.reason}</div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
});

export { DebatePanel };
export type { DebatePanelProps };
