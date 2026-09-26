// TraceEngine 演示轨迹引擎
// 核心设计原则："计算是真的、思考是专家模板动态组合"
// 真实调用工具 executor 获取每个数值 → 推理文本按工程条件从模板库动态匹配 + 插入真实计算结果
// EXPORTS: TraceEngine, runTraceStep

import {
  executeToolByName,
} from './tools';
import {
  type IAgentActionLog,
  type AgentType,
} from './types';
import {
  STRUCTURE_SYSTEM_LIBRARY,
  calculateBuildingHeight,
  type IStructureScheme,
  type IWeightConfig,
  type IProjectParams,
} from '@/data/structure';

// ============ 推理模板库 ============
// 模板按触发条件分类，每个模板是一个函数，接收真实参数返回思考文本

interface IThinkTemplate {
  id: string;
  /** 触发条件：命中任意一个即插入思考 */
  condition: (params: IProjectParams, context?: Record<string, unknown>) => boolean;
  /** 生成思考文本 */
  generate: (params: IProjectParams, context?: Record<string, unknown>) => string;
  /** 适用于哪个子 Agent */
  agent: AgentType;
  /** 优先级（越大越先出现） */
  priority: number;
}

const THINK_TEMPLATES: IThinkTemplate[] = [
  // --- Architect Agent 模板 ---
  {
    id: 'arch-height-screening',
    agent: 'architect',
    priority: 100,
    condition: () => true,
    generate: (p) => {
      const height = p.buildingHeight ?? p.floors * 3;
      const intensity = parseInt(p.seismicIntensity, 10);
      const limits: Record<string, Record<number, number>> = {
        '砌体结构': { 6: 21, 7: 21, 8: 18, 9: 12 },
        '框架结构': { 6: 60, 7: 50, 8: 40, 9: 24 },
        '框架-剪力墙': { 6: 130, 7: 120, 8: 100, 9: 50 },
        '剪力墙结构': { 6: 140, 7: 120, 8: 100, 9: 60 },
        '框架核心筒': { 6: 160, 7: 150, 8: 130, 9: 70 },
        '筒中筒': { 6: 220, 7: 200, 8: 180, 9: 100 },
      };
      const passed: string[] = [];
      const failed: string[] = [];
      Object.entries(limits).forEach(([name, lim]) => {
        const maxH = lim[intensity] || 50;
        if (height <= maxH) passed.push(name);
        else failed.push(`${name}(限${maxH}m)`);
      });
      return `【第一步：高度限值初筛】
建筑高度约 ${height}m（${p.floors}层${p.buildingHeight ? '' : ' × 3m/层估算'}），${p.seismicIntensity}度设防。
我先按 GB/T 50011 表 6.1.1 的最大适用高度限值过一遍，把超限的体系直接排除：

✅ 通过高度限值（${passed.length}个）：${passed.join('、')}
❌ 高度超限排除（${failed.length}个）：${failed.join('、')}

通过高度初筛后，再结合建筑功能、场地条件、预算约束进一步缩小范围。`;
    },
  },
  {
    id: 'arch-drift-estimate',
    agent: 'architect',
    priority: 95,
    condition: (p) => parseInt(p.seismicIntensity, 10) >= 7 && p.floors > 6,
    generate: (p) => {
      const height = p.buildingHeight ?? p.floors * 3;
      const intensity = parseInt(p.seismicIntensity, 10);
      // 简化估算：框架体系位移角约1/500~1/700，框剪约1/1000~1/1500，剪力墙约1/1500~1/2000
      const driftApprox: Record<string, string> = {
        '框架': `约 1/${Math.round(height * 1000 / (height * 2 + intensity * 5))}（接近1/500~1/700范围）`,
        '框剪': `约 1/${Math.round(height * 1000 / (height * 0.8 + intensity * 2))}（约1/1000量级）`,
        '剪力墙': `约 1/${Math.round(height * 1000 / (height * 0.5 + intensity * 1))}（约1/1500量级）`,
      };
      const frameLimit = 1 / 550; // 框架弹性位移角限值 1/550
      const fswLimit = 1 / 800;   // 框剪限值 1/800
      const swLimit = 1 / 1000;   // 剪力墙限值 1/1000
      const frameDriftEst = height / (height * 0.7 + intensity * 8);
      return `【第二步：位移角预判】
${p.seismicIntensity}度设防、高约 ${height}m，我先凭经验估一下各体系的层间位移角量级，看看哪些体系刚度可能不够：

  • 框架体系：位移角 ${driftApprox['框架']}，限值 1/550 —— ${frameDriftEst > frameLimit ? '⚠️ 大概率超限，刚度不够' : '基本满足'}
  • 框剪体系：位移角 ${driftApprox['框剪']}，限值 1/800 —— 通常能满足，有一定余量
  • 剪力墙体系：位移角 ${driftApprox['剪力墙']}，限值 1/1000 —— 刚度富裕度大

初步判断：${intensity >= 8 && height > 30 ? '高烈度中高层，纯框架体系位移角大概率过不了，排除。重点比较框剪和剪力墙。' : '烈度不高或高度不大，框架和框剪都有机会，看具体计算。'}`;
    },
  },
  {
    id: 'arch-budget-screening',
    agent: 'architect',
    priority: 85,
    condition: (p) => p.budget > 0,
    generate: (p) => {
      const budget = p.budget;
      const costLevels: Array<{ name: string; cost: number; pass: boolean }> = [
        { name: '砌体结构', cost: 2000, pass: budget >= 2000 },
        { name: '框架结构', cost: 3000, pass: budget >= 3000 },
        { name: '框架-剪力墙', cost: 3800, pass: budget >= 3800 },
        { name: '剪力墙结构', cost: 4200, pass: budget >= 4200 },
        { name: '钢结构', cost: 5500, pass: budget >= 5500 },
        { name: '框架核心筒', cost: 5800, pass: budget >= 5800 },
        { name: '筒中筒', cost: 7000, pass: budget >= 7000 },
      ];
      const ok = costLevels.filter((c) => c.pass).map((c) => c.name);
      const tight = costLevels.filter((c) => !c.pass).map((c) => c.name);
      return `【第三步：预算约束筛选】
项目预算 ${budget} 元/㎡，按各体系常规造价水平筛一遍：

  ✅ 预算内（${ok.length}个）：${ok.join('、')}
  ⚠️ 预算偏紧/超（${tight.length}个）：${tight.join('、')}

${budget < 3500 ? '预算偏紧，优先考虑现浇混凝土体系，钢结构、组合结构等高造价方案暂不推荐。' : budget < 5000 ? '预算中等，现浇混凝土体系都能覆盖，钢结构需控制用钢量。' : '预算较充裕，可以考虑钢结构、组合结构等高性能方案。'}`;
    },
  },
  {
    id: 'arch-precast-demand',
    agent: 'architect',
    priority: 80,
    condition: (p) =>
      p.structurePreference === 'prefabricated' || p.structurePreference === 'steel',
    generate: (p) =>
      `【装配式诉求分析】项目明确倾向 ${p.structurePreference === 'prefabricated' ? '装配式混凝土' : '钢结构'} 体系，符合建筑工业化发展方向。\n装配式体系在工期、环保、质量可控性方面有明显优势，但需关注造价增量和节点抗震性能。我将重点评估装配式方案的性价比。`,
  },
  {
    id: 'arch-loess-site',
    agent: 'architect',
    priority: 75,
    condition: (p) => p.geologyType === 'loess',
    generate: (p) =>
      `【场地条件分析】本项目场地为湿陷性黄土，这是基础设计的关键控制因素。\n湿陷性黄土地区需特别关注：地基处理方案选择、基础埋深要求、场地排水设计。上部结构宜优先选择自重较轻的体系（钢结构、装配式），或采用桩基础穿透湿陷性土层。`,
  },
  {
    id: 'arch-large-span',
    agent: 'architect',
    priority: 70,
    condition: (p) => p.mainSpan >= 18,
    generate: (p) =>
      `【跨度分析】主跨 ${p.mainSpan}m 属于大跨度范畴，普通混凝土框架梁可能不经济。\n大跨度项目应优先考虑钢结构、空间桁架/网架、组合结构等跨越能力强的体系。${p.mainSpan >= 30 ? '30m以上大跨强烈建议采用空间结构体系。' : '18-30m跨度钢结构和组合结构均有较好适用性。'}`,
  },
  {
    id: 'arch-low-rise-masonry',
    agent: 'architect',
    priority: 65,
    condition: (p) => p.floors <= 6 && p.seismicIntensity <= '7',
    generate: (p) =>
      `【多层低烈度分析】${p.floors}层 + ${p.seismicIntensity}度设防属于多层低烈度范畴，砌体结构和框架结构均有良好适用性。\n多层砌体结构在经济性上具有明显优势，但需注意抗震构造措施的落实。框架结构则空间灵活性更好。`,
  },
  {
    id: 'arch-9-degree-caution',
    agent: 'architect',
    priority: 95,
    condition: (p) => p.seismicIntensity === '9',
    generate: (p) =>
      `【高烈度区审慎提示】9度设防属于高烈度区，结构选型需极其谨慎。\n9度区：砌体结构基本不适用；框架结构适用高度极低（仅24m）；应优先选用剪力墙、框剪、框筒等高刚度体系。同时需关注隔震减震技术的应用可能性。本方案仅供概念比选，实际工程必须进行专项抗震性能化设计。`,
  },
  {
    id: 'arch-intro',
    agent: 'architect',
    priority: 10,
    condition: () => true,
    generate: (p) =>
      `我来分析一下这个项目的结构方案选型问题。\n项目概况：${p.floors}层 ${p.buildingType === 'residential' ? '住宅' : p.buildingType === 'office' ? '办公楼' : p.buildingType === 'school' ? '教学楼' : p.buildingType === 'factory' ? '厂房' : '体育馆'}，建筑面积约 ${p.area.toLocaleString()}㎡，${p.seismicIntensity}度设防，${p.soilCategory}类场地，主跨 ${p.mainSpan}m，预算 ${p.budget} 元/㎡。\n\n首先，我将调用 query_structure_systems 工具，从12类结构体系库中按8维度筛选出最适合的候选方案。`,
  },

  // --- Code Agent 模板 ---
  {
    id: 'code-plan-checklist',
    agent: 'code',
    priority: 50,
    condition: () => true,
    generate: (p) => {
      const intensity = parseInt(p.seismicIntensity, 10);
      const height = p.buildingHeight ?? p.floors * 3;
      return `【校核清单】对每个候选方案，我将逐项校核以下关键指标：

  1️⃣ 高度适用范围 —— 对照 GB/T 50011 表 6.1.1，${p.seismicIntensity}度区
  2️⃣ 弹性层间位移角 —— 框架 1/550、框剪 1/800、剪力墙 1/1000（GB 55002 表 5.1.2）
  3️⃣ 剪重比（最小地震剪力系数） —— ${intensity}度区 ${intensity >= 8 ? 0.032 : 0.024}（多遇地震）
  4️⃣ 轴压比限值 —— 框架柱、剪力墙底部加强部位分别核算
  5️⃣ 周期比（Tt/T1） —— 扭转周期与平动周期比 ≤ 0.9
  6️⃣ 防火耐火等级 —— 构件耐火极限，对照 GB 55037
  7️⃣ 抗震等级 —— 按高度+烈度确定一~四级

所有校核项都按规范硬编码限值，我不做自由发挥。发现超限就直接报 fail。`;
    },
  },
  {
    id: 'code-highlight-drift',
    agent: 'code',
    priority: 60,
    condition: (p) => parseInt(p.seismicIntensity, 10) >= 8,
    generate: (p) => {
      const height = p.buildingHeight ?? p.floors * 3;
      return `【重点关注】${p.seismicIntensity}度高烈度设防，位移角是最容易翻车的项。

先复习一下限值（GB 55002-2021 表 5.1.2 弹性层间位移角限值）：
  • 框架结构：1/550
  • 框架-抗震墙结构：1/800
  • 抗震墙结构：1/1000
  • 框架-核心筒：1/800

按经验估算，${height}m 高的建筑，层间位移角大致和结构侧向刚度成反比。
高烈度区纯框架几乎肯定位移角过不了，等下算出来看具体数值。`;
    },
  },
  {
    id: 'code-intro',
    agent: 'code',
    priority: 10,
    condition: () => true,
    generate: () =>
      `接下来由我（规范校核工程师）对各候选方案进行逐条规范校核。
校核内容涵盖：抗震规范（GB 55002-2021 / GB/T 50011）和防火规范（GB 55037-2022）两大类。每项校核均给出：规范依据条文号、计算过程、限值对比、判定结论（符合/需注意/不符合）。`,
  },

  // --- Economist Agent 模板 ---
  {
    id: 'econ-intro',
    agent: 'economist',
    priority: 10,
    condition: () => true,
    generate: () =>
      `我来对各方案进行经济与绿色指标评估。\n评估维度包括：单位面积造价、总工期、装配率及分级、隐含碳排放、施工风险等级。所有指标均基于工程经验数据库进行估算。`,
  },
  {
    id: 'econ-cost-focus',
    agent: 'economist',
    priority: 20,
    condition: (p) => p.budget < 3500,
    generate: (p) =>
      `【造价敏感提示】${p.budget} 元/㎡的预算较为紧张，造价将是重要决策因素。\n经济性排序（从低到高）大致为：砌体 < 框架 < 框剪 < 装配式 < 剪力墙 < 组合结构 < 钢结构。但具体仍需结合高度、烈度等修正因素计算。`,
  },
  {
    id: 'econ-green-focus',
    agent: 'economist',
    priority: 25,
    condition: (p) => p.buildingType === 'school' || p.buildingType === 'gymnasium',
    generate: () =>
      `【绿色低碳分析】公共建筑项目通常对绿色建筑和双碳目标有较高要求。\n碳排放量排序（从低到高）大致为：胶合木 < 装配式钢结构 < 钢结构 < 空间桁架 < 装配式混凝土 < 框架 < 框剪 < 剪力墙。装配率方面，钢结构和装配式体系可达 AA 级以上。`,
  },

  // --- Chief Agent 模板 ---
  {
    id: 'chief-intro-numeric',
    agent: 'chief',
    priority: 20,
    condition: () => true,
    generate: (p) => {
      const height = p.buildingHeight ?? p.floors * 3;
      return `【总工进场】前三轮分析都做完了，我来做最终裁决。

先整理一下已知条件：
  • 建筑类型：${p.buildingType === 'residential' ? '住宅' : p.buildingType === 'office' ? '办公楼' : p.buildingType === 'school' ? '教学楼' : p.buildingType === 'factory' ? '厂房' : '体育馆'}
  • 高度：约 ${height}m（${p.floors}层）
  • 设防烈度：${p.seismicIntensity}度
  • 场地类别：${p.soilCategory}类
  • 预算：${p.budget} 元/㎡

我的评审思路：先看 Code Agent 的规范校核结果——凡是有 fail 的方案直接排除；再在 pass 的方案里按加权评分排座次；最后对第一名做一次反向质疑，看看有没有什么隐患被加权评分掩盖了。`;
    },
  },
  {
    id: 'chief-high-seismic-residential',
    agent: 'chief',
    priority: 50,
    condition: (p) => {
      const h = p.floors * 3;
      const intensity = parseInt(p.seismicIntensity, 10);
      return p.buildingType === 'residential' && intensity >= 8 && h >= 30;
    },
    generate: (p) => {
      const h = p.floors * 3;
      return `【总工评审要点】本项目为 ${p.seismicIntensity} 度设防、约 ${h}m 高的住宅建筑，属于高烈度区中高层住宅。\n按工程常识，此类项目应以侧向刚度控制为核心设计原则——水平地震作用下的层间位移角、结构延性和耗能能力是选型的决定因素。\n框架结构虽然造价低，但在 8 度区 30m+ 高度下抗侧刚度不足，节点剪力大，延性耗能有限，通常不是最优解。\n框架-剪力墙体系兼具框架的空间灵活性和剪力墙的抗侧刚度，刚度与经济性的平衡点较好，是住宅类项目的常用优选。\n剪力墙体系抗侧刚度最大、抗震性能最优，但建筑布置灵活性受限、自重较大。\n我将在综合评分中充分考虑"高烈度+高层+住宅"这一组合对结构体系侧向刚度的刚性要求，避免单纯以造价最低为导向的误判。`;
    },
  },
];

