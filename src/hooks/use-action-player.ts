// useActionPlayer — 演示轨迹播放引擎
// 将完整 actionLog 按节奏逐步推送到 visibleLogs，控制各 Agent 的接力节奏
// 支持：暂停/继续、跳过、重新播放、用户滚动自动暂停、打字机效果

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { IAgentActionLog, AgentType } from '@/agent/types';

interface UseActionPlayerOptions {
  /** 完整日志（演示模式下一次性拿到的全部） */
  fullLogs: IAgentActionLog[];
  /** 是否启用播放（演示模式且正在生成时启用） */
  enabled: boolean;
  /** 是否暂停 */
  paused: boolean;
  /** Agent 切换间隔（ms） */
  agentGapMs?: number;
  /** think 条目基准打字速度（ms/字）——列举类会更快、推理类会更慢 */
  thinkCharMs?: number;
  /** think 打完后的停留时间（ms，让用户读完思考内容） */
  thinkHoldMs?: number;
  /** tool_call 停留时长（ms，模拟计算） */
  toolCallMs?: number;
  /** tool_result 出现前停顿（ms） */
  toolResultDelayMs?: number;
  /** tool_result 显示后的停留时间（ms，让用户读完工具输出） */
  toolResultHoldMs?: number;
  /** conclusion 停顿（ms，出现前延迟） */
  conclusionDelayMs?: number;
  /** conclusion 显示后的停留时间（ms，让用户读完结论） */
  conclusionHoldMs?: number;
  /** 关键结论前停顿（ms） */
  keyPointDelayMs?: number;
}

interface PlaybackState {
  /** 已完全显示的条目索引（已播完 + 正在播放的条目前） */
  visibleCount: number;
  /** 当前正在播放的条目（think 打字机）的已显示字符数 */
  currentCharCount: number;
  /** 当前 Agent 索引（0-based，与 AgentPipelineView currentAgentIndex 语义对齐） */
  agentIndex: number;
  /** 是否已全部播完 */
  finished: boolean;
}

const AGENT_ORDER: AgentType[] = ['architect', 'code', 'economist', 'chief'];

/** 找出每条 log 所属的 Agent 索引 */
function getAgentIndex(log: IAgentActionLog): number {
  const idx = AGENT_ORDER.indexOf(log.agent as AgentType);
  return idx >= 0 ? idx : 0;
}

