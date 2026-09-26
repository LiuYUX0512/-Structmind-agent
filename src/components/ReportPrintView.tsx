import { memo, useMemo } from 'react';
import {
  type IProjectParams,
  type IStructureScheme,
  type IRecommendation,
  type IWeightConfig,
  calculateBuildingHeight,
} from '@/data/structure';
import type { IAgentPipelineResult } from '@/agent/types';

interface ReportPrintViewProps {
  params: IProjectParams | null;
  schemes: IStructureScheme[];
  recommendation: IRecommendation | null;
  weights: IWeightConfig;
  isDemoMode: boolean;
  /** 总工建议（反思/风险/置信度结构化字段） */
  advice?: IAgentPipelineResult['advice'] | null;
  /** 规范校核结果（knowledgeBasis 条文依据） */
  codeChecks?: Record<string, unknown>;
}

const BUILDING_TYPE_LABEL: Record<string, string> = {
  residential: '住宅建筑',
  office: '办公建筑',
  school: '教学建筑',
  factory: '工业厂房',
  gymnasium: '大跨度建筑',
};

const STRUCTURE_LABEL: Record<string, string> = {
  frame: '框架结构',
  'frame-shearwall': '框架-剪力墙结构',
  shearwall: '剪力墙结构',
  steel: '钢结构',
  prefabricated: '装配式混凝土结构',
  'prefab-steel': '装配式钢结构',
  composite: '钢-混凝土组合结构',
  any: '不限（智能推荐）',
};

const FORTIFICATION_LABEL: Record<string, string> = {
  standard: '标准设防类（丙类）',
  key: '重点设防类（乙类）',
  special: '特殊设防类（甲类）',
  moderate: '适度设防类（丁类）',
};

const GEOLOGY_LABEL: Record<string, string> = {
  rock: '岩石地基',
  clay: '一般黏土',
  loess: '湿陷性黄土',
  fill: '人工填土/其他',
  other: '其他地质',
};

function getStatusIcon(status: string) {
  switch (status) {
    case 'pass':
      return '✅';
    case 'warning':
      return '⚠️';
    case 'fail':
      return '❌';
    default:
      return '—';
  }
}

