# -*- coding: utf-8 -*-
"""全量 patch：第10条报告(advice/knowledgeBasis/雷达) + 第11条3D校核警示"""
import io, sys, traceback

def apply_file(path, patches, verify_list):
    s = io.open(path, encoding='utf-8').read()
    for tag, old, new in patches:
        if old in s:
            assert s.count(old) == 1, (tag, s.count(old))
            s = s.replace(old, new, 1)
            print('OK ' + tag)
        else:
            print('SKIP ' + tag)
    io.open(path, 'w', encoding='utf-8', newline='').write(s)
    s2 = io.open(path, encoding='utf-8').read()
    for tag, cond in verify_list:
        assert cond(s2), tag
        print('VERIFY ' + tag)

try:
    # ============ A. StructureWireframe3D：校核警示 ============
    p3d = r'C:\Users\31482\Doubao\chats\2026-09-26\new-chat\StructMind-Agent\src\components\StructureWireframe3D.tsx'
    a_patches = [
        ('a-props',
         """interface StructureWireframeProps {
  params: IProjectParams;
  scheme?: IStructureScheme | null;
}""",
         """interface StructureWireframeProps {
  params: IProjectParams;
  scheme?: IStructureScheme | null;
  /** 规范校核结果（方案级：{ schemeId: { seismic: { checks }, fire: { checks } } }），用于违规警示 */
  codeChecks?: Record<string, unknown>;
}"""),
        ('a-svg-signature',
         "function StructureWireframeSVG({ params, scheme }: StructureWireframeProps) {",
         "function StructureWireframeSVG({ params, scheme, codeChecks }: StructureWireframeProps) {"),
        ('a-violations',
         "  const [rotateAngle, setRotateAngle] = useState(-30);",
         """  const [rotateAngle, setRotateAngle] = useState(-30);
  // ===== 规范校核警示（违规构件可视化：校核未通过/需关注项 → 红色警示 + 条文提示） =====
  const violations = useMemo(() => {
    if (!scheme?.id || !codeChecks) return [];
    const cc = codeChecks[scheme.id] as
      | { seismic?: { checks?: Array<{ name: string; status: string; clauseText?: string }> }; fire?: { checks?: Array<{ item?: string; status: string; clauseText?: string }> } }
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
  }, [scheme, codeChecks]);"""),
        ('a-pulse-rect',
         """        <rect x={bbox.x} y={bbox.y} width={bbox.w} height={bbox.h} fill="url(#grid-pattern-3d)" />
        {elements}""",
         """        <rect x={bbox.x} y={bbox.y} width={bbox.w} height={bbox.h} fill="url(#grid-pattern-3d)" />
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
        {elements}"""),
        ('a-warning-bar',
         """      {/* 信息角标 - 左下：体系名称 */}""",
         """      {/* 规范校核警示条 */}
      {violations.length > 0 && (
        <div className="pointer-events-auto absolute left-1/2 top-2 z-10 w-[96%] max-w-[520px] -translate-x-1/2">
          <div
            className="rounded-md border border-rose-400/70 bg-rose-50/95 px-3 py-2 shadow-sm backdrop-blur-sm"
            title={violations.map((v) => v.clause).join('\\n')}
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

      {/* 信息角标 - 左下：体系名称 */}"""),
        ('a-shell-signature',
         "function StructureWireframe3D({ params, scheme }: StructureWireframeProps) {",
         "function StructureWireframe3D({ params, scheme, codeChecks }: StructureWireframeProps) {"),
        ('a-shell-pass',
         "      <StructureWireframeSVG params={params} scheme={scheme} />",
         "      <StructureWireframeSVG params={params} scheme={scheme} codeChecks={codeChecks} />"),
    ]
    a_verify = [
        ('3d-violations', lambda s: s.count('const violations = useMemo') == 1),
        ('3d-warning-bar', lambda s: s.count('规范校核警示条') == 1),
    ]
    apply_file(p3d, a_patches, a_verify)

    # ============ B. HeroSection：透传 codeChecks ============
    ph = r'C:\Users\31482\Doubao\chats\2026-09-26\new-chat\StructMind-Agent\src\pages\HomePage\sections\HeroSection.tsx'
    b_patches = [
        ('b-props',
         "                  <StructureWireframe3D params={displayParams} scheme={scheme} />",
         "                  <StructureWireframe3D params={displayParams} scheme={scheme} codeChecks={codeChecks} />"),
        ('b-sig', "codeChecks={codeChecks}", "codeChecks={codeChecks}"),
    ]
    # HeroSection 需确认 props 是否有 codeChecks——先加签名后加传参（两段）
    apply_file(ph, b_patches, [])

    # ============ C. ComparisonSection：透传 ============
    pc = r'C:\Users\31482\Doubao\chats\2026-09-26\new-chat\StructMind-Agent\src\pages\HomePage\sections\ComparisonSection.tsx'
    c_patches = [
        ('c-pass',
         "                    <StructureWireframe3D params={projectParams} scheme={displayedScheme} />",
         "                    <StructureWireframe3D params={projectParams} scheme={displayedScheme} codeChecks={codeChecks} />"),
    ]
    apply_file(pc, c_patches, [])

    print('PART A/B/C DONE')
except Exception:
    traceback.print_exc()
    sys.exit(1)
