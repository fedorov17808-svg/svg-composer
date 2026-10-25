import { expect, test, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { skipDemo } from './render'

test.beforeEach(skipDemo)

/**
 * v2, stage 3: canvas formats and the L/S size of the composition. A format change keeps the
 * proportions of every object and its place in the frame; objects past the edge are faint on the
 * canvas, can be grabbed there and are cut by a clip path in the export; L ↔ S swaps every object
 * with its transforms, and the export holds only the paths of the chosen size; a small canvas
 * suggests S without switching; format, size and scheme survive a reload and a project file.
 */

interface Obj {
  id: string
  componentId: string
  x: number
  y: number
  scale: number
  rotation: number
  flipX: boolean
  variant?: number
}

const state = (page: Page) =>
  page.evaluate(async () => {
    const { useCanvasStore } = await import('/src/store/canvas.ts')
    const { objects, size, format, objectSize, paletteId } = useCanvasStore.getState()
    return { objects: objects as Obj[], size, format, objectSize, paletteId }
  })

/** On-screen box of each object, in the order of the composition. */
const boxes = (page: Page) =>
  page.$$eval('.canvas-svg [data-object-id]', (els) =>
    els.map((el) => {
      const b = (el as SVGGraphicsElement).getBoundingClientRect()
      return { x: b.x, y: b.y, width: b.width, height: b.height }
    }),
  )

const ratios = async (page: Page) => (await boxes(page)).map((b) => b.width / b.height)

async function exportSvg(page: Page) {
  await page.getByRole('button', { name: 'Экспорт' }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'SVG' }).click()])
  return readFileSync((await download.path())!, 'utf8')
}

/** Geometry of every shape matched by `selector`, in document order (colors follow the scheme and variant). */
const shapes = (page: Page, svg: string, selector: string) =>
  page.evaluate(
    ([svg, selector]) =>
      [...new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll(selector)].map((el) =>
        el.getAttribute('d') ?? el.localName,
      ),
    [svg, selector] as const,
  )

