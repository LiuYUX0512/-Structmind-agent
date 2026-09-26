// 结构建模文件导出（PKPM/YJK 前哨 · 占位对接）
// 定位：不声称与商业软件二进制兼容，而是导出"标准化结构建模交换格式（JSON + 文本）"，
// 作为 PKPM / YJK 等专业软件的模型导入前哨 —— 答辩话术："我们不是替代 PKPM，我们是 PKPM 的智能前端"
// 数据来源：项目参数（IProjectParams）+ 推荐方案（IStructureScheme）+ 构件截面工具（estimate_column_beam）
// EXPORTS: buildModelDefinition, serializeModelJson, serializeModelText, buildImportGuide, downloadModelFiles

import type { IProjectParams, IStructureScheme } from '@/data/structure';
import { STRUCTURE_SYSTEM_LIBRARY } from '@/data/structure';
import { executeToolByName } from '@/agent/tools';

/** 建筑几何推导（与 3D 可视化同源逻辑：层高/柱网/跨数） */
export interface ISmGeometry {
  floorHeight: number;
  gridX: number;
  gridZ: number;
  baysX: number;
  baysZ: number;
  totalWidth: number;
  totalDepth: number;
  totalHeight: number;
}

function deriveGeometry(params: IProjectParams): ISmGeometry {
  const { floors, area, buildingType, mainSpan } = params;
  const floorHeightMap: Record<string, number> = {
    residential: 3.0,
    office: 3.6,
    school: 3.9,
    factory: 4.5,
    gymnasium: 6.0,
  };
  const floorHeight = floorHeightMap[buildingType] ?? 3.3;
  const gridMap: Record<string, number> = {
    residential: mainSpan || 8,
    office: mainSpan || 8.4,
    school: mainSpan || 7.5,
    factory: mainSpan || 12,
    gymnasium: mainSpan || 15,
  };
  const gridX = gridMap[buildingType] ?? 8;
  const gridZ = gridX * 0.8;
  const floorArea = area / Math.max(floors, 1);
  const ratio = gridX / gridZ;
  const baysX = Math.max(2, Math.round(Math.sqrt(floorArea * ratio) / gridX));
  const baysZ = Math.max(2, Math.round(Math.sqrt(floorArea / ratio) / gridZ));
  return {
    floorHeight,
    gridX,
    gridZ,
    baysX,
    baysZ,
    totalWidth: baysX * gridX,
    totalDepth: baysZ * gridZ,
    totalHeight: floors * floorHeight,
  };
}

/** 从 estimate_column_beam 工具输出解析代表截面（取区间中值，格式鲁棒） */
function parseSections(schemeId: string, params: IProjectParams): {
  beam: { width: number; height: number };
  column: { width: number; depth: number; shape: string };
  beamRange: string;
  columnRange: string;
  note: string;
} {
  const toolResult = executeToolByName('estimate_column_beam', {
    systemId: schemeId,
    span: params.mainSpan,
    floors: params.floors,
    seismicIntensity: params.seismicIntensity,
    soilCategory: params.soilCategory,
  }) as {
    beam: { range: string; unit: string; description: string };
    column: { range: string; unit: string; description: string };
    disclaimer?: string;
  };

  const beamRange = toolResult?.beam?.range || '600';
  const columnRange = toolResult?.column?.range || '400×400';
  const note = toolResult?.disclaimer || '方案阶段量级估算，需专业软件复核';

  // 梁高：取区间中值（"500~700" → 600），梁宽 ≈ 高的 1/2.5（混凝土梁）
  const beamNums = (beamRange.match(/\d+/g) || []).map(Number);
  const beamHeight = beamNums.length > 0
    ? Math.round(beamNums.reduce((a, b) => a + b, 0) / beamNums.length)
    : 600;
  const beamWidth = Math.round(beamHeight / 2.5 / 50) * 50 || 250;

  // 柱截面：支持 "400×400~460×460"、"H300×300~H345×345"、"墙厚 240mm，构造柱 240×240"
  const isSteelColumn = /^H/.test(columnRange.trim()) || schemeId === 'steel' || schemeId === 'prefab-steel' || schemeId === 'space-truss';
  const colNums = (columnRange.match(/\d+/g) || []).map(Number);
  const representative =
    colNums.length > 0
      ? Math.round(colNums.reduce((a, b) => a + b, 0) / colNums.length / 10) * 10
      : 400;
  const colSize = Math.max(200, representative);

  if (/墙厚/.test(columnRange)) {
    // 砌体/墙体系：以墙厚为主，柱按构造
    const wallThickness = colNums[0] || 240;
    return {
      beam: { width: beamWidth, height: beamHeight },
      column: { width: wallThickness, depth: wallThickness, shape: '构造柱' },
      beamRange,
      columnRange,
      note,
    };
  }

  return {
    beam: { width: beamWidth, height: beamHeight },
    column: { width: colSize, depth: colSize, shape: isSteelColumn ? '钢柱（箱形/H形）' : '混凝土柱（正方形）' },
    beamRange,
    columnRange,
    note,
  };
}

