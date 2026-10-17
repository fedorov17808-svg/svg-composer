import { expect, test, type Browser } from '@playwright/test'
import { writeFileSync } from 'node:fs'

/**
 * Pixel comparison of an extracted component with the same group in its source: the source is
 * rendered with everything but the group hidden, the component on its own, at the same size.
 * Safari does not draw elements whose clip-path/mask reference is broken, Chromium does — so the
 * test runs in both.
 */

interface Case {
  source: string
  /** Group under the click, numbered as in the "Выделение" panel ("группа №N" = index + 1). */
  click: number
  /** Group the click must select, if it is part of the check. */
  selects?: number
  what: string
}

const CASES: Case[] = [
  // Body fill + outline is a layer; eyes, mouth and paws are its siblings in the gopher group №1.
  { source: 's13', click: 9, selects: 1, what: 'гофер с пандой' },
  { source: 's12', click: 10, selects: 1, what: 'гофер с фонарём' },
  { source: 's12', click: 40, what: 'фонарь' },
  { source: 's01', click: 5, what: 'гофер справа' },
  { source: 's16', click: 2, what: 'гофер в видеозвонке' },
]

const SIZE = 400
const TOLERANCE = 0.02

interface Extracted {
  /** Selected group, numbered as in the panel. */
  selected: number
  /** Mounted source `<svg>` markup, untouched. */
  source: string
  /** Child-index path from the source root to the selected group. */
  path: number[]
  bounds: { x: number; y: number; width: number; height: number }
  component: string
}

async function render(browser: Browser, svg: string, prepare: string, arg: unknown) {
  const page = await browser.newPage()
  await page.setContent(`<!doctype html><body style="margin:0;background:#fff">${svg}</body>`)
  const size = await page.evaluate(
    ([prepare, arg, SIZE]) => {
      const root = document.querySelector('svg')!
      new Function('root', 'arg', prepare)(root, arg)
      const vb = root.viewBox.baseVal
      const k = (SIZE as number) / Math.max(vb.width, vb.height)
      const size = { width: Math.round(vb.width * k), height: Math.round(vb.height * k) }
      root.setAttribute('width', String(size.width))
      root.setAttribute('height', String(size.height))
      root.style.display = 'block'
      return size
    },
    [prepare, arg, SIZE] as const,
  )
  // The source root is visibility="hidden", which Playwright treats as not screenshot-able.
  const png = await page.screenshot({ clip: { x: 0, y: 0, ...size } })
  await page.close()
  return { png: png.toString('base64'), size }
}

/** Share of differing pixels among pixels painted in either image. */
async function diff(browser: Browser, a: string, b: string, size: { width: number; height: number }) {
  const page = await browser.newPage()
  const result = await page.evaluate(
    async ({ a, b, size }) => {
      const load = (b64: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = reject
          img.src = 'data:image/png;base64,' + b64
        })
      const pixels = async (b64: string) => {
        const canvas = document.createElement('canvas')
        canvas.width = size.width
        canvas.height = size.height
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, size.width, size.height)
        ctx.drawImage(await load(b64), 0, 0, size.width, size.height)
        return ctx.getImageData(0, 0, size.width, size.height).data
      }
      const [pa, pb] = await Promise.all([pixels(a), pixels(b)])
      let painted = 0
      let different = 0
      for (let i = 0; i < pa.length; i += 4) {
        const white = (p: Uint8ClampedArray) => p[i] > 245 && p[i + 1] > 245 && p[i + 2] > 245
        if (white(pa) && white(pb)) continue
        painted++
        const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]))
        if (d > 40) different++
      }
      return { painted, different }
    },
    { a, b, size },
  )
  await page.close()
  return result
}

for (const c of CASES) {
  test(`${c.source}: клик по группе №${c.click} (${c.what}) — компонент совпадает с исходником`, async ({ page, browser }, info) => {
    await page.goto('/')
    const extracted: Extracted = await page.evaluate(
      async ({ source, click }) => {
        const { useEditorStore } = await import('/src/store/editor.ts')
        const { extract, componentSvg } = await import('/src/lib/extract.ts')
        useEditorStore.getState().open(source)
        const deadline = Date.now() + 15_000
        while (useEditorStore.getState().nodes.length === 0) {
          if (Date.now() > deadline) throw new Error('source was not indexed')
          await new Promise((r) => setTimeout(r, 50))
        }
        // The same call the click handler makes.
        useEditorStore.getState().select(click - 1, false)
        const { nodes, elements, selection } = useEditorStore.getState()
        const selected = selection[0].node
        const el = elements[selected]
        const node = nodes[selected]
        const svg = el.ownerSVGElement!
        const path: number[] = []
        for (let e: Element = el; e !== svg; e = e.parentElement!) path.unshift([...e.parentElement!.children].indexOf(e))
        const result = extract({ elements: [el], bounds: [node], prefix: 'ctest-' })
        return {
          selected: selected + 1,
          source: svg.outerHTML,
          path,
          bounds: { x: node.x, y: node.y, width: node.width, height: node.height },
          component: componentSvg(result),
        }
      },
      { source: c.source, click: c.click },
    )

    if (c.selects) expect(extracted.selected, 'выбрана группа').toBe(c.selects)

    // Hide everything but the group; definitions stay, so clip paths and masks keep working.
    const original = await render(
      browser,
      extracted.source,
      `const { path, bounds } = arg
       root.setAttribute('viewBox', [bounds.x, bounds.y, bounds.width, bounds.height].join(' '))
       const DEFS = ['defs', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'pattern', 'filter', 'marker', 'symbol', 'style']
       let el = root
       for (const i of path) {
         for (const sibling of el.children) if (sibling !== el.children[i] && !DEFS.includes(sibling.tagName)) sibling.setAttribute('display', 'none')
         el = el.children[i]
       }`,
      { path: extracted.path, bounds: extracted.bounds },
    )
    const component = await render(browser, extracted.component, '', null)
    expect(component.size).toEqual(original.size)

    const { painted, different } = await diff(browser, original.png, component.png, original.size)
    for (const [name, image] of [['original', original], ['component', component]] as const) {
      const path = info.outputPath(`${name}.png`)
      writeFileSync(path, Buffer.from(image.png, 'base64'))
      await info.attach(name, { path, contentType: 'image/png' })
    }
    expect(painted, 'исходник с выделенным элементом не пустой').toBeGreaterThan(1000)
    expect(different / painted, `различие ${((different / painted) * 100).toFixed(2)} %`).toBeLessThan(TOLERANCE)
  })
}