test('форматы, выход за край, L ↔ S, подсказка для маленького холста, сохранение', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.locator('.library-tile')).toHaveCount(10)

  const formats = page.getByRole('radiogroup', { name: 'Формат холста' })
  await expect(formats.getByRole('radio')).toHaveText(['Квадрат 1:1', 'Широкий 2:1', 'Вертикальный 2:3', 'Свой'])
  await expect(formats.getByRole('radio', { name: 'Широкий 2:1' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('canvas-size')).toHaveText('2000 × 1000')

  // Three objects, one turned and recolored, the lamp half past the right edge.
  for (const [object, stateName] of [['book', 'Главный'], ['coin', 'Фоновый'], ['lamp', 'Главный']]) {
    await page.getByRole('radiogroup', { name: 'Состояние' }).getByRole('radio', { name: stateName }).click()
    await page.locator(`.library-tile[data-object="${object}"] .library-preview`).click()
  }
  await page.evaluate(async () => {
    const { useCanvasStore } = await import('/src/store/canvas.ts')
    const canvas = useCanvasStore.getState()
    const [book, coin, lamp] = canvas.objects
    canvas.update(book.id, { x: 150, y: 250, rotation: 0, variant: 2 })
    canvas.update(coin.id, { x: 1000, y: 150, rotation: 25, flipX: true })
    canvas.update(lamp.id, { x: 1700, y: 300 })
    canvas.select(null)
  })
  const start = await state(page)
  const startRatios = await ratios(page)

  // Every format keeps the proportions of the objects (the coin is turned, its box too).
  for (const name of ['Квадрат 1:1', 'Вертикальный 2:3', 'Широкий 2:1']) {
    await formats.getByRole('radio', { name }).click()
    await expect(formats.getByRole('radio', { name })).toHaveAttribute('aria-checked', 'true')
    const now = await ratios(page)
    now.forEach((r, i) => expect(Math.abs(r / startRatios[i] - 1), `${name}, объект ${i}`).toBeLessThan(0.01))
    await page.screenshot({ path: info.outputPath(`format-${name.split(' ')[0]}.png`) })
  }
  // Back in the wide format: the same composition as at the start.
  const back = await state(page)
  back.objects.forEach((o, i) => {
    for (const key of ['x', 'y', 'scale'] as const) expect(o[key]).toBeCloseTo(start.objects[i][key], 6)
  })
  await formats.getByRole('radio', { name: 'Вертикальный 2:3' }).click()
  await expect(page.getByTestId('canvas-size')).toHaveText('1000 × 1500')

  // The lamp sticks out on the right: there it is faint, and the faint part grabs the lamp.
  const lamp = (await state(page)).objects[2]
  await expect(page.locator(`.canvas-svg [data-ghost-id="${lamp.id}"]`)).toHaveCount(1)
  expect(await page.locator('.canvas-overflow').evaluate((el) => getComputedStyle(el).opacity)).toBe('0.3')
  const pageBox = (await page.locator('.canvas-page').boundingBox())!
  const outside = await page.evaluate(
    ({ id, right }) => {
      const b = document.querySelector(`[data-ghost-id="${id}"]`)!.getBoundingClientRect()
      const hits: { x: number; y: number }[] = []
      for (let x = Math.ceil(right) + 4; x < b.right; x += 2) {
        for (let y = b.top; y < b.bottom; y += 2) {
          if (document.elementFromPoint(x, y)?.closest(`[data-ghost-id="${id}"]`)) hits.push({ x, y })
        }
      }
      // The middle one, not a pixel at the very edge of a line.
      return hits[Math.floor(hits.length / 2)] ?? null
    },
    { id: lamp.id, right: pageBox.x + pageBox.width },
  )
  expect(outside, 'у лампы есть часть за рамкой').not.toBeNull()
  await page.mouse.move(outside!.x, outside!.y)
  await page.mouse.down()
  await page.mouse.move(outside!.x - 40, outside!.y, { steps: 4 })
  await page.mouse.up()
  const grabbed = await state(page)
  expect(grabbed.objects[2].x).toBeLessThan(lamp.x)
  await page.keyboard.press('ControlOrMeta+KeyZ')
  expect((await state(page)).objects[2].x).toBeCloseTo(lamp.x, 6)

  // L → S: every object in S, transforms and boxes on screen kept.
  const lBoxes = await boxes(page)
  const lObjects = (await state(page)).objects
  await page.getByRole('radio', { name: 'Размер S' }).click()
  const s = await state(page)
  expect(s.objectSize).toBe('S')
  expect(s.objects.map((o) => o.componentId)).toEqual(['lib-S-main-book', 'lib-S-bg-coin', 'lib-S-main-lamp'])
  s.objects.forEach((o, i) => expect([o.rotation, o.flipX, o.variant]).toEqual([lObjects[i].rotation, lObjects[i].flipX, lObjects[i].variant]))
  ;(await boxes(page)).forEach((b, i) => {
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(b[key] - lBoxes[i][key]), `объект ${i}, ${key}`).toBeLessThan(1)
  })
  // The library shows S too.
  const tile = await page.locator('.library-tile[data-object="book"] img').getAttribute('src')
  expect(decodeURIComponent(tile!)).toContain((await (await page.request.get('/library/S/main/book.svg')).text()).match(/ d="([^"]{20})/)![1])

  // The export: cut by the frame, only S paths.
  const svg = await exportSvg(page)
  writeFileSync(info.outputPath('format-S.svg'), svg)
  const check = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
    const root = doc.documentElement
    const group = root.querySelector(':scope > g#composition')
    const clip = root.querySelector('defs > clipPath#canvas-clip > rect')
    return {
      viewBox: root.getAttribute('viewBox'),
      clipPath: group?.getAttribute('clip-path'),
      clip: clip && [clip.getAttribute('x'), clip.getAttribute('y'), clip.getAttribute('width'), clip.getAttribute('height')],
      outside: [...root.children].filter((el) => el.localName === 'g' && el !== group).length,
      objects: [...(group?.children ?? [])].map((g) => g.id),
    }
  }, svg)
  expect(check).toEqual({
    viewBox: '0 0 1000 1500',
    clipPath: 'url(#canvas-clip)',
    clip: [null, null, '1000', '1500'],
    outside: 0,
    objects: ['книга', 'монета', 'лампа'],
  })
  for (const [slug, file] of [['книга', 'S/main/book'], ['монета', 'S/bg/coin'], ['лампа', 'S/main/lamp']]) {
    const own = await shapes(page, await (await page.request.get(`/library/${file}.svg`)).text(), 'svg > g > *')
    expect(await shapes(page, svg, `g#${slug} > g > *`), file).toEqual(own)
  }
  // No L path anywhere in the file (the L and S drawings differ in detail).
  const exported = new Set(await shapes(page, svg, 'g#composition path'))
  for (const file of ['L/main/book', 'L/bg/coin', 'L/main/lamp']) {
    const own = await shapes(page, await (await page.request.get(`/library/${file}.svg`)).text(), 'svg > g > *')
    expect(own.filter((d) => exported.has(d)), file).toEqual([])
  }

  // A custom small canvas suggests S; nothing switches by itself.
  await page.getByRole('radio', { name: 'Размер L' }).click()
  await formats.getByRole('radio', { name: 'Свой' }).click()
  await page.getByLabel('Ширина').fill('500')
  await page.getByLabel('Ширина').press('Enter')
  await page.getByLabel('Высота').fill('400')
  await page.getByLabel('Высота').press('Enter')
  const hint = page.getByRole('status').filter({ hasText: 'Для маленьких форматов рекомендуется размер S' })
  await expect(hint).toBeVisible()
  expect((await state(page)).objectSize).toBe('L')
  await page.screenshot({ path: info.outputPath('format-small-hint.png') })
  await hint.getByRole('button', { name: 'Переключить' }).click()
  await expect(hint).toHaveCount(0)
  await expect(page.getByRole('radio', { name: 'Размер S' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('radio', { name: 'Мятная' }).click()
  const saved = await state(page)
  expect(saved).toMatchObject({ format: 'custom', size: { width: 500, height: 400 }, objectSize: 'S', paletteId: 'mint' })

  // Autosave: the same after a reload.
  await page.waitForTimeout(500)
  await page.reload()
  await expect(page.locator('.canvas-svg [data-object-id]')).toHaveCount(3)
  expect(await state(page)).toEqual(saved)
  await expect(formats.getByRole('radio', { name: 'Свой' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByLabel('Ширина')).toHaveValue('500')

  // Project file: format, size and scheme come back after other choices.
  await page.getByRole('button', { name: 'Проект' }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Сохранить проект' }).click()])
  const project = readFileSync((await download.path())!, 'utf8')
  expect(JSON.parse(project)).toMatchObject({ canvas: { width: 500, height: 400 }, canvasFormat: 'custom', objectSize: 'S', palette: { id: 'mint' } })
  await formats.getByRole('radio', { name: 'Квадрат 1:1' }).click()
  await page.getByRole('radio', { name: 'Размер L' }).click()
  await page.getByRole('radio', { name: 'Сиреневая' }).click()
  await page.getByTestId('open-project').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(project) })
  await expect(formats.getByRole('radio', { name: 'Свой' })).toHaveAttribute('aria-checked', 'true')
  expect(await state(page)).toEqual(saved)
})
