// 行动型对话：意图驱动引擎
// 对话消息经意图解析得到意图并触发动作
// 真实模式用 LLM 解析意图，演示模式用规则引擎（关键词+数字提取）
// EXPORTS: IntentEngine, parseIntentByRules, processAgentMessage

import { EIntentType, type IIntentResult, type IAgentPipelineResult } from './types';
import { runAgentPipeline } from './pipeline';
import { RealEngine, isRealModeAvailable } from './real-engine';
import { TraceEngine } from './trace-engine';
import type { IProjectParams, IWeightConfig } from '@/data/structure';
import { MOCK_WEIGHT_CONFIG, STRUCTURE_SYSTEM_LIBRARY } from '@/data/structure';
import { executeToolByName } from './tools';
import { logger } from '@lark-apaas/client-toolkit-lite';

// ============ 规则引擎意图解析（演示模式） ============

/**
 * 基于关键词 + 数字提取的规则意图解析
 * 返回意图类型及提取的参数
 */
export function parseIntentByRules(message: string): IIntentResult {
  const msg = message.trim();
  const lowerMsg = msg.toLowerCase();

  // 1. CHANGE_PARAMS — 参数修改类
  const floorMatch = msg.match(/(\d+)\s*层/);
  const budgetMatch = msg.match(/预算[\s\S]{0,10}(\d+)/) || msg.match(/(\d+)\s*元\/平/);
  const spanMatch = msg.match(/跨度[\s\S]{0,10}(\d+)/) || msg.match(/(\d+)\s*米跨/);
  const intensityMatch = msg.match(/(\d+)\s*度/);

  const paramChanges: Record<string, string | number> = {};

  if (floorMatch) paramChanges.floors = parseInt(floorMatch[1], 10);
  if (budgetMatch) paramChanges.budget = parseInt(budgetMatch[1], 10);
  if (spanMatch) paramChanges.mainSpan = parseInt(spanMatch[1], 10);
  if (intensityMatch && /设防|烈度|抗震/.test(msg)) {
    paramChanges.seismicIntensity = intensityMatch[1];
  }

  const changeKeywords = ['改成', '调整为', '改为', '变成', '换成', '设为', '修改为', '增加到', '降低到', '调到', '改成', '变一下'];
  const hasChangeKeyword = changeKeywords.some((k) => msg.includes(k));
  // 问句（含「多少/什么/怎么/要求/是多少/怎么样」）不视为修改意图
  const questionKeywords = ['多少', '什么是', '怎么', '要求', '是多少', '怎么样', '为什么', '哪种', '哪个', '吗？', '呢？', '?'];
  const isQuestion = questionKeywords.some((k) => msg.includes(k));
  // 纯参数值短句（无问句词、长度 ≤ 12 字）视为隐式修改意图
  const isPureParamPhrase = !isQuestion && msg.length <= 12 && Object.keys(paramChanges).length > 0;
  // 修改意图 = 有修改类关键词 或 纯参数短句
  const isChangeIntent = hasChangeKeyword || isPureParamPhrase;

  if (isChangeIntent && Object.keys(paramChanges).length > 0) {
    return {
      intent: EIntentType.CHANGE_PARAMS,
      paramChanges,
      confidence: 0.85,
      rawMessage: msg,
    };
  }

  // 2. REGENERATE — 重新生成
  const regenerateKeywords = [
    '重新生成', '重来', '重新算', '再算一遍', '重新分析', '重新跑', '再来一次',
    '输出数据', '生成方案', '跑一下', '重新跑一下', '重新生成方案',
    '再生成', '重新出方案', '算一下', '重新计算', '给出方案',
  ];
  // 长度 ≤ 8 字且含「生成/算/跑/出方案/输出」的短指令也视为重新生成
  const shortRegenPattern = /^(重新|再|帮我|给我|请)?(生成|算|跑|出|输出)(一下|一遍|方案|结果|数据)?$/;
  if (regenerateKeywords.some((k) => msg.includes(k)) || shortRegenPattern.test(msg)) {
    return {
      intent: EIntentType.REGENERATE,
      confidence: 0.9,
      rawMessage: msg,
    };
  }

  // 3. RECOMMEND — 推荐
  const recommendKeywords = ['推荐什么', '推荐哪个', '哪个最好', '选哪个', '最优方案', '推荐方案'];
  if (recommendKeywords.some((k) => msg.includes(k))) {
    return {
      intent: EIntentType.RECOMMEND,
      confidence: 0.85,
      rawMessage: msg,
    };
  }

  // 4. COMPARE — 对比分析
  const compareKeywords = ['对比', '比较', '差别', '区别', '差异', '哪个更', 'vs'];
  const schemeNames = STRUCTURE_SYSTEM_LIBRARY.map((s) => s.name);
  const mentionedSchemes = schemeNames.filter((name) => msg.includes(name));
  if (compareKeywords.some((k) => lowerMsg.includes(k)) || mentionedSchemes.length >= 2) {
    return {
      intent: EIntentType.COMPARE,
      compareTargets: mentionedSchemes.length > 0 ? mentionedSchemes : undefined,
      confidence: 0.8,
      rawMessage: msg,
    };
  }

  // 5. EXPLAIN — 解释类
  const explainKeywords = ['解释一下', '什么是', '为什么', '怎么理解', '说明一下', '详细说', '原理', '难点在哪'];
  const explainTargetMatch = msg.match(/(?:解释|说明|什么是|为什么)[\s\S]{0,10}([\u4e00-\u9fa5]{2,10})/);
  if (explainKeywords.some((k) => msg.includes(k))) {
    return {
      intent: EIntentType.EXPLAIN,
      explainTarget: explainTargetMatch?.[1],
      confidence: 0.75,
      rawMessage: msg,
    };
  }

  // 6. ASK_CODE — 规范条文类
  const codeKeywords = ['规范', '条文', 'GB', 'gb', '规定', '限值', '要求是', '多少米', '多少层'];
  const hasCodeNumber = /GB\s*[\d]/.test(msg) || /GB5\d{4}/.test(msg);
  if (hasCodeNumber || (codeKeywords.some((k) => msg.includes(k)) && /多少|限值|规定|要求/.test(msg))) {
    return {
      intent: EIntentType.ASK_CODE,
      codeQuery: msg,
      confidence: 0.7,
      rawMessage: msg,
    };
  }

  // 7. ASK_ISOLATION — 隔震/减震/减振咨询（含地铁振动、环境噪声等）
  const isolationKeywords = [
    '隔震', '减震', '隔震层', '消能', '阻尼器', '隔震支座', '铅芯橡胶',
    '减振', '地铁', '轨道交通', '振动', '噪声', '震动', '隔振', '弹簧隔振', '隔振沟',
  ];
  if (isolationKeywords.some((k) => msg.includes(k))) {
    return {
      intent: EIntentType.ASK_ISOLATION,
      confidence: 0.85,
      rawMessage: msg,
    };
  }

  // 8. ASK_PRECAST_COST — 装配率成本关系
  const precastCostPattern = /(装配率|预制率).*(成本|造价|增加|多少钱|贵多少)|(AAA级|AA级|A级).*(成本|造价|增加|贵多少)/;
  if (precastCostPattern.test(msg) || /(提高|提升|达到).*装配率.*(成本|造价)/.test(msg)) {
    return {
      intent: EIntentType.ASK_PRECAST_COST,
      confidence: 0.8,
      rawMessage: msg,
    };
  }

  // 9. ASK_STEEL_COST — 钢结构造价对比
  const steelCostPattern = /(钢结构|钢框架).*(便宜|更贵|造价|成本|差价|多少钱)|换钢结构.*(便宜|造价|成本)/;
  if (steelCostPattern.test(msg) || /钢.*(便宜|贵).*混凝土/.test(msg)) {
    return {
      intent: EIntentType.ASK_STEEL_COST,
      confidence: 0.8,
      rawMessage: msg,
    };
  }

  // 10. ASK_SCHEDULE_COMPRESS — 工期压缩
  const scheduleCompressKeywords = ['压缩工期', '工期能压缩', '赶工', '提前完工', '缩短工期', '工期压缩', '加快施工'];
  if (scheduleCompressKeywords.some((k) => msg.includes(k)) || /工期.*(能.*提前|能不能.*缩|可以.*压缩)/.test(msg)) {
    return {
      intent: EIntentType.ASK_SCHEDULE_COMPRESS,
      confidence: 0.75,
      rawMessage: msg,
    };
  }

  // 11. ASK_COMPLIANCE_RISK — 合规性与风险
  const complianceKeywords = ['合规吗', '符合规范吗', '有风险吗', '风险点', '风险在哪', '合规性', '有没有问题', '符合要求吗'];
  if (complianceKeywords.some((k) => msg.includes(k)) || /(这个|该).*方案.*(风险|合规|问题)/.test(msg)) {
    return {
      intent: EIntentType.ASK_COMPLIANCE_RISK,
      confidence: 0.8,
      rawMessage: msg,
    };
  }

  // 12. ASK_BUDGET_CUT — 预算大幅削减
  const budgetCutMatch = msg.match(/预算.*(砍|降|减少|压缩|削减)[\s\S]{0,6}(\d+)%/) || msg.match(/(\d+)%.*预算/);
  if (budgetCutMatch && /预算|造价|成本/.test(msg)) {
    const pct = parseInt(budgetCutMatch[1], 10);
    if (pct > 0 && pct <= 90) {
      return {
        intent: EIntentType.ASK_BUDGET_CUT,
        budgetCutPercent: pct,
        confidence: 0.85,
        rawMessage: msg,
      };
    }
  }

  // 13. ASK_BENCHMARK — 与同类项目对比
  const benchmarkKeywords = ['同类项目', '周边项目', '行业平均', '对比类似', '和其他项目比', '一般水平', '平均水平'];
  if (benchmarkKeywords.some((k) => msg.includes(k)) || /(和|跟|与).*(周边|同类|类似).*比/.test(msg)) {
    return {
      intent: EIntentType.ASK_BENCHMARK,
      confidence: 0.8,
      rawMessage: msg,
    };
  }

  // 14. ASK_SEISMIC_GRADE — 抗震等级查询
  const seismicGradeKeywords = ['抗震等级', '抗震等级是', '几级抗震', '抗震几级', '抗震措施等级', '抗震构造等级'];
  if (seismicGradeKeywords.some((k) => msg.includes(k))) {
    return {
      intent: EIntentType.ASK_SEISMIC_GRADE,
      confidence: 0.9,
      rawMessage: msg,
    };
  }

  // 15. ASK_FOUNDATION — 基础形式建议
  const foundationKeywords = ['基础形式', '基础选型', '什么基础', '哪种基础', '桩基础', '筏板基础', '条形基础', '独立基础', '地基基础'];
  if (foundationKeywords.some((k) => msg.includes(k))) {
    return {
      intent: EIntentType.ASK_FOUNDATION,
      confidence: 0.85,
      rawMessage: msg,
    };
  }

  // 16. ASK_STEEL_RATIO — 含钢量/用钢量
  const steelRatioKeywords = ['含钢量', '用钢量', '钢材用量', '钢含量', '钢筋用量', '每平米用钢', 'kg/㎡'];
  if (steelRatioKeywords.some((k) => msg.includes(k))) {
    return {
      intent: EIntentType.ASK_STEEL_RATIO,
      confidence: 0.85,
      rawMessage: msg,
    };
  }

  // 17. ASK_SECTION_SIZE — 构件截面估算（梁高/柱截面）
  const sectionKeywords = ['梁高', '柱截面', '梁截面', '柱多大', '梁多大', '截面尺寸', '柱子多宽', '主梁高', '次梁高'];
  if (sectionKeywords.some((k) => msg.includes(k))) {
    return {
      intent: EIntentType.ASK_SECTION_SIZE,
      confidence: 0.85,
      rawMessage: msg,
    };
  }

  // 18. UNKNOWN — 普通问答
  return {
    intent: EIntentType.UNKNOWN,
    confidence: 0.5,
    rawMessage: msg,
  };
}

