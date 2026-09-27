// 元认知验证专用 SSR 构建配置：打包 verify-metacognition.ts → node 可运行产物
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
    ssr: path.resolve(root, 'verify-metacognition.ts'),
    outDir: path.resolve(root, 'verify-metacognition-out'),
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      output: { format: 'es' },
    },
  },
});
