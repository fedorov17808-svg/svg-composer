import { expect, test, type Page } from '@playwright/test'
import { expectSameRender, extractSelection, openSource } from './render'

/**
 * Marquee selection in sources whose objects are not grouped: the rect is dragged with the real
 * mouse, the result is extracted and compared with the source pixel by pixel.
 */

interface Case {
  source: string
  what: string
  /** Marquee in source viewBox units. */
  rect: { x: number; y: number; width: number; height: number }
  /** Start the drag with Alt held (otherwise the press must land on empty space). */
  alt: boolean
  /** Fills that must be in the component, and fills of neighbours that must not. */
  has: string[]
  hasNot: string[]
}

const CASES: Case[] = [
  {
    source: 's02',
    what: 'левый гофер без забора и верёвки',
    rect: { x: 15.5, y: 52, width: 48, height: 68 },
    alt: false,
    has: ['#61e0ee', '#b7f8ff', '#d6c295'],
    hasNot: ['#5c5c5c', '#be2800', '#a52828'],
  },
  {
    // The gopher stands in front of the calendar; most of its details are inside the rect.
    source: 's04',
    what: 'календарь без гофера',
    rect: { x: 8, y: 55, width: 590, height: 482 },
    alt: true,
    has: ['#d5d5d5'],
    hasNot: ['#61e0ee', '#4fcbe0', '#b7f8ff', '#d6c295'],
  },
]

/** Source viewBox point → page point. */
async function toPage(page: Page, x: number, y: number) {
  return page.evaluate(
    ([x, y]) => {
      const svg = document.querySelector('.source-host svg') as SVGSVGElement
      const vb = svg.viewBox.baseVal
      const r = svg.getBoundingClientRect()
      return { x: r.left + ((x - vb.x) / vb.width) * r.width, y: r.top + ((y - vb.y) / vb.height) * r.height }
    },
    [x, y],
  )
}

for (const c of CASES) {
  test(`${c.source}: рамка — ${c.what}`, async ({ page, browser }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await openSource(page, c.source)

    const a = await toPage(page, c.rect.x, c.rect.y)
    const b = await toPage(page, c.rect.x + c.rect.width, c.rect.y + c.rect.height)
    if (!c.alt) {
      const empty = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [a.x, a.y])
      expect(empty, 'рамка начинается на пустом месте').toBe('svg')
    }
    if (c.alt) await page.keyboard.down('Alt')
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 })
    await expect(page.locator('.overlay-marquee'), 'рамка видна во время перетаскивания').toHaveCount(1)
    await page.mouse.move(b.x, b.y, { steps: 4 })
    await page.mouse.up()
    if (c.alt) await page.keyboard.up('Alt')
    await expect(page.locator('.overlay-marquee')).toHaveCount(0)
    await expect(page.locator('.extract-preview img'), 'превью того, что будет сохранено').toHaveCount(1)

    const extracted = await extractSelection(page)
    const fills = new Set([...extracted.component.matchAll(/fill="(#[0-9a-f]+)"/gi)].map((m) => m[1].toLowerCase()))
    for (const fill of c.has) expect(fills.has(fill), `есть ${fill}`).toBe(true)
    for (const fill of c.hasNot) expect(fills.has(fill), `нет ${fill}`).toBe(false)
    await expectSameRender(browser, info, extracted)
  })
}

test('s02: Alt+Shift+клик убирает деталь, Shift+рамка добавляет', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await openSource(page, 's02')
  const count = () =>
    page.evaluate(async () => {
      const { selectedParts, useEditorStore } = await import('/src/store/editor.ts')
      return selectedParts(useEditorStore.getState()).elements.length
    })
  const drag = async (r: Case['rect'], modifiers: string[]) => {
    const a = await toPage(page, r.x, r.y)
    const b = await toPage(page, r.x + r.width, r.y + r.height)
    for (const m of modifiers) await page.keyboard.down(m)
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move(b.x, b.y, { steps: 6 })
    await page.mouse.up()
    for (const m of modifiers) await page.keyboard.up(m)
  }

  await drag({ x: 15.5, y: 52, width: 48, height: 68 }, [])
  const gopher = await count()
  expect(gopher).toBeGreaterThan(2)

  // Left eye white: a loose detail in the scene group.
  const eye = await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/store/editor.ts')
    const { leafElements, selectedLeaves, selection, elements } = useEditorStore.getState()
    const pieces = [...selectedLeaves.map((l) => leafElements[l]), ...selection.map((i) => elements[i.node])]
    for (const el of pieces) {
      const r = el.getBoundingClientRect()
      const [x, y] = [r.x + r.width / 2, r.y + r.height / 2]
      const top = document.elementFromPoint(x, y)
      if (top && (el === top || el.contains(top)) && r.width > 6 && r.height > 6) return { x, y }
    }
    return null
  })
  expect(eye).not.toBeNull()
  await page.keyboard.down('Alt')
  await page.keyboard.down('Shift')
  await page.mouse.click(eye!.x, eye!.y)
  await page.keyboard.up('Shift')
  await page.keyboard.up('Alt')
  const afterRemove = await count()
  expect(afterRemove, 'деталь убрана').not.toBe(gopher)

  // Shift+marquee over the right gopher keeps the left one.
  await drag({ x: 79, y: 53, width: 42, height: 66 }, ['Shift'])
  expect(await count(), 'добавлено к выделению').toBeGreaterThan(afterRemove)
})
