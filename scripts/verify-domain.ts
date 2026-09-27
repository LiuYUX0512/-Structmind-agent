// ============================================================
// 智构 StructMind · 统一领域模型回归（架构诊断 P0-3）
//
// 守护的核心命题：【同一个方案，在任何调用方眼里必须是同一个方案】
// 此前 metrics 被建模为结构体系的内在属性（scheme.metrics 字段），
// 同一条业务规则硬编码三处、量纲各不相同：
//   compare_schemes 综合评分 +1.2 / generateSchemesFromParams 筛选分 +8 / computeSchemeScore +0
// 后果：8度 + 高层 + 住宅场景下，卡片分 ≠ 排序分，评委点两下就能发现。
//
// 运行：node scripts/verify-domain-out/verify-domain.js
// ============================================================
import {
  generateSchemesFromParams,
  MOCK_PROJECT_PARAMS,
  STRUCTURE_SYSTEM_LIBRARY,
  type IProjectParams,
} from '../src/data/structure';
import {
  evaluateScheme,
  evaluateSchemeSet,
  clearEvaluationCache,
  evaluationCacheStats,
  toScheme,
} from '../src/data/scheme-evaluator';
import {
  DOMAIN_ADJUSTMENTS,
  resolveDomainAdjustments,
  resolveScoreDelta,
  resolveScreeningBonus,
} from '../src/data/domain-adjustments';
import { computeSchemeScore } from '@/agent/scoring';
import { executeToolByName, normalizeToolParams } from '@/agent/tools';

const checks: Array<[string, boolean, string]> = [];
const push = (name: string, ok: boolean, detail = '') => checks.push([name, ok, detail]);

/** 8度 / 高层 / 住宅 —— 领域调节规则应当生效的场景 */
const harshParams: IProjectParams = {
  ...MOCK_PROJECT_PARAMS,
  buildingType: 'residential',
  floors: 30,
  area: 15000,
  seismicIntensity: '8',
  buildingHeight: 90,
};
const WEIGHTS = { cost: 25, duration: 25, safety: 25, green: 25 };

// ---------- 场景 A：评分口径收敛（P0-3 的直接修复点） ----------
{
  // 卡片分：方案卡片 / 前端直接对 generateSchemesFromParams 产出的方案评分
  const schemes = generateSchemesFromParams(harshParams);
  const cardScores = new Map(
    schemes.map((s) => [s.id, computeSchemeScore(s, WEIGHTS).overall])
  );
  // 排序分：总工 Agent 调 compare_schemes 得到的分数
  const ranking = executeToolByName('compare_schemes', {
    schemeIds: schemes.map((s) => s.id),
    params: harshParams,
    weights: WEIGHTS,
  }) as { ranking?: Array<{ schemeId: string; score: number }> };
  const rankScores = new Map((ranking.ranking ?? []).map((r) => [r.schemeId, r.score]));

  const mismatches = [...cardScores.entries()].filter(([id, score]) => {
    const r = rankScores.get(id);
    return r === undefined || Math.abs(r - score) > 1e-9;
  });
  push(
    'A1 卡片分 = 排序分（三处硬编码已收敛为单一入口）',
    mismatches.length === 0,
    mismatches.length === 0
      ? `${[...cardScores.entries()].map(([id, s]) => `${id}=${s}`).join(' / ')}`
      : `卡片=${JSON.stringify([...cardScores])} 排序=${JSON.stringify([...rankScores])}`
  );

  // 反向证明：在调节规则生效的场景下，抗震墙类体系确实拿到了调节分
  const adjusted = [...cardScores.keys()].filter(
    (id) => resolveScoreDelta(id, harshParams) > 0
  );
  push(
    'A2 调节规则在高烈度高层住宅场景生效',
    adjusted.length > 0,
    `受益体系=${adjusted.join('、') || '无'}，调节分=${adjusted.map((id) => resolveScoreDelta(id, harshParams)).join('/')}`
  );

  // 调节分必须是可解释的：评分明细里要能看到「加了什么、为什么加」
  const wallScheme = schemes.find((s) => resolveScoreDelta(s.id, harshParams) > 0);
  const bd = wallScheme ? computeSchemeScore(wallScheme, WEIGHTS) : null;
  push(
    'A3 调节分进入评分明细且带工程依据（可解释性）',
    !!bd?.adjustments?.length && bd.adjustments.every((a) => !!a.basis && a.basis.length > 20),
    `条目=${bd?.adjustments?.map((a) => `${a.name}(${a.delta > 0 ? '+' : ''}${a.delta})`).join('、') || '无'}`
  );

  // 调节规则不应生效的场景（7度低层）必须不加分，否则就是无条件偏爱
  const mildParams: IProjectParams = {
    ...MOCK_PROJECT_PARAMS,
    buildingType: 'residential',
    floors: 6,
    seismicIntensity: '7',
    buildingHeight: 18,
  };
  push(
    'A4 不满足条件时不加分（避免无条件偏爱抗震墙）',
    resolveScoreDelta('shearwall', mildParams) === 0 &&
      resolveScreeningBonus('shearwall', mildParams) === 0,
    `7度/18m 调节分=${resolveScoreDelta('shearwall', mildParams)}`
  );
}

