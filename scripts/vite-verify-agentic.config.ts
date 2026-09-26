// 本地验证专用 SSR 构建配置（专项：真实模式升级验证）→ node 可运行产物 verify-agentic.js
import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url)); // scripts/

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(root, '../src'),
      '@lark-apaas/client-toolkit-lite': path.resolve(root, 'mocks/lark-toolkit-mock.ts'),
    },
  },
  build: {
    ssr: path.resolve(root, 'verify-agentic.ts'),
    outDir: path.resolve(root, 'verify-out'),
    emptyOutDir: false,
    minify: false,
    rollupOptions: {
      output: { format: 'es', entryFileNames: 'verify-agentic.js' },
    },
  },
});
