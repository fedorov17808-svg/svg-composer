import { expect, test, type Page } from '@playwright/test'
import { skipDemo } from './render'

/**
 * v2, stage 6: the first run shows a built composition; the local pick is instant even when the
 * server is slow; nothing overlaps from 800 px up; the 9 examples open from the menu; the help.
 */

const state = (page: Page) =>
  page.evaluate(async () => {
    const { useCanvasStore } = await import('/src/store/canvas.ts')
    const { objects, auto, size, format, objectSize, paletteId } = useCanvasStore.getState()
    return { auto, size, format, objectSize, paletteId, objects: objects.map((o) => o.componentId) }
  })

test('первый запуск: собранная демо-композиция «Финансовая грамотность», после правки не возвращается', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const field = page.getByRole('textbox', { name: 'Метафора или заголовок' })
  await expect(field).toHaveValue('Финансовая грамотность')
  await expect(page.getByLabel('Почему эти объекты')).toContainText('монета — финансы')
  const first = await state(page)
  expect(first.size).toEqual({ width: 2000, height: 1000 })
  expect(first.objects.filter((id) => id.includes('-main-')).sort()).toEqual(['lib-L-main-book', 'lib-L-main-coin', 'lib-L-main-wallet'])
  // Not an undo step: ⌘Z on the first screen does not empty it.
  await page.keyboard.press('ControlOrMeta+z')
  expect((await state(page)).objects).toEqual(first.objects)

  // Reload: the same composition from the autosave, not a new demo with other ids.
  await page.waitForTimeout(600)
  await page.reload()
  await expect(field).toHaveValue('Финансовая грамотность')
  expect((await state(page)).objects).toEqual(first.objects)

  // Emptied on purpose: stays empty after a reload.
  await page.evaluate(async () => {
    const { useCanvasStore } = await import('/src/store/canvas.ts')
    useCanvasStore.getState().compose([], { objectIds: [], background: 'few', seed: 1, size: useCanvasStore.getState().size })
  })
  await page.waitForTimeout(600)
  await page.reload()
  await expect(page.locator('.library-tile')).toHaveCount(10)
  expect((await state(page)).objects).toEqual([])
})

test('локальный подбор мгновенный, даже если сервер отвечает медленно; Claude включается ключом', async ({ page }) => {
  let posts = 0
  let enabled = false
  await skipDemo({ page })
  await page.route('**/api/metaphor', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { enabled } })
    posts++
    await new Promise((r) => setTimeout(r, 3000))
    return route.fulfill({ json: { objects: [{ id: 'lamp', reason: 'идея' }, { id: 'puzzle', reason: 'решение' }] } })
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.locator('.library-tile')).toHaveCount(10)
  const panel = page.getByRole('group', { name: 'Собрать композицию' })
  const started = Date.now()
  await panel.getByRole('textbox', { name: 'Метафора или заголовок' }).fill('Удалённая работа')
  await panel.getByRole('button', { name: 'Собрать' }).click()
  await expect(panel.getByLabel('Почему эти объекты')).toContainText('подбор: локальный', { timeout: 500 })
  expect(Date.now() - started).toBeLessThan(1500)
  expect(posts).toBe(0)

  // The same page with a key on the server: Claude answers, and the wait is shown.
  enabled = true
  await page.reload()
  await expect(page.locator('.library-tile')).toHaveCount(10)
  await page.getByRole('textbox', { name: 'Метафора или заголовок' }).fill('Идея')
  await page.getByRole('button', { name: 'Собрать' }).click()
  await expect(page.getByRole('button', { name: 'Подбираю…' })).toBeVisible()
  await expect(page.getByLabel('Почему эти объекты')).toContainText('подбор: Claude', { timeout: 6000 })
})

for (const width of [800, 900, 1024, 1100, 1440]) {
  test(`${width}px: панели и холст не налезают друг на друга`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 })
    await page.goto('/')
    await expect(page.locator('.canvas-stage svg').first()).toBeVisible()
    const wide = width >= 1024

    const check = async (message: string) => {
      const box = async (selector: string) => (await page.locator(selector).first().boundingBox())!
      const [left, middle, right] = [await box('.panel-left'), await box('.workspace'), await box('.panel-right')]
      expect(left.x + left.width, `${message}: левая панель до центра`).toBeLessThanOrEqual(middle.x + 0.5)
      expect(middle.x + middle.width, `${message}: центр до правой панели`).toBeLessThanOrEqual(right.x + 0.5)
      expect(right.x + right.width, `${message}: правая панель в окне`).toBeLessThanOrEqual(width + 0.5)
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${message}: нет горизонтальной прокрутки`).toBeLessThanOrEqual(width)
      const stage = await box('.canvas-stage')
      expect(stage.height, `${message}: холст виден`).toBeGreaterThanOrEqual(240)
      // Everything inside the center column: the canvas does not reach the side panels.
      expect(stage.x).toBeGreaterThanOrEqual(left.x + left.width - 0.5)
      expect(stage.x + stage.width).toBeLessThanOrEqual(right.x + 0.5)
    }

    await expect(page.locator('.panel-rail')).toHaveCount(wide ? 0 : 2)
    await check('по умолчанию')
    if (!wide) {
      await page.locator('.panel-right .rail-button').click()
      await check('справа раскрыта')
      await page.locator('.panel-left .rail-button').click()
      await check('обе раскрыты')
    }
    // Collapsed on purpose, wide or narrow.
    await page.getByRole('button', { name: 'Свернуть панель' }).first().click()
    await check('левая свёрнута')
  })
}

test('пример: 9 композиций в меню «Проект», открываются в своём формате, схеме и размере', async ({ page }) => {
  await skipDemo({ page })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.locator('.library-tile')).toHaveCount(10)
  await page.getByRole('button', { name: /Проект/ }).click()
  const items = page.getByRole('menuitem')
  await expect(items.filter({ hasText: /Широкий 2:1|Квадрат 1:1|Вертикальный 2:3/ })).toHaveCount(9)
  await items.filter({ hasText: 'Вертикальный 2:3 · мятная' }).first().click()
  await expect(page.getByText(/Пример «.*» открыт/)).toBeVisible()
  const opened = await state(page)
  expect(opened.format).toBe('tall')
  expect(opened.size).toEqual({ width: 1000, height: 1500 })
  expect(opened.paletteId).toBe('mint')
  expect(opened.objects.length).toBeGreaterThanOrEqual(4)
  await expect(page.getByRole('textbox', { name: 'Метафора или заголовок' })).toHaveValue('Финансовая грамотность')
})

test('справка v2: два сценария, форматы, L/S, схемы, главный/фоновый, клавиши', async ({ page }) => {
  await skipDemo({ page })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Справка' }).click()
  const dialog = page.getByRole('dialog')
  for (const text of ['Сценарий 1', 'Сценарий 2', 'Формат', 'Размер L / S', 'Цветовая схема', 'Главный / Фоновый', 'Горячие клавиши', 'Открыть пример']) {
    await expect(dialog).toContainText(text)
  }
})