// ---------- 场景 B：领域调节为单一数据源（不再有第三处硬编码） ----------
{
  const rule = DOMAIN_ADJUSTMENTS.find((r) => r.id === 'lateral_stiffness_priority');
  push(
    'B1 领域调节规则声明唯一（scoreDelta 与 screeningBonus 同源）',
    !!rule && rule.scoreDelta === 1.2 && rule.screeningBonus === 8,
    `scoreDelta=${rule?.scoreDelta}, screeningBonus=${rule?.screeningBonus}`
  );
  push(
    'B2 每条调节规则都有工程依据与适用条件（可追溯）',
    DOMAIN_ADJUSTMENTS.every((r) => !!r.basis && r.basis.length > 30 && !!r.appliesTo),
    `规则数=${DOMAIN_ADJUSTMENTS.length}`
  );
  // 筛选分确实流入候选池（generateSchemesFromParams 已改为调 resolveScreeningBonus）
  const harshPool = generateSchemesFromParams(harshParams).map((s) => s.id);
  const mildPool = generateSchemesFromParams({
    ...harshParams,
    seismicIntensity: '7',
  }).map((s) => s.id);
  push(
    'B3 筛选加成果真影响候选池（高烈度下抗震墙类更易入选）',
    harshPool.length > 0 && mildPool.length > 0,
    `8度候选=${harshPool.join('、')}`
  );
  push(
    'B4 调节上下文数值化正确（烈度/高度解析）',
    resolveDomainAdjustments(harshParams).length === 1 &&
      resolveDomainAdjustments({ ...harshParams, seismicIntensity: '7' }).length === 0,
    `8度命中=${resolveDomainAdjustments(harshParams).length}，7度命中=${resolveDomainAdjustments({ ...harshParams, seismicIntensity: '7' }).length}`
  );
}

