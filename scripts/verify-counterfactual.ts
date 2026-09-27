// ============================================================
// 智构 StructMind · 反事实推演引擎回归（架构诊断 P1-3）
//
// 守护的核心命题：
//   【用户问「如果…会怎样」时，得到的是真推演，不是瞎猜，也不会误改参数】
//
// 三层防护，逐一验证：
//   A. 解析层：假设性提问必须被识别为 WHAT_IF，且不能抢走真的执行类意图
//   B. 推演层：差异计算正确、方向判定正确、规范翻转判定正确
//   C. 隔离层：推演绝不改写会话参数（what-if 是看，不是改）
//
// 运行：node scripts/verify-counterfactual-out/verify-counterfactual.js
// ============================================================
import {
  simulateCounterfactual,
  simulateSystemCounterfactual,
  resolveInterventionFromText,
  diffParams,
  describeChange,
  applyParamChanges,
} from '../src/data/counterfactual';
import { parseIntentByRules } from '../src/agent/intent';
import { EIntentType } from '../src/agent/types';
import { MOCK_PROJECT_PARAMS, type IProjectParams } from '../src/data/structure';

const checks: Array<[string, boolean, string]> = [];
const push = (name: string, ok: boolean, detail = '') => checks.push([name, ok, detail]);

/** 基线：30 层 / 8 度 / 住宅 / 剪力墙（MOCK 默认） */
const BASE: IProjectParams = { ...MOCK_PROJECT_PARAMS };
/** 推演候选集合：常用 4 个体系，覆盖梯度的两端 */
const POOL = ['frame', 'frame-shearwall', 'shearwall', 'frame-corewall'];

/**
 * 构造自洽的层数基线：层数变则高度必须跟着变（层高 3m）。
 * 测试里直接用 { ...BASE, floors: N } 会留下 BASE 的 buildingHeight=90，
 * 造出「12 层但 90m 高」这种现实中不存在的参数组合，
 * 会让推演结果失去意义（正是这种不自洽曾掩盖了真实缺陷）。
 */
function withFloors(floors: number): IProjectParams {
  const p: IProjectParams = { ...BASE, floors };
  p.buildingHeight = floors * 3;
  return p;
}

// ============================================================
// 场景 A：意图解析 —— 假设性提问必须走 WHAT_IF，执行类必须走 CHANGE_PARAMS
// ============================================================
{
  const whatIfCases: Array<[string, string]> = [
    ['如果把层数从 30 降到 20 会怎样', '层数下降 + 假设语气'],
    ['假如层数改成 18 层呢', '层数 + 假如 + 呢'],
    ['要是剪力墙换成框剪会怎么样', '体系替换（目标在「换成」之后）+ 假设语气'],
    ['假设设防烈度降到 7 度，影响大吗', '烈度 + 假设'],
    ['如果场地类别改成 Ⅲ 类会有什么影响', '场地 + 假设'],
    ['剪力墙换成框架呢？', '体系替换（改为更柔的体系）+ 呢'],
  ];
  for (const [msg, desc] of whatIfCases) {
    const r = parseIntentByRules(msg);
    push(
      `A1 WHAT_IF 识别「${msg}」（${desc}）`,
      r.intent === EIntentType.WHAT_IF && !!r.whatIfChanges && Object.keys(r.whatIfChanges).length > 0,
      `实际=${r.intent}，changes=${JSON.stringify(r.whatIfChanges ?? {})}`
    );
  }

  // 反向：真执行类语句绝不能被误判为推演
  const execCases: Array<[string, string]> = [
    ['把层数改成 20 层', 'CHANGE_PARAMS'],
    ['帮我砍 20% 预算', 'ASK_BUDGET_CUT'],
    ['预算降到 4000', 'CHANGE_PARAMS'],
    ['重新生成方案', 'REGENERATE'],
  ];
  for (const [msg, expect] of execCases) {
    const r = parseIntentByRules(msg);
    push(
      `A2 执行类不被误判「${msg}」应=${expect}`,
      r.intent === (expect as EIntentType),
      `实际=${r.intent}`
    );
  }
}

