// Builds the examples of the "Проект → Открыть пример" menu with the app's own code, in a real
// browser: for each one the metaphor is picked locally, laid out on its canvas format and size,
// painted in its scheme and exported by the same exportSvg the «Экспорт → SVG» button uses.
//   public/examples/<id>.json (project), <id>.svg (export), index.json (the menu).
// Also writes scripts/out/examples/sheet.png, a contact sheet to check them by eye.
// Usage: npm run examples
import { chromium } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'

const PORT = 5193

const METAPHORS = [
  { id: 'finance', text: 'Финансовая грамотность' },
  { id: 'remote', text: 'Удалённая работа' },
  { id: 'study', text: 'Учёба' },
]
const FORMATS = [
  { id: 'wide', label: 'Широкий 2:1' },
  { id: 'square', label: 'Квадрат 1:1' },
  { id: 'tall', label: 'Вертикальный 2:3' },
]
const SCHEMES = { lilac: 'сиреневая', peach: 'персиковая', mint: 'мятная' }

/** One row per metaphor: scheme, object size, background amount and seed for wide, square, tall. */
const EXAMPLES = {
  finance: [
    { palette: 'lilac', objectSize: 'L', background: 'few', seed: 1 },
    { palette: 'peach', objectSize: 'L', background: 'few', seed: 1 },
    { palette: 'mint', objectSize: 'L', background: 'few', seed: 1 },
  ],
  remote: [
    { palette: 'mint', objectSize: 'L', background: 'few', seed: 1 },
    { palette: 'lilac', objectSize: 'S', background: 'few', seed: 1 },
    { palette: 'peach', objectSize: 'L', background: 'few', seed: 1 },
  ],
  study: [
    { palette: 'peach', objectSize: 'L', background: 'few', seed: 1 },
    { palette: 'mint', objectSize: 'L', background: 'few', seed: 1 },
    { palette: 'lilac', objectSize: 'S', background: 'few', seed: 1 },
  ],
}

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch()
try {
  rmSync('public/examples', { recursive: true, force: true })
  mkdirSync('public/examples', { recursive: true })
  mkdirSync('scripts/out/examples', { recursive: true })
  const index = []
  const sheet = []
  for (const metaphor of METAPHORS) {
    for (const [i, format] of FORMATS.entries()) {
      const spec = EXAMPLES[metaphor.id][i]
      const id = `${metaphor.id}-${format.id}`
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      const page = await context.newPage()
      await page.addInitScript(() => localStorage.setItem('svg-composer-no-demo', '1'))
      await page.goto(`http://localhost:${PORT}/`)
      const files = await page.evaluate(
        async ({ metaphor, format, spec }) => {
          const { useCanvasStore } = await import('/src/store/canvas.ts')
          const { useObjectLibraryStore } = await import('/src/store/objectLibrary.ts')
          const { useLibraryStore } = await import('/src/store/library.ts')
          const { usePalettesStore, findPalette, paintObject } = await import('/src/store/palettes.ts')
          const { buildComposition } = await import('/src/store/compose.ts')
          const { pickLocal } = await import('/src/lib/metaphor.ts')
          const { exportSvg } = await import('/src/lib/exportSvg.ts')
          const { createProject, serializeProject } = await import('/src/lib/project.ts')
          await usePalettesStore.getState().load()
          await useObjectLibraryStore.getState().load()
          while (useObjectLibraryStore.getState().status !== 'ready') await new Promise((r) => setTimeout(r, 50))
          const canvas = useCanvasStore.getState()
          canvas.setObjectSize(spec.objectSize)
          canvas.setFormat(format.id)
          canvas.setPalette(spec.palette)
          const pick = pickLocal(metaphor.text, useObjectLibraryStore.getState().objects)
          const built = buildComposition({
            objectIds: pick.objectIds,
            background: spec.background,
            seed: spec.seed,
            metaphor: { text: metaphor.text, reasons: pick.reasons, source: pick.source },
          })
          if (!built) throw new Error('composition not built')
          // The same two steps as «Сохранить проект» and «Экспорт → SVG» in the header menu.
          const { size, objects, paletteId, format: fmt, objectSize, auto } = useCanvasStore.getState()
          const palette = findPalette(usePalettesStore.getState(), paletteId)
          const components = useLibraryStore.getState().components
          const project = createProject(size, objects, components, palette, { format: fmt, objectSize, auto })
          const byId = new Map(components.map((c) => [c.id, c]))
          const svg = exportSvg({ size, objects, components: byId, paint: (o, c) => paintObject(o, c, palette), background: palette.background[0] })
          return { json: serializeProject({ ...project, savedAt: '2026-10-25T00:00:00.000Z' }), svg, size, reasons: pick.reasons.map((r) => r.objectId) }
        },
        { metaphor, format, spec },
      )
      await context.close()
      writeFileSync(`public/examples/${id}.json`, files.json + '\n')
      writeFileSync(`public/examples/${id}.svg`, files.svg)
      index.push({
        id,
        title: `${metaphor.text} — ${format.label.toLowerCase()}, ${SCHEMES[spec.palette]}`,
        group: metaphor.text,
        label: `${format.label} · ${SCHEMES[spec.palette]}, ${spec.objectSize}`,
        file: `examples/${id}.json`,
        svg: `examples/${id}.svg`,
      })
      sheet.push({ id, ...files.size, objects: files.reasons })
      console.log(id, spec.palette, spec.objectSize, files.reasons.join(','))
    }
  }
  writeFileSync('public/examples/index.json', JSON.stringify(index, null, 2) + '\n')

  // Contact sheet: every exported file as the browser draws it, on a gray page.
  const page = await browser.newPage({ viewport: { width: 1500, height: 1250 } })
  const cell = (e) => `<figure><img src="http://localhost:${PORT}/examples/${e.id}.svg"><figcaption>${e.id}</figcaption></figure>`
  await page.setContent(
    `<style>body{margin:0;padding:12px;background:#777;display:grid;grid-template-columns:repeat(3,1fr);gap:12px;font:12px sans-serif;color:#fff}
     figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:4px}img{max-width:100%;max-height:380px;background:#fff}</style>${sheet.map(cell).join('')}`,
  )
  await page.waitForFunction(() => [...document.images].every((img) => img.complete))
  await page.screenshot({ path: 'scripts/out/examples/sheet.png', fullPage: true })
  for (const e of sheet) {
    const p = await browser.newPage({ viewport: { width: Math.round(e.width / 2), height: Math.round(e.height / 2) } })
    await p.setContent(`<body style="margin:0"><img src="http://localhost:${PORT}/examples/${e.id}.svg" style="display:block;width:100%">`)
    await p.waitForFunction(() => document.images[0].complete)
    await p.screenshot({ path: `scripts/out/examples/${e.id}.png` })
    await p.close()
  }
} finally {
  await browser.close()
  await server.close()
}