// ============ 对话引擎主类 ============

export interface IConversationContext {
  currentParams: IProjectParams;
  weights?: IWeightConfig;
  lastResult: IAgentPipelineResult | null;
}

export class IntentEngine {
  private context: IConversationContext;

  constructor(context: IConversationContext) {
    this.context = context;
  }

  /** 更新上下文 */
  updateContext(partial: Partial<IConversationContext>): void {
    this.context = { ...this.context, ...partial };
  }

  /** 获取当前上下文 */
  getContext(): IConversationContext {
    return { ...this.context };
  }

  /**
   * 处理用户消息：解析意图 → 执行动作 → 返回结果
   */
  async processMessage(
    message: string
  ): Promise<{
    intent: IIntentResult;
    reply: string;
    updatedParams?: IProjectParams;
    regenerated?: IAgentPipelineResult;
  }> {
    let intent: IIntentResult;

    // 真实模式用 LLM 解析（此处先用规则，真实模式下交给 RealEngine 自己理解）
    // 简化实现：无论什么模式都先用规则解析；UNKNOWN 时真实模式再走 LLM 自由回答
    intent = parseIntentByRules(message);

    logger.info(`[IntentEngine] 意图解析: ${intent.intent} (置信度: ${intent.confidence})`);

    switch (intent.intent) {
      case EIntentType.CHANGE_PARAMS:
        return this.handleChangeParams(intent);

      case EIntentType.REGENERATE:
        return this.handleRegenerate(intent);

      case EIntentType.RECOMMEND:
        return this.handleRecommend(intent);

      case EIntentType.COMPARE:
        return this.handleCompare(intent);

      case EIntentType.EXPLAIN:
        return this.handleExplain(intent);

      case EIntentType.ASK_CODE:
        return this.handleAskCode(intent);

      case EIntentType.ASK_ISOLATION:
        return this.handleAskIsolation(intent);

      case EIntentType.ASK_PRECAST_COST:
        return this.handleAskPrecastCost(intent);

      case EIntentType.ASK_STEEL_COST:
        return this.handleAskSteelCost(intent);

      case EIntentType.ASK_SCHEDULE_COMPRESS:
        return this.handleAskScheduleCompress(intent);

      case EIntentType.ASK_COMPLIANCE_RISK:
        return this.handleAskComplianceRisk(intent);

      case EIntentType.ASK_BUDGET_CUT:
        return this.handleAskBudgetCut(intent);

      case EIntentType.ASK_BENCHMARK:
        return this.handleAskBenchmark(intent);
      case EIntentType.ASK_SEISMIC_GRADE:
        return this.handleAskSeismicGrade(intent);
      case EIntentType.ASK_FOUNDATION:
        return this.handleAskFoundation(intent);
      case EIntentType.ASK_STEEL_RATIO:
        return this.handleAskSteelRatio(intent);
      case EIntentType.ASK_SECTION_SIZE:
        return this.handleAskSectionSize(intent);

      case EIntentType.UNKNOWN:
      default:
        return this.handleUnknown(intent, message);
    }
  }

  /** CHANGE_PARAMS：修改参数并触发重新生成 */
  private async handleChangeParams(
    intent: IIntentResult
  ): Promise<{
    intent: IIntentResult;
    reply: string;
    updatedParams?: IProjectParams;
    regenerated?: IAgentPipelineResult;
  }> {
    const changes = intent.paramChanges || {};
    const newParams = { ...this.context.currentParams, ...changes };
    this.context.currentParams = newParams;

    // 生成变更描述
    const changeDescs: string[] = [];
    if (changes.floors) changeDescs.push(`层数 → ${changes.floors} 层`);
    if (changes.budget) changeDescs.push(`预算 → ${changes.budget} 元/㎡`);
    if (changes.mainSpan) changeDescs.push(`主跨 → ${changes.mainSpan}m`);
    if (changes.seismicIntensity) changeDescs.push(`设防烈度 → ${changes.seismicIntensity} 度`);

    // 触发重新生成
    const result = await runAgentPipeline(
      newParams,
      this.context.weights || MOCK_WEIGHT_CONFIG
    );
    this.context.lastResult = result;

    return {
      intent,
      updatedParams: newParams,
      regenerated: result,
      reply: `好的，已调整参数：${changeDescs.join('、')}。\n\n已重新运行方案比选，新的推荐方案为 **${result.recommended.schemeName}**（综合得分 ${result.recommended.overallScore.toFixed(1)} 分）。\n\n${result.recommended.reason.split('\n').slice(0, 5).join('\n')}`,
    };
  }

  /** REGENERATE：重新运行完整管线 */
  private async handleRegenerate(intent: IIntentResult) {
    const result = await runAgentPipeline(
      this.context.currentParams,
      this.context.weights || MOCK_WEIGHT_CONFIG
    );
    this.context.lastResult = result;

    return {
      intent,
      regenerated: result,
      reply: `已重新运行完整方案比选分析。\n\n推荐方案：**${result.recommended.schemeName}**（综合得分 ${result.recommended.overallScore.toFixed(1)} 分）\n\n${result.recommended.reason.split('\n').slice(0, 6).join('\n')}`,
    };
  }

  /** RECOMMEND：给出推荐 */
  private handleRecommend(intent: IIntentResult) {
    const result = this.context.lastResult;
    if (!result) {
      return {
        intent,
        reply: '当前还没有生成方案，请先录入项目参数并点击"生成方案"。',
      };
    }

    return {
      intent,
      reply: `综合推荐方案：**${result.recommended.schemeName}**\n\n综合得分：${result.recommended.overallScore.toFixed(1)} / 10 分\n\n${result.recommended.reason}`,
    };
  }

  /** COMPARE：对比分析 */
  private handleCompare(intent: IIntentResult) {
    const result = this.context.lastResult;
    if (!result || result.ranking.length < 2) {
      return {
        intent,
        reply: '当前没有足够的候选方案进行对比。',
      };
    }

    const topTwo = result.ranking.slice(0, 2);
    const lines = [
      '## 方案对比分析',
      '',
      `| 指标 | ${topTwo[0].schemeName} | ${topTwo[1].schemeName} |`,
      '|------|------|------|',
    ];

    // 列出各维度得分
    Object.keys(topTwo[0].breakdown).forEach((key) => {
      const v1 = topTwo[0].breakdown[key];
      const v2 = topTwo[1].breakdown[key];
      if (typeof v1 === 'number' && typeof v2 === 'number') {
        lines.push(`| ${key} | ${v1.toFixed(1)} | ${v2.toFixed(1)} |`);
      }
    });

    lines.push('');
    lines.push(`**综合得分**：${topTwo[0].schemeName} ${topTwo[0].score.toFixed(1)} vs ${topTwo[1].schemeName} ${topTwo[1].score.toFixed(1)}`);
    lines.push('');
    lines.push(`推荐 **${topTwo[0].schemeName}**，领先 ${(topTwo[0].score - topTwo[1].score).toFixed(1)} 分。`);

    return {
      intent,
      reply: lines.join('\n'),
    };
  }

  /** EXPLAIN：解释 */
  private handleExplain(intent: IIntentResult) {
    const target = intent.explainTarget || '方案';
    const result = this.context.lastResult;

    // 尝试匹配已知体系
    const matched = STRUCTURE_SYSTEM_LIBRARY.find(
      (s) => s.name.includes(target) || target.includes(s.name)
    );

    if (matched) {
      return {
        intent,
        reply: `## ${matched.name}\n\n**体系说明**：${matched.description}\n\n**适用场景**：${matched.applicableScenarios}\n\n**综合经济性**：基准 ${matched.metrics.cost} 分\n\n**主要优点**：\n${matched.advantages.map((p) => `- ${p}`).join('\n')}\n\n**主要缺点**：\n${matched.disadvantages.map((c) => `- ${c}`).join('\n')}`,
      };
    }

    if (result) {
      const top = result.ranking[0];
      return {
        intent,
        reply: `关于「${target}」的说明：\n\n当前推荐方案是 **${top.schemeName}**，综合得分 ${top.score.toFixed(1)} 分。\n\n各维度得分：\n${Object.entries(top.breakdown)
          .map(([k, v]) => `- ${k}: ${v.toFixed(1)} 分`)
          .join('\n')}\n\n如需更详细的解释，请告诉我具体想了解哪个方面。`,
      };
    }

    return {
      intent,
      reply: `关于「${target}」，请先完成方案生成后再咨询，或者提供更具体的问题。`,
    };
  }

