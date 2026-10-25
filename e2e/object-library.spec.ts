import { expect, test, type Page } from '@playwright/test'
import { skipDemo } from './render'

test.beforeEach(skipDemo)

/**
 * v2, stage 1: the object library replaces the gopher sources. One tab, ten objects in the order of
 * the Figma sheet, the size and state switches pick the version, a click puts it in the middle of
 * the canvas, a drag where it is dropped. The header still fits from 1024px; help and the project
 * menu no longer mention sources, the demo or the gopher examples.
 */

const NAMES = ['Книга', 'Телефон', 'Пазл', 'Монета', 'Наушники', 'Лампа', 'Цветы в вазе', 'Кошелёк', 'Папка', 'Ручка']

const objects = (page: Page) =>
  page.evaluate(async () => {
    const { useCanvasStore } = await import('/src/store/canvas.ts')
    return useCanvasStore.getState().objects.map((o) => ({ id: o.id, componentId: o.componentId, name: o.name }))
  })

for (const width of [1024, 1440]) {
  test(`${width}px: библиотека объектов, версии, клик и перетаскивание`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')

    // Only the object library; no gopher tabs and no source mode.
    await expect(page.getByRole('tab')).toHaveText(['Библиотека объектов'])
    await expect(page.getByRole('tab', { name: 'Исходник' })).toHaveCount(0)
    const tiles = page.locator('.library-tile')
    await expect(tiles).toHaveCount(10)
    await expect(page.locator('.library-tile .library-name')).toHaveText(NAMES)
    await expect(page.getByRole('radio', { name: 'Размер L' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('radiogroup', { name: 'Состояние' }).getByRole('radio', { name: 'Главный' })).toHaveAttribute('aria-checked', 'true')

    // Header on one line, every control inside the window.
    const header = (await page.locator('.app-header').boundingBox())!
    expect(header.height).toBeLessThanOrEqual(50)
    for (const el of await page.locator('.app-header').locator('h1, button').all()) {
      const b = (await el.boundingBox())!
      expect(b.x + b.width, await el.innerText()).toBeLessThanOrEqual(width)
    }

    // Every preview of every version draws something.
    for (const size of ['L', 'S']) {
      for (const state of ['Главный', 'Фоновый']) {
        await page.getByRole('radio', { name: `Размер ${size}` }).click()
        await page.getByRole('radiogroup', { name: 'Состояние' }).getByRole('radio', { name: state }).click()
        const drawn = await page.$$eval('.library-tile img', (imgs) =>
          Promise.all((imgs as HTMLImageElement[]).map((img) => img.decode().then(() => img.naturalWidth > 0 && img.naturalHeight > 0))),
        )
        expect(drawn, `${size} · ${state}`).toEqual(Array(10).fill(true))
        await page.screenshot({ path: info.outputPath(`library-${size}-${state}.png`) })
      }
    }

    // A click adds the chosen version; the switches decide which one.
    const book = page.locator('.library-tile[data-object="book"] .library-preview')
    for (const [size, state, id] of [
      ['L', 'Главный', 'lib-L-main-book'],
      ['L', 'Фоновый', 'lib-L-bg-book'],
      ['S', 'Главный', 'lib-S-main-book'],
      ['S', 'Фоновый', 'lib-S-bg-book'],
    ]) {
      await page.getByRole('radio', { name: `Размер ${size}` }).click()
      await page.getByRole('radiogroup', { name: 'Состояние' }).getByRole('radio', { name: state }).click()
      await book.click()
      expect((await objects(page)).at(-1)).toMatchObject({ componentId: id, name: 'Книга' })
    }
    await expect(page.locator('.canvas-svg [data-object-id]')).toHaveCount(4)

    // A drag drops the object where the pointer is.
    const stage = (await page.locator('.canvas-page').boundingBox())!
    const target = { x: Math.round(stage.x + stage.width * 0.25), y: Math.round(stage.y + stage.height * 0.7) }
    await page.locator('.library-tile[data-object="pen"]').dragTo(page.locator('.canvas-stage'), {
      targetPosition: await page.locator('.canvas-stage').evaluate((el, t) => {
        const r = el.getBoundingClientRect()
        return { x: t.x - r.x, y: t.y - r.y }
      }, target),
    })
    const placed = await objects(page)
    expect(placed).toHaveLength(5)
    expect(placed.at(-1)).toMatchObject({ componentId: 'lib-S-bg-pen', name: 'Ручка' })
    const pen = (await page.locator(`.canvas-svg [data-object-id="${placed.at(-1)!.id}"]`).boundingBox())!
    expect(Math.abs(pen.x + pen.width / 2 - target.x)).toBeLessThan(3)
    expect(Math.abs(pen.y + pen.height / 2 - target.y)).toBeLessThan(3)
    await page.screenshot({ path: info.outputPath(`canvas-${width}.png`) })

    // Help without sources; the project menu without the gopher examples and the demo reset.
    await page.getByRole('button', { name: 'Справка' }).click()
    const help = page.getByRole('dialog', { name: 'Как собрать композицию' })
    await expect(help).toContainText('Библиотека объектов')
    await expect(help).not.toContainText('Исходники')
    await page.keyboard.press('Escape')
    await expect(help).toHaveCount(0)
    await page.getByRole('button', { name: 'Проект' }).click()
    // Project file first, then the 9 examples; no gopher examples and no demo reset.
    const items = page.getByRole('menuitem')
    await expect(items).toHaveCount(11)
    await expect(items.first()).toHaveText('Открыть проект…')
    await expect(items.nth(1)).toHaveText('Сохранить проект')
    await expect(items).not.toContainText(['Сбросить к демо…', 'Гоферы на празднике'])
  })
}
