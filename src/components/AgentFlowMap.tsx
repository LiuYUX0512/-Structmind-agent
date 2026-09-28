// AgentFlowMap — 多智能体协同「执行图」SVG 节点树
// 电影级叙事：四 Agent 泳道 + 执行序连线（数据流动虚线动画）+ 节点逐一亮起 + 回退红色弧线
// 可放大：缩放（±/滚轮）+ 拖拽平移 + 全屏演示（Esc 退出）—— 录屏时字号可放大到大屏可读
// EXPORTS: AgentFlowMap

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Wrench, ArrowDownRight, ZoomIn, ZoomOut, RotateCcw, Maximize2, Minimize2 } from 'lucide-react';
import type { IAgentActionLog, AgentType, ITrajectoryMetrics } from '@/agent/types';
import { SUB_AGENT_SPECS } from '@/agent/types';
import { estimateTokens } from '@/agent/memory';

interface AgentFlowMapProps {
  logs: IAgentActionLog[];
  /** 当前播放/执行的 step（该节点点亮） */
  playingStep?: number | null;
  isPlaying?: boolean;
  /** 元认知轨迹指标（节点 token/耗时来源） */
  metrics?: ITrajectoryMetrics;
}

interface FlowNode {
  /** 唯一键：logs 数组下标。step 在各 Agent 间会重复，不能当坐标键 */
  uid: number;
  step: number;
  agent: AgentType;
  kind: 'think' | 'tool_call' | 'tool_result' | 'conclusion';
  tool?: string;
  status?: 'pass' | 'warning' | 'fail' | 'neutral';
  /** 是否为记忆/元认知/经验闭环相关节点（预校核等），需特殊高亮 */
  isMemory?: boolean;
}

interface ReworkEdge {
  fromUid: number;
  toUid: number;
}

const FLOW_AGENTS: AgentType[] = ['architect', 'code', 'economist', 'chief'];

const AGENT_FLOW_COLOR: Record<AgentType, string> = {
  architect: '#2dd4bf', // teal
  code: '#f59e0b', // amber
  economist: '#34d399', // emerald
  chief: '#eab308', // gold
};

const AGENT_FLOW_LABEL: Record<AgentType, string> = {
  architect: '方案建筑师',
  code: '规范校核员',
  economist: '经济测算师',
  chief: '总工仲裁',
};

// 缩放范围：0.7×（缩小看全貌）~ 4×（放大录屏看清小字）
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));

function analyzeNodeStatus(result: unknown): 'pass' | 'warning' | 'fail' | 'neutral' {
  if (!result || typeof result !== 'object') return 'neutral';
  const r = result as Record<string, unknown>;
  if (typeof r.failCount === 'number' && r.failCount > 0) return 'fail';
  if (typeof r.warningCount === 'number' && r.warningCount > 0) return 'warning';
  if (typeof r.passCount === 'number') return 'pass';
  if (r.foundationType && r.suitability === 'high') return 'pass';
  if (r.suitability === 'medium') return 'warning';
  if (r.suitability === 'low') return 'fail';
  return 'neutral';
}

/** 边数据叙事：从本次运行 actionLog 动态提取（非写死），评委问"标签是真的吗"能答出 */
function getEdgeLabel(from: FlowNode, to: FlowNode, logs: IAgentActionLog[]): string {
  // 回退边：只有 Code → Architect 才是「打回重做」。
  // （同泳道 architect→architect 也算 to.agent==='architect'，若不带 from 判断，
  //   会给普通思考步骤都打上"发现 N 条强条违规"，标签压在节点上、语义也是错的。）
  if (from.agent === 'code' && to.agent === 'architect') {
    const failResults = logs.filter(
      (l) => l.type === 'tool_result' && l.tool === 'check_seismic_requirements'
    );
    const failChecks = failResults.flatMap((l) => {
      const r = l.result as { checks?: Array<{ status?: string; name?: string }> } | undefined;
      return (r?.checks ?? []).filter((c) => c.status === 'fail');
    });
    if (failChecks.length > 0) {
      return `发现 ${failChecks.length} 条强条违规：${failChecks.map((c) => c.name).join('、')}`;
    }
    return '打回重新选型';
  }
  // Architect → Code / Economist：提取实际候选方案数
  if (from.agent === 'architect' && (to.agent === 'code' || to.agent === 'economist')) {
    const qs = logs.find((l) => l.tool === 'query_structure_systems' && l.type === 'tool_result');
    const candidates = (qs?.result as { candidates?: Array<{ id?: string; name?: string }> } | undefined)?.candidates;
    if (Array.isArray(candidates) && candidates.length > 0) {
      return `传递 ${candidates.length} 个候选方案`;
    }
    return '传递候选方案';
  }
  if (from.agent === 'code' && to.agent === 'chief') return '传递校核结论';
  if (from.agent === 'economist' && to.agent === 'chief') return '传递评估指标';
  if (from.agent === 'code' && to.agent === 'economist') return '传递合规方案';
  return '';
}

