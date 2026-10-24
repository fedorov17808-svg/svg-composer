import { describe, expect, it } from 'vitest'
import manifest from '../../public/library/manifest.json'
import { editDistance, matchName, parseNames } from './objectNames'

const ids = (text: string) => parseNames(text, manifest).map((m) => m.objectId)

describe('object names', () => {
  it('reads names and synonyms in any case, with ё or е, separated by commas, «и», new lines', () => {
    expect(ids('наушники, лампа, книга')).toEqual(['headphones', 'lamp', 'book'])
    expect(ids('Гарнитура; СМАРТФОН и деньги\nкошелек')).toEqual(['headphones', 'phone', 'coin', 'wallet'])
    expect(ids('  настольная   лампа , цветы ')).toEqual(['lamp', 'flowers'])
  })

  it('forgives small typos and endings, not in short words', () => {
    expect(ids('нашуники, лмапа, книгу, монеты, папку, ручкой')).toEqual(['headphones', 'lamp', 'book', 'coin', 'folder', 'pen'])
    expect(matchName('кот', manifest).objectId).toBeNull()
    expect(editDistance('лампа', 'лмапа')).toBe(1)
  })

  it('drops repeats and suggests the closest object for an unknown name', () => {
    expect(ids('книга, книжка, Книга')).toEqual(['book'])
    expect(matchName('кружка', manifest)).toEqual({ text: 'кружка', objectId: null, suggestion: 'book' })
    expect(ids('манетка, кашилек, тилифон, нушнеки')).toEqual(['coin', 'wallet', 'phone', 'headphones'])
    expect(matchName('самолёт', manifest)).toEqual({ text: 'самолёт', objectId: null })
  })
})
