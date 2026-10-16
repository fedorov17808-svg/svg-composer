// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { collectDefs, componentSvg, extract, parseTransform, prefixIds } from './extract'

const parse = (markup: string) => {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
  return doc.documentElement as unknown as SVGSVGElement
}

const byId = (svg: Element) => new Map([...svg.querySelectorAll('[id]')].map((el) => [el.id, el]))
const ids = (markup: string) => [...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
const refs = (markup: string) => [...markup.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)].map((m) => m[1] ?? m[2])
const box = { x: 0, y: 0, width: 10, height: 10 }

describe('prefixIds', () => {
  it('renames ids and rewrites url() and href references to them', () => {
    const svg = parse(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <linearGradient id="a"><stop offset="0"/></linearGradient>
      <linearGradient id="b" href="#a" xlink:href="#a"/>
      <path id="p" fill="url(#b)" style="stroke:url('#a')" clip-path="url(#outside)"/>
      <use href="#p"/>
    </svg>`)
    prefixIds([...svg.children], 'c1-')
    const out = new XMLSerializer().serializeToString(svg)
    expect(ids(out).sort()).toEqual(['c1-a', 'c1-b', 'c1-p'])
    expect(out).toContain('href="#c1-a"')
    expect(out).toContain('xlink:href="#c1-a"')
    expect(out).toContain('fill="url(#c1-b)"')
    expect(out).toContain('stroke:url(#c1-a)')
    expect(out).toContain('href="#c1-p"')
    // Ids outside the renamed subtrees are not touched.
    expect(out).toContain('clip-path="url(#outside)"')
  })
})

describe('collectDefs', () => {
  const svg = parse(`<svg xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="base"><stop offset="0" stop-color="red"/></linearGradient>
      <linearGradient id="derived" href="#base"/>
      <radialGradient id="unused"/>
      <clipPath id="clip"><path d="M0 0h5v5z" clip-path="url(#inner)"/></clipPath>
      <clipPath id="inner"><rect width="4" height="4"/></clipPath>
      <mask id="m"><rect width="9" height="9" fill="url(#maskFill)"/></mask>
      <linearGradient id="maskFill"/>
    </defs>
    <g id="target" clip-path="url(#clip)" mask="url(#m)">
      <path fill="url(#derived)"/>
      <clipPath id="local"><rect/></clipPath>
      <path clip-path="url(#local)"/>
    </g>
  </svg>`)

  it('follows references recursively: gradient → gradient, clipPath → clipPath, mask → gradient', () => {
    const found = collectDefs([svg.querySelector('#target')!], byId(svg)).map((el) => el.id)
    expect(found).toEqual(['base', 'derived', 'clip', 'inner', 'm', 'maskFill'])
  })

  it('skips unused defs and elements already inside the subtree', () => {
    const found = collectDefs([svg.querySelector('#target')!], byId(svg)).map((el) => el.id)
    expect(found).not.toContain('unused')
    expect(found).not.toContain('local')
  })
})

describe('parseTransform', () => {
  it('composes transform lists left to right', () => {
    const m = parseTransform('translate(10 20) scale(2)')
    expect(m).toEqual([2, 0, 0, 2, 10, 20])
  })
})

describe('extract', () => {
  it('produces self-contained markup: prefixed ids, defs copied, every reference resolves', () => {
    const svg = parse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs><linearGradient id="g1"><stop offset="0"/></linearGradient><linearGradient id="g2" href="#g1"/></defs>
      <g id="item"><path d="M10 10h10v10z" fill="url(#g2)"/></g>
    </svg>`)
    const c = extract({ elements: [svg.querySelector('#item')!], bounds: [{ x: 10, y: 10, width: 10, height: 10 }], prefix: 'cX-' })
    const all = ids(c.markup + c.defs)
    expect(all.every((id) => id.startsWith('cX-'))).toBe(true)
    expect(new Set(all).size).toBe(all.length)
    for (const ref of refs(c.markup + c.defs)) expect(all).toContain(ref)
    expect(c.defs).toContain('id="cX-g1"')
    expect(c.defs).toContain('id="cX-g2"')
    expect(c.markup).toMatch(/^<g transform="translate\(-10 -10\)">/)
    expect([c.width, c.height]).toEqual([10, 10])
    // Parses as a valid standalone document.
    const doc = new DOMParser().parseFromString(componentSvg(c), 'image/svg+xml')
    expect(doc.querySelector('parsererror')).toBeNull()
  })

  it('folds parent transforms into the clone and bakes inherited attributes', () => {
    const svg = parse(`<svg xmlns="http://www.w3.org/2000/svg" fill-rule="evenodd">
      <g transform="translate(100 0)" stroke="#000"><g transform="scale(2)"><g id="item" transform="translate(5 5)"><path d="M0 0h1v1z"/></g></g></g>
    </svg>`)
    const c = extract({ elements: [svg.querySelector('#item')!], bounds: [box], prefix: 'p-' })
    const item = parse(componentSvg(c)).querySelector('[id="p-item"]')!
    expect(parseTransform(item.getAttribute('transform'))).toEqual([2, 0, 0, 2, 110, 10])
    expect(item.getAttribute('fill-rule')).toBe('evenodd')
    expect(item.getAttribute('stroke')).toBe('#000')
  })

  it('keeps clipping parents as wrappers and copies their clipPath', () => {
    const svg = parse(`<svg xmlns="http://www.w3.org/2000/svg">
      <clipPath id="clip"><rect width="5" height="5"/></clipPath>
      <g transform="translate(3 0)" clip-path="url(#clip)" opacity="0.5"><g id="item" transform="translate(1 0)"><path d="M0 0h9v9z"/></g></g>
    </svg>`)
    const c = extract({ elements: [svg.querySelector('#item')!], bounds: [box], prefix: 'k-' })
    const out = parse(componentSvg(c))
    const wrapper = out.querySelector('[id="k-item"]')!.parentElement!
    expect(wrapper.getAttribute('clip-path')).toBe('url(#k-clip)')
    expect(wrapper.getAttribute('opacity')).toBe('0.5')
    expect(parseTransform(wrapper.getAttribute('transform'))).toEqual([1, 0, 0, 1, 3, 0])
    expect(parseTransform(out.querySelector('[id="k-item"]')!.getAttribute('transform'))).toEqual([1, 0, 0, 1, 1, 0])
    expect(c.defs).toContain('id="k-clip"')
  })

  it('merges several elements in source paint order and unions their bounds', () => {
    const svg = parse(`<svg xmlns="http://www.w3.org/2000/svg">
      <clipPath id="c"><rect width="50" height="50"/></clipPath>
      <g id="a"/>
      <g clip-path="url(#c)"><g id="b"/><g id="mid"/><g id="c2"/></g>
      <g id="d"/>
    </svg>`)
    const pick = (id: string) => svg.querySelector(`#${id}`)!
    // Selected in a different order than drawn.
    const c = extract({
      elements: [pick('d'), pick('c2'), pick('a'), pick('b')],
      bounds: [
        { x: 40, y: 40, width: 20, height: 10 },
        { x: 30, y: 5, width: 5, height: 5 },
        { x: 10, y: 20, width: 10, height: 10 },
        { x: 15, y: 25, width: 1, height: 1 },
      ],
      prefix: 'm-',
    })
    expect(ids(c.markup)).toEqual(['m-a', 'm-b', 'm-c2', 'm-d'])
    // b and c2 are adjacent under the same clipped parent, so they share one wrapper.
    expect(c.markup.match(/clip-path=/g)).toHaveLength(1)
    expect(c.markup).not.toContain('m-mid')
    expect(c.markup).toMatch(/^<g transform="translate\(-10 -5\)">/)
    expect([c.width, c.height]).toEqual([50, 45])
    expect(c.defs.match(/<clipPath/g)).toHaveLength(1)
  })
})
