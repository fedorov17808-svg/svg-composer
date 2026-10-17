import { expect, type Browser, type Page, type TestInfo } from '@playwright/test'
import { writeFileSync } from 'node:fs'

/**
 * Pixel comparison of an extracted component with the same elements in their source: the source is
 * rendered with everything but those elements hidden, the component on its own, at the same size.
 * Safari does not draw elements whose clip-path/mask reference is broken, Chromium does — so the
 * tests run in both.
 */

const SIZE = 400
const TOLERANCE = 0.02

export interface Extracted {
  /** Mounted source `<svg>` markup, untouched. */
  source: string
  /** Child-index paths from the source root to each extracted element. */
  paths: number[][]
  bounds: { x: number; y: number; width: number; height: number }
  /** Standalone component SVG. */
  component: string
}

/** Opens a source through the app store and waits until its groups are indexed. */
export async function openSource(page: Page, source: string) {
  await page.evaluate(async (source) => {
    const { useEditorStore } = await import('/src/store/editor.ts')
    useEditorStore.getState().open(source)
    const deadline = Date.now() + 15_000
    while (useEditorStore.getState().nodes.length === 0) {
      if (Date.now() > deadline) throw new Error('source was not indexed')
      await new Promise((r) => setTimeout(r, 50))
    }
  }, source)
}

/** Extracts the current selection exactly as "Add to library" does. */
export async function extractSelection(page: Page): Promise<Extracted> {
  return page.evaluate(async () => {
    const { selectedParts, useEditorStore } = await import('/src/store/editor.ts')
    const { extract, componentSvg, unionRects } = await import('/src/lib/extract.ts')
    const parts = selectedParts(useEditorStore.getState())
    const svg = (parts.elements[0] as SVGElement).ownerSVGElement!
    const paths = parts.elements.map((el) => {
      const path: number[] = []
      for (let e: Element = el; e !== svg; e = e.parentElement!) path.unshift([...e.parentElement!.children].indexOf(e))
      return path
    })
    const b = unionRects(parts.bounds)
    return {
      source: svg.outerHTML,
      paths,
      bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
      component: componentSvg(extract({ ...parts, prefix: 'ctest-' })),
    }
  })
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
  const png = await page.screenshot({ clip: { x: 0, y: 0, ...size } })
  await page.close()
  return { png: png.toString('base64'), size }
}

/** Share of differing pixels among pixels painted in either image. */
export async function diff(browser: Browser, a: string, b: string, size: { width: number; height: number }) {
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

/** Renders source (only the extracted elements) and component, saves both, asserts they match. */
export async function expectSameRender(browser: Browser, info: TestInfo, extracted: Extracted) {
  // Hide everything off the paths; definitions stay, so clip paths and masks keep working.
  const original = await render(
    browser,
    extracted.source,
    `const { paths, bounds } = arg
     root.setAttribute('viewBox', [bounds.x, bounds.y, bounds.width, bounds.height].join(' '))
     const DEFS = ['defs', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'pattern', 'filter', 'marker', 'symbol', 'style']
     const keep = new Set()
     const whole = new Set()
     for (const path of paths) {
       let el = root
       for (const i of path) { el = el.children[i]; keep.add(el) }
       whole.add(el)
     }
     const hide = (el) => {
       for (const child of el.children) {
         if (DEFS.includes(child.tagName) || whole.has(child)) continue
         if (keep.has(child)) hide(child)
         else child.setAttribute('display', 'none')
       }
     }
     hide(root)`,
    { paths: extracted.paths, bounds: extracted.bounds },
  )
  const component = await render(browser, extracted.component, '', null)
  expect(component.size).toEqual(original.size)

  const { painted, different } = await diff(browser, original.png, component.png, original.size)
  for (const [name, image] of [['original', original], ['component', component]] as const) {
    const path = info.outputPath(`${name}.png`)
    writeFileSync(path, Buffer.from(image.png, 'base64'))
    await info.attach(name, { path, contentType: 'image/png' })
  }
  expect(painted, 'исходник с выделенными элементами не пустой').toBeGreaterThan(1000)
  expect(different / painted, `различие ${((different / painted) * 100).toFixed(2)} %`).toBeLessThan(TOLERANCE)
}

/** Starts with an empty library, as before the demo components existed. */
export const skipDemo = ({ page }: { page: Page }) =>
  page.addInitScript(() => localStorage.setItem('svg-composer-seeded', '1'))