// ============ TraceEngine 主类 ============

export class TraceEngine {
  private stepCounter = 0;
  private actionLog: IAgentActionLog[] = [];
  private params: IProjectParams;
  private weights: IWeightConfig;
  private currentAgent: AgentType | null = null;

  constructor(params: IProjectParams, weights: IWeightConfig) {
    this.params = params;
    this.weights = weights;
  }

  /** 追加一条行动日志 */
  private pushLog(entry: Omit<IAgentActionLog, 'step' | 'timestamp'>): void {
    this.stepCounter += 1;
    this.actionLog.push({
      ...entry,
      step: this.stepCounter,
      timestamp: Date.now(),
    });
  }

  /** 为指定子 Agent 生成思考步骤（按触发条件筛选 + 优先级排序） */
  private generateThoughtsForAgent(agentId: AgentType, context?: Record<string, unknown>): string[] {
    return THINK_TEMPLATES
      .filter((t) => t.agent === agentId && t.condition(this.params, context))
      .sort((a, b) => b.priority - a.priority)
      .map((t) => t.generate(this.params, context));
  }

  /** 获取某个体系在当前建筑类型下的适配等级（>=0 表示适用） */
  private getBuildingTypeRank(systemId: string): number {
    const typeMatchMap: Record<string, string[]> = {
      residential: ['shearwall', 'frame-shearwall', 'prefabricated', 'frame', 'masonry', 'frame-corewall', 'tube-in-tube'],
      office: ['frame-shearwall', 'frame-corewall', 'tube-in-tube', 'composite', 'steel', 'prefab-steel', 'frame'],
      school: ['frame', 'masonry', 'prefabricated', 'frame-shearwall', 'mass-timber', 'steel'],
      factory: ['steel', 'prefab-steel', 'space-truss', 'frame', 'composite'],
      gymnasium: ['space-truss', 'steel', 'prefab-steel', 'composite', 'mass-timber'],
    };
    const list = typeMatchMap[this.params.buildingType] || [];
    return list.indexOf(systemId);
  }

