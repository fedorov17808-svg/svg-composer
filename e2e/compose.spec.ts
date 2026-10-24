import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { skipDemo } from './render'

test.beforeEach(skipDemo)

/**
 * v2, stage 4, scenario 2: names in, a composition out. Typos and synonyms are recognized, chips
 * add and fix names; «Собрать» lays the objects out (main ones whole inside the frame, background
 * ones in background colors only), «Другой вариант» changes the seed, one undo step takes it back;
 * after a format change «Перекомпоновать под формат» rebuilds with the same seed.
 */

const LILAC_BG = ['#D7CDF5', '#AA9BF0', '#7864D7', '#181817']
const MINT_BG = ['#BEEBEB', '#80DADA', '#5ABEBE', '#181817']

interface Obj {
  id: string
  componentId: string
  x: number
  y: number
  scale: number
  rotation: number
}

const state = (page: Page) =>
  page.evaluate(async () => {
    const { useCanvasStore } = await import('/src/store/canvas.ts')
    const { useLibraryStore } = await import('/src/store/library.ts')
    const { objects, size, auto } = useCanvasStore.getState()
    const components = useLibraryStore.getState().components
    return {
      size,
      auto,
      objects: (objects as Obj[]).map((o) => {
        const c = components.find((c) => c.id === o.componentId)!
        return { ...o, width: c.width * o.scale, height: c.height * o.scale }
      }),
    }
  })

const layout = (objects: { componentId: string; x: number; y: number; scale: number }[]) =>
  objects.map(({ componentId, x, y, scale }) => ({ componentId, x, y, scale }))

async function exported(page: Page) {
  await page.getByRole('button', { name: 'Экспорт' }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'SVG' }).click()])
  const text = readFileSync((await download.path())!, 'utf8')
  return page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
    return [...doc.querySelectorAll('g#composition > g')].map((g) => ({
      id: g.id,
      colors: [...new Set([...g.querySelectorAll('[fill], [stroke]')].flatMap((el) => ['fill', 'stroke'].map((a) => el.getAttribute(a)).filter((c): c is string => !!c && c !== 'none')))].map((c) => (c === 'white' ? '#FFFFFF' : c.toUpperCase())),
    }))
  }, text)
}

