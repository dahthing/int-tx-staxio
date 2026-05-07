import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['supabase/functions/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['supabase/functions/**/*.utils.ts'],
      thresholds: { lines: 90, functions: 90, branches: 80 },
    },
  },
});
