import { expect, test } from '@playwright/test'
import { openSource, skipDemo } from './render'

test.beforeEach(skipDemo)

/**
 * Logical objects on all 20 sources: a real click in the middle of every large object selects the
 * whole object; a gopher never comes out as a bare body (body fill without eyes); nothing selected
 * is bigger than 70 % of the illustration or holds two characters. Prints a table of what a click
 * on each object selects.
 */

const SOURCES = Array.from({ length: 20 }, (_, i) => `s${String(i + 1).padStart(2, '0')}`)
/** Objects at least this share of the drawing's area are checked. */
const LARGE_SHARE = 0.05
/** Gopher body fills: cyan and pink gophers. */
const GOPHER_BODY = ['#61e0ee', '#e98fca']
/** Gophers without visible eyes in the source too: s05 is drawn from behind, s15 wears a VR headset. */
const NO_FACE = new Set(['s05:#10', 's15:#13'])

interface Target {
  object: number
  label: string
  groups: number[]
  leaves: number[]
  x: number
  y: number
}

/** Same share as `MAX_ILLUSTRATION_SHARE` in `src/lib/objects.ts`. */
const MAX_ILLUSTRATION_SHARE = 0.7

interface Row {
  source: string
  object: string
  groups: number
  size: string
  share: string
  character: boolean
  colors: number
  white: number
  dark: number
  ok: boolean
}

const table: Row[] = []

