import { expect, test, type Page } from '@playwright/test'

/**
 * Stage 8: the header fits from 1024px, the first start fills the library with demo components,
 * examples open from the project menu, reset to demo asks first, help, empty states.
 */

const SEED_COUNT = 12

/** Header on one line: every control inside the window, nothing wrapped. */
async function expectCompactHeader(page: Page) {
  const header = page.locator('.app-header')
  const box = (await header.boundingBox())!
  expect(box.height).toBeLessThanOrEqual(50)
  const width = page.viewportSize()!.width
  for (const el of await header.locator('h1, button').all()) {
    const b = (await el.boundingBox())!
    expect(b.x + b.width, await el.innerText()).toBeLessThanOrEqual(width)
    expect(b.height, await el.innerText()).toBeLessThanOrEqual(30)
  }
}

for (const width of [1024, 1440]) {
  test(`${width}px: шапка, демо, примеры, справка, сброс`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    await expectCompactHeader(page)
    await page.screenshot({ path: info.outputPath(`start-${width}.png`) })

    // First start: the demo components, from several sources.
    await page.getByRole('tab', { name: 'Библиотека' }).click()
    await expect(page.locator('.library-tile')).toHaveCount(SEED_COUNT)
    await expect(page.locator('.library-name').first()).toHaveText('Голубой гофер')
    await expect(page.getByText('Перетащите компоненты из библиотеки')).toBeVisible()
    await expect(page.getByText('Ничего не выделено. Щёлкните по объекту на холсте.')).toBeVisible()
    await page.screenshot({ path: info.outputPath(`library-${width}.png`) })

    // Help: steps and shortcuts; Esc closes it.
    await page.getByRole('button', { name: 'Справка' }).click()
    const help = page.getByRole('dialog', { name: 'Как собрать композицию' })
    await expect(help).toBeVisible()
    await expect(help.locator('.help-steps li')).toHaveCount(3)
    await page.screenshot({ path: info.outputPath(`help-${width}.png`) })
    await page.keyboard.press('Escape')
    await expect(help).toBeHidden()

    // Each example opens with its objects and adds no duplicate components.
    for (const [title, count] of [['Гоферы на празднике', 6], ['Гоферы за работой', 4], ['Восточный сад', 6]] as const) {
      await page.getByRole('button', { name: 'Проект' }).click()
      await page.getByRole('menuitem', { name: title }).click()
      await expect(page.getByRole('status')).toHaveText(`Пример «${title}» открыт`)
      await expect(page.locator('.canvas-svg [data-object-id]')).toHaveCount(count)
      await page.screenshot({ path: info.outputPath(`example-${title}-${width}.png`) })
    }
    await expect(page.locator('.library-tile')).toHaveCount(SEED_COUNT)

    // Export menu: SVG of the open example.
    await page.getByRole('button', { name: 'Экспорт' }).click()
    await expect(page.getByRole('menu')).toBeVisible()
    await page.screenshot({ path: info.outputPath(`export-menu-${width}.png`) })
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'SVG' }).click()])
    expect(download.suggestedFilename()).toMatch(/\.svg$/)

    // Reset to demo: a removed component comes back, but only after confirmation.
    await page.locator('.library-tile').first().getByRole('button', { name: 'Удалить' }).click()
    await expect(page.locator('.library-tile')).toHaveCount(SEED_COUNT - 1)
    await page.getByRole('button', { name: 'Проект' }).click()
    await page.getByRole('menuitem', { name: 'Сбросить к демо…' }).click()
    const confirm = page.getByRole('dialog', { name: 'Сбросить библиотеку?' })
    await page.screenshot({ path: info.outputPath(`reset-${width}.png`) })
    await confirm.getByRole('button', { name: 'Отмена' }).click()
    await expect(page.locator('.library-tile')).toHaveCount(SEED_COUNT - 1)
    await page.getByRole('button', { name: 'Проект' }).click()
    await page.getByRole('menuitem', { name: 'Сбросить к демо…' }).click()
    await confirm.getByRole('button', { name: 'Сбросить' }).click()
    await expect(page.locator('.library-tile')).toHaveCount(SEED_COUNT)

    // A library emptied on purpose stays empty after a reload and shows the hint.
    for (let left = SEED_COUNT; left > 0; left--) {
      await page.locator('.library-tile').first().getByRole('button', { name: 'Удалить' }).click()
      await expect(page.locator('.library-tile')).toHaveCount(left - 1)
    }
    await page.reload()
    await page.getByRole('tab', { name: 'Библиотека' }).click()
    await expect(page.getByText('Библиотека пуста. Откройте исходник и кликните по элементу.')).toBeVisible()

    // Default component name: short, with the source number.
    await page.getByRole('tab', { name: 'Исходники' }).click()
    await page.evaluate(async () => {
      const { useEditorStore } = await import('/src/store/editor.ts')
      const { useUiStore } = await import('/src/store/ui.ts')
      useUiStore.getState().setWorkspaceMode('source')
      useEditorStore.getState().open('s12')
      while (useEditorStore.getState().nodes.length === 0) await new Promise((r) => setTimeout(r, 50))
      useEditorStore.getState().select(39, false)
    })
    await expect(page.getByLabel('Название')).toHaveAttribute('placeholder', 'Фонарь на палке')
    await expectCompactHeader(page)
    await page.screenshot({ path: info.outputPath(`source-${width}.png`) })
  })
}
