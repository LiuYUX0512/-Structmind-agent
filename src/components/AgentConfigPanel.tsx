// AgentConfigPanel — Agent 配置面板
// 配置 API 地址、模型名、API Key、推理模式，本地持久化
// 安全代理：API Key 由服务端环境变量持有，前端零暴露（推荐，比赛评审安全）
// EXPORTS: AgentConfigPanel

import { memo, useState, useEffect } from 'react';
import {
  Settings,
  KeyRound,
  Globe,
  Cpu,
  Save,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  ShieldCheck,
  Eye,
  EyeOff,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { logger } from '@lark-apaas/client-toolkit-lite';
import { toast } from 'sonner';
import { saveEngineConfig } from '@/agent';

interface AgentConfigPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 当前配置 */
  config: {
    apiBase: string;
    model: string;
    apiKey: string;
    mode: 'auto' | 'real' | 'demo';
  };
  onSave: (config: { apiBase: string; model: string; apiKey: string; mode: 'auto' | 'real' | 'demo' }) => void;
}

function AgentConfigPanel({ open, onOpenChange, config, onSave }: AgentConfigPanelProps) {
  const [localConfig, setLocalConfig] = useState(config);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLocalConfig(config);
  }, [config, open]);

  const isProxy = localConfig.apiBase.trim().startsWith('/');
  const hasKey = Boolean(localConfig.apiKey.trim());

  const useSecureProxy = () => {
    setLocalConfig({ ...localConfig, apiBase: '/api/chat', apiKey: '' });
    toast.info('已切换到安全代理模式：Key 由服务端保护，前端不再持有');
  };

  const handleSave = () => {
    // 同步保存到 agent engine 配置（real-engine 读取同一份数据）
    try {
      saveEngineConfig({
        endpoint: localConfig.apiBase || undefined,
        model: localConfig.model || undefined,
        apiKey: localConfig.apiKey || undefined,
        mode: localConfig.mode === 'demo' ? 'trace' : 'real',
      });
    } catch (e) {
      logger.warn('保存引擎配置失败:', String(e));
    }
    onSave(localConfig);
    setSaved(true);
    toast.success('配置已保存');
    setTimeout(() => setSaved(false), 1500);
    setTimeout(() => onOpenChange(false), 500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[540px] border-border/60 bg-card/95 backdrop-blur-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Settings className="size-5 text-primary" />
            Agent 推理配置
          </DialogTitle>
          <DialogDescription className="text-xs">
            推荐使用<strong className="text-teal">安全代理</strong>：API Key 存于服务端环境变量，前端零暴露；
            未配置任何推理能力时自动运行演示轨迹模式。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* 推理模式选择 */}
          <div className="space-y-2.5">
            <Label className="text-xs font-semibold text-foreground/80">推理模式</Label>
            <RadioGroup
              value={localConfig.mode}
              onValueChange={(v) =>
                setLocalConfig({ ...localConfig, mode: v as 'auto' | 'real' | 'demo' })
              }
              className="grid grid-cols-3 gap-2"
            >
              <div>
                <RadioGroupItem
                  value="auto"
                  id="mode-auto"
                  className="peer sr-only"
                />
                <Label
                  htmlFor="mode-auto"
                  className="flex h-full cursor-pointer flex-col items-start gap-1 rounded-md border border-border/50 bg-background/40 p-3 text-xs transition-all peer-data-[state=checked]:border-teal/50 peer-data-[state=checked]:bg-teal/[0.08] hover:border-border"
                >
                  <span className="font-semibold text-foreground">自动</span>
                  <span className="text-[10px] text-muted-foreground leading-relaxed">
                    代理/Key 就绪走真实推理，否则演示轨迹
                  </span>
                </Label>
              </div>
              <div>
                <RadioGroupItem
                  value="real"
                  id="mode-real"
                  className="peer sr-only"
                />
                <Label
                  htmlFor="mode-real"
                  className="flex h-full cursor-pointer flex-col items-start gap-1 rounded-md border border-border/50 bg-background/40 p-3 text-xs transition-all peer-data-[state=checked]:border-primary/50 peer-data-[state=checked]:bg-primary/[0.08] hover:border-border"
                >
                  <span className="font-semibold text-foreground">强制真实</span>
                  <span className="text-[10px] text-muted-foreground leading-relaxed">
                    必须走真实推理，配置不足时明确报错
                  </span>
                </Label>
              </div>
              <div>
                <RadioGroupItem
                  value="demo"
                  id="mode-demo"
                  className="peer sr-only"
                />
                <Label
                  htmlFor="mode-demo"
                  className="flex h-full cursor-pointer flex-col items-start gap-1 rounded-md border border-border/50 bg-background/40 p-3 text-xs transition-all peer-data-[state=checked]:border-amber/50 peer-data-[state=checked]:bg-amber/[0.08] hover:border-border"
                >
                  <span className="font-semibold text-foreground">强制演示</span>
                  <span className="text-[10px] text-muted-foreground leading-relaxed">
                    仅运行专家轨迹模板，不调用 LLM
                  </span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* API 地址 */}
          <div className="space-y-1.5">
            <Label htmlFor="api-base" className="text-xs font-medium flex items-center gap-1.5">
              <Globe className="size-3 text-muted-foreground" />
              API 接口
            </Label>
            <Input
              id="api-base"
              value={localConfig.apiBase}
              onChange={(e) => setLocalConfig({ ...localConfig, apiBase: e.target.value })}
              placeholder="/api/chat（安全代理）或 https://api.deepseek.com/v1（直连）"
              className="font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              <span className="text-teal">/api/chat</span> = 服务端代理（Key 在服务端，前端零暴露，推荐）
              ；<span className="text-muted-foreground">https://.../v1</span> = 直连（需填写 Key，仅存本机浏览器）。
            </p>
            {!isProxy && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1 h-7 text-[11px] text-teal"
                onClick={useSecureProxy}
              >
                <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                一键切换为安全代理（推荐）
              </Button>
            )}
          </div>

          {/* 模型名 */}
          <div className="space-y-1.5">
            <Label htmlFor="model" className="text-xs font-medium flex items-center gap-1.5">
              <Cpu className="size-3 text-muted-foreground" />
              模型名称
            </Label>
            <Select
              value={localConfig.model}
              onValueChange={(v) => setLocalConfig({ ...localConfig, model: v })}
            >
              <SelectTrigger className="font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="deepseek-chat" className="font-mono text-xs">deepseek-chat</SelectItem>
                <SelectItem value="deepseek-reasoner" className="font-mono text-xs">deepseek-reasoner</SelectItem>
                <SelectItem value="moonshot-v1-32k" className="font-mono text-xs">moonshot-v1-32k</SelectItem>
                <SelectItem value="gpt-4o-mini" className="font-mono text-xs">gpt-4o-mini</SelectItem>
                <SelectItem value="gpt-4o" className="font-mono text-xs">gpt-4o</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* API Key（仅直连模式需要） */}
          <div className="space-y-1.5">
            <Label htmlFor="api-key" className="text-xs font-medium flex items-center gap-1.5">
              <KeyRound className="size-3 text-muted-foreground" />
              API Key <span className="text-[10px] font-normal text-muted-foreground">（仅直连模式需要，代理模式留空）</span>
            </Label>
            <div className="relative">
              <Input
                id="api-key"
                type={showKey ? 'text' : 'password'}
                value={localConfig.apiKey}
                onChange={(e) => setLocalConfig({ ...localConfig, apiKey: e.target.value })}
                placeholder="sk-xxxxxxxxxxxxxxxx"
                className="pr-9 font-mono text-xs"
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="!absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              {isProxy ? (
                <Badge variant="outline" className="border-teal/40 bg-teal/10 text-teal text-[10px]">
                  <ShieldCheck className="mr-1 size-2.5" />
                  安全代理 · Key 由服务端保护
                </Badge>
              ) : hasKey ? (
                <Badge variant="outline" className="border-success/30 bg-success/10 text-success text-[10px]">
                  <CheckCircle2 className="mr-1 size-2.5" />
                  已配置直连 Key（仅存本机）
                </Badge>
              ) : (
                <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning text-[10px]">
                  <AlertCircle className="mr-1 size-2.5" />
                  未配置 Key（将运行演示模式）
                </Badge>
              )}
            </div>
          </div>

          {/* 模式说明 */}
          <div className="rounded-md border border-dashed border-border/50 bg-background/30 p-3 text-[11px] leading-relaxed">
            <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-teal" />
              推理链路说明
            </div>
            <ul className="space-y-1 text-muted-foreground">
              <li className="flex gap-2">
                <span className="font-mono text-teal">安全代理</span>
                <span>
                  请求 → <span className="font-mono">/api/chat</span> → 服务端持有 Key 转发到 DeepSeek。前端代码与浏览器均不接触 Key，评审演示零泄漏风险。
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-primary">直连</span>
                <span>
                  前端直接调用大模型 function calling，Agent 自主决定调用哪些工具、如何组织方案；Key 仅保存在本机浏览器。
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-amber">演示轨迹</span>
                <span>
                  基于真实结构计算+专家推理模板动态生成，计算结果与真实模式完全一致；无需网络与 API，适合答辩离线演示。
                </span>
              </li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            <X className="mr-1 h-3.5 w-3.5" />
            取消
          </Button>
          <Button size="sm" onClick={handleSave}>
            {saved ? (
              <>
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                已保存
              </>
            ) : (
              <>
                <Save className="mr-1 h-3.5 w-3.5" />
                保存配置
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default memo(AgentConfigPanel);
