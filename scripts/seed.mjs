// Builds the demo data with the app's own code, in a real browser (extraction needs layout):
//   public/seed-library.json — components for the first start;
//   public/examples/*.json, *.svg — example projects and their SVG export, plus index.json.
// Usage: npm run seed
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'

const PORT = 5192

/** Marked-up objects (`public/sources/objects.json`, by name) that become components, under a Russian name. */
const PICKS = [
  { id: 'seed-s01-gopher', source: 's01', object: 'Гофер слева', name: 'Голубой гофер' },
  { id: 'seed-s01-chart', source: 's01', object: 'График роста', name: 'График роста' },
  { id: 'seed-s03-shop', source: 's03', object: 'Магазин', name: 'Магазин' },
  { id: 'seed-s07-phone', source: 's07', object: 'Гофер со смартфоном', name: 'Гофер со смартфоном' },
  { id: 'seed-s08-pink', source: 's08', object: 'Розовый гофер с монетой', name: 'Розовый гофер с монетой' },
  { id: 'seed-s08-piggy', source: 's08', object: 'Копилка', name: 'Копилка' },
  { id: 'seed-s10-sage', source: 's10', object: 'Гофер-мудрец', name: 'Гофер-мудрец' },
  { id: 'seed-s11-pagoda', source: 's11', object: 'Пагода', name: 'Пагода' },
  { id: 'seed-s12-lantern', source: 's12', object: 'Фонарь на палке', name: 'Фонарь на палке' },
  { id: 'seed-s14-carp', source: 's14', object: 'Карп', name: 'Карп' },
  { id: 'seed-s16-hello', source: 's16', object: 'Облачко HELLO!', name: 'Облачко HELLO' },
  { id: 'seed-s20-tree', source: 's20', object: 'Ёлка со звездой', name: 'Ёлка со звездой' },
]

/**
 * Objects by center x (or left/right edge), bottom y and height on a 1200×800 canvas, bottom to top.
 * `name` overrides the component name (it becomes the `<g id>` in the SVG).
 */
const EXAMPLES = [
  {
    id: 'holiday',
    title: 'Гоферы на празднике',
    objects: [
      { c: 'seed-s20-tree', cx: 600, bottom: 770, h: 600 },
      { c: 'seed-s12-lantern', left: 20, bottom: 250, h: 170, flipX: true },
      { c: 'seed-s12-lantern', right: 1180, bottom: 250, h: 170 },
      { c: 'seed-s08-pink', cx: 300, bottom: 770, h: 360 },
      { c: 'seed-s01-gopher', cx: 900, bottom: 770, h: 330, flipX: true },
      { c: 'seed-s16-hello', cx: 1010, bottom: 420, h: 120 },
    ],
  },
  {
    id: 'work',
    title: 'Гоферы за работой',
    objects: [
      { c: 'seed-s03-shop', left: 60, bottom: 760, h: 440 },
      { c: 'seed-s01-chart', cx: 920, bottom: 330, h: 230 },
      { c: 'seed-s08-piggy', cx: 1010, bottom: 760, h: 200 },
      { c: 'seed-s07-phone', cx: 730, bottom: 760, h: 380 },
    ],
  },
  {
    id: 'garden',
    title: 'Восточный сад',
    objects: [
      { c: 'seed-s11-pagoda', cx: 600, bottom: 760, h: 600 },
      { c: 'seed-s12-lantern', left: 10, bottom: 330, h: 130, flipX: true },
      { c: 'seed-s12-lantern', right: 1190, bottom: 330, h: 130 },
      { c: 'seed-s14-carp', cx: 190, bottom: 780, h: 230 },
      { c: 'seed-s14-carp', cx: 1010, bottom: 780, h: 230, flipX: true },
      { c: 'seed-s10-sage', cx: 600, bottom: 760, h: 320 },
    ],
  },
]

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  // The app must not load the previous seed into the library while this script builds the new one.
  await page.addInitScript(() => localStorage.setItem('svg-composer-seeded', '1'))
  await page.goto(`http://localhost:${PORT}/`)

  const components = []
  for (const pick of PICKS) {
    components.push(
      await page.evaluate(async (pick) => {
        const { useEditorStore, selectedParts } = await import('/src/store/editor.ts')
        const { extract } = await import('/src/lib/extract.ts')
        useEditorStore.getState().open(pick.source)
        while (useEditorStore.getState().nodes.length === 0) await new Promise((r) => setTimeout(r, 50))
        const editor = useEditorStore.getState()
        // A click on any member selects the whole marked-up object.
        const mark = editor.marks.find((m) => m.name === pick.object)
        if (!mark) throw new Error(`${pick.source}: no object "${pick.object}"`)
        if (mark.groups.length) editor.select(mark.groups[0], false)
        else editor.selectLeaf(mark.leaves[0], false)
        const result = extract({ ...selectedParts(useEditorStore.getState()), prefix: `${pick.id}-` })
        return { id: pick.id, name: pick.name, sourceId: pick.source, ...result, createdAt: 0 }
      }, pick),
    )
  }
  // Keeps the order above in the library, which sorts by `createdAt`.
  components.forEach((c, i) => (c.createdAt = i + 1))
  writeFileSync('public/seed-library.json', JSON.stringify(components) + '\n')

  mkdirSync('public/examples', { recursive: true })
  for (const example of EXAMPLES) {
    const files = await page.evaluate(
      async ({ example, components }) => {
        const { exportSvg } = await import('/src/lib/exportSvg.ts')
        const { createProject, serializeProject } = await import('/src/lib/project.ts')
        const size = { width: 1200, height: 800 }
        const byId = new Map(components.map((c) => [c.id, c]))
        const objects = example.objects.map((o, i) => {
          const c = byId.get(o.c)
          const scale = o.h / c.height
          return {
            id: `${example.id}-${i + 1}`,
            componentId: c.id,
            name: c.name,
            x: +(o.left ?? (o.right !== undefined ? o.right - c.width * scale : o.cx - (c.width * scale) / 2)).toFixed(2),
            y: +(o.bottom - o.h).toFixed(2),
            scale: +scale.toFixed(4),
            rotation: 0,
            flipX: o.flipX === true,
          }
        })
        const project = createProject(size, objects, components)
        return { json: serializeProject({ ...project, savedAt: '2026-10-17T00:00:00.000Z' }), svg: exportSvg({ size, objects, components: byId }) }
      },
      { example, components },
    )
    writeFileSync(`public/examples/${example.id}.json`, files.json + '\n')
    writeFileSync(`public/examples/${example.id}.svg`, files.svg)
  }
  writeFileSync(
    'public/examples/index.json',
    JSON.stringify(EXAMPLES.map(({ id, title }) => ({ id, title, file: `examples/${id}.json` })), null, 2) + '\n',
  )
  console.log(`seed-library.json: ${components.length} components; examples: ${EXAMPLES.map((e) => e.id).join(', ')}`)
} finally {
  await browser.close()
  await server.close()
}