// ============================================================
// 场景 B：干预解析 —— 字段抽取正确，多字段可同时识别
// ============================================================
{
  const r1 = resolveInterventionFromText('如果把层数从 30 降到 20 会怎样', BASE);
  push(
    'B1 层数对解析：30 → 20',
    !!r1 && r1.params.floors === 20,
    `floors=${r1?.params.floors}`
  );

  const r2 = resolveInterventionFromText('剪力墙换成框剪会怎么样', BASE);
  push(
    'B2 体系替换：shearwall → frame-shearwall',
    !!r2 && r2.params.structurePreference === 'frame-shearwall',
    `structurePreference=${r2?.params.structurePreference}`
  );

  const r3 = resolveInterventionFromText('把层数降到 15 层，同时烈度降到 7 度', BASE);
  push(
    'B3 多字段同时识别（层数 + 烈度）',
    !!r3 && r3.params.floors === 15 && r3.params.seismicIntensity === '7',
    `floors=${r3?.params.floors}, intensity=${r3?.params.seismicIntensity}`
  );

  const r4 = resolveInterventionFromText('今天天气不错', BASE);
  push('B4 无干预语句返回 null（不瞎猜）', r4 === null, `实际=${JSON.stringify(r4)}`);

  const r5 = resolveInterventionFromText('如果场地改成 Ⅲ 类呢', BASE);
  push(
    'B5 场地类别罗马数字归一化',
    !!r5 && r5.params.soilCategory === 'Ⅲ',
    `soilCategory=${r5?.params.soilCategory}`
  );
}

// ============================================================
// 场景 C：差异计算 —— 层数下降必然联动工期/造价/碳排
// ============================================================
{
  const after = { ...BASE, floors: 20 };
  const changes = diffParams(BASE, after);
  push(
    'C1 diffParams 只报出变动字段',
    changes.length === 1 && changes[0].field === 'floors' && changes[0].from === '30层' && changes[0].to === '20层',
    `实际=${JSON.stringify(changes)}`
  );

  push(
    'C2 describeChange 生成可读描述',
    describeChange(BASE, after).includes('层数由 30层 改为 20层'),
    describeChange(BASE, after)
  );

  const r = simulateSystemCounterfactual('shearwall', BASE, after, true);
  const byKey = new Map(r.metricDeltas.map((d) => [d.key, d]));

  push(
    'C3 层数 30→20 工期缩短',
    (byKey.get('duration')?.delta ?? 0) < 0,
    `duration ${byKey.get('duration')?.before} → ${byKey.get('duration')?.after}`
  );
  push(
    'C4 层数 30→20 结构造价下降',
    (byKey.get('cost')?.delta ?? 0) < 0,
    `cost ${byKey.get('cost')?.before} → ${byKey.get('cost')?.after}`
  );
  push(
    'C5 层数 30→20 碳排放下降',
    (byKey.get('carbonEmission')?.delta ?? 0) < 0,
    `carbon ${byKey.get('carbonEmission')?.before} → ${byKey.get('carbonEmission')?.after}`
  );
  push(
    'C6 降本被判定为 good 方向',
    byKey.get('cost')?.direction === 'good',
    `direction=${byKey.get('cost')?.direction}`
  );
  push(
    'C7 每个变化指标都带归因文案',
    r.metricDeltas.filter((d) => d.direction !== 'neutral').every((d) => d.attribution.length > 0),
    '归因非空'
  );

  // C8 —— 归因诚实性：只允许陈述「可验证的输入依赖」，不得编造力学/经济机制。
  // 这条守护的是「引擎不知道中间机制，就不许声称知道」。
  const allText = r.metricDeltas.map((d) => d.attribution).join(' ');
  const forged = ['配筋率提高', '构件截面加大', '截面加大所以', '因为.*所以', '刚度不足所以'];
  push(
    'C8 归因不编造中间机制',
    !forged.some((p) => new RegExp(p).test(allText)),
    allText.slice(0, 120)
  );

  // C9 —— 归因必须指认本次真实变动的参数（可验证性）
  const costAttr = byKey.get('cost')?.attribution ?? '';
  push(
    'C9 归因指认本次实际变动的参数',
    costAttr.includes('层数'),
    costAttr
  );

  // C10 —— 装配率未跨越 50% 门槛时不得判为 bad（它取决于项目定位，不是越高越好）
  push(
    'C10 装配率未跨门槛时判为 neutral 而非 bad',
    byKey.get('precastRate')?.direction === 'neutral',
    `装配率 ${byKey.get('precastRate')?.before}% → ${byKey.get('precastRate')?.after}%，direction=${byKey.get('precastRate')?.direction}`
  );

  // C11 —— 装配率下降不得拉低整案评价。
  // 语义依据：装配率取决于项目定位（装配式建筑 vs 现浇），不是「越高越好」的绝对指标；
  // 降层导致装配率自然回落是结构性副产物，不该渲染成缺陷。
  // 判据：verdict 不应因装配率一项变差而落到 worsened。
  push(
    'C11 装配率回落不使降层推演落到 worsened',
    r.verdict !== 'worsened',
    `verdict=${r.verdict}, summary=${r.summary}`
  );
}

