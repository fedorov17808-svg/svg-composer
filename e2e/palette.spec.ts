import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { skipDemo } from './render'

test.beforeEach(skipDemo)

/**
 * v2, stage 2: color schemes. The scheme switch over the canvas recolors every object and the
 * canvas background, and the SVG comes out in it; main ↔ background keeps the place of the object;
 * the color variant moves only the accents. A palette of the user goes the full circle: the form
 * with a live preview, saving, a reload, the project file, deleting, a JSON file.
 */

const LILAC = { background: ['#D7CDF5', '#AA9BF0', '#7864D7', '#181817'], objects: ['#F9ECB0', '#F9A3AA', '#FFE3E1', '#FFFFFF'] }
const MINT = { background: ['#BEEBEB', '#80DADA', '#5ABEBE', '#181817'], objects: ['#FFD4F2', '#6D7BFC', '#B6C6FE', '#FFFFFF'] }
const SEA = { name: 'Морская', background: ['#E0F0FF', '#A0C8F0', '#3366CC', '#101820'], objects: ['#FFD166', '#EF476F', '#06D6A0', '#FFFFFF'] }

const rgb = (hex: string) => `rgb(${[1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)).join(', ')})`
const pageFill = (page: Page) => page.locator('.canvas-page').evaluate((el) => (el as SVGElement).style.fill)

interface Obj {
  id: string
  componentId: string
  name: string
  variant?: number
}
const objects = (page: Page) =>
  page.evaluate(async () => {
    const { useCanvasStore } = await import('/src/store/canvas.ts')
    return useCanvasStore.getState().objects as Obj[]
  })

/** Fills and strokes drawn by one canvas object, in document order. */
const objectColors = (page: Page, id: string) =>
  page.$$eval(`.canvas-svg [data-object-id="${id}"] [fill], .canvas-svg [data-object-id="${id}"] [stroke]`, (els) =>
    els.flatMap((el) => ['fill', 'stroke'].map((a) => el.getAttribute(a)).filter((c): c is string => !!c && c !== 'none')),
  ).then((colors) => colors.map((c) => (c === 'white' ? '#FFFFFF' : c.toUpperCase())))

async function place(page: Page, object: string, size: 'L' | 'S', state: 'Главный' | 'Фоновый') {
  await page.getByRole('radio', { name: `Размер ${size}` }).click()
  await page.getByRole('radiogroup', { name: 'Состояние' }).getByRole('radio', { name: state }).click()
  await page.locator(`.library-tile[data-object="${object}"] .library-preview`).click()
  return (await objects(page)).at(-1)!
}

async function exportedSvg(page: Page) {
  await page.getByRole('button', { name: 'Экспорт' }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'SVG' }).click()])
  const text = readFileSync((await download.path())!, 'utf8')
  return page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
    const colors = (root: Element) =>
      [...root.querySelectorAll('[fill], [stroke]')].flatMap((el) => ['fill', 'stroke'].map((a) => el.getAttribute(a)).filter((c): c is string => !!c && c !== 'none'))
    return {
      background: doc.querySelector('#background')?.getAttribute('fill'),
      objects: [...doc.querySelectorAll('svg > g#composition > g')].map((g) => ({ id: g.id, colors: [...new Set(colors(g))] })),
    }
  }, text)
}

