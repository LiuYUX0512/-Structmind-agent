// 建筑碳排放四阶段模型（方案阶段简化估算）
// 依据：GB/T 51366-2019《建筑碳排放计算标准》的阶段划分与计算边界
//   - 建材生产阶段（A1-A3）：主体结构材料生产隐含碳
//   - 建材运输阶段（A4）：材料从产地/构件厂运至工地的运输碳
//   - 建造施工阶段（A5）：现场施工机械、能耗产生的碳
//   - 运行阶段（B6）：依赖机电/暖通方案，结构方案阶段不纳入计算（正式核算按标准全生命周期执行）
// 数值来源：CLCD / ICE 等碳排放数据库经验均值（方案阶段量级估算，±15% 属正常范围；
//           正式设计须由专业单位按标准逐项核算，本模块结果仅用于方案比选）
import { estimateCarbonEmission } from './structure';

/** 各结构体系的三阶段占比因子（基于结构材料构成与运输特征的经验估算） */
const STAGE_FACTORS: Record<string, { production: number; transport: number; construction: number }> = {
  // 默认（混凝土类）：材料生产占大头，现场浇筑施工碳较高
  frame: { production: 0.78, transport: 0.07, construction: 0.15 },
  'frame-shearwall': { production: 0.78, transport: 0.07, construction: 0.15 },
  shearwall: { production: 0.8, transport: 0.06, construction: 0.14 },
  'frame-corewall': { production: 0.79, transport: 0.07, construction: 0.14 },
  'tube-in-tube': { production: 0.8, transport: 0.06, construction: 0.14 },
  masonry: { production: 0.74, transport: 0.08, construction: 0.18 },
  composite: { production: 0.78, transport: 0.07, construction: 0.15 },
  // 装配式：工厂预制，运输占比略高、现场施工占比降低
  prefabricated: { production: 0.76, transport: 0.09, construction: 0.15 },
  'prefab-steel': { production: 0.8, transport: 0.09, construction: 0.11 },
  // 钢结构：钢材生产碳高但用量少、可回收；运输占比略高
  steel: { production: 0.82, transport: 0.08, construction: 0.1 },
  'space-truss': { production: 0.82, transport: 0.08, construction: 0.1 },
  // 木结构：木材碳汇属性，生产碳低；运输占比相对突出
  'mass-timber': { production: 0.68, transport: 0.16, construction: 0.16 },
};

/** 碳排放构成（kgCO₂/㎡） */
export interface ICarbonBreakdown {
  /** 建材生产阶段（A1-A3） */
  production: number;
  /** 建材运输阶段（A4） */
  transport: number;
  /** 建造施工阶段（A5） */
  construction: number;
  /** 合计（隐含碳，与 estimateCarbonEmission 一致） */
  total: number;
  /** 同规模常规框架基准值（用于横向对比） */
  baseline: number;
  /** 相对基准值的偏差百分比（负 = 更低碳） */
  vsBaselinePct: number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * 估算某结构体系的碳排放构成（单位面积 kgCO₂/㎡）
 * 注：此为方案阶段简化估算，正式核算须按 GB/T 51366 逐项计算
 */
export function estimateCarbonBreakdown(schemeId: string, floors: number): ICarbonBreakdown {
  const total = estimateCarbonEmission(schemeId, floors);
  const f = STAGE_FACTORS[schemeId] || STAGE_FACTORS.frame;
  const production = round1(total * f.production);
  const transport = round1(total * f.transport);
  const construction = round1(total * f.construction);
  const baseline = estimateCarbonEmission('frame', floors);
  return {
    production,
    transport,
    construction,
    total: round1(total),
    baseline,
    vsBaselinePct: baseline > 0 ? Math.round(((total - baseline) / baseline) * 100) : 0,
  };
}
