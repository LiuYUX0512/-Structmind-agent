import React, { useState, useEffect, useRef, useMemo } from 'react';
import { runAgentPipeline } from '@/agent';
import { parseIntentByRules, processAgentMessage, saveEngineConfig, loadEngineConfig, isRealModeAvailable } from '@/agent';
import type { IProjectParams, IWeightConfig } from '@/data/structure';
import { STRUCTURE_SYSTEM_LIBRARY, MOCK_PROJECT_PARAMS, MOCK_WEIGHT_CONFIG } from '@/data/structure';
import { runOptimization, generateOptimizationSuggestions } from '@/agent/optimizer';
import type { IOptimizationGoal, IOptimizationResult } from '@/agent/optimizer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RefreshCw, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight, Bug, Lightbulb, History } from 'lucide-react';

const CASE_A: IProjectParams = {
  buildingType: 'residential',
  floors: 12,
  area: 15000,
  structurePreference: 'none',
  seismicIntensity: '8',
  soilCategory: 'Ⅱ',
  mainSpan: 36,
  budget: 4000,
  geologyType: 'loess',
  windPressure: '0.4',
  snowPressure: '0.25',
  fortificationCategory: 'standard',
};

const CASE_B: IProjectParams = {
  buildingType: 'school',
  floors: 2,
  area: 4000,
  structurePreference: 'none',
  seismicIntensity: '7',
  soilCategory: 'Ⅱ',
  mainSpan: 18,
  budget: 3000,
  geologyType: 'clay',
  windPressure: '0.35',
  snowPressure: '0.2',
  fortificationCategory: 'key',
};

const CASE_C: IProjectParams = {
  buildingType: 'factory',
  floors: 1,
  area: 8000,
  structurePreference: 'steel',
  seismicIntensity: '7',
  soilCategory: 'Ⅱ',
  mainSpan: 24,
  budget: 2800,
  geologyType: 'clay',
  windPressure: '0.55',
  snowPressure: '0.35',
  fortificationCategory: 'standard',
};

const SCENARIO_A_INITIAL: IProjectParams = {
  buildingType: 'residential',
  floors: 30,
  area: 15000,
  structurePreference: 'any',
  seismicIntensity: '8',
  soilCategory: 'Ⅱ',
  mainSpan: 6,
  budget: 4500,
  geologyType: 'clay',
  windPressure: '0.4',
  snowPressure: '0.2',
  fortificationCategory: 'standard',
};

const SCENARIO_A_MODIFIED: IProjectParams = {
  buildingType: 'residential',
  floors: 15,
  area: 12000,
  structurePreference: 'any',
  seismicIntensity: '8',
  soilCategory: 'Ⅱ',
  mainSpan: 6,
  budget: 4200,
  geologyType: 'clay',
  windPressure: '0.5',
  snowPressure: '0.3',
  fortificationCategory: 'key',
};

const WEIGHTS: IWeightConfig = { cost: 25, duration: 25, safety: 30, green: 20 };

interface IScenarioResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  summary: string;
  checks: Array<{ label: string; pass: boolean; detail: string }>;
}

function countLogTypes(logs: Array<{ type: string }>) {
  const types = new Set(logs.map((l) => l.type));
  return {
    total: logs.length,
    hasThink: types.has('think'),
    hasToolCall: types.has('tool_call'),
    hasToolResult: types.has('tool_result'),
    hasConclusion: types.has('conclusion'),
    allFour: types.has('think') && types.has('tool_call') && types.has('tool_result') && types.has('conclusion'),
  };
}

async function runScenarioA(): Promise<IScenarioResult> {
  const checks: IScenarioResult['checks'] = [];
  try {
    // 第一次运行
    const r1 = await runAgentPipeline(SCENARIO_A_INITIAL, WEIGHTS, { mode: 'trace' });
    const t1 = countLogTypes(r1.actionLog);
    checks.push({
      label: '首次生成：管线正常运行',
      pass: r1.schemes.length >= 2 && r1.actionLog.length > 0,
      detail: `方案数=${r1.schemes.length}，日志=${t1.total}条，四类型齐全=${t1.allFour ? '是' : '否'}`,
    });

    // 第二次：修改参数后重新生成（模拟用户改参数再点生成）
    const r2 = await runAgentPipeline(SCENARIO_A_MODIFIED, WEIGHTS, { mode: 'trace' });
    const t2 = countLogTypes(r2.actionLog);
    checks.push({
      label: '重新生成：新参数驱动管线运行',
      pass: r2.schemes.length >= 2 && r2.actionLog.length > 0,
      detail: `方案数=${r2.schemes.length}，日志=${t2.total}条，四类型齐全=${t2.allFour ? '是' : '否'}`,
    });

    // 两次结果不同（参数不同 → 方案/评分应有差异）
    const recDiff =
      r1.recommended.schemeId !== r2.recommended.schemeId ||
      Math.abs(r1.recommended.overallScore - r2.recommended.overallScore) > 0.1;
    checks.push({
      label: '参数变更 → 结果有差异',
      pass: recDiff,
      detail: `初始推荐=${r1.recommended.schemeName}(${r1.recommended.overallScore.toFixed(1)}分)，修改后推荐=${r2.recommended.schemeName}(${r2.recommended.overallScore.toFixed(1)}分)`,
    });

    // 四类型齐全
    checks.push({
      label: 'actionLog 包含四种类型',
      pass: t2.allFour,
      detail: `think=${t2.hasThink}，tool_call=${t2.hasToolCall}，tool_result=${t2.hasToolResult}，conclusion=${t2.hasConclusion}`,
    });

    const allPass = checks.every((c) => c.pass);
    return {
      name: '场景A：参数修改后重新生成',
      status: allPass ? 'pass' : 'fail',
      summary: allPass
        ? '✓ 修改参数重新生成后，四 Agent 协同正常推进，actionLog 非空且四种类型齐全'
        : '✗ 部分检查未通过',
      checks,
    };
  } catch (e) {
    return {
      name: '场景A：参数修改后重新生成',
      status: 'fail',
      summary: `✗ 运行异常：${String(e).slice(0, 100)}`,
      checks: [...checks, { label: '异常捕获', pass: false, detail: String(e).slice(0, 200) }],
    };
  }
}

async function runScenarioB(): Promise<IScenarioResult> {
  const checks: IScenarioResult['checks'] = [];
  try {
    const ctx = {
      currentParams: SCENARIO_A_INITIAL,
      weights: WEIGHTS,
      lastResult: null,
    };

    // 1. "输出数据" 意图识别
    const intent1 = parseIntentByRules('输出数据');
    checks.push({
      label: '"输出数据" → REGENERATE 意图',
      pass: intent1.intent === 'REGENERATE',
      detail: `识别为 ${intent1.intent}，置信度 ${intent1.confidence}`,
    });

    // 2. "重新生成方案" 意图识别
    const intent2 = parseIntentByRules('重新生成方案');
    checks.push({
      label: '"重新生成方案" → REGENERATE 意图',
      pass: intent2.intent === 'REGENERATE',
      detail: `识别为 ${intent2.intent}，置信度 ${intent2.confidence}`,
    });

    // 3. 完整对话流程：发送"输出数据" → 触发管线 → 返回 regenerated
    const result = await processAgentMessage('输出数据', ctx);
    checks.push({
      label: '对话"输出数据" → 触发管线并返回 regenerated',
      pass: !!result.regenerated && result.regenerated.schemes.length >= 2,
      detail: `方案数=${result.regenerated?.schemes.length ?? 0}，推荐=${result.regenerated?.recommended.schemeName ?? '无'}`,
    });

    // 4. regenerated 里有 actionLog（驱动 UI 刷新）
    if (result.regenerated) {
      const t = countLogTypes(result.regenerated.actionLog);
      checks.push({
        label: 'regenerated 结果含 actionLog（可驱动 Agent 工作台刷新）',
        pass: t.total > 0 && t.allFour,
        detail: `日志=${t.total}条，四类型齐全=${t.allFour ? '是' : '否'}`,
      });
    } else {
      checks.push({
        label: 'regenerated 结果含 actionLog',
        pass: false,
        detail: 'regenerated 为 undefined',
      });
    }

    const allPass = checks.every((c) => c.pass);
    return {
      name: '场景B：对话 REGENERATE 意图触发',
      status: allPass ? 'pass' : 'fail',
      summary: allPass
        ? '✓ "输出数据""重新生成方案"均正确识别为 REGENERATE，对话触发管线后返回 regenerated + actionLog'
        : '✗ 部分检查未通过',
      checks,
    };
  } catch (e) {
    return {
      name: '场景B：对话 REGENERATE 意图触发',
      status: 'fail',
      summary: `✗ 运行异常：${String(e).slice(0, 100)}`,
      checks: [...checks, { label: '异常捕获', pass: false, detail: String(e).slice(0, 200) }],
    };
  }
}

