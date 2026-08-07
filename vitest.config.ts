import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Database tests share one Postgres instance and manage their own isolation
    // per suite; running files in parallel would interleave TRUNCATEs.
    fileParallelism: false,
    /*
     * Clerk reads its publishable key when @clerk/nextjs is imported, not when
     * the middleware runs, so vi.stubEnv inside a test is too late. These are
     * structurally valid fake keys — pk_test_ decodes to "clerk.example.com$"
     * — and exist only so proxy.test.ts can exercise the public-host branch.
     * Nothing here reaches a real Clerk instance.
     */
    env: {
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_Y2xlcmsuZXhhbXBsZS5jb20k',
      CLERK_SECRET_KEY: 'sk_test_stub_not_a_real_key',
    },
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
  // The Next tsconfig uses jsx: 'preserve' for the compiler, so esbuild has to
  // be told how to transform JSX for component tests.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // See the stub for why this is safe — the real guard still runs in the build.
      'server-only': path.resolve(__dirname, 'tests/helpers/server-only-stub.ts'),
    },
  },
})