test('собрать по названиям: опечатки, чипы, варианты, undo, перекомпоновка, цвета фоновых', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.locator('.library-tile')).toHaveCount(10)
  const panel = page.getByRole('group', { name: 'Собрать композицию' })
  const input = panel.getByRole('textbox')
  const build = panel.getByRole('button', { name: 'Собрать' })
  const another = panel.getByRole('button', { name: 'Другой вариант' })
  await expect(build).toBeDisabled()
  await expect(another).toBeDisabled()

  // Synonyms, case, a typo; an unknown name with a hint that fixes it.
  await input.fill('Гарнитура, лмапа, кружка')
  const chips = panel.getByLabel('Объекты композиции')
  await expect(chips.locator('.chip-main')).toHaveText([/^Наушники ← Гарнитура/, /^Лампа ← лмапа/])
  await expect(chips.getByRole('alert')).toContainText('«кружка» — нет в библиотеке')
  await chips.getByRole('button', { name: 'Книга?' }).click()
  await expect(input).toHaveValue('Гарнитура, лмапа, Книга')
  await expect(chips.getByRole('alert')).toHaveCount(0)
  // A chip adds an object; the fourth goes to the background.
  await chips.locator('.chip-add[data-object="pen"]').click()
  await expect(input).toHaveValue('Гарнитура, лмапа, Книга, ручка')
  await expect(chips.locator('.chip-bg')).toHaveText([/^Ручка/])

  await panel.getByRole('radio', { name: 'немного' }).click()
  await build.click()
  const first = await state(page)
  expect(first.auto).toMatchObject({ objectIds: ['headphones', 'lamp', 'book', 'pen'], background: 'few', seed: 1, size: { width: 2000, height: 1000 } })
  const mains = first.objects.filter((o) => o.componentId.includes('-main-'))
  const bgs = first.objects.filter((o) => o.componentId.includes('-bg-'))
  expect(mains.map((o) => o.componentId).sort()).toEqual(['lib-L-main-book', 'lib-L-main-headphones', 'lib-L-main-lamp'])
  expect(bgs.map((o) => o.componentId)).toContain('lib-L-bg-pen')
  expect(bgs).toHaveLength(2)
  // Background under the main objects; the main ones whole inside, unrotated.
  expect(first.objects.slice(0, 2).every((o) => o.componentId.includes('-bg-'))).toBe(true)
  for (const o of mains) {
    expect(o.rotation).toBe(0)
    expect(o.x).toBeGreaterThanOrEqual(0)
    expect(o.y).toBeGreaterThanOrEqual(0)
    expect(o.x + o.width).toBeLessThanOrEqual(2000)
    expect(o.y + o.height).toBeLessThanOrEqual(1000)
  }
  await page.screenshot({ path: info.outputPath('compose-wide-1.png') })

  // Everything stays editable, as ordinary objects.
  await page.locator(`.canvas-svg [data-object-id="${mains[0].id}"]`).click()
  await expect(page.locator('.frame-box').first()).toBeVisible()

  // Another variant, then one undo step back to the first, one more to the empty canvas.
  await another.click()
  const second = await state(page)
  expect(second.auto?.seed).toBe(2)
  expect(layout(second.objects)).not.toEqual(layout(first.objects))
  await page.screenshot({ path: info.outputPath('compose-wide-2.png') })
  await page.keyboard.press('ControlOrMeta+KeyZ')
  expect(layout((await state(page)).objects)).toEqual(layout(first.objects))
  await page.keyboard.press('ControlOrMeta+KeyZ')
  expect((await state(page)).objects).toEqual([])
  // The same seed gives the same layout.
  await build.click()
  expect(layout((await state(page)).objects)).toEqual(layout(first.objects))

  // Format change: an offer to rebuild with the same seed.
  const recompose = panel.getByRole('button', { name: 'Перекомпоновать под формат' })
  await expect(recompose).toHaveCount(0)
  await page.getByRole('radiogroup', { name: 'Формат холста' }).getByRole('radio', { name: 'Вертикальный 2:3' }).click()
  await expect(recompose).toBeVisible()
  await recompose.click()
  await expect(recompose).toHaveCount(0)
  const tall = await state(page)
  expect(tall.auto).toMatchObject({ seed: 1, size: { width: 1000, height: 1500 } })
  for (const o of tall.objects.filter((o) => o.componentId.includes('-main-'))) {
    expect(o.x + o.width).toBeLessThanOrEqual(1000)
    expect(o.y + o.height).toBeLessThanOrEqual(1500)
  }
  await page.screenshot({ path: info.outputPath('compose-tall.png') })

  // Background objects only in background colors, in any scheme.
  for (const [scheme, colors] of [['Сиреневая', LILAC_BG], ['Мятная', MINT_BG]] as const) {
    await page.getByRole('radio', { name: scheme }).click()
    const file = await exported(page)
    expect(file).toHaveLength(tall.objects.length)
    tall.objects.forEach((o, i) => {
      if (o.componentId.includes('-bg-')) for (const c of file[i].colors) expect(colors, `${scheme}: ${file[i].id}`).toContain(c)
    })
  }

  // L/S: the composition built in S looks the same.
  await page.getByRole('radio', { name: 'Размер S' }).click()
  await build.click()
  const small = await state(page)
  expect(small.objects.every((o) => o.componentId.startsWith('lib-S-'))).toBe(true)
  small.objects.forEach((o, i) => expect(Math.abs(o.width - tall.objects[i].width)).toBeLessThan(0.5))

  // Survives a reload: «Другой вариант» goes on from the saved seed.
  await page.waitForTimeout(500)
  await page.reload()
  await expect(page.locator('.canvas-svg [data-object-id]')).toHaveCount(small.objects.length)
  await expect(input).toHaveValue('наушники, лампа, книга, ручка')
  await another.click()
  expect((await state(page)).auto?.seed).toBe(2)
})