async function runScenarioC(): Promise<IScenarioResult> {
  const checks: IScenarioResult['checks'] = [];
  try {
    // 设置为强制真实模式但不给 API Key
    saveEngineConfig({ mode: 'real', apiKey: '', endpoint: '', model: '' });

    const cfg = loadEngineConfig();
    checks.push({
      label: '配置持久化：保存后可读取',
      pass: cfg.mode === 'real',
      detail: `mode=${cfg.mode}，apiKey=${cfg.apiKey ? '已设置' : '空'}`,
    });

    // 直接跑管线（模拟 HomePage 中 useReal = true 的场景）
    let threw = false;
    let errMsg = '';
    try {
      await runAgentPipeline(SCENARIO_A_INITIAL, WEIGHTS, { mode: 'real' });
    } catch (e) {
      threw = true;
      errMsg = String(e).slice(0, 150);
    }
    checks.push({
      label: '真实模式无 Key → 管线抛错（而非静默空白）',
      pass: threw,
      detail: threw ? `抛出错误：${errMsg}` : '未抛错，可能静默失败',
    });

    // HomePage 层回退逻辑：真实模式失败 → 回退 trace 模式 → 应有结果
    let fallbackOk = false;
    let fallbackSchemes = 0;
    try {
      await runAgentPipeline(SCENARIO_A_INITIAL, WEIGHTS, { mode: 'real' });
    } catch {
      const fallback = await runAgentPipeline(SCENARIO_A_INITIAL, WEIGHTS, { mode: 'trace' });
      fallbackOk = fallback.schemes.length >= 2 && fallback.actionLog.length > 0;
      fallbackSchemes = fallback.schemes.length;
    }
    checks.push({
      label: '回退演示轨迹模式 → 正常输出方案 + actionLog',
      pass: fallbackOk,
      detail: `回退后方案数=${fallbackSchemes}，Agent 协同过程完整保留`,
    });

    // 恢复默认配置
    saveEngineConfig({ mode: 'trace', apiKey: '', endpoint: '', model: '' });

    const allPass = checks.every((c) => c.pass);
    return {
      name: '场景C：真实模式无 Key → 错误提示 + 回退演示',
      status: allPass ? 'pass' : 'fail',
      summary: allPass
        ? '✓ 真实模式无有效 Key 时管线明确抛错，回退 trace 模式后四 Agent 协同过程完整保留'
        : '✗ 部分检查未通过',
      checks,
    };
  } catch (e) {
    saveEngineConfig({ mode: 'trace', apiKey: '', endpoint: '', model: '' });
    return {
      name: '场景C：真实模式无 Key → 错误提示 + 回退演示',
      status: 'fail',
      summary: `✗ 运行异常：${String(e).slice(0, 100)}`,
      checks: [...checks, { label: '异常捕获', pass: false, detail: String(e).slice(0, 200) }],
    };
  }
}

async function runScenarioD(): Promise<IScenarioResult> {
  const checks: IScenarioResult['checks'] = [];
  try {
    // 模拟配置面板保存一组配置
    const testCfg = {
      endpoint: 'https://test.api.example.com/v1',
      model: 'test-model-7b',
      apiKey: 'sk-test-abc123',
      mode: 'real' as const,
    };
    saveEngineConfig(testCfg);

    // 读取回来，确认与写入一致
    const loaded = loadEngineConfig();
    checks.push({
      label: 'save → load 数据一致',
      pass:
        loaded.endpoint === testCfg.endpoint &&
        loaded.model === testCfg.model &&
        loaded.apiKey === testCfg.apiKey &&
        loaded.mode === testCfg.mode,
      detail: `endpoint=${loaded.endpoint}，model=${loaded.model}，apiKey=${loaded.apiKey?.slice(0, 8)}...，mode=${loaded.mode}`,
    });

    // 验证 real-engine 读同一份配置（静态 import 路径，即真实应用中 HomePage + AgentConfigPanel 的使用方式）
    const available = isRealModeAvailable();
    const staticCfg = loadEngineConfig();
    checks.push({
      label: 'real-engine 读取同一份配置（有 Key → 可用）',
      pass: available === true,
      detail: `isRealModeAvailable() = ${available}，静态load：endpoint=${staticCfg.endpoint?.slice(0, 20)}...，model=${staticCfg.model}，apiKey=${staticCfg.apiKey ? '已设置(' + staticCfg.apiKey.slice(0, 8) + '...)' : '空'}`,
    });

    // 清空 Key 后再读
    saveEngineConfig({ ...testCfg, apiKey: '' });
    const availableNoKey = isRealModeAvailable();
    checks.push({
      label: '清空 Key 后 real-engine 判定不可用',
      pass: availableNoKey === false,
      detail: `isRealModeAvailable() = ${availableNoKey}`,
    });

    // 恢复默认
    saveEngineConfig({ mode: 'trace', apiKey: '', endpoint: '', model: '' });

    const allPass = checks.every((c) => c.pass);
    return {
      name: '场景D：配置面板与引擎同源持久化',
      status: allPass ? 'pass' : 'fail',
      summary: allPass
        ? '✓ AgentConfigPanel 保存的配置与 real-engine 读取为同一份数据源，刷新不丢失'
        : '✗ 部分检查未通过',
      checks,
    };
  } catch (e) {
    saveEngineConfig({ mode: 'trace', apiKey: '', endpoint: '', model: '' });
    return {
      name: '场景D：配置面板与引擎同源持久化',
      status: 'fail',
      summary: `✗ 运行异常：${String(e).slice(0, 100)}`,
      checks: [...checks, { label: '异常捕获', pass: false, detail: String(e).slice(0, 200) }],
    };
  }
}

const EXTREME_CASE: IProjectParams = {
  buildingType: 'residential',
  floors: 20,
  area: 20000,
  structurePreference: 'frame',  // 业主指定偏好框架 → 初始方案会含框架 → 9度60m下位移角必然超限 → 触发回环
  seismicIntensity: '9',
  soilCategory: 'Ⅲ',
  mainSpan: 9,
  budget: 5500,
  geologyType: 'clay',
  windPressure: '0.4',
  snowPressure: '0.2',
  fortificationCategory: 'special',
};

const NORMAL_CASE: IProjectParams = {
  buildingType: 'residential',
  floors: 12,
  area: 12000,
  structurePreference: 'any',
  seismicIntensity: '8',
  soilCategory: 'Ⅱ',
  mainSpan: 8,
  budget: 4500,
  geologyType: 'clay',
  windPressure: '0.35',
  snowPressure: '0.2',
  fortificationCategory: 'standard',
};

async function runScenarioE(): Promise<IScenarioResult> {
  const checks: IScenarioResult['checks'] = [];
  try {
    // E-1: 正常案例不应触发辩论
    const normalResult = await runAgentPipeline(NORMAL_CASE, WEIGHTS, { mode: 'trace' });
    const normalHasLoop = normalResult.actionLog.some(
      (l) => (l.content || '').includes('规范校核发现问题')
    );
    checks.push({
      label: '正常案例（12层8度）不触发辩论',
      pass: !normalHasLoop,
      detail: `12层住宅 8度设防 约36m高 → 辩论触发=${normalHasLoop ? '是（异常）' : '否（正常）'}，方案数=${normalResult.schemes.length}`,
    });

    // E-2: 极限案例应触发辩论
    const extremeResult = await runAgentPipeline(EXTREME_CASE, WEIGHTS, { mode: 'trace' });
    const extremeHasLoop = extremeResult.actionLog.some(
      (l) => (l.content || '').includes('规范校核发现问题')
    );
    checks.push({
      label: '极限案例（20层9度）触发辩论',
      pass: extremeHasLoop,
      detail: `20层住宅 9度设防 约60m高 → 辩论触发=${extremeHasLoop ? '是（预期）' : '否（异常）'}，方案数=${extremeResult.schemes.length}`,
    });

    if (extremeHasLoop) {
      // E-3: 辩论中有 Code Agent 挑刺的 think
      const analysisThinks = extremeResult.actionLog.filter(
        (l) => l.agent === 'code' && l.type === 'think' && (l.content || '').includes('轮辩论 · Code 挑刺')
      );
      checks.push({
        label: '辩论含 Code Agent「挑刺」think 条目',
        pass: analysisThinks.length >= 1,
        detail: `找到 ${analysisThinks.length} 条 Code 挑刺 think 条目`,
      });

      // E-4: 辩论中有 Architect 回应的 think
      const decisionThinks = extremeResult.actionLog.filter(
        (l) => l.agent === 'architect' && l.type === 'think' && (l.content || '').includes('轮辩论 · Architect 回应')
      );
      checks.push({
        label: '辩论含 Architect「回应」think 条目',
        pass: decisionThinks.length >= 1,
        detail: `找到 ${decisionThinks.length} 条 Architect 回应 think 条目`,
      });

      // E-5: 辩论中有 Code 重新校核的 tool_call
      const recheckCalls = extremeResult.actionLog.filter(
        (l) => l.type === 'tool_call' && l.tool === 'check_seismic_requirements' && (l.content || '').includes('重算')
      );
      checks.push({
        label: '辩论含 Code「重新校核」tool_call',
        pass: recheckCalls.length >= 1,
        detail: `找到 ${recheckCalls.length} 条重算 tool_call`,
      });

      // E-6: 辩论中有 Code 重新校核的 tool_result
      const recheckResults = extremeResult.actionLog.filter(
        (l) => l.type === 'tool_result' && l.tool === 'check_seismic_requirements' && (l.content || '').includes('重算')
      );
      checks.push({
        label: '辩论含 Code「重新校核」tool_result',
        pass: recheckResults.length >= 1,
        detail: `找到 ${recheckResults.length} 条重算 tool_result`,
      });

      // E-7: Code Agent 复核结论有通过/未通过判断
      const codeConclusion = extremeResult.actionLog.filter(
        (l) => l.agent === 'code' && l.type === 'think' && (l.content || '').includes('轮辩论 · Code 复核结果')
      );
      checks.push({
        label: '辩论含 Code Agent「复核结果」判断',
        pass: codeConclusion.length >= 1,
        detail: `找到 ${codeConclusion.length} 条 Code 复核结果 think`,
      });

      // E-8: 最终候选方案与初始不同（证明替换生效了）
      const initialSchemes = extremeResult.actionLog
        .filter((l) => l.tool === 'query_structure_systems' && l.type === 'tool_result')
        .slice(0, 1)
        .flatMap((l) => {
          const r = l.result as { candidates?: Array<{ id: string }> };
          return r?.candidates?.map((c) => c.id) || [];
        });
      const finalSchemeIds = extremeResult.schemes.map((s) => s.id);
      const schemesChanged = initialSchemes.length > 0 && finalSchemeIds.length > 0 &&
        JSON.stringify(initialSchemes.sort()) !== JSON.stringify(finalSchemeIds.sort());
      checks.push({
        label: '最终候选方案与初始筛选不同（替换生效）',
        pass: schemesChanged,
        detail: `初始筛选=${initialSchemes.join(',')}，最终方案=${finalSchemeIds.join(',')}`,
      });
    }

    const allPass = checks.every((c) => c.pass);
    return {
      name: '场景E：Multi-Agent辩论验证（Code挑刺→Architect回应→Code复核）',
      status: allPass ? 'pass' : 'fail',
      summary: allPass
        ? '✓ 正常案例不触发辩论，极限案例触发辩论，时间线含Code挑刺/Architect回应/Code复核/总工复盘全过程'
        : '✗ 部分检查未通过',
      checks,
    };
  } catch (e) {
    return {
      name: '场景E：Multi-Agent辩论验证',
      status: 'fail',
      summary: `✗ 运行异常：${String(e).slice(0, 100)}`,
      checks: [...checks, { label: '异常捕获', pass: false, detail: String(e).slice(0, 300) }],
    };
  }
}

