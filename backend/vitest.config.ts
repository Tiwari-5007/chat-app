import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,           // enables 'describe', 'it', 'expect' globally
    environment: 'node',     // Node.js test environment
    include: ['src/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',        // built-in coverage
      reporter: ['text', 'html'],
      exclude: [
        'node_modules/**',         // Third-party packages
        'src/generated/**',        // Prisma generated code
        'src/types/**',            // Type definitions
        'src/lib/logger.ts',       // Logger utility (usually simple pass-through)
        'src/app.ts',              // App bootstrap (server setup, routing)
        'src/server.ts',           // Server entry point
        'src/errors/AppError.ts',  // Custom error class (minimal logic)
        'src/errors/prismaErrorMapper.ts', // Prisma error mapper (optional, minimal logic)
        '**/*.d.ts',               // TypeScript declaration files
      ],
      thresholds: {
        statements: 90,
        functions: 90,
        branches: 90,
        lines: 90,
      },
    },
  },
});
