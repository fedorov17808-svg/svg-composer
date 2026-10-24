import { expect, test, type Page } from '@playwright/test'
import { skipDemo } from './render'

test.beforeEach(skipDemo)

/**
 * Stage 6: editing the composition with the real mouse and keyboard — duplicate, delete, flip,
 * layer order, the layers panel, and undo/redo over all of it.
 */

const MOD = 'ControlOrMeta'

/** Two components: a red card with a blue dot on its left edge (shows flips) and a green one. */
const COMPONENTS = [
  {
    id: 'ctest-a',
    name: 'Красная карточка',
    markup: '<g><rect width="100" height="60" fill="#dd3333"/><circle data-marker="1" cx="12" cy="30" r="8" fill="#2222ff"/></g>',
  },
  { id: 'ctest-b', name: 'Зелёная карточка', markup: '<g><rect width="100" height="60" fill="#33aa33"/></g>' },
]

interface Obj {
  id: string
  name: string
  x: number
  y: number
  rotation: number
  flipX: boolean
  hidden?: boolean
  locked?: boolean
}

const state = (page: Page) =>
  page.evaluate(async () => {
    const { useCanvasStore } = await import('/src/store/canvas.ts')
    const { objects, selectedId, history } = useCanvasStore.getState()
    return { objects: objects as Obj[], selectedId, past: history.past.length, future: history.future.length }
  })

const domOrder = (page: Page) =>
  page.$$eval('.canvas-svg [data-object-id]', (els) => els.map((el) => el.getAttribute('data-object-id')))

const panelOrder = (page: Page) =>
  page.$$eval('.layer-list [data-layer-id]', (els) => els.map((el) => el.getAttribute('data-layer-id')))

