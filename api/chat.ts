/**
 * 智构 StructMind · LLM 安全代理（Vercel Serverless Function）
 *
 * 职责：
 *  1. 前端不再持有 API Key —— Key 只存在于服务端环境变量 DEEPSEEK_API_KEY
 *  2. 转发 /api/chat → 上游 LLM 的 /chat/completions（OpenAI 兼容协议）
 *  3. 基本频率限制（内存滑动窗口，每 IP 60 次/分钟）
 *  4. 参数白名单透传，防止任意字段滥用
 *
 * 部署：项目根目录 api/ 文件夹自动被 Vercel 识别为 Serverless Functions。
 * 环境变量（Vercel 控制台 → Settings → Environment Variables）：
 *    DEEPSEEK_API_KEY  必填，你的 DeepSeek Key
 *    DEEPSEEK_BASE_URL 可选，默认 https://api.deepseek.com/v1（兼容通义等 OpenAI 接口）
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

// ============ 频率限制：内存滑动窗口 ============
const WINDOW_MS = 60_000; // 60 秒窗口
const RATE_LIMIT = 60; // 每 IP 每窗口 60 次
const hitMap = new Map<string, number[]>();

function getClientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const recent = (hitMap.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hitMap.set(ip, recent);
    return false;
  }
  recent.push(now);
  hitMap.set(ip, recent);
  return true;
}

// ============ 工具函数 ============
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

/** 透传白名单：只允许转发 LLM 请求所需的字段，杜绝额外字段滥用 */
const ALLOWED_BODY_KEYS = [
  'model',
  'messages',
  'tools',
  'tool_choice',
  'temperature',
  'stream',
  'max_tokens',
  'top_p',
] as const;

// ============ Handler ============
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // CORS（同源部署时浏览器不会触发跨域，保留以兼容自定义域名/本地调试）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    json(res, 405, { error: '仅支持 POST 请求' });
    return;
  }

  // 频率限制
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    json(res, 429, { error: '请求过于频繁，请稍后再试（每 IP 60 次/分钟）' });
    return;
  }

  // 服务端持有 Key
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    json(res, 500, {
      error: '服务端未配置 DEEPSEEK_API_KEY：请在 Vercel 控制台 → Settings → Environment Variables 中添加后重新部署。',
    });
    return;
  }

  // 解析并校验请求体
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    json(res, 400, { error: '请求体不是合法 JSON' });
    return;
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    json(res, 400, { error: 'messages 必须是非空数组' });
    return;
  }
  if (!body.model || typeof body.model !== 'string') {
    json(res, 400, { error: 'model 必填' });
    return;
  }

  // 白名单过滤
  const payload: Record<string, unknown> = {};
  for (const key of ALLOWED_BODY_KEYS) {
    if (body[key] !== undefined) payload[key] = body[key];
  }

  // 转发上游
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  const upstreamUrl = `${baseUrl}/chat/completions`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  try {
    const upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const upstreamText = await upstream.text();
    // 透传上游状态码与响应体（含 function calling 的 tool_calls 与 usage）
    res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(upstreamText);
  } catch (e) {
    clearTimeout(timer);
    const aborted = (e as Error)?.name === 'AbortError';
    json(res, 504, {
      error: aborted
        ? '上游 LLM 请求超时（60s），请稍后重试'
        : `代理转发失败：${String(e).slice(0, 200)}`,
    });
  }
}
