import { expect, test } from '@playwright/test'
import { expectSameRender, extractSelection, openSource } from './render'

interface Case {
  source: string
  /** Group under the click, numbered as in the "Выделение" panel ("группа №N" = index + 1). */
  click: number
  /** Group the click must select, if it is part of the check. */
  selects?: number
  what: string
}

const CASES: Case[] = [
  // Body fill + outline is a layer; eyes, mouth and paws are its siblings in the gopher group №1.
  { source: 's13', click: 9, selects: 1, what: 'гофер с пандой' },
  { source: 's12', click: 10, selects: 1, what: 'гофер с фонарём' },
  { source: 's12', click: 40, what: 'фонарь' },
  { source: 's01', click: 5, what: 'гофер справа' },
  { source: 's16', click: 2, what: 'гофер в видеозвонке' },
]

for (const c of CASES) {
  test(`${c.source}: клик по группе №${c.click} (${c.what}) — компонент совпадает с исходником`, async ({ page, browser }, info) => {
    await page.goto('/')
    await openSource(page, c.source)
    // The same call the click handler makes.
    const selected = await page.evaluate(async (click) => {
      const { useEditorStore } = await import('/src/store/editor.ts')
      useEditorStore.getState().select(click - 1, false)
      return useEditorStore.getState().selection[0].node + 1
    }, c.click)
    if (c.selects) expect(selected, 'выбрана группа').toBe(c.selects)
    await expectSameRender(browser, info, await extractSelection(page))
  })
}