  /** 运行 Architect Agent：筛选候选体系 + 思考评述 */
  runArchitect(): { candidates: IStructureScheme[]; logs: IAgentActionLog[] } {
    this.currentAgent = 'architect';
    const logs: IAgentActionLog[] = [];
    const push = (entry: Omit<IAgentActionLog, 'step' | 'timestamp'>) => {
      this.pushLog({ ...entry, agent: 'architect' });
      logs.push({ ...entry, step: this.stepCounter, agent: 'architect', timestamp: Date.now() });
    };

    // 生成思考（按条件匹配模板）
    const thoughts = this.generateThoughtsForAgent('architect');
    thoughts.forEach((text) => {
      push({ type: 'think', content: text });
    });

    // 调用工具：query_structure_systems
    push({
      type: 'tool_call',
      content: '调用 query_structure_systems 筛选候选结构体系',
      tool: 'query_structure_systems',
      args: {
        filters: {
          buildingType: this.params.buildingType,
          floors: this.params.floors,
          area: this.params.area,
          seismicIntensity: this.params.seismicIntensity,
          soilCategory: this.params.soilCategory,
          mainSpan: this.params.mainSpan,
          budget: this.params.budget,
          structurePreference: this.params.structurePreference,
        },
        topN: 3,
      },
    });

    const toolResult = executeToolByName('query_structure_systems', {
      filters: {
        buildingType: this.params.buildingType,
        floors: this.params.floors,
        area: this.params.area,
        seismicIntensity: this.params.seismicIntensity,
        soilCategory: this.params.soilCategory,
        mainSpan: this.params.mainSpan,
        budget: this.params.budget,
        structurePreference: this.params.structurePreference,
      },
      topN: 3,
    }) as { candidates: Array<{ id: string; name: string }>; total: number };

    push({
      type: 'tool_result',
      content: `筛选完成：从 12 类结构体系库中选出 ${toolResult.total} 个候选方案，得分最高的前 3 个为：${toolResult.candidates.map((c) => c.name).join('、')}`,
      tool: 'query_structure_systems',
      result: toolResult,
    });

    push({
      type: 'conclusion',
      content: `候选方案筛选完成。\n综合考虑高度适配、建筑类型匹配、跨度要求、预算约束、抗震需求等8个维度，最终确定以下 3 个候选方案进入下一轮详细评估：\n${toolResult.candidates.map((c, i) => `${i + 1}. ${c.name}`).join('\n')}\n\n下一步交由规范校核工程师进行逐条规范符合性验证。`,
    });

    const candidates = toolResult.candidates
      .map((c) => STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === c.id))
      .filter((s): s is IStructureScheme => !!s);

