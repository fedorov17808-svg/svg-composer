import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * `npm run dev` serves POST /api/metaphor with the same handler as the Vercel function, and
 * ANTHROPIC_API_KEY from .env reaches only this server code (no VITE_ prefix, never the page).
 */
function apiInDev(): Plugin {
  return {
    name: 'api-in-dev',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '')
      server.middlewares.use('/api/metaphor', async (req, res) => {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        const { handle } = await server.ssrLoadModule('/api/metaphor.ts')
        const response: Response = await handle(
          new Request('http://localhost/api/metaphor', {
            method: req.method,
            headers: { 'content-type': req.headers['content-type'] ?? '' },
            body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
          }),
          env.ANTHROPIC_API_KEY || undefined,
        )
        res.statusCode = response.status
        res.setHeader('content-type', 'application/json')
        res.end(await response.text())
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), apiInDev()],
  // Browser tests in e2e/ run with Playwright: npm run test:e2e
  test: { include: ['src/**/*.test.ts', 'api/**/*.test.ts'] },
})