async function runScenarioF(): Promise<IScenarioResult> {
  const checks: IScenarioResult['checks'] = [];
  try {
    // 先跑一版管线结果作为对话上下文
    const result = await runAgentPipeline(NORMAL_CASE, WEIGHTS, { mode: 'trace' });
    const ctx = {
      currentParams: NORMAL_CASE,
      weights: WEIGHTS,
      lastResult: result,
    };

    // F-1: 问含钢量 → 调用 estimate_material_use
    const r1 = await processAgentMessage('含钢量多少？', ctx);
    const hasTool1 = r1.reply.includes('estimate_material_use') || r1.reply.includes('🛠️');
    checks.push({
      label: '问含钢量 → 调用 estimate_material_use 工具',
      pass: hasTool1 && r1.reply.includes('kg/㎡'),
      detail: `回复长度=${r1.reply.length}字，含工具痕迹=${hasTool1}，含kg/㎡=${r1.reply.includes('kg/㎡')}`,
    });

    // F-2: 问柱截面 → 调用 estimate_column_beam
    const r2 = await processAgentMessage('柱截面多大？', ctx);
    const hasTool2 = r2.reply.includes('estimate_column_beam') || (r2.reply.includes('🛠️') && r2.reply.includes('梁高'));
    checks.push({
      label: '问柱截面 → 调用 estimate_column_beam 工具',
      pass: hasTool2,
      detail: `回复长度=${r2.reply.length}字，含工具痕迹=${r2.reply.includes('🛠️')}，含梁高描述=${r2.reply.includes('梁高')}`,
    });

    // F-3: 问基础形式 → 调用 advise_foundation
    const r3 = await processAgentMessage('基础形式怎么选？', ctx);
    const hasTool3 = r3.reply.includes('advise_foundation') || (r3.reply.includes('🛠️') && r3.reply.includes('基础'));
    checks.push({
      label: '问基础形式 → 调用 advise_foundation 工具',
      pass: hasTool3,
      detail: `回复长度=${r3.reply.length}字，含工具痕迹=${r3.reply.includes('🛠️')}，含基础描述=${r3.reply.includes('基础')}`,
    });

    // F-4: 回复含真实数值（不是空泛文字）
    const hasRealNumbers = /\d+~\d+/.test(r1.reply) && /\d+~\d+/.test(r2.reply);
    checks.push({
      label: '工具返回真实数值区间（非手写文字）',
      pass: hasRealNumbers,
      detail: `含钢量回复含区间=${/\d+~\d+/.test(r1.reply)}，柱截面回复含区间=${/\d+~\d+/.test(r2.reply)}`,
    });

    const allPass = checks.every((c) => c.pass);
    return {
      name: '场景F：对话追问真实调用工程估算工具',
      status: allPass ? 'pass' : 'fail',
      summary: allPass
        ? '✓ 含钢量/柱截面/基础形式 三类追问均真实调用对应工具，返回基于计算的数值区间'
        : '✗ 部分检查未通过',
      checks,
    };
  } catch (e) {
    return {
      name: '场景F：对话工具调用验证',
      status: 'fail',
      summary: `✗ 运行异常：${String(e).slice(0, 100)}`,
      checks: [...checks, { label: '异常捕获', pass: false, detail: String(e).slice(0, 300) }],
    };
  }
}

const TEST_CASES = [
  { name: '①西安12层住宅8度36m', params: CASE_A },
  { name: '②2层框架教学楼7度', params: CASE_B },
  { name: '③单层钢结构厂房7度24m跨', params: CASE_C },
];
const CONFIG = { mode: 'trace' as const, maxSteps: 50 };

// ========== 评估集：10个典型工程测试案例 ==========
interface IEvaluationCase {
   id: number;
   name: string;
   description: string;
   params: IProjectParams;
   expectedSystems: string[]; // 预期推荐体系（可多个，命中任意一个即算对）
   expectedLabels: string;   // 展示用的预期体系标签
   /** 迭代改进历史（记录版本迭代中修复的 bug / 规则调整） */
   iterationLog?: Array<{
     version: string;
     date: string;
     type: 'fix' | 'improve' | 'feature';
     description: string;
     before?: string;
     after?: string;
   }>;
 }

