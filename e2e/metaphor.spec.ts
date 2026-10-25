import { expect, test, type Page } from '@playwright/test'
import { skipDemo } from './render'

test.beforeEach(skipDemo)

/**
 * v2, stage 5, scenario 1: a metaphor in, objects picked by meaning and laid out. Locally when
 * /api/metaphor has no key (503), through Claude when it answers; an invalid answer falls back to
 * the local pick. Reasons as chips, the objects editable, the three formats, nothing found.
 */

const state = (page: Page) =>
  page.evaluate(async () => {
    const { useCanvasStore } = await import('/src/store/canvas.ts')
    const { objects, auto, size } = useCanvasStore.getState()
    return { auto, size, objects: objects.map((o) => o.componentId) }
  })

const mains = (objects: string[]) => objects.filter((id) => id.includes('-main-')).map((id) => id.replace(/^lib-[LS]-main-/, ''))

async function open(page: Page, api: { status: number; body: unknown }) {
  await page.route('**/api/metaphor', (route) => route.fulfill({ status: api.status, contentType: 'application/json', body: JSON.stringify(api.body) }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.locator('.library-tile')).toHaveCount(10)
  return page.getByRole('group', { name: 'Собрать композицию' })
}

test('метафора локально: причины, правка чипами, примеры, форматы, ничего не нашлось', async ({ page }, info) => {
  const panel = await open(page, { status: 503, body: { error: 'ANTHROPIC_API_KEY is not set' } })
  await expect(panel.getByRole('radiogroup', { name: 'Режим сборки' }).getByRole('radio', { name: 'Метафора' })).toHaveAttribute('aria-checked', 'true')
  const input = panel.getByRole('textbox', { name: 'Метафора или заголовок' })
  await input.fill('Финансовая грамотность')
  await panel.getByRole('button', { name: 'Собрать' }).click()

  const why = panel.getByLabel('Почему эти объекты')
  await expect(why).toContainText('монета — финансы')
  await expect(why).toContainText('книга — грамотность')
  await expect(why).toContainText('подбор: локальный')
  const first = await state(page)
  expect(first.auto?.metaphor).toMatchObject({ text: 'Финансовая грамотность', source: 'local' })
  expect(mains(first.objects).sort()).toEqual(['book', 'coin', 'wallet'])
  await page.screenshot({ path: info.outputPath('metaphor-finance.png') })

  // The picked objects are chips: a wallet out, a pen in, «Собрать» rebuilds them for the same metaphor.
  const chips = panel.getByLabel('Объекты композиции')
  await chips.getByRole('button', { name: 'Убрать «Кошелёк»' }).click()
  await chips.locator('.chip-add[data-object="pen"]').click()
  await panel.getByRole('button', { name: 'Собрать' }).click()
  const edited = await state(page)
  expect(mains(edited.objects).sort()).toEqual(['book', 'coin', 'pen'])
  expect(edited.auto?.metaphor?.text).toBe('Финансовая грамотность')
  await expect(why).not.toContainText('кошелёк')

  // Every format: the same objects, main ones whole inside.
  for (const format of ['Квадрат 1:1', 'Вертикальный 2:3', 'Широкий 2:1']) {
    await page.getByRole('radiogroup', { name: 'Формат холста' }).getByRole('radio', { name: format }).click()
    await panel.getByRole('button', { name: 'Перекомпоновать под формат' }).click()
    const s = await state(page)
    expect(mains(s.objects).sort(), format).toEqual(['book', 'coin', 'pen'])
    expect(s.auto?.size).toEqual(s.size)
    await page.screenshot({ path: info.outputPath(`metaphor-${format.split(' ')[0]}.png`) })
  }

  // An example chip picks and builds at once.
  await panel.getByLabel('Примеры метафор').getByRole('button', { name: 'Идея' }).click()
  await expect(input).toHaveValue('Идея')
  await expect(why).toContainText('лампа — идея')
  expect(mains((await state(page)).objects)).toContain('lamp')

  // Nothing found: a message and a way to choose by hand; the composition stays.
  const before = await state(page)
  await input.fill('Квантовая физика')
  await panel.getByRole('button', { name: 'Собрать' }).click()
  await expect(panel.getByRole('alert')).toContainText('Для «Квантовая физика» в библиотеке ничего не нашлось')
  expect(await state(page)).toEqual(before)
  await panel.getByRole('button', { name: 'Выбрать объекты' }).click()
  await expect(panel.getByRole('textbox', { name: 'Названия объектов' })).toBeVisible()

  // Survives a reload: the metaphor, the reasons and the mode come back.
  await page.waitForTimeout(500)
  await page.reload()
  await expect(panel.getByRole('textbox', { name: 'Метафора или заголовок' })).toHaveValue('Идея')
  await expect(why).toContainText('лампа — идея')
})

test('метафора через Claude: ответ сервера, пометка режима; неверный ответ — локальный подбор', async ({ page }) => {
  const panel = await open(page, { status: 200, body: { objects: [{ id: 'headphones', reason: 'фокус' }, { id: 'phone', reason: 'удалёнка' }, { id: 'lamp', reason: 'рабочее место' }] } })
  await panel.getByRole('textbox', { name: 'Метафора или заголовок' }).fill('Удалённая работа')
  await panel.getByRole('button', { name: 'Собрать' }).click()
  const why = panel.getByLabel('Почему эти объекты')
  await expect(why).toContainText('подбор: Claude')
  await expect(why).toContainText('наушники — фокус')
  expect(mains((await state(page)).objects).sort()).toEqual(['headphones', 'lamp', 'phone'])

  // An id outside the library: the answer is rejected as a whole.
  await page.unroute('**/api/metaphor')
  await page.route('**/api/metaphor', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ objects: [{ id: 'laptop', reason: 'работа' }] }) }))
  await panel.getByRole('textbox', { name: 'Метафора или заголовок' }).fill('Удалённая работа из дома')
  await panel.getByRole('button', { name: 'Собрать' }).click()
  await expect(why).toContainText('подбор: локальный')
  expect(mains((await state(page)).objects)).toContain('phone')
})
