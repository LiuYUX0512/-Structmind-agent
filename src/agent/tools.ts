// Agent 工具注册表：10 个工程工具，全部复用 src/data/structure.ts 中已核对的国标限值与计算逻辑
// EXPORTS: TOOL_REGISTRY, type IToolExecutor, type IToolDefinition, executeToolByName

import {
  STRUCTURE_SYSTEM_LIBRARY,
  estimateCost,
  estimateDuration,
  estimateCarbonEmission,
  estimatePrecastRate,
  estimateConstructionRisk,
  suggestFoundation,
  calculateNormCompliance,
  calculateBuildingHeight,
  generateSchemesFromParams,
  type IProjectParams,
  type IStructureScheme,
  type INormCompliance,
  type IFoundationSuggestion,
} from '@/data/structure';
import { computeSchemeScore } from './scoring';
import { resolveKnowledgeBasis } from '@/data/code-knowledge';
import { listKnownSystemIds } from '@/data/code-rules';

/** 工具参数属性定义（JSON Schema 子集） */
export interface IToolParamProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  items?: { type: string; properties?: Record<string, unknown> };
  /** object 类型时的子属性 */
  properties?: Record<string, IToolParamProperty>;
  /** object 类型时的必填字段 */
  required?: string[];
}

/** 工具函数参数定义（JSON Schema 子集，满足 function calling 格式） */
export interface IToolParamSchema {
  type: 'object';
  properties: Record<string, IToolParamProperty>;
  required: string[];
}

/** 工具定义（OpenAI function calling 格式） */
export interface IToolDefinition {
  name: string;
  description: string;
  parameters: IToolParamSchema;
}

/** 工具执行器签名 */
export type IToolExecutor = (args: Record<string, unknown>) => unknown;

/** 带执行器的完整工具注册项 */
export interface IRegisteredTool extends IToolDefinition {
  executor: IToolExecutor;
  /** 允许哪些子 Agent 调用 */
  allowedAgents: string[];
}

// ============ 工程参数归一化 ============
// P0-3：工具层不得在边界上静默改写工程参数。
//
// 旧实现在三个工具里各自「重建」params，把用户填的地质条件、预算、风雪荷载一律换成常量
// （geologyType 恒 'clay'、budget 恒 4000）。后果是同一个工程在
// Architect 选型 / Code 校核 / Chief 比选三个环节拿到的是三组不同参数：
//   - 预算参与候选池评分（structure.ts: budgetRatio = estCost / params.budget）
//     → 用户填 4500、工具按 4000 算，实测会静默淘汰掉一个可行方案；
//   - 地质条件参与基础选型 → 用户填软土，工具按黏土给建议。
// 这与 P0-3 要消灭的「调用方之间口径分裂」是同一类病，只是发生在参数边界而非评分边界。
//
// 现统一为「合并」语义：LLM 传了什么就认什么，没传才用默认。

const DEFAULT_TOOL_PARAMS: IProjectParams = {
  buildingType: 'residential',
  floors: 10,
  area: 5000,
  structurePreference: 'any',
  seismicIntensity: '7',
  soilCategory: 'Ⅱ',
  geologyType: 'clay',
  mainSpan: 8,
  budget: 4000,
  windPressure: '0.4',
  snowPressure: '0.2',
  fortificationCategory: 'standard',
};

const NUMERIC_PARAM_FIELDS = ['floors', 'area', 'mainSpan', 'budget', 'buildingHeight'] as const;
const TEXT_PARAM_FIELDS = [
  'buildingType',
  'structurePreference',
  'seismicIntensity',
  'soilCategory',
  'geologyType',
  'windPressure',
  'snowPressure',
  'fortificationCategory',
] as const;

/**
 * 把 LLM 传入的部分参数合并成完整工程参数（不丢弃任何已提供的字段）。
 * buildingHeight 为可选项：未提供时保持缺省，交由 resolveBuildingHeight 按层数估算。
 */
export function normalizeToolParams(raw?: Record<string, unknown>): IProjectParams {
  const src = raw ?? {};
  const out: IProjectParams = { ...DEFAULT_TOOL_PARAMS };
  const bag = out as unknown as Record<string, unknown>;

  for (const field of NUMERIC_PARAM_FIELDS) {
    const rawValue = src[field];
    if (rawValue == null || rawValue === '') continue;
    const value = Number(rawValue);
    if (Number.isFinite(value)) bag[field] = value;
  }
  for (const field of TEXT_PARAM_FIELDS) {
    const value = src[field];
    if (typeof value === 'string' && value.trim() !== '') bag[field] = value;
  }
  return out;
}

/** 工程参数的 JSON Schema 片段（供三个工程工具复用，保证 LLM 知道能传哪些字段） */
const PROJECT_PARAMS_SCHEMA: Record<string, IToolParamProperty> = {
  buildingType: { type: 'string', description: '建筑类型：residential 住宅 / office 办公 / commercial 商业 / industrial 厂房' },
  floors: { type: 'number', description: '地上层数' },
  area: { type: 'number', description: '建筑面积（㎡），影响周期、刚度与工期估算' },
  structurePreference: { type: 'string', description: '业主结构偏好体系 ID，无偏好填 any' },
  seismicIntensity: { type: 'string', description: '设防烈度：6/7/8/9' },
  soilCategory: { type: 'string', description: '场地土类别：Ⅰ/Ⅱ/Ⅲ/Ⅳ' },
  geologyType: { type: 'string', description: '地质条件（影响基础选型），如 clay 黏土 / sand 砂土 / soft-soil 软土 / rock 岩石' },
  mainSpan: { type: 'number', description: '主跨（m），影响周期与刚度估算' },
  budget: { type: 'number', description: '单位造价预算（元/㎡），参与候选池适配度评分' },
  windPressure: { type: 'string', description: '基本风压（kN/㎡）' },
  snowPressure: { type: 'string', description: '基本雪压（kN/㎡）' },
  fortificationCategory: { type: 'string', description: '设防类别：standard 标准 / key 重点 / special 特殊' },
  buildingHeight: {
    type: 'number',
    description: '结构总高度（m）。用户显式指定时必传——高度直接决定适用高度、位移角与周期比判定',
  },
};

