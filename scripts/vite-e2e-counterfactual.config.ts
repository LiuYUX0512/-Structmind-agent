// 本地端到端预览专用 SSR 构建配置
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
    ssr: path.resolve(root, 'e2e-counterfactual-preview.ts'),
    outDir: path.resolve(root, 'verify-counterfactual-out'),
    emptyOutDir: false,
    minify: false,
    rollupOptions: {
      output: { format: 'es', entryFileNames: 'e2e-preview.js' },
    },
  },
});
