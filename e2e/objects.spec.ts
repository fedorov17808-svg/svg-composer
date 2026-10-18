import { expect, test } from '@playwright/test'
import { openSource, skipDemo } from './render'

test.beforeEach(skipDemo)

/**
 * Marked-up objects (`public/sources/objects.json`) on all 20 sources: a real click on every object
 * selects exactly its groups and shapes, as one unit; a gopher never comes out as a bare body (body
 * fill without eyes); nothing is bigger than the illustration. Prints a table of what was selected.
 */

const SOURCES = Array.from({ length: 20 }, (_, i) => `s${String(i + 1).padStart(2, '0')}`)
/** Gopher body fills: cyan and pink gophers. */
const GOPHER_BODY = ['#61e0ee', '#e98fca']
/** Gophers without visible eyes in the source too: s05 is drawn from behind, s15 wears a VR headset. */
const NO_FACE = new Set(['s05:Гофер со спины', 's15:Гофер в VR-шлеме'])
/** Fills that must be in an object: the shop's awning stripes and its paw drawn in front of the shop. */
const MUST_HAVE: Record<string, string[]> = {
  's03:Магазин': ['#ffebe6', '#be2800'],
  's03:Гофер': ['#d6c295'],
  's05:Гофер со спины': ['#d6c295'],
  's12:Фонарь на палке': ['#b86400', '#dc1c4b'],
}
/** Fills that must not be in an object: the pole stays with the lantern, not with the gopher holding it. */
const MUST_NOT: Record<string, string[]> = {
  's12:Гофер': ['#b86400'],
}

interface Target {
  label: string
  groups: number[]
  leaves: number[]
  x: number
  y: number
}

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
  test(`${source}: клик по каждому размеченному объекту выбирает его целиком`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await openSource(page, source)

    // Marked-up objects and a point that hits each of them.
    const { targets, viewBox, total } = await page.evaluate(async () => {
      const { useEditorStore, markOf } = await import('/src/store/editor.ts')
      const state = useEditorStore.getState()
      const { elements, leafElements, marks, markBoxes, leafMark } = state
      const svg = elements[0].ownerSVGElement!
      const vb = svg.viewBox.baseVal
      const rect = svg.getBoundingClientRect()
      const k = rect.width / vb.width
      const groupOf = new Map(elements.map((el, i) => [el as Element, i]))
      const leafOf = new Map(leafElements.map((el, i) => [el as Element, i]))
      // Same rule as the source viewer: a marked-up shape, else its group.
      const markAt = (x: number, y: number) => {
        let leaf: number | null = null
        for (let el = document.elementFromPoint(x, y); el && el !== svg; el = el.parentElement) {
          if (leaf === null && leafOf.has(el)) {
            leaf = leafOf.get(el)!
            if (leafMark[leaf] >= 0) return leafMark[leaf]
          }
          if (groupOf.has(el)) return markOf(state, { group: groupOf.get(el)! })
        }
        return -1
      }
      const targets: { label: string; groups: number[]; leaves: number[]; x: number; y: number }[] = []
      marks.forEach((mark, index) => {
        const box = markBoxes[index]
        // Grid points inside the box, nearest to its center first.
        const points: [number, number][] = []
        for (let i = 1; i < 40; i++) for (let j = 1; j < 40; j++) points.push([box.x + (box.width * i) / 40, box.y + (box.height * j) / 40])
        const cx = box.x + box.width / 2
        const cy = box.y + box.height / 2
        points.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy))
        for (const [x, y] of points) {
          const sx = rect.x + (x - vb.x) * k
          const sy = rect.y + (y - vb.y) * k
          // Away from edges: the point and its neighbours hit the same object, whatever the rounding.
          const around = [[0, 0], [-2, 0], [2, 0], [0, -2], [0, 2]].map(([dx, dy]) => markAt(sx + dx, sy + dy))
          if (around.every((m) => m === index)) {
            targets.push({ label: mark.name, groups: mark.groups, leaves: mark.leaves, x: sx, y: sy })
            return
          }
        }
      })
      return { targets, total: marks.length, viewBox: { width: vb.width, height: vb.height } }
    })
    expect(total, 'у исходника есть разметка').toBeGreaterThan(0)
    expect(targets.map((t) => t.label).length, 'в каждый объект можно попасть кликом').toBe(total)

    for (const target of targets as Target[]) {
      await page.mouse.click(target.x, target.y)
      const result = await page.evaluate(async () => {
        const { useEditorStore, selectedParts, selectionUnits } = await import('/src/store/editor.ts')
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
          units: selectionUnits(state).length,
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
      // The click selects the whole object, nothing more, as one unit.
      expect(result.selected, `${where}: выбран весь объект`).toEqual(target.groups)
      expect(result.leaves, `${where}: детали объекта`).toEqual(target.leaves)
      expect(result.units, `${where}: одна рамка`).toBe(1)
      for (const fill of MUST_HAVE[`${source}:${label}`] ?? []) expect(result.fills, `${where}: есть ${fill}`).toContain(fill)
      for (const fill of MUST_NOT[`${source}:${label}`] ?? []) expect(result.fills, `${where}: нет ${fill}`).not.toContain(fill)
      // Never bigger than the illustration (s18/s19 are 5000 units wide, the others 144 or 600)
      // and not a whole scene.
      expect(result.width, `${where}: ширина`).toBeLessThanOrEqual(viewBox.width + 1e-6)
      expect(result.height, `${where}: высота`).toBeLessThanOrEqual(viewBox.height + 1e-6)
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
