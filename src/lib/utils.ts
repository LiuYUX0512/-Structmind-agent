import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { IStructureScheme } from '@/data/structure';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 排名条目（与 IAgentPipelineResult.ranking 元素结构一致） */
export interface IRankingItem {
  schemeId: string;
  schemeName: string;
  score: number;
  breakdown: Record<string, number>;
}

/**
 * 按排名顺序对方案列表排序（排名越靠前越在前；未上榜的排最后）
 */
export function sortSchemesByRanking(
  schemes: IStructureScheme[],
  ranking: IRankingItem[]
): IStructureScheme[] {
  return [...schemes].sort((a, b) => {
    const rankA = ranking.findIndex((x) => x.schemeId === a.id);
    const rankB = ranking.findIndex((x) => x.schemeId === b.id);
    if (rankA === -1 && rankB === -1) return 0;
    if (rankA === -1) return 1;
    if (rankB === -1) return -1;
    return rankA - rankB;
  });
}