  /** ASK_CODE：规范条文问答 */
  private handleAskCode(intent: IIntentResult) {
    const query = intent.codeQuery || '';

    // 简单规则回答常见规范问题
    if (query.includes('位移角') || query.includes('层间位移')) {
      return {
        intent,
        reply: `## 弹性层间位移角限值（GB/T 50011 表 5.5.1）\n\n| 结构体系 | 限值 [Δu/h] |\n|----------|------------|\n| 框架结构 | 1/550 |\n| 框架-剪力墙结构、板柱-剪力墙结构、框架-核心筒结构、板柱-核心筒结构 | 1/800 |\n| 剪力墙结构、筒中筒结构 | 1/1000 |\n| 各类装配式结构 | 同对应现浇体系 |\n\n**说明**：弹性层间位移角是验算结构在风荷载和多遇地震作用下侧向刚度是否满足要求的重要指标。刚度越大的体系，限值越严格。`,
      };
    }

    if (query.includes('剪重比') || query.includes('最小地震剪力')) {
      return {
        intent,
        reply: `## 最小剪重比（GB/T 50011 表 5.2.5）\n\n| 结构类型 | 6度 | 7度 | 8度 | 9度 |\n|----------|-----|-----|-----|-----|\n| 框架结构 | 0.012 | 0.024(0.032) | 0.048(0.064) | 0.12 |\n| 框架-抗震墙结构、板柱-抗震墙结构、框架-核心筒结构、板柱-核心筒结构、框架-支撑结构 | 0.012 | 0.020(0.028) | 0.040(0.056) | 0.10 |\n| 抗震墙结构、筒中筒结构 | 0.010 | 0.016(0.024) | 0.032(0.048) | 0.080 |\n\n**注**：括号内数值分别用于设计基本地震加速度为 0.15g 和 0.30g 的地区。`,
      };
    }

    if (query.includes('周期比')) {
      return {
        intent,
        reply: `## 扭转周期比限值（GB/T 50011 第 3.4.5 条）\n\n- **A级高度**：Tt/T₁ ≤ 0.9\n- **B级高度**：Tt/T₁ ≤ 0.85\n\n其中：\n- Tt — 扭转为主的第一自振周期\n- T₁ — 平动为主的第一自振周期\n\n**意义**：控制结构的扭转变形，防止扭转效应过大导致结构破坏。周期比越小，结构抗扭刚度越好。`,
      };
    }

    if (query.includes('轴压比') || query.includes('剪力墙')) {
      return {
        intent,
        reply: `## 剪力墙轴压比限值（GB/T 50011 表 6.4.2）\n\n| 抗震等级 | 一级(9度) | 一级(7、8度) | 二级 | 三级 |\n|----------|-----------|-------------|------|------|\n| 轴压比限值 | 0.4 | 0.5 | 0.6 | 0.7 |\n\n**适用范围**：矩形、T形、工形、L形、十字形等截面剪力墙\n\n**注意**：\n1. 底部加强部位的轴压比限值应更严（上表为底部加强部位以上一般部位）\n2. 轴压比是控制剪力墙延性的重要指标，轴压比越大，延性越差`,
      };
    }

    if (query.includes('耐火') || query.includes('防火')) {
      return {
        intent,
        reply: `## 建筑构件耐火极限（GB 55037-2022）\n\n| 构件名称 | 一级耐火等级(h) | 二级耐火等级(h) |\n|----------|----------------|----------------|\n| 防火墙 | 3.00 | 3.00 |\n| 承重墙 | 3.00 | 2.50 |\n| 柱 | 3.00 | 2.50 |\n| 梁 | 2.00 | 1.50 |\n| 楼板 | 1.50 | 1.00 |\n| 屋顶承重构件 | 1.50 | 1.00 |\n| 疏散楼梯 | 1.50 | 1.00 |\n\n**钢结构特点**：钢结构耐火性能差，通常需要做防火涂料或防火板保护，使其达到相应耐火等级要求。`,
      };
    }

    // 通用回答
    return {
      intent,
      reply: `关于规范条文的查询：「${query}」\n\n本系统内置了以下常用规范的关键指标：\n- GB/T 50011《建筑抗震设计规范》：适用高度、层间位移角、剪重比、周期比、轴压比\n- GB 55002-2021《建筑与市政工程抗震通用规范》\n- GB 55037-2022《建筑防火通用规范》：耐火等级、耐火极限\n- GB/T 51129-2017《装配式建筑评价标准》：装配率分级\n\n您可以具体询问某一项指标，例如：\n- "层间位移角限值是多少？"\n- "剪重比怎么算？"\n- "钢结构耐火极限要求是什么？"`,
    };
  }

  /** ASK_ISOLATION：隔震/减震专项咨询 */
  private handleAskIsolation(intent: IIntentResult) {
    const params = this.context.currentParams;
    const intensity = params.seismicIntensity;
    const height = params.floors * 3;
    const recName = this.context.lastResult?.recommended?.schemeName || '当前推荐方案';
    const msg = intent.rawMessage || '';
    const lines: string[] = [];

    // ===== 地铁/环境减振 子类 =====
    const isMetroVibration = /地铁|轨道交通|减振|振动|震动|噪声|隔振沟|弹簧隔振|隔振/.test(msg)
      && !/隔震层|铅芯橡胶|消能减震|屈曲约束|BRB/.test(msg);

    if (isMetroVibration) {
      lines.push('## 地铁环境振动与减振措施初步分析');
      lines.push('');
      lines.push('> 先接住：地铁振动主要影响**住宅、酒店、医院、实验室**等对振动/噪声敏感的建筑。你这个问题属于**专项减振设计**范畴，我从概念层面给你梳理思路。');
      lines.push('');
      lines.push('### 常见减振措施（从源头→路径→接收体）');
      lines.push('');
      lines.push('1. **线路源头减振**：钢轨打磨、弹性扣件、梯形轨枕、钢弹簧浮置板道床——这是最直接有效的手段，但需要地铁运营方配合');
      lines.push('2. **传播路径隔振**：建筑与地铁间设**隔振沟**（空沟或填充沟）、**钻孔排桩**、**连续墙**等，阻断振动在土体中的传播');
      lines.push('3. **建筑基础隔振**：底层采用**弹簧隔振器**或**橡胶隔振垫**（注意：这是竖向微振动隔振，≠抗震用的隔震层），对结构整体做浮置');
      lines.push('4. **建筑平面优化**：敏感房间（卧室、精密仪器室）尽量布置在远离隧道一侧，利用卫生间、走廊等做缓冲带');
      lines.push('5. **室内二次减振**：吊顶减振吊钩、浮筑楼板、设备弹性支座，针对末端敏感点精准处理');
      lines.push('');
      lines.push('### 结合你当前项目的初步判断');
      lines.push('');
      lines.push(`- **建筑规模**：${params.floors}层、约${height}m高`);
      lines.push(`- **建筑功能**：${params.buildingType === 'residential' ? '住宅' : params.buildingType === 'office' ? '办公楼' : params.buildingType === 'school' ? '教学楼' : params.buildingType === 'factory' ? '厂房' : '体育馆'}`);
      lines.push(`- **推荐体系**：${recName}`);
      lines.push('');

      if (params.floors <= 6) {
        lines.push(`✅ **${params.floors}层低层建筑**：地铁振动对低层影响更直接（竖向振动经基础传入），但结构本身轻、减振措施相对好做。一般采用**基础隔振垫+浮筑楼板**组合就能满足住宅类要求，造价增加约 80~150 元/㎡。`);
      } else if (params.floors <= 18) {
        lines.push(`⚠️ **${params.floors}层中层建筑**：地铁振动主要影响下部楼层（通常 1~6 层较明显），往上逐渐衰减。建议重点处理**底部 3~5 层**的敏感房间，结合建筑布置把商业/储藏等不敏感功能放在底层，性价比最高。`);
      } else {
        lines.push(`🔎 **${params.floors}层高层建筑**：地铁振动对高层上部楼层影响较小（振动在结构内向上传播衰减快），但**风振舒适度**可能才是控制因素。如果下部有酒店/住宅等敏感功能，需要专项评估。`);
      }

      lines.push('');
      lines.push('### 需要你进一步确认的几个关键条件');
      lines.push('');
      lines.push('- 地铁隧道与建筑的**水平距离**（≤20m 影响显著，30~50m 需关注，>50m 一般可接受）');
      lines.push('- 地铁**运行频率**（高峰期车次、夜间是否运行）');
      lines.push('- 建筑功能中**最敏感房间**的位置和振动限值要求（住宅 vs 实验室差很多）');
      lines.push('- 场地土层条件（软土层振动传播衰减慢，硬土层衰减快）');
      lines.push('');
      lines.push('> ⚠️ **说明**：本工具不做地铁减振效果的定量计算。地铁环境振动是**专项设计**，需要专业减振顾问公司做现场测试（振源实测 + 振动传递函数测试）+ 数值模拟，最终通过专项评审验收。以上为概念级经验建议，供前期方案论证参考。');
      lines.push('');
      lines.push(`如果你想在方案比选里体现减振成本，可以告诉我「把减振成本按 100 元/㎡计入总造价」，我可以帮你重新评估各方案的经济性对比。`);

      return { intent, reply: lines.join('\n') };
    }

    // ===== 隔震/减震（抗震方向）原逻辑 =====
    lines.push('## 隔震/减震方案可行性分析');
    lines.push('');
    lines.push('### 结论先放：本工具不做隔震层精确计算');
    lines.push('');
    lines.push('隔震（橡胶隔震支座等）和消能减震（黏滞阻尼器、屈曲约束支撑等）属于**专项抗震设计**范畴，需要专门的分析软件（如 SAP2000 / ETABS / 3D3S 隔震模块）和专业工程师进行，当前概念比选工具不直接计算隔震层参数。');
    lines.push('');
    lines.push('### 基于你当前项目的适用条件判断');
    lines.push('');

    const intensityVal = parseInt(intensity, 10);
    lines.push(`- **设防烈度**：${intensity}度`);
    lines.push(`- **建筑高度**：约 ${height}m（${params.floors}层）`);
    lines.push(`- **结构类型**：${params.buildingType === 'residential' ? '住宅' : params.buildingType === 'office' ? '办公楼' : params.buildingType === 'school' ? '教学楼' : params.buildingType} 建筑`);
    lines.push('');

    if (intensityVal >= 8) {
      lines.push(`✅ **高烈度区建议考虑**：${intensity}度属于高烈度设防区，隔震技术的减震效益（可降低1~2度设防）和经济性都比较显著。对于重要公共建筑和高烈度区住宅，隔震/减震是值得论证的技术路线。`);
    } else if (intensityVal === 7) {
      lines.push(`⚠️ **7度区视情况而定**：7度(0.10g)区隔震技术也可用，但减震效益不如高烈度区显著，需结合建筑重要性、使用功能和造价目标综合判断。一般来说，标准较高的公共建筑（医院、学校、博物馆）更有价值。`);
    } else {
      lines.push(`ℹ️ **低烈度区性价比一般**：${intensity}度区地震作用较小，隔震层的造价占比偏高，经济性论证需要更充分的理由（如对舒适度有极高要求等）。`);
    }

    lines.push('');
    lines.push('### 哪些建筑适合做隔震/减震？');
    lines.push('');
    lines.push('1. **高烈度区重要建筑**：医院、学校、应急指挥中心等生命线工程');
    lines.push('2. **超限高层建筑**：高度或规则性超限，通过消能减震满足规范要求');
    lines.push('3. **平面/竖向不规则**：扭转效应大、刚度突变等难以通过常规布置解决的项目');
    lines.push('4. **有较高舒适度要求**：风振或微震环境下对加速度敏感的建筑（酒店、住宅）');
    lines.push('');
    lines.push('### 造价估算量级（概念参考）');
    lines.push('');
    lines.push('- **隔震层造价**：约 200~500 元/㎡（按总建筑面积摊），具体取决于隔震支座数量和规格');
    lines.push('- **消能减震**：约 100~300 元/㎡，阻尼器数量和类型差异较大');
    lines.push('- **整体效益**：上部结构截面可减小 10~25%，总造价未必显著增加，甚至可能持平');
    lines.push('');
    lines.push('> ⚠️ 以上为**概念级估算**，仅用于前期方案讨论参考。隔震/减震属于专项设计，必须由具备相应资质的单位进行专项论证，且需通过超限审查或专项评审。');
    lines.push('');
    lines.push(`如果你想继续探索，可以告诉我：「${recName}方案改成隔震后截面能减多少」或者「重新生成方案，考虑隔震选项」——不过隔震方案需要专门建模计算。`);

    return { intent, reply: lines.join('\n') };
  }