export function useActionPlayer({
     fullLogs,
     enabled,
     paused,
     agentGapMs = 600,
     thinkCharMs = 35,
     thinkHoldMs = 1500,
     toolCallMs = 700,
     toolResultDelayMs = 350,
     toolResultHoldMs = 2000,
     conclusionDelayMs = 500,
     conclusionHoldMs = 3000,
     keyPointDelayMs = 400,
   }: UseActionPlayerOptions) {
  const [state, setState] = useState<PlaybackState>({
    visibleCount: 0,
    currentCharCount: 0,
    agentIndex: 0,
    finished: false,
  });

  // 用户是否主动滚动过（滚动则暂停自动滚动，但不暂停播放）
  const userScrolledRef = useRef(false);
  // 播放计时器
  const timerRef = useRef<number | null>(null);
  // 是否已跳过
  const skippedRef = useRef(false);

  // 重置：当 fullLogs 或 enabled 变化时
  useEffect(() => {
    if (enabled && fullLogs.length > 0) {
      skippedRef.current = false;
      userScrolledRef.current = false;
      setState({
        visibleCount: 0,
        currentCharCount: 0,
        agentIndex: 0,
        finished: false,
      });
    } else if (!enabled) {
      // 非播放模式：直接全部显示
      skippedRef.current = false;
      setState({
        visibleCount: fullLogs.length,
        currentCharCount: 0,
        agentIndex: 4,
        finished: true,
      });
    }
  }, [enabled, fullLogs.length]);

  // 清理定时器
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 跳过：直接全部显示
  const skip = useCallback(() => {
    skippedRef.current = true;
    clearTimer();
    setState({
      visibleCount: fullLogs.length,
      currentCharCount: 0,
      agentIndex: 4,
      finished: true,
    });
  }, [fullLogs.length, clearTimer]);

  // 重新播放
  const replay = useCallback(() => {
    if (!enabled) return;
    skippedRef.current = false;
    userScrolledRef.current = false;
    clearTimer();
    setState({
      visibleCount: 0,
      currentCharCount: 0,
      agentIndex: 0,
      finished: false,
    });
  }, [enabled, clearTimer]);

  // 主播放循环
  useEffect(() => {
    if (!enabled || paused || state.finished || skippedRef.current) {
      clearTimer();
      return;
    }
    if (fullLogs.length === 0) return;

    // 当前状态分析
    const { visibleCount, currentCharCount, agentIndex } = state;

    // 全部播完？
    if (visibleCount >= fullLogs.length) {
      setState((s) => ({ ...s, finished: true, agentIndex: 4 }));
      return;
    }

    const currentLog = fullLogs[visibleCount];
    const logAgentIdx = getAgentIndex(currentLog);

    // Agent 切换：当前条目所属 Agent > 已显示 AgentIndex
    if (logAgentIdx > agentIndex) {
      // 停顿后进入下一个 Agent
      timerRef.current = window.setTimeout(() => {
        setState((s) => ({
          ...s,
          agentIndex: logAgentIdx,
        }));
      }, agentGapMs);
      return;
    }

    // 按类型处理
    if (currentLog.type === 'think') {
      // 打字机变速：根据内容特征判断节奏
      // - 列举类（含「1.」「2.」「-」等列表标记）→ 快（~60% 速度）
      // - 推理权衡类（含「但是」「然而」「因此」「权衡」「trade-off」）→ 慢（~140% 速度）
      // - 关键结论前（「所以」「综上」「推荐」「结论是」开头的 think）→ 先停 keyPointDelayMs 再开始
      const text = currentLog.content;
      const isEnumeration = /^(一|二|三|四|五|[1-9][\.、、])/.test(text) || /^[-•]/.test(text) || /[:：]$/.test(text);
      const isReasoning = /(但是|然而|因此|权衡|trade[\s-]?off|风险|代价|考虑到|从.*角度看)/.test(text);
      const isKeyConclusion = /^(所以|综上|因此|推荐|结论|最终|基于以上)/.test(text);

      let charMs = thinkCharMs;
      if (isEnumeration) charMs = Math.max(8, thinkCharMs * 0.55);
      else if (isReasoning) charMs = Math.round(thinkCharMs * 1.5);

      const totalLen = text.length;

      // 关键结论：先停顿 keyPointDelayMs 再开始打字
      if (isKeyConclusion && currentCharCount === 0) {
        timerRef.current = window.setTimeout(() => {
          setState((s) => ({ ...s, currentCharCount: 1 }));
        }, keyPointDelayMs);
        return;
      }

      if (currentCharCount < totalLen) {
        timerRef.current = window.setTimeout(() => {
          setState((s) => ({
            ...s,
            currentCharCount: Math.min(s.currentCharCount + 1, totalLen),
          }));
        }, charMs);
       } else {
         // 打完了，停留 thinkHoldMs 让用户读完，再进入下一条
         timerRef.current = window.setTimeout(() => {
           setState((s) => ({
             ...s,
             visibleCount: s.visibleCount + 1,
             currentCharCount: 0,
           }));
         }, thinkHoldMs);
       }
      return;
    }

    if (currentLog.type === 'tool_call') {
       // tool_call 条目：直接显示（不打字机），停留 toolCallMs 后进入下一条
       // 注意：不同步 setState 触发 effect 重跑，否则 cleanup 会清掉刚设的 timer 导致播放卡死
       timerRef.current = window.setTimeout(() => {
         setState((s) => ({
           ...s,
           visibleCount: s.visibleCount + 1,
           currentCharCount: 0,
         }));
       }, toolCallMs);
       return;
     }

     if (currentLog.type === 'tool_result') {
       // 短暂停顿后淡入，然后停留 toolResultHoldMs 让用户读完
       timerRef.current = window.setTimeout(() => {
         setState((s) => ({
           ...s,
           visibleCount: s.visibleCount + 1,
           currentCharCount: 0,
         }));
         // 显示后再停留 hold 时间（通过下一条的延迟体现）
         // 注意：这里 visibleCount+1 表示本条已显示，下一条的延迟将由下一条的处理逻辑控制
         // 我们把 toolResultHoldMs 放在 tool_result 显示后、下一条开始前
       }, toolResultDelayMs + toolResultHoldMs);
       return;
     }

     if (currentLog.type === 'conclusion') {
       // 停顿后出现（结论整段一次性显示，带强调效果），然后停留 conclusionHoldMs
       timerRef.current = window.setTimeout(() => {
         setState((s) => ({
           ...s,
           visibleCount: s.visibleCount + 1,
           currentCharCount: 0,
         }));
       }, conclusionDelayMs + conclusionHoldMs);
       return;
     }

    // 其他类型直接进入下一条
    setState((s) => ({ ...s, visibleCount: s.visibleCount + 1 }));

    return clearTimer;
   }, [
     enabled,
     paused,
     state,
     fullLogs,
     agentGapMs,
     thinkCharMs,
     thinkHoldMs,
     toolCallMs,
     toolResultDelayMs,
     toolResultHoldMs,
     conclusionDelayMs,
     conclusionHoldMs,
     keyPointDelayMs,
     clearTimer,
   ]);

  // 计算当前正在播放条目的可见文本（打字机效果）
  const currentTypingText = useMemo(() => {
    if (state.finished || state.visibleCount >= fullLogs.length) return '';
    const log = fullLogs[state.visibleCount];
    if (!log || log.type !== 'think') return '';
    return log.content.slice(0, state.currentCharCount);
  }, [state.visibleCount, state.currentCharCount, state.finished, fullLogs]);

  // 当前正在播放的条目
  const currentPlayingLog = useMemo(() => {
    if (state.finished || state.visibleCount >= fullLogs.length) return null;
    return fullLogs[state.visibleCount] || null;
  }, [state.visibleCount, state.finished, fullLogs]);

  // 已完全显示的日志（不包含正在打字的那条 think）
  const completedLogs = useMemo(() => {
    return fullLogs.slice(0, state.visibleCount);
  }, [fullLogs, state.visibleCount]);

  return {
    /** 已完全显示的日志 */
    completedLogs,
    /** 当前正在播放的条目（可能正在打字） */
    currentPlayingLog,
    /** 当前打字机文本（think 类型才有效） */
    currentTypingText,
    /** 当前 Agent 索引（0-4） */
    agentIndex: state.agentIndex,
    /** 是否已全部播完 */
    finished: state.finished,
    /** 跳过：全部立即显示 */
    skip,
    /** 重新播放 */
    replay,
    /** 用户滚动标记 */
    userScrolledRef,
  };
}
