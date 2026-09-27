#!/usr/bin/env node
/**
 * 构建后处理：替换 index.html 中的 miaoda 平台模板变量占位符。
 *
 * 背景：index.html 内含 {{basename}} / {{appName}} / {{appAvatar}} / {{appId}} 等
 * 占位符，需由平台部署时替换。直接 `vite build` 出包会绕过替换，
 * 导致 window.__BASENAME__ = "{{basename}}"（字面量）→ React Router basename
 * 错乱 → 页面黑屏。
 *
 * 用法：node scripts/replace-templates.cjs <index.html 路径> <mode>
 *   mode = gh-pages  → basename = "/-Structmind-agent"
 *   mode = sites     → basename = ""（回落到 "/"）
 *
 * 注意：不要用命令行直接传 "/-Structmind-agent" 这类以 / 开头的参数，
 * Git Bash 会把它转成 Windows 绝对路径。故用 mode 标志在脚本内决定。
 */
const fs = require("fs");
const path = require("path");

const target = process.argv[2];
const mode = process.argv[3] || "sites";

if (!target) {
  console.error("用法: node replace-templates.cjs <index.html> <gh-pages|sites>");
  process.exit(1);
}

const basename = mode === "gh-pages" ? "/-Structmind-agent" : "";

const replacements = {
  "{{basename}}": basename,
  "{{appName}}": "建筑结构智评 StructMind",
  "{{appDescription}}": "建筑结构方案智能生成与多维度评估智能体",
  "{{appAvatar}}": "favicon.svg",
  "{{appId}}": "",
  "{{userId}}": "",
  "{{tenantId}}": "",
  "{{userName}}": "",
  "{{csrfToken}}": "",
  "{{environment}}": "production",
};

const file = path.resolve(target);
let html = fs.readFileSync(file, "utf8");
let total = 0;

for (const [key, value] of Object.entries(replacements)) {
  const before = html;
  html = html.split(key).join(value);
  if (html !== before) {
    total += (before.match(new RegExp(key.replace(/[{}]/g, "\\$&"), "g")) || []).length;
  }
}

fs.writeFileSync(file, html, "utf8");

const leftover = html.match(/\{\{[a-zA-Z]+\}\}/g) || [];
console.log(`[replace-templates] mode=${mode} basename="${basename}" replaced=${total} 残留占位符=${leftover.length}`);
if (leftover.length) {
  console.warn("  ⚠ 仍有未替换:", [...new Set(leftover)].join(" "));
}
