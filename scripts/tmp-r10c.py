# -*- coding: utf-8 -*-
"""Part D 续：ComparisonSection 解构 + HomePage"""
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
    pc = r'C:\Users\31482\Doubao\chats\2026-09-26\new-chat\StructMind-Agent\src\pages\HomePage\sections\ComparisonSection.tsx'
    c_patches = [
        ('c-destructure',
         "  isAutoOptimizing,\n  lockedParams = {},\n}: ComparisonSectionProps) {",
         "  isAutoOptimizing,\n  lockedParams = {},\n  codeChecks,\n}: ComparisonSectionProps) {"),
    ]
    apply_file(pc, c_patches, [('c-verify', lambda s: 'codeChecks,\n}: ComparisonSectionProps' in s)])

    hp = r'C:\Users\31482\Doubao\chats\2026-09-26\new-chat\StructMind-Agent\src\pages\HomePage\HomePage.tsx'
    s = io.open(hp, encoding='utf-8').read()
    def rep(old, new, tag):
        global s
        assert s.count(old) == 1, (tag, s.count(old))
        s = s.replace(old, new, 1)
        print('OK ' + tag)

    rep("""  // 工程历史版本（版本回溯 / 对比）
  const [historyOpen, setHistoryOpen] = useState(false);""",
    """  // 规范校核结果 / 总工建议（报告导出 + 3D 违规警示 + 报告结构化章节）
  const [lastCodeChecks, setLastCodeChecks] = useState<Record<string, unknown>>({});
  const [lastAdvice, setLastAdvice] = useState<IAgentPipelineResult['advice'] | null>(null);
  // 工程历史版本（版本回溯 / 对比）
  const [historyOpen, setHistoryOpen] = useState(false);""",
    'd-state')

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

    rep("""              lockedParams={lockedParams}
            />""",
    """              lockedParams={lockedParams}
              codeChecks={lastCodeChecks}
            />""",
    'd-comparison')

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