  /** ASK_PRECAST_COST：装配率与成本关系 */
  private handleAskPrecastCost(intent: IIntentResult) {
    const params = this.context.currentParams;
    const lastResult = this.context.lastResult;
    const recId = lastResult?.recommended?.schemeId;
    const recName = lastResult?.recommended?.schemeName || '推荐方案';

    const lines: string[] = [];
    lines.push('## 装配率提升 vs 造价分析');
    lines.push('');
    lines.push('### 当前装配率水平');
    lines.push('');

    if (recId) {
      const precastResult = executeToolByName('estimate_precast_rate', {
        systemId: recId,
        floors: params.floors,
      }) as { precastRate: number; grade: string; systemName: string };
      lines.push(`- **${recName}**：估算装配率约 **${precastResult.precastRate}%**（${precastResult.grade}）`);
      lines.push('');
      lines.push('### 各候选方案装配率对比');
      lines.push('');
      const candidates = lastResult?.ranking || [];
      candidates.forEach((c) => {
        const pr = executeToolByName('estimate_precast_rate', {
          systemId: c.schemeId,
          floors: params.floors,
        }) as { precastRate: number; grade: string };
        lines.push(`- **${c.schemeName}**：${pr.precastRate}%（${pr.grade}）`);
      });
    }

    lines.push('');
    lines.push('### 装配率分级（GB/T 51129-2017）');
    lines.push('');
    lines.push('| 等级 | 装配率 | 说明 |');
    lines.push('|------|--------|------|');
    lines.push('| AAA 级 | ≥ 91% | 高度装配式，全体系预制 |');
    lines.push('| AA 级 | 76%~90% | 较高装配率，主要构件预制 |');
    lines.push('| A 级 | 60%~75% | 基本装配式，水平构件为主 |');
    lines.push('| 基本级 | 50%~59% | 满足装配式建筑最低要求 |');
    lines.push('');
    lines.push('### 装配率提升与造价的关系（概念性判断）');
    lines.push('');
    lines.push('装配率越高，造价不一定线性增加，关键看**哪些部位预制**：');
    lines.push('');
    lines.push('1. **水平构件（楼板、楼梯、阳台）** 预制：造价增加约 3%~8%，技术成熟，性价比最高');
    lines.push('2. **竖向构件（墙板、柱）** 预制：造价增加约 8%~15%，对生产和吊装要求高');
    lines.push('3. **整体装配式（全PC + 集成厨卫）**：造价增加约 12%~20%，但工期可缩短 20%~30%');
    lines.push('');
    lines.push('**要从 A 级提升到 AAA 级**，通常需要从"水平构件为主"扩展到"竖向构件也预制集成机电与装修"，造价增量大致在 8%~15% 区间，具体取决于：');
    lines.push('');
    lines.push('- 当地预制构件厂产能和运输距离');
    lines.push('- 预制构件的标准化程度（重复率越高越经济）');
    lines.push('- 人工费水平（人工越贵的地区，装配式越划算）');
    lines.push('- 地方政策补贴（部分地区对高装配率项目有容积率奖励或财政补贴）');
    lines.push('');
    lines.push('> 💡 **概念估算提示**：以上造价增量为行业经验区间，仅供方案阶段讨论。精确造价需结合具体构件拆分方案、当地构件厂报价、施工方案综合测算。');

    return { intent, reply: lines.join('\n') };
  }

  /** ASK_STEEL_COST：钢结构造价对比 */
  private handleAskSteelCost(intent: IIntentResult) {
    const params = this.context.currentParams;
    const lastResult = this.context.lastResult;
    const recId = lastResult?.recommended?.schemeId;
    const recName = lastResult?.recommended?.schemeName || '推荐方案';
    const lines: string[] = [];

    lines.push('## 钢结构 vs 混凝土结构造价对比');
    lines.push('');

    // 真实计算钢结构造价
    const steelCost = executeToolByName('estimate_cost', {
      systemId: 'steel',
      floors: params.floors,
      seismicIntensity: params.seismicIntensity,
      soilCategory: params.soilCategory,
      mainSpan: params.mainSpan,
    }) as { costPerSqm: number; systemName: string };

    if (recId && recId !== 'steel') {
      const recCost = executeToolByName('estimate_cost', {
        systemId: recId,
        floors: params.floors,
        seismicIntensity: params.seismicIntensity,
        soilCategory: params.soilCategory,
        mainSpan: params.mainSpan,
      }) as { costPerSqm: number };

      const diff = steelCost.costPerSqm - recCost.costPerSqm;
      const diffPctNum = (diff / recCost.costPerSqm) * 100;
      const diffPct = diffPctNum.toFixed(1);

      lines.push(`### 本项目（${params.floors}层、${params.seismicIntensity}度、${params.buildingType}）`);
      lines.push('');
      lines.push(`| 方案 | 估算造价（元/㎡） | 与${recName}对比 |`);
      lines.push('|------|-----------------|----------------|');
      lines.push(`| **${recName}**（当前推荐） | ${recCost.costPerSqm.toLocaleString()} | 基准 |`);
      lines.push(`| **钢结构**（钢框架+组合楼承板） | ${steelCost.costPerSqm.toLocaleString()} | ${diff > 0 ? '+' : ''}${diff.toLocaleString()} 元/㎡（${diffPctNum > 0 ? '+' : ''}${diffPct}%） |`);
      lines.push('');

      if (diff > 0) {
        lines.push(`**钢结构比${recName}贵约 ${diffPct}%**，主要原因：`);
      } else {
        lines.push(`**钢结构比${recName}略便宜约 ${Math.abs(Number(diffPct))}%**，原因：`);
      }
    }

    lines.push('');
    lines.push('### 钢结构造价构成特点');
    lines.push('');
    lines.push('钢结构造价偏高通常来自以下几个因素：');
    lines.push('');
    lines.push('1. **钢材本身价格**：型钢/Q345 等主材价格高于钢筋+混凝土折算单价');
    lines.push('2. **防火保护**：钢结构必须做防火涂料或防火板，钢柱3h耐火极限约增加 80~150 元/㎡');
    lines.push('3. **防腐处理**：防腐底漆+面漆，沿海或潮湿环境要求更高');
    lines.push('4. **围护结构**：钢结构通常配合轻质外墙（ALC板/预制挂板），这部分造价会增加');
    lines.push('');
    lines.push('### 但钢结构可能更便宜的场景');
    lines.push('');
    lines.push('1. **大跨度建筑**（体育馆、厂房、会展）：混凝土做不了大跨度或极不经济');
    lines.push('2. **超高层建筑**：钢结构自重轻，基础造价可降低，且抗震性能更好');
    lines.push('3. **工期紧迫**：钢结构施工速度快 20%~35%，早投产的经济效益可能抵消造价增量');
    lines.push('4. **改扩建项目**：钢结构构件轻、易安装，对既有结构影响小');
    lines.push('');
    lines.push(`### 本项目 ${params.buildingType === 'residential' ? '住宅' : ''} 的判断`);
    lines.push('');
    const h = params.floors * 3;
    if (params.buildingType === 'residential' && h <= 60) {
      lines.push(`常规 ${h}m 以内住宅，${recName}通常是性价比更优的选择。钢结构住宅主要问题是：`);
      lines.push('- 墙体与楼板需要配套方案（防裂、隔音），带来增量造价');
      lines.push('- 住户接受度：钢梁钢柱外露的室内处理成本');
      lines.push('- 防火防腐维护：住宅使用年限长，维护成本要考虑');
    } else if (params.buildingType === 'factory' || params.buildingType === 'gymnasium') {
      lines.push(`大跨度 ${params.buildingType === 'factory' ? '厂房' : '体育馆'}，钢结构通常是更合理的选择：`);
      lines.push(`- 主跨 ${params.mainSpan}m，混凝土很难实现或不经济`);
      lines.push('- 施工速度快，早投产早收益');
      lines.push('- 柱网布置灵活，空间利用率高');
    } else {
      lines.push('综合来看，选型取决于您的核心诉求：');
      lines.push('- **控造价优先** → 混凝土类体系更经济');
      lines.push('- **抢工期优先** → 钢结构/装配式速度更快');
      lines.push('- **大跨度空间** → 钢结构是必选项');
    }
    lines.push('');
    lines.push('> 💡 以上为**概念级估算**，用于方案比选参考。实际造价受钢材市场价格波动、运输距离、施工单位报价策略等因素影响较大。');

    return { intent, reply: lines.join('\n') };
  }

  /** ASK_SCHEDULE_COMPRESS：工期压缩可行性 */
  private handleAskScheduleCompress(intent: IIntentResult) {
    const params = this.context.currentParams;
    const lastResult = this.context.lastResult;
    const recId = lastResult?.recommended?.schemeId;
    const recName = lastResult?.recommended?.schemeName || '推荐方案';
    const lines: string[] = [];

    lines.push('## 工期压缩可行性分析');
    lines.push('');

    if (recId) {
      const sch = executeToolByName('estimate_schedule', {
        systemId: recId,
        area: params.area,
        floors: params.floors,
      }) as { totalMonths: number; systemName: string };

      lines.push(`### 当前 ${recName} 工期估算`);
      lines.push('');
      lines.push(`- **总工期**：约 **${sch.totalMonths} 个月**（不含前期报建、室外工程）`);
      lines.push('');
      lines.push('### 工期构成（典型比例）');
      lines.push('');
      lines.push('| 阶段 | 占比 | 压缩空间 |');
      lines.push('|------|------|----------|');
      lines.push('| 基础工程 | 15%~25% | 较小（受地质条件约束大） |');
      lines.push('| 主体结构 | 40%~55% | 较大（增加作业面、流水施工优化） |');
      lines.push('| 装修与机电 | 25%~35% | 中等（穿插施工可节省） |');
      lines.push('| 竣工验收 | 5%~10% | 较小（程序问题） |');
      lines.push('');
    }

    lines.push('### 可行的压缩途径');
    lines.push('');
    lines.push('**1. 结构体系选型**');
    lines.push('- 钢结构 / 装配式结构：比现浇混凝土快 20%~35%');
    lines.push('- 铝模+爬架体系：比传统木模+外架快约 15%');
    lines.push('');
    lines.push('**2. 施工组织优化**（不需要改方案，直接见效）');
    lines.push('- 增加作业班组和作业面（流水段划细）');
    lines.push('- 主体与装修穿插施工（主体到一半就开始下部装修）');
    lines.push('- 关键路径管理，压缩非关键路径意义不大');
    lines.push('');
    lines.push('**3. 技术措施**');
    lines.push('- 早强混凝土 / 免抹灰工艺');
    lines.push('- 预制构件（叠合板、楼梯、阳台）');
    lines.push('- BIM 技术减少返工');
    lines.push('');
    lines.push('### 压缩工期的代价');
    lines.push('');
    lines.push('- **造价上升**：赶工通常带来加班费、措施费增加，每压缩 10% 工期，造价约增加 5%~12%');
    lines.push('- **质量风险**：过度赶工容易出现质量缺陷，后期维修成本更高');
    lines.push('- **安全风险**：赶工状态下安全事故概率显著上升');
    lines.push('');
    lines.push('### 我的建议');
    lines.push('');
    lines.push(`如果工期确实是硬约束，建议先评估是否可以换用更快的结构体系（如装配式钢结构），这是**系统性**节省工期，比在施工阶段硬赶更经济也更安全。`);
    lines.push('');
    lines.push('> ⚠️ 以上为**概念级分析**，具体工期压缩方案需由施工单位结合劳动力、材料供应、场地条件等详细编制施工组织设计后确定。');

    return { intent, reply: lines.join('\n') };
  }

