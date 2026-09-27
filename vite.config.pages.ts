import path from 'path'
import { defineConfig } from '@lark-apaas/coding-preset-vite-react'

// GitHub Pages 专用构建：base 固定为仓库子路径，产物可直接推到 gh-pages 分支
export default defineConfig({
  base: '/-Structmind-agent/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
})
