// MemoryPanel — 记忆系统三层抽屉（模块② 可视化）
// 让评委看到「系统记得什么」：短期摘要 / 长期偏好 / 经验教训，而非只在日志里一闪而过
// 数据来源：从 actionLog 中提取 [Memory]/[Metacognition] 前缀日志，分三层展示
// EXPORTS: MemoryPanel

import { memo, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Database, Lightbulb, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import type { IAgentActionLog } from '@/agent/types';

interface MemoryPanelProps {
  logs: IAgentActionLog[];
}

interface IMemoryLayers {
  short: string[];
  long: string[];
  experience: string[];
  meta: string[];
}

/** 从 actionLog 提取记忆/元认知事件，分三层归类 */
function extractMemoryLayers(logs: IAgentActionLog[]): IMemoryLayers {
  const short: string[] = [];
  const long: string[] = [];
  const experience: string[] = [];
  const meta: string[] = [];
  for (const l of logs) {
    const c = l.content ?? '';
    if (c.includes('[Memory] 检测到上下文过长') || c.includes('已自动压缩')) short.push(c);
    else if (c.includes('[Memory] 已注入历史偏好')) long.push(c);
    else if (c.includes('[Memory] 触发经验闭环')) experience.push(c);
    else if (c.includes('[Metacognition]')) meta.push(c);
  }
  return { short, long, experience, meta };
}

function MemoryPanel({ logs }: MemoryPanelProps) {
  const [open, setOpen] = useState(true);
  const [expandedLayer, setExpandedLayer] = useState<string | null>('long');

  const layers = useMemo(() => extractMemoryLayers(logs), [logs]);

  const layerDefs = [
    { key: 'short', icon: Brain, title: '短期记忆', desc: '上下文摘要（超阈值自动压缩）', items: layers.short, accent: 'text-teal' },
    { key: 'long', icon: Database, title: '长期记忆', desc: '命中的用户历史偏好', items: layers.long, accent: 'text-gold' },
    { key: 'experience', icon: Lightbulb, title: '经验记忆', desc: '本次激活的历史教训', items: layers.experience, accent: 'text-amber' },
  ];

  const totalEvents = layers.short.length + layers.long.length + layers.experience.length + layers.meta.length;

  if (totalEvents === 0) return null;

  return (
    <div className="glass-card">
      {/* 标题栏（可折叠） */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left"
      >
        <div className="flex items-center gap-2">
          <Brain className="size-4 text-gold" />
          <span className="text-sm font-semibold text-foreground">记忆面板</span>
          <span className="rounded-sm border border-gold/30 bg-gold/10 px-1.5 py-0.5 font-mono text-[10px] text-gold">
            {totalEvents} 条
          </span>
        </div>
        {open ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="space-y-1.5 border-t border-border/50 px-3 py-2.5">
              {layerDefs.map((layer) => {
                const Icon = layer.icon;
                const isExpanded = expandedLayer === layer.key;
                return (
                  <div key={layer.key} className="rounded-md border border-border/40 bg-background/40">
                    <button
                      type="button"
                      onClick={() => setExpandedLayer(isExpanded ? null : layer.key)}
                      className="flex w-full items-center justify-between px-2.5 py-2 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <Icon className={`size-3.5 ${layer.accent}`} />
                        <span className="text-xs font-medium text-foreground">{layer.title}</span>
                        {layer.items.length > 0 && (
                          <span className={`rounded-sm px-1 py-0.5 font-mono text-[9px] ${layer.accent} bg-background/60`}>
                            {layer.items.length}
                          </span>
                        )}
                      </div>
                      <span className="flex items-center gap-1.5">
                        <span className="hidden text-[10px] text-muted-foreground sm:inline">{layer.desc}</span>
                        {isExpanded ? <ChevronUp className="size-3 text-muted-foreground" /> : <ChevronDown className="size-3 text-muted-foreground" />}
                      </span>
                    </button>
                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="space-y-1 border-t border-border/40 px-2.5 py-2">
                            {layer.items.length === 0 ? (
                              <div className="text-[11px] text-muted-foreground/60">本次运行未产生该层记忆</div>
                            ) : (
                              layer.items.map((item, i) => (
                                <div
                                  key={i}
                                  className={`rounded-sm border-l-2 px-2 py-1 text-[11px] leading-relaxed ${layer.key === 'long' ? 'border-gold/50 bg-gold/[0.06] text-gold' : 'border-border/60 text-foreground/75'}`}
                                >
                                  {item.replace(/^\[(Memory|Metacognition)\]\s*/, '')}
                                </div>
                              ))
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}

              {/* 元认知反思（额外层，若有） */}
              {layers.meta.length > 0 && (
                <div className="rounded-md border border-gold/30 bg-gold/[0.04] px-2.5 py-2">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gold">
                    <Sparkles className="size-3.5" />
                    元认知反思
                  </div>
                  {layers.meta.map((item, i) => (
                    <div key={i} className="text-[11px] leading-relaxed text-foreground/75">
                      {item.replace(/^\[Metacognition\]\s*/, '')}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default memo(MemoryPanel);