  /** ASK_COMPLIANCE_RISK：合规性与风险汇总 */
  private handleAskComplianceRisk(intent: IIntentResult) {
    const lastResult = this.context.lastResult;
    const lines: string[] = [];

    lines.push('## 方案合规性与风险评估');
    lines.push('');

    if (!lastResult || !lastResult.codeChecks || Object.keys(lastResult.codeChecks).length === 0) {
      lines.push('尚未生成方案，请先输入项目参数并生成方案，再查看合规性评估。');
      return { intent, reply: lines.join('\n') };
    }

    const recId = lastResult.recommended.schemeId;
    const recName = lastResult.recommended.schemeName;
    const recChecks = (lastResult.codeChecks as Record<string, { seismic: { checks: Array<{ name: string; status: string; clauseText?: string; reason?: string; source?: string }>; passCount: number; warningCount: number; failCount: number }; fire: { checks: Array<{ article: string; status: string }>; passCount: number; warningCount: number; failCount: number } }>)[recId];

    lines.push(`### 推荐方案「${recName}」合规性汇总`);
    lines.push('');

    if (recChecks) {
      const seis = recChecks.seismic;
      const fire = recChecks.fire;
      const totalPass = seis.passCount + fire.passCount;
      const totalWarn = seis.warningCount + fire.warningCount;
      const totalFail = seis.failCount + fire.failCount;
      const total = totalPass + totalWarn + totalFail;

      lines.push(`| 类别 | 符合 | 需注意 | 不符合 | 合计 |`);
      lines.push(`|------|------|--------|--------|------|`);
      lines.push(`| 抗震规范 | ${seis.passCount} | ${seis.warningCount} | ${seis.failCount} | ${seis.passCount + seis.warningCount + seis.failCount} |`);
      lines.push(`| 防火规范 | ${fire.passCount} | ${fire.warningCount} | ${fire.failCount} | ${fire.passCount + fire.warningCount + fire.failCount} |`);
      lines.push(`| **合计** | **${totalPass}** | **${totalWarn}** | **${totalFail}** | **${total}** |`);
      lines.push('');

      if (totalFail > 0) {
        lines.push('❌ **存在不符合项**，方案需要调整后才能满足规范要求。');
        lines.push('');
        const failItems = [
          ...seis.checks.filter((c) => c.status === 'fail').map((c) => `- [抗震] ${c.name}`),
          ...fire.checks.filter((c) => c.status === 'fail').map((c) => `- [防火] ${c.article}`),
        ];
        failItems.forEach((item) => lines.push(item));
      } else if (totalWarn > 0) {
        lines.push('⚠️ **全部通过，但有注意项**——方案整体合规，以下项目需在设计阶段重点关注：');
        lines.push('');
        const warnItems = [
          ...seis.checks.filter((c) => c.status === 'warning').map((c) => `- **[抗震] ${c.name}**：${c.reason || c.clauseText?.slice(0, 60) || '接近限值或需专项措施'}`),
          ...fire.checks.filter((c) => c.status === 'warning').map((c) => `- **[防火] ${c.article}**：需采取专项构造措施`),
        ];
        warnItems.forEach((item) => lines.push(item));
      } else {
        lines.push('✅ **全部符合规范要求**，各项指标均有充足余量。');
      }
    }

    lines.push('');
    lines.push('### 主要风险点与应对建议');
    lines.push('');
    lines.push('**抗震类风险**：');
    lines.push('- 位移角偏紧 → 增加剪力墙/核心筒数量或厚度，提高侧向刚度');
    lines.push('- 剪重比不足 → 按规范第5.2.5条放大地震作用，或调整结构布置');
    lines.push('- 周期比超限 → 调整抗侧力构件布置，使刚度分布更均匀');
    lines.push('- 轴压比偏大 → 提高混凝土强度等级或增大墙/柱截面');
    lines.push('');
    lines.push('**防火类风险**：');
    lines.push('- 钢结构耐火极限 → 采用防火涂料或防火板包覆，选择合适的构造方案');
    lines.push('- 防火分区面积 → 合理划分防火分区，设置自动灭火系统');
    lines.push('');
    lines.push('**施工类风险**：');
    lines.push('- 大跨度构件吊装 → 编制专项吊装方案，选用合适起重设备');
    lines.push('- 高支模 → 超高模板支撑需专家论证');
    lines.push('');
    lines.push('> 💡 以上风险评估基于概念级公式估算，具体项目需由注册结构工程师主持，采用专业软件逐项验算。');

    return { intent, reply: lines.join('\n') };
  }

  /** ASK_BUDGET_CUT：预算大幅削减 */
  private async handleAskBudgetCut(intent: IIntentResult) {
    const params = this.context.currentParams;
    const pct = intent.budgetCutPercent || 20;
    const newBudget = Math.round(params.budget * (1 - pct / 100));
    const lines: string[] = [];

    lines.push(`## 预算削减 ${pct}% 的影响分析`);
    lines.push('');
    lines.push(`| 项目 | 当前 | 削减后 |`);
    lines.push('|------|------|--------|');
    lines.push(`| 预算约束 | ${params.budget.toLocaleString()} 元/㎡ | **${newBudget.toLocaleString()} 元/㎡** |`);
    lines.push(`| 削减幅度 | - | ${pct}%（${(params.budget - newBudget).toLocaleString()} 元/㎡） |`);
    lines.push('');

    // 计算各方案造价，看哪些能满足新预算
    const candidates = this.context.lastResult?.ranking || [];
    if (candidates.length > 0) {
      lines.push('### 各方案在新预算下的可负担性');
      lines.push('');
      const costList = candidates.map((c) => {
        const costResult = executeToolByName('estimate_cost', {
          systemId: c.schemeId,
          floors: params.floors,
          seismicIntensity: params.seismicIntensity,
          soilCategory: params.soilCategory,
          mainSpan: params.mainSpan,
        }) as { costPerSqm: number };
        return { name: c.schemeName, cost: costResult.costPerSqm, affordable: costResult.costPerSqm <= newBudget };
      });
      costList.sort((a, b) => a.cost - b.cost);
      costList.forEach((c) => {
        lines.push(`- ${c.affordable ? '✅' : '❌'} **${c.name}**：${c.cost.toLocaleString()} 元/㎡ ${c.affordable ? '（可承受）' : '（超出预算）'}`);
      });

      const affordableCount = costList.filter((c) => c.affordable).length;
      lines.push('');

      if (affordableCount === 0) {
        lines.push(`⚠️ **全部候选方案都超出了 ${newBudget} 元/㎡ 的预算**。`);
        lines.push('');
        lines.push('要实现这个预算水平，可能需要：');
        lines.push('1. **降低结构安全储备**：减小构件截面，但会降低抗震性能（不推荐，高烈度区尤其不建议）');
        lines.push('2. **选用更简单的体系**：如纯框架（但要确认位移角等指标仍能满足）');
        lines.push('3. **降低标准**：降低装修标准、机电配置（非结构部分的削减空间通常更大）');
        lines.push('4. **优化建筑方案**：减小柱网跨度、减少悬挑、规整平面（建筑方案对造价影响很大）');
      } else if (affordableCount < costList.length) {
        lines.push(`✅ **${affordableCount} 个方案能满足 ${newBudget} 元/㎡ 预算**，但推荐方案可能会变化。`);
        lines.push('');
        lines.push(`如果预算必须降到 ${newBudget} 元/㎡，选型重心会从"安全最优"转向"经济合规"，推荐方案可能会从当前的${this.context.lastResult?.recommended.schemeName}调整为更便宜的体系。是否要我**用新预算重新生成方案**？`);
      } else {
        lines.push(`✅ **所有候选方案都能满足 ${newBudget} 元/㎡ 预算**，预算有充足余量。`);
      }
    }

    lines.push('');
    lines.push('### 造价削减的常见路径');
    lines.push('');
    lines.push('**结构专业能做的（约占建安造价 40%~60%）：**');
    lines.push('- 优化柱网：减小跨度，梁板截面随之减小');
    lines.push('- 合理层高：每降 10cm 层高，造价约降 0.5%~1%');
    lines.push('- 控制含钢量：精细化设计，避免过度保守');
    lines.push('- 体系选择：纯框架比框剪便宜，但抗震性能下降');
    lines.push('');
    lines.push('**非结构部分的削减空间通常更大：**');
    lines.push('- 降低外墙和装修标准');
    lines.push('- 简化机电系统配置');
    lines.push('- 园林和室外工程控制');
    lines.push('');
    lines.push('> ⚠️ 结构造价的削减空间有限（通常 ±10% 以内），且高烈度区削减造价会直接影响安全储备。**砍预算优先砍非结构部分，不要在结构安全上动刀**。');

    // 如果有 1+ 个方案能负担，触发重新生成
    return { intent, reply: lines.join('\n') };
  }

  /** ASK_BENCHMARK：与同类项目对比 */
  private handleAskBenchmark(intent: IIntentResult) {
    const params = this.context.currentParams;
    const lastResult = this.context.lastResult;
    const recName = lastResult?.recommended?.schemeName || '推荐方案';
    const lines: string[] = [];

    lines.push('## 与同类项目对比分析');
    lines.push('');
    lines.push('### 先坦诚：本工具没有外部项目数据库');
    lines.push('');
    lines.push('本工具是**单机版概念设计助手**，没有接入真实项目数据库，无法和"周边项目"做精确对标。以下分析基于行业一般水平和你当前项目的估算值做定性对比。');
    lines.push('');
    lines.push(`### 你的项目画像（${params.floors}层、${params.seismicIntensity}度、${params.buildingType === 'residential' ? '住宅' : params.buildingType}）`);
    lines.push('');

    if (lastResult && lastResult.recommended) {
      const recCost = lastResult.metrics
        ? (lastResult.metrics[lastResult.recommended.schemeId] as { cost?: { costPerSqm?: number } })?.cost?.costPerSqm
        : undefined;

      if (recCost) {
        lines.push(`- **推荐方案**：${recName}`);
        lines.push(`- **估算造价**：${recCost.toLocaleString()} 元/㎡（结构主体）`);
      }

      // 各维度行业基准判断
      lines.push('');
      lines.push('### 各项指标的行业定位（基于经验判断）');
      lines.push('');
      const intensityVal = parseInt(params.seismicIntensity, 10);
      const h = params.floors * 3;

      // 造价定位
      if (recCost) {
        let costBenchmark = '';
        if (intensityVal <= 6) costBenchmark = '高于低烈度区一般水平（正常，因为烈度低造价本应更低）';
        else if (intensityVal === 7) costBenchmark = '处于7度区常规区间';
        else if (intensityVal === 8) costBenchmark = '处于8度区常规区间，比7度区高约15%~20%（符合烈度修正规律）';
        else costBenchmark = '9度区高设防标准，造价显著高于全国平均水平（正常）';
        lines.push(`- **造价**：${costBenchmark}`);
      }

      // 体系选型定位
      let systemBenchmark = '';
      if (params.buildingType === 'residential') {
        if (h <= 30) systemBenchmark = `${h}m以内小高层住宅，推荐体系与行业主流一致（框架/框剪为主）`;
        else if (h <= 60) systemBenchmark = `${h}m中高层住宅，剪力墙/框剪是行业主流选型`;
        else systemBenchmark = `${h}m高层住宅，剪力墙体系是行业绝对主流`;
      } else if (params.buildingType === 'office') {
        systemBenchmark = `${h}m办公楼，${recName}是同高度项目常用体系`;
      } else if (params.buildingType === 'school') {
        systemBenchmark = '教学楼项目，按GB 50011要求重点设防类（乙类），抗震措施提高一度，选型偏保守是对的';
      } else {
        systemBenchmark = `${params.buildingType} 建筑，${recName}属于常规选型`;
      }
      lines.push(`- **体系选型**：${systemBenchmark}`);

      // 抗震定位
      let seismicBenchmark = '';
      if (intensityVal >= 8) {
        seismicBenchmark = `${params.seismicIntensity}度区属于高烈度设防，项目抗震设计标准高于全国平均水平，这是合理的——"为人民建好房"首先要保证安全`;
      } else if (intensityVal === 7) {
        seismicBenchmark = '7度区是全国最常见的设防烈度，你的项目与多数城市项目处于同一水准';
      } else {
        seismicBenchmark = `${params.seismicIntensity}度区设防标准较低，造价和构造要求都相对宽松`;
      }
      lines.push(`- **抗震标准**：${seismicBenchmark}`);
    }

    lines.push('');
    lines.push('### 如果你需要真正的对标数据');
    lines.push('');
    lines.push('可以从以下渠道获取同类项目的真实数据：');
    lines.push('');
    lines.push('1. **当地造价站**：发布的工程造价指标（最权威）');
    lines.push('2. **已建成项目**：本单位或合作单位过往类似项目的结算数据');
    lines.push('3. **行业数据库**：广联达指数、造价通等商业数据库');
    lines.push('4. **招标控制价**：公开招标项目的控制价信息');
    lines.push('');
    lines.push('> 💡 概念比选阶段，**方向判断比精确数字更重要**。本工具给出的量级估算（±15% 精度）足够用于方案选型决策。');

    return { intent, reply: lines.join('\n') };
  }

