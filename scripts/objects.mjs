// Builds the object markup of the sources in a real browser (bounds need layout):
//   1. a starting list per source from the click algorithm (`clickedObject`): every distinct object a
//      click can select, nested ones dropped, overlaps given to the bigger object;
//   2. hand corrections from scripts/object-overrides.json (see `ObjectOverride` in src/lib/marks.ts);
//   3. public/sources/objects.json, plus for review in scripts/out/: every object rendered alone
//      over the faded source (sNN-K.png), a contact sheet per source (sNN.png) with what is left
//      unmarked, and the index (sNN-index.json: boxes, parents and colors of groups and leaves);
//   4. a check of every object: its box against the box of its painted pixels. A box more than
//      10 % wider or taller than what is painted means an invisible member; such objects are listed
//      in scripts/out/report.json and the script exits with 1.
// Usage: npm run objects [-- s03 s05]   (with ids: render only these sources; the JSON is always full)
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'

const PORT = 5193
const OUT = 'scripts/out'
const only = process.argv.slice(2)
/** A box may be at most this much wider or taller than its painted pixels. */
const MAX_SLACK = 1.1

const overrides = JSON.parse(readFileSync('scripts/object-overrides.json', 'utf8'))
const manifest = JSON.parse(readFileSync('public/sources/manifest.json', 'utf8'))

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch()
mkdirSync(OUT, { recursive: true })
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  await page.addInitScript(() => localStorage.setItem('svg-composer-seeded', '1'))
  await page.goto(`http://localhost:${PORT}/`)
  const sheet = await browser.newPage({ viewport: { width: 1240, height: 400 } })

  const result = {}
  const report = []
  for (const { id: source, title } of manifest) {
    const data = await page.evaluate(
      async ({ source, overrides }) => {
        const { useEditorStore, clickedObject } = await import('/src/store/editor.ts')
        const { groupLeaves } = await import('/src/lib/selection.ts')
        const { applyOverrides } = await import('/src/lib/marks.ts')
        useEditorStore.getState().close()
        useEditorStore.getState().open(source)
        while (useEditorStore.getState().nodes.length === 0) await new Promise((r) => setTimeout(r, 50))
        const state = useEditorStore.getState()
        const { nodes, leaves, leafObject } = state

        // Every distinct object a click on a visible shape selects.
        const seen = new Map()
        leaves.forEach((leaf, l) => {
          if (!leaf.visible) return
          const target = leafObject[l] >= 0 ? { leaf: l } : leaf.parent >= 0 ? { group: leaf.parent } : null
          if (!target) return
          const o = clickedObject(state, target)
          seen.set(`${o.groups}|${o.leaves}`, o)
        })
        const leafSet = (o) => new Set([...o.leaves, ...o.groups.flatMap((g) => groupLeaves(nodes, leaves, g))])
        const found = [...seen.values()].map((o) => ({ o, set: leafSet(o) })).sort((a, b) => b.set.size - a.set.size)
        const kept = []
        for (const f of found) if (!kept.some((k) => [...f.set].every((l) => k.set.has(l)))) kept.push(f)
        // Partial overlaps go to the bigger object.
        const owned = new Set()
        const generated = []
        for (const { o } of kept) {
          const groups = o.groups.filter((g) => !groupLeaves(nodes, leaves, g).some((l) => owned.has(l)))
          const free = o.leaves.filter((l) => !owned.has(l))
          for (const l of leafSet({ groups, leaves: free })) owned.add(l)
          if (groups.length + free.length) generated.push({ groups, leaves: free })
        }
        const first = (o) => Math.min(...o.groups.map((g) => nodes[g].order), ...o.leaves.map((l) => leaves[l].order))
        generated.sort((a, b) => first(a) - first(b))
        generated.forEach((o, i) => (o.name = `Объект ${i}`))

        const tree = { groupParent: nodes.map((n) => n.parent), leafParent: leaves.map((l) => l.parent) }
        let marks
        try {
          marks = applyOverrides(generated, tree, overrides ?? [])
        } catch (err) {
          throw new Error(`${source}: ${err.message} (generated ${generated.length}: ${JSON.stringify(generated)})`)
        }
        const round = (b) => [b.x, b.y, b.width, b.height].map((v) => +v.toFixed(1))
        const index = {
          groups: nodes.map((n, i) => ({ i, parent: n.parent, box: round(n), elements: n.elementCount })),
          leaves: leaves.map((l, i) => ({
            i,
            parent: l.parent,
            tag: l.tag,
            box: round(l),
            visible: l.visible,
            fill: state.leafElements[i].getAttribute('fill'),
            stroke: state.leafElements[i].getAttribute('stroke'),
          })),
        }
        return { generated, marks, index }
      },
      { source, overrides: overrides[source] },
    )
    result[source] = data.marks
    console.log(`${source}: ${data.generated.length} generated → ${data.marks.length} objects`)

    // Box of each object against its painted pixels.
    const sizes = await page.evaluate(async ({ marks, source }) => {
      const { useEditorStore, selectedParts, markState } = await import('/src/store/editor.ts')
      const { extract, paintedBounds } = await import('/src/lib/extract.ts')
      const state = useEditorStore.getState()
      // Markup of this run, not the objects.json the app loaded.
      useEditorStore.setState(markState(state, marks))
      const out = []
      for (const mark of marks) {
        const editor = useEditorStore.getState()
        if (mark.groups.length) editor.select(mark.groups[0], false)
        else editor.selectLeaf(mark.leaves[0], false)
        const component = extract({ ...selectedParts(useEditorStore.getState()), prefix: `check-${source}-` })
        out.push({ name: mark.name, box: [component.width, component.height], painted: await paintedBounds(component) })
      }
      // The review renders below show the source without a selection frame.
      useEditorStore.getState().clearSelection()
      return out
    }, { marks: data.marks, source })
    for (const { name, box, painted } of sizes) {
      const slack = Math.max(box[0] / painted.width, box[1] / painted.height)
      if (!(slack <= MAX_SLACK)) {
        const row = { source, name, box: box.map((v) => +v.toFixed(1)), painted: [painted.width, painted.height].map((v) => +v.toFixed(1)), slack: +slack.toFixed(2) }
        report.push(row)
        console.log(`  ! ${name}: рамка ${row.box.join('×')}, видимое ${row.painted.join('×')} (×${row.slack})`)
      }
    }
    if (only.length && !only.includes(source)) continue
    writeFileSync(`${OUT}/${source}-index.json`, JSON.stringify({ generated: data.generated, ...data.index }, null, 1))

    // Each object alone (everything else faded), then what is left unmarked.
    const shots = []
    for (let i = 0; i <= data.marks.length; i++) {
      await page.evaluate(
        async ({ marks, i }) => {
          const { useEditorStore } = await import('/src/store/editor.ts')
          const { markIndex } = await import('/src/lib/marks.ts')
          const { nodes, leaves, leafElements } = useEditorStore.getState()
          const tree = { groupParent: nodes.map((n) => n.parent), leafParent: leaves.map((l) => l.parent) }
          const { leafMark } = markIndex(marks, tree)
          // i === marks.length: the leftovers, shapes of no object.
          const wanted = i === marks.length ? -1 : i
          leafElements.forEach((el, l) => (el.style.opacity = leafMark[l] === wanted ? '' : '0.08'))
        },
        { marks: data.marks, i },
      )
      const label = i === data.marks.length ? 'не размечено' : `#${i} ${data.marks[i].name}`
      const file = i === data.marks.length ? `${OUT}/${source}-rest.png` : `${OUT}/${source}-${i}.png`
      const png = await page.locator('.source-host svg').screenshot({ path: file })
      shots.push({ label, src: `data:image/png;base64,${png.toString('base64')}` })
    }
    await sheet.setContent(
      `<body style="margin:8px;font:14px sans-serif;background:#ddd"><h3 style="margin:4px">${source} · ${title}</h3>
      <div style="display:grid;grid-template-columns:repeat(4,300px);gap:6px">${shots
        .map((s) => `<figure style="margin:0;background:#fff"><img src="${s.src}" style="width:300px;height:240px;object-fit:contain"><figcaption>${s.label}</figcaption></figure>`)
        .join('')}</div></body>`,
    )
    await sheet.screenshot({ path: `${OUT}/${source}.png`, fullPage: true })
  }
  writeFileSync('public/sources/objects.json', JSON.stringify(result) + '\n')
  console.log(`public/sources/objects.json: ${Object.values(result).flat().length} objects`)
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(report.length ? `${report.length} objects with a box bigger than painted: ${OUT}/report.json` : 'all boxes fit what is painted')
  if (report.length) process.exitCode = 1
} finally {
  await browser.close()
  await server.close()
}
