// 人眼复核：条文依据在报告中的呈现（P1-2）
// 非回归脚本，仅供人工核对输出语义是否合理。
import { executeToolByName } from '../src/agent/tools';
import { RULE_REGISTRY } from '../src/data/code-rules';

const seismic = executeToolByName('check_seismic_requirements', {
  systemId: 'frame',
  params: { floors: 30, seismicIntensity: '8', buildingHeight: 90 },
}) as {
  knowledgeBasis?: Array<{ code: string; clause: string; title: string; text: string }>;
  checks?: Array<{ name: string; status: string; requirement: string }>;
};

console.log('\n=== 条文依据（报告「可追溯」栏将如此呈现）===\n');
for (const b of seismic.knowledgeBasis ?? []) {
  console.log('· ' + b.code + ' ' + b.clause + '：' + b.title);
  console.log('    ' + b.text.slice(0, 70) + '…');
}

console.log('\n=== 判定「要求」列（应来自规则阈值声明）===\n');
for (const c of seismic.checks ?? []) {
  console.log('· ' + c.name + '  [' + c.status + ']  要求 ' + (c.requirement ?? '—'));
}

console.log('\n=== 一致性自检：条文原文字面数字 vs 可执行阈值 ===');
const swr = RULE_REGISTRY.find((r) => r.id === 'swr');
if (swr) {
  const ctx = {
    schemeId: 'frame',
    params: {} as never,
    intensity: 7,
    height: 90,
    period: 1.5,
    aspectRatio: 2,
  };
  const inText = swr.clauseText.match(/7度\(0\.10g\)\s*([\d.]+)/)?.[1];
  const fromThreshold = swr.threshold.value(ctx);
  console.log('  条文写 7度框架 λ_min = ' + inText);
  console.log('  阈值算出            = ' + fromThreshold);
  console.log(
    '  → ' +
      (Number(inText) === fromThreshold
        ? '✅ 一致（旧双源此处为 0.012 vs 0.024，矛盾）'
        : '❌ 仍不一致')
  );
}
