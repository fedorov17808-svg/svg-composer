// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { canvasParts, normalizeAngle, toCanvas, toLocal, type CanvasObject } from './canvas'

const obj = (patch: Partial<CanvasObject> = {}): CanvasObject => ({
  id: 'o1',
  componentId: 'c1',
  name: 'test',
  x: 100,
  y: 50,
  scale: 2,
  rotation: 0,
  flipX: false,
  ...patch,
})

describe('object geometry', () => {
  const size = { width: 40, height: 20 }

  it('places the unrotated box at x, y', () => {
    expect(toCanvas(obj(), size, 0, 0)).toEqual({ x: 100, y: 50 })
    expect(toCanvas(obj(), size, 40, 20)).toEqual({ x: 180, y: 90 })
  })

  it('rotates around the box center', () => {
    const p = toCanvas(obj({ rotation: 90 }), size, 40, 20)
    expect(p.x).toBeCloseTo(140 - 20)
    expect(p.y).toBeCloseTo(70 + 40)
  })

  it('toLocal inverts toCanvas with rotation and flip', () => {
    const o = obj({ rotation: 33, flipX: true, scale: 0.7 })
    const back = toLocal(o, size, toCanvas(o, size, 12, 5))
    expect(back.x).toBeCloseTo(12)
    expect(back.y).toBeCloseTo(5)
  })

  it('normalizes angles to (-180, 180]', () => {
    expect(normalizeAngle(190)).toBe(-170)
    expect(normalizeAngle(-180)).toBe(180)
    expect(normalizeAngle(720)).toBe(0)
  })
})

describe('canvasParts', () => {
  const component = {
    markup:
      '<g transform="translate(-1 -2)" clip-rule="evenodd"><clipPath id="c1-a"><path d="M0 0h5v5z"/></clipPath>' +
      '<g id="c1-body" clip-path="url(#c1-a)"><path id="c1-dot" d="M1 1h1v1z" fill="url(#c1-g)"/></g></g>',
    defs: '<linearGradient id="c1-g"><stop offset="0"/></linearGradient>',
  }

  it('moves inline definitions to defs and keeps their inherited values', () => {
    const { markup, defs } = canvasParts(component)
    expect(markup).not.toContain('clipPath')
    expect(defs).toContain('<linearGradient id="c1-g">')
    expect(defs).toMatch(/<clipPath id="c1-a"[^>]*clip-rule="evenodd"/)
  })

  it('keeps one copy of a definition found both in defs and in markup', () => {
    const { defs } = canvasParts({ ...component, defs: component.defs + '<clipPath id="c1-a"><path d="M0 0h5v5z"/></clipPath>' })
    expect(defs.match(/id="c1-a"/g)).toHaveLength(1)
  })

  it('drops ids nobody refers to, so repeated instances do not clash', () => {
    const { markup } = canvasParts(component)
    expect(markup).not.toContain('id="c1-body"')
    expect(markup).not.toContain('id="c1-dot"')
    expect(markup).toContain('clip-path="url(#c1-a)"')
  })
})
