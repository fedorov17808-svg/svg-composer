import { expect, test } from '@playwright/test'
import { openSource } from './render'

/**
 * Logical objects on all 20 sources: a real click in the middle of every large object selects the
 * whole object; a gopher never comes out as a bare body (body fill without eyes); nothing selected
 * is bigger than the illustration. Prints a table of what a click on each character selects.
 */

const SOURCES = Array.from({ length: 20 }, (_, i) => `s${String(i + 1).padStart(2, '0')}`)
/** Objects at least this share of the drawing's area are checked. */
const LARGE_SHARE = 0.05
/** Gopher body fills: cyan and pink gophers. */
const GOPHER_BODY = ['#61e0ee', '#e98fca']
/** Gophers without visible eyes in the source too: s05 is drawn from behind, s15 wears a VR headset. */
const NO_FACE = new Set(['s05:#10', 's15:#13'])

interface Target {
  main: number
  members: number[]
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
  test(`${source}: клик по каждому крупному объекту выбирает его целиком`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await openSource(page, source)

    // Click-level objects (what a click on their own groups selects) and a point that hits them.
    const { targets, viewBox } = await page.evaluate(async (LARGE_SHARE) => {
      const { useEditorStore, clickedObject } = await import('/src/store/editor.ts')
      const { objectMembers } = await import('/src/lib/objects.ts')
      const { unionRects } = await import('/src/lib/extract.ts')
      const { nodes, owners, elements } = useEditorStore.getState()
      const svg = elements[0].ownerSVGElement!
      const vb = svg.viewBox.baseVal
      const rect = svg.getBoundingClientRect()
      const k = rect.width / vb.width
      const top = nodes.filter((n) => n.parent < 0 && n.width > 0 && n.height > 0)
      const scene = unionRects(top)
      const groupOf = new Map(elements.map((el, i) => [el as Element, i]))
      const hitGroup = (x: number, y: number) => {
        for (let el = document.elementFromPoint(x, y); el && el !== svg; el = el.parentElement) {
          const i = groupOf.get(el)
          if (i !== undefined) return i
        }
        return null
      }
      const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i])
      const targets: { main: number; members: number[]; x: number; y: number }[] = []
      for (const main of new Set(owners)) {
        const members = objectMembers(owners, main)
        if (!same(clickedObject(nodes, owners, main), members)) continue
        const box = unionRects(members.map((m) => nodes[m]))
        if (box.width * box.height < scene.width * scene.height * LARGE_SHARE) continue
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
          const around = [[0, 0], [-3, 0], [3, 0], [0, -3], [0, 3]].map(([dx, dy]) => hitGroup(sx + dx, sy + dy))
          if (around.every((hit) => hit !== null && same(clickedObject(nodes, owners, hit), members))) {
            targets.push({ main, members, x: sx, y: sy })
            break
          }
        }
      }
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
          leaves: state.selectedLeaves.length,
          width: component.width,
          height: component.height,
          bounds: { width: bounds.width, height: bounds.height },
          fills,
          white: painted ? white / painted : 0,
          dark: painted ? dark / painted : 0,
        }
      })
      await page.keyboard.press('Escape')

      const label = `#${target.main + 1}`
      const character = result.fills.some((f) => GOPHER_BODY.includes(f))
      const where = `${source} ${label}`
      // The click selects the whole object, nothing more.
      expect(result.selected, `${where}: выбран весь объект`).toEqual(target.members)
      expect(result.leaves).toBe(0)
      // Never bigger than the illustration (s18/s19 are 5000 units wide, the others 144 or 600).
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
        groups: target.members.length,
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
