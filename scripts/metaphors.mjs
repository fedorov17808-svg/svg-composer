// Scenario 1 by eye: 15 metaphors → the objects the local matcher picks and why, and each
// composition in the three formats, with the app's own code in a real browser.
//   scripts/out/metaphors/table.md — metaphor, objects, reasons;
//   scripts/out/metaphors/sheet.png — 15 rows × 3 formats.
// Usage: npm run metaphors-sheet
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'

const PORT = 5194
const OUT = 'scripts/out/metaphors'

export const METAPHORS = [
  'Финансовая грамотность',
  'Учёба без стресса',
  'Удалённая работа',
  'Идея',
  'Командная работа',
  'Подарок маме на 8 марта',
  'Как сэкономить семейный бюджет',
  'Подкаст о музыке',
  'Подписание договора',
  'Онлайн-покупки с кешбэком',
  'Порядок в документах',
  'Весеннее настроение',
  'Ночная подготовка к экзамену',
  'Стратегия развития бизнеса',
  'Безопасные платежи',
]
const FORMATS = ['wide', 'square', 'tall']
const CELL = 300

mkdirSync(OUT, { recursive: true })
const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  await page.goto(`http://localhost:${PORT}/`)
  const rows = await page.evaluate(
    async ({ METAPHORS, FORMATS }) => {
      const { pickLocal } = await import('/src/lib/metaphor.ts')
      const { composeObjects } = await import('/src/lib/compose.ts')
      const { FORMATS: PRESETS } = await import('/src/lib/formats.ts')
      const { exportSvg } = await import('/src/lib/exportSvg.ts')
      const { paintComponent, BASE_PALETTE } = await import('/src/lib/palette.ts')
      const { versionComponent, OBJECT_SIZES, OBJECT_STATES } = await import('/src/store/objectLibrary.ts')
      const library = await (await fetch('/library/manifest.json')).json()
      const components = new Map()
      for (const object of library) {
        for (const size of OBJECT_SIZES) {
          for (const state of OBJECT_STATES) {
            const c = versionComponent(object, size, state, await (await fetch('/' + object.versions[size][state].file)).text())
            components.set(c.id, c)
          }
        }
      }
      const name = (id) => library.find((o) => o.id === id).name.toLowerCase()
      return METAPHORS.map((text) => {
        const pick = pickLocal(text, library)
        const svgs = FORMATS.map((format) => {
          const size = PRESETS.find((f) => f.id === format).size
          const objects = composeObjects({ objectIds: pick.objectIds, background: 'few', seed: 1 }, library, size, 'L')
          return exportSvg({ size, objects, components, paint: (obj, c) => paintComponent(c, BASE_PALETTE, obj.variant), background: BASE_PALETTE.background[0] })
        })
        return { text, objects: pick.objectIds.map(name), reasons: pick.reasons.map((r) => `${name(r.objectId)} — ${r.text}`), svgs }
      })
    },
    { METAPHORS, FORMATS },
  )

  const table = ['| # | Метафора | Объекты | Почему |', '| --- | --- | --- | --- |', ...rows.map((r, i) => `| ${i + 1} | ${r.text} | ${r.objects.join(', ') || '—'} | ${r.reasons.join('; ') || '—'} |`)]
  writeFileSync(`${OUT}/table.md`, table.join('\n') + '\n')
  console.log(table.join('\n'))

  await page.setViewportSize({ width: (CELL + 16) * FORMATS.length + 220, height: 900 })
  await page.setContent(
    `<body style="margin:0;font:13px system-ui">${rows
      .map(
        (r) =>
          `<div style="display:flex;align-items:center;gap:8px;margin:6px"><div style="width:200px">${r.text}<br><small>${r.objects.join(', ')}</small></div>` +
          r.svgs.map((svg) => `<img style="max-width:${CELL}px;max-height:${CELL}px;outline:1px solid #ccc" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`).join('') +
          '</div>',
      )
      .join('')}</body>`,
  )
  await page.$$eval('img', (imgs) => Promise.all(imgs.map((img) => img.decode())))
  await page.screenshot({ path: `${OUT}/sheet.png`, fullPage: true })
} finally {
  await browser.close()
  await server.close()
}
