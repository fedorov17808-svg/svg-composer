import { clear, createStore, del } from 'idb-keyval'

/**
 * Version of the data the app keeps in the browser. 1 (or none) is v1: gopher components in the
 * library database and a gopher scene in the autosave. 2 is the object library.
 */
export const DATA_VERSION = 2
export const DATA_VERSION_KEY = 'svg-composer-data-version'

/** The older the data, the more of it is dropped; the user's own color schemes are never touched. */
export const needsMigration = (stored: string | null) => !(Number(stored) >= DATA_VERSION)

/**
 * Runs once per browser before the app starts. v1 data is not readable by v2: the gopher library
 * (`svg-composer`) and the autosaved scene (`svg-composer-composition`) are deleted, so the first
 * screen is the demo composition. Custom palettes (`svg-composer-palettes`) are kept. Never throws:
 * a blocked storage must not stop the app, and the autosave restore filters by itself.
 */
export async function migrateData(): Promise<void> {
  try {
    if (!needsMigration(localStorage.getItem(DATA_VERSION_KEY))) return
    await clear(createStore('svg-composer', 'library'))
    await del('current', createStore('svg-composer-composition', 'composition'))
    // The gopher demo set is never offered again.
    localStorage.setItem('svg-composer-seeded', '4')
    localStorage.setItem(DATA_VERSION_KEY, String(DATA_VERSION))
  } catch (err) {
    console.warn('Миграция данных: не удалось очистить старые данные', err)
  }
}
