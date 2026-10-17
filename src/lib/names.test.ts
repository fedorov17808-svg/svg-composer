import { describe, expect, it } from 'vitest'
import { defaultName } from './names'

describe('defaultName', () => {
  it('names a gopher source by its subject and number', () => {
    expect(defaultName('s12', 'Гофер с фонарём', [])).toBe('Гофер · 12')
    expect(defaultName('s02', 'HEY! Гоферы за ограждением', [])).toBe('Гофер · 02')
  })
  it('uses the first Russian word otherwise', () => {
    expect(defaultName('s05', 'Указатели Good code / Bugs & errors', [])).toBe('Указатели · 05')
  })
  it('numbers a repeat', () => {
    expect(defaultName('s12', 'Гофер с фонарём', ['Гофер · 12', 'Гофер · 12 (2)'])).toBe('Гофер · 12 (3)')
  })
})
