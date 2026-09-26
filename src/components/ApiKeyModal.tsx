import { useState, useEffect } from 'react';
import { scopedStorage } from '@lark-apaas/client-toolkit-lite';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Key, Settings, Check, AlertTriangle, Info } from 'lucide-react';
import { toast } from 'sonner';

const STORAGE_KEY_LLM_CONFIG = '__structopt_llm_config';

export interface ILlmConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  usePlugin: boolean;
}

const DEFAULT_CONFIG: ILlmConfig = {
  provider: 'openai-compatible',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  usePlugin: true,
};

const LLM_PROVIDERS = [
  { value: 'openai-compatible', label: 'OpenAI 兼容接口', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { value: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { value: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { value: 'zhipu', label: '智谱清言', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { value: 'custom', label: '自定义', baseUrl: '', model: '' },
];

interface ApiKeyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ApiKeyModal({ open, onOpenChange }: ApiKeyModalProps) {
  const [config, setConfig] = useState<ILlmConfig>(DEFAULT_CONFIG);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'idle' | 'success' | 'fail'>('idle');

  // Load saved config
  useEffect(() => {
    if (open) {
      try {
        const saved = scopedStorage.getItem(STORAGE_KEY_LLM_CONFIG);
        if (saved) {
          const parsed = JSON.parse(saved);
          setConfig(parsed);
          setApiKeyInput(parsed.apiKey ? '******' : '');
        }
      } catch {
        // ignore
      }
      setTestResult('idle');
    }
  }, [open]);

  const handleProviderChange = (value: string) => {
    const provider = LLM_PROVIDERS.find((p) => p.value === value);
    if (provider) {
      setConfig((prev) => ({
        ...prev,
        provider: value,
        baseUrl: provider.baseUrl || prev.baseUrl,
        model: provider.model || prev.model,
      }));
    }
  };

  const handleSave = () => {
    // If apiKeyInput is '******', keep the existing key
    const actualKey = apiKeyInput === '******' ? config.apiKey : apiKeyInput.trim();

    if (!actualKey) {
      toast.error('请输入 API 密钥');
      return;
    }

    const saved: ILlmConfig = { ...config, apiKey: actualKey };
    try {
      scopedStorage.setItem(STORAGE_KEY_LLM_CONFIG, JSON.stringify(saved));
      setConfig(saved);
      toast.success('API 配置已保存到本地浏览器');
      onOpenChange(false);
    } catch (e) {
      toast.error('保存失败');
    }
  };

  const handleTest = async () => {
    const actualKey = apiKeyInput === '******' ? config.apiKey : apiKeyInput.trim();
    if (!actualKey) {
      toast.error('请先输入 API 密钥');
      return;
    }

    setIsTesting(true);
    setTestResult('idle');

    try {
      const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${actualKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 5,
          stream: false,
        }),
      });

      if (response.ok) {
        setTestResult('success');
        toast.success('连接测试成功！');
      } else {
        const data = await response.json().catch(() => ({}));
        setTestResult('fail');
        toast.error(`连接失败：${data.error?.message || response.statusText}`);
      }
    } catch (e) {
      setTestResult('fail');
      toast.error('网络请求失败，请检查 Base URL 和网络连接');
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Settings className="size-5 text-primary" />
            大模型 API 配置
          </DialogTitle>
          <DialogDescription>
            配置您的大模型 API 密钥以启用 AI 方案生成与智能问答。密钥仅保存在您的本地浏览器中，不会上传到任何服务器。
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="llm" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="llm">大模型配置</TabsTrigger>
            <TabsTrigger value="plugin">内置插件</TabsTrigger>
          </TabsList>

          <TabsContent value="llm" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>API 服务商</Label>
              <Select value={config.provider} onValueChange={handleProviderChange}>
                <SelectTrigger>
                  <SelectValue placeholder="选择服务商" />
                </SelectTrigger>
                <SelectContent>
                  {LLM_PROVIDERS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>API 密钥</Label>
              <div className="flex gap-2">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="sk-..."
                  className="flex-1 font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowKey(!showKey)}
                >
                  <Key className="size-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                密钥仅保存在您的浏览器本地存储中（scopedStorage），与应用 ID 隔离。
              </p>
            </div>

            <div className="space-y-2">
              <Label>Base URL</Label>
              <Input
                value={config.baseUrl}
                onChange={(e) => setConfig((prev) => ({ ...prev, baseUrl: e.target.value }))}
                placeholder="https://api.example.com/v1"
                className="font-mono text-xs"
              />
            </div>

            <div className="space-y-2">
              <Label>模型名称</Label>
              <Input
                value={config.model}
                onChange={(e) => setConfig((prev) => ({ ...prev, model: e.target.value }))}
                placeholder="gpt-4o-mini"
                className="font-mono text-xs"
              />
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/5 p-3">
              <Info className="mt-0.5 size-4 shrink-0 text-info" />
              <div className="text-xs text-muted-foreground">
                <p className="font-medium text-foreground">使用说明</p>
                <p className="mt-1">
                  应用使用 OpenAI 兼容的 Chat Completions 接口。支持任何兼容该协议的大模型服务。
                  未配置密钥时，方案推荐与智能问答将使用内置插件能力或规则引擎兜底。
                </p>
              </div>
            </div>

            {testResult === 'success' && (
              <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 p-3 text-sm text-success">
                <Check className="size-4" />
                连接测试通过，模型可用
              </div>
            )}
            {testResult === 'fail' && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="size-4" />
                连接失败，请检查密钥和网络
              </div>
            )}
          </TabsContent>

          <TabsContent value="plugin" className="space-y-4 pt-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">内置 AI 插件</p>
              <p className="text-xs text-muted-foreground">
                应用内置 3 个 AI 插件实例（方案生成、方案推荐、智能问答），由平台提供大模型能力，无需您配置密钥即可使用。
              </p>
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 p-3">
                  <span className="text-sm">结构方案生成</span>
                  <span className="text-xs text-success">已启用</span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 p-3">
                  <span className="text-sm">方案对比推荐</span>
                  <span className="text-xs text-success">已启用</span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 p-3">
                  <span className="text-sm">土木工程问答</span>
                  <span className="text-xs text-success">已启用</span>
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <div className="text-xs text-muted-foreground">
                <p className="font-medium text-foreground">使用建议</p>
                <p className="mt-1">
                  配置自定义大模型后，对话推理质量将取决于所选模型。内置插件在演示环境下可能存在响应延迟或限流。
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" type="button" onClick={handleTest} disabled={isTesting}>
            {isTesting ? '测试中...' : '测试连接'}
          </Button>
          <Button type="button" onClick={handleSave}>
            保存配置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 获取保存的 LLM 配置 */
export function getLlmConfig(): ILlmConfig | null {
  try {
    const saved = scopedStorage.getItem(STORAGE_KEY_LLM_CONFIG);
    if (saved) {
      const parsed = JSON.parse(saved) as ILlmConfig;
      if (parsed.apiKey) return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

/** 流式调用 LLM Chat Completions，返回 AsyncIterable */
export async function* streamLlmChat(
  config: ILlmConfig,
  messages: { role: string; content: string }[],
  signal?: AbortSignal
): AsyncGenerator<{ content: string }, void, unknown> {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
      temperature: 0.7,
    }),
    signal,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') continue;

      try {
        const data = JSON.parse(dataStr);
        const delta = data.choices?.[0]?.delta?.content;
        if (delta) {
          yield { content: delta };
        }
      } catch {
        // skip malformed line
      }
    }
  }
}
