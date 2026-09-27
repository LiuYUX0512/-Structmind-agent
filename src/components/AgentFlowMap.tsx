// AgentFlowMap — 多智能体协同「执行图」SVG 节点树
// 电影级叙事：四 Agent 泳道 + 执行序连线（数据流动虚线动画）+ 节点逐一亮起 + 回退红色弧线
// EXPORTS: AgentFlowMap

import { useMemo } from 'react';
import type { IAgentActionLog, AgentType } from '@/agent/types';
import { SUB_AGENT_SPECS } from '@/agent/types';

interface AgentFlowMapProps {
  logs: IAgentActionLog[];
  /** 当前播放/执行的 step（该节点点亮） */
  playingStep?: number | null;
  isPlaying?: boolean;
}

interface FlowNode {
  step: number;
  agent: AgentType;
  kind: 'think' | 'tool_call' | 'tool_result' | 'conclusion';
  tool?: string;
  status?: 'pass' | 'warning' | 'fail' | 'neutral';
  /** 是否为记忆/元认知/经验闭环相关节点（预校核等），需特殊高亮 */
  isMemory?: boolean;
}

interface ReworkEdge {
  fromStep: number;
  toStep: number;
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

const AgentFlowMap = ({ logs, playingStep = null, isPlaying = false }: AgentFlowMapProps) => {
  const nodes = useMemo<FlowNode[]>(() => {
    return logs
      .slice()
      .sort((a, b) => a.step - b.step)
      .map((l) => ({
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
        edges.push({ fromStep: prev.step, toStep: cur.step });
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
        pos[n.step] = { x: colX[a], y: 52 + r * rowGap };
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
    }> = [];
    for (let i = 1; i < nodes.length; i++) {
      const a = pos[nodes[i - 1].step];
      const b = pos[nodes[i].step];
      if (!a || !b) continue;
      const color = AGENT_FLOW_COLOR[nodes[i].agent];
      const active = isPlaying && (playingStep === nodes[i].step || playingStep === nodes[i - 1].step);
      let path: string;
      if (a.x === b.x) {
        path = `M ${a.x} ${a.y + 20} L ${b.x} ${b.y - 20}`;
      } else {
        const mx = (a.x + b.x) / 2;
        const my = Math.max(a.y, b.y) - 46;
        path = `M ${a.x} ${a.y + 20} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y - 20}`;
      }
      out.push({ from: a, to: b, color, active, path });
    }
    return out;
  }, [nodes, pos, isPlaying, playingStep]);

  const reworkPaths = useMemo(() => {
    return reworkEdges
      .map((e) => {
        const a = pos[e.fromStep];
        const b = pos[e.toStep];
        if (!a || !b) return null;
        const my = Math.max(34, Math.min(a.y, b.y) - 52);
        return {
          path: `M ${a.x} ${a.y - 20} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y + 20}`,
          fromStep: e.fromStep,
          toStep: e.toStep,
        };
      })
      .filter((x): x is { path: string; fromStep: number; toStep: number } => x !== null);
  }, [reworkEdges, pos]);

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

  return (
    <div className="flow-map overflow-x-auto">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-mono text-[10px] tracking-wider text-muted-foreground">
          MULTI-AGENT EXECUTION GRAPH · 执行网络
        </div>
        <div className="flex items-center gap-3">
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
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full min-w-[760px]"
        style={{ maxHeight: '460px' }}
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
          <g key={`rw-${r.fromStep}-${r.toStep}`}>
            <path
              d={r.path}
              fill="none"
              stroke="#ef4444"
              strokeWidth={2}
              strokeDasharray="5 4"
              className="agent-flow-rework"
            />
            <text
              x={(pos[r.fromStep].x + pos[r.toStep].x) / 2}
              y={Math.min(pos[r.fromStep].y, pos[r.toStep].y) - 58}
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
          <path
            key={`l-${i}`}
            d={l.path}
            fill="none"
            stroke={l.color}
            strokeWidth={1.5}
            opacity={l.active ? 1 : 0.5}
            className={l.active ? 'agent-flow-link-active' : undefined}
          />
        ))}

        {/* 节点 */}
        {nodes.map((n, i) => {
          const p = pos[n.step];
          const color = n.isMemory ? '#eab308' : AGENT_FLOW_COLOR[n.agent];
          const isActive = isPlaying && playingStep === n.step;
          const done = !isPlaying || n.step < (playingStep ?? Number.MAX_SAFE_INTEGER);
          const statusColor =
            n.status === 'fail' ? '#ef4444' : n.status === 'warning' ? '#f59e0b' : color;
          return (
            <g key={n.step} className={isActive ? 'agent-flow-active' : undefined}>
              <rect
                x={p.x - 22}
                y={p.y - 16}
                width={44}
                height={32}
                rx={8}
                fill={isActive ? color : done ? `${color}1a` : 'rgba(100,116,139,0.06)'}
                stroke={isActive ? color : statusColor}
                strokeWidth={isActive ? 2 : 1.2}
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
                fill={isActive ? '#fff' : statusColor}
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
              {/* 放电延迟：节点逐个亮起（SMIL 动画，浏览器原生） */}
              <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin={`${i * 0.12}s`} fill="freeze" />
            </g>
          );
        })}

        {/* 工具调用节点下方小字（若空间允许） */}
        {nodes.map((n) => {
          const p = pos[n.step];
          if (n.kind !== 'tool_call' || !n.tool) return null;
          return (
            <text
              key={`t-${n.step}`}
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
};

export default AgentFlowMap;