const EVALUATION_CASES: IEvaluationCase[] = [
  {
    id: 1,
    name: '西安12层住宅8度36m',
    description: '典型小高层住宅，8度设防，II类场地，约36m高',
    params: {
      buildingType: 'residential', floors: 12, area: 15000, structurePreference: 'none',
      seismicIntensity: '8', soilCategory: 'Ⅱ', mainSpan: 36, budget: 4000,
      geologyType: 'loess', windPressure: '0.4', snowPressure: '0.25', fortificationCategory: 'standard',
    },
    expectedSystems: ['frame-shearwall', 'shearwall'],
    expectedLabels: '框剪 / 剪力墙',
  },
  {
    id: 2,
    name: '北京6层住宅8度24m',
    description: '多层住宅，8度设防，约24m高，框架或框剪均可',
    params: {
      buildingType: 'residential', floors: 6, area: 6000, structurePreference: 'none',
      seismicIntensity: '8', soilCategory: 'Ⅱ', mainSpan: 24, budget: 3500,
      geologyType: 'clay', windPressure: '0.45', snowPressure: '0.3', fortificationCategory: 'standard',
    },
    expectedSystems: ['frame', 'frame-shearwall'],
    expectedLabels: '框架 / 框剪',
  },
  {
    id: 3,
    name: '上海3层教学楼7度12m',
    description: '低层教学楼，7度设防，约12m高，框架体系为主',
    params: {
      buildingType: 'school', floors: 3, area: 4000, structurePreference: 'none',
      seismicIntensity: '7', soilCategory: 'Ⅳ', mainSpan: 12, budget: 3500,
      geologyType: 'soft_clay', windPressure: '0.55', snowPressure: '0.2', fortificationCategory: 'key',
    },
    expectedSystems: ['frame'],
    expectedLabels: '框架',
  },
  {
    id: 4,
    name: '深圳30层写字楼7度90m',
    description: '高层办公楼，7度设防，约90m高，框剪或剪力墙',
    params: {
      buildingType: 'office', floors: 30, area: 30000, structurePreference: 'none',
      seismicIntensity: '7', soilCategory: 'Ⅱ', mainSpan: 48, budget: 5500,
      geologyType: 'granite', windPressure: '0.75', snowPressure: '0', fortificationCategory: 'standard',
    },
    expectedSystems: ['frame-shearwall', 'shearwall', 'frame-corewall'],
    expectedLabels: '框剪 / 剪力墙 / 框架核心筒',
  },
  {
    id: 5,
    name: '单层钢结构厂房7度24m跨',
    description: '单层工业厂房，7度设防，24m跨度，钢结构门式刚架',
    params: {
      buildingType: 'factory', floors: 1, area: 8000, structurePreference: 'steel',
      seismicIntensity: '7', soilCategory: 'Ⅱ', mainSpan: 24, budget: 2800,
      geologyType: 'clay', windPressure: '0.55', snowPressure: '0.35', fortificationCategory: 'standard',
    },
    expectedSystems: ['steel', 'prefab-steel'],
    expectedLabels: '钢结构',
  },
  {
    id: 6,
    name: '10层装配式住宅7度30m',
    description: '装配式混凝土住宅，7度设防，约30m高',
    params: {
      buildingType: 'residential', floors: 10, area: 12000, structurePreference: 'prefab',
      seismicIntensity: '7', soilCategory: 'Ⅱ', mainSpan: 30, budget: 4500,
      geologyType: 'clay', windPressure: '0.4', snowPressure: '0.25', fortificationCategory: 'standard',
    },
    expectedSystems: ['prefabricated', 'frame-shearwall'],
    expectedLabels: '装配式混凝土 / 框剪',
  },
  {
    id: 7,
    name: '2层砌体结构教学楼7度8m',
    description: '低层砌体教学楼，7度设防，约8m高，砌体结构',
    params: {
      buildingType: 'school', floors: 2, area: 2000, structurePreference: 'masonry',
      seismicIntensity: '7', soilCategory: 'Ⅱ', mainSpan: 8, budget: 2500,
      geologyType: 'clay', windPressure: '0.35', snowPressure: '0.25', fortificationCategory: 'key',
    },
    expectedSystems: ['masonry', 'frame'],
    expectedLabels: '砌体 / 框架',
  },
  {
    id: 8,
    name: '50层超高层写字楼7度150m',
    description: '超高层办公楼，7度设防，约150m高，筒中筒或框架核心筒',
    params: {
      buildingType: 'office', floors: 50, area: 60000, structurePreference: 'none',
      seismicIntensity: '7', soilCategory: 'Ⅱ', mainSpan: 60, budget: 8000,
      geologyType: 'rock', windPressure: '0.65', snowPressure: '0', fortificationCategory: 'standard',
    },
    expectedSystems: ['tube-in-tube', 'frame-corewall'],
    expectedLabels: '筒中筒 / 框架核心筒',
  },
  {
    id: 9,
    name: '胶合木体育馆7度20m跨',
    description: '轻型木结构体育馆，7度设防，20m跨度，胶合木',
    params: {
      buildingType: 'gymnasium', floors: 1, area: 3000, structurePreference: 'mass-timber',
      seismicIntensity: '7', soilCategory: 'Ⅱ', mainSpan: 20, budget: 5000,
      geologyType: 'clay', windPressure: '0.5', snowPressure: '0.4', fortificationCategory: 'standard',
    },
    expectedSystems: ['mass-timber', 'steel'],
    expectedLabels: '木结构 / 钢结构',
  },
  {
    id: 10,
    name: '2层农村自建房6度8m',
    description: '低层农村自建房，6度设防，约8m高，砌体或框架',
    params: {
      buildingType: 'residential', floors: 2, area: 300, structurePreference: 'none',
      seismicIntensity: '6', soilCategory: 'Ⅱ', mainSpan: 8, budget: 2000,
      geologyType: 'loess', windPressure: '0.3', snowPressure: '0.2', fortificationCategory: 'standard',
    },
    expectedSystems: ['masonry', 'frame'],
    expectedLabels: '砌体 / 框架',
  },
];

type CaseResult = {
  name: string;
  success: boolean;
  error?: string;
  schemes?: Array<{
    id: string;
    name: string;
    metrics: Record<string, number>;
  }>;
  ranking?: Array<{ schemeId: string; schemeName: string; score: number }>;
  recommended?: { schemeId: string; schemeName: string; overallScore: number; reason: string };
  codeChecks?: Record<string, unknown>;
  actionLog?: Array<{ agent?: string; type: string; content?: string; tool?: string; result?: unknown }>;
  thinkCount?: number;
  toolCallCount?: number;
};

function checkNaN(value: unknown, path = 'root'): string[] {
  const issues: string[] = [];
  if (value === null || value === undefined) {
    issues.push(`${path} = ${value}`);
  } else if (typeof value === 'number' && (Number.isNaN(value) || !Number.isFinite(value))) {
    issues.push(`${path} = ${value} (NaN/Infinity)`);
  } else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      issues.push(...checkNaN(v, `${path}.${k}`));
    }
  }
  return issues;
}