for (const source of SOURCES) {
  test(`${source}: клик по каждому крупному объекту выбирает его целиком`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await openSource(page, source)

    // Click-level objects (what a click on one of their members selects) and a point that hits them.
    const { targets, viewBox } = await page.evaluate(async (LARGE_SHARE) => {
      const { useEditorStore, clickedObject } = await import('/src/store/editor.ts')
      const { unionRects } = await import('/src/lib/extract.ts')
      const state = useEditorStore.getState()
      const { nodes, elements, leaves, leafElements, objects, leafObject } = state
      const svg = elements[0].ownerSVGElement!
      const vb = svg.viewBox.baseVal
      const rect = svg.getBoundingClientRect()
      const k = rect.width / vb.width
      const scene = unionRects(nodes.filter((n) => n.parent < 0 && n.width > 0 && n.height > 0))
      const groupOf = new Map(elements.map((el, i) => [el as Element, i]))
      const leafOf = new Map(leafElements.map((el, i) => [el as Element, i]))
      // Same rule as the source viewer: a shape that is a part of an object, else its group.
      const targetAt = (x: number, y: number) => {
        let group: number | null = null
        let leaf: number | null = null
        for (let el = document.elementFromPoint(x, y); el && el !== svg; el = el.parentElement) {
          if (leaf === null && leafOf.has(el)) leaf = leafOf.get(el)!
          if (groupOf.has(el)) {
            group = groupOf.get(el)!
            break
          }
        }
        if (leaf !== null && leafObject[leaf] >= 0 && leaves[leaf].parent === (group ?? -1)) return { leaf }
        return group === null ? null : { group }
      }
      const targets: { object: number; label: string; groups: number[]; leaves: number[]; x: number; y: number }[] = []
      objects.forEach((object, index) => {
        const start = object.groups.length ? { group: object.groups[0] } : { leaf: object.leaves[0] }
        if (clickedObject(state, start) !== object) return
        const box = object.box
        if (box.width * box.height < scene.width * scene.height * LARGE_SHARE) return
        // Grid points inside the box, nearest to its center first.
        const points: [number, number][] = []
        for (let i = 1; i < 20; i++) for (let j = 1; j < 20; j++) points.push([box.x + (box.width * i) / 20, box.y + (box.height * j) / 20])
        const cx = box.x + box.width / 2
        const cy = box.y + box.height / 2
        points.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy))
        for (const [x, y] of points) {
          const sx = rect.x + (x - vb.x) * k
          const sy = rect.y + (y - vb.y) * k
          // Away from edges: the point and its neighbours hit the same object, whatever the rounding.
          const around = [[0, 0], [-3, 0], [3, 0], [0, -3], [0, 3]].map(([dx, dy]) => targetAt(sx + dx, sy + dy))
          if (around.every((t) => t !== null && clickedObject(state, t) === object)) {
            const main = [...object.groups].sort((a, b) => nodes[b].width * nodes[b].height - nodes[a].width * nodes[a].height)[0]
            const label = main !== undefined ? `#${main + 1}` : `деталь ${object.leaves[0] + 1}`
            targets.push({ object: index, label, groups: [...object.groups].sort((a, b) => a - b), leaves: [...object.leaves].sort((a, b) => a - b), x: sx, y: sy })
            return
          }
        }
      })
      return { targets, viewBox: { width: vb.width, height: vb.height } }
    }, LARGE_SHARE)
    expect(targets.length, 'в исходнике есть крупные объекты').toBeGreaterThan(0)

    for (const target of targets as Target[]) {
      await page.mouse.click(target.x, target.y)
      const result = await page.evaluate(async () => {
        const { useEditorStore, selectedParts } = await import('/src/store/editor.ts')
        const { extract, componentSvg, unionRects } = await import('/src/lib/extract.ts')
        const state = useEditorStore.getState()
        const parts = selectedParts(state)
        const component = extract({ ...parts, prefix: 'otest-' })
        const svg = componentSvg(component)
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
        const fills = [...new Set([...doc.querySelectorAll('[fill]')].map((el) => el.getAttribute('fill')!.toLowerCase()))].filter(
          (f) => f !== 'none' && !f.startsWith('url'),
        )
        // Render on grey: white eye whites and dark pupils stand out from the background.
        const img = new Image()
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
        await img.decode()
        const scale = 300 / Math.max(component.width, component.height)
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(component.width * scale))
        canvas.height = Math.max(1, Math.round(component.height * scale))
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#808080'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        let painted = 0
        let white = 0
        let dark = 0
        for (let i = 0; i < data.length; i += 4) {
          const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
          if (r === 128 && g === 128 && b === 128) continue
          painted++
          if (r >= 245 && g >= 245 && b >= 245) white++
          else if (r <= 60 && g <= 60 && b <= 60) dark++
        }
        const bounds = unionRects(parts.bounds)
        return {
          selected: state.selection.map((item) => item.node).sort((a, b) => a - b),
          leaves: [...state.selectedLeaves].sort((a, b) => a - b),
          // Characters among the selected groups: gopher eye whites are separate shapes, two per gopher.
          width: component.width,
          height: component.height,
          bounds: { width: bounds.width, height: bounds.height },
          fills,
          white: painted ? white / painted : 0,
          dark: painted ? dark / painted : 0,
        }
      })
      await page.keyboard.press('Escape')

      const { label } = target
      const character = result.fills.some((f) => GOPHER_BODY.includes(f))
      const where = `${source} ${label}`
      // The click selects the whole object, nothing more.
      expect(result.selected, `${where}: выбран весь объект`).toEqual(target.groups)
      expect(result.leaves, `${where}: детали объекта`).toEqual(target.leaves)
      // Never bigger than the illustration (s18/s19 are 5000 units wide, the others 144 or 600)
      // and not a whole scene.
      expect(result.width, `${where}: ширина`).toBeLessThanOrEqual(viewBox.width + 1e-6)
      expect(result.height, `${where}: высота`).toBeLessThanOrEqual(viewBox.height + 1e-6)
      expect(result.width * result.height, `${where}: не больше 70 % иллюстрации`).toBeLessThanOrEqual(
        viewBox.width * viewBox.height * MAX_ILLUSTRATION_SHARE,
      )
      expect(result.width).toBeCloseTo(result.bounds.width, 2)
      let ok = true
      if (character && !NO_FACE.has(`${source}:${label}`)) {
        // Not a bare body: several fills, eye whites and dark pupils.
        ok = result.fills.length > 1 && result.white > 0.003 && result.dark > 0.003
        expect(result.fills.length, `${where}: больше одного цвета`).toBeGreaterThan(1)
        expect(result.white, `${where}: белки глаз`).toBeGreaterThan(0.003)
        expect(result.dark, `${where}: тёмные детали`).toBeGreaterThan(0.003)
      }
      table.push({
        source,
        object: label,
        groups: target.groups.length + target.leaves.length,
        size: `${+result.width.toFixed(1)}×${+result.height.toFixed(1)}`,
        share: `${Math.round((result.width / viewBox.width) * 100)}×${Math.round((result.height / viewBox.height) * 100)} %`,
        character,
        colors: result.fills.length,
        white: +(result.white * 100).toFixed(1),
        dark: +(result.dark * 100).toFixed(1),
        ok,
      })
    }
    const rows = table.filter((r) => r.source === source)
    await info.attach('objects', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' })
    console.log(
      rows
        .map((r) => `[${info.project.name}] ${r.source} ${r.object} групп ${r.groups} ${r.size} (${r.share}) цветов ${r.colors} белое ${r.white}% тёмное ${r.dark}%${r.character ? ' гофер' : ''} ${r.ok ? 'ок' : 'НЕТ'}`)
        .join('\n'),
    )
  })
}
