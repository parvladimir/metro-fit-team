import { configDefaults, defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    // Claude Code worktrees live in .claude/worktrees/<name>/ inside the repo:
    // other checkouts whose `@/` imports would resolve into this tree's src.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
