import { expect, test, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { diff, openSource } from './render'

/**
 * Stage 7: a scene from three sources is downloaded as SVG; the file is rendered on its own and
 * compared pixel by pixel with the canvas. Then PNG, autosave after reload, and the project file
 * opened into an empty library.
 */

const TOLERANCE = 0.02
const ZOOM = 0.5
const SIZE = { width: 1200, height: 800 }

/** Group clicks known from the extraction tests: gopher, lantern, gopher in a video call. */
const PICKS = [
  { source: 's01', click: 5, name: 'Гофер справа' },
  { source: 's12', click: 40, name: 'Фонарь' },
  { source: 's16', click: 2, name: 'Гофер в видеозвонке' },
]

interface Obj {
  id: string
  componentId: string
  name: string
  x: number
  y: number
  scale: number
  rotation: number
  flipX: boolean
  hidden?: boolean
}

const canvasState = (page: Page) =>
  page.evaluate(async () => {
    const { useCanvasStore } = await import('/src/store/canvas.ts')
    const { objects, size } = useCanvasStore.getState()
    return { objects: objects as Obj[], size }
  })

async function downloadText(page: Page, action: () => Promise<void>) {
  const [download] = await Promise.all([page.waitForEvent('download'), action()])
  return { name: download.suggestedFilename(), text: readFileSync((await download.path())!, 'utf8'), download }
}

test('экспорт SVG совпадает с холстом; PNG; автосохранение; проект JSON', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  // Three components through the real "Add to library" form.
  for (const pick of PICKS) {
    await openSource(page, pick.source)
    await page.evaluate(async (click) => {
      const { useEditorStore } = await import('/src/store/editor.ts')
      useEditorStore.getState().select(click - 1, false)
    }, pick.click)
    await page.getByLabel('Название').fill(pick.name)
    await page.getByRole('button', { name: 'Добавить в библиотеку' }).click()
    await expect(page.getByRole('status')).toHaveText('Добавлено в библиотеку')
  }

  await page.getByRole('tab', { name: 'Библиотека' }).click()
  const tiles = page.locator('.library-preview')
  await expect(tiles).toHaveCount(3)
  for (let i = 0; i < 3; i++) await tiles.nth(i).click()

  // Spread them out, turn and mirror some; one more copy is hidden and must not be exported.
  await page.evaluate(async () => {
    const { useCanvasStore } = await import('/src/store/canvas.ts')
    const canvas = useCanvasStore.getState()
    const [a, b, c] = canvas.objects
    canvas.update(a.id, { x: 40, y: 260 })
    canvas.update(b.id, { x: 500, y: 60, rotation: 20 })
    canvas.update(c.id, { x: 820, y: 330, flipX: true })
    canvas.select(c.id)
    useCanvasStore.getState().duplicate()
    const copy = useCanvasStore.getState().selectedId!
    useCanvasStore.getState().update(copy, { hidden: true, x: 600, y: 500 })
    useCanvasStore.getState().select(null)
  })
  const scene = await canvasState(page)
  expect(scene.objects).toHaveLength(4)
  expect(scene.objects.filter((o) => !o.hidden)).toHaveLength(3)

  // The button and ⌘E give the same file.
  const svg = await downloadText(page, () => page.getByRole('button', { name: 'Скачать SVG' }).click())
  expect(svg.name).toMatch(/^composition-\d{4}-\d{2}-\d{2}\.svg$/)
  await page.locator('.canvas-stage').click({ position: { x: 5, y: 5 } })
  const viaKey = await downloadText(page, () => page.keyboard.press('ControlOrMeta+KeyE'))
  expect(viaKey.text).toBe(svg.text)
  writeFileSync(info.outputPath(svg.name), svg.text)
  await info.attach('export.svg', { path: info.outputPath(svg.name), contentType: 'image/svg+xml' })

  // Structure, checked in the browser's own XML parser.
  const check = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
    const root = doc.documentElement
    const ids = [...doc.querySelectorAll('[id]')].map((el) => el.id)
    const refs = [...doc.querySelectorAll('*')].flatMap((el) =>
      [...el.attributes].flatMap((a) => [
        ...[...a.value.matchAll(/url\(\s*['"]?#([^'")\s]+)/g)].map((m) => m[1]),
        ...(/(^|:)href$/.test(a.name) && a.value.startsWith('#') ? [a.value.slice(1)] : []),
      ]),
    )
    const objects = [...root.children].filter((el) => el.tagName === 'g')
    return {
      parseError: doc.querySelector('parsererror')?.textContent ?? null,
      viewBox: root.getAttribute('viewBox'),
      width: root.getAttribute('width'),
      height: root.getAttribute('height'),
      background: root.querySelector(':scope > rect#background')?.getAttribute('fill') ?? null,
      defs: doc.querySelectorAll('defs').length,
      duplicates: ids.filter((id, i) => ids.indexOf(id) !== i),
      refs: refs.length,
      unresolved: refs.filter((id) => !ids.includes(id)),
      objects: objects.map((g) => ({ id: g.id, source: g.getAttribute('data-source'), transform: g.getAttribute('transform') })),
      ui: doc.querySelectorAll('[class], [data-handle], [data-object-id], .frame-box').length,
    }
  }, svg.text)
  expect(check.parseError).toBeNull()
  expect([check.viewBox, check.width, check.height]).toEqual(['0 0 1200 800', '1200', '800'])
  expect(check.background).toBe('#fff')
  expect(check.defs).toBe(1)
  expect(check.duplicates).toEqual([])
  expect(check.refs).toBeGreaterThan(0)
  expect(check.unresolved).toEqual([])
  expect(check.ui).toBe(0)
  expect(check.objects.map((o) => [o.id, o.source])).toEqual([
    ['гофер-справа', 's01'],
    ['фонарь', 's12'],
    ['гофер-в-видеозвонке', 's16'],
  ])
  expect(check.objects.every((o) => o.transform?.startsWith('translate('))).toBe(true)

  // Canvas at 50 % without the page border; then the downloaded file as an <img> of the same size
  // right over the page, so both go through the same pixel snapping and the same screenshot clip.
  await page.addStyleTag({ content: '.canvas-page { stroke: none }' })
  await page.evaluate(async (zoom) => {
    const { useCanvasStore } = await import('/src/store/canvas.ts')
    useCanvasStore.getState().setView({ zoom, x: 8, y: 8 })
  }, ZOOM)
  const pageBox = (await page.locator('.canvas-page').boundingBox())!
  expect([pageBox.width, pageBox.height]).toEqual([SIZE.width * ZOOM, SIZE.height * ZOOM])
  const canvasPng = await page.screenshot({ clip: pageBox })
  await page.evaluate(
    async ({ svg, box }) => {
      const img = document.createElement('img')
      img.id = 'exported'
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
      Object.assign(img.style, {
        position: 'fixed',
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        zIndex: '1000',
      })
      document.body.append(img)
      await img.decode()
    },
    { svg: svg.text, box: pageBox },
  )
  const filePng = await page.screenshot({ clip: pageBox })
  await page.evaluate(() => document.getElementById('exported')!.remove())
  for (const [name, png] of [['canvas', canvasPng], ['file', filePng]] as const) {
    writeFileSync(info.outputPath(`${name}.png`), png)
    await info.attach(name, { path: info.outputPath(`${name}.png`), contentType: 'image/png' })
  }
  const size = { width: SIZE.width * ZOOM, height: SIZE.height * ZOOM }
  const { painted, different } = await diff(page.context().browser()!, canvasPng.toString('base64'), filePng.toString('base64'), size)
  info.annotations.push({ type: 'различие', description: `${((different / painted) * 100).toFixed(3)} % из ${painted} px` })
  console.log(`[${info.project.name}] различие ${((different / painted) * 100).toFixed(3)} % из ${painted} px`)
  expect(painted, 'на холсте нарисованы объекты').toBeGreaterThan(20_000)
  expect(different / painted, `различие ${((different / painted) * 100).toFixed(2)} %`).toBeLessThan(TOLERANCE)

  // PNG from the same SVG, at 2×.
  const [pngDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Скачать PNG' }).click()])
  expect(pngDownload.suggestedFilename()).toMatch(/^composition-\d{4}-\d{2}-\d{2}\.png$/)
  const png = readFileSync((await pngDownload.path())!)
  expect(png.subarray(1, 4).toString()).toBe('PNG')
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([2400, 1600])

  // Autosave: the same objects and canvas size after a reload.
  await page.waitForTimeout(500)
  await page.reload()
  await page.getByRole('tab', { name: 'Библиотека' }).click()
  await expect(page.locator('.canvas-svg [data-object-id]')).toHaveCount(3)
  expect(await canvasState(page)).toEqual(scene)

  // Project file, opened into an empty library as on another computer.
  const project = await downloadText(page, () => page.getByRole('button', { name: 'Сохранить проект' }).click())
  expect(project.name).toMatch(/^project-\d{4}-\d{2}-\d{2}\.json$/)
  expect(JSON.parse(project.text).components).toHaveLength(3)
  await page.evaluate(async () => {
    const { useLibraryStore } = await import('/src/store/library.ts')
    for (const c of [...useLibraryStore.getState().components]) await useLibraryStore.getState().remove(c.id)
  })
  await expect(tiles).toHaveCount(0)
  expect((await canvasState(page)).objects).toEqual([])

  await page.getByTestId('open-project').setInputFiles({ name: project.name, mimeType: 'application/json', buffer: Buffer.from(project.text) })
  await expect(tiles).toHaveCount(3)
  await expect(page.locator('.canvas-svg [data-object-id]')).toHaveCount(3)
  expect(await canvasState(page)).toEqual(scene)
  const reopened = await downloadText(page, () => page.getByRole('button', { name: 'Скачать SVG' }).click())
  expect(reopened.text).toBe(svg.text)

  // A broken file leaves the composition alone and says why.
  await page.getByTestId('open-project').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from(project.text.slice(0, 200)) })
  await expect(page.getByRole('alert')).toContainText('Не удалось открыть «broken.json». Файл повреждён: это не JSON.')
  await page.getByTestId('open-project').setInputFiles({
    name: 'other.json',
    mimeType: 'application/json',
    buffer: Buffer.from(project.text.replace(/"scale": [\d.]+/, '"scale": "big"')),
  })
  await expect(page.getByRole('alert')).toContainText('Объект №1: неверное или отсутствующее поле «scale».')
  expect(await canvasState(page)).toEqual(scene)
})