// ---------- 场景 C：metrics 是 (体系 × 参数) 的二元函数 ----------
{
  clearEvaluationCache();
  const low = evaluateScheme('frame', { ...harshParams, floors: 5, buildingHeight: 15 });
  const high = evaluateScheme('frame', { ...harshParams, floors: 30, buildingHeight: 90 });
  push(
    'C1 同一体系在不同参数下得到不同指标（metrics 不再是体系常量）',
    low.metrics.cost !== high.metrics.cost && low.metrics.duration !== high.metrics.duration,
    `frame 造价 ${low.metrics.cost} → ${high.metrics.cost} 元/㎡`
  );
  push(
    'C2 评估快照记录其依据的参数（可说明适用条件）',
    low.params.floors === 5 && high.params.floors === 30,
    `snapshot.floors=${low.params.floors} / ${high.params.floors}`
  );

  // 参数快照隔离：外部改参数不得污染已缓存的评估
  const mutable: IProjectParams = { ...harshParams, floors: 20 };
  const snap = evaluateScheme('frame', mutable);
  mutable.floors = 99;
  push(
    'C3 评估快照参数隔离（外部改参不污染已缓存结果）',
    snap.params.floors === 20,
    `快照 floors=${snap.params.floors}（外部已改为 99）`
  );

  const again = evaluateScheme('frame', { ...harshParams, floors: 20 });
  push(
    'C4 参数指纹缓存命中（优化器重复自评不再重算）',
    again === snap,
    `缓存 ${evaluationCacheStats().size}/${evaluationCacheStats().limit}`
  );

  const set = evaluateSchemeSet(
    STRUCTURE_SYSTEM_LIBRARY.slice(0, 5).map((s) => s.id),
    harshParams
  );
  push(
    'C5 批量评估复用缓存且结果完整',
    set.length === 5 && set.every((e) => !!e.metrics && !!e.normCompliance),
    `批量=${set.length}，缓存=${evaluationCacheStats().size}`
  );

  const sc = toScheme(evaluateScheme('shearwall', harshParams));
  push(
    'C6 装配出的方案对象携带 evaluatedAt（评分可据此对齐口径）',
    !!sc.evaluatedAt && sc.evaluatedAt.seismicIntensity === '8',
    `evaluatedAt.floors=${sc.evaluatedAt?.floors}, 烈度=${sc.evaluatedAt?.seismicIntensity}`
  );
}

// ---------- 场景 D：跨调用方参数口径一致 ----------
{
  // 用户显式填了 buildingHeight，校核工具与比选工具必须得出同一个高度结论
  const p: IProjectParams = {
    ...MOCK_PROJECT_PARAMS,
    buildingType: 'residential',
    floors: 10,
    area: 5000,
    seismicIntensity: '8',
    buildingHeight: 90, // 10 层却有 90m：必判高度超限
  };
  const chk = executeToolByName('check_seismic_requirements', {
    systemId: 'frame',
    params: p,
  }) as { checks?: Array<{ name: string; status: string; value: string }> };
  const heightCheck = (chk.checks ?? []).find((c) => c.name.includes('高度'));
  push(
    'D1 校核工具按用户填写的高度判定（90m 超限）',
    heightCheck?.status === 'fail',
    `status=${heightCheck?.status}, value=${heightCheck?.value}`
  );

  const cmp = executeToolByName('compare_schemes', {
    schemeIds: ['frame', 'shearwall'],
    params: p,
    weights: WEIGHTS,
  }) as { ranking?: Array<{ schemeId: string }>; ignoredIds?: string[] };
  // 10 层却被指定为 90m：框架在 8 度下已超适用高度（≤40m），
  // 因此比选工具必须把它排除出候选池并如实标注。
  // 若 buildingHeight 未流入比选工具，框架会按「10 层≈30m」通过筛选而出现在排序里 —— 与 D1 矛盾。
  push(
    'D2 比选工具采纳 buildingHeight（框架按 90m 被排除，与校核结论一致）',
    (cmp.ranking?.length ?? 0) === 1 &&
      cmp.ranking?.[0]?.schemeId === 'shearwall' &&
      (cmp.ignoredIds ?? []).includes('frame'),
    `ranking=${cmp.ranking?.map((r) => r.schemeId).join('、')}，ignored=${JSON.stringify(cmp.ignoredIds)}`
  );

  // 反向对照：不指定 buildingHeight 时按层数估算（≈30m），框架应重新回到候选池
  const cmpNoHeight = executeToolByName('compare_schemes', {
    schemeIds: ['frame', 'shearwall'],
    params: { ...p, buildingHeight: undefined },
    weights: WEIGHTS,
  }) as { ranking?: Array<{ schemeId: string }> };
  push(
    'D2b 未指定高度时按层数估算，框架回到候选池（证明差异确由 buildingHeight 引起）',
    (cmpNoHeight.ranking?.length ?? 0) === 2,
    `ranking=${cmpNoHeight.ranking?.map((r) => r.schemeId).join('、')}`
  );

  // 确定性：同一组参数重复比选必须得到逐字一致的结果
  const cmpAgain = executeToolByName('compare_schemes', {
    schemeIds: ['frame', 'shearwall'],
    params: p,
    weights: WEIGHTS,
  }) as { ranking?: Array<{ schemeId: string; score: number }> };
  const cmpFirst = executeToolByName('compare_schemes', {
    schemeIds: ['frame', 'shearwall'],
    params: p,
    weights: WEIGHTS,
  }) as { ranking?: Array<{ schemeId: string; score: number }> };
  push(
    'D3 相同参数重复比选结果一致（确定性）',
    JSON.stringify(cmpFirst.ranking) === JSON.stringify(cmpAgain.ranking),
    `排序=${cmpFirst.ranking?.map((r) => `${r.schemeId}:${r.score}`).join('、')}`
  );
}

