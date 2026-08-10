import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', '.next', 'e2e/**'],
    env: {
      // Dummy values so modules that construct a Supabase client at import
      // time (most of app/api/**) don't crash on `supabaseUrl is required`
      // when a test imports them without mocking @supabase/supabase-js.
      // Never real — no test in this suite hits a real Supabase project.
      NEXT_PUBLIC_SUPABASE_URL: 'https://test-placeholder.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-placeholder-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-placeholder-service-role-key',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