  /** 抗震等级查询 */
  private handleAskSeismicGrade(intent: IIntentResult) {
    const params = this.context.currentParams;
    if (!params) {
      return { intent, reply: '请先输入项目参数，我会根据设防烈度、结构类型和高度给出抗震等级估算。' };
    }

    const intensity = Number(params.seismicIntensity);
    const height = params.floors * 3.2; // 概念估算层高3.2m
    const lines: string[] = [];

    lines.push('## 抗震等级概念估算');
    lines.push('');
    lines.push(`> ⚠️ 以下为**方案阶段概念估算**，仅用于选型参考。正式设计需按 GB/T 50011 表 6.1.2 精确查表，并考虑建筑抗震设防类别（甲/乙/丙/丁类）的调整。`);
    lines.push('');
    lines.push('### 项目条件');
    lines.push('');
    lines.push(`- 设防烈度：**${params.seismicIntensity} 度**`);
    lines.push(`- 结构类型：${params.structurePreference === 'any' ? '按推荐体系估算' : params.structurePreference}`);
    lines.push(`- 估算高度：约 ${height.toFixed(0)} m（按层高 3.2m 估算）`);
    lines.push('');
    lines.push('### 各候选体系抗震等级（框架 / 剪力墙）');
    lines.push('');
    lines.push('| 结构体系 | 框架抗震等级 | 剪力墙抗震等级 | 说明 |');
    lines.push('|---|---|---|---|');

    // 根据烈度和高度查表（GB 50011-2010 表6.1.2 简化）
    const schemes = this.context.lastResult?.ranking.slice(0, 3) || [];
    if (schemes.length === 0) {
      // 没有生成方案的话，按结构偏好给个大概
      let frameGrade = '三级', wallGrade = '三级';
      if (intensity >= 8) {
        if (height > 60) { frameGrade = '一级'; wallGrade = '一级'; }
        else if (height > 30) { frameGrade = '二级'; wallGrade = '二级'; }
        else { frameGrade = '二级'; wallGrade = '三级'; }
      } else if (intensity === 7) {
        if (height > 80) { frameGrade = '一级'; wallGrade = '一级'; }
        else if (height > 50) { frameGrade = '二级'; wallGrade = '二级'; }
        else { frameGrade = '三级'; wallGrade = '三级'; }
      } else {
        if (height > 100) { frameGrade = '二级'; wallGrade = '二级'; }
        else { frameGrade = '三级'; wallGrade = '四级'; }
      }
      lines.push(`| 框架结构 | ${frameGrade} | — | 纯框架体系 |`);
      lines.push(`| 剪力墙结构 | — | ${wallGrade} | 纯剪力墙体系 |`);
      lines.push(`| 框架-剪力墙 | ${frameGrade} | ${wallGrade} | 框剪体系，剪力墙为第一道防线 |`);
    } else {
      for (const s of schemes) {
        const name = s.schemeName;
        let frameG = '—', wallG = '—', note = '';

        if (name.includes('框架') && !name.includes('剪力墙')) {
          // 纯框架
          if (intensity >= 8) frameG = height > 30 ? '二级' : '二级';
          else if (intensity === 7) frameG = height > 50 ? '二级' : '三级';
          else frameG = '三级';
          note = '纯框架，延性好但侧移大';
        } else if (name.includes('剪力墙') && !name.includes('框架')) {
          // 纯剪力墙
          if (intensity >= 8) wallG = height > 60 ? '一级' : '二级';
          else if (intensity === 7) wallG = height > 80 ? '一级' : '二级';
          else wallG = '三级';
          note = '剪力墙抗侧刚度大';
        } else if (name.includes('框剪') || (name.includes('框架') && name.includes('剪力'))) {
          // 框剪
          if (intensity >= 8) { frameG = height > 60 ? '一级' : '二级'; wallG = height > 60 ? '一级' : '二级'; }
          else if (intensity === 7) { frameG = height > 80 ? '二级' : '三级'; wallG = height > 80 ? '二级' : '三级'; }
          else { frameG = '三级'; wallG = '三级'; }
          note = '框剪协同，剪力墙承担大部分剪力';
        } else if (name.includes('钢')) {
          frameG = intensity >= 8 ? '二级' : '三级';
          note = '钢结构延性好，抗震等级相对宽松';
        } else if (name.includes('装配')) {
          frameG = intensity >= 8 ? '二级' : '三级';
          wallG = intensity >= 8 ? '二级' : '三级';
          note = '装配式等同现浇设计，抗震等级同现浇';
        }

        lines.push(`| ${name} | ${frameG} | ${wallG} | ${note} |`);
      }
    }

    lines.push('');
    lines.push('### 查表依据');
    lines.push('');
    lines.push('抗震等级根据 **GB/T 50011《建筑抗震设计规范》** 表 6.1.2 确定，主要影响因素：');
    lines.push('');
    lines.push('1. **设防烈度**：烈度越高等级越高');
    lines.push('2. **结构类型**：框架 > 框剪 > 剪力墙（同高度下框架等级更高）');
    lines.push('3. **建筑高度**：高度越高等级越高，有明确的高度分界');
    lines.push('4. **设防类别**：乙类建筑提高一度查表，甲类更高');
    lines.push('');
    lines.push('> 💡 **抗震等级决定了什么？** 它决定了构件的配筋率、轴压比限值、构造措施（箍筋加密区长度、边缘构件范围等）。等级越高，构造要求越严格，造价也相应增加。');

    return { intent, reply: lines.join('\n') };
  }

  /** 基础形式建议 */
  private handleAskFoundation(intent: IIntentResult) {
    const params = this.context.currentParams;
    if (!params) {
      return { intent, reply: '请先输入项目参数，我会根据建筑高度、结构体系和场地条件给出基础形式建议。' };
    }

    const height = params.floors * 3.2;
    const soil = params.soilCategory;
    const geology = params.geologyType;
    const schemes = this.context.lastResult?.ranking.slice(0, 3) || [];
    const lines: string[] = [];

    // 调用 advise_foundation 工具获取基础方案建议
    const topSystemId = schemes[0]?.schemeId || 'frame-shearwall';
    const toolResult = executeToolByName('advise_foundation', {
      systemId: topSystemId,
      geologyType: geology,
      floors: params.floors,
      soilCategory: soil,
    }) as { foundationType: string; reasoning: string; notes?: string[] };

    lines.push('## 基础形式概念建议');
    lines.push('');
    lines.push(`> 🛠️ **调用工具**：\`advise_foundation\` — 基于上部结构体系、场地土类别、地质条件给出基础方案建议`);
    lines.push('');
    lines.push('> ⚠️ 以下为**方案阶段概念建议**，正式设计需根据地勘报告和上部结构计算结果由专业工程师确定。');
    lines.push('');
    lines.push('### 场地条件');
    lines.push('');
    lines.push(`- 场地土类别：**${soil} 类**`);
    lines.push(`- 地质类型：**${geology === 'rock' ? '岩石地基' : geology === 'clay' ? '一般黏土' : geology === 'loess' ? '湿陷性黄土' : geology === 'fill' ? '人工填土' : '其他地质'}**`);
    lines.push(`- 估算高度：约 ${height.toFixed(0)} m（${params.floors} 层）`);
    lines.push(`- 推荐上部结构：**${schemes[0]?.schemeName || '待确定'}**`);
    lines.push('');
    lines.push('### 推荐基础形式');
    lines.push('');
    lines.push(`**${toolResult.foundationType}**`);
    lines.push('');
    lines.push(`**理由：** ${toolResult.reasoning}`);
    lines.push('');
    lines.push('### 设计要点');
    lines.push('');
    // 合并工具返回的 notes 和手写的通用提示
    if (toolResult.notes && toolResult.notes.length > 0) {
      for (const n of toolResult.notes) {
        lines.push(`- ${n}`);
      }
    }
    lines.push('- 基础埋深通常取建筑高度的 1/15~1/18（桩基础取 1/20~1/25）');
    lines.push('- 抗震设防区基础应有良好的整体性和抗倾覆能力');
    lines.push('- 地下水位较高时，施工期间需降水，并关注对周边建筑的影响');
    lines.push('');
    lines.push('> 📐 **为什么基础选型重要？** 基础工程造价占总造价的 15%~30%，工期占总工期的 20%~30%。选型合理可以显著节省造价和工期——这也是"为人民建好房"理念在看不见的地方的体现。');

    return { intent, reply: lines.join('\n') };
  }

