import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Browser tests in e2e/ run with Playwright: npm run test:e2e
  test: { include: ['src/**/*.test.ts'] },
})
