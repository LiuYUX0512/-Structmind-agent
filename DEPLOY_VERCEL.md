# 智构 StructMind · Vercel 安全代理部署指南（30 分钟上线）

> 目标：前端不再持有 API Key，所有 LLM 请求经 `/api/chat` 服务端代理转发，代理层带请求频率限制。
> 完成后线上地址形如 `https://structmind.vercel.app`（可用 GitHub 仓库一键导入，**零命令行**）。

---

## 为什么需要后端代理

| | 改造前（GitHub Pages 纯静态） | 改造后（Vercel） |
|---|---|---|
| API Key 位置 | 浏览器 localStorage / 前端代码 | **服务端环境变量**（任何人看不到） |
| 请求路径 | 前端直连 DeepSeek | 前端 → `/api/chat` → 服务端 → DeepSeek |
| 频率限制 | 无 | ✅ 每 IP 60 次/分钟（代理层内置） |
| 评审风险 | 评委 F12 打开控制台即可看到 Key | 前端代码零 Key，无从泄露 |

---

## 已完成的代码改造（本仓库 main 分支）

```
api/chat.ts            ← Vercel Serverless Function：代理转发 + 白名单过滤 + 限流
vercel.json            ← Vercel 构建配置（vite build → dist/）
.env.example           ← 环境变量说明（不要提交真实 Key！）
src/agent/real-engine.ts  ← 前端默认走 /api/chat；直连模式仍兼容（自定义 Key）
src/agent/pipeline.ts     ← 真实模式校验适配代理
src/pages/HomePage/HomePage.tsx   ← 默认接口 /api/chat，代理模式无需 Key
src/components/AgentConfigPanel.tsx ← 配置面板：一键切换安全代理
```

前端行为变化：
- 打开站点 → 「Agent 设置」→ API 接口默认 `/api/chat`（**安全代理**），API Key 留空即可
- 面板新增「一键切换为安全代理」按钮；徽章显示「安全代理 · Key 由服务端保护」
- 直连模式仍可用（填 `https://api.deepseek.com/v1` + Key，Key 仅存本机浏览器）

---

## 部署步骤（10 分钟，全图形界面）

### 第 1 步 · 把代码推到 GitHub（已完成 ✅）
本仓库已推送到 `https://github.com/LiuYUX0512/-Structmind-agent`（main 分支含全部代码）。

### 第 2 步 · Vercel 导入仓库
1. 浏览器打开 **https://vercel.com** → 点右上角 **Sign Up**（用 **GitHub 账号登录**，免费，无需信用卡）
2. 登录后点 **Add New… → Project**
3. 列表里找到 **`-Structmind-agent`** → 点 **Import**
4. 框架选择 **Vite**（Vercel 会自动识别 `vercel.json`，无需手动配置）
5. **不要**点 Deploy——先做第 3 步

### 第 3 步 · 配置环境变量（Key 藏在这里）
在同一个页面点 **Environment Variables** 添加：

| Name | Value |
|---|---|
| `DEEPSEEK_API_KEY` | 你的 DeepSeek Key（`sk-...`） |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1`（可选，默认就是这个） |

> ⚠️ 这一步是**唯一**需要填 Key 的地方。填完 Key 只存在于 Vercel 服务端，任何人访问你的网站都看不到它。

### 第 4 步 · Deploy
点 **Deploy**，等 1-2 分钟构建完成，得到地址 `https://<你的项目名>.vercel.app`。

### 第 5 步 · 验证
1. 打开 `https://<你的项目名>.vercel.app`（手机电脑都能访问）
2. 「Agent 设置」确认 API 接口为 `/api/chat`、API Key 留空 → 保存
3. 选参数 → 点「启动方案智能生成」→ 应看到四 Agent 逐步思考 + 真实调用（非预演）
4. 浏览器 F12 → Network → 点开 `chat` 请求 → **确认无任何 `sk-` 字样**（Key 在服务端，前端只发 model/messages/tools）

---

## 维护与回滚

- **改代码后自动部署**：以后 `git push` 到 GitHub main，Vercel 自动重新构建部署，无需手动操作
- **换 Key / 换模型商**：Vercel 控制台 → Project → Settings → Environment Variables 修改后 Redeploy
- **回滚**：Vercel → Deployments → 选上一个版本 → 点 ⋯ → **Redeploy**
- **看日志**：Vercel → Project → Functions → `chat` → Logs（排查 429/504 等）

---

## 常见问题

**Q：请求报 429？** 触发频率限制（每 IP 60 次/分钟），演示时别连点；正常使用不可能触发。

**Q：报「服务端未配置 DEEPSEEK_API_KEY」？** 第 3 步环境变量没加，或加了没 Redeploy。检查 Settings → Environment Variables → 确认后 Deployments → Redeploy。

**Q：报 402 / 余额不足？** DeepSeek 账户需充值，Key 本身有效（此前已验证）。

**Q：还想保留 GitHub Pages 旧站？** 可以，两者互不影响：GitHub Pages 是静态站（无代理、演示模式可用）；Vercel 是完整版（代理 + 真实推理）。比赛提交用 Vercel 地址。

**Q：想换 Cloudflare Workers？** 备选方案：`api/chat.ts` 逻辑可直接平移到 Worker（改 export 为 `fetch` handler，环境变量同名），wrangler 部署 `workers.dev`。本仓库已按 Vercel 约定组织，切 CF 需小改函数签名。

---

## 技术细节（给评委的加分项）

- **白名单透传**：代理只转发 `model/messages/tools/tool_choice/temperature/stream/max_tokens/top_p`，其余字段一律丢弃，杜绝参数滥用
- **限流**：内存滑动窗口，每 IP 60 次/分钟，不同 IP 独立计数；429 返回中文友好提示
- **超时保护**：上游 60s 超时熔断，AbortController 中止，返回 504 明确提示
- **错误透传**：上游状态码原样透传（400/401/402/429/5xx），前端拿到即可中文解读
- **无依赖**：`api/chat.ts` 零第三方依赖，仅用 Node 内置 `http`，冷启动极快