/** 六维雷达图（打印友好：纯 SVG 自绘，无外部依赖） */
function SchemeRadar({ scheme }: { scheme: IStructureScheme }) {
  const dims = useMemo(() => {
    const m = scheme.metrics;
    const clamp = (v: number) => Math.max(0, Math.min(10, v));
    return [
      { label: '造价经济', value: clamp(10 - m.cost / 800) },
      { label: '工期效率', value: clamp(10 - m.duration) },
      { label: '抗震性能', value: clamp(m.seismicPerformance) },
      { label: '施工难度', value: clamp(10 - m.constructionDifficulty) },
      { label: '绿色低碳', value: clamp(10 - m.carbonEmission / 150) },
      { label: '装配率', value: clamp(m.precastRate.rate / 10) },
    ];
  }, [scheme]);

  const cx = 100;
  const cy = 100;
  const R = 62;
  const pt = (i: number, r: number): [number, number] => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / 6;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const ringPts = (r: number) => Array.from({ length: 6 }, (_, i) => pt(i, r).join(',')).join(' ');
  const dataPts = dims.map((d, i) => pt(i, (d.value / 10) * R).join(',')).join(' ');

  return (
    <svg width="210" height="200" viewBox="0 0 200 200" className="mx-auto print-block">
      {[0.25, 0.5, 0.75, 1].map((k) => (
        <polygon key={k} points={ringPts(R * k)} fill="none" stroke="#cbd5e1" strokeWidth="0.6" />
      ))}
      {dims.map((_, i) => {
        const [x, y] = pt(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#cbd5e1" strokeWidth="0.6" />;
      })}
      <polygon points={dataPts} fill="rgba(18, 165, 181, 0.25)" stroke="#0e7490" strokeWidth="1.2" />
      {dims.map((d, i) => {
        const [x, y] = pt(i, ((d.value / 10) * R));
        return <circle key={i} cx={x} cy={y} r="1.8" fill="#0e7490" />;
      })}
      {dims.map((d, i) => {
        const [x, y] = pt(i, R + 16);
        return (
          <text key={i} x={x} y={y} textAnchor="middle" fontSize="7" fill="#475569" dominantBaseline="middle">
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}

function ReportPrintView({ params, schemes, recommendation, weights, isDemoMode, advice, codeChecks }: ReportPrintViewProps) {
  const reportDate = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }, []);

  const recommendedScheme = useMemo(() => {
    if (!recommendation) return null;
    return schemes.find((s) => s.id === recommendation.schemeId) || null;
  }, [recommendation, schemes]);

  const height = params ? calculateBuildingHeight(params.floors) : 0;

  // 生成推荐理由 bullet 列表（从 reason 文本解析）
  const recommendationBullets = useMemo(() => {
    if (!recommendation?.reason) return [];
    const lines = recommendation.reason
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && /^[-*]/.test(l) === false); // 去掉 markdown 列表符号行
    // 尝试提取 3-5 条关键句子
    const sentences = recommendation.reason
      .replace(/[#>*\-]/g, '')
      .split(/[。；\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 6 && s.length < 80)
      .slice(0, 5);
    return sentences.length > 0 ? sentences : lines.slice(0, 5);
  }, [recommendation]);

  // 生成风险提示
  const riskItems = useMemo(() => {
    if (!recommendedScheme) return [];
    const items: string[] = [];
    if (recommendedScheme.metrics.seismicPerformance < 7) {
      items.push('抗震性能评分低于 7 分，需重点关注高烈度区的结构布置与消能减震设计。');
    }
    if (recommendedScheme.metrics.constructionDifficulty > 7) {
      items.push('施工难度较高，建议选择有同类工程经验的施工单位，提前做好深化设计。');
    }
    if (recommendedScheme.safetyRiskNotes && recommendedScheme.safetyRiskNotes.length > 0) {
      items.push(...recommendedScheme.safetyRiskNotes.slice(0, 2));
    }
    if (params && Number(params.seismicIntensity) >= 8 && height > 100) {
      items.push('本工程属于超限高层建筑范畴，需按规定组织超限工程抗震设防专项审查。');
    }
    if (items.length === 0) {
      items.push('本方案在常规适用范围内，无重大风险点，但仍需在初步设计阶段进行详细计算验证。');
    }
    return items.slice(0, 4);
  }, [recommendedScheme, params, height]);

  // 下一步建议
  const nextSteps = useMemo(() => {
    return [
      '委托具有相应资质的勘察单位进行详细岩土工程勘察，提供准确的地基参数与承载力特征值。',
      '由注册结构工程师主持，采用专业结构分析软件（如 YJK、PKPM、SAP2000 等）进行多遇地震及罕遇地震下的详细计算分析。',
      '开展初步设计阶段的建筑结构一体化优化，重点关注柱网布置、剪力墙布置及核心筒尺寸的合理性。',
      '针对重点部位（转换层、加强层、大跨度空间等）进行专项分析，必要时进行弹塑性时程分析。',
      '组织施工图审查前的内部质量校核，确保各项指标满足现行国家规范要求。',
    ];
  }, []);

  return (
    <div className="print-report bg-white text-black p-12">
      {/* ========== 封面 ========== */}
      <section className="report-cover">
        <div className="border-b-4 border-primary pb-6 mb-12">
          <div className="text-xs text-gray-500 tracking-widest mb-2">STRUCTURAL SCHEME OPTIMIZATION REPORT</div>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">智构 StructMind</h1>
          <p className="text-lg text-gray-600">建筑结构方案优化分析报告</p>
        </div>

        <div className="space-y-6 mb-16">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="text-xs text-gray-500 mb-1">报告日期</div>
              <div className="text-lg font-semibold">{reportDate}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">报告编号</div>
              <div className="text-lg font-mono font-semibold">
                SC-{new Date().toISOString().slice(0, 10).replace(/-/g, '')}
              </div>
            </div>
          </div>

          <div className="border border-gray-200 rounded-lg p-6 bg-gray-50">
            <div className="text-sm font-semibold text-gray-700 mb-3">项目概况</div>
            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <div className="text-gray-500">建筑类型</div>
              <div className="font-medium">{params ? BUILDING_TYPE_LABEL[params.buildingType] || params.buildingType : '—'}</div>
              <div className="text-gray-500">建筑层数</div>
              <div className="font-medium">{params ? `${params.floors} 层（约 ${height} m）` : '—'}</div>
              <div className="text-gray-500">建筑面积</div>
              <div className="font-medium">{params ? `${params.area.toLocaleString()} ㎡` : '—'}</div>
              <div className="text-gray-500">抗震设防烈度</div>
              <div className="font-medium">{params ? `${params.seismicIntensity} 度` : '—'}</div>
              <div className="text-gray-500">场地土类别</div>
              <div className="font-medium">{params ? `${params.soilCategory} 类` : '—'}</div>
              <div className="text-gray-500">结构体系偏好</div>
              <div className="font-medium">{params ? STRUCTURE_LABEL[params.structurePreference] || params.structurePreference : '—'}</div>
            </div>
          </div>
        </div>

        <div className="text-xs text-gray-400 mt-auto">
          本报告由智构 StructMind 智能体自动生成，仅供方案阶段参考
          {isDemoMode && '（演示模式）'}
        </div>
      </section>

      {/* ========== 第一章：项目参数摘要 ========== */}
      <section className="report-section">
        <h2 className="text-2xl font-bold border-b-2 border-primary pb-2 mb-6">
          第一章  项目参数摘要
        </h2>
        <table className="w-full text-sm border-collapse">
          <tbody>
            <tr className="border-b border-gray-200">
              <td className="py-2 pr-4 text-gray-500 w-1/4">建筑类型</td>
              <td className="py-2 font-medium">{params ? BUILDING_TYPE_LABEL[params.buildingType] || params.buildingType : '—'}</td>
              <td className="py-2 pr-4 text-gray-500 w-1/4">建筑层数 / 高度</td>
              <td className="py-2 font-medium">{params ? `${params.floors} 层 / 约 ${height} m` : '—'}</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="py-2 pr-4 text-gray-500">建筑面积</td>
              <td className="py-2 font-medium">{params ? `${params.area.toLocaleString()} ㎡` : '—'}</td>
              <td className="py-2 pr-4 text-gray-500">主要跨度</td>
              <td className="py-2 font-medium">{params ? `${params.mainSpan} m` : '—'}</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="py-2 pr-4 text-gray-500">抗震设防烈度</td>
              <td className="py-2 font-medium">{params ? `${params.seismicIntensity} 度` : '—'}</td>
              <td className="py-2 pr-4 text-gray-500">抗震设防类别</td>
              <td className="py-2 font-medium">{params ? FORTIFICATION_LABEL[params.fortificationCategory] || params.fortificationCategory : '—'}</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="py-2 pr-4 text-gray-500">场地土类别</td>
              <td className="py-2 font-medium">{params ? `${params.soilCategory} 类` : '—'}</td>
              <td className="py-2 pr-4 text-gray-500">场地地质</td>
              <td className="py-2 font-medium">{params ? GEOLOGY_LABEL[params.geologyType] || params.geologyType : '—'}</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="py-2 pr-4 text-gray-500">基本风压</td>
              <td className="py-2 font-medium">{params ? `${params.windPressure} kN/㎡` : '—'}</td>
              <td className="py-2 pr-4 text-gray-500">基本雪压</td>
              <td className="py-2 font-medium">{params ? `${params.snowPressure} kN/㎡` : '—'}</td>
            </tr>
            <tr>
              <td className="py-2 pr-4 text-gray-500">预算约束</td>
              <td className="py-2 font-medium">{params ? `${params.budget.toLocaleString()} 元/㎡` : '—'}</td>
              <td className="py-2 pr-4 text-gray-500">结构体系偏好</td>
              <td className="py-2 font-medium">{params ? STRUCTURE_LABEL[params.structurePreference] || params.structurePreference : '—'}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-6 text-sm">
          <div className="text-gray-700 font-semibold mb-2">优化目标权重</div>
          <div className="flex gap-4 flex-wrap">
            <span className="text-gray-600">造价经济：<span className="font-medium">{weights.cost}%</span></span>
            <span className="text-gray-600">工期效率：<span className="font-medium">{weights.duration}%</span></span>
            <span className="text-gray-600">安全性能：<span className="font-medium">{weights.safety}%</span></span>
            <span className="text-gray-600">绿色低碳：<span className="font-medium">{weights.green}%</span></span>
          </div>
        </div>
      </section>

      {/* ========== 第二章：候选方案对比表 ========== */}
      <section className="report-section">
        <h2 className="text-2xl font-bold border-b-2 border-primary pb-2 mb-6">
          第二章  候选方案对比
        </h2>

        <table className="w-full text-sm border-collapse border border-gray-300">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 px-3 py-2 text-left font-semibold">指标</th>
              {schemes.map((s, i) => (
                <th
                  key={s.id}
                  className={`border border-gray-300 px-3 py-2 text-center font-semibold ${
                    recommendation?.schemeId === s.id ? 'bg-primary text-white' : ''
                  }`}
                >
                  方案{i + 1}：{s.name}
                  {recommendation?.schemeId === s.id && '  ★推荐'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-gray-300 px-3 py-2 text-gray-600">单方造价</td>
              {schemes.map((s) => (
                <td key={s.id} className="border border-gray-300 px-3 py-2 text-center font-mono">
                  {s.metrics.cost} 元/㎡
                </td>
              ))}
            </tr>
            <tr className="bg-gray-50">
              <td className="border border-gray-300 px-3 py-2 text-gray-600">建设工期</td>
              {schemes.map((s) => (
                <td key={s.id} className="border border-gray-300 px-3 py-2 text-center font-mono">
                  {s.metrics.duration} 个月
                </td>
              ))}
            </tr>
            <tr>
              <td className="border border-gray-300 px-3 py-2 text-gray-600">装配率</td>
              {schemes.map((s) => (
                <td key={s.id} className="border border-gray-300 px-3 py-2 text-center font-mono">
                  {s.metrics.precastRate.rate}%（{s.metrics.precastRate.grade}）
                </td>
              ))}
            </tr>
            <tr className="bg-gray-50">
              <td className="border border-gray-300 px-3 py-2 text-gray-600">碳排放估算</td>
              {schemes.map((s) => (
                <td key={s.id} className="border border-gray-300 px-3 py-2 text-center font-mono">
                  {s.metrics.carbonEmission} kgCO₂/㎡
                </td>
              ))}
            </tr>
            <tr>
              <td className="border border-gray-300 px-3 py-2 text-gray-600">抗震性能</td>
              {schemes.map((s) => (
                <td key={s.id} className="border border-gray-300 px-3 py-2 text-center">
                  {s.metrics.seismicPerformance}/10
                </td>
              ))}
            </tr>
            <tr className="bg-gray-50">
              <td className="border border-gray-300 px-3 py-2 text-gray-600">施工难度</td>
              {schemes.map((s) => (
                <td key={s.id} className="border border-gray-300 px-3 py-2 text-center">
                  {s.metrics.constructionDifficulty}/10
                </td>
              ))}
            </tr>
            <tr>
              <td className="border border-gray-300 px-3 py-2 text-gray-600">综合得分</td>
              {schemes.map((s) => {
                const scoreItem = recommendation?.weightedScores?.find((w) => w.schemeId === s.id);
                return (
                  <td
                    key={s.id}
                    className={`border border-gray-300 px-3 py-2 text-center font-bold ${
                      recommendation?.schemeId === s.id ? 'text-primary text-lg' : ''
                    }`}
                  >
                    {scoreItem ? scoreItem.score.toFixed(2) : '—'}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>

        <div className="mt-6">
          <div className="text-sm font-semibold text-gray-700 mb-3">方案多维雷达对比</div>
          <div className="grid grid-cols-3 gap-4">
            {schemes.map((s, i) => (
              <div key={s.id} className="border border-gray-200 rounded-lg p-3 text-center">
                <div className="text-sm font-medium text-gray-800 mb-2">
                  方案{i + 1}：{s.name}
                </div>
                <SchemeRadar scheme={s} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========== 第三章：规范校核明细 ========== */}
      <section className="report-section">
        <h2 className="text-2xl font-bold border-b-2 border-primary pb-2 mb-6">
          第三章  规范校核明细
        </h2>

        {schemes.map((scheme, idx) => (
          <div key={scheme.id} className="mb-8">
            <h3 className="text-lg font-semibold mb-3 text-gray-800">
              方案{idx + 1}：{scheme.name}
            </h3>
            {scheme.normCompliance ? (
              <>
                <div className="text-sm text-gray-600 mb-2">
                  <span className="font-medium">规范依据：</span>
                  {scheme.normCompliance.standards.join('、')}
                </div>
                {(() => {
                  const cc = codeChecks?.[scheme.id] as
                    | { seismic?: { knowledgeBasis?: Array<{ code: string; clause: string; title: string; text?: string }> }; fire?: { knowledgeBasis?: Array<{ code: string; clause: string; title: string; text?: string }> } }
                    | undefined;
                  const basis = [
                    ...(cc?.seismic?.knowledgeBasis ?? []),
                    ...(cc?.fire?.knowledgeBasis ?? []),
                  ];
                  if (basis.length === 0) return null;
                  return (
                    <div className="mb-3 rounded-md border border-gray-200 bg-gray-50 p-3">
                      <div className="text-xs font-semibold text-gray-600 mb-1.5">条文依据（可追溯）</div>
                      <ul className="space-y-1">
                        {basis.map((b, bi) => (
                          <li key={bi} className="text-xs text-gray-600 leading-relaxed">
                            <span className="font-medium">{b.code}</span>
                            {b.clause && <span className="font-medium"> {b.clause}</span>}：{b.title}
                            {b.text && <span className="text-gray-500"> —— {b.text.slice(0, 90)}{b.text.length > 90 ? '…' : ''}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}
                <table className="w-full text-sm border-collapse border border-gray-300">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border border-gray-300 px-3 py-2 text-left w-10">序号</th>
                      <th className="border border-gray-300 px-3 py-2 text-left w-2/5">校核项目</th>
                      <th className="border border-gray-300 px-3 py-2 text-center w-20">结果</th>
                      <th className="border border-gray-300 px-3 py-2 text-left">说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scheme.normCompliance.checks.map((check, i) => (
                      <tr key={i} className={i % 2 === 1 ? 'bg-gray-50' : ''}>
                        <td className="border border-gray-300 px-3 py-2 text-center text-gray-500">{i + 1}</td>
                        <td className="border border-gray-300 px-3 py-2 font-medium">{check.name}</td>
                        <td className="border border-gray-300 px-3 py-2 text-center text-lg">
                          {getStatusIcon(check.status)}
                        </td>
                        <td className="border border-gray-300 px-3 py-2 text-gray-700">
                          {check.description}
                          {check.clauseText && (
                            <div className="text-xs text-gray-500 mt-1">
                              规范条文：{check.clauseText}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-2 text-sm text-gray-600 italic">
                  小结：{scheme.normCompliance.summary}
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-500">该校核项数据待补充。</p>
            )}
          </div>
        ))}
      </section>

      {/* ========== 第四章：推荐方案及理由 ========== */}
      <section className="report-section">
        <h2 className="text-2xl font-bold border-b-2 border-primary pb-2 mb-6">
          第四章  推荐方案及理由
        </h2>

        {recommendedScheme && recommendation ? (
          <>
            <div className="border-2 border-primary rounded-lg p-6 bg-primary/5 mb-6">
              <div className="text-sm text-primary font-semibold mb-1">综合推荐方案</div>
              <div className="text-3xl font-bold text-gray-900 mb-2">
                {recommendation.schemeName}
              </div>
              <div className="text-lg text-gray-600">
                综合得分：<span className="font-bold text-primary">{recommendation.overallScore.toFixed(2)}</span> / 10
              </div>
            </div>

            <div className="text-sm text-gray-700 leading-relaxed space-y-3">
              <div className="font-semibold text-gray-800 mb-2">推荐理由：</div>
              {recommendationBullets.length > 0 ? (
                <ol className="list-decimal list-inside space-y-2">
                  {recommendationBullets.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ol>
              ) : (
                <p>{recommendation.reason}</p>
              )}
            </div>
          </>
        ) : (
          <p className="text-gray-500">暂无推荐方案。</p>
        )}
      </section>

      {/* ========== 第五章：反思与风险提示 ========== */}
      <section className="report-section">
        <h2 className="text-2xl font-bold border-b-2 border-primary pb-2 mb-6">
          第五章  反思与风险提示
        </h2>

        {(() => {
          const adv = advice ?? null;
          const hasAdvice = !!adv && ((adv.risks?.length ?? 0) > 0 || (adv.riskTriggers?.length ?? 0) > 0 || !!adv.confidence);
          const advRisks = adv?.risks ?? [];
          const advTriggers = adv?.riskTriggers ?? [];
          const conf = adv?.confidence;
          return (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-gray-800 mb-2">反向质疑</h3>
                <ul className="text-sm text-gray-700 list-disc list-inside space-y-1">
                  <li>当前推荐方案在极端荷载组合下的冗余度是否足够？是否考虑了最不利工况？</li>
                  <li>若施工质量存在离散性，结构体系的鲁棒性（robustness）如何？</li>
                  <li>在建筑功能未来改造或荷载增加的场景下，该体系是否具备适应性？</li>
                </ul>
              </div>

              <div>
                <h3 className="text-base font-semibold text-gray-800 mb-2">置信度说明</h3>
                {hasAdvice && conf ? (
                  <div className="text-sm text-gray-700 space-y-1">
                    <p>
                      本报告由 AI 智能体基于方案阶段简化模型与经验数据生成，
                      置信度等级：<span className="font-semibold">{conf.level}</span>
                      {typeof conf.score === 'number' && <span className="text-gray-500">（{conf.score}%）</span>}。
                    </p>
                    {conf.reason && <p className="text-gray-600">{conf.reason}</p>}
                    {conf.uncertainties && conf.uncertainties.length > 0 && (
                      <ul className="list-disc list-inside text-gray-600">
                        {conf.uncertainties.slice(0, 3).map((u, i) => (
                          <li key={i}>{u}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-700">
                    本报告结果基于方案阶段的简化计算模型与经验数据，置信度约为{' '}
                    <span className="font-semibold">75%~85%</span>
                    。详细设计阶段需采用专业结构分析软件进行精确计算，并由注册结构工程师审核确认。
                  </p>
                )}
              </div>

              <div>
                <h3 className="text-base font-semibold text-gray-800 mb-2">风险触发条件</h3>
                <ul className="text-sm text-gray-700 list-disc list-inside space-y-1">
                  {advRisks.length > 0 ? (
                    advRisks.map((item, i) => <li key={i}>{item}</li>)
                  ) : (
                    riskItems.map((item, i) => <li key={i}>{item}</li>)
                  )}
                  {advTriggers.length > 0 && (
                    <li className="text-gray-600 mt-1">
                      <span className="font-medium">触发重新评估：</span>
                      {advTriggers.join('；')}
                    </li>
                  )}
                </ul>
              </div>

              <div>
                <h3 className="text-base font-semibold text-gray-800 mb-2">深化设计重点</h3>
                <ul className="text-sm text-gray-700 list-disc list-inside space-y-1">
                  <li>底部加强区剪力墙边缘构件的配筋构造与延性设计</li>
                  <li>转换层（如有）上下结构刚度突变的过渡处理</li>
                  <li>关键节点（梁柱节点、墙肢边缘构件）的构造详图设计</li>
                  <li>地基基础方案选型与沉降差控制</li>
                </ul>
              </div>
            </div>
          );
        })()}
      </section>

      {/* ========== 第六章：下一步建议 ========== */}
      <section className="report-section">
        <h2 className="text-2xl font-bold border-b-2 border-primary pb-2 mb-6">
          第六章  下一步建议
        </h2>

        <ol className="text-sm text-gray-700 list-decimal list-inside space-y-3">
          {nextSteps.map((step, i) => (
            <li key={i} className="leading-relaxed">{step}</li>
          ))}
        </ol>
      </section>

      {/* ========== 免责声明 ========== */}
      <section className="report-section">
        <h2 className="text-2xl font-bold border-b-2 border-primary pb-2 mb-6">
          免责声明
        </h2>

        <div className="text-sm text-gray-600 space-y-3 leading-relaxed">
          <p>
            1. 本报告由「智构 StructMind」智能体基于用户输入的项目参数自动生成，所有计算结果和建议
            <strong>仅用于建筑方案阶段的比选参考</strong>，不构成任何工程设计依据。
          </p>
          <p>
            2. 报告中的结构选型、造价估算、工期估算、规范校核等内容均基于经验数据和简化模型，
            与实际工程可能存在偏差。正式设计必须由具有相应资质的注册结构工程师主持，
            采用经过认证的专业结构分析软件，按照现行国家规范和标准进行详细计算。
          </p>
          <p>
            3. 本工具不对任何因使用本报告内容而产生的直接或间接损失承担责任。
            使用者应自行判断并承担全部风险。
          </p>
          <p>
            4. 如需进一步的结构设计咨询服务，请联系具有相应资质的建筑设计单位或专业工程师。
          </p>
          <p className="text-right text-gray-500 mt-6">
            —— 智构 StructMind · {reportDate}
          </p>
        </div>
      </section>
    </div>
  );
}

export default memo(ReportPrintView);
