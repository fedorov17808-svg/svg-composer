// Contact sheet of the automatic layout, to check it by eye: 6 sets of objects × 3 formats × 2
// variants, with the app's own code (layout, recoloring, SVG export) in a real browser.
//   scripts/out/auto-layout/sheet.png — all of them; {set}-{format}-{variant}.png — each one.
// Usage: npm run auto-layout-sheet
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'

const PORT = 5193
const OUT = 'scripts/out/auto-layout'

/** Names as a person types them; the background amount is part of the set. */
const SETS = [
  { id: 'one', text: 'лампа', background: 'few' },
  { id: 'two', text: 'наушники, телефон', background: 'none' },
  { id: 'three', text: 'книга, лампа, ручка', background: 'few' },
  { id: 'money', text: 'монета, кошелёк, телефон', background: 'many' },
  { id: 'small-big', text: 'монета, папка', background: 'few' },
  { id: 'five', text: 'цветы, книга, пазл, наушники, папка', background: 'many' },
]
const FORMATS = ['wide', 'square', 'tall']
const SEEDS = [1, 2]
/** Width of one cell of the sheet. */
const CELL = 360

mkdirSync(OUT, { recursive: true })
const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  await page.goto(`http://localhost:${PORT}/`)
  const cells = await page.evaluate(
    async ({ SETS, FORMATS, SEEDS }) => {
      const { composeObjects } = await import('/src/lib/compose.ts')
      const { parseNames } = await import('/src/lib/objectNames.ts')
      const { FORMATS: PRESETS } = await import('/src/lib/formats.ts')
      const { exportSvg } = await import('/src/lib/exportSvg.ts')
      const { paintComponent, BASE_PALETTE } = await import('/src/lib/palette.ts')
      const { versionComponent, OBJECT_SIZES, OBJECT_STATES } = await import('/src/store/objectLibrary.ts')
      const library = await (await fetch('/library/manifest.json')).json()
      const components = new Map()
      for (const object of library) {
        for (const size of OBJECT_SIZES) {
          for (const state of OBJECT_STATES) {
            const svg = await (await fetch('/' + object.versions[size][state].file)).text()
            const c = versionComponent(object, size, state, svg)
            components.set(c.id, c)
          }
        }
      }
      const out = []
      for (const set of SETS) {
        const objectIds = parseNames(set.text, library).map((m) => m.objectId).filter(Boolean)
        for (const format of FORMATS) {
          const size = PRESETS.find((f) => f.id === format).size
          for (const seed of SEEDS) {
            const objects = composeObjects({ objectIds, background: set.background, seed }, library, size, 'L')
            const svg = exportSvg({
              size,
              objects,
              components,
              paint: (obj, c) => paintComponent(c, BASE_PALETTE, obj.variant),
              background: BASE_PALETTE.background[0],
            })
            out.push({ set: set.id, text: set.text, background: set.background, format, seed, size, svg })
          }
        }
      }
      return out
    },
    { SETS, FORMATS, SEEDS },
  )

  // Each composition alone, then all of them on one sheet: a row per set, 2 variants per format.
  const html = (items, width) =>
    `<body style="margin:0;font:13px system-ui;background:#fff">${items
      .map(
        (c) =>
          `<figure style="display:inline-block;vertical-align:top;margin:8px;width:${width}px">` +
          `<img style="display:block;max-width:${width}px;max-height:${width}px;outline:1px solid #ccc" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(c.svg)}">` +
          `<figcaption>${c.text} · фон: ${c.background} · ${c.format} · seed ${c.seed}</figcaption></figure>`,
      )
      .join('')}</body>`
  for (const c of cells) {
    await page.setContent(html([c], 600))
    await page.locator('img').evaluate((img) => img.decode())
    await page.locator('figure').screenshot({ path: `${OUT}/${c.set}-${c.format}-${c.seed}.png` })
  }
  await page.setViewportSize({ width: (CELL + 16) * FORMATS.length * SEEDS.length, height: 1000 })
  await page.setContent(html(cells, CELL))
  await page.$$eval('img', (imgs) => Promise.all(imgs.map((img) => img.decode())))
  await page.screenshot({ path: `${OUT}/sheet.png`, fullPage: true })
  writeFileSync(`${OUT}/sheet.json`, JSON.stringify(cells.map(({ svg: _svg, ...c }) => c), null, 2) + '\n')
  console.log(`${OUT}/sheet.png: ${cells.length} compositions`)
} finally {
  await browser.close()
  await server.close()
}