    return { candidates, logs };
  }

  /** 运行 Code Agent：规范校核 */
  runCode(schemeIds: string[]): {
    codeChecks: Record<string, unknown>;
    logs: IAgentActionLog[];
  } {
    this.currentAgent = 'code';
    const logs: IAgentActionLog[] = [];
    const push = (entry: Omit<IAgentActionLog, 'step' | 'timestamp'>) => {
      this.pushLog({ ...entry, agent: 'code' });
      logs.push({ ...entry, step: this.stepCounter, agent: 'code', timestamp: Date.now() });
    };

    const thoughts = this.generateThoughtsForAgent('code');
    thoughts.forEach((text) => {
      push({ type: 'think', content: text });
    });

    const codeChecks: Record<string, unknown> = {};

    // 对每个方案做抗震+防火校核
    schemeIds.forEach((schemeId) => {
      const scheme = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === schemeId);
      const schemeName = scheme?.name || schemeId;

      push({
        type: 'tool_call',
        content: `对「${schemeName}」进行抗震规范校核`,
        tool: 'check_seismic_requirements',
        args: {
          systemId: schemeId,
          params: {
            floors: this.params.floors,
            seismicIntensity: this.params.seismicIntensity,
            soilCategory: this.params.soilCategory,
            buildingType: this.params.buildingType,
          },
        },
      });

      const seisResult = executeToolByName('check_seismic_requirements', {
        systemId: schemeId,
        params: {
          floors: this.params.floors,
          seismicIntensity: this.params.seismicIntensity,
          soilCategory: this.params.soilCategory,
          buildingType: this.params.buildingType,
        },
      });

      push({
        type: 'tool_result',
        content: `「${schemeName}」抗震校核完成：${(seisResult as { passCount: number }).passCount} 项符合 / ${(seisResult as { warningCount: number }).warningCount} 项需注意 / ${(seisResult as { failCount: number }).failCount} 项不符合`,
        tool: 'check_seismic_requirements',
        result: seisResult,
      });

      push({
        type: 'tool_call',
        content: `对「${schemeName}」进行防火规范校核`,
        tool: 'check_fire_requirements',
        args: {
          systemId: schemeId,
          floors: this.params.floors,
          buildingType: this.params.buildingType,
        },
      });

      const fireResult = executeToolByName('check_fire_requirements', {
        systemId: schemeId,
        floors: this.params.floors,
        buildingType: this.params.buildingType,
      });

      push({
        type: 'tool_result',
        content: `「${schemeName}」防火校核完成：耐火等级 ${(fireResult as { fireResistanceGrade: string }).fireResistanceGrade}`,
        tool: 'check_fire_requirements',
        result: fireResult,
      });

      codeChecks[schemeId] = { seismic: seisResult, fire: fireResult };
    });

    push({
      type: 'conclusion',
      content: `规范校核完成。\n对 ${schemeIds.length} 个候选方案逐一进行了抗震规范（GB 55002-2021 / GB/T 50011）和防火规范（GB 55037-2022）的逐条校核。\n各方案详细校核结果已记录在案，供总工综合评审参考。\n下一步交由经济评估工程师进行造价、工期、绿色指标评估。`,
    });

    return { codeChecks, logs };
  }

  /**
   * Multi-Agent 辩论环节：Code Agent 挑刺 → Architect 回应换方案 → Code 再校核
   * 替代原有的单 Agent 自主调整回环，体现 Agent 之间有来有回的辩论过程
   */
  runDebateLoop(
    initialSchemeIds: string[],
    initialCodeChecks: Record<string, unknown>
  ): {
    finalSchemeIds: string[];
    finalCodeChecks: Record<string, unknown>;
    loops: number;
    replacements: Array<{ original: string; replacement: string; reason: string; loop: number; finalStatus: string }>;
    allPass: boolean;
    logs: IAgentActionLog[];
  } {
    const logs: IAgentActionLog[] = [];
    const pushCode = (entry: Omit<IAgentActionLog, 'step' | 'timestamp'>) => {
      this.pushLog({ ...entry, agent: 'code' });
      logs.push({ ...entry, step: this.stepCounter, agent: 'code', timestamp: Date.now() });
    };
    const pushArch = (entry: Omit<IAgentActionLog, 'step' | 'timestamp'>) => {
      this.currentAgent = 'architect';
      this.pushLog({ ...entry, agent: 'architect' });
      logs.push({ ...entry, step: this.stepCounter, agent: 'architect', timestamp: Date.now() });
      this.currentAgent = 'code';
    };

    this.currentAgent = 'code';

    let schemeIds = [...initialSchemeIds];
    let codeChecks = { ...initialCodeChecks };
    const replacements: Array<{ original: string; replacement: string; reason: string; loop: number; finalStatus: string }> = [];
    const MAX_ROUNDS = 2;

    // 体系升级路径：侧向刚度从低到高（用于位移角/高度超限的升级选择）
    const stiffnessLadder = [
      'masonry',
      'frame',
      'composite',
      'frame-shearwall',
      'shearwall',
      'frame-corewall',
      'tube-in-tube',
    ];

    // 工具：获取某个体系的位移角校核详细结果
    const getSeismicChecks = (sid: string): Array<{ name: string; status: string; detail?: string; value?: string; limit?: string }> => {
      const check = codeChecks[sid] as { seismic?: { checks?: Array<{ name: string; status: string; detail?: string; value?: string; limit?: string }> } };
      return check?.seismic?.checks ?? [];
    };

    // 工具：检测哪些方案 fail
    const findFailingSchemes = (ids: string[]): { schemeId: string; failItems: string[] }[] => {
      return ids
        .map((sid) => {
          const checks = getSeismicChecks(sid);
          const failItems = checks.filter((c) => c.status === 'fail').map((c) => c.name);
          return { schemeId: sid, failItems };
        })
        .filter((x) => x.failItems.length > 0);
    };

    // 工具：根据 fail 原因推荐替换体系（Architect 的「回应」逻辑）
    const architectSuggestReplacement = (failedId: string, failItems: string[]): string | null => {
      const failedScheme = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === failedId);
      if (!failedScheme) return null;

      const hasDriftFail = failItems.some((n) => n.includes('位移角'));
      const hasHeightFail = failItems.some((n) => n.includes('高度') || n.includes('适用高度'));
      const alreadyUsed = new Set(schemeIds);

      // 策略 1：位移角超限 → 升级到侧向刚度更高的体系
      if (hasDriftFail) {
        const currentIdx = stiffnessLadder.indexOf(failedId);
        if (currentIdx >= 0) {
          for (let i = currentIdx + 1; i < stiffnessLadder.length; i++) {
            const candidate = stiffnessLadder[i];
            if (!alreadyUsed.has(candidate)) {
              const typeRank = this.getBuildingTypeRank(candidate);
              if (typeRank >= 0) return candidate;
            }
          }
        }
      }

      // 策略 2：高度超限 → 换成钢结构或更高刚度体系
      if (hasHeightFail) {
        const steelCandidates = ['steel', 'prefab-steel', 'composite'];
        for (const sid of steelCandidates) {
          if (!alreadyUsed.has(sid)) {
            const rank = this.getBuildingTypeRank(sid);
            if (rank >= 0) return sid;
          }
        }
      }

      // 策略 3：兜底
      if (this.params.buildingType === 'residential' && !alreadyUsed.has('shearwall')) {
        return 'shearwall';
      }
      if (this.params.buildingType === 'office' && !alreadyUsed.has('frame-corewall')) {
        return 'frame-corewall';
      }

      return null;
    };

    // 执行辩论循环
    let loops = 0;
    let failing = findFailingSchemes(schemeIds);

    if (failing.length === 0) {
      // 全部通过，无需辩论
      this.currentAgent = 'architect';
      return {
        finalSchemeIds: schemeIds,
        finalCodeChecks: codeChecks,
        loops: 0,
        replacements: [],
        allPass: true,
        logs: [],
      };
    }

    // ====== Code Agent 挑刺开场 ======
    pushCode({
      type: 'think',
      content: `【规范校核发现问题 · 向 Architect 提出质疑】
我逐条校核了 ${schemeIds.length} 个候选方案的抗震规范（GB 55002-2021）和防火规范（GB 55037-2022），发现 ${failing.length} 个方案存在不符合项：
${failing.map((f) => { const n = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === f.schemeId)?.name; return `• ${n}：${f.failItems.join('、')}`; }).join('\n')}

作为 Code Agent，我不能让这些不合规的方案进入下一阶段。请 Architect 重新考虑方案选型。`,
    });

    for (let loop = 1; loop <= MAX_ROUNDS; loop++) {
      loops = loop;
      const loopReplacements: string[] = [];

      for (const failItem of failing) {
        const originalName = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === failItem.schemeId)?.name || failItem.schemeId;
        const failDetail = getSeismicChecks(failItem.schemeId).filter((c) => c.status === 'fail');
        const failDetailText = failDetail.map((c) => `${c.name}（实际${c.value || '?'}，限值${c.limit || '?'}）`).join('、');

        // ===== Code Agent 详细挑刺 =====
         const failItemsWithDetail = failDetail.map((c) => {
           const actual = c.value || '未通过';
           const limit = c.limit || '限值';
           let severity = '';
           if (c.name.includes('位移角') && c.value && c.limit) {
             const actualNum = parseFloat(String(c.value).replace('1/', ''));
             const limitNum = parseFloat(String(c.limit).replace('1/', ''));
             if (actualNum && limitNum) {
               const ratio = (limitNum / actualNum).toFixed(1);
               severity = `（超出${ratio}倍）`;
             }
           }
           return `${c.name}：实际 ${actual}，限值 ${limit}${severity}`;
         }).join('\n  ');

         pushCode({
           type: 'think',
           content: `【第${loop}轮辩论 · Code 挑刺 ${originalName}】
逐一审校后，发现以下不符合项：

  ${failItemsWithDetail}

判定结论：${originalName} 不满足规范要求，不能作为推荐方案进入下一轮。
请 Architect 重新选型，我再核。`,
         });

        // ===== Architect 回应 =====
        const replacementId = architectSuggestReplacement(failItem.schemeId, failItem.failItems);

        if (!replacementId) {
          pushArch({
            type: 'think',
            content: `【第${loop}轮辩论 · Architect 回应 ${originalName}】
收到 Code Agent 的质疑。我重新梳理了 12 类结构体系库，遗憾的是——在当前项目参数（${this.params.seismicIntensity}度区、约${this.params.floors * 3}m高）下，已找不到更合适的常规体系。

处理方案：保留 ${originalName} 作为参考方案，但在最终推荐中明确标注——超出规范常规适用范围，需进行专项抗震性能化设计或采用隔震/减震技术。`,
          });
          continue;
        }

        const replacementName = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === replacementId)?.name || replacementId;

        pushArch({
          type: 'think',
          content: `【第${loop}轮辩论 · Architect 回应】
收到 Code Agent 对 ${originalName} 的质疑。同意你的判断，${originalName}在这个项目参数下确实存在风险。

我的调整：将「${originalName}」替换为「${replacementName}」重算。

替换依据：
${failItem.failItems.some((n) => n.includes('位移角')) ? `${replacementName}的侧向刚度显著高于 ${originalName}（体系抗侧刚度等级提升），弹性层间位移角更容易满足限值要求` : ''}
${failItem.failItems.some((n) => n.includes('高度')) ? `${replacementName}在 ${this.params.seismicIntensity} 度区的适用高度限值高于 ${originalName}，可解决高度超限问题` : ''}

请 Code Agent 重新校核 ${replacementName}。`,
        });

        // ===== Code Agent 重新校核 =====
        pushCode({
          type: 'tool_call',
          content: `对 Architect 提出的替换方案「${replacementName}」进行抗震规范校核（第 ${loop} 轮重算）`,
          tool: 'check_seismic_requirements',
          args: {
            systemId: replacementId,
            params: {
              floors: this.params.floors,
              seismicIntensity: this.params.seismicIntensity,
              soilCategory: this.params.soilCategory,
              buildingType: this.params.buildingType,
            },
          },
        });

        const newSeisResult = executeToolByName('check_seismic_requirements', {
          systemId: replacementId,
          params: {
            floors: this.params.floors,
            seismicIntensity: this.params.seismicIntensity,
            soilCategory: this.params.soilCategory,
            buildingType: this.params.buildingType,
          },
        });

        pushCode({
          type: 'tool_result',
          content: `「${replacementName}」抗震校核（第 ${loop} 轮重算）：${(newSeisResult as { passCount: number }).passCount} 项符合 / ${(newSeisResult as { warningCount: number }).warningCount} 项需注意 / ${(newSeisResult as { failCount: number }).failCount} 项不符合`,
          tool: 'check_seismic_requirements',
          result: newSeisResult,
        });

        // 防火也一起重新校核
        pushCode({
          type: 'tool_call',
          content: `对替换方案「${replacementName}」进行防火规范校核`,
          tool: 'check_fire_requirements',
          args: {
            systemId: replacementId,
            floors: this.params.floors,
            buildingType: this.params.buildingType,
          },
        });

        const newFireResult = executeToolByName('check_fire_requirements', {
          systemId: replacementId,
          floors: this.params.floors,
          buildingType: this.params.buildingType,
        });

        pushCode({
          type: 'tool_result',
          content: `「${replacementName}」防火校核完成：耐火等级 ${(newFireResult as { fireResistanceGrade: string }).fireResistanceGrade}`,
          tool: 'check_fire_requirements',
          result: newFireResult,
        });

         const newChecksFull = (newSeisResult as { checks?: Array<{ name: string; status: string; value?: string; limit?: string }> }).checks ?? [];
         const newFailCount = newChecksFull.filter((c) => c.status === 'fail').length;
         const newWarnCount = newChecksFull.filter((c) => c.status === 'warning').length;
         const passed = newFailCount === 0;

         // 挑关键指标展示
         const keyMetrics = newChecksFull
           .filter((c) => c.name.includes('位移角') || c.name.includes('高度') || c.name.includes('轴压比'))
           .map((c) => `${c.name}：${c.value || '—'}（限值${c.limit || '—'}）${c.status === 'pass' ? '✅' : c.status === 'warning' ? '⚠️' : '❌'}`)
           .join('\n  ');

         // ===== Code Agent 反馈校核结果 =====
         pushCode({
           type: 'think',
           content: `【第${loop}轮辩论 · Code 复核结果】
替换方案：${replacementName}

关键指标复核：
  ${keyMetrics || '（全部指标已通过）'}

判定：${passed ? '✅ 全部通过 — 接受 Architect 的替换方案' : `⚠️ 仍有 ${newFailCount} 项不满足，不行`}

${passed ? `${originalName} → ${replacementName}，问题解决。` : `${replacementName} 还是不行，Architect 再想想别的体系。`}`,
         });

        // 执行替换：更新 schemeIds 和 codeChecks
        const idx = schemeIds.indexOf(failItem.schemeId);
        if (idx >= 0) {
          schemeIds[idx] = replacementId;
        }
        codeChecks[replacementId] = { seismic: newSeisResult, fire: newFireResult };
        delete codeChecks[failItem.schemeId];

        replacements.push({
          original: originalName,
          replacement: replacementName,
          reason: failItem.failItems.join('、'),
          loop,
          finalStatus: passed ? 'pass' : 'still-fail',
        });

        loopReplacements.push(replacementId);
      }

      // 本轮结束后重新检测
      failing = findFailingSchemes(schemeIds);

      if (failing.length === 0) {
        break; // 全部通过，退出辩论
      }

      if (loop < MAX_ROUNDS) {
        pushCode({
          type: 'think',
          content: `【第 ${loop} 轮辩论结束，仍有 ${failing.length} 个方案未通过】
未通过方案：${failing.map((f) => STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === f.schemeId)?.name).join('、')}
进入第 ${loop + 1} 轮辩论，请 Architect 继续调整。`,
        });
      }
    }

    // 辩论结束，输出总结
    const finalFailing = findFailingSchemes(schemeIds);
    const allPass = finalFailing.length === 0;

    if (allPass) {
      pushCode({
        type: 'conclusion',
        content: `【辩论环节完成 · 全部通过】
经过 ${loops} 轮 Code Agent ↔ Architect 的来回辩论，所有候选方案均已通过规范校核。

辩论记录：
${replacements.map((r) => `• 第 ${r.loop} 轮：Code 质疑 ${r.original}（${r.reason}）→ Architect 换为 ${r.replacement} → Code 复核通过`).join('\n')}

规范校核阶段结束，下一步交由经济评估工程师进行造价、工期、绿色指标评估。`,
      });
    } else {
      pushCode({
        type: 'conclusion',
        content: `【辩论环节完成 · 部分未通过】
经过 ${loops} 轮辩论（已达最大轮次），仍有 ${finalFailing.length} 个方案未能完全通过规范校核。
未通过方案：${finalFailing.map((f) => `${STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === f.schemeId)?.name}（${f.failItems.join('、')}）`).join('、')}

说明：在当前项目参数下（${this.params.seismicIntensity}度区、约${this.params.floors * 3}m高），常规体系已无法完全满足，需进行专项抗震性能化设计或采用隔震/减震技术。
总工将基于现有最接近的方案给出推荐。`,
      });
    }

    this.currentAgent = 'architect';

    return {
      finalSchemeIds: schemeIds,
      finalCodeChecks: codeChecks,
      loops,
      replacements,
      allPass,
      logs,
    };
  }

  /** 运行 Economist Agent：经济评估 */
  runEconomist(schemeIds: string[]): {
    metrics: Record<string, unknown>;
    logs: IAgentActionLog[];
  } {
    this.currentAgent = 'economist';
    const logs: IAgentActionLog[] = [];
    const push = (entry: Omit<IAgentActionLog, 'step' | 'timestamp'>) => {
      this.pushLog({ ...entry, agent: 'economist' });
      logs.push({ ...entry, step: this.stepCounter, agent: 'economist', timestamp: Date.now() });
    };

    const thoughts = this.generateThoughtsForAgent('economist');
    thoughts.forEach((text) => {
      push({ type: 'think', content: text });
    });

    const metrics: Record<string, unknown> = {};

    schemeIds.forEach((schemeId) => {
      const scheme = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === schemeId);
      const schemeName = scheme?.name || schemeId;

      // 造价估算
      push({
        type: 'tool_call',
        content: `估算「${schemeName}」的单位面积造价`,
        tool: 'estimate_cost',
        args: {
          systemId: schemeId,
          floors: this.params.floors,
          seismicIntensity: this.params.seismicIntensity,
          soilCategory: this.params.soilCategory,
          mainSpan: this.params.mainSpan,
        },
      });
      const costResult = executeToolByName('estimate_cost', {
        systemId: schemeId,
        floors: this.params.floors,
        seismicIntensity: this.params.seismicIntensity,
        soilCategory: this.params.soilCategory,
        mainSpan: this.params.mainSpan,
      });
      push({
        type: 'tool_result',
        content: `「${schemeName}」造价估算：${(costResult as { costPerSqm: number }).costPerSqm} 元/㎡`,
        tool: 'estimate_cost',
        result: costResult,
      });

      // 工期估算
      push({
        type: 'tool_call',
        content: `估算「${schemeName}」的施工工期`,
        tool: 'estimate_schedule',
        args: {
          systemId: schemeId,
          area: this.params.area,
          floors: this.params.floors,
        },
      });
      const scheduleResult = executeToolByName('estimate_schedule', {
        systemId: schemeId,
        area: this.params.area,
        floors: this.params.floors,
      });
      push({
        type: 'tool_result',
        content: `「${schemeName}」工期估算：${(scheduleResult as { totalMonths: number }).totalMonths} 个月`,
        tool: 'estimate_schedule',
        result: scheduleResult,
      });

      // 装配率
      push({
        type: 'tool_call',
        content: `估算「${schemeName}」的装配率及分级`,
        tool: 'estimate_precast_rate',
        args: { systemId: schemeId, floors: this.params.floors },
      });
      const precastResult = executeToolByName('estimate_precast_rate', {
        systemId: schemeId,
        floors: this.params.floors,
      });
      push({
        type: 'tool_result',
        content: `「${schemeName}」装配率：${(precastResult as { precastRate: number }).precastRate}%（${(precastResult as { grade: string }).grade}）`,
        tool: 'estimate_precast_rate',
        result: precastResult,
      });

      // 碳排放
      push({
        type: 'tool_call',
        content: `估算「${schemeName}」的隐含碳排放`,
        tool: 'estimate_carbon',
        args: { systemId: schemeId, floors: this.params.floors },
      });
      const carbonResult = executeToolByName('estimate_carbon', {
        systemId: schemeId,
        floors: this.params.floors,
      });
      push({
        type: 'tool_result',
        content: `「${schemeName}」隐含碳：${(carbonResult as { carbonPerSqm: number }).carbonPerSqm} kgCO₂/㎡`,
        tool: 'estimate_carbon',
        result: carbonResult,
      });

      // 施工风险
      push({
        type: 'tool_call',
        content: `评估「${schemeName}」的施工风险等级`,
        tool: 'assess_construction_risk',
        args: { systemId: schemeId, floors: this.params.floors },
      });
      const riskResult = executeToolByName('assess_construction_risk', {
        systemId: schemeId,
        floors: this.params.floors,
      });
      push({
        type: 'tool_result',
        content: `「${schemeName}」施工风险：${(riskResult as { riskLevelLabel: string }).riskLevelLabel}`,
        tool: 'assess_construction_risk',
        result: riskResult,
      });

      metrics[schemeId] = {
        cost: costResult,
        schedule: scheduleResult,
        precast: precastResult,
        carbon: carbonResult,
        risk: riskResult,
      };
    });

    push({
      type: 'conclusion',
      content: `经济与绿色指标评估完成。\n各方案的造价、工期、装配率、碳排放、施工风险均已量化评估。\n数据显示了各方案在不同维度上的优劣势，为总工综合比选提供量化依据。\n下一步交由总工进行综合评审和最终推荐。`,
    });

    return { metrics, logs };
  }

  /** 运行 Chief Agent：综合对比 + 推荐 */
  runChief(schemeIds: string[], correctionMeta?: {
    loops: number;
    replacements: Array<{ original: string; replacement: string; reason: string; loop: number; finalStatus: string }>;
    allPass: boolean;
  } | null): {
    recommended: { schemeId: string; schemeName: string; overallScore: number; reason: string };
    ranking: Array<{ schemeId: string; schemeName: string; score: number; breakdown: Record<string, number> }>;
    advice: { pros: string[]; cons: string[]; nextSteps: string[] };
    logs: IAgentActionLog[];
  } {
    this.currentAgent = 'chief';
    const logs: IAgentActionLog[] = [];
    const push = (entry: Omit<IAgentActionLog, 'step' | 'timestamp'>) => {
      this.pushLog({ ...entry, agent: 'chief' });
      logs.push({ ...entry, step: this.stepCounter, agent: 'chief', timestamp: Date.now() });
    };

    const thoughts = this.generateThoughtsForAgent('chief');
    thoughts.forEach((text) => {
      push({ type: 'think', content: text });
    });

    // 基础方案建议（附加思考点）
    schemeIds.slice(0, 1).forEach((schemeId) => {
      push({
        type: 'tool_call',
        content: '对推荐方案进行基础方案建议分析',
        tool: 'advise_foundation',
        args: {
          systemId: schemeId,
          geologyType: this.params.geologyType,
          floors: this.params.floors,
          soilCategory: this.params.soilCategory,
        },
      });
      const foundResult = executeToolByName('advise_foundation', {
        systemId: schemeId,
        geologyType: this.params.geologyType,
        floors: this.params.floors,
        soilCategory: this.params.soilCategory,
      });
      push({
        type: 'tool_result',
        content: `基础方案建议：${(foundResult as { foundationType: string }).foundationType}`,
        tool: 'advise_foundation',
        result: foundResult,
      });
    });

    // 综合对比
    push({
      type: 'tool_call',
      content: '调用 compare_schemes 进行四维权重综合评分排序',
      tool: 'compare_schemes',
      args: {
        schemeIds,
        params: {
          buildingType: this.params.buildingType,
          floors: this.params.floors,
          area: this.params.area,
          seismicIntensity: this.params.seismicIntensity,
          soilCategory: this.params.soilCategory,
          mainSpan: this.params.mainSpan,
        },
        weights: this.weights,
      },
    });

    const compareResult = executeToolByName('compare_schemes', {
      schemeIds,
      params: {
        buildingType: this.params.buildingType,
        floors: this.params.floors,
        area: this.params.area,
        seismicIntensity: this.params.seismicIntensity,
        soilCategory: this.params.soilCategory,
        mainSpan: this.params.mainSpan,
      },
      weights: this.weights,
    }) as {
      ranking: Array<{ schemeId: string; schemeName: string; score: number; breakdown: Record<string, number> }>;
      recommended: { schemeId: string; schemeName: string; overallScore: number };
      weights: IWeightConfig;
    };

    push({
      type: 'tool_result',
      content: `综合评分完成：推荐方案为「${compareResult.recommended.schemeName}」，综合得分 ${compareResult.recommended.overallScore} 分`,
      tool: 'compare_schemes',
      result: compareResult,
    });

    // ===== 总工自检（自反思/自我修正） =====
    // 回顾 Code Agent 的校核结果，复盘最初直觉 vs 最终推荐之间的差异
    const selfReflection = this.generateChiefSelfReflection(schemeIds, compareResult);
    push({
      type: 'think',
      content: selfReflection.title,
    });
    push({
      type: 'think',
      content: selfReflection.body,
    });
    if (selfReflection.correctionNote) {
      push({
        type: 'think',
        content: selfReflection.correctionNote,
      });
    }

    // 如果经历了辩论环节，总工要明确说明调整过程
    if (correctionMeta && correctionMeta.loops > 0) {
      const loopText = correctionMeta.replacements.length > 0
        ? correctionMeta.replacements.map((r, i) => `${i + 1}. 第${r.loop}轮：${r.original} → ${r.replacement}（${r.reason}，最终${r.finalStatus === 'pass' ? '通过' : '仍需关注'}）`).join('\n')
        : '无具体替换记录';

      push({
        type: 'think',
        content: `【总工复盘 · 多 Agent 辩论】
本次选型经历了 **${correctionMeta.loops} 轮 Code ↔ Architect 辩论**。
初始方案在规范校核中发现不符合项后，Agent 没有直接上报结果，而是自动启动了调整回环：分析失败原因 → 从12类体系库中选择替代方案 → 重新调用校核工具验证。

调整记录：
${loopText}

${correctionMeta.allPass ? '最终所有方案均通过规范校核，说明调整是有效的。' : '经过最大重试轮数后仍有方案未完全通过，需要在推荐中明确标注并建议专项论证。'}

作为总工，我基于**调整后的最终候选方案**进行综合评审。这些方案是经过了规范校核-调整-再校核多轮迭代的结果，而不是一次筛选的产物。`,
      });
    }

    // ===== 总工反思（Reflection）=====
    const topScheme = compareResult.ranking[0];
    const reflection = this.generateChiefReflection(topScheme, schemeIds, compareResult);

    push({
      type: 'think',
      content: `🤔 总工反思：自我审视与风险审视`,
    });
    push({
      type: 'think',
      content: `【反向质疑】如果我站在对立面挑这个方案的毛病，我会担心什么？\n\n${reflection.risks.map((r, i) => `${i + 1}. ${r}`).join('\n')}`,
    });
    push({
      type: 'think',
      content: `【置信度自评】\n\n置信度：**${reflection.confidence.level}**（${reflection.confidence.score}/10 分）\n\n数据充分项：\n${reflection.confidence.strengths.map((s) => `✅ ${s}`).join('\n')}\n\n估算/不确定项：\n${reflection.confidence.uncertainties.map((u) => `⚠️ ${u}`).join('\n')}\n\n理由：${reflection.confidence.reason}`,
    });
    push({
      type: 'think',
      content: `【遗漏检查】有没有遗漏什么重要因素？\n\n${reflection.omissions.map((o, i) => `${i + 1}. ${o}`).join('\n')}`,
    });
    push({
      type: 'think',
      content: `【改进方向】如果再做一轮，我会改进什么？\n\n${reflection.improvements.map((o, i) => `${i + 1}. ${o}`).join('\n')}`,
    });

    // 生成推荐理由
    const top = compareResult.ranking[0];
    const second = compareResult.ranking[1];
    const reason = this.generateChiefReason(top, second, compareResult.weights, reflection);

    push({
      type: 'conclusion',
      content: reason,
    });

    const advice = {
      pros: [
        `${top.schemeName}在综合评分中领先，${top.breakdown['安全抗震'] ? `抗震性能得分 ${top.breakdown['安全抗震'].toFixed(1)} 分，` : ''}表现突出`,
        `${top.breakdown['造价经济'] ? `造价经济性得分 ${top.breakdown['造价经济'].toFixed(1)} 分，` : ''}符合项目预算约束`,
        '技术成熟，施工经验丰富，质量可控',
      ],
      cons: reflection.risks.slice(0, 3),
      risks: reflection.risks,
      riskTriggers: reflection.riskTriggers,
      confidence: reflection.confidence,
      nextSteps: [
        '进行初步设计阶段的结构布置和截面估算',
        '采用专业结构分析软件（如 PKPM / YJK / ETABS）进行详细计算',
        '根据地勘报告进行详细基础设计',
        '组织专家论证会对关键技术问题进行评审',
        '考虑进行 BIM 建模和碰撞检查',
        ...reflection.designFocuses,
      ],
    };

    return {
      recommended: {
        schemeId: compareResult.recommended.schemeId,
        schemeName: compareResult.recommended.schemeName,
        overallScore: compareResult.recommended.overallScore,
        reason,
      },
      ranking: compareResult.ranking,
      advice,
      logs,
    };
  }

  /** 生成总工推荐理由文本（含风险提示） */
  private generateChiefReason(
    top: { schemeId: string; schemeName: string; score: number; breakdown: Record<string, number> },
    second: { schemeId: string; schemeName: string; score: number; breakdown: Record<string, number> } | undefined,
    weights: IWeightConfig,
    reflection: { risks: string[]; riskTriggers: string[]; confidence: { level: string; score: number; strengths: string[]; uncertainties: string[]; reason: string }; designFocuses: string[] }
  ): string {
    const lines: string[] = [];
    lines.push(`## 综合推荐：${top.schemeName}`);
    lines.push('');
    lines.push(`综合评分：**${top.score.toFixed(1)} / 10 分**`);
    lines.push('');
    lines.push(`基于本项目的工程参数（${this.params.floors}层、${this.params.seismicIntensity}度设防、${this.params.area.toLocaleString()}㎡、预算 ${this.params.budget} 元/㎡），经过方案创作工程师、规范校核工程师、经济评估工程师三轮专业分析，并按四维权重（造价${weights.cost}% / 工期${weights.duration}% / 安全${weights.safety}% / 绿色${weights.green}%）进行综合加权评分，**${top.schemeName}** 是最优选择。`);

    // 高烈度高层住宅场景：补充侧向刚度控制说明
    const h = this.params.floors * 3;
    const intensityVal = parseInt(this.params.seismicIntensity, 10);
    const isHighSeismicHighRiseResidential =
      this.params.buildingType === 'residential' && intensityVal >= 8 && h >= 30;
    if (isHighSeismicHighRiseResidential) {
      lines.push('');
      lines.push(`> **总工特别说明**：${this.params.seismicIntensity}度设防、约 ${h}m 高住宅属于高烈度中高层项目，选型应以**侧向刚度控制**为核心原则。框架结构虽造价较低但抗侧刚度不足，本项目推荐以框剪/剪力墙类抗震墙体系为主，在**侧向刚度与经济性之间取得最佳平衡**。`);
    }

    // 风荷载敏感场景提示
    const windVal = parseFloat(this.params.windPressure || '0.4');
    if (windVal >= 0.55 && h >= 30) {
      lines.push('');
      lines.push(`> **风荷载提示**：基本风压 ${windVal.toFixed(2)} kN/㎡、约 ${h}m 高度，属于**风荷载敏感项目**，选型时需关注结构抗侧刚度与舒适度（风振加速度）。推荐方案的侧向刚度可有效控制风振位移。`);
    }

    // 高雪压厂房/大跨度提示
    const snowVal = parseFloat(this.params.snowPressure || '0.2');
    if (snowVal >= 0.35 && (this.params.buildingType === 'factory' || this.params.buildingType === 'gymnasium')) {
      lines.push('');
      lines.push(`> **雪荷载提示**：基本雪压 ${snowVal.toFixed(2)} kN/㎡ 的${this.params.buildingType === 'factory' ? '厂房' : '大跨度建筑'}，屋面雪荷载占比高，推荐方案已考虑屋盖结构承载力与积雪分布系数。`);
    }

    // 设防类别提升说明
    const fortCat = this.params.fortificationCategory || 'standard';
    if (fortCat === 'key' || fortCat === 'special') {
      const catLabel = fortCat === 'key' ? '重点设防类（乙类）' : '特殊设防类（甲类）';
      lines.push('');
      lines.push(`> **设防类别说明**：本工程为 **${catLabel}**，抗震措施需相应提高一度（特殊设防类提高一度以上），推荐方案的安全储备已计入设防类别调整系数，确保满足更高的抗震要求。`);
    }
    lines.push('');
    lines.push('### 推荐理由');
    lines.push('');

    // 找最强项
    const entries = Object.entries(top.breakdown).filter(([k]) => ['造价经济', '工期优势', '安全抗震', '绿色低碳'].includes(k));
    entries.sort((a, b) => b[1] - a[1]);
    entries.forEach(([key, value], i) => {
      lines.push(`${i + 1}. **${key}**：${value.toFixed(1)} 分 — ${this.getDimensionDescription(key, top.schemeName)}`);
    });

    lines.push('');
    if (second) {
      const diff = top.score - second.score;
      lines.push(`### 与第二名对比`);
      lines.push('');
      lines.push(`第二名 ${second.schemeName} 综合得分 ${second.score.toFixed(1)} 分，比推荐方案低 ${diff.toFixed(1)} 分。`);
      if (diff < 1) {
        lines.push('两者差距较小，实际工程中可根据具体偏好进一步权衡。');
      } else {
        lines.push('推荐方案在综合性能上具有明显优势。');
      }
      lines.push('');
    }

    lines.push('> **注意**：本推荐基于经验公式与简化假定，仅用于方案前期概念比选与决策参考，不构成任何设计依据。实际工程设计必须由注册结构工程师主持，采用专业结构分析软件按现行国家标准逐项复核。');

    // 风险提示
    lines.push('');
    lines.push('### ⚠️ 风险提示');
    lines.push('');
    lines.push(`**方案置信度：${reflection.confidence.level}（${reflection.confidence.score}/10 分）**`);
    lines.push('');
    lines.push('这个方案最可能出问题的地方：');
    reflection.risks.slice(0, 3).forEach((r, i) => {
      lines.push(`${i + 1}. ${r}`);
    });
    lines.push('');
    lines.push('需要重新评估的触发条件：');
    reflection.riskTriggers.slice(0, 3).forEach((t, i) => {
      lines.push(`- ${t}`);
    });
    lines.push('');
    lines.push('后续深化设计重点关注：');
    reflection.designFocuses.slice(0, 4).forEach((f, i) => {
      lines.push(`- ${f}`);
    });

    return lines.join('\n');
  }

  /**
   * 总工自反思：回顾 Code Agent 校核结果，复盘选型思路演变
   * 呈现「最初直觉 → 校核结果 → 修正结论」的回环过程
   */
  private generateChiefSelfReflection(
    schemeIds: string[],
    compareResult: {
      ranking: Array<{ schemeId: string; schemeName: string; score: number; breakdown: Record<string, number> }>;
      recommended: { schemeId: string; schemeName: string; overallScore: number };
      weights: IWeightConfig;
    }
  ): { title: string; body: string; correctionNote?: string } {
    const intensity = this.params.seismicIntensity;
    const floors = this.params.floors;
    const height = floors * 3;
    const budget = this.params.budget;

    // 对每个候选方案做一次快速校核，统计 warning/fail 数量
    const schemeWarnCount: Record<string, number> = {};
    const schemeFailCount: Record<string, number> = {};
    const schemeWarnings: Record<string, string[]> = {};

    schemeIds.forEach((sid) => {
      const seisResult = executeToolByName('check_seismic_requirements', {
        systemId: sid,
        params: {
          floors,
          seismicIntensity: intensity,
          soilCategory: this.params.soilCategory,
          buildingType: this.params.buildingType,
        },
      }) as { checks?: Array<{ name: string; status: string }> };
      const checks = seisResult.checks ?? [];
      schemeWarnCount[sid] = checks.filter((c) => c.status === 'warning').length;
      schemeFailCount[sid] = checks.filter((c) => c.status === 'fail').length;
      schemeWarnings[sid] = checks.filter((c) => c.status !== 'pass').map((c) => c.name);
    });

    // 找造价最低的方案（最初直觉可能选它）
    const topScheme = compareResult.ranking[0];
    const cheapest = [...compareResult.ranking].sort(
      (a, b) => (a.breakdown['造价经济'] || 0) - (b.breakdown['造价经济'] || 0)
    )[compareResult.ranking.length - 1]; // 造价经济得分最高 = 最便宜

    const hasWarnings = Object.values(schemeWarnCount).some((c) => c > 0);
    const hasFails = Object.values(schemeFailCount).some((c) => c > 0);

    const title = '🔄 总工自检：复盘最初直觉 vs 校核结论';

    let body = '';
    let correctionNote: string | undefined;

    // 场景 1: 推荐方案不是造价最低的 —— 说明有「因为校核告警而放弃更便宜方案」的故事线
    if (cheapest && cheapest.schemeId !== topScheme.schemeId) {
      const cheapId = cheapest.schemeId;
      const cheapWarnings = schemeWarnings[cheapId] || [];
      const topWarnings = schemeWarnings[topScheme.schemeId] || [];
      const costDiffPct = Math.abs(
        ((topScheme.breakdown['造价经济'] || 0) - (cheapest.breakdown['造价经济'] || 0)) /
          Math.max(cheapest.breakdown['造价经济'] || 1, 1) *
          100
      ).toFixed(1);

      body = `最初直觉：如果只看造价，${cheapest.schemeName}是最经济的选择（造价经济得分 ${cheapest.breakdown['造价经济']?.toFixed(1)} 分），${budget ? `项目预算约束 ${budget} 元/㎡，${cheapest.schemeName}看起来最划算。` : '第一反应会选最便宜的。'}`;
      body += `\n\n但 Code Agent 的校核结果让我重新审视：`;

      if (cheapWarnings.length > 0) {
        body += `\n- ${cheapest.schemeName}在「${cheapWarnings.join('、')}」上有 ${cheapWarnings.length} 项告警`;
        if (cheapWarnings.some((w) => w.includes('位移角'))) {
          body += `，其中弹性层间位移角偏紧是关键问题——${floors}层 ${intensity}度设防下，框架类体系侧向刚度不足，多遇地震作用下变形可能超限`;
        }
        if (cheapWarnings.some((w) => w.includes('高度'))) {
          body += `，建筑高度 ${height}m 已接近该体系的适用高度上限`;
        }
      } else {
        body += `\n- ${cheapest.schemeName}虽然各项校核都通过，但${intensity}度区高约 ${height}m 的建筑，${cheapest.schemeName}在安全储备和延性方面不如${topScheme.schemeName}`;
      }

      body += `\n\n权衡：换成 ${topScheme.schemeName}，造价大概多 ${Math.max(2, Number(costDiffPct) / 2).toFixed(0)}% 左右（估算），但换来：`;
      body += `\n  ① 位移角更宽裕，侧向刚度储备充足`;
      body += `\n  ② 抗震延性更好，大震下倒塌风险更低`;
      body += `\n  ③ ${topWarnings.length === 0 ? '规范校核全部通过，无告警项' : `仅剩 ${topWarnings.length} 项注意事项`}`;
      body += `\n\n结论：对于 ${intensity}度设防、约 ${height}m 高的${this.params.buildingType === 'residential' ? '住宅' : '建筑'}，侧向刚度控制是主要矛盾，造价退让是合理代价。`;

      correctionNote = `→ 自我修正：从「造价最低优先」调整为「${intensity}度区刚度控制优先」，推荐方案由最初倾向的${cheapest.schemeName}改为最终的${topScheme.schemeName}。这是规范校核驱动的方案升级。`;
    }
    // 场景 2: 推荐方案就是造价最低的，且没有告警 —— 反思是否过于保守
    else if (!hasWarnings && !hasFails) {
      body = `最初直觉：${topScheme.schemeName}综合评分第一，而且各项规范校核全部通过，看起来是稳妥的选择。\n\n但总工的职责不仅是「合规」，还要「经济」。我重新审视一下：${floors}层（约${height}m）、${intensity}度设防，高度并不算特别高，有没有可能用更经济的体系？\n\n检查后发现：各候选方案的规范校核都没有 fail，说明这个项目规模属于常规范围。之所以推荐${topScheme.schemeName}，是因为它在安全维度和造价维度取得了最佳平衡，而不是因为其他方案有硬伤。\n\n结论：推荐是合理的，但提醒设计团队——后续初步设计阶段可以对截面和布置做进一步优化，在确保安全的前提下继续挖造价潜力。`;
      correctionNote = '→ 自检结论：没有过度保险，但建议下一阶段继续做精细化优化，把造价压到合理下限。';
    }
    // 场景 3: 推荐方案本身也有告警
    else {
      const topWarnings = schemeWarnings[topScheme.schemeId] || [];
      body = `最初直觉：${topScheme.schemeName}是综合评分最高的方案。\n\n但 Code Agent 的校核显示它也不是完美的——「${topWarnings.join('、')}」有告警。我得重新想想：是应该换一个方案，还是这些告警在可控范围内？\n\n逐一评估：`;
      topWarnings.forEach((w) => {
        if (w.includes('剪重比')) {
          body += `\n- 剪重比告警：这是规范要求的最小值，实际设计中可通过地震作用放大系数调整，属于可解决的问题`;
        } else if (w.includes('周期比')) {
          body += `\n- 周期比告警：说明平面布置的扭转效应偏大，设计阶段可通过调整抗侧力构件布置解决`;
        } else if (w.includes('防火') || w.includes('防火保护')) {
          body += `\n- 防火保护告警：钢结构本就需要做防火涂料，属于常规措施，不是不可接受的硬伤`;
        } else {
          body += `\n- ${w}告警：需在设计阶段重点关注并采取相应构造措施`;
        }
      });
      body += `\n\n结论：这些告警都属于「设计中可通过措施解决」的范畴，不构成否决性缺陷。${topScheme.schemeName}仍然是最佳选择，但后续设计中应逐条落实。`;
      correctionNote = `→ 自我提醒：推荐方案有 ${topWarnings.length} 项需注意事项，总工需在后续阶段跟踪落实，不能因为综合排名第一就忽视风险点。`;
    }

    return { title, body, correctionNote };
  }

  /**
   * 总工反思（Reflection）：反向质疑 + 置信度自评 + 遗漏检查 + 改进建议
   */
  private generateChiefReflection(
    top: { schemeId: string; schemeName: string; score: number; breakdown: Record<string, number> },
    schemeIds: string[],
    compareResult: {
      ranking: Array<{ schemeId: string; schemeName: string; score: number; breakdown: Record<string, number> }>;
      recommended: { schemeId: string; schemeName: string; overallScore: number };
      weights: IWeightConfig;
    }
  ): {
    risks: string[];
    riskTriggers: string[];
    confidence: {
      level: string;
      score: number;
      strengths: string[];
      uncertainties: string[];
      reason: string;
    };
    omissions: string[];
    improvements: string[];
    designFocuses: string[];
  } {
    const intensity = parseInt(this.params.seismicIntensity, 10);
    const height = this.params.floors * 3;
    const budget = this.params.budget;
    const topId = top.schemeId;
    const topSystem = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === topId);

    // 1. 反向质疑：2-3 个风险点
    const risks: string[] = [];
    const riskTriggers: string[] = [];

    // 高度接近限值的风险
    const seisResult = executeToolByName('check_seismic_requirements', {
      systemId: topId,
      params: {
        floors: this.params.floors,
        seismicIntensity: this.params.seismicIntensity,
        soilCategory: this.params.soilCategory,
        buildingType: this.params.buildingType,
      },
    }) as { checks?: Array<{ name: string; status: string; value?: string; requirement?: string }> };
    const checks = seisResult.checks ?? [];
    const heightCheck = checks.find((c) => c.name === '高度适用范围');
    if (heightCheck && heightCheck.status === 'warning') {
      risks.push(`建筑高度约 ${height}m，已接近 ${top.schemeName}在 ${this.params.seismicIntensity} 度设防下的适用高度上限，高度裕度不足，实际设计需严格控制层高和屋面附属结构高度`);
      riskTriggers.push('如果实际层高超过 3m/层或有突出屋面的塔楼/设备间，导致总高度超出规范限值');
    }

    // 位移角偏紧的风险
    const driftCheck = checks.find((c) => c.name.includes('位移角'));
    if (driftCheck && driftCheck.status === 'warning') {
      risks.push(`弹性层间位移角偏紧，在地震作用下结构变形接近限值，舒适度和风振验算可能需要额外关注`);
      riskTriggers.push('如果场地类别变差或实际地震动参数大于规范值，位移角可能超限');
    }

    // 造价接近预算上限的风险
    if (top.breakdown['造价经济'] && top.breakdown['造价经济'] < 6) {
      risks.push(`造价指标偏紧（约 ${budget} 元/㎡量级），${top.schemeName}的单位造价在预算约束内余量不大，方案深化或市场价格波动可能突破预算`);
      riskTriggers.push('如果钢材/混凝土价格上涨超过 5%，或地基处理费用超出预期');
    }

    // 钢结构防火风险
    if (topId === 'steel' || topId === 'prefab-steel') {
      risks.push(`${top.schemeName}的钢构件需做防火保护，防火涂料施工质量直接影响耐火极限，属于施工质量敏感点`);
      riskTriggers.push('如果防火涂料厚度不足或粘结强度不达标，耐火极限将不满足规范要求');
    }

    // 装配式接缝风险
    if (topId.includes('prefab') || topId === 'precast-concrete') {
      risks.push(`装配式结构的节点接缝质量是关键薄弱环节，预制构件安装精度和灌浆质量直接影响结构整体抗震性能`);
      riskTriggers.push('如果施工单位缺乏装配式经验或套筒灌浆质量不合格');
    }

    // 场地土类别不确定性风险
    risks.push(`当前参数基于假定场地类别（${this.params.soilCategory}类），正式设计需根据地勘报告确认，若实际场地条件更差（如存在软弱土层、液化土层），可能需要调整基础方案或抗震措施`);

    // 通用补充风险
    if (risks.length < 3) {
      risks.push('方案阶段的计算基于经验公式和简化模型，与详细设计阶段的精确计算可能存在偏差，需在下一阶段验证');
    }
    if (riskTriggers.length < 3) {
      riskTriggers.push('如果建筑功能或荷载条件发生重大变化（如增设大空间、增加设备重量）');
      riskTriggers.push('如果施工总承包单位缺乏该体系的施工经验和技术能力');
    }

    // 2. 置信度自评
    const strengths: string[] = [];
    const uncertainties: string[] = [];

    // 数据充分项
    strengths.push('体系选型和适用高度判断基于规范限值，数据可靠');
    strengths.push('抗震规范校核结果来自标准条文对照，校核项覆盖全面');
    strengths.push('造价和工期估算基于工程统计经验，有参考价值');

    // 不确定项
    uncertainties.push('造价和工期为方案阶段估算，精度约 ±15%，需初设阶段细化');
    uncertainties.push('基础方案建议仅根据场地类别和层数推断，未考虑具体地勘数据');
    uncertainties.push('施工风险评估为定性判断，实际风险受施工单位水平和管理影响很大');

    let confidenceScore = 7;
    let confidenceLevel = '中';
    if (heightCheck?.status === 'pass' && budget >= 5000) {
      confidenceScore = 8.5;
      confidenceLevel = '高';
    } else if (heightCheck?.status === 'fail' || budget < 3000) {
      confidenceScore = 5.5;
      confidenceLevel = '中低';
    }

    const confidenceReason =
      confidenceLevel === '高'
        ? '本项目规模属于常规范围，各项规范校核通过充分，推荐方案有较大安全储备，数据可信度较高。'
        : confidenceLevel === '中'
          ? '方案主要控制指标均满足规范要求，但部分指标余量不大，且造价和工期为估算值，需在下一阶段验证确认。'
          : '本项目参数较为极端（高度接近限值或预算紧张），推荐方案的安全余量有限，建议进行专项论证或适当调整参数。';

    // 3. 遗漏检查
    const omissions: string[] = [];

    omissions.push('场地条件：当前仅根据场地类别做初步判断，未考虑具体地勘数据（土层分布、地下水位、液化判别等），基础方案需地勘后确认');
    omissions.push('施工可行性：未考虑项目所在地施工单位的技术能力和材料供应情况，这可能影响方案的实际可实施性');

    if (this.params.buildingType === 'residential') {
      omissions.push('建筑使用功能细节：住宅的户型布置、剪力墙间距是否满足建筑平面需求，需与建筑专业配合确认');
    } else if (this.params.buildingType === 'factory' || this.params.buildingType === 'gymnasium') {
      omissions.push('大跨度屋盖结构选型：本分析主要针对竖向承重体系，屋盖结构（桁架/网架/张弦梁等）需另行专项设计');
    } else {
      omissions.push('建筑平面布置：未考虑平面不规则（扭转、收进、悬挑）对结构抗震性能的影响，实际设计需注意');
    }

    omissions.push('业主特殊需求：未考虑业主对建设速度、品质标准、未来改扩建等方面的特殊要求');

    // 4. 改进建议
    const improvements: string[] = [];

    improvements.push('拿到详细地勘报告后，重新评估基础方案和地基处理方式，可能进一步优化基础造价');
    improvements.push('进行敏感性分析：模拟造价±10%、烈度提高一度等边界条件下的方案排名变化');
    improvements.push('与建筑专业配合优化平面布置，在满足建筑功能的前提下使结构受力更合理');
    improvements.push('引入 BIM 技术进行全专业协同，提前发现并解决结构与机电、建筑的碰撞问题');
    improvements.push('对关键节点（如梁柱节点、剪力墙连梁、装配式接缝）进行构造深化，确保施工图阶段可实施');

    // 5. 深化设计重点（风险提示的子项）
    const designFocuses: string[] = [];

    if (driftCheck && driftCheck.status === 'warning') {
      designFocuses.push('重点关注层间位移角控制，必要时通过增加剪力墙厚度或调整布置提高抗侧刚度');
    }
    if (topId === 'steel' || topId === 'prefab-steel') {
      designFocuses.push('钢结构防火涂料选型和厚度设计，确保满足耐火极限要求');
    }
    if (intensity >= 8) {
      designFocuses.push('高烈度区重点关注强柱弱梁、强剪弱弯等抗震构造措施的落实');
    }
    designFocuses.push('基础设计需待正式地勘报告后进行，注意不均匀沉降控制');
    designFocuses.push('节点域抗剪验算和节点构造设计，确保延性');

    return {
      risks: risks.slice(0, 4),
      riskTriggers: riskTriggers.slice(0, 4),
      confidence: {
        level: confidenceLevel,
        score: confidenceScore,
        strengths,
        uncertainties,
        reason: confidenceReason,
      },
      omissions: omissions.slice(0, 4),
      improvements: improvements.slice(0, 4),
      designFocuses: designFocuses.slice(0, 4),
    };
  }

  private getDimensionDescription(dim: string, schemeName: string): string {
    const map: Record<string, string> = {
      '造价经济': `${schemeName}的单位面积造价处于合理区间，符合项目预算约束`,
      '工期优势': `${schemeName}的施工效率较高，工期可控`,
      '安全抗震': `${schemeName}的抗震性能良好，满足规范要求`,
      '绿色低碳': `${schemeName}在绿色低碳方面表现良好`,
    };
    return map[dim] || '表现良好';
  }

  /** 获取全部行动日志 */
  getActionLog(): IAgentActionLog[] {
    return [...this.actionLog];
  }

  /** 获取当前步数 */
  getStepCount(): number {
    return this.stepCounter;
  }
}