  /** 含钢量/用钢量估算（调用 estimate_material_use 工具） */
  private handleAskSteelRatio(intent: IIntentResult) {
    const params = this.context.currentParams;
    const schemes = this.context.lastResult?.ranking.slice(0, 3) || [];
    if (!params) {
      return { intent, reply: '请先输入项目参数，我会给出各体系的含钢量概念区间。' };
    }

    const lines: string[] = [];

    lines.push('## 含钢量（用钢量）概念估算');
    lines.push('');
    lines.push('> 🛠️ **调用工具**：`estimate_material_use` — 基于结构体系、层数、设防烈度估算材料用量');
    lines.push('');
    lines.push('> ⚠️ 以下为**方案阶段量级估算**，单位 kg/㎡（混凝土结构为钢筋用量，钢结构为型钢用量）。实际含钢量受柱网、层高、抗震等级、荷载等多种因素影响，±15% 均属正常范围，**需专业结构计算软件复核**。');
    lines.push('');
    lines.push('### 各候选方案含钢量估算');
    lines.push('');
    lines.push('| 结构体系 | 含钢量范围 (kg/㎡) | 混凝土用量 (m³/㎡) | 备注 |');
    lines.push('|---|---|---|---|');

    // 对每个候选方案调用工具
    const estimateSystems = schemes.length > 0
      ? schemes.map((s) => s.schemeId)
      : ['frame', 'frame-shearwall', 'shearwall'];

    for (const sysId of estimateSystems) {
      const result = executeToolByName('estimate_material_use', {
        systemId: sysId,
        floors: params.floors,
        seismicIntensity: params.seismicIntensity,
        buildingType: params.buildingType,
      }) as {
        systemName: string;
        steelPerSqm: { low: number; high: number; unit: string; note: string };
        concretePerSqm: { low: number; high: number; unit: string; note: string };
      };

      const isCandidate = schemes.some((s) => s.schemeId === sysId);
      const tag = isCandidate ? ' ⭐' : '';

      lines.push(
        `| ${result.systemName}${tag} | ${result.steelPerSqm.low}~${result.steelPerSqm.high} ${result.steelPerSqm.unit} | ${result.concretePerSqm.low}~${result.concretePerSqm.high} ${result.concretePerSqm.unit} | ${result.steelPerSqm.note.length > 20 ? result.steelPerSqm.note.slice(0, 20) + '…' : result.steelPerSqm.note} |`
      );
    }

    lines.push('');
    lines.push('### 影响含钢量的主要因素');
    lines.push('');
    lines.push('1. **设防烈度**：每提高一度，含钢量约增加 5%~10%');
    lines.push('2. **建筑高度**：高度越高，风荷载和地震作用越大，底部加强区含钢量显著增加');
    lines.push('3. **柱网尺寸**：大跨度柱网含钢量显著增加');
    lines.push('4. **抗震等级**：等级每提高一级，含钢量约增加 5%~10%');
    lines.push('5. **荷载标准**：活荷载取值、覆土厚度等直接影响配筋');
    lines.push('');

    if (schemes.length > 0) {
      const top = schemes[0];
      const topResult = executeToolByName('estimate_material_use', {
        systemId: top.schemeId,
        floors: params.floors,
        seismicIntensity: params.seismicIntensity,
        buildingType: params.buildingType,
      }) as { steelPerSqm: { low: number; high: number } };
      const totalArea = params.area;
      const steelTotalLow = Math.round((topResult.steelPerSqm.low * totalArea) / 1000);
      const steelTotalHigh = Math.round((topResult.steelPerSqm.high * totalArea) / 1000);
      lines.push(`> 📊 按推荐方案（${top.schemeName}）估算，本项目总用钢量约 **${steelTotalLow}~${steelTotalHigh} 吨**（${totalArea.toLocaleString()}㎡ × ${topResult.steelPerSqm.low}~${topResult.steelPerSqm.high} kg/㎡）。`);
    }

    return { intent, reply: lines.join('\n') };
  }

  /** 构件截面概念估算（调用 estimate_column_beam 工具） */
  private handleAskSectionSize(intent: IIntentResult) {
    const params = this.context.currentParams;
    const schemes = this.context.lastResult?.ranking.slice(0, 3) || [];
    if (!params) {
      return { intent, reply: '请先输入项目参数，我会给出梁高、柱截面等构件尺寸的概念估算。' };
    }

    const span = params.mainSpan;
    const floors = params.floors;
    const lines: string[] = [];

    lines.push('## 构件截面概念估算');
    lines.push('');
    lines.push('> 🛠️ **调用工具**：`estimate_column_beam` — 按结构体系、跨度、层数、设防烈度估算典型构件截面');
    lines.push('');
    lines.push('> ⚠️ 以下为**方案阶段量级估算**，仅用于判断空间占用和造价估算。正式设计需经结构计算软件（PKPM/YJK/SAUSAGE 等）分析确定。');
    lines.push('');
    lines.push('### 基本参数');
    lines.push('');
    lines.push(`- 主要跨度：**${span} m**`);
    lines.push(`- 建筑层数：**${floors} 层**`);
    lines.push(`- 设防烈度：**${params.seismicIntensity} 度**`);
    lines.push('');
    lines.push('### 各候选方案典型构件尺寸');
    lines.push('');
    lines.push('| 结构体系 | 主梁梁高 | 柱截面 | 说明 |');
    lines.push('|---|---|---|---|');

    const estimateSystems = schemes.length > 0
      ? schemes.map((s) => s.schemeId)
      : ['frame', 'frame-shearwall', 'shearwall'];

    for (const sysId of estimateSystems) {
      const result = executeToolByName('estimate_column_beam', {
        systemId: sysId,
        span,
        floors,
        seismicIntensity: params.seismicIntensity,
        soilCategory: params.soilCategory,
      }) as {
        systemName: string;
        beam: { range: string; unit: string; description: string };
        column: { range: string; unit: string; description: string };
        disclaimer?: string;
      };

      const isCandidate = schemes.some((s) => s.schemeId === sysId);
      const tag = isCandidate ? ' ⭐' : '';

      // 简化描述
      const colShort = result.column.range.length > 20
        ? result.column.range.slice(0, 20) + '…'
        : result.column.range;

      lines.push(
        `| ${result.systemName}${tag} | ${result.beam.range} ${result.beam.unit} | ${colShort} | ${result.beam.description.length > 15 ? result.beam.description.slice(0, 15) + '…' : result.beam.description} |`
      );
    }

    lines.push('');
    lines.push('### 板厚估算');
    lines.push('');
    lines.push('- **普通楼板**：板厚取短跨的 1/35~1/40，通常 100~120mm');
    lines.push('- **人防顶板**：通常 200~250mm');
    lines.push('- **转换层楼板**：通常 180~200mm，需加强配筋');
    lines.push('- **无梁楼盖**：板厚取柱网的 1/30~1/35，通常 200~300mm');
    lines.push('');
    lines.push('### 层高影响提示');
    lines.push('');

    // 用第一个候选方案的梁高估算净高
    if (estimateSystems.length > 0) {
      const firstResult = executeToolByName('estimate_column_beam', {
        systemId: estimateSystems[0],
        span,
        floors,
        seismicIntensity: params.seismicIntensity,
        soilCategory: params.soilCategory,
      }) as { beam: { range: string }; systemName: string };
      const beamRange = firstResult.beam.range.split('~');
      const beamHigh = Number(beamRange[1] || beamRange[0] || '600');
      const totalDeduct = beamHigh + 120 + 300;
      lines.push(`按 ${firstResult.systemName} 主梁高约 ${beamHigh}mm + 板厚 120mm + 吊顶/管线 300mm 估算，**净层高** 比结构层高小约 **${totalDeduct}mm**。如果对净高有严格要求，可以考虑宽扁梁或无梁楼盖方案。`);
    }

    lines.push('');
    lines.push('> 📐 **估算依据**：梁高按高跨比（混凝土梁约 1/10~1/16，钢梁约 1/18~1/24）；柱截面按底部加强部位的轴压比控制估算，以上各层可逐级收窄。实际尺寸需根据轴压比、剪压比、延性要求等按规范计算确定。');

    return { intent, reply: lines.join('\n') };
  }

  /** UNKNOWN：普通工程问答（真实模式走 LLM，演示模式用知识库） */
  private async handleUnknown(intent: IIntentResult, message: string) {
    const useReal = isRealModeAvailable();

    if (useReal) {
      try {
        const engine = new RealEngine(
          this.context.currentParams,
          this.context.weights || MOCK_WEIGHT_CONFIG
        );
        // 构建上下文提示
        let contextPrompt = '';
        if (this.context.lastResult) {
          const schemes = this.context.lastResult.ranking
            .map((r) => `${r.schemeName} (${r.score.toFixed(1)}分)`)
            .join('、');
          contextPrompt = `当前上下文：项目 ${this.context.currentParams.floors} 层，已生成候选方案 ${schemes}，推荐 ${this.context.lastResult.recommended.schemeName}。\n\n`;
        }
        const { finalAnswer } = await engine.run(
          `${contextPrompt}用户问题：${message}\n\n请用专业、清晰的方式回答用户的问题。如果涉及具体规范，请引用规范名称和条文号。`,
          'assistant'
        );
        return {
          intent,
          reply: finalAnswer || '抱歉，我无法回答这个问题。',
        };
      } catch (e) {
        logger.warn('LLM 回答失败，回退到规则模式:', String(e));
      }
    }

    // 演示模式兜底：调用 TraceEngine 的工具辅助回答
    const lastResult = this.context.lastResult;

    // 简单关键词匹配回答
    if (/造价|成本|多少钱|价格/.test(message)) {
      if (lastResult && Object.keys(lastResult.metrics).length > 0) {
        const lines = ['## 各方案造价对比', ''];
        Object.entries(lastResult.metrics).forEach(([schemeId, m]) => {
          const metrics = m as { cost: { costPerSqm: number } };
          const scheme = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === schemeId);
          lines.push(`- **${scheme?.name || schemeId}**：${metrics.cost?.costPerSqm?.toLocaleString() || '-'} 元/㎡`);
        });
        lines.push('');
        lines.push('> 注：造价为估算值，仅供前期方案比选参考。');
        return { intent, reply: lines.join('\n') };
      }
    }