const AgentFlowMap = ({ logs, playingStep = null, isPlaying = false, metrics }: AgentFlowMapProps) => {
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  // 缩放 / 全屏演示（录屏时放大以看清节点小字）
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // 逐节点放电延迟只在首次挂载时播放：节点多达数十个时，错峰延迟最长的要等 ~10s，
  // 若在切全屏时重播，会先看到一片空白。切全屏/首次窗口结束即关闭错峰，节点立即可见。
  const [stagger, setStagger] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setStagger(false), 2200);
    return () => clearTimeout(t);
  }, []);

  const toggleFullscreen = useCallback(() => {
    setStagger(false);
    setIsFullscreen((v) => !v);
  }, []);

  // 选中节点的完整日志（侧滑面板证据链）—— uid 即 logs 下标
  const selectedLog = useMemo(
    () => (selectedUid === null ? null : logs[selectedUid] ?? null),
    [logs, selectedUid]
  );

  // 选中节点所属 Agent 的 token 消耗 + 耗时（可解释 AI 的量化证据）
  const selectedAgentStats = useMemo(() => {
    if (!selectedLog) return null;
    const agent = selectedLog.agent || 'architect';
    const agentLogs = logs.filter((l) => l.agent === agent);
    const tokens = agentLogs.reduce((sum, l) => sum + estimateTokens(l.content ?? ''), 0);
    const duration = metrics?.nodeDurations?.[agent] ?? 0;
    return { tokens, duration, logCount: agentLogs.length };
  }, [logs, selectedLog, metrics]);

  const nodes = useMemo<FlowNode[]>(() => {
    // ⚠️ 不要按 step 排序、也不要用 step 当坐标键：
    // actionLog 的数组顺序即为真实执行顺序；而每个 Agent 的 step 是各自独立编号的
    // （architect 的 step 1 与 chief 的 step 1 是两条不同日志，实测 90 条日志仅 36 个
    //   不同 step，最多 5 条共用）。以 step 为坐标键会让不同泳道的节点塌到同一坐标，
    // 表现为「四条泳道只有两条有节点、节点互相压叠」。
    return logs.map((l, uid) => ({
      uid,
      step: l.step,
      agent: l.agent || 'architect',
      kind: l.type,
      tool: l.tool,
      status: l.type === 'tool_result' ? analyzeNodeStatus(l.result) : undefined,
      // 记忆/元认知/经验闭环节点（预校核、[Memory]、[Metacognition]）金色高亮
      isMemory: !!l.content && /\[预校核\]|\[Memory\]|\[Metacognition\]/.test(l.content),
    }));
  }, [logs]);

  // 回退检测：code 之后紧接 architect 再次出现（打回重做）
  const reworkEdges = useMemo<ReworkEdge[]>(() => {
    const edges: ReworkEdge[] = [];
    for (let i = 1; i < nodes.length; i++) {
      const prev = nodes[i - 1];
      const cur = nodes[i];
      if (prev.agent === 'code' && cur.agent === 'architect') {
        edges.push({ fromUid: prev.uid, toUid: cur.uid });
      }
    }
    return edges;
  }, [nodes]);

  const layout = useMemo(() => {
    const colX: Record<AgentType, number> = { architect: 160, code: 400, economist: 640, chief: 880 };
    const perCol: Record<AgentType, FlowNode[]> = { architect: [], code: [], economist: [], chief: [] };
    nodes.forEach((n) => perCol[n.agent].push(n));
    const maxRows = Math.max(...FLOW_AGENTS.map((a) => perCol[a].length), 1);
    const rowGap = Math.max(64, Math.min(96, 540 / Math.max(maxRows - 1, 1)));
    const H = Math.max(160, maxRows * rowGap + 96);
    const pos: Record<number, { x: number; y: number }> = {};
    FLOW_AGENTS.forEach((a) => {
      perCol[a].forEach((n, r) => {
        pos[n.uid] = { x: colX[a], y: 52 + r * rowGap };
      });
    });
    const W = 1040;
    return { colX, perCol, rowGap, H, W, pos, maxRows };
  }, [nodes]);

  const { pos, H, W, colX } = layout;

  // 执行序连线（相邻节点），数据流动动画
  const links = useMemo(() => {
    const out: Array<{
      from: { x: number; y: number };
      to: { x: number; y: number };
      color: string;
      active: boolean;
      path: string;
      label: string;
      midX: number;
      midY: number;
    }> = [];
    for (let i = 1; i < nodes.length; i++) {
      const a = pos[nodes[i - 1].uid];
      const b = pos[nodes[i].uid];
      if (!a || !b) continue;
      const color = AGENT_FLOW_COLOR[nodes[i].agent];
      const active = isPlaying && (playingStep === nodes[i].step || playingStep === nodes[i - 1].step);
      const label = getEdgeLabel(nodes[i - 1], nodes[i], logs);
      let path: string;
      if (a.x === b.x) {
        path = `M ${a.x} ${a.y + 20} L ${b.x} ${b.y - 20}`;
      } else {
        const mx = (a.x + b.x) / 2;
        const my = Math.max(a.y, b.y) - 46;
        path = `M ${a.x} ${a.y + 20} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y - 20}`;
      }
      out.push({
        from: a,
        to: b,
        color,
        active,
        path,
        label,
        midX: (a.x + b.x) / 2,
        midY: Math.max(a.y, b.y) - 52,
      });
    }
    return out;
  }, [nodes, pos, isPlaying, playingStep, logs]);

  const reworkPaths = useMemo(() => {
    return reworkEdges
      .map((e) => {
        const a = pos[e.fromUid];
        const b = pos[e.toUid];
        if (!a || !b) return null;
        const my = Math.max(34, Math.min(a.y, b.y) - 52);
        return {
          path: `M ${a.x} ${a.y - 20} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y + 20}`,
          fromUid: e.fromUid,
          toUid: e.toUid,
        };
      })
      .filter((x): x is { path: string; fromUid: number; toUid: number } => x !== null);
  }, [reworkEdges, pos]);

  // ============ 缩放交互 ============
  const zoomIn = useCallback(() => setZoom((z) => clampZoom(z + ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setZoom((z) => clampZoom(z - ZOOM_STEP)), []);
  const zoomReset = useCallback(() => setZoom(1), []);

  // 滚轮缩放：全屏模式直接滚轮；普通模式需 Ctrl/⌘ + 滚轮（否则保留页面滚动）
  // 用原生非 passive 监听，才能 preventDefault 阻止页面联动滚动
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey || isFullscreen)) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z + (e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [isFullscreen, nodes.length]);

  // 拖拽平移（仅鼠标：触屏保留原生滚动，避免手势冲突）
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight) return;
    dragRef.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false };
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const el = scrollRef.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      d.moved = true;
      el.setPointerCapture(e.pointerId);
    }
    if (d.moved) {
      el.scrollLeft = d.left - dx;
      el.scrollTop = d.top - dy;
    }
  }, []);
  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // 全屏：Esc 退出 + 锁定背景滚动
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isFullscreen]);

  if (nodes.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center text-center">
        <div>
          <p className="text-sm font-medium text-muted-foreground">等待输入参数或选择案例</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            生成方案后，这里将展示四 Agent 的协同执行网络
          </p>
        </div>
      </div>
    );
  }

  // ===== 缩放工具栏 =====
  const zoomToolbar = (
    <div className="mb-1.5 flex shrink-0 items-center justify-end gap-1">
      <button
        type="button"
        onClick={zoomOut}
        disabled={zoom <= ZOOM_MIN}
        aria-label="缩小"
        className="inline-flex size-6 items-center justify-center rounded-sm border border-border/40 bg-background/50 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
      >
        <ZoomOut className="size-3" />
      </button>
      <button
        type="button"
        onClick={zoomReset}
        aria-label="恢复原始大小"
        title="恢复原始大小"
        className="min-w-[42px] rounded-sm border border-border/40 bg-background/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        onClick={zoomIn}
        disabled={zoom >= ZOOM_MAX}
        aria-label="放大"
        className="inline-flex size-6 items-center justify-center rounded-sm border border-border/40 bg-background/50 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
      >
        <ZoomIn className="size-3" />
      </button>
      <button
        type="button"
        onClick={zoomReset}
        aria-label="恢复原始大小"
        title="恢复原始大小"
        className="inline-flex size-6 items-center justify-center rounded-sm border border-border/40 bg-background/50 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
      >
        <RotateCcw className="size-3" />
      </button>
      <button
        type="button"
        onClick={toggleFullscreen}
        aria-label={isFullscreen ? '退出全屏' : '全屏演示'}
        title={isFullscreen ? '退出全屏（Esc）' : '全屏演示（录屏推荐）'}
        className="ml-0.5 inline-flex items-center gap-1 rounded-sm border border-teal/40 bg-teal/10 px-1.5 py-1 text-[10px] font-medium text-teal transition-colors hover:bg-teal/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
      >
        {isFullscreen ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
        {isFullscreen ? '退出' : '全屏'}
      </button>
    </div>
  );

  // ===== 图例 / 列头说明 =====
  const titleText = (
    <div className="font-mono text-[10px] tracking-wider text-muted-foreground">
      MULTI-AGENT EXECUTION GRAPH · 执行网络
    </div>
  );

  const legendCluster = (
    <div className="flex flex-wrap items-center gap-3">
      {nodes.some((n) => n.isMemory) && (
        <span className="flex items-center gap-1 rounded-sm border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[9px] font-medium text-gold">
          🧠 经验闭环生效（金色节点）
        </span>
      )}
      {FLOW_AGENTS.map((a) => (
        <span key={a} className="flex items-center gap-1 text-[9px] text-muted-foreground/80">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: AGENT_FLOW_COLOR[a] }}
          />
          {AGENT_FLOW_LABEL[a]}
        </span>
      ))}
    </div>
  );

  const legendRow = (
    <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2">
      {titleText}
      {legendCluster}
    </div>
  );

  const hintRow = (
    <div className="mt-1 shrink-0 font-mono text-[9px] text-muted-foreground/50">
      Ctrl/⌘ + 滚轮缩放 · 拖拽平移 · 全屏后可直接滚轮缩放 · Esc 退出
    </div>
  );

  // ===== SVG 画布（宽度随 zoom 变化，SVG 矢量缩放不糊，录屏可读）=====
  const surface = (
    <div
      ref={scrollRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`relative overflow-auto rounded-md border border-border/40 bg-background/30 ${
        isFullscreen ? 'min-h-0 flex-1' : ''
      }`}
      style={{
        maxHeight: isFullscreen ? undefined : 440,
        cursor: 'grab',
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block"
        style={{ width: `${zoom * 100}%`, minWidth: 760, height: 'auto' }}
        role="img"
        aria-label="多智能体协同执行图"
      >
        {/* 泳道背景 + 列头 */}
        {FLOW_AGENTS.map((a) => (
          <g key={a}>
            <rect
              x={colX[a] - 96}
              y={18}
              width={192}
              height={H - 36}
              rx={10}
              fill={AGENT_FLOW_COLOR[a]}
              opacity={0.04}
            />
            <text x={colX[a]} y={34} textAnchor="middle" fontSize={11} fontWeight={700} fill={AGENT_FLOW_COLOR[a]}>
              {AGENT_FLOW_LABEL[a]}
            </text>
            <text x={colX[a]} y={47} textAnchor="middle" fontSize={8} fill="#64748b">
              {a === 'architect' ? 'A-1' : a === 'code' ? 'A-2' : a === 'economist' ? 'A-3' : 'A-4'}
            </text>
          </g>
        ))}

        {/* 回退弧线（红色闪烁） — 先画在连线下方 */}
        {reworkPaths.map((r) => (
          <g key={`rw-${r.fromUid}-${r.toUid}`}>
            <path
              d={r.path}
              fill="none"
              stroke="#ef4444"
              strokeWidth={2}
              strokeDasharray="5 4"
              className="agent-flow-rework"
            />
            <text
              x={(pos[r.fromUid].x + pos[r.toUid].x) / 2}
              y={Math.min(pos[r.fromUid].y, pos[r.toUid].y) - 58}
              textAnchor="middle"
              fontSize={9}
              fontWeight={700}
              fill="#ef4444"
              className="agent-flow-rework"
            >
              ⚠ 打回重算
            </text>
          </g>
        ))}

        {/* 执行序连线 */}
        {links.map((l, i) => (
          <g key={`l-${i}`}>
            <path
              d={l.path}
              fill="none"
              stroke={l.color}
              strokeWidth={1.5}
              opacity={l.active ? 1 : 0.5}
              className={l.active ? 'agent-flow-link-active' : undefined}
            />
            {l.label && (
              <text
                x={l.midX}
                y={l.midY}
                textAnchor="middle"
                fontSize={8}
                fontWeight={600}
                fill={l.color}
                opacity={0.85}
              >
                ⤷ {l.label}
              </text>
            )}
          </g>
        ))}

        {/* 节点 */}
        {nodes.map((n, i) => {
          const p = pos[n.uid];
          const color = n.isMemory ? '#eab308' : AGENT_FLOW_COLOR[n.agent];
          const isActive = isPlaying && playingStep === n.step;
          const done = !isPlaying || n.step < (playingStep ?? Number.MAX_SAFE_INTEGER);
          const isSelected = selectedUid === n.uid;
          // 四态：待执行(灰) / 执行中(脉冲) / 完成(绿) / 违规(红)
          const strokeColor = n.status === 'fail'
            ? '#ef4444'
            : done
              ? '#10B981'
              : isActive
                ? color
                : 'rgba(100,116,139,0.5)';
          const fillColor = isActive
            ? color
            : done
              ? `${color}1a`
              : 'rgba(100,116,139,0.06)';
          // replan 插入的新节点（回退边的目标）——从父节点旁"生长"出来
          const isReplanNode = reworkEdges.some((e) => e.toUid === n.uid);
          return (
            <motion.g
              key={n.uid}
              className={isActive ? 'agent-flow-active' : undefined}
              onClick={() => setSelectedUid(isSelected ? null : n.uid)}
              style={{ cursor: 'pointer' }}
              initial={isReplanNode ? { opacity: 0, scale: 0.2 } : false}
              animate={{ opacity: 1, scale: 1 }}
              transition={isReplanNode ? { duration: 0.6, ease: 'easeOut' } : { duration: 0 }}
              {...(isReplanNode ? { style: { cursor: 'pointer', transformOrigin: `${p.x}px ${p.y}px`, transformBox: 'fill-box' as const } } : { style: { cursor: 'pointer' } })}
            >
              {/* 选中高亮环 */}
              {isSelected && (
                <rect x={p.x - 26} y={p.y - 20} width={52} height={40} rx={10} fill="none" stroke="#0F4C81" strokeWidth={2} strokeDasharray="4 3" />
              )}
              <rect
                x={p.x - 22}
                y={p.y - 16}
                width={44}
                height={32}
                rx={8}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth={isActive || isSelected ? 2 : 1.2}
              />
              {n.status === 'fail' && !isActive && (
                <circle cx={p.x + 18} cy={p.y - 9} r={4} fill="#ef4444" />
              )}
              <text
                x={p.x}
                y={p.y - 2}
                textAnchor="middle"
                fontSize={10}
                fontWeight={700}
                fill={isActive ? '#fff' : strokeColor}
              >
                {n.agent === 'architect' ? 'A-1' : n.agent === 'code' ? 'A-2' : n.agent === 'economist' ? 'A-3' : 'A-4'}
              </text>
              <text
                x={p.x}
                y={p.y + 10}
                textAnchor="middle"
                fontSize={7}
                fill={isActive ? 'rgba(255,255,255,0.85)' : 'rgba(100,116,139,0.9)'}
              >
                {n.kind === 'tool_call' ? (n.tool ? n.tool.replace('check_', '').replaceAll('_', ' ') : 'TOOL') : n.kind === 'tool_result' ? 'RESULT' : n.kind === 'think' ? 'THINK' : 'DONE'}
                ·{String(n.step).padStart(2, '0')}
              </text>
              {/* 放电延迟：节点逐个亮起（SMIL 动画，浏览器原生）；仅首次挂载播放 */}
              {stagger && (
                <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin={`${i * 0.12}s`} fill="freeze" />
              )}
            </motion.g>
          );
        })}

        {/* 工具调用节点下方小字（若空间允许） */}
        {nodes.map((n) => {
          const p = pos[n.uid];
          if (n.kind !== 'tool_call' || !n.tool) return null;
          return (
            <text
              key={`t-${n.uid}`}
              x={p.x}
              y={p.y + 30}
              textAnchor="middle"
              fontSize={7.5}
              fill="rgba(148,163,184,0.9)"
              className="flow-tool-label"
            >
              {n.tool.replace('check_', '').replaceAll('_', ' ')}
            </text>
          );
        })}
      </svg>
    </div>
  );

  // ===== 节点详情侧滑面板（证据链：思考 / 工具调用 / 结果）=====
  const detailPanel = (
    <AnimatePresence>
      {selectedLog && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ duration: 0.25 }}
          className="mt-2 shrink-0 overflow-auto rounded-lg border border-border/60 bg-card/90 p-card backdrop-blur-md"
          style={{ maxHeight: isFullscreen ? '30vh' : undefined }}
        >
          <div className="flex items-center justify-between">
            <span className="text-title text-foreground">
              {AGENT_FLOW_LABEL[selectedLog.agent || 'architect']} · STEP {selectedLog.step}
            </span>
            <button
              type="button"
              onClick={() => setSelectedUid(null)}
              className="rounded-md p-1 text-muted-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
              aria-label="关闭详情"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* 量化证据：token 消耗 + 耗时（数字英雄级） */}
          {selectedAgentStats && (
            <div className="mt-2 grid grid-cols-2 gap-element rounded-md bg-background/60 p-element">
              <div>
                <div className="text-caption">Token 消耗</div>
                <div className="text-hero-number !text-3xl text-primary">{selectedAgentStats.tokens.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-caption">耗时</div>
                <div className="text-hero-number !text-3xl text-teal">{(selectedAgentStats.duration / 1000).toFixed(1)}s</div>
              </div>
            </div>
          )}

          <div className="mt-2 space-y-2 text-xs">
            {/* 类型标签 */}
            <span className="inline-flex rounded-sm border border-border/60 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {selectedLog.type === 'tool_call' ? '工具调用' : selectedLog.type === 'tool_result' ? '工具结果' : selectedLog.type === 'conclusion' ? '结论' : '思考'}
            </span>

            {/* 内容（思考文本 / 结论） */}
            {selectedLog.content && (
              <div className="rounded-md bg-background/60 px-2.5 py-1.5 leading-relaxed text-foreground/80">
                {selectedLog.content}
              </div>
            )}

            {/* 工具调用参数 */}
            {selectedLog.type === 'tool_call' && selectedLog.tool && (
              <div className="rounded-md bg-background/60 px-2.5 py-1.5">
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-teal">
                  <Wrench className="size-3" />
                  工具：{selectedLog.tool}
                </div>
                {selectedLog.args && Object.keys(selectedLog.args).length > 0 && (
                  <pre className="mt-1 overflow-auto font-mono text-[10px] text-muted-foreground">
                    {JSON.stringify(selectedLog.args, null, 2)}
                  </pre>
                )}
              </div>
            )}

            {/* 工具结果 */}
            {selectedLog.type === 'tool_result' && selectedLog.tool && (
              <div className="rounded-md bg-background/60 px-2.5 py-1.5">
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-teal">
                  <Wrench className="size-3" />
                  {selectedLog.tool} → 结果
                </div>
                {(() => {
                  const r = selectedLog.result as Record<string, unknown> | undefined;
                  const status = r && typeof r.failCount === 'number' && r.failCount > 0 ? 'fail' : r && typeof r.passCount === 'number' ? 'pass' : 'neutral';
                  return (
                    <span className={`mt-1 inline-flex rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${status === 'fail' ? 'bg-destructive/15 text-destructive' : status === 'pass' ? 'bg-success/15 text-success' : 'bg-muted/50 text-muted-foreground'}`}>
                      {status === 'fail' ? '不符合' : status === 'pass' ? '符合' : '执行完成'}
                    </span>
                  );
                })()}
              </div>
            )}

            {/* 证据链提示 */}
            <div className="flex items-center gap-1.5 border-t border-border/50 pt-2 text-[10px] text-muted-foreground">
              <ArrowDownRight className="size-3" />
              每一步都可追溯：思考 → 工具调用 → 结果证据链
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      {/* 常规视图（全屏时卸载，避免同一 SVG 双份挂载） */}
      {!isFullscreen && (
        <div className="flow-map flex flex-col">
          {zoomToolbar}
          {legendRow}
          {surface}
          {detailPanel}
          {hintRow}
        </div>
      )}

      {/* 全屏演示（录屏用：整屏可用，SVG 矢量放大，字清晰可读） */}
      {isFullscreen &&
        createPortal(
          <div className="flow-fullscreen fixed inset-0 z-[120] flex flex-col bg-background/95 p-4 backdrop-blur-xl">
            <div className="flex shrink-0 items-start justify-between gap-2">
              {titleText}
              <div className="shrink-0">{zoomToolbar}</div>
            </div>
            <div className="mb-1.5 mt-1 flex shrink-0 justify-end">{legendCluster}</div>
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              {surface}
              {detailPanel}
            </div>
            {hintRow}
          </div>,
          document.body
        )}
    </>
  );
};

export default AgentFlowMap;
