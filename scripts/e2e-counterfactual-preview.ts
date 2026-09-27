// 反事实推演 · 端到端输出检视（人眼复核用）
// 目的：打印真实用户在对话里会看到的完整回复，检查可读性与严谨性。
// 运行：node scripts/verify-counterfactual-out/e2e-preview.js
import { IntentEngine } from '../src/agent/intent';
import { MOCK_PROJECT_PARAMS } from '../src/data/structure';
import { evaluateScheme } from '../src/data/scheme-evaluator';

// 构造一个「已有上一轮推荐结果」的会话上下文，模拟真实续聊
const POOL = ['frame-shearwall', 'shearwall', 'frame-corewall', 'frame'];
const ranking = POOL.map((id) => {
  const ev = evaluateScheme(id, MOCK_PROJECT_PARAMS);
  return { schemeId: id, schemeName: ev.systemName, score: 7 + Math.random() };
});
ranking.sort((a, b) => b.score - a.score);

const ctx = {
  currentParams: { ...MOCK_PROJECT_PARAMS },
  lastResult: {
    ranking,
    recommended: { schemeId: ranking[0].schemeId, schemeName: ranking[0].schemeName, overallScore: ranking[0].score },
  },
  messages: [],
};

const questions = [
  '如果把层数从 30 降到 20 会怎样',
  '剪力墙换成框剪会怎么样',
  '假如设防烈度降到 7 度',
];

(async () => {
  for (const q of questions) {
    const engine = new IntentEngine(structuredClone(ctx));
    const r = await engine.processMessage(q);
    console.log('\n' + '='.repeat(78));
    console.log(`👤 用户：${q}`);
    console.log(`🎯 识别意图：${r.intent.intent}`);
    console.log('='.repeat(78));
    console.log(r.reply);
    console.log('');
  }
})();

// 追加：复述现状场景（当前 30 层，问"改成 30 层"）
(async () => {
  const engine = new IntentEngine(structuredClone(ctx));
  const q = '如果层数改成 30 层会怎样';
  const r = await engine.processMessage(q);
  console.log('\n' + '='.repeat(78));
  console.log(`👤 用户：${q}`);
  console.log(`🎯 识别意图：${r.intent.intent}`);
  console.log('='.repeat(78));
  console.log(r.reply);
  console.log('');
})();

// 追加：复述现状场景（当前 30 层，问"改成 30 层"）
(async () => {
  const engine = new IntentEngine(structuredClone(ctx));
  const q = '如果层数改成 30 层会怎样';
  const r = await engine.processMessage(q);
  console.log('\n' + '='.repeat(78));
  console.log(`👤 用户：${q}`);
  console.log(`🎯 识别意图：${r.intent.intent}`);
  console.log('='.repeat(78));
  console.log(r.reply);
  console.log('');
})();