/** 模型定义（标准化结构建模交换格式 v1） */
export interface ISmModelDefinition {
  format: 'structmind-sm-v1';
  generatedAt: string;
  project: {
    buildingType: string;
    floors: number;
    area: number;
    mainSpan: number;
    seismicIntensity: string;
    fortificationCategory?: string;
    soilCategory: string;
    windPressure?: string;
    snowPressure?: string;
  };
  scheme: { id: string; name: string; description: string };
  grid: ISmGeometry & { baysX: number; baysZ: number };
  axes: Array<{ id: string; direction: 'X' | 'Z'; coordinate: number }>;
  floorLevels: Array<{ level: number; elevation: number }>;
  members: {
    columns: Array<{ id: string; gridX: number; gridZ: number; section: string; shape: string }>;
    beams: Array<{ id: string; axis: string; span: number; section: string }>;
  };
  material: { concreteGrade: string; steelGrade: string; note: string };
  code: { applicable: string[]; note: string };
  caveat: string;
}

const BUILDING_TYPE_LABEL: Record<string, string> = {
  residential: '住宅建筑',
  office: '办公建筑',
  school: '教学建筑',
  factory: '工业厂房',
  gymnasium: '大跨度建筑',
};

/** 依据项目参数 + 推荐方案构建模型定义 */
export function buildModelDefinition(params: IProjectParams, scheme: IStructureScheme): ISmModelDefinition {
  const g = deriveGeometry(params);
  const sections = parseSections(scheme.id, params);

  // 轴线：X 向 baysX+1 条（沿 Z 深向布置）、Z 向 baysZ+1 条
  const axesX: ISmModelDefinition['axes'] = [];
  for (let i = 0; i <= g.baysX; i++) {
    axesX.push({ id: `X${i + 1}`, direction: 'Z', coordinate: Math.round(i * g.gridX * 100) / 100 });
  }
  const axesZ: ISmModelDefinition['axes'] = [];
  for (let j = 0; j <= g.baysZ; j++) {
    axesZ.push({ id: `Z${j + 1}`, direction: 'X', coordinate: Math.round(j * g.gridZ * 100) / 100 });
  }

  // 楼层标高表
  const floorLevels: ISmModelDefinition['floorLevels'] = [];
  for (let f = 1; f <= params.floors; f++) {
    floorLevels.push({ level: f, elevation: Math.round(f * g.floorHeight * 100) / 100 });
  }

  // 柱表：X 轴线与 Z 轴线交点
  const columns: ISmModelDefinition['members']['columns'] = [];
  for (let i = 0; i <= g.baysX; i++) {
    for (let j = 0; j <= g.baysZ; j++) {
      columns.push({
        id: `C${i + 1}-${j + 1}`,
        gridX: Math.round(i * g.gridX * 100) / 100,
        gridZ: Math.round(j * g.gridZ * 100) / 100,
        section: `${sections.column.width}×${sections.column.depth}`,
        shape: sections.column.shape,
      });
    }
  }

  // 梁表：X 向主梁（沿 Z 轴线方向，跨度 gridX）+ Z 向次梁（跨度 gridZ）
  const beams: ISmModelDefinition['members']['beams'] = [];
  for (let j = 0; j <= g.baysZ; j++) {
    for (let i = 0; i < g.baysX; i++) {
      beams.push({
        id: `BZ${j + 1}-${i + 1}`,
        axis: `Z${j + 1}`,
        span: g.gridX,
        section: `${sections.beam.width}×${sections.beam.height}`,
      });
    }
  }
  for (let i = 0; i <= g.baysX; i++) {
    for (let j = 0; j < g.baysZ; j++) {
      beams.push({
        id: `BX${i + 1}-${j + 1}`,
        axis: `X${i + 1}`,
        span: g.gridZ,
        section: `${sections.beam.width}×${sections.beam.height}`,
      });
    }
  }

  return {
    format: 'structmind-sm-v1',
    generatedAt: new Date().toISOString(),
    project: {
      buildingType: BUILDING_TYPE_LABEL[params.buildingType] || params.buildingType,
      floors: params.floors,
      area: params.area,
      mainSpan: params.mainSpan,
      seismicIntensity: params.seismicIntensity,
      fortificationCategory: params.fortificationCategory,
      soilCategory: params.soilCategory,
      windPressure: params.windPressure,
      snowPressure: params.snowPressure,
    },
    scheme: {
      id: scheme.id,
      name: scheme.name,
      description: scheme.description,
    },
    grid: { ...g, baysX: g.baysX, baysZ: g.baysZ },
    axes: [...axesX, ...axesZ],
    floorLevels,
    members: { columns, beams },
    material: {
      concreteGrade: 'C30（常规）~C40（底部加强区，方案阶段默认 C30）',
      steelGrade: scheme.id.includes('steel') ? 'Q355B（主材）' : 'HRB400（钢筋）',
      note: '材料等级为方案阶段默认，正式设计由专业工程师按计算确定',
    },
    code: {
      applicable: ['GB 55002-2021', 'GB/T 50011-2010(2024年版)', 'GB 50010-2010(2024年版)'],
      note: `设防烈度 ${params.seismicIntensity} 度，${BUILDING_TYPE_LABEL[params.buildingType] || '建筑'}，抗震等级与构造措施按规范查表确定`,
    },
    caveat: `构件截面为方案阶段量级估算（${sections.beamRange} / ${sections.columnRange}），仅用于初步建模占位；正式模型须在 PKPM/YJK 中按实际荷载与抗震等级重新验算。${sections.note}`,
  };
}