// ============================================================
// 场景 D：规范翻转 —— 关键命题
//   事实基准（HEIGHT_LIMITS）：框架体系 8 度区最大适用高度 = 40m
//   → 30 层(90m)、20 层(60m)、15 层(45m) 均超限；12 层(36m) 才回到合规区
// ============================================================
{
  // D1：框架体系 30 层(90m) → 20 层(60m)：虽仍超限，但位移角等判定应有变化
  const r = simulateSystemCounterfactual('frame', withFloors(30), withFloors(20), false);

  push(
    'D1 框架30层→20层确有规范判定变化',
    r.checkFlips.length > 0,
    `flips=${r.checkFlips.map((f) => `${f.name}:${f.before}→${f.after}`).join(' | ') || '无'}`
  );

  push(
    'D2 违规计数下降',
    r.mandatoryViolationsAfter < r.mandatoryViolationsBefore,
    `${r.mandatoryViolationsBefore} → ${r.mandatoryViolationsAfter}`
  );

  // D3：关键命题 —— 降到合规高度（12 层 = 36m ≤ 40m 限值）必须不再判 fail
  const r2 = simulateSystemCounterfactual('frame', withFloors(30), withFloors(12), false);
  const heightFlip = r2.checkFlips.find((f) => /高度/.test(f.name));
  push(
    'D3 降到12层(36m)使「最大适用高度」不再是 fail',
    !!heightFlip && heightFlip.before === 'fail' && heightFlip.after !== 'fail',
    heightFlip
      ? `${heightFlip.name}: ${heightFlip.before}→${heightFlip.after}`
      : `未找到高度翻转；violations ${r2.mandatoryViolationsBefore}→${r2.mandatoryViolationsAfter}`
  );

  // D4：反向 —— 从合规高度(12层36m)升到超限高度(40层120m)，高度判定必须加重
  // 注：12 层时高度余量不足 10%，判定为 warning；40 层时转 fail。
  // 这种 warning→fail 属于「严重性升级（severity-up）」，与 pass→fail 同属违规加重。
  const up = simulateSystemCounterfactual('frame', withFloors(12), withFloors(40), false);
  push(
    'D4 框架12层→40层使高度判定加重（new-violation 或 severity-up）',
    up.checkFlips.some((f) => (f.kind === 'new-violation' || f.kind === 'severity-up') && /高度/.test(f.name)),
    `flips=${up.checkFlips.map((f) => `${f.name}:${f.before}→${f.after}(${f.kind})`).join(' | ') || '无'}`
  );

  // D5：强制性条文的加重必须被标记为 critical
  const criticalFlip = up.checkFlips.find(
    (f) => f.mandatory && (f.kind === 'new-violation' || f.kind === 'severity-up')
  );
  push(
    'D5 强制性条文翻转标记为 critical',
    !!criticalFlip && criticalFlip.impact === 'critical',
    criticalFlip ? `${criticalFlip.name} impact=${criticalFlip.impact}` : '未找到'
  );

  // D6：翻转证据链必须可追溯到条文出处
  push(
    'D6 翻转证据含条文出处',
    up.checkFlips.filter((f) => f.impact !== 'minor').every((f) => /依据/.test(f.evidence)),
    up.checkFlips.map((f) => f.evidence).join(' || ').slice(0, 200)
  );
}

