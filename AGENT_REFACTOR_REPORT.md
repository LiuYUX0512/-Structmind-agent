# 智构 StructMind · Agent 化重构总结报告

> 从「多 Agent 工作流」到「真正的多 Agent 智能体」——DAG 规划、主动记忆、元认知自我进化。

---

## 一、重构目标与病根

**原状**：四 Agent 管线（Architect → Code → Economist → Chief），双模式（演示/真实），12 个零幻觉计算工具。虽已具备回退机制，但：

1. **编排写死**：`pipeline.runCore()` 硬编码四阶段顺序，回退是孤立的 `for(loop<=2)`。
2. **无记忆**：每次运行都是"失忆的新手"，用户偏好、历史教训全部丢弃。
3. **无元认知**：Chief 只评价方案，不评价 Agent 团队的执行效率。

**目标**：一个"会思考、有记忆、能进化"的数字工程部。

---

## 二、最终架构（四层）

```
┌─────────────────────────────────────────────────────────┐
│ L1 意图层 intent.ts —— 参数解析 / 意图归一 / what-if      │
├─────────────────────────────────────────────────────────┤
│ L2 规划层 planner.ts —— Planner 生成 DAG 计划（依赖显式化）│
│       ↑ 注入：长期偏好 + 历史经验（memory.ts）              │
├─────────────────────────────────────────────────────────┤
│ L3 执行层 dag-engine.ts —— 拓扑调度/条件跳过/递归重规划     │
│       pipeline.ts —— static（保命） / dynamic（DAG）双模式 │
├─────────────────────────────────────────────────────────┤
│ L4 工具层 tools.ts —— 12 个零幻觉计算工具（大模型不做数值） │
└─────────────────────────────────────────────────────────┘
        ↓ 运行结束
┌─────────────────────────────────────────────────────────┐
│ 元认知 metacognition.ts —— 轨迹评估 → 结构化反思 → 经验库   │
│ 记忆 memory.ts —— 短期压缩 / 长期偏好 / 经验闭环            │
└─────────────────────────────────────────────────────────┘
```

---

## 三、三大模块交付明细

### 模块①：DAG 执行引擎（`dag-engine.ts` + `planner.ts`）

- 拓扑调度（deps 全部完成才执行）、条件跳过（`when`）、递归重规划（`replan` + `insertBefore`）、上限保护（`maxReplans`）。
- **依赖动态重定向**（`redirects`）：回退重出后，下游节点的 deps 自动指向最新节点，杜绝读到废弃中间结果。
- **规划/执行分离**：Planner 只输出拓扑，pipeline 绑定 executor。
- **代际兼容**：`plannerMode: 'static' | 'dynamic'`，默认 static（保命），二者默认模板下逐字段一致（影子并行）。

### 模块②：主动式记忆系统（`memory.ts`）

| 子系统 | 触发点 | 机制 |
|---|---|---|
| 短期记忆 | 节点边界，轨迹超 `compressThreshold`（默认 4000，UI 可调 800） | LLM（real）/规则（trace）提炼 3~5 条事实摘要，注入下一 Agent |
| 长期记忆 | 启动时 `scanPreferences` | 1-gram+2-gram 词频向量 + 余弦相似度，主动注入「⚠️ 记忆提示」；运行结束自动提炼偏好存库 |
| 经验记忆 | 启动时 `recallExperiences` | trigger 纯函数命中 → Planner 真实修改 DAG 拓扑（插入预校核节点） |

### 模块③：元认知与自我进化（`metacognition.ts`）

- **轨迹评估**：采集回退循环数、节点耗时、降级标记、token 估算、工具调用数。
- **结构化反思**：`IStrategyReflection{observation, diagnosis, lesson, applyTo, trigger}`（机器可读）。
- **双模式**：real 用 `LlmReflector`（独立 LLM 请求输出 JSON），trace 用 `RuleReflector`（规则检测，无 Key 也能演示）。
- **闭环激活**：`applyTo=planner` 的教训 → `insert-precheck` 经验 → 下次 Planner 真实插入预校核节点。

---

## 四、数据流（一次完整运行）

```
用户输入参数
  → intent.ts 解析意图
  → pipeline.execute()
      ├─ applyMemoryInjection()  扫描偏好，命中则注入「⚠️ 记忆提示」
      └─ Planner.buildPlan()
          ├─ buildDefaultPlan()  默认四阶段拓扑
          └─ applyExperiences()  命中经验 → 插入预校核节点
  → DagScheduler 调度执行（拓扑顺序，回退 = replan 递归重规划）
      ├─ 节点边界 compressStage()  超阈值 → 压缩摘要注入下一 Agent
      └─ 各节点记录耗时
  → runChief() 生成方案推荐 + 决策裁定
  → distillPreference()  提炼偏好存库
  → reflectAndStore()  采集轨迹 → 反思 → 写 finalResult.metacognition + storeExperience
  → 返回 IAgentPipelineResult（含 metacognition 可选字段）
```

---

## 五、保命底线（全程遵守）

- `runAgentPipeline` 签名、`IAgentPipelineResult` 结构**完全不变**（新增字段全部可选 `?`）。
- 演示模式（trace）全程离线可跑，无 API Key 也能演示完整闭环。
- 大模型不做数值计算（红线 1），12 个工具是零幻觉基石。
- 零重依赖：词频向量 + 原生 TS + 原生 fetch，无 LangChain/AutoGPT/向量数据库。

---

## 六、回归测试（9 套，312 项）

| 套件 | 项数 | 覆盖 |
|---|---|---|
| verify:norm | 30 | 规范判定层 |
| verify:domain | 22 | 领域模型 |
| verify:decision | 24 | 决策裁定层 |
| verify:counterfactual | 45 | 反事实推演 |
| verify:dag | 15 | DAG 引擎（含依赖重定向） |
| verify:memory | 23 | 记忆系统 |
| verify:metacognition | 12 | 元认知 |
| verify:entry | 13 | 真实模式管线 |
| verify:agentic | 128 | 专项（回退/乱序/人类在环等） |

全量 `typecheck 0` / `eslint src 0` / 生产构建通过。

---

## 七、下一步优化方向（非阻塞）

1. **动态规划深化**：Planner 目前是确定性模板 + 经验注入，可升级为 LLM 驱动的真正"自主规划"（需权衡 real 模式的 token 成本）。
2. **经验沉淀的通用化**：`reorder` / `skip-node` 拓扑操作已预留接口，未接入真实业务场景。
3. **轨迹指标的持久化**：跨会话统计 Agent 执行效率，形成"性能画像"。