/** JSON 序列化（格式化、UTF-8 无 BOM） */
export function serializeModelJson(model: ISmModelDefinition): string {
  return JSON.stringify(model, null, 2);
}

/** 人读文本（仿 PKPM PM 建模书格式：轴线表 / 层高表 / 柱表 / 梁表） */
export function serializeModelText(model: ISmModelDefinition): string {
  const L: string[] = [];
  L.push('智构 StructMind · 结构建模文件（简化文本版）');
  L.push('格式：structmind-sm-v1 · 生成时间 ' + model.generatedAt);
  L.push('定位：PKPM/YJK 模型导入前哨（占位交换格式，非商业软件原生格式）');
  L.push('');
  L.push('【一、工程概况】');
  L.push(`  建筑类型：${model.project.buildingType}`);
  L.push(`  层数：${model.project.floors} 层 · 总高约 ${model.grid.totalHeight}m · 建筑面积 ${model.project.area} ㎡`);
  L.push(`  设防烈度：${model.project.seismicIntensity} 度 · 场地类别：${model.project.soilCategory} 类`);
  L.push(`  推荐结构体系：${model.scheme.name}`);
  L.push('');
  L.push('【二、轴线网格】');
  L.push(`  开间（X向）：${model.grid.baysX} 跨 × ${model.grid.gridX}m；进深（Z向）：${model.grid.baysZ} 跨 × ${model.grid.gridZ}m`);
  L.push('  轴线编号：');
  L.push(model.axes.map((a) => `    ${a.id}（${a.direction}向 @ ${a.coordinate}m）`).join('\n'));
  L.push('');
  L.push('【三、层高表】');
  L.push('  层号    标高(m)');
  for (const f of model.floorLevels) {
    L.push(`  ${String(f.level).padStart(3)}     ${f.elevation.toFixed(2)}`);
  }
  L.push('');
  L.push('【四、柱截面表】');
  L.push('  柱号      网格位置      截面(mm)    形式');
  for (const c of model.members.columns) {
    L.push(`  ${c.id.padEnd(9)} (${c.gridX}, ${c.gridZ})  ${c.section.padEnd(12)} ${c.shape}`);
  }
  L.push('');
  L.push('【五、梁截面表】');
  L.push('  梁号      所在轴线    跨度(m)    截面(mm)');
  for (const b of model.members.beams) {
    L.push(`  ${b.id.padEnd(10)} ${b.axis.padEnd(8)} ${b.span.toFixed(1).padStart(5)}     ${b.section}`);
  }
  L.push('');
  L.push('【六、材料与规范】');
  L.push(`  混凝土：${model.material.concreteGrade}`);
  L.push(`  钢材：${model.material.steelGrade}`);
  L.push(`  适用规范：${model.code.applicable.join(' / ')}`);
  L.push('');
  L.push('【七、免责声明】');
  L.push('  ' + model.caveat);
  return L.join('\n');
}

