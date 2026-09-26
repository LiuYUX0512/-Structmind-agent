#!/usr/bin/env node
/**
 * GitHub Pages 部署构建脚本
 *
 * 流程：
 *   1. 用 Vite 构建，base 设为 GitHub Pages 项目路径（/-Structmind-agent/）
 *   2. 注入 CLIENT_BASE_PATH 让 BrowserRouter basename 匹配
 *   3. 复制 index.html → 404.html（SPA 刷新路由时不白屏）
 *   4. 产出 dist/gh-pages/ 目录，可直接推送到 gh-pages 分支
 */

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

// GitHub Pages 项目站点的 base 路径（仓库名以 - 开头）
const BASE = process.env.GH_PAGES_BASE || '/-Structmind-agent/';
const OUT_DIR = 'dist/gh-pages';

console.log(`[gh-pages] base=${BASE}, out=${OUT_DIR}`);

// 1. 构建（同时注入 CLIENT_BASE_PATH 给 BrowserRouter）
execSync(
  `npx vite build --base "${BASE}" --outDir "${OUT_DIR}" --emptyOutDir`,
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, CLIENT_BASE_PATH: BASE.slice(0, -1) || '/' },
  }
);

// 2. SPA fallback：复制 index.html → 404.html
const indexHtmlPath = path.join(OUT_DIR, 'index.html');
const notFoundHtml = path.join(OUT_DIR, '404.html');
if (fs.existsSync(indexHtmlPath)) {
  fs.copyFileSync(indexHtmlPath, notFoundHtml);
  console.log('[gh-pages] 404.html created (SPA fallback)');
} else {
  console.warn('[gh-pages] WARN: index.html not found, skip 404.html');
}

// 2b. 替换妙搭模板占位符（GitHub Pages 无运行时注入）
const APP_NAME = '智构 StructMind · 建筑结构方案优化AI智能体';
const APP_DESC = '面向建筑方案阶段的多Agent协同结构选型与优化工具，基于土木工程专业知识库智能生成多套候选方案并给出综合推荐。';
for (const f of [indexHtmlPath, notFoundHtml]) {
  if (!fs.existsSync(f)) continue;
  let html = fs.readFileSync(f, 'utf-8');
  html = html.replaceAll('{{appName}}', APP_NAME);
  html = html.replaceAll('{{appDescription}}', APP_DESC);
  html = html.replaceAll('{{appAvatar}}', `${BASE}favicon.svg`);
  // 平台运行时注入变量（妙搭埋点用，GitHub Pages 上无值，清空避免 undefined）
  html = html.replaceAll('{{appId}}', '');
  html = html.replaceAll('{{userId}}', '');
  html = html.replaceAll('{{tenantId}}', '');
  html = html.replaceAll('{{appVersion}}', '1.0.0');
  html = html.replaceAll('{{appSecret}}', '');
  html = html.replaceAll('{{appLocale}}', 'zh_CN');
  html = html.replaceAll('{{appRegion}}', '');
  html = html.replaceAll('{{appBasePath}}', BASE.slice(0, -1) || '/');
  html = html.replaceAll('{{basename}}', BASE.slice(0, -1) || '/');
  html = html.replaceAll('{{csrfToken}}', '');
  html = html.replaceAll('{{environment}}', 'production');
  html = html.replaceAll('{{userName}}', '');
  fs.writeFileSync(f, html, 'utf-8');
}
console.log('[gh-pages] template placeholders replaced');

// 3. 校验产物
const files = fs.readdirSync(OUT_DIR);
console.log(`[gh-pages] done. ${files.length} top-level entries:`);
for (const f of files) console.log(`  ${f}`);
