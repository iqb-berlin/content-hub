import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
    setupFiles: ['./src/test-setup.ts'],
    css: true,
    coverage: {
      provider: 'v8',
      include: ['src/app/**/*.ts'],
      exclude: ['src/**/*.spec.ts'],
      reporter: ['text-summary', 'json-summary', 'json', 'html'],
      thresholds: {
        'src/app/core/guards/auth.guard.ts': {
          statements: 87.5,
          branches: 64.28,
          functions: 90.9,
          lines: 86.84,
        },
        'src/app/core/services/auth.service.ts': {
          statements: 89.1,
          branches: 70.52,
          functions: 89.53,
          lines: 88.68,
        },
        'src/app/core/services/pending-personal-session-storage.service.ts': {
          statements: 100,
          branches: 94.11,
          functions: 100,
          lines: 100,
        },
        'src/app/views/item-explorer/item-explorer-preview-coordinator.service.ts': {
          statements: 89.28,
          branches: 81.81,
          functions: 94.44,
          lines: 89.09,
        },
        'src/app/views/item-explorer/item-explorer-preview-loader.service.ts': {
          statements: 98.93,
          branches: 89.13,
          functions: 100,
          lines: 100,
        },
        'src/app/views/item-explorer/item-explorer-coding.service.ts': {
          statements: 85.35,
          branches: 74.93,
          functions: 89.15,
          lines: 87.94,
        },
        'src/app/views/item-explorer/item-explorer-collections.service.ts': {
          statements: 65.92,
          branches: 51.6,
          functions: 79.31,
          lines: 73.17,
        },
        'src/app/views/item-explorer/item-explorer-comments.service.ts': {
          statements: 82.84,
          branches: 64.28,
          functions: 80,
          lines: 85.9,
        },
        'src/app/views/item-explorer/item-explorer-draft.service.ts': {
          statements: 82.46,
          branches: 68.63,
          functions: 85.29,
          lines: 83.98,
        },
        'src/app/views/item-explorer/item-explorer-import.service.ts': {
          statements: 99.21,
          branches: 90.21,
          functions: 100,
          lines: 100,
        },
        'src/app/views/item-explorer/item-explorer-personal-data.service.ts': {
          statements: 79.75,
          branches: 69.43,
          functions: 82.53,
          lines: 83.92,
        },
        'src/app/views/item-explorer/item-explorer-player.service.ts': {
          statements: 85.58,
          branches: 69.56,
          functions: 97.14,
          lines: 90.54,
        },
        'src/app/views/item-explorer/item-explorer-table.service.ts': {
          statements: 86.78,
          branches: 79.34,
          functions: 92.71,
          lines: 89.35,
        },
        'src/app/views/item-explorer/item-explorer.facade.ts': {
          statements: 66.2,
          branches: 60.45,
          functions: 67.92,
          lines: 68.45,
        },
      },
    },
  },
});