/** 导入说明（随文件一并交付，答辩时展示"前哨"定位） */
export function buildImportGuide(model: ISmModelDefinition): string {
  const L: string[] = [];
  L.push('智构 StructMind → PKPM/YJK 模型导入说明');
  L.push('');
  L.push('一、本文件是什么');
  L.push('  · 本文件是"智构StructMind"方案阶段输出的标准化结构建模交换格式（structmind-sm-v1）。');
  L.push('  · 它记录了一次方案比选的核心建模数据：轴线网格、层高、柱截面、梁截面、材料与适用规范。');
  L.push('');
  L.push('二、为什么这样做（我们的定位）');
  L.push('  · 我们不替代 PKPM/YJK —— 我们是它们的"智能前端"。');
  L.push('  · 方案探索阶段（快速试错、多目标寻优）由本系统完成；');
  L.push('  · 施工图设计阶段（荷载详细计算、配筋、出图）由 PKPM/YJK 完成。');
  L.push('  · 本文件就是两个阶段之间的"接力棒"。');
  L.push('');
  L.push('三、如何导入专业软件（占位指引）');
  L.push('  1. 打开 PKPM（PMCAD）或 YJK（YJK-Building），新建工程；');
  L.push('  2. 按"轴线网格"建立轴网（开间/进深与跨数）；');
  L.push('  3. 按"层高表"逐层定义标准层与楼层组装；');
  L.push('  4. 按"柱截面表/梁截面表"定义构件截面并布置；');
  L.push('  5. 设置材料强度等级与抗震等级（烈度/场地/设防类别见工程概况）；');
  L.push('  6. 施加荷载（楼面恒/活载、风荷载、地震作用）后进入 SATWE/YJK-A 计算。');
  L.push('');
  L.push('四、注意事项');
  L.push('  · 本文件不含荷载详细取值与配筋计算，构件截面为方案阶段量级估算；');
  L.push('  · 正式设计必须由持证结构工程师在专业软件中重新验算后出图；');
  L.push('  · 后续可扩展：直接输出 YJK 支持的 XML 交换格式 / PKPM 的 DXF 轴网文件。');
  return L.join('\n');
}

/** 一键下载：模型 JSON + 导入说明（纯前端 Blob，无后端依赖） */
export function downloadModelFiles(params: IProjectParams, scheme: IStructureScheme): { jsonName: string; guideName: string } {
  const model = buildModelDefinition(params, scheme);
  const jsonName = `structmind-${scheme.id}.sm.json`;
  const guideName = `structmind-${scheme.id}-PKPM导入说明.txt`;

  const jsonBlob = new Blob([serializeModelJson(model)], { type: 'application/json;charset=utf-8' });
  const jsonUrl = URL.createObjectURL(jsonBlob);
  const a1 = document.createElement('a');
  a1.href = jsonUrl;
  a1.download = jsonName;
  a1.click();
  URL.revokeObjectURL(jsonUrl);

  const guideBlob = new Blob([buildImportGuide(model)], { type: 'text/plain;charset=utf-8' });
  const guideUrl = URL.createObjectURL(guideBlob);
  const a2 = document.createElement('a');
  a2.href = guideUrl;
  a2.download = guideName;
  a2.click();
  URL.revokeObjectURL(guideUrl);

  return { jsonName, guideName };
}
