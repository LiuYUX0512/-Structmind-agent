// ChatSection — 行动型对话区
// 意图徽章 + 对话流 + 当前工程状态卡 + 推荐问题
// EXPORTS: ChatSection

import { memo, useRef, useEffect, useState } from 'react';
import { MessageSquare, Brain, Zap, Lightbulb, Wrench, Send, Settings, Bot, User, Sparkles, Loader2, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ProjectStatusCard from '@/components/ProjectStatusCard';
import {
  type IChatMessage,
  type IProjectParams,
  type IStructureScheme,
} from '@/data/structure';
import type { IIntentResult } from '@/agent/types';

interface ChatSectionProps {
  messages: IChatMessage[];
  isLoading: boolean;
  onSendMessage: (message: string) => void;
  /** 当前意图（最近一次识别的） */
  currentIntent?: IIntentResult | null;
  /** 当前工程参数 */
  params: IProjectParams | null;
  /** 当前方案集 */
  schemes: IStructureScheme[];
  /** 推荐方案 ID */
  recommendedSchemeId?: string;
  /** 打开 Agent 配置面板 */
  onOpenConfig?: () => void;
}

const RECOMMENDED_QUESTIONS = [
  { icon: Zap, text: '为什么推荐框剪而不是框架？' },
  { icon: Brain, text: '把预算降到4000会怎样？' },
  { icon: Lightbulb, text: '8度设防对结构有什么要求？' },
  { icon: Wrench, text: '剪力墙结构施工难点在哪里？' },
];

function ChatSection({
  messages,
  isLoading,
  onSendMessage,
  currentIntent,
  params,
  schemes,
  recommendedSchemeId,
  onOpenConfig,
}: ChatSectionProps) {
  const [inputValue, setInputValue] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasMessages = messages.length > 0;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, isLoading]);

  const submitMessage = () => {
    if (!inputValue.trim() || isLoading) return;
    onSendMessage(inputValue.trim());
    setInputValue('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitMessage();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitMessage();
    }
  };

  const handleQuestionClick = (q: string) => {
    if (isLoading) return;
    onSendMessage(q);
  };

  const intentBadge = (() => {
    if (!currentIntent) return null;
    const labelMap: Record<string, string> = {
      CHANGE_PARAMS: '修改参数',
      REGENERATE: '重新生成方案',
      EXPLAIN: '方案解释',
      COMPARE: '方案对比分析',
      RECOMMEND: '推荐咨询',
      ASK_CODE: '规范条文问答',
      ASK_ISOLATION: '隔震减震咨询',
      ASK_PRECAST_COST: '装配率成本分析',
      ASK_STEEL_COST: '钢结构造价对比',
      ASK_SCHEDULE_COMPRESS: '工期压缩分析',
      ASK_COMPLIANCE_RISK: '合规性风险评估',
      ASK_BUDGET_CUT: '预算削减分析',
      ASK_BENCHMARK: '同类项目对比',
      ASK_SEISMIC_GRADE: '抗震等级查询',
      ASK_FOUNDATION: '基础形式建议',
      ASK_STEEL_RATIO: '含钢量估算',
      ASK_SECTION_SIZE: '构件截面估算',
      UNKNOWN: '通用咨询',
      GENERAL: '通用咨询',
    };
    const colorMap: Record<string, string> = {
      CHANGE_PARAMS: 'border-amber/40 bg-amber/10 text-amber',
      REGENERATE: 'border-amber/40 bg-amber/10 text-amber',
      EXPLAIN: 'border-primary/40 bg-primary/10 text-primary',
      COMPARE: 'border-teal/40 bg-teal/10 text-teal',
      RECOMMEND: 'border-primary/40 bg-primary/10 text-primary',
      ASK_CODE: 'border-primary/40 bg-primary/10 text-primary',
      ASK_ISOLATION: 'border-teal/40 bg-teal/10 text-teal',
      ASK_PRECAST_COST: 'border-success/40 bg-success/10 text-success',
      ASK_STEEL_COST: 'border-success/40 bg-success/10 text-success',
      ASK_SCHEDULE_COMPRESS: 'border-amber/40 bg-amber/10 text-amber',
      ASK_COMPLIANCE_RISK: 'border-destructive/40 bg-destructive/10 text-destructive',
      ASK_BUDGET_CUT: 'border-destructive/40 bg-destructive/10 text-destructive',
      ASK_BENCHMARK: 'border-teal/40 bg-teal/10 text-teal',
      ASK_SEISMIC_GRADE: 'border-primary/40 bg-primary/10 text-primary',
      ASK_FOUNDATION: 'border-primary/40 bg-primary/10 text-primary',
      ASK_STEEL_RATIO: 'border-success/40 bg-success/10 text-success',
      ASK_SECTION_SIZE: 'border-primary/40 bg-primary/10 text-primary',
      UNKNOWN: 'border-muted-foreground/30 bg-muted/50 text-muted-foreground',
      GENERAL: 'border-muted-foreground/30 bg-muted/50 text-muted-foreground',
    };
    const label = labelMap[currentIntent.intent] || currentIntent.intent;
    const color = colorMap[currentIntent.intent] || colorMap.GENERAL;
    return { label, color };
  })();

  return (
    <section id="chat" className="w-full py-12 md:py-16">
      <div className="mx-auto max-w-[1600px] px-4 md:px-6">
        {/* Section header */}
        <div className="mb-5 md:mb-7">
          <div className="flex items-end justify-between gap-4">
            <div className="flex items-end gap-3 md:gap-4">
              <div className="flex flex-col items-center">
                <span className="font-mono text-4xl font-bold leading-none text-teal/90 tracking-tight md:text-5xl">04</span>
                <span className="mt-1 font-mono text-[9px] tracking-[0.2em] text-muted-foreground">SC-B04</span>
              </div>
              <div className="h-10 w-px bg-border md:h-12" />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[10px] tracking-[0.25em] text-muted-foreground uppercase md:text-[11px]">Intelligent QA · 智能问答</div>
                <h2 className="mt-0.5 text-xl font-bold tracking-tight text-foreground md:text-3xl">
                  行动型智能对话
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground md:text-sm">
                  支持意图识别、参数联动修改的工程智能助手
                </p>
              </div>
            </div>
            {/* 移动端显眼徽章，提示这是对话入口 */}
            <div className="flex items-center gap-1.5 rounded-md border border-teal/30 bg-teal/10 px-2.5 py-1.5 md:hidden">
              <Bot className="h-3.5 w-3.5 text-teal" />
              <span className="text-[11px] font-medium text-teal">工程师在线</span>
            </div>
          </div>
          <div className="tick-decor mt-3 md:mt-4" />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* 左侧：对话主区 */}
          <div className="lg:col-span-8">
            <Card className="corner-marks-full flex min-h-[420px] flex-col border-border/60 bg-card/90 md:h-[600px]">
              <span className="corner-tl" />
              <span className="corner-tr" />
              <span className="corner-bl" />
              <span className="corner-br" />

              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <MessageSquare className="size-4 text-teal" strokeWidth={1.75} />
                    工程智能体对话
                  </CardTitle>
                  {intentBadge && (
                    <Badge
                      variant="outline"
                      className={`gap-1 text-[10px] font-medium ${intentBadge.color}`}
                    >
                      <Brain className="size-2.5" />
                      已识别意图：{intentBadge.label}
                    </Badge>
                  )}
                  {onOpenConfig && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={onOpenConfig}
                      title="Agent 设置"
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <CardDescription className="font-mono text-[10px] tracking-wider">
                  AI CONVERSATION · 基于土木工程专业知识库
                </CardDescription>
              </CardHeader>

              {/* Messages */}
              <ScrollArea ref={scrollRef} className="flex-1 px-4">
                <div className="space-y-4 pb-4 pr-2">
                  {hasMessages ? (
                    messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex gap-3 ${
                        msg.role === 'user' ? 'flex-row-reverse' : ''
                      }`}
                    >
                      <div
                        className={`flex size-8 shrink-0 items-center justify-center ${
                          msg.role === 'user'
                            ? 'bg-primary/20 text-primary'
                            : 'bg-teal/20 text-teal'
                        }`}
                        style={{ borderRadius: '2px' }}
                      >
                        {msg.role === 'user' ? (
                          <User className="size-4" strokeWidth={1.75} />
                        ) : (
                          <Bot className="size-4" strokeWidth={1.75} />
                        )}
                      </div>
                      <div
                        className={`pres-chat-msg max-w-[80%] rounded-lg border p-3 text-sm leading-relaxed ${
                          msg.role === 'user'
                            ? 'border-primary/30 bg-primary/10 text-foreground'
                            : 'border-border/50 bg-background/60 text-foreground/90'
                        }`}
                      >
                        {msg.role === 'assistant' ? (
                          <div className="prose prose-sm max-w-none text-[13px] leading-relaxed dark:prose-invert">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {msg.content}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          <p>{msg.content}</p>
                        )}
                      </div>
                    </div>
                    ))
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center py-12 text-center">
                      <div className="flex size-14 items-center justify-center rounded-full bg-teal/10 text-teal">
                        <Sparkles className="size-6" />
                      </div>
                      <div className="mt-4 text-sm font-semibold text-foreground">开始你的第一次提问</div>
                      <div className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                        基于土木工程专业知识库，支持参数修改、方案对比、规范查询等多种行动型问答。试试点击下方推荐问题。
                      </div>
                    </div>
                  )}
                  {isLoading && hasMessages && (
                    <div className="flex gap-3">
                      <div
                        className="flex size-8 shrink-0 items-center justify-center bg-teal/20 text-teal"
                        style={{ borderRadius: '2px' }}
                      >
                        <Bot className="size-4" strokeWidth={1.75} />
                      </div>
                      <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-background/60 px-4 py-3 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin text-teal" />
                        <span>智能体思考中...</span>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* Input */}
              <div className="border-t border-border/40 p-3">
                {/* Quick questions */}
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {RECOMMENDED_QUESTIONS.map((q) => {
                    const Icon = q.icon;
                    return (
                      <button
                        key={q.text}
                        onClick={() => handleQuestionClick(q.text)}
                        disabled={isLoading}
                        className="inline-flex items-center gap-1 border border-border/40 bg-background/50 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-teal/40 hover:bg-teal/10 hover:text-teal disabled:opacity-50"
                        style={{ borderRadius: '2px' }}
                      >
                        <Icon className="size-2.5" />
                        {q.text}
                      </button>
                    );
                  })}
                </div>
                <form onSubmit={handleSubmit} className="relative">
                  <Textarea
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="继续追问，例如：修改参数、对比方案、查询规范..."
                    className="min-h-[64px] resize-none pr-16 text-sm"
                    disabled={isLoading}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    className="!absolute bottom-2 right-2 h-8"
                    disabled={isLoading || !inputValue.trim()}
                  >
                    <Send className="mr-1 h-3.5 w-3.5" />
                    发送
                  </Button>
                </form>
              </div>
            </Card>
          </div>

          {/* 右侧：当前工程状态 */}
          <div className="space-y-4 lg:col-span-4">
            {params && (
              <ProjectStatusCard
                params={params}
                schemes={schemes}
                recommendedId={recommendedSchemeId}
              />
            )}

            {/* 能力说明卡 */}
            <Card className="corner-marks border-border/50 bg-gradient-to-br from-card/80 to-background/50">
              <CardContent className="p-4">
                <div className="mb-2 flex items-center gap-2">
                  <div className="flex size-7 items-center justify-center rounded-sm bg-teal/15">
                    <Sparkles className="h-3.5 w-3.5 text-teal" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold leading-tight">智能体能力</div>
                    <div className="font-mono text-[9px] tracking-wider text-muted-foreground">
                      AGENT CAPABILITIES
                    </div>
                  </div>
                </div>
                <ul className="space-y-1.5 text-[11px] text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <ChevronRight className="mt-0.5 size-3 shrink-0 text-primary" />
                    <span>自然语言修改工程参数，自动重跑比选</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ChevronRight className="mt-0.5 size-3 shrink-0 text-primary" />
                    <span>多方案技术经济指标对比分析</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ChevronRight className="mt-0.5 size-3 shrink-0 text-primary" />
                    <span>国家规范条文查询与校核</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ChevronRight className="mt-0.5 size-3 shrink-0 text-primary" />
                    <span>施工风险、碳排放、装配率咨询</span>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
}

export default memo(ChatSection);
