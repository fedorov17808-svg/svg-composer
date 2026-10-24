// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { CanvasObject } from './canvas'
import { exportFileName, exportSvg, slugId, type ExportComponent } from './exportSvg'

const COMPONENTS = new Map<string, ExportComponent>([
  [
    'ca',
    {
      sourceId: 's01',
      width: 10,
      height: 10,
      // Inline clip path (as in the gophers), a gradient in defs and one defined but never used.
      markup:
        '<g fill-rule="evenodd"><clipPath id="ca-clip"><path d="M0 0h10v10z"/></clipPath>' +
        '<g clip-path="url(#ca-clip)"><path d="M0 0h10v10z" fill="url(#ca-grad)"/></g></g>',
      defs:
        '<linearGradient id="ca-grad" href="#ca-base"/><linearGradient id="ca-base"><stop offset="0" stop-color="red"/></linearGradient>' +
        '<radialGradient id="ca-unused"><stop offset="0"/></radialGradient>',
    },
  ],
  [
    'cb',
    {
      sourceId: 's05',
      width: 20,
      height: 10,
      // An id referenced from the markup itself: repeated instances must not repeat it.
      markup: '<g><path id="cb-shape" d="M0 0h20v10z" fill="#3a3"/><use href="#cb-shape" x="1"/></g>',
      defs: '',
    },
  ],
  ['cc', { sourceId: 's09', width: 5, height: 5, markup: '<g><circle r="2"/></g>', defs: '<clipPath id="cc-only"><rect/></clipPath>' }],
])

const obj = (id: string, componentId: string, name: string, patch: Partial<CanvasObject> = {}): CanvasObject => ({
  id,
  componentId,
  name,
  x: 10,
  y: 20,
  scale: 2,
  rotation: 0,
  flipX: false,
  ...patch,
})

const OBJECTS = [
  obj('o1', 'ca', 'Гофер с фонарём'),
  obj('o2', 'ca', 'Гофер с фонарём', { rotation: 30, flipX: true }),
  obj('o3', 'cb', 'Забор'),
  obj('o4', 'cb', 'Забор', { x: 50 }),
  obj('o5', 'cc', 'Скрытый', { hidden: true }),
  obj('o6', 'missing', 'Без компонента'),
]

const parse = (svg: string) => {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  expect(doc.querySelector('parsererror')).toBeNull()
  return doc.documentElement
}

describe('exportSvg', () => {
  const root = parse(exportSvg({ size: { width: 300, height: 200 }, objects: OBJECTS, components: COMPONENTS }))
  const ids = [...root.querySelectorAll('[id]')].map((el) => el.getAttribute('id')!)

  it('sizes the document to the canvas and starts with a white background', () => {
    expect(root.getAttribute('viewBox')).toBe('0 0 300 200')
    expect(root.getAttribute('width')).toBe('300')
    expect(root.getAttribute('height')).toBe('200')
    const bg = root.querySelector('#background')!
    expect(bg.tagName).toBe('rect')
    expect(bg.getAttribute('fill')).toBe('#fff')
    expect([...root.children].map((el) => el.tagName).slice(0, 2)).toEqual(['defs', 'rect'])
  })

  it('has no duplicate ids', () => {
    expect(ids.length).toBe(new Set(ids).size)
  })

  it('resolves every url(#) and href reference', () => {
    const refs = [...root.querySelectorAll('*')].flatMap((el) =>
      [...el.attributes].flatMap((a) => [
        ...[...a.value.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]),
        ...(/(^|:)href$/.test(a.name) && a.value.startsWith('#') ? [a.value.slice(1)] : []),
      ]),
    )
    expect(refs.length).toBeGreaterThan(4)
    for (const ref of refs) expect(ids, ref).toContain(ref)
  })

  it('exports one <g> per visible object, bottom to top, with readable ids and sources', () => {
    const groups = [...root.querySelector('#composition')!.children].filter((el) => el.hasAttribute('data-source'))
    expect(groups.map((g) => g.getAttribute('id'))).toEqual(['гофер-с-фонарём', 'гофер-с-фонарём-2', 'забор', 'забор-2'])
    expect(groups.map((g) => g.getAttribute('data-source'))).toEqual(['s01', 's01', 's05', 's05'])
    expect(groups[1].getAttribute('transform')).toBe('translate(20 30) rotate(30) scale(-2 2) translate(-5 -5)')
  })

  it('keeps only the definitions in use, once each, in a single defs', () => {
    expect(root.querySelectorAll('defs')).toHaveLength(1)
    const defIds = [...root.querySelector('defs')!.children].map((el) => el.getAttribute('id'))
    expect(defIds.sort()).toEqual(['ca-base', 'ca-clip', 'ca-grad', 'canvas-clip'])
    // Clip path keeps the inherited fill rule after moving out of the markup.
    expect(root.querySelector('#ca-clip')!.getAttribute('fill-rule')).toBe('evenodd')
  })

  it('cuts the objects by the canvas frame with one clip path', () => {
    expect([...root.children].map((el) => el.tagName)).toEqual(['defs', 'rect', 'g'])
    const composition = root.querySelector(':scope > g')!
    expect(composition.getAttribute('id')).toBe('composition')
    expect(composition.getAttribute('clip-path')).toBe('url(#canvas-clip)')
    const frame = root.querySelector('#canvas-clip')!
    expect(frame.tagName).toBe('clipPath')
    const rect = frame.firstElementChild!
    expect([frame.children.length, rect.tagName, rect.getAttribute('width'), rect.getAttribute('height')]).toEqual([1, 'rect', '300', '200'])
    expect(rect.hasAttribute('x') || rect.hasAttribute('transform')).toBe(false)
  })

  it('leaves out hidden objects and their definitions', () => {
    expect(root.innerHTML).not.toContain('circle')
    expect(root.innerHTML).not.toContain('cc-only')
  })

  it('has no canvas UI', () => {
    expect(root.querySelector('[class], [data-handle], [data-object-id]')).toBeNull()
  })
})

describe('export names', () => {
  it('turns object names into ids', () => {
    expect(slugId('Гофер с фонарём')).toBe('гофер-с-фонарём')
    expect(slugId('  Gopher #2 (copy) ')).toBe('gopher-2-copy')
    expect(slugId('42')).toBe('object-42')
    expect(slugId('…')).toBe('object')
  })

  it('names files by local date', () => {
    expect(exportFileName('svg', new Date(2026, 9, 7))).toBe('composition-2026-10-07.svg')
  })
})