const centerOf = async (page: Page, id: string) => {
  const b = (await page.locator(`.canvas-svg [data-object-id="${id}"]`).boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

test('схема перекрашивает холст и экспорт; главный/фоновый; вариант цвета; родной масштаб', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('radiogroup', { name: 'Цветовая схема' }).getByRole('radio')).toHaveText(['Сиреневая', 'Персиковая', 'Мятная'])
  expect(await pageFill(page)).toBe(rgb(LILAC.background[0]))

  const book = await place(page, 'book', 'L', 'Главный')
  const coin = await place(page, 'coin', 'L', 'Главный')
  const lamp = await place(page, 'lamp', 'L', 'Фоновый')

  // In the proportions of the sheet: the book about 5 times as wide as the coin (1446 / 287).
  const width = async (id: string) => (await page.locator(`.canvas-svg [data-object-id="${id}"]`).boundingBox())!.width
  expect((await width(book.id)) / (await width(coin.id))).toBeCloseTo(1445.9 / 286.68, 1)

  // Color variant: the accents of the book change, white and background colors stay.
  await page.locator(`.layer-list [data-layer-id="${book.id}"]`).click()
  const before = await objectColors(page, book.id)
  const variant = page.getByRole('button', { name: /^Вариант цвета/ })
  await expect(variant).toHaveText('Вариант цвета 1 из 6')
  await variant.click()
  await expect(variant).toHaveText('Вариант цвета 2 из 6')
  const after = await objectColors(page, book.id)
  expect(after).toHaveLength(before.length)
  const accents = LILAC.objects.slice(0, 3)
  for (let i = 0; i < before.length; i++) {
    if (accents.includes(before[i].toUpperCase())) expect(accents).toContain(after[i].toUpperCase())
    else expect(after[i], `цвет №${i}`).toBe(before[i])
  }
  expect(after).not.toEqual(before)

  // Main → background: the same place, the same scale; no variant button, colors of the background.
  await page.locator(`.layer-list [data-layer-id="${coin.id}"]`).click()
  const was = await centerOf(page, coin.id)
  await page.getByRole('radiogroup', { name: 'Версия объекта' }).getByRole('radio', { name: 'Фоновый' }).click()
  expect((await objects(page)).find((o) => o.id === coin.id)!.componentId).toBe('lib-L-bg-coin')
  const now = await centerOf(page, coin.id)
  expect(Math.abs(now.x - was.x) + Math.abs(now.y - was.y)).toBeLessThan(1)
  await expect(variant).toHaveCount(0)
  for (const c of await objectColors(page, coin.id)) expect(LILAC.background).toContain(c.toUpperCase())

  // Mint: every object and the background; the library previews too.
  await page.getByRole('radio', { name: 'Мятная' }).click()
  expect(await pageFill(page)).toBe(rgb(MINT.background[0]))
  const mintColors = new Set([...MINT.background, ...MINT.objects])
  for (const o of [book, coin, lamp]) for (const c of await objectColors(page, o.id)) expect(mintColors, o.name).toContain(c.toUpperCase())
  const preview = await page.locator('.library-tile[data-object="pen"] img').getAttribute('src')
  expect(decodeURIComponent(preview!)).toContain(MINT.background[0])
  await page.screenshot({ path: info.outputPath('mint.png') })

  // The file: only mint colors, background objects only mint background colors.
  const file = await exportedSvg(page)
  expect(file.background).toBe(MINT.background[0])
  expect(file.objects.map((o) => o.id)).toEqual(['книга', 'монета', 'лампа'])
  for (const o of file.objects) {
    for (const c of o.colors) expect(mintColors, o.id).toContain(c.toUpperCase())
  }
  for (const o of file.objects.filter((o) => o.id !== 'книга')) {
    for (const c of o.colors) expect(MINT.background, o.id).toContain(c.toUpperCase())
  }
  expect(file.objects[0].colors.some((c) => MINT.objects.slice(0, 3).includes(c.toUpperCase()))).toBe(true)

  // The scheme change is an undo step.
  await page.keyboard.press('ControlOrMeta+KeyZ')
  expect(await pageFill(page)).toBe(rgb(LILAC.background[0]))
  await expect(page.getByRole('radio', { name: 'Сиреневая' })).toHaveAttribute('aria-checked', 'true')
})

