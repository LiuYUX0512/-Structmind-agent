import { memo, useState } from 'react';
import { Building2, BarChart3, MessageSquare, Settings2, RotateCcw, Menu, X, Bot, Presentation } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';

interface StepNavProps {
  currentStep: number;
  onReset: () => void;
  presentationMode?: boolean;
  onTogglePresentation?: () => void;
}

const STEPS = [
  { id: 1, label: '参数录入', sublabel: 'PARAMS', icon: Settings2, anchor: '#params' },
  { id: 2, label: '方案生成', sublabel: 'SCHEMES', icon: Building2, anchor: '#schemes' },
  { id: 3, label: '对比分析', sublabel: 'COMPARISON', icon: BarChart3, anchor: '#comparison' },
  { id: 4, label: '智能问答', sublabel: 'Q&A', icon: MessageSquare, anchor: '#chat' },
];

function StepNav({ currentStep, onReset, presentationMode, onTogglePresentation }: StepNavProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isMobile = useIsMobile();

  const handleStepClick = (anchor: string) => {
    const id = anchor.replace('#', '');
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur-md shadow-[0_1px_0_rgba(205_218_230_0.5)]">
      {/* Blueprint grid overlay - subtle */}
      <div className="pointer-events-none absolute inset-0 bg-blueprint-grid opacity-[0.25]" />
      <div className="relative mx-auto flex h-16 max-w-[1600px] items-center justify-between px-6">
        {/* Left: Brand */}
        <div className="flex items-center gap-4">
           <div className="relative flex size-9 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/30">
             <Building2 className="h-[18px] w-[18px] text-primary" strokeWidth={1.75} />
             {/* Corner marks */}
             <div className="absolute -left-0.5 -top-0.5 h-2 w-2 border-l border-t border-primary/60" />
             <div className="absolute -right-0.5 -top-0.5 h-2 w-2 border-r border-t border-primary/60" />
             <div className="absolute -bottom-0.5 -left-0.5 h-2 w-2 border-b border-l border-primary/60" />
             <div className="absolute -bottom-0.5 -right-0.5 h-2 w-2 border-b border-r border-primary/60" />
          </div>
          <div className="hidden sm:block">
             <div className="text-sm font-bold tracking-tight text-foreground">
               智构 StructMind
               <span className="ml-1.5 font-mono text-[10px] font-medium text-teal">V2.0</span>
             </div>
             <div className="font-mono text-[9px] tracking-[0.18em] text-muted-foreground">
               STRUCTURAL OPTIMIZATION WORKBENCH
             </div>
          </div>
        </div>

        {/* Center: Step Indicator - desktop */}
         {!isMobile && (
           <nav className="flex items-center gap-0.5">
             {STEPS.map((step, i) => {
               const Icon = step.icon;
               const isDone = step.id < currentStep;
               const isActive = step.id === currentStep;
               return (
                 <div key={step.id} className="flex items-center">
                   <button
                     onClick={() => handleStepClick(step.anchor)}
                     className={`group relative flex items-center gap-2 px-3 py-2 transition-all ${
                       isActive
                         ? 'text-primary'
                         : isDone
                           ? 'text-foreground/65 hover:text-foreground'
                           : 'text-muted-foreground hover:text-foreground/70'
                     }`}
                   >
                     {/* Step number - blueprint style */}
                     <span
                       className={`flex size-7 items-center justify-center font-mono text-[11px] font-bold tracking-wider transition-all ${
                         isActive
                           ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20'
                           : isDone
                             ? 'bg-teal/15 text-teal ring-1 ring-teal/30'
                             : 'bg-muted/60 text-muted-foreground ring-1 ring-border/50'
                       }`}
                       style={{ borderRadius: '2px' }}
                     >
                       {String(step.id).padStart(2, '0')}
                     </span>
                     <div className="text-left leading-tight">
                       <div className="text-xs font-medium">{step.label}</div>
                       <div className="font-mono text-[8px] tracking-[0.15em] opacity-50">{step.sublabel}</div>
                     </div>
                     {isActive && (
                       <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-primary" />
                     )}
                   </button>
                   {i < STEPS.length - 1 && (
                     <div className="relative mx-2 flex h-4 items-center">
                       <div className={`h-px w-5 ${step.id < currentStep ? 'bg-teal/50' : 'bg-border/70'}`} />
                       {step.id < currentStep && (
                         <div className="absolute right-0 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-teal" />
                       )}
                     </div>
                   )}
                 </div>
               );
             })}
           </nav>
         )}

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5">
          <div className="hidden items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary md:flex">
             <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
             实时计算模式
           </div>
           {onTogglePresentation && (
             <Button
               variant={presentationMode ? 'default' : 'outline'}
               size="sm"
               onClick={onTogglePresentation}
               className={`hidden gap-1.5 md:flex ${presentationMode ? 'bg-amber text-amber-foreground hover:bg-amber/90' : 'border-amber/50 text-amber hover:bg-amber/10'}`}
               title={presentationMode ? '退出大屏模式' : '进入大屏模式'}
             >
               <Presentation className="h-3.5 w-3.5" />
               {presentationMode ? '大屏模式' : '大屏模式'}
             </Button>
           )}
           <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            className="hidden gap-1.5 border-border/60 md:flex"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            新建工程
          </Button>
          {/* 移动端：常驻对话按钮（一眼可见，不藏在菜单里） */}
          {isMobile && (
            <Button
              variant="outline"
              size="icon"
              onClick={() => handleStepClick('#chat')}
              className="relative border-teal/40 bg-teal/5 text-teal hover:bg-teal/10"
              aria-label="智能问答"
            >
              <Bot className="size-4" />
              <span className="absolute -right-0.5 -top-0.5 flex size-2.5 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal/40 opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-teal" />
              </span>
            </Button>
          )}
          {isMobile && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="text-foreground"
            >
              {mobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </Button>
          )}
        </div>
      </div>

      {/* Mobile menu */}
      {isMobile && mobileMenuOpen && (
        <div className="relative border-t border-border/50 bg-card/95 backdrop-blur-xl">
          <nav className="grid grid-cols-2 gap-1 p-2">
            {STEPS.map((step) => {
              const Icon = step.icon;
              const isActive = step.id === currentStep;
              const isDone = step.id < currentStep;
              return (
                <button
                  key={step.id}
                  onClick={() => handleStepClick(step.anchor)}
                  className={`flex items-center gap-2 rounded-md px-3 py-3 text-left ${
                    isActive
                      ? 'bg-primary/15 text-primary'
                      : isDone
                        ? 'text-foreground/80'
                        : 'text-muted-foreground'
                  }`}
                >
                  <Icon className="size-4 shrink-0" />
                  <div className="leading-tight">
                    <div className="text-sm font-medium">{step.label}</div>
                    <div className="text-[9px] tracking-widest opacity-60">{step.sublabel}</div>
                  </div>
                </button>
              );
            })}
          </nav>
          <div className="border-t border-border/50 p-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onReset}
              className="w-full gap-1.5"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              新建工程
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}

export default memo(StepNav);
