import { expect, test, type Page } from '@playwright/test'

/**
 * v1 → v2 data migration: a browser that opened the gopher version keeps its IndexedDB and
 * localStorage. The first screen must be the v2 demo, with no gophers and no errors, and the user's
 * own color schemes must survive.
 */

/** Writes into an idb-keyval database (out-of-line keys), creating the store when it is missing. */
async function put(page: Page, dbName: string, storeName: string, entries: [string, unknown][]) {
  await page.evaluate(
    async ({ dbName, storeName, entries }) => {
      const open = (version?: number) =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const req = version ? indexedDB.open(dbName, version) : indexedDB.open(dbName)
          req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(storeName)) req.result.createObjectStore(storeName)
          }
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => reject(req.error)
        })
      let db = await open()
      if (!db.objectStoreNames.contains(storeName)) {
        const next = db.version + 1
        db.close()
        db = await open(next)
      }
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite')
        for (const [key, value] of entries) tx.objectStore(storeName).put(value, key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    },
    { dbName, storeName, entries },
  )
}

const keys = (page: Page, dbName: string, storeName: string) =>
  page.evaluate(
    ({ dbName, storeName }) =>
      new Promise<string[]>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => {
          const db = req.result
          if (!db.objectStoreNames.contains(storeName)) return resolve([])
          const all = db.transaction(storeName).objectStore(storeName).getAllKeys()
          all.onsuccess = () => resolve(all.result.map(String))
          all.onerror = () => reject(all.error)
        }
        req.onerror = () => reject(req.error)
      }),
    { dbName, storeName },
  )

const GOPHER_NAMES = ['Гофер-мудрец', 'Карп', 'Красный фонарь', 'Крыша пагоды']
const gopher = (name: string, i: number) => ({
  id: `seed-s${i}`,
  name,
  sourceId: `s${i}`,
  markup: `<g><rect width="100" height="100" fill="#c00"/></g>`,
  defs: '',
  width: 100,
  height: 100,
  createdAt: i,
})

/** What a v1 browser holds: the gopher library, the autosaved scene «Восточный сад», the seeded flag. */
async function seedV1(page: Page, { version }: { version?: string } = {}) {
  await page.goto('/')
  await expect(page.locator('.library-tile')).toHaveCount(10)
  // The first visit has autosaved its demo; let that settle, then replace everything with v1 data.
  await page.waitForTimeout(700)
  await put(page, 'svg-composer', 'library', GOPHER_NAMES.map((n, i) => [`seed-s${i}`, gopher(n, i)]))
  await put(page, 'svg-composer-composition', 'composition', [
    [
      'current',
      {
        size: { width: 1200, height: 800 },
        objects: GOPHER_NAMES.map((name, i) => ({ id: `o${i}`, componentId: `seed-s${i}`, name, x: 100 * i, y: 100, scale: 1, rotation: 0, flipX: false })),
      },
    ],
  ])
  await put(page, 'svg-composer-palettes', 'palettes', [
    ['custom-mine', { id: 'custom-mine', name: 'Моя схема', background: ['#EEEEEE', '#CCCCCC', '#999999', '#181817'], objects: ['#FF0000', '#00FF00', '#0000FF', '#FFFFFF'], createdAt: 1 }],
  ])
  await page.evaluate((version) => {
    localStorage.setItem('svg-composer-seeded', '4')
    if (version) localStorage.setItem('svg-composer-data-version', version)
    else localStorage.removeItem('svg-composer-data-version')
  }, version)
}

const composition = (page: Page) =>
  page.evaluate(async () => {
    const { useCanvasStore } = await import('/src/store/canvas.ts')
    const { size, objects } = useCanvasStore.getState()
    return { size, ids: objects.map((o) => o.componentId), names: objects.map((o) => o.name) }
  })

async function expectDemo(page: Page, errors: string[]) {
  await expect(page.getByRole('textbox', { name: 'Метафора или заголовок' })).toHaveValue('Финансовая грамотность')
  await expect(page.getByLabel('Почему эти объекты')).toContainText('монета — финансы')
  const state = await composition(page)
  expect(state.size).toEqual({ width: 2000, height: 1000 })
  expect(state.ids.length).toBeGreaterThanOrEqual(3)
  expect(state.ids.every((id) => id.startsWith('lib-'))).toBe(true)
  for (const name of GOPHER_NAMES) expect(state.names).not.toContain(name)
  await expect(page.getByText('Гофер')).toHaveCount(0)
  await expect(page.getByText('Восточный сад')).toHaveCount(0)
  expect(errors).toEqual([])
}

function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
  return errors
}

test('данные v1 (гоферы, без версии данных): демо v2, гоферы удалены, своя палитра осталась', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedV1(page)
  const errors = watchErrors(page)
  await page.reload()
  await expectDemo(page, errors)

  expect(await keys(page, 'svg-composer', 'library')).toEqual([])
  expect(await page.evaluate(() => localStorage.getItem('svg-composer-data-version'))).toBe('2')
  await expect(page.getByRole('radio', { name: /Моя схема/ })).toBeVisible()

  // The demo itself is autosaved now, and the migration does not run (or wipe anything) again.
  await page.waitForTimeout(700)
  await page.reload()
  await expectDemo(page, errors)
})

test('версия данных 1 в localStorage — то же самое', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedV1(page, { version: '1' })
  const errors = watchErrors(page)
  await page.reload()
  await expectDemo(page, errors)
})

test('версия данных 2, но в автосохранении объекты не из библиотеки v2: автосохранение игнорируется', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedV1(page, { version: '2' })
  const errors = watchErrors(page)
  await page.reload()
  await expectDemo(page, errors)
  // Not the migration, so the user's own state was not wiped wholesale: the palette stays too.
  await expect(page.getByRole('radio', { name: /Моя схема/ })).toBeVisible()
})

test('проект v1 с гоферами: понятное сообщение, а проект со смесью — открывается без чужих объектов', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.locator('.library-tile')).toHaveCount(10)
  const project = (objects: { id: string; componentId: string; name: string }[], components: { id: string; name: string }[]) =>
    JSON.stringify({
      format: 'svg-composer-project',
      version: 1,
      savedAt: '',
      canvas: { width: 1200, height: 800 },
      objects: objects.map((o) => ({ ...o, x: 0, y: 0, scale: 1, rotation: 0, flipX: false })),
      components: components.map((c) => ({ ...c, sourceId: 's', markup: '<g><rect width="10" height="10"/></g>', defs: '', width: 10, height: 10, createdAt: 0 })),
    })
  const only = project([{ id: 'a', componentId: 'seed-s1', name: 'Карп' }], [{ id: 'seed-s1', name: 'Карп' }])
  await page.getByTestId('open-project').setInputFiles({ name: 'v1.json', mimeType: 'application/json', buffer: Buffer.from(only) })
  await expect(page.getByRole('alert')).toContainText('проект первой версии')
  expect((await composition(page)).ids.some((id) => id.startsWith('seed-'))).toBe(false)

  const mixed = project(
    [
      { id: 'a', componentId: 'seed-s1', name: 'Карп' },
      { id: 'b', componentId: 'lib-L-main-book', name: 'Книга' },
    ],
    [
      { id: 'seed-s1', name: 'Карп' },
      { id: 'lib-L-main-book', name: 'Книга' },
    ],
  )
  await page.getByTestId('open-project').setInputFiles({ name: 'mixed.json', mimeType: 'application/json', buffer: Buffer.from(mixed) })
  await expect(page.getByText(/пропущено объектов не из библиотеки: 1/)).toBeVisible()
  expect((await composition(page)).ids).toEqual(['lib-L-main-book'])
})