async function center(page: Page, selector: string) {
  const box = (await page.locator(selector).boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

const objectCenter = (page: Page, id: string) => center(page, `.canvas-svg [data-object-id="${id}"] rect`)

test('холст: дублирование, удаление, отражение, слои, undo/redo', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.evaluate(async (components) => {
    const { useLibraryStore } = await import('/src/store/library.ts')
    for (const c of components) {
      await useLibraryStore.getState().add({ ...c, sourceId: 's01', defs: '', width: 100, height: 60, createdAt: Date.now() })
    }
  }, COMPONENTS)

  const tool = (label: string) =>
    page.getByRole('toolbar', { name: 'Правка холста' }).getByRole('button', { name: label, exact: true })

  // Placed as a library tile does (the gopher tab «Библиотека» is off in v2; tiles of the object
  // library are covered by object-library.spec.ts).
  await page.evaluate(async (ids) => {
    const { useLibraryStore } = await import('/src/store/library.ts')
    const { useCanvasStore } = await import('/src/store/canvas.ts')
    for (const id of ids) useCanvasStore.getState().add(useLibraryStore.getState().components.find((c) => c.id === id)!)
  }, COMPONENTS.map((c) => c.id))
  let s = await state(page)
  expect(s.objects.map((o) => o.name)).toEqual(['Красная карточка', 'Зелёная карточка'])
  const [a, b] = s.objects
  expect(s.selectedId).toBe(b.id)

  // Hotkeys are in the tooltips.
  for (const label of ['Отменить', 'Повторить', 'Дублировать', 'Удалить', 'Отразить по горизонтали', 'На передний план', 'На слой выше', 'На слой ниже', 'На задний план']) {
    await expect(tool(label)).toHaveAttribute('title', new RegExp(`^${label} \\(.+\\)$`))
  }

  // Dragging B off A in many steps is a single undo step.
  const zoom = await page.evaluate(async () => (await import('/src/store/canvas.ts')).useCanvasStore.getState().view.zoom)
  const pastBefore = s.past
  const from = await objectCenter(page, b.id)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 250, from.y + 40, { steps: 12 })
  await page.mouse.up()
  s = await state(page)
  const movedB = s.objects.find((o) => o.id === b.id)!
  expect(movedB.x - b.x).toBeCloseTo(250 / zoom, 1)
  expect(s.past, 'перетаскивание — один шаг истории').toBe(pastBefore + 1)
  await page.keyboard.press(`${MOD}+z`)
  s = await state(page)
  expect(s.objects.find((o) => o.id === b.id)).toMatchObject({ x: b.x, y: b.y })
  await page.keyboard.press(`${MOD}+Shift+z`)
  s = await state(page)
  expect(s.objects.find((o) => o.id === b.id)).toMatchObject({ x: movedB.x, y: movedB.y })

  // Duplicate: hotkey, then the toolbar button. The copy is offset by 20 and selected.
  const aCenter = await objectCenter(page, a.id)
  await page.mouse.click(aCenter.x, aCenter.y)
  expect((await state(page)).selectedId).toBe(a.id)
  await page.keyboard.press(`${MOD}+d`)
  s = await state(page)
  expect(s.objects).toHaveLength(3)
  const copy = s.objects.find((o) => o.id === s.selectedId)!
  expect(copy.id).not.toBe(a.id)
  expect(copy).toMatchObject({ x: a.x + 20, y: a.y + 20, name: a.name })
  expect(s.objects.map((o) => o.id)).toEqual([a.id, copy.id, b.id])
  await tool('Дублировать').click()
  s = await state(page)
  expect(s.objects).toHaveLength(4)
  const copy2 = s.selectedId!

  // Delete key removes; the toolbar button too.
  await page.keyboard.press('Delete')
  s = await state(page)
  expect(s.objects.map((o) => o.id)).not.toContain(copy2)
  expect(s.objects).toHaveLength(3)

  // Backspace while renaming a layer edits the text, not the canvas.
  await page.locator(`[data-layer-id="${copy.id}"] .layer-name`).dblclick()
  const rename = page.getByRole('textbox', { name: 'Название слоя' })
  await expect(rename).toBeFocused()
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Delete')
  expect((await state(page)).objects).toHaveLength(3)
  await page.keyboard.press('Escape')
  expect((await state(page)).objects.find((o) => o.id === copy.id)!.name).toBe(a.name)

  // Rename for real, then undo it.
  await page.locator(`[data-layer-id="${copy.id}"] .layer-name`).dblclick()
  await rename.fill('Копия')
  await rename.press('Enter')
  await expect(page.locator(`[data-layer-id="${copy.id}"] .layer-name`)).toHaveText('Копия')
  await page.keyboard.press(`${MOD}+z`)
  await expect(page.locator(`[data-layer-id="${copy.id}"] .layer-name`)).toHaveText(a.name)
  await page.keyboard.press(`${MOD}+Shift+z`)
  await expect(page.locator(`[data-layer-id="${copy.id}"] .layer-name`)).toHaveText('Копия')

  await tool('Удалить').click()
  expect((await state(page)).objects.map((o) => o.id)).toEqual([a.id, b.id])

  // Flip with H: the object stays where it is, the dot moves to the other side.
  await page.locator(`[data-layer-id="${a.id}"]`).click()
  const before = await objectCenter(page, a.id)
  const dotBefore = await center(page, `[data-object-id="${a.id}"] [data-marker]`)
  expect(dotBefore.x).toBeLessThan(before.x)
  await page.keyboard.press('h')
  const after = await objectCenter(page, a.id)
  const dotAfter = await center(page, `[data-object-id="${a.id}"] [data-marker]`)
  expect(Math.abs(after.x - before.x)).toBeLessThan(0.5)
  expect(Math.abs(after.y - before.y)).toBeLessThan(0.5)
  expect(dotAfter.x - before.x).toBeCloseTo(before.x - dotBefore.x, 0)
  // Rotated: the button flips around the center too.
  const angle = page.getByRole('spinbutton', { name: 'Угол' })
  await angle.fill('30')
  await angle.press('Enter')
  const rotated = await objectCenter(page, a.id)
  await tool('Отразить по горизонтали').click()
  const flipped = await objectCenter(page, a.id)
  expect(Math.abs(flipped.x - rotated.x)).toBeLessThan(0.5)
  expect(Math.abs(flipped.y - rotated.y)).toBeLessThan(0.5)
  expect((await state(page)).objects.find((o) => o.id === a.id)).toMatchObject({ rotation: -30, flipX: false })

  // Layer order: hotkeys and buttons; canvas paint order and the panel agree.
  const expectOrder = async (ids: string[]) => {
    expect(await domOrder(page)).toEqual(ids)
    expect(await panelOrder(page), 'панель — сверху передний').toEqual([...ids].reverse())
  }
  await page.locator(`[data-layer-id="${a.id}"]`).click()
  await expectOrder([a.id, b.id])
  await page.keyboard.press(`${MOD}+Shift+BracketRight`)
  await expectOrder([b.id, a.id])
  await page.keyboard.press(`${MOD}+BracketLeft`)
  await expectOrder([a.id, b.id])
  await page.keyboard.press(`${MOD}+BracketRight`)
  await expectOrder([b.id, a.id])
  await page.keyboard.press(`${MOD}+Shift+BracketLeft`)
  await expectOrder([a.id, b.id])
  await tool('На передний план').click()
  await expectOrder([b.id, a.id])
  await tool('На задний план').click()
  await expectOrder([a.id, b.id])
  await expect(tool('На слой ниже')).toBeDisabled()

  // Drag in the panel: the bottom row (A) onto the top half of the top row (B) → A in front.
  await page
    .locator(`[data-layer-id="${a.id}"]`)
    .dragTo(page.locator(`[data-layer-id="${b.id}"]`), { targetPosition: { x: 40, y: 3 } })
  await expectOrder([b.id, a.id])
  await page.keyboard.press(`${MOD}+z`)
  await expectOrder([a.id, b.id])
  await page.keyboard.press(`${MOD}+Shift+z`)
  await expectOrder([b.id, a.id])

  // Click in the panel selects.
  await page.locator(`[data-layer-id="${b.id}"]`).click()
  expect((await state(page)).selectedId).toBe(b.id)
  await expect(page.locator(`[data-layer-id="${b.id}"]`)).toHaveClass(/layer-active/)

  // Eye: hidden objects are not drawn.
  await page.locator(`[data-layer-id="${b.id}"]`).getByRole('button', { name: 'Скрыть' }).click()
  await expect(page.locator(`.canvas-svg [data-object-id="${b.id}"]`)).toHaveCount(0)
  await page.locator(`[data-layer-id="${b.id}"]`).getByRole('button', { name: 'Показать' }).click()
  await expect(page.locator(`.canvas-svg [data-object-id="${b.id}"]`)).toHaveCount(1)

  // Lock: dragging, arrows and H leave the object alone; it can still be selected.
  await page.locator(`[data-layer-id="${a.id}"]`).getByRole('button', { name: 'Заблокировать' }).click()
  const locked = (await state(page)).objects.find((o) => o.id === a.id)!
  const lockedAt = await objectCenter(page, a.id)
  await page.mouse.move(lockedAt.x, lockedAt.y)
  await page.mouse.down()
  await page.mouse.move(lockedAt.x + 120, lockedAt.y + 60, { steps: 6 })
  await page.mouse.up()
  expect((await state(page)).selectedId).toBe(a.id)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('h')
  expect((await state(page)).objects.find((o) => o.id === a.id)).toEqual(locked)
  await expect(page.locator('.frame-handle')).toHaveCount(0)
  await page.locator(`[data-layer-id="${a.id}"]`).getByRole('button', { name: 'Разблокировать' }).click()
  await expect(page.locator('.frame-handle')).toHaveCount(5)

  // Every step undoes back to an empty canvas, and redo brings back the same result.
  const final = await state(page)
  for (let i = 0; i < final.past; i++) await page.keyboard.press(`${MOD}+z`)
  s = await state(page)
  expect(s.past).toBe(0)
  expect(s.objects).toEqual([])
  await expect(page.locator('.canvas-svg [data-object-id]')).toHaveCount(0)
  await expect(tool('Отменить')).toBeDisabled()
  for (let i = 0; i < final.past; i++) await tool('Повторить').click()
  s = await state(page)
  expect(s.objects).toEqual(final.objects)
  expect(s.future).toBe(0)
})
