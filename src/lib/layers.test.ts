import { describe, expect, it } from 'vitest'
import { moveTo, placeNextTo, reorder } from './layers'

const items = (...ids: string[]) => ids.map((id) => ({ id }))
const ids = (list: { id: string }[]) => list.map((item) => item.id).join('')

describe('layer order (index 0 = bottom)', () => {
  const abcd = items('a', 'b', 'c', 'd')

  it('brings to front and sends to back', () => {
    expect(ids(reorder(abcd, 'b', 'front'))).toBe('acdb')
    expect(ids(reorder(abcd, 'c', 'back'))).toBe('cabd')
  })

  it('moves one step up and down', () => {
    expect(ids(reorder(abcd, 'b', 'forward'))).toBe('acbd')
    expect(ids(reorder(abcd, 'c', 'backward'))).toBe('acbd')
  })

  it('returns the same array when nothing moves', () => {
    expect(reorder(abcd, 'd', 'front')).toBe(abcd)
    expect(reorder(abcd, 'd', 'forward')).toBe(abcd)
    expect(reorder(abcd, 'a', 'back')).toBe(abcd)
    expect(reorder(abcd, 'a', 'backward')).toBe(abcd)
    expect(reorder(abcd, 'zz', 'front')).toBe(abcd)
    expect(moveTo(abcd, 'b', 1)).toBe(abcd)
  })

  it('does not mutate the input', () => {
    reorder(abcd, 'a', 'front')
    expect(ids(abcd)).toBe('abcd')
  })

  it('drops next to a row of the panel (above = in front)', () => {
    expect(ids(placeNextTo(abcd, 'a', 'c', 'above'))).toBe('bcad')
    expect(ids(placeNextTo(abcd, 'a', 'c', 'below'))).toBe('bacd')
    expect(ids(placeNextTo(abcd, 'd', 'a', 'below'))).toBe('dabc')
    expect(ids(placeNextTo(abcd, 'a', 'd', 'above'))).toBe('bcda')
    expect(placeNextTo(abcd, 'b', 'a', 'above')).toBe(abcd)
    expect(placeNextTo(abcd, 'b', 'b', 'above')).toBe(abcd)
  })
})
