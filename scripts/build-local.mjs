#!/usr/bin/env node
/**
 * 跨平台本地构建脚本（Windows / macOS / Linux 通用）
 *
 * 妙搭平台的 scripts/build.sh 依赖 bash/rsync，仅适用于平台部署环境；
 * 本地（尤其是 Windows）用本脚本替代，等价于：
 *   npx vite build --outDir dist/local-check --emptyOutDir
 */

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

const outDir = process.argv[2] || 'dist/local-check';

console.log(`[build-local] building to ${outDir} ...`);
execSync(`npx vite build --outDir "${outDir}" --emptyOutDir`, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
console.log('[build-local] done.');
