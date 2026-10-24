import { expect, test } from '@playwright/test'

// v1, режим гоферов: исходники, выделение, демо-набор и примеры убраны из интерфейса в v2 (TASK-v2.md).
// Код режима оставлен, тест отключён; заменяют его e2e/object-library.spec.ts и адаптированные export/canvas-edit.
test.skip(true, 'v1: режим гоферов отключён в v2')

/**
 * A returning visitor: the library holds the old demo shop (no awning) under the old seed version.
 * On start it gets the shop from the current seed, with the name the user gave it.
 */
test('старые демо-компоненты обновляются до новой разметки', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const { createStore, set } = await import('/node_modules/.vite/deps/idb-keyval.js')
    const db = createStore('svg-composer', 'library')
    const old = {
      id: 'seed-s03-shop',
      name: 'Мой магазин',
      sourceId: 's03',
      markup: '<rect width="10" height="10"/>',
      defs: '',
      width: 10,
      height: 10,
      createdAt: 3,
    }
    await set(old.id, old, db)
    localStorage.setItem('svg-composer-seeded', '1')
  })
  await page.reload()
  const shop = await page.evaluate(async () => {
    const { useLibraryStore } = await import('/src/store/library.ts')
    await useLibraryStore.getState().load()
    return useLibraryStore.getState().components.find((c) => c.id === 'seed-s03-shop')
  })
  const seed = await (await page.request.get('/seed-library.json')).json()
  const fresh = seed.find((c: { id: string }) => c.id === 'seed-s03-shop')
  expect(shop?.name).toBe('Мой магазин')
  expect(shop?.markup).toBe(fresh.markup)
  // The shop with its sign and awning: their colors are in the markup.
  expect(shop?.markup).toContain('#ffebe6')
  expect(await page.evaluate(() => localStorage.getItem('svg-composer-seeded'))).toBe('4')
})