// ============================================================
// 场景 E：整体推演报告 + 隔离性
// ============================================================
{
  const after = { ...BASE, floors: 20, seismicIntensity: '7' };
  const report = simulateCounterfactual(
    '如果把层数降到 20，烈度也降到 7 度会怎样',
    BASE,
    after,
    POOL,
    'shearwall'
  );

  push(
    'E1 报告覆盖全部候选体系',
    report.results.length === POOL.length,
    `results=${report.results.length}`
  );
  push(
    'E2 报告带出全部干预项（含高度联动）',
    report.changes.some((c) => c.field === 'floors') &&
      report.changes.some((c) => c.field === 'seismicIntensity'),
    JSON.stringify(report.changes)
  );
  push(
    'E3 当前推荐方案被正确标注',
    report.results.find((r) => r.systemId === 'shearwall')?.isCurrentRecommendation === true,
    `标注数=${report.results.filter((r) => r.isCurrentRecommendation).length}`
  );
  push(
    'E4 每个体系都有 verdict 与 summary',
    report.results.every((r) => !!r.verdict && r.summary.length > 0),
    report.results.map((r) => `${r.systemId}:${r.verdict}`).join(' ')
  );

  // E5 —— 隔离性：推演不得污染基线对象
  const frozen = JSON.stringify(BASE);
  simulateCounterfactual('测试', BASE, { ...BASE, floors: 5 }, POOL);
  simulateSystemCounterfactual('frame', BASE, { ...BASE, floors: 5 });
  push(
    'E5 推演不修改基线参数对象（隔离性）',
    JSON.stringify(BASE) === frozen && BASE.floors === 30,
    `floors=${BASE.floors}`
  );

  // E6：applyParamChanges 结构化干预（供 UI 滑杆使用）
  const ui = applyParamChanges(BASE, { floors: 25, mainSpan: 9 });
  push(
    'E6 applyParamChanges 支持结构化干预',
    ui.floors === 25 && ui.mainSpan === 9 && BASE.floors === 30,
    `floors=${ui.floors}, span=${ui.mainSpan}, base=${BASE.floors}`
  );
}

// ============================================================
// 场景 F：降到合规高度后原本不合规的体系恢复合规（决策含义）
//   40 层(120m) 框架必然超限；降到 12 层(36m ≤ 40m) 应回到合规区间
// ============================================================
{
  const report = simulateCounterfactual(
    '如果层数降到 12 层',
    withFloors(40),
    withFloors(12),
    ['frame'],
    undefined
  );
  const f = report.results[0];
  push(
    'F1 40层→12层：不合规体系恢复合规',
    f.mandatoryViolationsBefore > 0 && f.mandatoryViolationsAfter === 0,
    `before=${f.mandatoryViolationsBefore}, after=${f.mandatoryViolationsAfter}`
  );
  push(
    'F2 恢复合规被计入 compliantAfter',
    report.compliantAfter.includes('frame'),
    `compliantAfter=${JSON.stringify(report.compliantAfter)}`
  );
  push(
    'F3 恢复合规的推演不会判为 worsened',
    f.verdict !== 'worsened' && f.mandatoryViolationsAfter === 0,
    `verdict=${f.verdict}, summary=${f.summary}`
  );
}

// ============================================================
// 汇总
// ============================================================
const passed = checks.filter(([, ok]) => ok).length;
console.log('\n========== 反事实推演引擎回归 ==========');
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  —— ${detail}` : ''}`);
}
console.log(`\n结果：${passed}/${checks.length} 通过`);
if (passed !== checks.length) {
  process.exit(1);
}