// ============ 工具注册清单 ============

export const TOOL_REGISTRY: IRegisteredTool[] = [
  // ---- 工具 1: 结构体系筛选 ----
  {
    name: 'query_structure_systems',
    description: '从12类结构体系库中按高度、建筑类型、跨度、预算、烈度等8维条件筛选，返回候选方案池（含体系名、id、适用性评分）。用于方案选型初期快速确定备选体系。',
    parameters: {
      type: 'object',
      properties: {
        filters: {
          type: 'object',
          description: '筛选条件，与 IProjectParams 字段一致，至少提供建筑类型、层数、设防烈度',
          // P0-3：字段集统一由 PROJECT_PARAMS_SCHEMA 提供，避免「执行器读了但大模型看不到」
          properties: {
            ...PROJECT_PARAMS_SCHEMA,
            buildingType: { type: 'string', description: '建筑类型：residential/office/school/factory/gymnasium', enum: ['residential', 'office', 'school', 'factory', 'gymnasium'] },
            seismicIntensity: { type: 'string', description: '抗震设防烈度：6/7/8/9', enum: ['6', '7', '8', '9'] },
            soilCategory: { type: 'string', description: '场地土类别：Ⅰ/Ⅱ/Ⅲ/Ⅳ', enum: ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ'] },
            structurePreference: { type: 'string', description: '结构体系偏好，any 表示不限', enum: ['any', 'frame', 'frame-shearwall', 'shearwall', 'steel', 'prefabricated'] },
          },
          required: ['buildingType', 'floors', 'seismicIntensity'],
        },
        topN: { type: 'integer', description: '返回前 N 个候选，默认 3', },
      },
      required: ['filters'],
    },
    allowedAgents: ['architect', 'chief'],
    executor: (args: Record<string, unknown>) => {
      const filters = args.filters as Partial<IProjectParams>;
      const topN = (args.topN as number) || 3;
      // P0-3：改为合并语义，用户填的地质/预算/风雪荷载不再被常量覆盖
      const params: IProjectParams = normalizeToolParams(filters as Record<string, unknown>);
      const result = generateSchemesFromParams(params);
      return {
        total: result.length,
        candidates: result.slice(0, topN).map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          applicableScenarios: s.applicableScenarios,
          advantages: s.advantages,
          disadvantages: s.disadvantages,
        })),
      };
    },
  },

  // ---- 工具 2: 抗震规范校核 ----
  {
    name: 'check_seismic_requirements',
    description: '抗震规范校核：按 GB 55002-2021 / GB/T 50011 验算最大适用高度、弹性层间位移角、剪重比、周期比、轴压比（剪力墙体系），返回逐条 { code, clause, limit, actual, status } 判定。',
    parameters: {
      type: 'object',
      properties: {
        systemId: {
          type: 'string',
          description: '结构体系 ID（如 frame / shearwall / steel / frame-shearwall 等）',
        },
        params: {
          type: 'object',
          description: '工程参数（缺失字段按常规默认值补齐，已提供字段一律照收）',
          properties: { ...PROJECT_PARAMS_SCHEMA },
          required: ['floors', 'seismicIntensity'],
        },
      },
      required: ['systemId', 'params'],
    },
    allowedAgents: ['code', 'chief'],
    executor: (args: Record<string, unknown>) => {
      const systemId = args.systemId as string;
      const p = args.params as Record<string, unknown>;
      // P0-2：参数不合法时显式返回 error，让子 Agent 看到并自我纠正；
      // 既不像旧实现那样静默兜底给出看似专业的错误答案，也不让异常冒泡打断管线
      // P0-3：改为合并语义——用户填的建筑高度、地质、预算一律照收，不再被默认常量覆盖
      const params: IProjectParams = normalizeToolParams(p);
      let result: INormCompliance;
      try {
        result = calculateNormCompliance(systemId, params);
      } catch (e) {
        return {
          error: (e as Error).message,
          systemId,
          hint: `请使用下列已知结构体系 ID 重试：${listKnownSystemIds().join('、')}`,
          knownSystemIds: listKnownSystemIds(),
          checks: [],
          passCount: 0,
          warningCount: 0,
          failCount: 0,
        };
      }
      return {
        systemId,
        systemName: (STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === systemId)?.name) || systemId,
        height: params.buildingHeight && Number(params.buildingHeight) > 0
          ? Math.round(Number(params.buildingHeight) * 10) / 10
          : calculateBuildingHeight(params.floors),
        // 规范知识库条文依据（可追溯：每条判定可查到条文号 + 条文要旨）
        knowledgeBasis: resolveKnowledgeBasis(systemId, ['max_height', 'drift', 'swr', 'period', 'axial_ratio', 'seismic_grade']),
        standards: result.standards,
        checks: result.checks.map((c) => ({
          name: c.name,
          status: c.status,
          value: c.value,
          requirement: c.requirement,
          description: c.description,
          basis: c.calcChain?.basis,
          formula: c.calcChain?.formula,
          input: c.calcChain?.input,
          clauseText: c.clauseText,
          reason: c.reason,
          source: c.source,
        })),
        summary: result.summary,
        passCount: result.checks.filter((c) => c.status === 'pass').length,
        warningCount: result.checks.filter((c) => c.status === 'warning').length,
        failCount: result.checks.filter((c) => c.status === 'fail').length,
      };
    },
  },

  // ---- 工具 3: 防火校核 ----
  {
    name: 'check_fire_requirements',
    description: '防火规范校核：按 GB 55037-2022 建筑防火通用规范校验结构体系的耐火等级、构件耐火极限要求。钢结构需重点关注防火涂料保护要求。',
    parameters: {
      type: 'object',
      properties: {
        systemId: {
          type: 'string',
          description: '结构体系 ID',
        },
        height: {
          type: 'number',
          description: '建筑高度（米），可选，不传则按层数推算',
        },
        floors: {
          type: 'number',
          description: '建筑层数',
        },
        buildingType: {
          type: 'string',
          description: '建筑类型',
        },
      },
      required: ['systemId', 'floors'],
    },
    allowedAgents: ['code'],
    executor: (args: Record<string, unknown>) => {
      const systemId = args.systemId as string;
      const floors = Number(args.floors) || 10;
      const height = args.height ? Number(args.height) : calculateBuildingHeight(floors);
      const buildingType = (args.buildingType as string) || 'residential';

      const scheme = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === systemId);
      const systemName = scheme?.name || systemId;

      // 耐火等级判定依据 GB 55037-2022 第 5.1.2 条（高层一级，多层二级）
      const isHighRise = height > 24;
      const fireResistanceGrade = isHighRise ? '一级' : '二级';

      // 不同结构体系的防火关注要点
      const fireChecks: Array<{ item: string; requirement: string; status: 'pass' | 'warning' | 'fail'; note: string; clauseText?: string; reason?: string; source?: string }> = [];

      fireChecks.push({
        item: '耐火等级',
        requirement: fireResistanceGrade,
        status: 'pass',
        note: `${isHighRise ? '高层建筑' : '多层建筑'}按 GB 55037-2022 第 5.1.3 条确定耐火等级为${fireResistanceGrade}`,
      });

      if (systemId === 'steel' || systemId === 'prefab-steel') {
        fireChecks.push({
          item: '钢柱耐火极限',
          requirement: '≥ 3.00 h（一级）/ ≥ 2.50 h（二级）',
          status: 'warning',
          note: '钢结构柱需做防火涂料/防火板保护，达到 GB 55037-2022 表 5.2.1 柱耐火极限要求',
          clauseText:
            '一级耐火等级高层建筑，钢柱耐火极限不应低于 3.00h；二级耐火等级不应低于 2.50h。钢结构柱必须采取防火保护措施方可满足规范耐火极限要求。',
          reason:
            '钢柱为竖向承重构件，火灾下一旦失稳将导致结构整体倒塌，因此耐火极限要求最高。采用厚涂型防火涂料（约30~50mm）或防火板包覆可达到 3.00h 要求。',
          source: 'GB 55037-2022《建筑防火通用规范》表 5.2.1',
        });
        fireChecks.push({
          item: '钢梁耐火极限',
          requirement: '≥ 2.00 h（一级）/ ≥ 1.50 h（二级）',
          status: 'warning',
          note: '钢梁需做防火涂料保护，推荐超薄型或薄型防火涂料',
          clauseText:
            '一级耐火等级高层建筑，钢梁耐火极限不应低于 2.00h；二级耐火等级不应低于 1.50h。钢梁为水平承重构件，需做防火保护。',
          reason:
            '钢梁耐火极限要求略低于柱，工程中常用薄涂型或超薄型膨胀型防火涂料，涂层厚度较小，兼顾经济与外观。',
          source: 'GB 55037-2022《建筑防火通用规范》表 5.2.1',
        });
        fireChecks.push({
          item: '楼板耐火极限',
          requirement: '≥ 1.50 h（一级）/ ≥ 1.00 h（二级）',
          status: 'pass',
          note: '钢楼承板+现浇混凝土组合楼板通常可满足要求',
          clauseText:
            '一级耐火等级高层建筑，楼板耐火极限不应低于 1.50h；二级不应低于 1.00h。压型钢板+现浇混凝土组合楼板通常可满足要求。',
          reason:
            '组合楼板因下部有压型钢板与上部现浇混凝土共同作用，混凝土层本身具有较好耐火性能，一般无需额外做底部防火涂料。',
          source: 'GB 55037-2022《建筑防火通用规范》表 5.2.1',
        });
      } else if (systemId === 'masonry') {
        fireChecks.push({
          item: '承重墙耐火极限',
          requirement: '≥ 3.00 h（一级）',
          status: 'pass',
          note: '砌体墙耐火性能优异，240mm 厚普通黏土砖墙耐火极限约 5.5h',
        });
      } else if (systemId === 'mass-timber') {
        fireChecks.push({
          item: '木构件耐火极限',
          requirement: '按建筑高度和功能确定',
          status: 'warning',
          note: '胶合木结构需按 GB 55037-2022 第 5.3 节木结构建筑规定确定耐火极限',
        });
      } else {
        fireChecks.push({
          item: '混凝土构件耐火极限',
          requirement: '墙/柱≥3.0h、梁≥2.0h、板≥1.5h（一级）',
          status: 'pass',
          note: '钢筋混凝土构件通常具有良好的耐火性能，满足规范要求',
        });
      }

      return {
        systemId,
        systemName,
        buildingType,
        height,
        fireResistanceGrade,
        // 规范知识库条文依据（可追溯：耐火等级 + 钢结构防火保护）
        knowledgeBasis: resolveKnowledgeBasis(systemId, ['fire_grade', 'steel_fire']),
        codeBasis: ['GB 55037-2022《建筑防火通用规范》', 'GB 50016-2014（2018年版）《建筑设计防火规范》'],
        checks: fireChecks.map((c) => ({
          article: c.item,
          status: c.status,
          requirement: c.requirement,
          note: c.note,
          clauseText: c.clauseText,
          reason: c.reason,
          source: c.source,
        })),
        items: fireChecks.map((c) => ({
          article: c.item,
          status: c.status,
          requirement: c.requirement,
          note: c.note,
          clauseText: c.clauseText,
          reason: c.reason,
          source: c.source,
        })),
        summary:
          systemId === 'steel' || systemId === 'prefab-steel' || systemId === 'mass-timber'
            ? `该结构体系（${systemName}）防火性能需专项设计，钢结构需做防火涂料保护，木结构需满足木结构建筑防火专项要求。`
            : `该结构体系（${systemName}）具有良好的耐火性能，按${fireResistanceGrade}耐火等级设计即可满足 GB 55037-2022 要求。`,
        passCount: fireChecks.filter((c) => c.status === 'pass').length,
        warningCount: fireChecks.filter((c) => c.status === 'warning').length,
        failCount: fireChecks.filter((c) => c.status === 'fail').length,
      };
    },
  },

  // ---- 工具 4: 造价估算 ----
  {
    name: 'estimate_cost',
    description: '结构主体造价估算（元/㎡），按结构体系基准造价 + 设防烈度修正 + 高度修正 + 场地修正 + 跨度修正。基准数据来源于国内常规建安工程经验指标。',
    parameters: {
      type: 'object',
      properties: {
        systemId: { type: 'string', description: '结构体系 ID' },
        floors: { type: 'number', description: '建筑层数' },
        seismicIntensity: { type: 'string', description: '设防烈度：6/7/8/9' },
        soilCategory: { type: 'string', description: '场地土类别' },
        mainSpan: { type: 'number', description: '主要跨度（米）' },
      },
      required: ['systemId', 'floors', 'seismicIntensity'],
    },
    allowedAgents: ['economist', 'chief'],
    executor: (args: Record<string, unknown>) => {
      const systemId = args.systemId as string;
      const floors = Number(args.floors) || 10;
      const intensity = (args.seismicIntensity as string) || '7';
      const soilCategory = (args.soilCategory as string) || 'Ⅱ';
      const mainSpan = Number(args.mainSpan) || 8;
      const cost = estimateCost(systemId, floors, intensity, soilCategory, mainSpan);
      const scheme = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === systemId);
      return {
        systemId,
        systemName: scheme?.name || systemId,
        costPerSqm: cost,
        unit: '元/㎡',
        calculationBasis: {
          baseCost: '按结构体系基准造价（10层、7度、Ⅱ类场地基准）',
          adjustments: [
            floors > 10 ? `高度修正 +${((floors - 10) * 0.5).toFixed(1)}%` : floors < 5 ? '低层优惠 -8%' : '无高度修正',
            `烈度修正：每度约+9%（${intensity}度相对7度）`,
            soilCategory !== 'Ⅱ' ? `场地修正：${soilCategory}类` : '场地修正：Ⅱ类（基准）',
            mainSpan > 8 ? `跨度修正：主跨${mainSpan}m，每米+1.5%` : '跨度修正：8m基准',
          ],
        },
      };
    },
  },

  // ---- 工具 5: 工期估算 ----
  {
    name: 'estimate_schedule',
    description: '工期估算（月），采用基础+主体+装修三段动态模型。主体工期按结构体系月施工面积效率推算，考虑层数、单层面积、流水施工效率。钢结构/装配式比现浇快 25-35%。',
    parameters: {
      type: 'object',
      properties: {
        systemId: { type: 'string', description: '结构体系 ID' },
        area: { type: 'number', description: '建筑面积（㎡）' },
        floors: { type: 'number', description: '建筑层数' },
      },
      required: ['systemId', 'area', 'floors'],
    },
    allowedAgents: ['economist', 'chief'],
    executor: (args: Record<string, unknown>) => {
      const systemId = args.systemId as string;
      const area = Number(args.area) || 5000;
      const floors = Number(args.floors) || 10;
      const months = estimateDuration(systemId, area, floors);
      const scheme = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === systemId);
      return {
        systemId,
        systemName: scheme?.name || systemId,
        totalMonths: months,
        unit: '月',
        breakdown: {
          foundation: '1.5-6个月（按层数递增）',
          superstructure: '按施工面积效率推算',
          fitout: '1-3.5个月（按建筑面积）',
        },
        note: '不含前期报建及室外工程，仅为结构主体+装修估算工期',
      };
    },
  },

  // ---- 工具 6: 装配率估算 ----
  {
    name: 'estimate_precast_rate',
    description: '装配率估算，按 GB/T 51129-2017《装配式建筑评价标准》分级：AAA级(≥91%) / AA级(≥76%) / A级(≥60%) / 基本级(≥50%) / 未达标(<50%)。',
    parameters: {
      type: 'object',
      properties: {
        systemId: { type: 'string', description: '结构体系 ID' },
        floors: { type: 'number', description: '建筑层数，影响装配率修正' },
      },
      required: ['systemId'],
    },
    allowedAgents: ['economist'],
    executor: (args: Record<string, unknown>) => {
      const systemId = args.systemId as string;
      const floors = Number(args.floors) || 10;
      const result = estimatePrecastRate(systemId, floors);
      const scheme = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === systemId);
      return {
        systemId,
        systemName: scheme?.name || systemId,
        precastRate: result.rate,
        grade: result.grade,
        gradeCode: result.gradeCode,
        standard: 'GB/T 51129-2017《装配式建筑评价标准》',
      };
    },
  },

  // ---- 工具 7: 碳排放估算 ----
  {
    name: 'estimate_carbon',
    description: '结构主体隐含碳排放估算（kgCO₂/㎡），基于中国生命周期基础数据库（CLCD）经验值，含建材生产+运输+施工阶段，不含运营阶段。',
    parameters: {
      type: 'object',
      properties: {
        systemId: { type: 'string', description: '结构体系 ID' },
        floors: { type: 'number', description: '建筑层数' },
      },
      required: ['systemId', 'floors'],
    },
    allowedAgents: ['economist'],
    executor: (args: Record<string, unknown>) => {
      const systemId = args.systemId as string;
      const floors = Number(args.floors) || 10;
      const carbon = estimateCarbonEmission(systemId, floors);
      const scheme = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === systemId);
      return {
        systemId,
        systemName: scheme?.name || systemId,
        carbonPerSqm: carbon,
        unit: 'kgCO₂/㎡',
        scope: '建材生产 + 运输 + 施工阶段（隐含碳）',
        note: '不含运营阶段碳排放（采暖/空调/照明等）',
      };
    },
  },

  // ---- 工具 8: 施工风险与难度评估 ----
  {
    name: 'assess_construction_risk',
    description: '施工风险与难度评估：按结构体系给出施工主要风险点清单和风险等级（low/medium/high），含高空作业、起重吊装、焊接作业、大体积混凝土等风险因子。',
    parameters: {
      type: 'object',
      properties: {
        systemId: { type: 'string', description: '结构体系 ID' },
        floors: { type: 'number', description: '建筑层数' },
      },
      required: ['systemId', 'floors'],
    },
    allowedAgents: ['economist', 'code'],
    executor: (args: Record<string, unknown>) => {
      const systemId = args.systemId as string;
      const floors = Number(args.floors) || 10;
      const risk = estimateConstructionRisk(systemId, floors);
      const scheme = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === systemId);
      return {
        systemId,
        systemName: scheme?.name || systemId,
        riskLevel: risk.level,
        riskLevelLabel: risk.level === 'low' ? '低风险' : risk.level === 'medium' ? '中等风险' : '高风险',
        riskFactors: risk.notes,
        mitigation: risk.level === 'high'
          ? '建议制定专项施工方案，加强安全管理，关键工序实行旁站监理'
          : risk.level === 'medium'
            ? '按常规施工安全管理体系执行，重点关注高处作业和起重吊装'
            : '常规安全管理即可满足要求',
      };
    },
  },

  // ---- 工具 9: 基础方案建议 ----
  {
    name: 'advise_foundation',
    description: '基础方案建议：根据上部结构体系、地质条件（含湿陷性黄土等特殊场地）、建筑高度，推荐适用的基础形式及注意事项。',
    parameters: {
      type: 'object',
      properties: {
        systemId: { type: 'string', description: '上部结构体系 ID' },
        geologyType: {
          type: 'string',
          description: '地质类型：rock（岩石）/ clay（一般黏土）/ loess（湿陷性黄土）/ fill（填土）/ sand（砂土）',
          enum: ['rock', 'clay', 'loess', 'fill', 'sand'],
        },
        floors: { type: 'number', description: '建筑层数' },
        soilCategory: { type: 'string', description: '场地土类别' },
      },
      required: ['systemId', 'geologyType', 'floors'],
    },
    allowedAgents: ['architect', 'code', 'chief'],
    executor: (args: Record<string, unknown>) => {
      const systemId = args.systemId as string;
      const geologyType = args.geologyType as string;
      const floors = Number(args.floors) || 10;
      const soilCategory = (args.soilCategory as string) || 'Ⅱ';
      const result: IFoundationSuggestion = suggestFoundation(systemId, geologyType, floors, soilCategory);
      const scheme = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === systemId);
      return {
        systemId,
        systemName: scheme?.name || systemId,
        geologyType,
        foundationType: result.foundationType,
        reason: result.reason,
        notes: result.notes,
      };
    },
  },

  // ---- 工具 10: 材料用量估算（混凝土+钢筋） ----
  {
    name: 'estimate_material_use',
    description: '结构主体材料用量概念估算：混凝土用量（m³/㎡）和用钢量/含钢量（kg/㎡）。按结构体系给出概念区间，并考虑设防烈度修正。标注：概念估算，需专业软件复核。',
    parameters: {
      type: 'object',
      properties: {
        systemId: { type: 'string', description: '结构体系 ID' },
        floors: { type: 'number', description: '建筑层数' },
        seismicIntensity: { type: 'string', description: '设防烈度：6/7/8/9' },
        buildingType: { type: 'string', description: '建筑类型' },
      },
      required: ['systemId', 'floors', 'seismicIntensity'],
    },
    allowedAgents: ['economist', 'architect', 'code', 'chief'],
    executor: (args: Record<string, unknown>) => {
      const systemId = args.systemId as string;
      const floors = Number(args.floors) || 10;
      const intensity = Number(args.seismicIntensity) || 7;
      const buildingType = (args.buildingType as string) || 'residential';
      const scheme = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === systemId);
      const height = calculateBuildingHeight(floors);

      // 各体系混凝土用量基准（m³/㎡，10层、7度基准）
      const concreteBase: Record<string, { low: number; high: number }> = {
        frame: { low: 0.35, high: 0.5 },
        'frame-shearwall': { low: 0.45, high: 0.6 },
        shearwall: { low: 0.5, high: 0.7 },
        steel: { low: 0.15, high: 0.25 },
        prefabricated: { low: 0.4, high: 0.55 },
        'prefab-steel': { low: 0.12, high: 0.22 },
        composite: { low: 0.3, high: 0.45 },
        masonry: { low: 0.25, high: 0.35 },
        'frame-corewall': { low: 0.5, high: 0.65 },
        'tube-in-tube': { low: 0.55, high: 0.75 },
        'mass-timber': { low: 0.05, high: 0.12 },
        'space-truss': { low: 0.1, high: 0.2 },
      };

      // 各体系用钢量基准（kg/㎡，10层、7度基准）
      const steelBase: Record<string, { low: number; high: number }> = {
        frame: { low: 40, high: 55 },
        'frame-shearwall': { low: 50, high: 65 },
        shearwall: { low: 45, high: 60 },
        steel: { low: 60, high: 100 },
        prefabricated: { low: 55, high: 75 },
        'prefab-steel': { low: 65, high: 110 },
        composite: { low: 80, high: 120 },
        masonry: { low: 10, high: 20 },
        'frame-corewall': { low: 55, high: 75 },
        'tube-in-tube': { low: 60, high: 85 },
        'mass-timber': { low: 5, high: 12 },
        'space-truss': { low: 25, high: 45 },
      };

      const concreteRange = concreteBase[systemId] || concreteBase.frame;
      const steelRange = steelBase[systemId] || steelBase.frame;

      // 烈度修正：每度±5%（材料用量对烈度不如造价敏感）
      const intensityFactor = 1 + (intensity - 7) * 0.05;
      // 高度修正：每10层 +3%（高层底部墙柱截面加大）
      const heightFactor = 1 + Math.max(0, (height - 30) / 10) * 0.03;

      const concreteLow = (concreteRange.low * intensityFactor * heightFactor).toFixed(2);
      const concreteHigh = (concreteRange.high * intensityFactor * heightFactor).toFixed(2);
      const steelLow = Math.round(steelRange.low * intensityFactor * heightFactor);
      const steelHigh = Math.round(steelRange.high * intensityFactor * heightFactor);

      return {
        systemId,
        systemName: scheme?.name || systemId,
        buildingType,
        concretePerSqm: {
          low: Number(concreteLow),
          high: Number(concreteHigh),
          unit: 'm³/㎡',
          note: '含楼板、梁、柱、墙等主体结构混凝土，不含基础、二次结构',
        },
        steelPerSqm: {
          low: steelLow,
          high: steelHigh,
          unit: 'kg/㎡',
          note: ['steel', 'prefab-steel', 'space-truss'].includes(systemId) ? '型钢用量，不含楼板钢筋' : '含普通钢筋（受力筋+箍筋+分布筋），不含预应力筋',
        },
        calculationBasis: {
          base: `${scheme?.name || systemId}体系基准区间（10层、7度、住宅类）`,
          adjustments: [
            `烈度修正：${intensity}度，系数 ${intensityFactor.toFixed(2)}（每度±5%）`,
            `高度修正：约 ${height}m，系数 ${heightFactor.toFixed(2)}（每10m +3%）`,
          ],
        },
        disclaimer: '方案阶段量级估算，仅供概念比选用；实际含钢量受柱网布置、抗震等级、荷载标准等因素影响，±15%均属正常范围，需专业结构计算软件复核。',
      };
    },
  },

  // ---- 工具 11: 构件截面估算（柱截面+梁高） ----
  {
    name: 'estimate_column_beam',
    description: '典型构件截面概念估算：柱截面尺寸（mm）和主梁梁高（mm）。梁高按跨度 1/12~1/18 估算；柱截面按层数、轴压比、设防烈度给概念区间。标注：概念估算，需专业软件复核。',
    parameters: {
      type: 'object',
      properties: {
        systemId: { type: 'string', description: '结构体系 ID' },
        span: { type: 'number', description: '主要跨度（米）' },
        floors: { type: 'number', description: '建筑层数' },
        seismicIntensity: { type: 'string', description: '设防烈度：6/7/8/9' },
        soilCategory: { type: 'string', description: '场地土类别' },
      },
      required: ['systemId', 'span', 'floors', 'seismicIntensity'],
    },
    allowedAgents: ['architect', 'code', 'chief'],
    executor: (args: Record<string, unknown>) => {
      const systemId = args.systemId as string;
      const span = Number(args.span) || 8;
      const floors = Number(args.floors) || 10;
      const intensity = Number(args.seismicIntensity) || 7;
      const scheme = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === systemId);

      // 梁高估算：跨度 1/12~1/18，按体系调整
      // 框架梁：1/10~1/14；框剪梁：1/12~1/16；剪力墙连梁：1/8~1/12；钢梁：1/18~1/24
      let beamRatioLow = 1 / 12;
      let beamRatioHigh = 1 / 18;
      let beamUnit = 'mm';

      if (systemId === 'frame') {
        beamRatioLow = 1 / 10;
        beamRatioHigh = 1 / 14;
      } else if (systemId === 'shearwall' || systemId === 'tube-in-tube') {
        // 连梁较深
        beamRatioLow = 1 / 8;
        beamRatioHigh = 1 / 12;
      } else if (systemId === 'steel' || systemId === 'prefab-steel' || systemId === 'space-truss') {
        // 钢梁高跨比更小
        beamRatioLow = 1 / 18;
        beamRatioHigh = 1 / 24;
      } else if (systemId === 'composite') {
        beamRatioLow = 1 / 15;
        beamRatioHigh = 1 / 20;
      } else if (systemId === 'masonry') {
        // 砌体过梁/圈梁
        beamRatioLow = 1 / 12;
        beamRatioHigh = 1 / 16;
      }

      const beamLow = Math.round((span * 1000) * beamRatioHigh); // ratioHigh = 分母大 = 梁矮 = 小值
      const beamHigh = Math.round((span * 1000) * beamRatioLow);  // ratioLow = 分母小 = 梁高 = 大值

      // 柱截面估算：按层数+烈度估算（混凝土柱）
      // 经验：每10层约 100mm 增量 + 烈度修正
      // 框架柱偏大，剪力墙端柱/暗柱偏小
      let colSizeBase = 0;
      let colSizeUnit = 'mm';

      if (systemId.includes('steel') || systemId === 'space-truss') {
        // 钢柱：箱形/工形截面，按层数估算截面高度
        colSizeBase = 200 + floors * 15; // 300~800mm 范围
        const colLow = Math.max(200, Math.round(colSizeBase * 0.8));
        const colHigh = Math.round(colSizeBase * 1.15);
        return {
          systemId,
          systemName: scheme?.name || systemId,
          span,
          floors,
          beam: {
            range: `${beamLow}~${beamHigh}`,
            unit: beamUnit,
            description: `主梁梁高（钢梁高跨比约 1/18~1/24），梁宽约为高度的 1/2~1/3`,
          },
          column: {
            range: `H${colLow}×${colLow}~H${colHigh}×${colHigh}`,
            unit: colSizeUnit,
            description: '钢柱截面估算（箱形或H形），具体尺寸需根据轴压比和长细比计算',
          },
          disclaimer: '方案阶段量级估算，仅供空间占位和造价估算参考。需专业结构计算软件（PKPM/YJK/SAUSAGE 等）按实际荷载和抗震等级分析确定。',
        };
      }

      // 混凝土柱/墙截面估算
      // 轴压比控制：底部加强部位估算，按层数线性增加截面边长
      // 10层约 400mm，20层约 600mm，30层约 800mm，每度+10%
      const intensityFactor = 1 + (intensity - 7) * 0.1;
      let colEdge = 300 + floors * 15; // mm，基础值
      colEdge = Math.round(colEdge * intensityFactor);

      // 按体系调整
      if (systemId === 'shearwall' || systemId === 'tube-in-tube') {
        // 剪力墙以墙肢为主，端柱约同框架柱或更大；暗柱 200~300mm
        colEdge = Math.round(colEdge * 1.1);
      }
      if (systemId === 'masonry') {
        // 砌体构造柱很小，承重墙厚为主
        const wallThickness = floors <= 6 ? 240 : 370;
        return {
          systemId,
          systemName: scheme?.name || systemId,
          span,
          floors,
          beam: {
            range: `${beamLow}~${beamHigh}`,
            unit: beamUnit,
            description: '圈梁/过梁高度',
          },
          column: {
            range: `墙厚 ${wallThickness}mm，构造柱 240×240`,
            unit: colSizeUnit,
            description: '砌体结构以承重墙为主，构造柱仅做抗震措施，截面较小',
          },
          disclaimer: '方案阶段量级估算。砌体结构需符合 GB 55007-2021《砌体结构通用规范》。',
        };
      }

      const colLow = Math.round(colEdge * 0.85);
      const colHigh = Math.round(colEdge * 1.15);

      return {
        systemId,
        systemName: scheme?.name || systemId,
        span,
        floors,
        beam: {
          range: `${beamLow}~${beamHigh}`,
          unit: beamUnit,
          description: `主梁梁高（高跨比约 ${(1/beamRatioLow).toFixed(0)}~${(1/beamRatioHigh).toFixed(0)}分之一），梁宽约为高度的 1/2~2/3`,
        },
        column: {
          range: `${colLow}×${colLow}~${colHigh}×${colHigh}`,
          unit: colSizeUnit,
          description: `框架柱/端柱截面估算（正方形），截面按 ${intensity}度设防、约 ${floors} 层估算，底部加强区偏大、上部楼层可递减`,
        },
        calculationBasis: {
          formula: '柱边长 ≈ (300 + 层数×15) × 烈度修正系数',
          beamFormula: `梁高 ≈ 跨度 × 高跨比 (${(1/beamRatioHigh).toFixed(0)}~${(1/beamRatioLow).toFixed(0)}分之一)`,
          notes: [
            '柱截面按底部加强部位估算，以上各层可逐级收窄',
            '轴压比控制是柱截面主要控制因素，抗震等级每提高一级截面约增大 10%',
          ],
        },
        disclaimer: '方案阶段量级估算，仅供空间占位和造价估算参考。实际截面需根据轴压比、剪压比、延性要求等按规范计算确定。',
      };
    },
  },

  // ---- 工具 12: 综合对比评分 ----
  {
    name: 'compare_schemes',
    description: '四维权重（性能/经济/绿色低碳/安全）综合对比评分，对多个候选方案进行加权计算并排序，返回排序结果、分项得分、推荐方案。',
    parameters: {
      type: 'object',
      properties: {
        schemeIds: {
          type: 'array',
          description: '待对比的结构体系 ID 列表',
          items: { type: 'string' },
        },
        params: {
          type: 'object',
          description: '工程参数（用于估算各方案指标）。缺失字段按常规默认值补齐，已提供字段一律照收',
          properties: { ...PROJECT_PARAMS_SCHEMA },
          required: ['buildingType', 'floors', 'seismicIntensity'],
        },
        weights: {
          type: 'object',
          description: '四维权重配置（四项之和应为100）',
          properties: {
            cost: { type: 'number', description: '造价经济权重（%）' },
            duration: { type: 'number', description: '工期权重（%）' },
            safety: { type: 'number', description: '安全抗震权重（%）' },
            green: { type: 'number', description: '绿色低碳权重（%）' },
          },
          required: ['cost', 'duration', 'safety', 'green'],
        },
      },
      required: ['schemeIds', 'params', 'weights'],
    },
    allowedAgents: ['chief'],
    executor: (args: Record<string, unknown>) => {
      const schemeIds = args.schemeIds as string[];
      const p = args.params as Record<string, unknown>;
      const w = args.weights as Record<string, number>;

      // P0-3：与 check_seismic_requirements / query_structure_systems 共用同一归一化入口，
      // 保证三个环节看到的是同一组工程参数（候选池、指标、判定结论不再分裂）。
      const params: IProjectParams = normalizeToolParams(p);

      // 生成完整方案数据用于评分
      const allSchemes = generateSchemesFromParams(params);
      const filtered = allSchemes.filter((s) => schemeIds.includes(s.id));

      // P0-2：旧实现在 ID 全部无效时静默改为「比全部方案」，会给出看似合理的错误结论。
      // 现改为显式报错并回传已知 ID，让总工 Agent 自行纠正后重试。
      if (filtered.length === 0) {
        return {
          error: `待对比的方案 ID 均无效：${JSON.stringify(schemeIds)}`,
          knownSystemIds: listKnownSystemIds(),
          hint: '请使用候选方案列表中出现的 ID 重试',
          ranking: [],
          recommended: { schemeId: '', schemeName: '', overallScore: 0 },
        };
      }
      // 部分无效：只比有效的，并如实告知被忽略的 ID
      const ignoredIds = schemeIds.filter((id) => !filtered.some((s) => s.id === id));
      const schemes = filtered;

      const weightTotal = (w.cost || 0) + (w.duration || 0) + (w.safety || 0) + (w.green || 0) || 100;

      // 统一评分口径：使用固定参考范围归一化（与前端、优化器一致），
      // 保证同一方案在任何调用方得到同一分数
      const results = schemes.map((s) => {
        const b = computeSchemeScore(s, {
          cost: w.cost || 0,
          duration: w.duration || 0,
          safety: w.safety || 0,
          green: w.green || 0,
        });

        return {
          schemeId: s.id,
          schemeName: s.name,
          score: b.overall,
          breakdown: {
            造价经济: b.cost,
            工期优势: b.duration,
            安全抗震: b.safety,
            绿色低碳: b.green,
            抗震性能: b.seismic,
            施工难度: b.difficulty,
            可持续性: b.sustain,
            碳排放: b.carbon,
            装配率: b.precast,
            综合性能: b.performance,
          },
          metrics: {
            cost: s.metrics.cost,
            duration: s.metrics.duration,
            seismicPerformance: s.metrics.seismicPerformance,
            constructionDifficulty: s.metrics.constructionDifficulty,
            sustainability: s.metrics.sustainability,
            carbonEmission: s.metrics.carbonEmission,
            precastRate: s.metrics.precastRate.rate,
          },
        };
      });

       results.sort((a, b) => b.score - a.score);

       // 注：高烈度高层住宅场景的「抗震墙体系侧向刚度控制加分」曾在此处硬编码 +1.2，
       // 现已统一由 domain-adjustments.ts 声明、在 computeSchemeScore 内应用，
       // 保证总工排序分 / 方案卡片分 / 优化器分三者口径一致。

       return {
        ranking: results,
        weights: w,
        weightTotal,
        ...(ignoredIds.length > 0 ? { ignoredIds, warning: `已忽略无效方案 ID：${ignoredIds.join('、')}` } : {}),
        recommended: {
          schemeId: results[0]?.schemeId || '',
          schemeName: results[0]?.schemeName || '',
          overallScore: results[0]?.score || 0,
        },
      };
    },
  },
];

// ============ 工具执行入口 ============

/** 按工具名执行，结果为 Promise（兼容异步） */
export function executeToolByName(name: string, args: Record<string, unknown>): unknown {
  const tool = TOOL_REGISTRY.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return tool.executor(args);
}

/** 取工具定义列表（供 LLM function calling 使用） */
export function getToolDefinitions(): IToolDefinition[] {
  return TOOL_REGISTRY.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));
}

/** 取某个工具的定义 */
export function getToolDefinition(name: string): IRegisteredTool | undefined {
  return TOOL_REGISTRY.find((t) => t.name === name);
}

/** 取某个子 Agent 允许使用的工具列表 */
export function getToolsForAgent(agentId: string): IRegisteredTool[] {
  return TOOL_REGISTRY.filter((t) => t.allowedAgents.includes(agentId));
}
