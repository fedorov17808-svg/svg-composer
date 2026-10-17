// Builds the demo data with the app's own code, in a real browser (extraction needs layout):
//   public/seed-library.json — components for the first start;
//   public/examples/*.json, *.svg — example projects and their SVG export, plus index.json.
// Usage: npm run seed
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'

const PORT = 5192

/**
 * What a click on `group` (or on the loose shape `leaf`) selects in the source, under a Russian name.
 * `grow`: a marquee over the group's box, this share taller up and down, instead of a click.
 */
const PICKS = [
  { id: 'seed-s01-gopher', source: 's01', group: 0, name: 'Голубой гофер' },
  { id: 'seed-s01-chart', source: 's01', leaf: 76, name: 'График роста' },
  { id: 'seed-s03-shop', source: 's03', group: 0, name: 'Магазин' },
  { id: 'seed-s07-phone', source: 's07', group: 0, name: 'Гофер со смартфоном' },
  { id: 'seed-s08-pink', source: 's08', group: 0, name: 'Розовый гофер с монетой' },
  { id: 'seed-s08-piggy', source: 's08', group: 33, name: 'Копилка' },
  { id: 'seed-s10-sage', source: 's10', group: 0, name: 'Гофер-мудрец' },
  { id: 'seed-s11-roof', source: 's11', group: 2, name: 'Крыша пагоды' },
  // A click takes only the ball; a marquee around it adds the cap. The tassels are zero-width lines
  // with empty group bounds: neither the marquee nor Shift+click takes them (see PROGRESS.md).
  { id: 'seed-s12-lantern', source: 's12', group: 39, grow: 0.9, name: 'Красный фонарь' },
  { id: 'seed-s14-carp', source: 's14', group: 0, name: 'Карп' },
  { id: 'seed-s16-hello', source: 's16', group: 76, name: 'Облачко HELLO' },
  { id: 'seed-s20-tree', source: 's20', group: 35, name: 'Ёлка со звездой' },
]

/**
 * Objects by center x (or left edge), bottom y and height on a 1200×800 canvas, bottom to top.
 * `name` overrides the component name (it becomes the `<g id>` in the SVG).
 */
const EXAMPLES = [
  {
    id: 'holiday',
    title: 'Гоферы на празднике',
    objects: [
      { c: 'seed-s20-tree', cx: 600, bottom: 770, h: 600 },
      { c: 'seed-s12-lantern', cx: 150, bottom: 260, h: 190 },
      { c: 'seed-s12-lantern', cx: 1050, bottom: 260, h: 190 },
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
      { c: 'seed-s11-roof', cx: 600, bottom: 230, h: 170 },
      { c: 'seed-s12-lantern', cx: 250, bottom: 470, h: 170 },
      { c: 'seed-s12-lantern', cx: 950, bottom: 470, h: 170 },
      { c: 'seed-s14-carp', cx: 220, bottom: 780, h: 230 },
      { c: 'seed-s14-carp', cx: 980, bottom: 780, h: 230, flipX: true },
      { c: 'seed-s10-sage', cx: 600, bottom: 780, h: 440 },
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
        if (pick.grow) {
          const b = editor.nodes[pick.group]
          editor.selectRect({ x: b.x - 1, y: b.y - b.height * pick.grow, width: b.width + 2, height: b.height * (1 + 2 * pick.grow) }, false)
        } else if (pick.group !== undefined) editor.select(pick.group, false)
        else editor.selectLeaf(pick.leaf, false)
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
            x: +(o.left ?? o.cx - (c.width * scale) / 2).toFixed(2),
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