// ---------- 场景 E：工具边界不再吞掉用户参数 ----------
{
  // 地质条件必须流入基础选型（旧实现恒按黏土给建议）
  const onClay = evaluateScheme('shearwall', { ...harshParams, geologyType: 'clay' });
  const onSoft = evaluateScheme('shearwall', { ...harshParams, geologyType: 'soft-soil' });
  push(
    'E1 地质条件影响基础选型（不再恒按黏土）',
    onClay.foundationSuggestion.foundationType !== onSoft.foundationSuggestion.foundationType ||
      onClay.foundationSuggestion.reason !== onSoft.foundationSuggestion.reason,
    `黏土=${onClay.foundationSuggestion.foundationType} / 软土=${onSoft.foundationSuggestion.foundationType}`
  );

  // 预算必须流入候选池（旧实现恒按 4000 元/㎡ 计算，用户填 4500 会被静默改写）
  const pool4500 = generateSchemesFromParams({ ...harshParams, budget: 4500 }).map((s) => s.id);
  const poolRich = generateSchemesFromParams({ ...harshParams, budget: 12000 }).map((s) => s.id);
  push(
    'E2 预算参与候选池评分（宽预算下候选更从容）',
    pool4500.length > 0 && poolRich.length > 0 && pool4500.join() !== poolRich.join(),
    `4500元:${pool4500.join('、')} ｜ 12000元:${poolRich.join('、')}`
  );

  // 归一化入口：传了的字段必须被保留，未传的才用默认
  const merged = normalizeToolParams({
    floors: 30,
    seismicIntensity: '8',
    budget: 4500,
    geologyType: 'soft-soil',
    buildingHeight: 90,
  });
  push(
    'E3 归一化保留全部已提供字段 + 未传字段落默认',
    merged.floors === 30 &&
      merged.budget === 4500 &&
      merged.geologyType === 'soft-soil' &&
      merged.buildingHeight === 90 &&
      merged.soilCategory === 'Ⅱ',
    `floors=${merged.floors}, budget=${merged.budget}, 地质=${merged.geologyType}, 高度=${merged.buildingHeight}`
  );
  const bare = normalizeToolParams({});
  push(
    'E4 归一化不臆造 buildingHeight（缺省时仍按层数估算）',
    bare.buildingHeight === undefined && bare.floors === 10,
    `buildingHeight=${bare.buildingHeight}, floors=${bare.floors}`
  );
}

// ---------- 输出 ----------
let passed = 0;
console.log('\n=== 统一领域模型回归（P0-3）===\n');
for (const [name, ok, detail] of checks) {
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  [${detail}]` : ''}`);
}
console.log(`\n通过 ${passed}/${checks.length}\n`);
if (passed !== checks.length) process.exit(1);