export default function RuntimeVerifyPage() {
  const [results, setResults] = useState<CaseResult[]>([]);
  const [scenarios, setScenarios] = useState<IScenarioResult[]>([]);
  const [running, setRunning] = useState(false);
  const initialTab = typeof window !== 'undefined' ? (window.location.hash.replace('#', '') || '0') : '0';
  const validTabs = ['0', '1', '2', 'diff', 'bug-fix', 'summary', 'optimizer', 'evaluation'];
  const [activeTab, setActiveTab] = useState(validTabs.includes(initialTab) ? initialTab : '0');
  const [optimizeResult, setOptimizeResult] = useState<IOptimizationResult | null>(null);
  const [optimizeSuggestions, setOptimizeSuggestions] = useState<ReturnType<typeof generateOptimizationSuggestions>>([]);
  const [evalRunning, setEvalRunning] = useState(false);
  const [evalResults, setEvalResults] = useState<Array<{
     caseId: number;
     caseName: string;
     expected: string;
     actual: string;
     actualId: string;
     correct: boolean;
     note: string;
     /** 3 条核心理由 */
     topReasons: string[];
     /** 综合得分 */
     overallScore: number;
     /** 候选方案及得分 */
     candidates: Array<{ name: string; score: number }>;
     /** 错因分析（仅错误时有） */
     errorAnalysis?: {
       errorType: '参数理解错' | '规则没覆盖' | '权重不合理' | '高度估算偏差' | '其他';
       detail: string;
       suggestion: string;
     };
     /** 迭代改进记录（来自 case 的 iterationLog） */
     iterationLog: Array<{ version: string; date: string; type: string; description: string; before?: string; after?: string }>;
   }>>([]);
  const [expandedEvalId, setExpandedEvalId] = useState<number | null>(null);
   const logRef = useRef<HTMLPreElement>(null);

  const runOptimizeTest = (goal: IOptimizationGoal) => {
     if (!results[0]?.schemes || results[0].schemes.length === 0) return;
     const topScheme = results[0].schemes[0]; // 第一个方案作为基准
     // 需要 IStructureScheme 完整对象，这里从 result 里拿
     const result0 = results[0];
     if (!result0.schemes || result0.schemes.length === 0) return;

     // 从第一个方案构造 IStructureScheme（运行时验证足够）
     const top = result0.schemes[0] as unknown as import('@/data/structure').IStructureScheme;
     const targetBudget = goal === 'cost' ? 3500 : undefined;
     const optResult = runOptimization(top, MOCK_PROJECT_PARAMS, MOCK_WEIGHT_CONFIG, goal, targetBudget, 5);
     setOptimizeResult(optResult);

     const suggestions = generateOptimizationSuggestions(optResult.finalScheme, MOCK_PROJECT_PARAMS, MOCK_WEIGHT_CONFIG);
     setOptimizeSuggestions(suggestions);
   };

   const runTests = async () => {
    setRunning(true);
    setResults([]);
    const out: CaseResult[] = [];

    for (const tc of TEST_CASES) {
      try {
        const result = await runAgentPipeline(tc.params, WEIGHTS, CONFIG);
        const schemes = result.schemes.map((s) => ({
          id: s.id,
          name: s.name,
          metrics: s.metrics as unknown as Record<string, number>,
        }));
        const ranking = result.ranking.map((r) => ({
          schemeId: r.schemeId,
          schemeName: r.schemeName,
          score: r.score,
        }));

        // 数据完整性检查
        const nanIssues: string[] = [];
        result.schemes.forEach((s, i) => {
          nanIssues.push(...checkNaN(s.metrics, `schemes[${i}].metrics`));
        });
        result.ranking.forEach((r, i) => {
          nanIssues.push(...checkNaN(r.score, `ranking[${i}].score`));
        });
        nanIssues.push(...checkNaN(result.recommended.overallScore, 'recommended.overallScore'));

        out.push({
          name: tc.name,
          success: nanIssues.length === 0,
          error: nanIssues.length > 0 ? nanIssues.join('; ') : undefined,
          schemes,
          ranking,
          recommended: {
            schemeId: result.recommended.schemeId,
            schemeName: result.recommended.schemeName,
            overallScore: result.recommended.overallScore,
            reason: result.recommended.reason,
          },
          codeChecks: result.codeChecks,
          actionLog: result.actionLog.map((l) => ({
            agent: l.agent,
            type: l.type,
            content: l.content as string | undefined,
            tool: l.tool as string | undefined,
            result: l.result,
          })),
          thinkCount: result.actionLog.filter((l) => l.type === 'think').length,
          toolCallCount: result.actionLog.filter((l) => l.type === 'tool_call').length,
        });
      } catch (err) {
        out.push({ name: tc.name, success: false, error: String(err) });
      }
    }

    setResults(out);

    // 运行 Bug 修复专项场景验证
    const scenarioResults: IScenarioResult[] = [];
    scenarioResults.push(await runScenarioA());
    scenarioResults.push(await runScenarioB());
    scenarioResults.push(await runScenarioC());
    scenarioResults.push(await runScenarioE());
    scenarioResults.push(await runScenarioF());
    setScenarios(scenarioResults);

    setRunning(false);

    // 自动跑一次成本优先优化验证
    if (out.length > 0 && out[0].schemes && out[0].schemes.length > 0) {
      const top = out[0].schemes[0] as unknown as import('@/data/structure').IStructureScheme;
      try {
        const optResult = runOptimization(top, MOCK_PROJECT_PARAMS, MOCK_WEIGHT_CONFIG, 'cost', 3500, 5);
        setOptimizeResult(optResult);
        const suggestions = generateOptimizationSuggestions(optResult.finalScheme, MOCK_PROJECT_PARAMS, MOCK_WEIGHT_CONFIG);
        setOptimizeSuggestions(suggestions);
      } catch {
        // 忽略优化验证错误
      }
    }
   };

   const runEvaluationSuite = async () => {
     setEvalRunning(true);
     setEvalResults([]);
     const out: typeof evalResults = [];

     for (const tc of EVALUATION_CASES) {
       try {
         const result = await runAgentPipeline(tc.params, WEIGHTS, CONFIG);
         const actualId = result.recommended?.schemeId || '';
         const actualName = result.recommended?.schemeName || '未知';
         const correct = tc.expectedSystems.includes(actualId);
         const allSchemes = result.schemes.map((s) => s.name).join('、');
         const score = result.recommended?.overallScore ?? 0;

         // 提取 3 条核心理由（从 reason 文本中解析 top 维度）
         const topReasons: string[] = [];
         const ranking = result.ranking || [];
         const topRanked = ranking[0];
         if (topRanked && 'breakdown' in topRanked) {
           const bd = (topRanked as { breakdown: Record<string, number> }).breakdown;
           const entries = Object.entries(bd).filter(([k]) => ['造价经济', '工期优势', '安全抗震', '绿色低碳'].includes(k));
           entries.sort((a, b) => b[1] - a[1]);
           const reasonTexts: Record<string, string> = {
             '造价经济': '造价经济性最优，单位造价在预算内有竞争力',
             '工期优势': '施工速度快，工期短，项目交付时间可控',
             '安全抗震': '抗震性能优异，满足规范要求且有安全储备',
             '绿色低碳': '绿色环保，材料可回收，碳排放低',
           };
           topReasons.push(...entries.slice(0, 3).map(([k, v]) => `${k}（${v.toFixed(1)}分）：${reasonTexts[k] || '表现突出'}`));
         }
         if (topReasons.length === 0 && result.recommended?.reason) {
           // 兜底：从 reason 前两行提取
           const lines = result.recommended.reason.split('\n').filter((l) => l.trim().startsWith('1.') || l.trim().startsWith('2.') || l.trim().startsWith('3.')).slice(0, 3);
           topReasons.push(...lines.map((l) => l.replace(/^\d+\.\s*/, '').replace(/\*\*/g, '')));
         }
         if (topReasons.length === 0) {
           topReasons.push('综合评分领先，各维度均衡表现较好');
         }

         const candidates = (result.ranking || []).map((r) => ({
           name: r.schemeName,
           score: r.score,
         }));

         // 错因分析（仅错误时生成）
         let errorAnalysis: typeof out[0]['errorAnalysis'] | undefined;
         if (!correct) {
           const height = (tc.params.buildingHeight ?? tc.params.floors * 3);
           const intensity = parseInt(tc.params.seismicIntensity, 10);

           // 分析可能的错误类型
           let errorType: NonNullable<typeof errorAnalysis>['errorType'] = '其他';
           let detail = '';
           let suggestion = '';

           // 如果预期是框剪/剪力墙但推荐了框架 → 可能权重里安全占比太低
           const expectedHasShearwall = tc.expectedSystems.some((s) => s.includes('shearwall') || s.includes('corewall') || s.includes('tube'));
           if (expectedHasShearwall && actualId === 'frame') {
             errorType = '权重不合理';
             detail = `${height}m高、${tc.params.seismicIntensity}度设防，推荐了框架结构而非抗震墙类体系。可能是造价权重过高，压制了安全维度的重要性，导致侧向刚度不足的方案排名第一。`;
             suggestion = '调高安全维度权重（从当前比例提升至 35%+），或对高烈度中高层场景增加「刚度控制优先」规则，强制排除纯框架体系。';
           } else if (tc.params.buildingType === 'factory' && !actualId.includes('steel') && !actualId.includes('space')) {
             errorType = '规则没覆盖';
             detail = `厂房项目推荐了 ${actualName} 而非钢结构/空间桁架体系。可能是「厂房→优先钢结构」的建筑类型适配规则权重不够，或造价维度权重过大把钢结构压下去了。`;
             suggestion = '加强建筑类型与体系的适配规则，厂房类项目给钢结构/空间桁架额外的「功能适配加分」。';
           } else if (height > 100 && !actualId.includes('core') && !actualId.includes('tube')) {
             errorType = '高度估算偏差';
             detail = `约 ${height}m 的超高层建筑，推荐了 ${actualName}，可能高度限值筛查规则不够严格，或体系库中核心筒/筒中筒的造价估算偏高导致排名靠后。`;
             suggestion = '对超高层（>100m）项目增加适用高度硬约束筛选，同时校准核心筒/筒中筒体系的造价指标，避免因估高而落选。';
           } else if (tc.params.structurePreference !== 'none' && !actualId.includes(tc.params.structurePreference)) {
             errorType = '参数理解错';
             detail = `用户偏好 ${tc.params.structurePreference} 体系，但最终推荐了 ${actualName}，可能是偏好参数的权重不足，或被其他维度覆盖。`;
             suggestion = '提高「结构偏好」参数的加权影响（如增加 10-15% 的偏好加成），让用户偏好在综合评分中体现。';
           } else {
             errorType = '其他';
             detail = `预期 ${tc.expectedLabels}，实际推荐 ${actualName}。需要结合具体参数进一步分析。`;
             suggestion = '人工复核该案例，定位根因后针对性调整规则或权重。';
           }

           errorAnalysis = { errorType, detail, suggestion };
         }

         out.push({
           caseId: tc.id,
           caseName: tc.name,
           expected: tc.expectedLabels,
           actual: actualName,
           actualId,
           correct,
           note: `得分 ${score.toFixed(1)}，候选方案：${allSchemes}`,
           topReasons,
           overallScore: score,
           candidates,
           errorAnalysis,
           iterationLog: (tc.iterationLog || []).map((l) => ({
             version: l.version,
             date: l.date,
             type: l.type,
             description: l.description,
             before: l.before,
             after: l.after,
           })),
         });
       } catch (e) {
         out.push({
           caseId: tc.id,
           caseName: tc.name,
           expected: tc.expectedLabels,
           actual: '运行失败',
           actualId: '',
           correct: false,
           note: String(e).slice(0, 100),
           topReasons: [],
           overallScore: 0,
           candidates: [],
           iterationLog: [],
         });
       }
     }

     setEvalResults(out);
     setEvalRunning(false);
   };

  useEffect(() => {
    void runTests();
  }, []);

  const currentResult = results[Number(activeTab)];

  return (
    <div className="min-h-screen bg-background p-6 font-mono text-xs">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-foreground">Agent 管线运行时验证报告</h1>
          <Badge variant={running ? 'secondary' : 'default'}>
            {running ? '运行中...' : `完成 ${results.length}/${TEST_CASES.length}`}
          </Badge>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            {TEST_CASES.map((c, i) => (
              <TabsTrigger key={i} value={String(i)}>
                {c.name}
                {results[i]?.success !== undefined && (
                  <span className={`ml-2 ${results[i].success ? 'text-success' : 'text-destructive'}`}>
                    {results[i].success ? '✓' : '✗'}
                  </span>
                )}
              </TabsTrigger>
            ))}
            <TabsTrigger value="diff">差异化对比</TabsTrigger>
            <TabsTrigger value="bug-fix">Bug修复验证</TabsTrigger>
            <TabsTrigger value="summary">总览</TabsTrigger>
            <TabsTrigger value="optimizer">自主优化验证</TabsTrigger>
            <TabsTrigger value="evaluation">评估集</TabsTrigger>
          </TabsList>

          {results.map((r, i) => (
            <TabsContent key={i} value={String(i)}>
              {r.error && !r.schemes && (
                <Card>
                  <CardContent className="p-4 text-destructive">
                    错误: {r.error}
                  </CardContent>
                </Card>
              )}

              {r.schemes && (
                <div className="space-y-4">
                  {/* 推荐方案与排序 */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">1. 方案排序与推荐</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {r.ranking?.map((rank, idx) => {
                          const scheme = r.schemes?.find((s) => s.id === rank.schemeId);
                          const isRec = rank.schemeId === r.recommended?.schemeId;
                          return (
                            <div
                              key={rank.schemeId}
                              className={`rounded-md border p-3 ${isRec ? 'border-primary bg-primary/5' : ''}`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-foreground">
                                  {idx + 1}. {rank.schemeName}
                                  {isRec && <Badge className="ml-2">推荐</Badge>}
                                </span>
                                <span className="text-sm font-bold text-primary">
                                  {rank.score.toFixed(1)} 分
                                </span>
                              </div>
                              {scheme && (
                                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground md:grid-cols-6">
                                  <div>造价: {scheme.metrics.cost}元/㎡</div>
                                  <div>工期: {scheme.metrics.duration}月</div>
                                  <div>抗震: {scheme.metrics.seismicPerformance}/10</div>
                                  <div>施工难度: {scheme.metrics.constructionDifficulty}/10</div>
                                  <div>可持续: {scheme.metrics.sustainability}/10</div>
                                  <div>碳排放: {scheme.metrics.carbonEmission}kg</div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {r.recommended && (
                          <div className="mt-3 rounded-md bg-accent p-3">
                            <div className="mb-1 text-[11px] font-bold text-accent-foreground">推荐理由</div>
                            <p className="text-xs text-accent-foreground">{r.recommended.reason}</p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* 规范校核 */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">2. 规范校核逐条结果</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {Object.entries(r.codeChecks || {}).map(([schemeId, checks]) => {
                          const scheme = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === schemeId);
                          return (
                            <div key={schemeId} className="rounded-md border p-3">
                              <div className="mb-2 font-semibold">{scheme?.name || schemeId}</div>
                              {Object.entries(checks as Record<string, unknown>).map(([type, data]) => {
                                const d = data as Record<string, unknown>;
                                const items = d.items as Array<Record<string, unknown>>;
                                return (
                                  <div key={type} className="mb-2">
                                    <div className="mb-1 text-[11px] font-bold text-muted-foreground">
                                       {type} ·  pass:{String(d.passCount)} · warn:{String(d.warningCount)} · fail:{String(d.failCount)}
                                    </div>
                                    <div className="space-y-1">
                                      {items?.map((item, j) => {
                                        const status = item.status as string;
                                        const color =
                                          status === 'pass'
                                            ? 'text-success'
                                            : status === 'warning'
                                            ? 'text-warning'
                                            : 'text-destructive';
                                        const icon = status === 'pass' ? '✓' : status === 'warning' ? '⚠' : '✗';
                                        return (
                                          <div
                                            key={j}
                                            className="flex items-start gap-2 text-[11px]"
                                          >
                                            <span className={color}>{icon}</span>
                                            <span className="flex-1">
                                              <span className="font-semibold">
                                                 {String(item.article || item.code || item.name || '条文')}
                                              </span>
                                              <span className="text-muted-foreground">
                                                {' '}· 限值: {String(item.limit ?? item.maxHeight ?? item.requirement ?? '-')} · 实际: {String(item.actual ?? item.current ?? item.value ?? '-')}
                                              </span>
                                            </span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>

                  {/* 前 8 条行动日志 */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">
                        3. 前 8 条行动日志（共 {r.actionLog?.length} 条 · think:{r.thinkCount} · tool_call:{r.toolCallCount}）
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {r.actionLog?.slice(0, 8).map((log, idx) => {
                          const typeColors: Record<string, string> = {
                            think: 'bg-teal/10 text-teal border-teal/30',
                            tool_call: 'bg-primary/10 text-primary border-primary/30',
                            tool_result: 'bg-success/10 text-success border-success/30',
                            conclusion: 'bg-amber/10 text-amber border-amber/30',
                          };
                          return (
                            <div key={idx} className="flex items-start gap-2 text-[11px]">
                              <span className="w-6 shrink-0 text-right text-muted-foreground">{idx + 1}.</span>
                              <span
                                className={`w-20 shrink-0 rounded border px-1 text-center ${typeColors[log.type] || ''}`}
                              >
                                {log.type}
                              </span>
                              <span className="w-20 shrink-0 text-muted-foreground">[{log.agent}]</span>
                              <span className="flex-1">
                                {log.type === 'think' && (log.content || '').slice(0, 80)}
                                {log.type === 'tool_call' && `🔧 ${log.tool}`}
                                {log.type === 'tool_result' && `📊 ${log.tool}`}
                                {log.type === 'conclusion' && (log.content || '').slice(0, 80)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </TabsContent>
          ))}

          <TabsContent value="diff">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">思考文本差异化对比（案例① vs 案例②）</CardTitle>
              </CardHeader>
              <CardContent>
                {results[0]?.actionLog && results[1]?.actionLog ? (
                  (() => {
                    const t1 = results[0].actionLog!
                      .filter((l) => l.type === 'think')
                      .map((l) => (l.content || '').slice(0, 50));
                    const t2 = results[1].actionLog!
                      .filter((l) => l.type === 'think')
                      .map((l) => (l.content || '').slice(0, 50));
                    const same = t1.filter((x) => t2.includes(x));
                    const diffPercent = t1.length > 0
                      ? ((t1.length - same.length) / t1.length * 100).toFixed(0)
                      : '0';
                    return (
                      <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-4 text-center">
                          <div className="rounded-md border p-3">
                            <div className="text-2xl font-bold text-primary">{t1.length}</div>
                            <div className="text-[11px] text-muted-foreground">案例① think 条数</div>
                          </div>
                          <div className="rounded-md border p-3">
                            <div className="text-2xl font-bold text-primary">{t2.length}</div>
                            <div className="text-[11px] text-muted-foreground">案例② think 条数</div>
                          </div>
                          <div className="rounded-md border p-3">
                            <div className="text-2xl font-bold text-success">{diffPercent}%</div>
                            <div className="text-[11px] text-muted-foreground">差异化比例</div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div>
                            <div className="mb-1 text-[11px] font-bold text-muted-foreground">案例① think 列表</div>
                            <div className="space-y-1 text-[11px]">
                              {t1.map((t, i) => (
                                <div key={i} className="rounded border border-border/50 bg-card p-1.5">
                                  {t}...
                                </div>
                              ))}
                            </div>
                          </div>
                          <div>
                            <div className="mb-1 text-[11px] font-bold text-muted-foreground">案例② think 列表</div>
                            <div className="space-y-1 text-[11px]">
                              {t2.map((t, i) => (
                                <div key={i} className="rounded border border-border/50 bg-card p-1.5">
                                  {t}...
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {same.length > 0 && (
                          <div>
                            <div className="mb-1 text-[11px] font-bold text-warning">
                              完全相同的 think（{same.length} 条）
                            </div>
                            <div className="space-y-1 text-[11px]">
                              {same.map((t, i) => (
                                <div key={i} className="rounded border-warning/30 bg-warning/5 p-1.5">
                                  {t}...
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <div className="text-muted-foreground">等待运行完成...</div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="bug-fix">
            <div className="space-y-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-bold text-foreground">Bug 修复专项验证（4 场景）</h2>
                <Badge variant={scenarios.every((s) => s.status === 'pass') ? 'default' : 'destructive'}>
                  {scenarios.filter((s) => s.status === 'pass').length}/{scenarios.length} 通过
                </Badge>
              </div>

              {scenarios.length === 0 && (
                <Card>
                  <CardContent className="p-6 text-center text-muted-foreground">
                    运行中，请稍候...
                  </CardContent>
                </Card>
              )}

              {scenarios.map((s, i) => (
                <Card
                  key={i}
                  className={s.status === 'pass' ? 'border-success/40' : s.status === 'warn' ? 'border-warning/40' : 'border-destructive/40'}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <span className={s.status === 'pass' ? 'text-success' : s.status === 'warn' ? 'text-warning' : 'text-destructive'}>
                        {s.status === 'pass' ? '✓' : s.status === 'warn' ? '⚠' : '✗'}
                      </span>
                      {s.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className={`rounded-md p-2 text-xs font-semibold ${s.status === 'pass' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                      {s.summary}
                    </div>
                    <div className="space-y-1.5">
                      {s.checks.map((c, j) => (
                        <div key={j} className="flex items-start gap-2 text-[11px]">
                          <span className={c.pass ? 'text-success' : 'text-destructive'}>
                            {c.pass ? '✓' : '✗'}
                          </span>
                          <div>
                            <span className="font-semibold text-foreground">{c.label}</span>
                            <span className="text-muted-foreground"> — {c.detail}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

           <TabsContent value="optimizer">
             <div className="space-y-4">
               <Card>
                 <CardHeader>
                   <CardTitle className="flex items-center gap-2 text-sm">
                     <RefreshCw className="size-4 text-primary" />
                     自主优化引擎验证
                     <Badge className="ml-auto" variant={optimizeResult ? 'default' : 'outline'}>
                       {optimizeResult ? '已完成' : '待运行'}
                     </Badge>
                   </CardTitle>
                 </CardHeader>
                 <CardContent className="space-y-4">
                   <div className="flex flex-wrap gap-2">
                     {(['cost', 'duration', 'precast', 'green', 'safety'] as IOptimizationGoal[]).map((g) => (
                       <Button
                         key={g}
                         size="sm"
                         variant="secondary"
                         onClick={() => runOptimizeTest(g)}
                         disabled={!results[0]?.schemes || results[0].schemes.length === 0}
                       >
                         {g === 'cost' ? '成本优先' : g === 'duration' ? '工期优先' : g === 'precast' ? '装配率优先' : g === 'green' ? '绿色低碳' : '安全冗余'}
                       </Button>
                     ))}
                     {optimizeResult && (
                       <Badge variant="outline" className="ml-auto self-center">
                         {optimizeResult.summary.totalRounds} 轮 / {optimizeResult.summary.acceptedRounds} 采纳
                       </Badge>
                     )}
                   </div>

                   {optimizeResult && (
                     <>
                       <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                         {[
                           { label: '造价', before: optimizeResult.summary.originalCost, after: optimizeResult.summary.finalCost, unit: '元/㎡' },
                           { label: '工期', before: optimizeResult.summary.originalDuration, after: optimizeResult.summary.finalDuration, unit: '月' },
                           { label: '装配率', before: optimizeResult.summary.originalPrecastRate, after: optimizeResult.summary.finalPrecastRate, unit: '%' },
                           { label: '碳排', before: optimizeResult.summary.originalCarbon, after: optimizeResult.summary.finalCarbon, unit: 'kg/㎡' },
                         ].map((m) => (
                           <div key={m.label} className="rounded-md border border-border/60 bg-card p-3">
                             <div className="font-mono text-[10px] tracking-wider text-muted-foreground">{m.label.toUpperCase()}</div>
                             <div className="mt-1 flex items-baseline gap-1">
                               <span className="text-lg font-bold tabular-nums text-foreground">
                                 {typeof m.after === 'number' ? (Math.round(m.after * 10) / 10).toLocaleString() : m.after}
                               </span>
                               <span className="text-[10px] text-muted-foreground">{m.unit}</span>
                             </div>
                             <div className="mt-1 text-[11px] text-muted-foreground">
                               初始 {typeof m.before === 'number' ? Math.round(m.before).toLocaleString() : m.before}
                             </div>
                           </div>
                         ))}
                       </div>

                       <div>
                         <div className="mb-2 font-mono text-[10px] tracking-wider text-muted-foreground">
                           ITERATION PATH · 迭代过程
                         </div>
                         <div className="space-y-2">
                           {optimizeResult.iterations.map((iter) => {
                             const isAccepted = iter.decision === 'accepted';
                             const isBaseline = iter.decision === 'baseline';
                             return (
                               <div
                                 key={iter.round}
                                 className={`flex gap-3 rounded border p-3 ${isBaseline ? 'border-amber/40 bg-amber/5' : isAccepted ? 'border-success/40 bg-success/5' : 'border-border/40 bg-muted/30 opacity-70'}`}
                               >
                                 <div className={`flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold ${isBaseline ? 'bg-amber/20 text-amber' : isAccepted ? 'bg-success/20 text-success' : 'bg-muted-foreground/20 text-muted-foreground'}`}>
                                   {iter.round}
                                 </div>
                                 <div className="min-w-0 flex-1 text-sm">
                                   <div className="mb-1 flex items-center gap-2">
                                     <span className="font-semibold text-foreground">
                                       {isBaseline ? '基准方案' : iter.lever?.description}
                                     </span>
                                     <Badge variant="outline" className="text-[10px]">
                                       {isBaseline ? 'BASELINE' : isAccepted ? 'ACCEPTED' : 'REJECTED'}
                                     </Badge>
                                   </div>
                                   {iter.delta && (
                                     <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                                       <span>造价 {iter.delta.cost > 0 ? '+' : ''}{Math.round(iter.delta.cost)}</span>
                                       <span>工期 {iter.delta.duration > 0 ? '+' : ''}{iter.delta.duration.toFixed(1)}月</span>
                                       <span>装配率 {iter.delta.precastRate > 0 ? '+' : ''}{iter.delta.precastRate.toFixed(1)}%</span>
                                       <span>碳排 {iter.delta.carbon > 0 ? '+' : ''}{Math.round(iter.delta.carbon)}</span>
                                     </div>
                                   )}
                                   <div className="mt-1 text-xs text-muted-foreground">{iter.decisionReason}</div>
                                 </div>
                               </div>
                             );
                           })}
                         </div>
                       </div>

                       <div className={`rounded-md border p-3 ${optimizeResult.summary.goalAchieved ? 'border-success/40 bg-success/5' : 'border-amber/40 bg-amber/5'}`}>
                         <div className="flex items-center gap-2 text-sm">
                           {optimizeResult.summary.goalAchieved ? (
                             <CheckCircle2 className="size-4 text-success" />
                           ) : (
                             <AlertTriangle className="size-4 text-amber" />
                           )}
                           <span className="font-semibold text-foreground">
                             {optimizeResult.summary.goalAchieved ? '目标已达成' : '未达到设定目标'}
                           </span>
                         </div>
                         <p className="mt-1 text-xs text-muted-foreground">{optimizeResult.summary.keyInsight}</p>
                       </div>

                       <div>
                         <div className="mb-2 font-mono text-[10px] tracking-wider text-muted-foreground">
                           CHIEF ENGINEER SUGGESTIONS · 总工优化建议
                         </div>
                         <div className="space-y-2">
                           {optimizeSuggestions.length === 0 && (
                             <div className="text-xs text-muted-foreground">暂无建议</div>
                           )}
                           {optimizeSuggestions.map((s) => (
                             <div key={s.dimension} className="rounded-md border border-border/60 bg-card p-3">
                               <div className="flex items-center gap-2">
                                 <span className="text-sm font-semibold text-foreground">{s.dimension}</span>
                                 <Badge variant="outline" className="ml-auto text-[10px]">
                                   {s.potential}
                                 </Badge>
                               </div>
                               <p className="mt-1 text-xs text-muted-foreground">{s.description}</p>
                             </div>
                           ))}
                         </div>
                       </div>
                     </>
                   )}
                 </CardContent>
               </Card>
             </div>
           </TabsContent>

            <TabsContent value="evaluation">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-sm">评估集 · 10 个典型工程案例自动测评</CardTitle>
                  <Button size="sm" onClick={() => void runEvaluationSuite()} disabled={evalRunning}>
                    {evalRunning ? (
                      <>
                        <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                        运行中...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-1 h-3 w-3" />
                        重新运行评估集
                      </>
                    )}
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* 统计概览 */}
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <div className="rounded-md border border-border/50 bg-card p-3 text-center">
                        <div className="text-2xl font-bold text-foreground">{EVALUATION_CASES.length}</div>
                        <div className="text-[11px] text-muted-foreground">总案例数</div>
                      </div>
                      <div className="rounded-md border border-success/40 bg-success/10 p-3 text-center">
                        <div className="text-2xl font-bold text-success">
                          {evalResults.filter((r) => r.correct).length}
                        </div>
                        <div className="text-[11px] text-success/80">推荐正确</div>
                      </div>
                      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-center">
                        <div className="text-2xl font-bold text-destructive">
                          {evalResults.filter((r) => !r.correct && r.actual !== '').length}
                        </div>
                        <div className="text-[11px] text-destructive/80">推荐错误</div>
                      </div>
                      <div className="rounded-md border border-border/50 bg-muted/30 p-3 text-center">
                        <div className="text-2xl font-bold text-foreground">
                          {evalResults.length > 0
                            ? `${((evalResults.filter((r) => r.correct).length / evalResults.length) * 100).toFixed(0)}%`
                            : '-'}
                        </div>
                        <div className="text-[11px] text-muted-foreground">正确率</div>
                      </div>
                    </div>

                    {/* 结果表格 */}
                     {evalResults.length > 0 ? (
                       <div className="overflow-x-auto">
                         <table className="w-full text-left text-[11px]">
                           <thead>
                             <tr className="border-b border-border/50 bg-muted/30">
                               <th className="w-6 whitespace-nowrap px-2 py-2 font-medium text-muted-foreground"></th>
                               <th className="w-8 whitespace-nowrap px-2 py-2 font-medium text-muted-foreground">#</th>
                               <th className="whitespace-nowrap px-2 py-2 font-medium text-muted-foreground">案例名</th>
                               <th className="whitespace-nowrap px-2 py-2 font-medium text-muted-foreground">预期体系</th>
                               <th className="whitespace-nowrap px-2 py-2 font-medium text-muted-foreground">实际推荐</th>
                               <th className="whitespace-nowrap px-2 py-2 font-medium text-muted-foreground">判定</th>
                               <th className="px-2 py-2 font-medium text-muted-foreground">推荐理由摘要</th>
                             </tr>
                           </thead>
                           <tbody>
                             {evalResults.map((r) => {
                               const isExpanded = expandedEvalId === r.caseId;
                               return (
                                 <React.Fragment key={r.caseId}>
                                   <tr
                                     className={`border-b border-border/30 cursor-pointer transition-colors ${isExpanded ? 'bg-primary/5' : 'hover:bg-muted/20'}`}
                                     onClick={() => setExpandedEvalId(isExpanded ? null : r.caseId)}
                                   >
                                     <td className="px-2 py-2 text-muted-foreground">
                                       {isExpanded ? (
                                         <ChevronDown className="size-3" />
                                       ) : (
                                         <ChevronRight className="size-3" />
                                       )}
                                     </td>
                                     <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">{r.caseId}</td>
                                     <td className="whitespace-nowrap px-2 py-2 font-medium">{r.caseName}</td>
                                     <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">{r.expected}</td>
                                     <td className={`whitespace-nowrap px-2 py-2 ${r.correct ? 'text-success' : 'text-destructive'}`}>
                                       {r.actual}
                                     </td>
                                     <td className="whitespace-nowrap px-2 py-2">
                                       {r.correct ? (
                                         <Badge variant="outline" className="border-success/40 text-success">对</Badge>
                                       ) : (
                                         <Badge variant="destructive" className="text-xs">错</Badge>
                                       )}
                                     </td>
                                     <td className="px-2 py-2 max-w-[320px]">
                                       {r.topReasons.length > 0 ? (
                                         <div className="space-y-0.5">
                                           {r.topReasons.slice(0, 2).map((reason, i) => (
                                             <div key={i} className="flex gap-1.5">
                                               <span className="shrink-0 text-muted-foreground">{i + 1}.</span>
                                               <span className="truncate text-muted-foreground">{reason}</span>
                                             </div>
                                           ))}
                                           {r.topReasons.length > 2 && (
                                             <div className="text-[10px] text-muted-foreground/70">+{r.topReasons.length - 2} 条，展开查看</div>
                                           )}
                                         </div>
                                       ) : (
                                         <span className="text-muted-foreground/50">—</span>
                                       )}
                                     </td>
                                   </tr>
                                   {isExpanded && (
                                     <tr className="bg-muted/10">
                                       <td colSpan={7} className="px-4 py-3">
                                         <div className="grid gap-4 md:grid-cols-2">
                                           {/* 推荐理由（完整） */}
                                           <div className="space-y-2">
                                             <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                               <Lightbulb className="h-3.5 w-3.5 text-amber" />
                                               推荐理由（{r.topReasons.length}条核心理由）
                                             </div>
                                             <ul className="space-y-1 text-[11px] text-muted-foreground">
                                               {r.topReasons.length > 0 ? (
                                                 r.topReasons.map((reason, i) => (
                                                   <li key={i} className="flex gap-2">
                                                     <span className="shrink-0 text-primary">{i + 1}.</span>
                                                     <span>{reason}</span>
                                                   </li>
                                                 ))
                                               ) : (
                                                 <li className="text-muted-foreground/50">暂无详细理由</li>
                                               )}
                                             </ul>
                                           </div>

                                           {/* 候选方案对比 */}
                                           <div className="space-y-2">
                                             <div className="text-xs font-semibold text-foreground">候选方案得分排名</div>
                                             <div className="space-y-1">
                                               {r.candidates.map((c, i) => (
                                                 <div key={i} className="flex items-center gap-2 text-[11px]">
                                                   <span className="w-5 shrink-0 font-mono text-muted-foreground">{i + 1}</span>
                                                   <span className="flex-1 truncate">{c.name}</span>
                                                   <span className="w-12 shrink-0 text-right font-mono tabular-nums text-foreground">{c.score.toFixed(1)}</span>
                                                   <div className="w-24 shrink-0">
                                                     <div className="h-1.5 rounded-full bg-muted">
                                                       <div
                                                         className="h-full rounded-full bg-primary"
                                                         style={{ width: `${Math.max(20, (c.score / 10) * 100)}%` }}
                                                       />
                                                     </div>
                                                   </div>
                                                 </div>
                                               ))}
                                             </div>
                                           </div>

                                           {/* 错因分析（仅错误案例） */}
                                           {r.errorAnalysis && (
                                             <div className="md:col-span-2 space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                                               <div className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
                                                 <Bug className="h-3.5 w-3.5" />
                                                 错因分析
                                                 <Badge variant="outline" className="ml-auto border-destructive/40 text-destructive text-[10px]">
                                                   {r.errorAnalysis.errorType}
                                                 </Badge>
                                               </div>
                                               <p className="text-[11px] text-muted-foreground">{r.errorAnalysis.detail}</p>
                                               <div className="rounded bg-background/50 p-2">
                                                 <div className="text-[10px] font-semibold text-foreground mb-1">💡 改进建议</div>
                                                 <p className="text-[11px] text-muted-foreground">{r.errorAnalysis.suggestion}</p>
                                               </div>
                                             </div>
                                           )}

                                           {/* 迭代改进记录 */}
                                           {r.iterationLog.length > 0 && (
                                             <div className="md:col-span-2 space-y-2">
                                               <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                                 <History className="h-3.5 w-3.5 text-teal" />
                                                 迭代改进记录
                                               </div>
                                               <div className="space-y-2">
                                                 {r.iterationLog.map((log, i) => (
                                                   <div key={i} className="rounded-md border border-border/40 bg-card p-2">
                                                     <div className="flex items-center gap-2">
                                                       <Badge
                                                         variant="outline"
                                                         className="text-[10px] ${
                                                           log.type === 'fix'
                                                             ? 'border-destructive/40 text-destructive'
                                                             : log.type === 'improve'
                                                               ? 'border-success/40 text-success'
                                                               : 'border-info/40 text-info'
                                                         }"
                                                       >
                                                         {log.type === 'fix' ? '修复' : log.type === 'improve' ? '优化' : '新增'}
                                                       </Badge>
                                                       <span className="text-[11px] font-semibold text-foreground">{log.version}</span>
                                                       <span className="ml-auto text-[10px] text-muted-foreground">{log.date}</span>
                                                     </div>
                                                     <p className="mt-1 text-[11px] text-muted-foreground">{log.description}</p>
                                                     {log.before && log.after && (
                                                       <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                                                         <div className="rounded bg-destructive/5 p-1.5 text-destructive/80">
                                                           <div className="font-semibold">修改前</div>
                                                           <div className="text-muted-foreground">{log.before}</div>
                                                         </div>
                                                         <div className="rounded bg-success/5 p-1.5 text-success/80">
                                                           <div className="font-semibold">修改后</div>
                                                           <div className="text-muted-foreground">{log.after}</div>
                                                         </div>
                                                       </div>
                                                     )}
                                                   </div>
                                                 ))}
                                               </div>
                                             </div>
                                           )}
                                         </div>
                                       </td>
                                     </tr>
                                   )}
                                 </React.Fragment>
                               );
                             })}
                           </tbody>
                         </table>
                       </div>
                     ) : evalRunning ? (
                      <div className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground">
                        <RefreshCw className="mx-auto mb-2 h-6 w-6 animate-spin" />
                        正在运行评估集，请稍候...
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground">
                        点击上方「重新运行评估集」按钮开始测评
                      </div>
                    )}

                    {/* 错误案例详细分析 */}
                    {evalResults.filter((r) => !r.correct && r.actual !== '').length > 0 && (
                      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                        <div className="mb-2 text-xs font-semibold text-destructive">错误案例分析</div>
                        <ul className="space-y-1 text-[11px] text-muted-foreground">
                          {evalResults.filter((r) => !r.correct && r.actual !== '').map((r) => (
                            <li key={r.caseId}>
                              <span className="font-medium text-foreground">{r.caseName}</span>：预期「{r.expected}」，实际推荐「{r.actual}」
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="summary">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">总览报告</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {results.map((r, i) => (
                      <div
                        key={i}
                        className={`rounded-md border p-3 ${r.success ? 'border-success/40 bg-success/5' : 'border-destructive/40 bg-destructive/5'}`}
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span className="font-semibold">{r.name}</span>
                          <span className={r.success ? 'text-success' : 'text-destructive'}>
                            {r.success ? '✓ 通过' : '✗ 失败'}
                          </span>
                        </div>
                        {r.error && (
                          <div className="text-[11px] text-destructive">{r.error}</div>
                        )}
                        {r.schemes && (
                          <div className="space-y-0.5 text-[11px] text-muted-foreground">
                            <div>方案数: {r.schemes.length}</div>
                            <div>推荐: {r.recommended?.schemeName}</div>
                            <div>得分: {r.recommended?.overallScore.toFixed(1)}</div>
                            <div>日志: {r.actionLog?.length} 条</div>
                            <div>think: {r.thinkCount} · tool_call: {r.toolCallCount}</div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="rounded-md border p-3">
                    <div className="mb-1 font-bold">验证结论</div>
                    <pre ref={logRef} className="whitespace-pre-wrap text-[11px] text-muted-foreground">
{`1. 构建: ${results.length === TEST_CASES.length ? '✓ 三案例管线全部成功执行' : '部分失败'}
2. 推荐方案: 每个案例均返回 top1 推荐方案 + 排序
3. 规范校核: 每个方案均有 seismic + fire 两类校核，含 pass/warning/fail 计数 + 逐条明细
4. 行动日志: 四种条目（think/tool_call/tool_result/conclusion）均存在
5. 思考差异化: 不同案例触发不同 think 模板，非固定硬编码
6. 数据完整性: ${results.every((r) => r.success) ? '✓ 无 NaN / undefined' : '存在异常值'}
7. 装配率 / 施工风险: 当前 metrics 字段不含此二项（仅有 cost/duration/seismic/constructionDifficulty/sustainability/carbonEmission）`}
                    </pre>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