test('своя палитра: форма с живым превью, перезагрузка, проект, удаление, JSON', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const book = await place(page, 'book', 'L', 'Главный')
  const bg = await place(page, 'phone', 'L', 'Фоновый')
  const seaColors = new Set([...SEA.background, ...SEA.objects])

  // The form starts from the current scheme; the canvas follows the fields.
  await page.getByRole('button', { name: 'Добавить палитру' }).click()
  const form = page.getByRole('form', { name: 'Новая палитра' })
  await expect(form.getByLabel('Цвет фона 1')).toHaveValue(LILAC.background[0])
  await form.getByLabel('Название').fill(SEA.name)
  for (let i = 0; i < 4; i++) {
    await form.getByLabel(`Цвет фона ${i + 1}`).fill(SEA.background[i].toLowerCase())
    await form.getByLabel(`Цвет объектов ${i + 1}`).fill(SEA.objects[i])
  }
  expect(await pageFill(page)).toBe(rgb(SEA.background[0]))
  for (const c of await objectColors(page, book.id)) expect(seaColors).toContain(c.toUpperCase())

  // Mistakes are named; a half-typed color keeps the last preview.
  await form.getByLabel('Цвет объектов 2').fill('#EF47')
  await expect(form.getByLabel('Цвет объектов 2')).toHaveAttribute('aria-invalid', 'true')
  expect(await pageFill(page)).toBe(rgb(SEA.background[0]))
  await form.getByRole('button', { name: 'Сохранить палитру' }).click()
  await expect(form.getByRole('alert')).toHaveText('Палитра: Цвет объектов 2 — «#EF47» не hex-цвет. Нужно #RRGGBB, например #D7CDF5.')
  await form.getByLabel('Цвет объектов 2').fill(SEA.background[3])
  await form.getByRole('button', { name: 'Сохранить палитру' }).click()
  await expect(form.getByRole('alert')).toContainText('#101820 — и цвет фона, и цвет объектов')
  await form.getByLabel('Цвет объектов 2').fill(SEA.objects[1])
  await form.getByRole('button', { name: 'Сохранить палитру' }).click()
  await expect(form).toHaveCount(0)
  await expect(page.getByRole('radio', { name: SEA.name })).toHaveAttribute('aria-checked', 'true')

  // In the file: only the palette's colors, the background object only its background colors.
  const check = async () => {
    const file = await exportedSvg(page)
    expect(file.background).toBe(SEA.background[0])
    for (const c of file.objects[0].colors) expect(seaColors).toContain(c.toUpperCase())
    for (const c of file.objects[1].colors) expect(SEA.background).toContain(c.toUpperCase())
  }
  await check()

  // A reload keeps both the palette and the composition in it.
  await page.waitForTimeout(500)
  await page.reload()
  await expect(page.getByRole('radio', { name: SEA.name })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('.canvas-svg [data-object-id]')).toHaveCount(2)
  expect(await pageFill(page)).toBe(rgb(SEA.background[0]))
  await check()

  // The project file carries the palette: deleted here, it comes back with the project.
  await page.getByRole('button', { name: 'Проект' }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Сохранить проект' }).click()])
  const project = readFileSync((await download.path())!, 'utf8')
  expect(JSON.parse(project).palette).toMatchObject(SEA)
  const remove = async () => {
    await page.getByRole('button', { name: `Удалить палитру «${SEA.name}»` }).click()
    const dialog = page.getByRole('dialog', { name: 'Удалить палитру?' })
    await expect(dialog).toContainText('Композиция перейдёт на сиреневую схему.')
    await dialog.getByRole('button', { name: 'Удалить' }).click()
    await expect(page.getByRole('radio', { name: SEA.name })).toHaveCount(0)
    await expect(page.getByRole('radio', { name: 'Сиреневая' })).toHaveAttribute('aria-checked', 'true')
    expect(await pageFill(page)).toBe(rgb(LILAC.background[0]))
  }
  await remove()
  await page.getByTestId('open-project').setInputFiles({ name: 'sea.json', mimeType: 'application/json', buffer: Buffer.from(project) })
  await expect(page.getByRole('radio', { name: SEA.name })).toHaveAttribute('aria-checked', 'true')
  await check()

  // A JSON file of the same format; a broken one says why.
  await remove()
  await page.getByTestId('open-palette').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...SEA, background: SEA.background.slice(0, 3) })) })
  await expect(page.getByRole('alert')).toHaveText(/Не удалось загрузить «bad\.json»\. Палитра: в «background» нужно ровно 4 цвета/)
  await page.getByTestId('open-palette').setInputFiles({ name: 'sea.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(SEA)) })
  await expect(page.getByRole('radio', { name: SEA.name })).toHaveAttribute('aria-checked', 'true')
  await check()
  expect((await objects(page)).map((o) => o.id)).toEqual([book.id, bg.id])
})
