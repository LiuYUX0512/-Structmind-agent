// 工程历史版本管理（本地 localStorage，最多保留 10 版）
// 工程实践刚需：改一版参数 → 存一版结果 → 支持对比与回溯
// 存储接口可注入（便于测试时用内存实现替代 localStorage）

import type { IProjectParams } from '@/data/structure';
import type { IAgentPipelineResult, IHumanOverrides } from '@/agent/types';

export interface IHistoryEntry {
  /** 唯一 ID（时间戳） */
  id: string;
  /** 运行时间戳（ms） */
  timestamp: number;
  /** 该版输入参数 */
  params: IProjectParams;
  /** 推荐结果摘要 */
  recommended: {
    schemeId: string;
    schemeName: string;
    overallScore: number;
  };
  ranking: Array<{
    schemeId: string;
    schemeName: string;
    score: number;
  }>;
  /** 规范校核原始结果 */
  codeChecks: Record<string, unknown>;
  /** 经济绿色指标原始结果 */
  metrics: Record<string, unknown>;
  /** 该版携带的人类在环干预项 */
  humanOverrides?: IHumanOverrides;
  /** 超出预算上限的方案（如有） */
  budgetExceeded?: string[];
  /** 总工建议（含风险/置信度） */
  advice?: IAgentPipelineResult['advice'];
}

export const HISTORY_STORAGE_KEY = 'structmind_project_history_v1';
export const HISTORY_MAX_ENTRIES = 10;

/** localStorage 的最小可注入形态（便于单测） */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function loadHistory(storage: StorageLike = localStorage): IHistoryEntry[] {
  try {
    const raw = storage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as IHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

/** 保存一版：最新在前，超 10 版裁剪最旧 */
export function saveHistoryEntry(
  entry: IHistoryEntry,
  storage: StorageLike = localStorage
): IHistoryEntry[] {
  const list = loadHistory(storage);
  // 同参数同时间的重复保存去重（连续点两次生成）
  const dedup = list.filter((h) => h.id !== entry.id);
  dedup.unshift(entry);
  const trimmed = dedup.slice(0, HISTORY_MAX_ENTRIES);
  try {
    storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage 满/不可用：静默失败，不影响主流程
  }
  return trimmed;
}

export function clearHistory(storage: StorageLike = localStorage): void {
  try {
    storage.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** 从管线结果构建历史条目 */
export function buildHistoryEntry(
  params: IProjectParams,
  result: IAgentPipelineResult
): IHistoryEntry {
  return {
    id: `${Date.now()}`,
    timestamp: Date.now(),
    params,
    recommended: {
      schemeId: result.recommended.schemeId,
      schemeName: result.recommended.schemeName,
      overallScore: result.recommended.overallScore,
    },
    ranking: result.ranking.map((r) => ({
      schemeId: r.schemeId,
      schemeName: r.schemeName,
      score: r.score,
    })),
    codeChecks: result.codeChecks,
    metrics: result.metrics,
    humanOverrides: result.humanOverrides,
    budgetExceeded: result.budgetExceeded,
    advice: result.advice,
  };
}
