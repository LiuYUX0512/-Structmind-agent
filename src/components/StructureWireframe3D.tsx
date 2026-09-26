import { useMemo, useRef, memo, useEffect, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import type { IProjectParams, IStructureScheme } from '@/data/structure';

interface StructureWireframeProps {
  params: IProjectParams;
  scheme?: IStructureScheme | null;
  /** 规范校核结果（方案级：{ schemeId: { seismic: { checks }, fire: { checks } } }），用于违规警示 */
  codeChecks?: Record<string, unknown>;
  /** Hero 待机模式：线框缓慢自转（10s/圈），hover 暂停并高亮顶层柱 */
  autoRotate?: boolean;
}

/**
 * 根据参数推导建筑几何
 */
function deriveGeometry(params: IProjectParams) {
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

  const totalHeight = floors * floorHeight;
  const totalWidth = baysX * gridX;
  const totalDepth = baysZ * gridZ;

  return {
    floorHeight,
    gridX,
    gridZ,
    baysX,
    baysZ,
    totalHeight,
    totalWidth,
    totalDepth,
  };
}

/**
 * 按结构体系分类：柱、梁、剪力墙的分布和强度
 */
function deriveStructureComponents(
  schemeId: string | undefined,
  baysX: number,
  baysZ: number,
  floors: number
) {
  const id = schemeId || '';
  const out = {
    columnDensity: 1,     // 0~1, 柱子疏密程度
    beamDensity: 1,       // 0~1, 梁的疏密
    wallSegments: [] as { x: number; z: number; dir: 'x' | 'z'; length: number; thickness: number }[],
    corewall: null as null | { cx: number; cz: number; w: number; d: number },
    accentColor: '#12A5B5' as string,
    label: '框架结构' as string,
    isMasonry: false,
    isSteel: false,
    showTruss: false,    // 钢结构：顶部桁架
    thickSlab: false,    // 厚板转换（底部加强）
  };

  // ===== 框架结构 =====
  if (id === 'frame' || id.includes('school-frame') || id === 'factory-steel') {
    out.columnDensity = 1;
    out.beamDensity = 1;
    out.label = '框架结构';
    out.accentColor = '#1e4d7b';
    if (id === 'factory-steel') {
      out.isSteel = true;
      out.label = '钢框架结构';
      out.columnDensity = 0.7;
      out.beamDensity = 0.6;
      out.showTruss = true;
      out.accentColor = '#6b7280';
    }
    return out;
  }

  // ===== 框架-剪力墙结构 =====
  if (id === 'frame-shearwall') {
    out.columnDensity = 1;
    out.beamDensity = 1;
    out.label = '框架-剪力墙结构';
    out.accentColor = '#12A5B5';
    // 四周 + 中间几道剪力墙
    const midX = Math.floor(baysX / 2);
    const midZ = Math.floor(baysZ / 2);
    out.wallSegments.push(
      { x: 0, z: 0, dir: 'x', length: 1, thickness: 2 },
      { x: baysX, z: 0, dir: 'x', length: 1, thickness: 2 },
      { x: 0, z: baysZ, dir: 'x', length: 1, thickness: 2 },
      { x: baysX, z: baysZ, dir: 'x', length: 1, thickness: 2 },
      { x: midX, z: 0, dir: 'x', length: 1, thickness: 2 },
      { x: 0, z: midZ, dir: 'z', length: 1, thickness: 2 },
      { x: baysX, z: midZ, dir: 'z', length: 1, thickness: 2 },
    );
    return out;
  }

  // ===== 剪力墙结构 =====
  if (id === 'shearwall') {
    out.columnDensity = 0.2;  // 剪力墙结构柱很少
    out.beamDensity = 0.3;
    out.label = '剪力墙结构';
    out.accentColor = '#E8930C';
    // 密集剪力墙条带
    const spacing = Math.max(1, Math.floor(baysX / 4));
    for (let i = 0; i <= baysX; i += spacing) {
      out.wallSegments.push({ x: i, z: 0, dir: 'z', length: baysZ, thickness: 3 });
    }
    // 横向也加几道
    const zSpacing = Math.max(1, Math.floor(baysZ / 3));
    for (let j = 0; j <= baysZ; j += zSpacing) {
      out.wallSegments.push({ x: 0, z: j, dir: 'x', length: baysX, thickness: 2.5 });
    }
    return out;
  }

  // ===== 框架-核心筒 =====
  if (id === 'frame-corewall') {
    out.columnDensity = 1;
    out.beamDensity = 0.8;
    out.label = '框架-核心筒结构';
    out.accentColor = '#12A5B5';
    // 外围密柱 + 内部核心筒
    const cx = baysX / 2;
    const cz = baysZ / 2;
    const cw = Math.max(1, Math.floor(baysX / 4));
    const cd = Math.max(1, Math.floor(baysZ / 4));
    out.corewall = { cx, cz, w: cw, d: cd };
    return out;
  }

  // ===== 筒中筒 =====
  if (id === 'tube-in-tube') {
    out.columnDensity = 1.3; // 外框筒：柱距更小
    out.beamDensity = 0.8;
    out.label = '筒中筒结构';
    out.accentColor = '#0f4c81';
    const cx = baysX / 2;
    const cz = baysZ / 2;
    const cw = Math.max(1, Math.floor(baysX / 4));
    const cd = Math.max(1, Math.floor(baysZ / 4));
    out.corewall = { cx, cz, w: cw, d: cd };
    // 外筒密柱 - 已通过 columnDensity 控制
    return out;
  }

  // ===== 钢结构 =====
  if (id === 'steel' || id === 'prefab-steel') {
    out.isSteel = true;
    out.columnDensity = 0.7;
    out.beamDensity = 0.6;
    out.label = '钢结构';
    out.accentColor = '#6b7280';
    out.showTruss = true;
    // 大跨度感 - 减小柱密度（上面已设）
    return out;
  }

  // ===== 预制/装配整体式 =====
  if (id === 'prefabricated') {
    out.columnDensity = 1;
    out.beamDensity = 0.9;
    out.label = '装配式结构';
    out.accentColor = '#059669';
    // 加一些装配缝的视觉暗示（用更细的梁来表达）
    return out;
  }

  // ===== 砌体结构 =====
  if (id === 'masonry') {
    out.isMasonry = true;
    out.columnDensity = 0;    // 砌体几乎没有柱
    out.beamDensity = 0.1;
    out.label = '砌体结构';
    out.accentColor = '#b45309';
    // 密密麻麻的横墙
    const spacing = Math.max(1, Math.floor(baysX / 3));
    for (let i = 0; i <= baysX; i += spacing) {
      out.wallSegments.push({ x: i, z: 0, dir: 'z', length: baysZ, thickness: 4 });
    }
    // 纵墙也加
    for (let j = 0; j <= baysZ; j += Math.max(1, Math.floor(baysZ / 4))) {
      out.wallSegments.push({ x: 0, z: j, dir: 'x', length: baysX, thickness: 3 });
    }
    return out;
  }

  // 默认：框架
  out.label = '结构体系';
  return out;
}

/**
 * 纯 SVG 2.5D 线框图（等轴测投影）
 * 根据不同结构体系差异化渲染：梁柱网格、剪力墙、核心筒、桁架 等
 */
function StructureWireframeSVG({ params, scheme, codeChecks, autoRotate }: StructureWireframeProps) {
  const geom = useMemo(() => deriveGeometry(params), [params]);
  const struct = useMemo(
    () => deriveStructureComponents(scheme?.id, geom.baysX, geom.baysZ, params.floors),
    [scheme?.id, geom.baysX, geom.baysZ, params.floors]
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [rotateAngle, setRotateAngle] = useState(-30);
  // ===== 规范校核警示（违规构件可视化：校核未通过/需关注项 → 红色警示 + 条文提示） =====
  const violations = useMemo(() => {
    if (!scheme?.id || !codeChecks) return [];
    const cc = codeChecks[scheme.id] as
      | { seismic?: { checks?: Array<{ name: string; status: string; clauseText?: string }> }; fire?: { checks?: Array<{ item?: string; name?: string; status: string; clauseText?: string }> } }
      | undefined;
    if (!cc) return [];
    const out: Array<{ name: string; clause: string }> = [];
    for (const c of cc.seismic?.checks ?? []) {
      if (c.status === 'fail' || c.status === 'warning') {
        out.push({ name: `[抗震] ${c.name}`, clause: c.clauseText || '' });
      }
    }
    for (const c of cc.fire?.checks ?? []) {
      if (c.status === 'fail' || c.status === 'warning') {
        out.push({ name: `[防火] ${c.item || c.name || ''}`, clause: c.clauseText || '' });
      }
    }
    return out;
  }, [scheme, codeChecks]);
  const [zoom, setZoom] = useState(1);
  const [isDraggingState, setIsDraggingState] = useState(false);
  const animRef = useRef<number | null>(null);
  const lastInteraction = useRef<number>(Date.now());

  // 底部加强区 = 总层数的底部 1/6（至少 1 层）
  const reinforceFloors = useMemo(() => {
    return Math.max(1, Math.floor(params.floors / 6));
  }, [params.floors]);

  // 等轴测投影：3D 坐标 → 2D 屏幕坐标
  // zoomOverride 传入 1 时用于计算"基准包围盒"（忽略用户缩放，保证 viewBox 自适应完整显示）
  const project = useMemo(() => {
    const baseScale = Math.min(
      240 / Math.max(geom.totalWidth, geom.totalDepth),
      200 / geom.totalHeight
    );
    const angleY = (rotateAngle * Math.PI) / 180;
    const tilt = 0.42;

    return (x: number, y: number, z: number, zoomOverride?: number): [number, number] => {
      const scale = baseScale * (zoomOverride ?? zoom);
      const cx = geom.totalWidth / 2;
      const cz = geom.totalDepth / 2;
      const px = x - cx;
      const pz = z - cz;

      const rx = px * Math.cos(angleY) - pz * Math.sin(angleY);
      const rz = px * Math.sin(angleY) + pz * Math.cos(angleY);

      const sx = rx * scale;
      const sy = -y * scale * (1 - tilt * 0.5) + rz * scale * tilt;

      return [sx, sy];
    };
  }, [geom, rotateAngle, zoom]);

  // 自动旋转动画（更慢、更优雅）—— 角度节流：累积到 0.8° 才更新一次，避免每帧全量重算 SVG
  useEffect(() => {
    let last = performance.now();
    let pendingAngle = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      // autoRotate（Hero 待机）：恒定 36°/s = 10s/圈，无空闲门限；hover 或拖拽时暂停
      // 默认模式：停止交互 4 秒后 5°/s 缓转（既有行为）
      const idle = Date.now() - lastInteraction.current;
      const paused = isDragging.current || (autoRotate && autoHoverPaused.current);
      if (!paused && (autoRotate || idle > 4000)) {
        pendingAngle += dt * (autoRotate ? 36 : 5);
        if (Math.abs(pendingAngle) >= 0.8) {
          const delta = pendingAngle;
          pendingAngle = 0;
          setRotateAngle((a) => a + delta);
        }
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  // ===== 拖拽旋转（多重保险：原生 pointer 事件 + setPointerCapture + window 兜底） =====
  const isDragging = useRef(false);
  const autoHoverPaused = useRef(false);
  const lastX = useRef(0);
  const pointerIdRef = useRef<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onDown = (e: PointerEvent) => {
      // 只响应鼠标左键 / 触摸 / 触控笔
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      isDragging.current = true;
      setIsDraggingState(true);
      lastX.current = e.clientX;
      lastInteraction.current = Date.now();
      pointerIdRef.current = e.pointerId;
      // 捕获指针到容器元素
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
    };

    const onMove = (e: PointerEvent) => {
      if (!isDragging.current) return;
      const dx = e.clientX - lastX.current;
      lastX.current = e.clientX;
      setRotateAngle((prev) => prev + dx * 0.4);
      lastInteraction.current = Date.now();
      e.preventDefault();
    };

    const onUp = (e: PointerEvent) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      setIsDraggingState(false);
      lastInteraction.current = Date.now();
      if (pointerIdRef.current != null) {
        try { el.releasePointerCapture(pointerIdRef.current); } catch { /* ignore */ }
      }
      pointerIdRef.current = null;
    };

    const onCancel = (e: PointerEvent) => {
      isDragging.current = false;
      setIsDraggingState(false);
      lastInteraction.current = Date.now();
      if (pointerIdRef.current != null) {
        try { el.releasePointerCapture(pointerIdRef.current); } catch { /* ignore */ }
      }
      pointerIdRef.current = null;
    };

    // ===== window 兜底：在捕获失效的极端情况下依然能收到 move/up =====
    const onWindowMove = (e: PointerEvent) => {
      if (!isDragging.current) return;
      const dx = e.clientX - lastX.current;
      lastX.current = e.clientX;
      setRotateAngle((prev) => prev + dx * 0.4);
      lastInteraction.current = Date.now();
    };
    const onWindowUp = (e: PointerEvent) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      setIsDraggingState(false);
      lastInteraction.current = Date.now();
      if (pointerIdRef.current != null) {
        try { el.releasePointerCapture(pointerIdRef.current); } catch { /* ignore */ }
      }
      pointerIdRef.current = null;
    };

    // ===== 滚轮缩放 =====
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      lastInteraction.current = Date.now();
      setZoom((z) => Math.min(2.4, Math.max(0.55, z * (e.deltaY < 0 ? 1.1 : 0.9))));
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('pointerleave', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });

    // window 兜底
    window.addEventListener('pointermove', onWindowMove, true);
    window.addEventListener('pointerup', onWindowUp, true);
    window.addEventListener('pointercancel', onCancel, true);

    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('pointerleave', onUp);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointermove', onWindowMove, true);
      window.removeEventListener('pointerup', onWindowUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
    };
  }, []);

  // ============ 生成所有 SVG 元素 ============
  const elements: React.ReactNode[] = [];
  let keyCounter = 0;

  const accent = struct.accentColor;
  const secondary = '#94a3b8';

  // ---------- 1. 基础底板（带厚度感） ----------
  {
    const baseExtend = 1.2;
    const topCorners = [
      project(-baseExtend, 0, -baseExtend),
      project(geom.totalWidth + baseExtend, 0, -baseExtend),
      project(geom.totalWidth + baseExtend, 0, geom.totalDepth + baseExtend),
      project(-baseExtend, 0, geom.totalDepth + baseExtend),
    ];
    const botCorners = [
      project(-baseExtend, -0.6, -baseExtend),
      project(geom.totalWidth + baseExtend, -0.6, -baseExtend),
      project(geom.totalWidth + baseExtend, -0.6, geom.totalDepth + baseExtend),
      project(-baseExtend, -0.6, geom.totalDepth + baseExtend),
    ];
    const topD = topCorners.map((c, i) => `${i === 0 ? 'M' : 'L'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ') + ' Z';
    const sideD1 = `M${topCorners[1][0].toFixed(1)},${topCorners[1][1].toFixed(1)} L${botCorners[1][0].toFixed(1)},${botCorners[1][1].toFixed(1)} L${botCorners[2][0].toFixed(1)},${botCorners[2][1].toFixed(1)} L${topCorners[2][0].toFixed(1)},${topCorners[2][1].toFixed(1)} Z`;
    const sideD2 = `M${topCorners[2][0].toFixed(1)},${topCorners[2][1].toFixed(1)} L${botCorners[2][0].toFixed(1)},${botCorners[2][1].toFixed(1)} L${botCorners[3][0].toFixed(1)},${botCorners[3][1].toFixed(1)} L${topCorners[3][0].toFixed(1)},${topCorners[3][1].toFixed(1)} Z`;

    elements.push(<path key={`base-top-${keyCounter++}`} d={topD} fill="rgba(30, 77, 123, 0.12)" stroke="rgba(30, 77, 123, 0.5)" strokeWidth="1" />);
    elements.push(<path key={`base-side1-${keyCounter++}`} d={sideD1} fill="rgba(30, 77, 123, 0.2)" stroke="rgba(30, 77, 123, 0.4)" strokeWidth="0.8" />);
    elements.push(<path key={`base-side2-${keyCounter++}`} d={sideD2} fill="rgba(30, 77, 123, 0.15)" stroke="rgba(30, 77, 123, 0.3)" strokeWidth="0.8" />);
  }

  // ---------- 2. 柱子 ----------
  if (struct.columnDensity > 0 && !struct.isMasonry) {
    const columnLines: React.ReactNode[] = [];
    // 按密度决定步长（密度越小，步长越大，柱越少）
    const step = struct.columnDensity < 0.5 ? 2 : 1;
    const isSteel = struct.isSteel;

    for (let i = 0; i <= geom.baysX; i += step) {
      for (let j = 0; j <= geom.baysZ; j += step) {
        // 核心筒区域不画柱（筒中筒 / 框筒的柱只在四周）
        if (struct.corewall) {
          const c = struct.corewall;
          const inCore =
            i >= Math.floor(c.cx - c.w) &&
            i <= Math.ceil(c.cx + c.w) &&
            j >= Math.floor(c.cz - c.d) &&
            j <= Math.ceil(c.cz + c.d);
          if (inCore && (i > 0 && i < geom.baysX && j > 0 && j < geom.baysZ)) continue;
        }

        const x = i * geom.gridX;
        const z = j * geom.gridZ;
        const bottom = project(x, 0, z);
        const top = project(x, geom.totalHeight, z);

        // 判断是否是"前面"的柱子（投影 y 值较小的前两排）
        const isFront = i === 0 || j === 0;
        const isBottomReinforce = params.floors > 10;

        const colColor = isSteel ? '#6b7280' : accent;
        const colWidth = isSteel ? (isFront ? 1.5 : 1) : (isFront ? 2 : 1.2);
        const colOpacity = isFront ? 0.95 : 0.55;

        columnLines.push(
          <g key={`col-grp-${keyCounter++}`}>
            <line
              x1={bottom[0].toFixed(1)}
              y1={bottom[1].toFixed(1)}
              x2={top[0].toFixed(1)}
              y2={top[1].toFixed(1)}
              stroke={colColor}
              strokeWidth={colWidth}
              opacity={colOpacity}
              style={isFront ? { filter: `drop-shadow(0 0 3px ${colColor}88)` } : undefined}
            />
            {/* Hero 待机模式：顶层柱段（hover 时青色高亮，由 .group:hover .hero-top-column 驱动） */}
            {autoRotate && params.floors > 0 && (
              <line
                className="hero-top-column hero-top-column-active"
                x1={project(x, Math.max(0, (params.floors - 1) * geom.floorHeight), z)[0].toFixed(1)}
                y1={project(x, Math.max(0, (params.floors - 1) * geom.floorHeight), z)[1].toFixed(1)}
                x2={top[0].toFixed(1)}
                y2={top[1].toFixed(1)}
              />
            )}
            {/* 底部加强区：加粗段（砌体和纯剪力墙没有） */}
            {isBottomReinforce && !struct.isMasonry && (
              <line
                x1={bottom[0].toFixed(1)}
                y1={bottom[1].toFixed(1)}
                x2={project(x, reinforceFloors * geom.floorHeight, z)[0].toFixed(1)}
                y2={project(x, reinforceFloors * geom.floorHeight, z)[1].toFixed(1)}
                stroke="#E8930C"
                strokeWidth={isFront ? 3 : 2}
                opacity="0.85"
                style={{ filter: 'drop-shadow(0 0 3px rgba(232, 147, 12, 0.5))' }}
              />
            )}
          </g>
        );
      }
    }
    elements.push(<g key="columns">{columnLines}</g>);
  }

  // ---------- 3. 每层楼板 + 梁 ----------
  for (let floorIdx = 0; floorIdx < params.floors; floorIdx++) {
    const y = (floorIdx + 1) * geom.floorHeight;
    const isBottomReinforce = floorIdx < reinforceFloors;
    const floorFill = isBottomReinforce
      ? 'rgba(232, 147, 12, 0.1)'
      : struct.isMasonry
      ? 'rgba(180, 83, 9, 0.06)'
      : 'rgba(15, 76, 129, 0.06)';
    const edgeColor = isBottomReinforce ? '#E8930C' : accent;
    const edgeWidth = isBottomReinforce ? 1.5 : 1;

    // 楼板外轮廓
    const c1 = project(0, y, 0);
    const c2 = project(geom.totalWidth, y, 0);
    const c3 = project(geom.totalWidth, y, geom.totalDepth);
    const c4 = project(0, y, geom.totalDepth);
    const d = `${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${c3[0].toFixed(1)},${c3[1].toFixed(1)} ${c4[0].toFixed(1)},${c4[1].toFixed(1)}`;

    elements.push(
      <polygon
        key={`floor-${keyCounter++}`}
        points={d}
        fill={floorFill}
        stroke={edgeColor}
        strokeWidth={edgeWidth}
        opacity="0.85"
        style={isBottomReinforce ? { filter: 'drop-shadow(0 0 2px rgba(232, 147, 12, 0.4))' } : undefined}
      />
    );

    // 内部梁 - 按 beamDensity 调整密度
    if (struct.beamDensity > 0 && !struct.isMasonry) {
      const beamStep = struct.beamDensity < 0.5 ? 2 : 1;
      // X 向主梁
      for (let i = beamStep; i < geom.baysX; i += beamStep) {
        const x = i * geom.gridX;
        const p1 = project(x, y, 0);
        const p2 = project(x, y, geom.totalDepth);
        elements.push(
          <line
            key={`bx-${keyCounter++}`}
            x1={p1[0].toFixed(1)}
            y1={p1[1].toFixed(1)}
            x2={p2[0].toFixed(1)}
            y2={p2[1].toFixed(1)}
            stroke={isBottomReinforce ? '#E8930C' : accent}
            strokeWidth="0.5"
            opacity="0.4"
          />
        );
      }
      // Z 向次梁
      const zBeamStep = struct.beamDensity < 0.5 ? 2 : 1;
      for (let j = zBeamStep; j < geom.baysZ; j += zBeamStep) {
        const z = j * geom.gridZ;
        const p1 = project(0, y, z);
        const p2 = project(geom.totalWidth, y, z);
        elements.push(
          <line
            key={`bz-${keyCounter++}`}
            x1={p1[0].toFixed(1)}
            y1={p1[1].toFixed(1)}
            x2={p2[0].toFixed(1)}
            y2={p2[1].toFixed(1)}
            stroke={isBottomReinforce ? '#E8930C' : accent}
            strokeWidth="0.4"
            opacity="0.3"
          />
        );
      }
    }
  }

  // ---------- 4. 核心筒（封闭剪力墙筒体） ----------
  if (struct.corewall) {
    const { cx, cz, w, d } = struct.corewall;
    const cxReal = cx * geom.gridX;
    const czReal = cz * geom.gridZ;
    const wReal = w * geom.gridX;
    const dReal = d * geom.gridZ;

    // 核心筒四面墙（迎光面用实色填充，背面用虚线表示）
    // 前面 (z 较小的一面 = 靠近观察者)：最清晰
    const frontBotL = project(cxReal - wReal, 0, czReal - dReal);
    const frontBotR = project(cxReal + wReal, 0, czReal - dReal);
    const frontTopL = project(cxReal - wReal, geom.totalHeight, czReal - dReal);
    const frontTopR = project(cxReal + wReal, geom.totalHeight, czReal - dReal);
    const frontD = `M${frontBotL[0].toFixed(1)},${frontBotL[1].toFixed(1)} L${frontBotR[0].toFixed(1)},${frontBotR[1].toFixed(1)} L${frontTopR[0].toFixed(1)},${frontTopR[1].toFixed(1)} L${frontTopL[0].toFixed(1)},${frontTopL[1].toFixed(1)} Z`;

    // 右侧面
    const rightBotL = project(cxReal + wReal, 0, czReal - dReal);
    const rightBotR = project(cxReal + wReal, 0, czReal + dReal);
    const rightTopL = project(cxReal + wReal, geom.totalHeight, czReal - dReal);
    const rightTopR = project(cxReal + wReal, geom.totalHeight, czReal + dReal);
    const rightD = `M${rightBotL[0].toFixed(1)},${rightBotL[1].toFixed(1)} L${rightBotR[0].toFixed(1)},${rightBotR[1].toFixed(1)} L${rightTopR[0].toFixed(1)},${rightTopR[1].toFixed(1)} L${rightTopL[0].toFixed(1)},${rightTopL[1].toFixed(1)} Z`;

    // 左面 (远处的左面，用更淡的颜色)
    const leftBotL = project(cxReal - wReal, 0, czReal - dReal);
    const leftBotR = project(cxReal - wReal, 0, czReal + dReal);
    const leftTopL = project(cxReal - wReal, geom.totalHeight, czReal - dReal);
    const leftTopR = project(cxReal - wReal, geom.totalHeight, czReal + dReal);
    const leftD = `M${leftBotL[0].toFixed(1)},${leftBotL[1].toFixed(1)} L${leftBotR[0].toFixed(1)},${leftBotR[1].toFixed(1)} L${leftTopR[0].toFixed(1)},${leftTopR[1].toFixed(1)} L${leftTopL[0].toFixed(1)},${leftTopL[1].toFixed(1)} Z`;

    // 顶面
    const topP1 = project(cxReal - wReal, geom.totalHeight, czReal - dReal);
    const topP2 = project(cxReal + wReal, geom.totalHeight, czReal - dReal);
    const topP3 = project(cxReal + wReal, geom.totalHeight, czReal + dReal);
    const topP4 = project(cxReal - wReal, geom.totalHeight, czReal + dReal);
    const topD = `M${topP1[0].toFixed(1)},${topP1[1].toFixed(1)} L${topP2[0].toFixed(1)},${topP2[1].toFixed(1)} L${topP3[0].toFixed(1)},${topP3[1].toFixed(1)} L${topP4[0].toFixed(1)},${topP4[1].toFixed(1)} Z`;

    elements.push(
      <g key="core-tube">
        {/* 左墙面（后面）*/}
        <path
          d={leftD}
          fill="rgba(232, 147, 12, 0.06)"
          stroke="#E8930C"
          strokeWidth="0.8"
          strokeDasharray="3 2"
          opacity="0.5"
        />
        {/* 右墙面 */}
        <path
          d={rightD}
          fill="rgba(232, 147, 12, 0.10)"
          stroke="#E8930C"
          strokeWidth="1"
          opacity="0.75"
        />
        {/* 前墙面（主立面） */}
        <path
          d={frontD}
          fill="rgba(232, 147, 12, 0.15)"
          stroke="#E8930C"
          strokeWidth="1.2"
          opacity="0.9"
          style={{ filter: 'drop-shadow(0 0 3px rgba(232, 147, 12, 0.4))' }}
        />
        {/* 核心筒顶面 */}
        <path
          d={topD}
          fill="rgba(232, 147, 12, 0.2)"
          stroke="#E8930C"
          strokeWidth="1"
          opacity="0.8"
        />
        {/* 核心筒四角加粗大柱（视觉锚点） */}
        {[
          [cxReal - wReal, czReal - dReal],
          [cxReal + wReal, czReal - dReal],
          [cxReal + wReal, czReal + dReal],
          [cxReal - wReal, czReal + dReal],
        ].map(([x, z], i) => {
          const bot = project(x, 0, z);
          const top = project(x, geom.totalHeight, z);
          return (
            <line
              key={`core-col-${i}`}
              x1={bot[0].toFixed(1)}
              y1={bot[1].toFixed(1)}
              x2={top[0].toFixed(1)}
              y2={top[1].toFixed(1)}
              stroke="#E8930C"
              strokeWidth="2.5"
              opacity="0.95"
              style={{ filter: 'drop-shadow(0 0 4px rgba(232, 147, 12, 0.6))' }}
            />
          );
        })}
      </g>
    );

    // 底部加强区核心筒加厚高亮
    if (params.floors > 10) {
      const ry = reinforceFloors * geom.floorHeight;
      const rf1 = project(cxReal - wReal, 0, czReal - dReal);
      const rf2 = project(cxReal + wReal, 0, czReal - dReal);
      const rf3 = project(cxReal + wReal, ry, czReal - dReal);
      const rf4 = project(cxReal - wReal, ry, czReal - dReal);
      const reinforceD = `M${rf1[0].toFixed(1)},${rf1[1].toFixed(1)} L${rf2[0].toFixed(1)},${rf2[1].toFixed(1)} L${rf3[0].toFixed(1)},${rf3[1].toFixed(1)} L${rf4[0].toFixed(1)},${rf4[1].toFixed(1)} Z`;
      elements.push(
        <path
          key="core-reinforce"
          d={reinforceD}
          fill="#E8930C"
          opacity="0.3"
          stroke="#E8930C"
          strokeWidth="1.5"
          style={{ filter: 'drop-shadow(0 0 5px rgba(232, 147, 12, 0.6))' }}
        />
      );
    }
  }

  // ---------- 5. 剪力墙（琥珀色 / 砌体色 墙片） ----------
  // 每道墙画成一个矩形立面（有厚度感），而不是一根细线
  const wallColor = struct.isMasonry ? '#b45309' : '#E8930C';
  const wallFill = struct.isMasonry ? 'rgba(180, 83, 9, 0.12)' : 'rgba(232, 147, 12, 0.10)';
  const wallThickness = 0.25; // 墙厚（米），用于 3D 厚度感

  struct.wallSegments.forEach((w, idx) => {
    const wx = w.x * geom.gridX;
    const wz = w.z * geom.gridZ;
    const wallLength = w.dir === 'x'
      ? w.length * geom.gridX
      : w.length * geom.gridZ;

    // 计算墙两端的坐标（从起点到终点的整段墙，而不是中点一根线）
    let startX: number, startZ: number, endX: number, endZ: number;
    if (w.dir === 'x') {
      startX = wx;
      startZ = wz;
      endX = wx + wallLength;
      endZ = wz;
    } else {
      startX = wx;
      startZ = wz;
      endX = wx;
      endZ = wz + wallLength;
    }

    // 墙的正面（迎光面）矩形：底两顶点 + 顶两顶点
    // 给墙一个厚度（沿垂直于墙的方向偏移 wallThickness）
    let offX = 0, offZ = 0;
    if (w.dir === 'x') {
      offZ = wallThickness; // 墙沿 z 方向有厚度
    } else {
      offX = wallThickness; // 墙沿 x 方向有厚度
    }

    const botFrontLeft = project(startX, 0, startZ);
    const botFrontRight = project(endX, 0, endZ);
    const topFrontLeft = project(startX, geom.totalHeight, startZ);
    const topFrontRight = project(endX, geom.totalHeight, endZ);
    const botBackLeft = project(startX + offX, 0, startZ + offZ);
    const botBackRight = project(endX + offX, 0, endZ + offZ);
    const topBackLeft = project(startX + offX, geom.totalHeight, startZ + offZ);
    const topBackRight = project(endX + offX, geom.totalHeight, endZ + offZ);

    // 正面（主立面）
    const frontD = `M${botFrontLeft[0].toFixed(1)},${botFrontLeft[1].toFixed(1)} L${botFrontRight[0].toFixed(1)},${botFrontRight[1].toFixed(1)} L${topFrontRight[0].toFixed(1)},${topFrontRight[1].toFixed(1)} L${topFrontLeft[0].toFixed(1)},${topFrontLeft[1].toFixed(1)} Z`;

    // 顶面（楼板处的墙顶）
    const topD = `M${topFrontLeft[0].toFixed(1)},${topFrontLeft[1].toFixed(1)} L${topFrontRight[0].toFixed(1)},${topFrontRight[1].toFixed(1)} L${topBackRight[0].toFixed(1)},${topBackRight[1].toFixed(1)} L${topBackLeft[0].toFixed(1)},${topBackLeft[1].toFixed(1)} Z`;

    // 侧面（厚度的端面，只画靠前的那端）
    const sideIdx = w.dir === 'x' ? (startZ < endZ ? 0 : 1) : (startX < endX ? 0 : 1);
    const sideBotL = sideIdx === 0 ? botFrontLeft : botFrontRight;
    const sideBotR = sideIdx === 0 ? botBackLeft : botBackRight;
    const sideTopL = sideIdx === 0 ? topFrontLeft : topFrontRight;
    const sideTopR = sideIdx === 0 ? topBackLeft : topBackRight;
    const sideD = `M${sideBotL[0].toFixed(1)},${sideBotL[1].toFixed(1)} L${sideBotR[0].toFixed(1)},${sideBotR[1].toFixed(1)} L${sideTopR[0].toFixed(1)},${sideTopR[1].toFixed(1)} L${sideTopL[0].toFixed(1)},${sideTopL[1].toFixed(1)} Z`;

    elements.push(
      <g key={`wall-${idx}`}>
        {/* 墙面 */}
        <path
          d={frontD}
          fill={wallFill}
          stroke={wallColor}
          strokeWidth="1"
          opacity="0.85"
          style={{ filter: `drop-shadow(0 0 2px ${wallColor}66)` }}
        />
        {/* 墙顶 */}
        <path
          d={topD}
          fill={wallColor}
          opacity="0.25"
        />
        {/* 墙侧（厚度感） */}
        <path
          d={sideD}
          fill={wallColor}
          opacity="0.15"
          stroke={wallColor}
          strokeWidth="0.5"
        />
        {/* 加强筋竖线（每隔一段画一根，体现墙的结构） */}
        {w.length >= 3 && Array.from({ length: Math.min(5, Math.floor(w.length / 2)) }, (_, i) => {
          const t = (i + 1) / (Math.min(5, Math.floor(w.length / 2)) + 1);
          const rx = startX + (endX - startX) * t;
          const rz = startZ + (endZ - startZ) * t;
          const rpBot = project(rx, 0, rz);
          const rpTop = project(rx, geom.totalHeight, rz);
          return (
            <line
              key={`wall-rib-${idx}-${i}`}
              x1={rpBot[0].toFixed(1)}
              y1={rpBot[1].toFixed(1)}
              x2={rpTop[0].toFixed(1)}
              y2={rpTop[1].toFixed(1)}
              stroke={wallColor}
              strokeWidth="0.6"
              opacity="0.4"
            />
          );
        })}
      </g>
    );

    // 底部加强区：墙底部颜色加深
    if (params.floors > 10) {
      const reinforceY = reinforceFloors * geom.floorHeight;
      const reinforceBotL = project(startX, 0, startZ);
      const reinforceBotR = project(endX, 0, endZ);
      const reinforceTopL = project(startX, reinforceY, startZ);
      const reinforceTopR = project(endX, reinforceY, endZ);
      const reinforceD = `M${reinforceBotL[0].toFixed(1)},${reinforceBotL[1].toFixed(1)} L${reinforceBotR[0].toFixed(1)},${reinforceBotR[1].toFixed(1)} L${reinforceTopR[0].toFixed(1)},${reinforceTopR[1].toFixed(1)} L${reinforceTopL[0].toFixed(1)},${reinforceTopL[1].toFixed(1)} Z`;
      elements.push(
        <path
          key={`wall-reinforce-${idx}`}
          d={reinforceD}
          fill="#E8930C"
          opacity="0.25"
          stroke="#E8930C"
          strokeWidth="1.2"
          style={{ filter: 'drop-shadow(0 0 3px rgba(232, 147, 12, 0.5))' }}
        />
      );
    }
  });

  // ---------- 6. 顶部桁架（钢结构） ----------
  if (struct.showTruss) {
    const roofY = geom.totalHeight + 2;
    const trussHeight = 3;
    // 简单画几根斜杆表示桁架
    const pts: [number, number][] = [];
    const numTrusses = Math.max(3, Math.floor(geom.baysX / 2));
    for (let i = 0; i <= numTrusses; i++) {
      const x = (i / numTrusses) * geom.totalWidth;
      const z = geom.totalDepth / 2;
      const p = project(x, roofY, z);
      pts.push(p);
    }
    // 上弦
    const topPts = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    elements.push(
      <path key="truss-top" d={topPts} fill="none" stroke="#6b7280" strokeWidth="1.5" opacity="0.8" />
    );
    // 下弦
    const botPts = pts.map((p, i) => {
      const x = (i / numTrusses) * geom.totalWidth;
      const z = geom.totalDepth / 2;
      const bp = project(x, roofY - trussHeight, z);
      return `${i === 0 ? 'M' : 'L'}${bp[0].toFixed(1)},${bp[1].toFixed(1)}`;
    }).join(' ');
    elements.push(
      <path key="truss-bot" d={botPts} fill="none" stroke="#6b7280" strokeWidth="1" opacity="0.6" />
    );
    // 斜腹杆
    for (let i = 0; i < numTrusses; i++) {
      const x1 = (i / numTrusses) * geom.totalWidth;
      const x2 = ((i + 1) / numTrusses) * geom.totalWidth;
      const z = geom.totalDepth / 2;
      const p1 = project(x1, roofY, z);
      const p2 = project(x2, roofY - trussHeight, z);
      elements.push(
        <line
          key={`truss-diag-${i}`}
          x1={p1[0].toFixed(1)}
          y1={p1[1].toFixed(1)}
          x2={p2[0].toFixed(1)}
          y2={p2[1].toFixed(1)}
          stroke="#6b7280"
          strokeWidth="0.7"
          opacity="0.5"
        />
      );
    }
  }

  // ---------- 6.5 跨度尺寸标注（底部前沿，与设置参数直接对应） ----------
  {
    const dimY = 0;
    const p0 = project(0, dimY, 0);
    const p1 = project(geom.gridX, dimY, 0);
    const mid = project(geom.gridX / 2, dimY, 0);
    const below = 10; // 尺寸线相对前沿的屏幕像素下移
    const dimColor = '#0f766e';
    elements.push(
      <g key="span-dim" opacity="0.7">
        {/* 尺寸界线 */}
        <line x1={p0[0].toFixed(1)} y1={p0[1].toFixed(1)} x2={p0[0].toFixed(1)} y2={(p0[1] + below).toFixed(1)} stroke={dimColor} strokeWidth="0.7" />
        <line x1={p1[0].toFixed(1)} y1={p1[1].toFixed(1)} x2={p1[0].toFixed(1)} y2={(p1[1] + below).toFixed(1)} stroke={dimColor} strokeWidth="0.7" />
        {/* 尺寸线 */}
        <line x1={p0[0].toFixed(1)} y1={(p0[1] + below).toFixed(1)} x2={p1[0].toFixed(1)} y2={(p1[1] + below).toFixed(1)} stroke={dimColor} strokeWidth="0.8" />
        {/* 端部 45° 斜短线 */}
        <line x1={p0[0].toFixed(1)} y1={(p0[1] + below).toFixed(1)} x2={(p0[0] + 3.5).toFixed(1)} y2={(p0[1] + below - 3.5).toFixed(1)} stroke={dimColor} strokeWidth="0.8" />
        <line x1={p1[0].toFixed(1)} y1={(p1[1] + below).toFixed(1)} x2={(p1[0] - 3.5).toFixed(1)} y2={(p1[1] + below - 3.5).toFixed(1)} stroke={dimColor} strokeWidth="0.8" />
        {/* 文字：跨度 = 用户设置的主要跨度（gridX 由 mainSpan 推导） */}
        <text
          x={mid[0].toFixed(1)}
          y={(p0[1] + below + 12).toFixed(1)}
          textAnchor="middle"
          fill={dimColor}
          style={{ fontSize: '9px', fontFamily: 'monospace', fontWeight: 'bold' }}
        >
          跨度 {geom.gridX.toFixed(1)}m
        </text>
      </g>
    );
  }

  // ---------- 7. 楼层编号标注 ----------
  const labelStep = Math.max(1, Math.floor(params.floors / 5));
  const floorLabels: React.ReactNode[] = [];
  for (let floorIdx = 0; floorIdx < params.floors; floorIdx += labelStep) {
    const y = (floorIdx + 1) * geom.floorHeight;
    const labelPos = project(-0.8, y - geom.floorHeight / 2, 0);
    floorLabels.push(
      <text
        key={`fl-label-${floorIdx}`}
        x={labelPos[0].toFixed(1)}
        y={labelPos[1].toFixed(1)}
        textAnchor="end"
        fill="#64748b"
        style={{ fontSize: '8px', fontFamily: 'monospace' }}
      >
        {floorIdx + 1}F
      </text>
    );
  }
  elements.push(<g key="floor-labels" opacity="0.7">{floorLabels}</g>);

  // ---------- 8. 底部加强区说明文字 ----------
  if (params.floors > 10) {
    const reinforceY = reinforceFloors * geom.floorHeight;
    const labelPos = project(geom.totalWidth / 2, reinforceY / 2, geom.totalDepth + 1);
    elements.push(
      <g key="reinforce-label">
        <text
          x={labelPos[0].toFixed(1)}
          y={labelPos[1].toFixed(1)}
          textAnchor="start"
          fill="#E8930C"
          style={{ fontSize: '8px', fontFamily: 'monospace', fontWeight: 'bold' }}
        >
          底部加强区
        </text>
      </g>
    );
  }

  // ---------- 9. 高度标注 ----------
  {
    const topP = project(geom.totalWidth + 0.5, geom.totalHeight, geom.totalDepth + 0.5);
    const botP = project(geom.totalWidth + 0.5, 0, geom.totalDepth + 0.5);
    elements.push(
      <g key="height-dim" opacity="0.5">
        <line
          x1={topP[0].toFixed(1)}
          y1={topP[1].toFixed(1)}
          x2={botP[0].toFixed(1)}
          y2={botP[1].toFixed(1)}
          stroke="#64748b"
          strokeWidth="0.6"
          strokeDasharray="2 2"
        />
        <text
          x={(topP[0] + 6).toFixed(1)}
          y={((topP[1] + botP[1]) / 2).toFixed(1)}
          fill="#64748b"
          style={{ fontSize: '8px', fontFamily: 'monospace', writingMode: 'vertical-rl' } as React.CSSProperties}
        >
          H ≈ {geom.totalHeight.toFixed(1)}m
        </text>
      </g>
    );
  }

  // ===== 动态自适应 viewBox =====
  // 用 zoom=1 的基准投影计算模型实际包围盒（含标注点），加 padding；
  // 再除以当前 zoom —— 放大看细节、缩小看全貌，任何楼层高度都完整显示
  const pad = 38;
  // bbox 使用固定角度的独立投影计算（不依赖 rotateAngle/zoom，旋转/缩放时 viewBox 不跳动），
  // 并对 0°/45°/90° 取包围盒并集，保证任意旋转角度下模型都完整落在可视范围内
  const bbox = useMemo(() => {
    const baseScale = Math.min(
      240 / Math.max(geom.totalWidth, geom.totalDepth),
      200 / geom.totalHeight
    );
    const tilt = 0.42;
    const ext = 1.2;
    const pts3d: [number, number, number][] = [
      [-ext, 0, -ext],
      [geom.totalWidth + ext, 0, -ext],
      [geom.totalWidth + ext, 0, geom.totalDepth + ext],
      [-ext, 0, geom.totalDepth + ext],
      [-ext, geom.totalHeight, -ext],
      [geom.totalWidth + ext, geom.totalHeight, -ext],
      [geom.totalWidth + ext, geom.totalHeight, geom.totalDepth + ext],
      [-ext, geom.totalHeight, geom.totalDepth + ext],
      // 高度标注线上下端点
      [geom.totalWidth + 0.5, geom.totalHeight, geom.totalDepth + 0.5],
      [geom.totalWidth + 0.5, 0, geom.totalDepth + 0.5],
      // 底部加强区标注点
      [geom.totalWidth / 2, reinforceFloors * geom.floorHeight / 2, geom.totalDepth + 1],
    ];
    const cx = geom.totalWidth / 2;
    const cz = geom.totalDepth / 2;
    const projectFixed = (x: number, y: number, z: number, angleDeg: number): [number, number] => {
      const angleY = (angleDeg * Math.PI) / 180;
      const dx = x - cx;
      const dz = z - cz;
      const rx = dx * Math.cos(angleY) + dz * Math.sin(angleY);
      const rz = -dx * Math.sin(angleY) + dz * Math.cos(angleY);
      const sx = rx * baseScale;
      const sy = -y * baseScale * (1 - tilt * 0.5) + rz * baseScale * tilt;
      return [sx, sy];
    };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const angle of [0, 45, 90]) {
      for (const [x, y, z] of pts3d) {
        const [px, py] = projectFixed(x, y, z, angle);
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
    }
    // 兜底：任何情况下都不为空
    if (!isFinite(minX) || !isFinite(minY)) {
      return { x: -160, y: -135, w: 320, h: 320 };
    }
    return {
      x: minX - pad,
      y: minY - pad,
      w: maxX - minX + pad * 2,
      h: maxY - minY + pad * 2,
    };
  }, [geom, reinforceFloors]);

  // 应用用户缩放：viewBox 尺寸缩小 = 放大显示（以中心为锚点）
  const vbX = bbox.x + bbox.w * 0.5 - (bbox.w / zoom) * 0.5;
  const vbY = bbox.y + bbox.h * 0.5 - (bbox.h / zoom) * 0.5;
  const vbW = bbox.w / zoom;
  const vbH = bbox.h / zoom;
  const viewBoxStr = `${vbX.toFixed(2)} ${vbY.toFixed(2)} ${vbW.toFixed(2)} ${vbH.toFixed(2)}`;

  return (
    <div
      ref={containerRef}
      className="group relative flex h-full w-full items-center justify-center bg-[#f4f7fb] select-none"
      style={{
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        msUserSelect: 'none',
        cursor: isDraggingState ? 'grabbing' : 'grab',
      }}
      data-draggable="true"
      onMouseEnter={() => {
        if (autoRotate) autoHoverPaused.current = true;
      }}
      onMouseLeave={() => {
        if (autoRotate) autoHoverPaused.current = false;
      }}
    >
      {/* 蓝图网格背景 */}
      <div className="pointer-events-none absolute inset-0 bg-blueprint-grid opacity-30" />

      {/* 径向光晕 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, rgba(18, 165, 181, 0.08) 0%, transparent 70%)',
        }}
      />

      <svg
        viewBox={viewBoxStr}
        className="relative h-full w-full"
        style={{ pointerEvents: 'none' }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <pattern id="grid-pattern-3d" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(30, 77, 123, 0.06)" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect x={bbox.x} y={bbox.y} width={bbox.w} height={bbox.h} fill="url(#grid-pattern-3d)" />
        {violations.length > 0 && (
          <rect
            x={bbox.x - 1.5}
            y={bbox.y - 1.5}
            width={bbox.w + 3}
            height={bbox.h + 3}
            fill="none"
            stroke="#e11d48"
            strokeWidth={1}
            strokeDasharray="6 4"
            className="animate-pulse"
          />
        )}
        {elements}
      </svg>

      {/* 规范校核警示条 */}
      {violations.length > 0 && (
        <div className="pointer-events-auto absolute left-1/2 top-2 z-10 w-[96%] max-w-[520px] -translate-x-1/2">
          <div
            className="rounded-md border border-rose-400/70 bg-rose-50/95 px-3 py-2 shadow-sm backdrop-blur-sm"
            title={violations.map((v) => v.clause).join('\n')}
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-xs text-rose-600">⚠️</span>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold text-rose-700">
                  规范校核需关注 {violations.length} 项
                </div>
                <div className="mt-0.5 space-y-0.5">
                  {violations.slice(0, 3).map((v, i) => (
                    <div key={i} className="text-[10px] leading-snug text-rose-600/90">
                      {v.name}
                      {v.clause && <span className="text-rose-500/70"> —— {v.clause.slice(0, 48)}{v.clause.length > 48 ? '…' : ''}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 信息角标 - 左下：体系名称 */}
      <div className="pointer-events-none absolute bottom-2 left-3 font-mono text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span
            className="h-1.5 w-1.5 animate-pulse rounded-full"
            style={{ backgroundColor: accent }}
          />
          {struct.label}
        </div>
      </div>
      {/* 信息角标 - 右下：参数提示 */}
      <div className="pointer-events-none absolute bottom-2 right-3 font-mono text-[9px] text-muted-foreground/70 tracking-wider text-right">
        <div>拖拽旋转 · 滚轮缩放</div>
        <div>跨度 {geom.gridX.toFixed(1)}m · {params.floors}F · 总高 {geom.totalHeight.toFixed(1)}m{zoom !== 1 ? ` · ${(zoom * 100).toFixed(0)}%` : ''}</div>
      </div>
    </div>
  );
}

function StructureWireframe3D({ params, scheme, codeChecks, autoRotate }: StructureWireframeProps) {
  // 空数据保护
  if (!params || !params.floors || !params.area) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        等待输入参数
      </div>
    );
  }

  return (
    <ErrorBoundary
      fallback={
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <div className="text-base">3D 模型加载失败</div>
          <div className="text-xs">请刷新页面或联系技术支持</div>
        </div>
      }
    >
      <StructureWireframeSVG params={params} scheme={scheme} codeChecks={codeChecks} autoRotate={autoRotate} />
    </ErrorBoundary>
  );
}

export default memo(StructureWireframe3D);
