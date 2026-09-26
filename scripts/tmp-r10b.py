# -*- coding: utf-8 -*-
"""Part D：Hero/Comparison props 声明 + HomePage state/传递/报告传参"""
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
    # ============ HeroSection props 声明 ============
    ph = r'C:\Users\31482\Doubao\chats\2026-09-26\new-chat\StructMind-Agent\src\pages\HomePage\sections\HeroSection.tsx'
    h_patches = [
        ('h-props',
         """  /** 当前选中的结构方案（用于 3D 预览随方案变化） */
  scheme?: IStructureScheme | null;
}""",
         """  /** 当前选中的结构方案（用于 3D 预览随方案变化） */
  scheme?: IStructureScheme | null;
  /** 规范校核结果（3D 违规警示） */
  codeChecks?: Record<string, unknown>;
}"""),
        ('h-sig',
         "function HeroSection({ onStart, params, scheme }: HeroSectionProps) {",
         "function HeroSection({ onStart, params, scheme, codeChecks }: HeroSectionProps) {"),
    ]
    apply_file(ph, h_patches, [])

    # ============ ComparisonSection props 声明 ============
    pc = r'C:\Users\31482\Doubao\chats\2026-09-26\new-chat\StructMind-Agent\src\pages\HomePage\sections\ComparisonSection.tsx'
    c_patches = [
        ('c-props',
         "  lockedParams?: Partial<Record<keyof IProjectParams, boolean>>;\n}",
         "  lockedParams?: Partial<Record<keyof IProjectParams, boolean>>;\n  /** 规范校核结果（3D 违规警示） */\n  codeChecks?: Record<string, unknown>;\n}"),
    ]
    apply_file(pc, c_patches, [])
    # ComparisonSection 函数签名解构——查函数定义行
    s = io.open(pc, encoding='utf-8').read()
    if 'codeChecks,\n' not in s and 'codeChecks?:' not in s.split('function ComparisonSection(')[1][:600]:
        old = "  lockedParams,\n};"
        assert s.count(old) == 1, ('c-destructure', s.count(old))
        s = s.replace(old, "  lockedParams,\n  codeChecks,\n};", 1)
        io.open(pc, 'w', encoding='utf-8', newline='').write(s)
        print('OK c-destructure')
    else:
        print('SKIP c-destructure')

    # ============ HomePage：state + 设置 + 三处传递 ============
    hp = r'C:\Users\31482\Doubao\chats\2026-09-26\new-chat\StructMind-Agent\src\pages\HomePage\HomePage.tsx'
    s = io.open(hp, encoding='utf-8').read()
    def rep(old, new, tag):
        global s
        assert s.count(old) == 1, (tag, s.count(old))
        s = s.replace(old, new, 1)
        print('OK ' + tag)

    # 1. state
    rep("""  // 工程历史版本（版本回溯 / 对比）
  const [historyOpen, setHistoryOpen] = useState(false);""",
    """  // 规范校核结果 / 总工建议（报告导出 + 3D 违规警示 + 报告结构化章节）
  const [lastCodeChecks, setLastCodeChecks] = useState<Record<string, unknown>>({});
  const [lastAdvice, setLastAdvice] = useState<IAgentPipelineResult['advice'] | null>(null);
  // 工程历史版本（版本回溯 / 对比）
  const [historyOpen, setHistoryOpen] = useState(false);""",
    'd-state')

    # 2. 主流程设置（saveHistory 之后）
    rep("""        // 工程历史版本：保存本版参数+结果到 localStorage（最多 10 版）
        if (result.recommended && result.recommended.schemeId) {
          setHistoryList(saveHistoryEntry(buildHistoryEntry(params, result)));
        }""",
    """        // 工程历史版本：保存本版参数+结果到 localStorage（最多 10 版）
        if (result.recommended && result.recommended.schemeId) {
          setHistoryList(saveHistoryEntry(buildHistoryEntry(params, result)));
        }

        // 规范校核结果 + 总工建议（供 3D 违规警示与报告导出使用）
        setLastCodeChecks((result.codeChecks as Record<string, unknown>) || {});
        setLastAdvice(result.advice || null);""",
    'd-set-main')

    # 3. fallback 设置（fallbackResult setRecommendation 后）
    rep("""            setAgentContext({
              currentParams: params,
              weights: w,
              lastResult: fallbackResult,
            });""",
    """            setLastCodeChecks((fallbackResult.codeChecks as Record<string, unknown>) || {});
            setLastAdvice(fallbackResult.advice || null);

            setAgentContext({
              currentParams: params,
              weights: w,
              lastResult: fallbackResult,
            });""",
    'd-set-fallback')

    # 4. HeroSection 传递
    rep("""        <HeroSection
          onStart={scrollToParams}
          params={projectParams}
          scheme={schemes.find((s) => s.id === selectedSchemeId) || (recommendation ? schemes[0] : null)}
        />""",
    """        <HeroSection
          onStart={scrollToParams}
          params={projectParams}
          scheme={schemes.find((s) => s.id === selectedSchemeId) || (recommendation ? schemes[0] : null)}
          codeChecks={lastCodeChecks}
        />""",
    'd-hero')

    # 5. ComparisonSection 传递
    rep("""              lockedParams={lockedParams}
            />""",
    """              lockedParams={lockedParams}
              codeChecks={lastCodeChecks}
            />""",
    'd-comparison')

    # 6. ReportPrintView 传递
    rep("""         <ReportPrintView
           params={projectParams}
           schemes={schemes}
           recommendation={recommendation}
           weights={weights}
           isDemoMode={isDemoMode}
         />""",
    """         <ReportPrintView
           params={projectParams}
           schemes={schemes}
           recommendation={recommendation}
           weights={weights}
           isDemoMode={isDemoMode}
           advice={lastAdvice}
           codeChecks={lastCodeChecks}
         />""",
    'd-report')

    io.open(hp, 'w', encoding='utf-8', newline='').write(s)
    print('PART D DONE')
except Exception:
    traceback.print_exc()
    sys.exit(1)
