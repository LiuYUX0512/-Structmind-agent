import { format } from 'date-fns';
import type { IStructureScheme, IRecommendation } from '@/data/structure';

/**
 * 导出方案对比 CSV（UTF-8 BOM，Excel 中文不乱码）
 */
export function exportSchemeComparisonCsv(
  schemes: IStructureScheme[],
  recommendation: IRecommendation | null
): void {
  if (schemes.length === 0) return;

  const header = [
    '方案名称',
    '结构体系',
    '造价(元/㎡)',
    '工期(天)',
    '抗震性能(分)',
    '装配率(%)',
    '碳排放(kgCO₂/㎡)',
    '施工难度(分)',
    '综合得分',
    '推荐理由摘要',
  ];

  const rows = schemes.map((s) => {
    const m = s.metrics;
    const isRecommended = recommendation?.schemeId === s.id;
    const reason = isRecommended && recommendation
      ? recommendation.reason.replace(/[\r\n,，]/g, ' ').slice(0, 80)
      : '';

    const precastRate =
      typeof (m as any).precastRate === 'object'
        ? (m as any).precastRate?.rate ?? 0
        : (m as any).precastRate ?? 0;
    const carbon = (m as any).carbonEmission ?? 0;
    const score = isRecommended ? recommendation?.overallScore ?? '' : '';

    return [
      isRecommended ? `${s.name}（推荐）` : s.name,
      s.name,
      String(m.cost),
      String(Math.round(m.duration * 30)),
      String(m.seismicPerformance),
      String(precastRate),
      String(carbon),
      String(m.constructionDifficulty),
      String(score),
      reason,
    ];
  });

  // 组装 CSV（用双引号包裹每个字段，防逗号）
  const escape = (val: string | number) =>
    `"${String(val).replace(/"/g, '""')}"`;

  const csvLines = [header.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))];
  const csvContent = csvLines.join('\n');

  // UTF-8 BOM，确保 Excel 打开中文不乱码
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8' });

  const dateStr = format(new Date(), 'yyyyMMdd');
  const fileName = `智构StructMind_方案对比_${dateStr}.csv`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
