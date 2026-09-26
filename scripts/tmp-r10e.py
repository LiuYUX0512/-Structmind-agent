# -*- coding: utf-8 -*-
"""Part E：ReportPrintView 升级（advice/knowledgeBasis/雷达图）"""
import io, sys, traceback
p = r'C:\Users\31482\Doubao\chats\2026-09-26\new-chat\StructMind-Agent\src\components\ReportPrintView.tsx'
s = io.open(p, encoding='utf-8').read()

def rep(old, new, tag):
    global s
    assert s.count(old) == 1, (tag, s.count(old))
    s = s.replace(old, new, 1)
    print('OK ' + tag)

try:
    # 1. import advice 类型
    rep("""import {
  type IProjectParams,
  type IStructureScheme,
  type IRecommendation,
  type IWeightConfig,
  calculateBuildingHeight,
} from '@/data/structure';""",
    """import {
  type IProjectParams,
  type IStructureScheme,
  type IRecommendation,
  type IWeightConfig,
  calculateBuildingHeight,
} from '@/data/structure';
import type { IAgentPipelineResult } from '@/agent/types';""",
    'e-import')

    # 2. props
    rep("""interface ReportPrintViewProps {
  params: IProjectParams | null;
  schemes: IStructureScheme[];
  recommendation: IRecommendation | null;
  weights: IWeightConfig;
  isDemoMode: boolean;
}""",
    """interface ReportPrintViewProps {
  params: IProjectParams | null;
  schemes: IStructureScheme[];
  recommendation: IRecommendation | null;
  weights: IWeightConfig;
  isDemoMode: boolean;
  /** 总工建议（反思/风险/置信度结构化字段） */
  advice?: IAgentPipelineResult['advice'] | null;
  /** 规范校核结果（knowledgeBasis 条文依据） */
  codeChecks?: Record<string, unknown>;
}""",
    'e-props')

    # 3. 组件签名
    rep("""function ReportPrintView({ params, schemes, recommendation, weights, isDemoMode }: ReportPrintViewProps) {""",
    """function ReportPrintView({ params, schemes, recommendation, weights, isDemoMode, advice, codeChecks }: ReportPrintViewProps) {""",
    'e-signature')

    # 4. SchemeRadar 组件（插在 getStatusIcon 后）
    rep("""function getStatusIcon(status: string) {
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
}""",
    """function getStatusIcon(status: string) {
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
}""",
    'e-radar')

    # 5. 第二章：方案表后加雷达行
    rep("""          </tbody>
        </table>
      </section>

      {/* ========== 第三章：规范校核明细 ========== */}""",
    """          </tbody>
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

      {/* ========== 第三章：规范校核明细 ========== */}""",
    'e-radar-row')

    # 6. 第三章：每方案加 knowledgeBasis 条文依据
    rep("""                <div className="text-sm text-gray-600 mb-2">
                  <span className="font-medium">规范依据：</span>
                  {scheme.normCompliance.standards.join('、')}
                </div>""",
    """                <div className="text-sm text-gray-600 mb-2">
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
                })()}""",
    'e-knowledge')

    # 7. 第五章：advice 结构化接入
    rep("""        <div className="space-y-4">
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
            <p className="text-sm text-gray-700">
              本报告结果基于方案阶段的简化计算模型与经验数据，置信度约为{' '}
              <span className="font-semibold">75%~85%</span>
              。详细设计阶段需采用专业结构分析软件进行精确计算，并由注册结构工程师审核确认。
            </p>
          </div>

          <div>
            <h3 className="text-base font-semibold text-gray-800 mb-2">风险触发条件</h3>
            <ul className="text-sm text-gray-700 list-disc list-inside space-y-1">
              {riskItems.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
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
        </div>""",
    """        {(() => {
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
        })()}""",
    'e-advice')

    io.open(p, 'w', encoding='utf-8', newline='').write(s)
    s2 = io.open(p, encoding='utf-8').read()
    for key in ['SchemeRadar', 'knowledgeBasis', 'advice ?? null', '条文依据（可追溯）']:
        assert key in s2, key
        print('VERIFY ' + key)
    print('PART E DONE')
except Exception:
    traceback.print_exc()
    sys.exit(1)