    if (/工期|时间|多久|进度/.test(message)) {
      if (lastResult && Object.keys(lastResult.metrics).length > 0) {
        const lines = ['## 各方案工期对比', ''];
        Object.entries(lastResult.metrics).forEach(([schemeId, m]) => {
          const metrics = m as { schedule: { totalMonths: number } };
          const scheme = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === schemeId);
          lines.push(`- **${scheme?.name || schemeId}**：约 ${metrics.schedule?.totalMonths || '-'} 个月`);
        });
        return { intent, reply: lines.join('\n') };
      }
    }

    if (/抗震|地震|安全性|安全/.test(message)) {
      if (lastResult && Object.keys(lastResult.codeChecks).length > 0) {
        const lines = ['## 各方案抗震性能评估', ''];
        Object.entries(lastResult.codeChecks).forEach(([schemeId, c]) => {
          const checks = c as { seismic: { passCount: number; warningCount: number; failCount: number } };
          const scheme = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === schemeId);
          lines.push(
            `- **${scheme?.name || schemeId}**：${checks.seismic?.passCount || 0} 项符合 / ${checks.seismic?.warningCount || 0} 项需注意 / ${checks.seismic?.failCount || 0} 项不符合`
          );
        });
        return { intent, reply: lines.join('\n') };
      }
    }

    // UNKNOWN 诚实兜底：不硬答，结合当前工程上下文给可执行的下一步
    const params = this.context.currentParams;
    const result = this.context.lastResult;
    const height = params.floors * 3;

    // 粗判问题方向（用于话术里的「相关专业方向」）
    let topic = '结构工程';
    if (/基础|地基|桩|承台|地勘/.test(message)) topic = '基础工程与岩土勘察';
    else if (/风|风荷载|风振|舒适度/.test(message)) topic = '风工程与人居舒适度';
    else if (/温度|收缩|徐变|裂缝/.test(message)) topic = '混凝土耐久性与裂缝控制';
    else if (/施工|吊装|模板|脚手架|工艺/.test(message)) topic = '施工工艺与建造方法';
    else if (/经济|清单|定额|取费/.test(message)) topic = '工程造价与定额计价';
    else if (/绿建|碳|能耗|节能|LEED|WELL/.test(message)) topic = '绿色建筑与碳减排';
    else if (/隔震|消能|阻尼器/.test(message)) topic = '隔震与消能减震技术';
    else if (/消防|疏散|防火/.test(message) && !/钢结构|构件/.test(message)) topic = '建筑防火与疏散设计';
    else if (/排水|暖通|机电|管线/.test(message)) topic = '机电系统与管线综合';
    else if (/幕墙|外墙|立面|表皮/.test(message)) topic = '建筑幕墙与外围护';

    const recScheme = lastResult?.recommended?.schemeName || '推荐方案';
    const sysList = lastResult?.ranking?.map((r) => r.schemeName).join('、') || '各候选方案';
    const isFoundationTopic = /基础|地基|桩|承台|地勘|岩土|持力层/.test(message);
    const isFireTopic = /消防|疏散|防火|耐火|防火分区/.test(message) && !/钢结构|构件/.test(message);
    const isWindTopic = /风|风荷载|风振|舒适度|横风|顺风/.test(message);
    const isSeismicDetailTopic = /隔震|消能|阻尼器|减震|屈曲约束|BRB/.test(message);
    const isCostDetailTopic = /清单|定额|取费|造价明细|分项/.test(message);
    const isConstructionTopic = /施工|吊装|模板|脚手架|工艺|施工组织/.test(message);
    const isGreenTopic = /绿建|碳|能耗|节能|LEED|WELL/.test(message);
    const isCrackTopic = /裂缝|温度|收缩|徐变|耐久性/.test(message);
    const isMepTopic = /排水|暖通|机电|管线综合/.test(message);
    const isFacadeTopic = /幕墙|外墙|立面|表皮/.test(message);

    const lines: string[] = [];
    lines.push(`结合你当前项目（${params.floors}层、约${height}m、${params.seismicIntensity}度设防、${recScheme}），先给你一个**概念层面的判断**：`);
    lines.push('');

    // 先给一句有信息量的回应（结合项目特征），不是上来就说做不到
    if (isFoundationTopic) {
      lines.push(`> 基础选型的核心约束是**持力层承载力**和**场地土层分布**。你当前是${params.soilCategory}类场地，${params.seismicIntensity}度设防，建议拿到初勘报告后再做基础方案比选——在那之前，可以先从上部结构体系反推柱底轴力量级，初步估算基础规格。`);
    } else if (isFireTopic) {
      lines.push(`> 防火设计的关键是**防火分区**和**构件耐火极限**。${recScheme}如果是混凝土结构，耐火性能天然较好；如果是钢结构，需要做防火涂料，这部分成本要纳入比选。`);
    } else if (isWindTopic) {
      lines.push(`> 风荷载对${height}m高、${params.buildingType === 'residential' ? '住宅' : '公共'}建筑的影响${height > 60 ? '不可忽略，舒适度验算需要重点关注' : '通常不起控制作用，地震作用可能是主导'}。`);
    } else if (isSeismicDetailTopic) {
      lines.push(`> ${params.seismicIntensity}度区做隔震/减震是可行的技术路线，但具体是否经济，要看建筑功能和层间位移控制要求。`);
    } else if (isCostDetailTopic) {
      lines.push(`> 方案阶段的造价精度在 ±15% 左右是正常的，精确的清单计价要到施工图阶段才能出。`);
    } else if (isConstructionTopic) {
      lines.push(`> 施工方案跟结构体系强相关——${recScheme}的施工工艺和难度是决定工期和现场管理成本的关键因素。`);
    } else if (isGreenTopic) {
      lines.push(`> 绿建/低碳目标可以通过结构体系优化来实现，比如装配式+钢结构组合，碳减排效果比较显著。`);
    } else if (isCrackTopic) {
      lines.push(`> 混凝土裂缝控制是个系统问题，跟材料、施工养护、结构布置都有关系，方案阶段主要关注结构规则性和温度应力集中部位。`);
    } else if (isMepTopic) {
      lines.push(`> 机电管线综合跟结构梁高、柱网布置关系很大，方案阶段可以预留净高和管井条件。`);
    } else if (isFacadeTopic) {
      lines.push(`> 幕墙选型要结合结构体系的抗侧刚度和层间位移能力来定，位移大的体系对幕墙适应变形能力要求更高。`);
    } else {
      lines.push(`> 这个问题涉及**${topic}**方向，在方案比选阶段可以作为约束条件纳入考量。`);
    }

    lines.push('');
    lines.push(`**说明**：这个问题属于 ${topic} 专项设计范畴，本工具聚焦**结构方案概念比选**，不做详细计算。建议下一步：`);
    lines.push('');

    // 领域化建议：根据问题方向给出针对性的下一步，而不是千篇一律的三招
    const suggestions: string[] = [];

    if (isFoundationTopic) {
      suggestions.push(
        `① **补充地勘资料后再算基础**：基础选型高度依赖场地土层分布、承载力特征值（fₐₖ）、地下水位等参数。建议先拿到初勘报告，明确持力层与地基承载力，再结合上部结构荷载进行基础形式比选（天然地基 / 桩基础 / 复合地基）。`
      );
      suggestions.push(
        `② **先对比各体系对基础的影响**：问我「${recScheme}和${lastResult?.ranking?.[1]?.schemeName || '备选方案'}的底层柱底轴力差多少」，不同结构体系的竖向荷载分布差异会直接影响基础造价，这部分我可以给你量级估算。`
      );
      if (params.soilCategory === 'Ⅳ' || params.soilCategory === 'Ⅲ') {
        suggestions.push(
          `③ **关注场地效应**：你当前是${params.soilCategory}类场地，属于偏软场地，${params.seismicIntensity}度设防下需注意地基液化和软弱下卧层验算，这是基础方案的关键约束。`
        );
      }
    } else if (isFireTopic) {
      suggestions.push(
        `① **查阅防火分区与耐火极限要求**：建筑防火设计需按 GB 50016《建筑设计防火规范》确定防火分区面积、疏散距离、构件耐火极限等。不同结构体系（钢结构需做防火涂料、混凝土结构天然耐火较好）的防火成本差异显著。`
      );
      suggestions.push(
        `② **对比各体系的防火经济性**：问我「钢结构和混凝土结构防火成本差多少」，我可以给出防火涂料用量和造价增量的量级估算，帮助你在方案阶段就把防火成本纳入比选。`
      );
      suggestions.push(
        `③ **结合建筑功能确认防火等级**：你当前是${params.buildingType === 'residential' ? '住宅' : params.buildingType === 'office' ? '办公楼' : params.buildingType === 'school' ? '教学楼' : params.buildingType === 'factory' ? '厂房' : '体育馆'}，不同功能的防火等级和疏散要求不同，建议先与建筑专业确认。`
      );
    } else if (isWindTopic) {
      suggestions.push(
        `① **补充风荷载基本参数**：风工程分析需要当地基本风压（w₀）、地面粗糙度类别（A/B/C/D类）、建筑体型系数等。你当前是${params.floors}层约${height}m高，${height > 60 ? '属于对风敏感的高层建筑范畴，舒适度验算不可忽略。' : '高度不算大，风荷载通常不起控制作用。'}`
      );
      suggestions.push(
        `② **先选结构体系再评风振性能**：不同体系的抗侧刚度差异直接影响风振加速度（舒适度指标）。问我「框剪和钢结构在${height}m高度下顶点位移差多少」，我可以给出量级对比。`
      );
    } else if (isSeismicDetailTopic) {
      suggestions.push(
        `① **先确认是否需要隔震/消能**：${params.seismicIntensity}度区 ${params.floors}层建筑，常规抗震设计通常可以满足要求。隔震/消能减震一般用于高烈度区特殊建筑、或对层间位移有严格限制的情况（如医院、精密仪器室）。`
      );
      suggestions.push(
        `② **评估经济性平衡点**：隔震/消能方案通常可以减小上部构件截面、降低用钢量，但隔震层本身造价较高。可以先做「隔震 vs 传统抗震」的全生命周期造价对比，再决定是否采用。`
      );
    } else if (isCostDetailTopic) {
      suggestions.push(
        `① **先锁定结构体系再谈清单**：方案阶段的造价精度 ±15% 属正常范围。精确清单计价需要到施工图阶段，按构件拆分（梁/板/柱/墙/基础）算量后再套定额。`
      );
      suggestions.push(
        `② **用我的造价对比做方案级决策**：问我「${sysList} 单方造价差多少」，我可以给出各体系的造价对比和主要构成比例（结构主材 / 基础 / 施工措施费），足够支撑方案级比选。`
      );
    } else if (isConstructionTopic) {
      suggestions.push(
        `① **先定体系再谈施工方案**：不同结构体系的施工工艺和工期差异很大——装配式吊装快但构件重、钢结构焊接量大、现浇混凝土受季节影响。你可以先在方案比选里把施工难度和工期作为权重因子。`
      );
      suggestions.push(
        `② **调整施工难度权重再比选**：试试把「施工难度」权重调高，看看推荐方案会不会变。有时候施工便利性带来的工期节约和质量可控性，比多花几百块钱单方造价更有价值。`
      );
    } else {
      // 通用建议（非特定领域或识别不出来的情况）
      if (params.floors < 40) {
        suggestions.push(
          `① **调整参数重跑方案**：比如「改成20层」「8度设防」「预算降到3500元/平」，我会按新参数重新生成 ${sysList} 的对比和推荐`
        );
      } else {
        suggestions.push(
          `① **调整高度重跑方案**：${params.floors}层属于高层范畴，你可以试试「改成30层」看看低一些的高度下各方案的经济性变化`
        );
      }

      if (lastResult && Object.keys(lastResult.codeChecks || {}).length > 0) {
        suggestions.push(
          `② **查询规范依据**：问我「${recScheme}层间位移角限值是多少」「剪重比怎么算」，我可以展示具体规范条文和计算过程`
        );
      }

      if (lastResult && lastResult.ranking && lastResult.ranking.length >= 2) {
        const a = lastResult.ranking[0].schemeName;
        const b = lastResult.ranking[1].schemeName;
        suggestions.push(
          `③ **继续对比指标**：问我「${a}和${b}差多少钱」「抗震性能差多少」，我给出更细的维度对比`
        );
      }
    }

    suggestions.forEach((s) => lines.push(s));

    lines.push('');
    lines.push(`> 以上为概念级建议。本工具聚焦结构方案比选，专项设计建议咨询具备相应资质的${topic.includes('隔震') ? '隔震减震' : topic.includes('基础') ? '岩土工程' : topic.includes('风') ? '风工程' : topic.includes('防火') ? '消防' : topic.includes('绿建') ? '绿建' : topic.includes('造价') ? '造价' : topic.includes('施工') ? '施工' : '专业'}顾问单位。`);

    const reply = lines.join('\n');
    return { intent, reply };
  }
}

/**
 * 对外统一入口：处理对话消息
 */
export async function processAgentMessage(
  message: string,
  context: IConversationContext
): Promise<{
  intent: IIntentResult;
  reply: string;
  updatedParams?: IProjectParams;
  regenerated?: IAgentPipelineResult;
  newContext: IConversationContext;
}> {
  const engine = new IntentEngine(context);
  const result = await engine.processMessage(message);
  return {
    ...result,
    newContext: engine.getContext(),
  };
}
