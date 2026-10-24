// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isBuiltin, useLibraryStore, type LibraryComponent } from './library'
import { versionComponent, versionId, type LibraryObject } from './objectLibrary'

const version = { file: 'library/L/main/coin.svg', width: 30, height: 20 }
const coin: LibraryObject = {
  id: 'coin',
  name: 'Монета',
  synonyms: [],
  versions: { L: { main: version, bg: version }, S: { main: version, bg: version } },
}
const file = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20" width="30" height="20" fill="none">
<g fill="none" transform="translate(-100 -200)">
<path d="M100 200h30v20h-30z" fill="#F9ECB0"></path>
<path d="M100 200L130 220" stroke="#181817"></path>
</g>
</svg>`

const user = (id: string): LibraryComponent => ({ id, name: id, sourceId: 's01', markup: '<g/>', defs: '', width: 1, height: 1, createdAt: 1 })

describe('versionComponent', () => {
  it('takes the group of the file as it is, with the size from the manifest', () => {
    const c = versionComponent(coin, 'L', 'main', file)
    expect(c.id).toBe('lib-L-main-coin')
    expect(c.name).toBe('Монета')
    expect([c.width, c.height]).toEqual([30, 20])
    expect(c.defs).toBe('')
    const group = new DOMParser().parseFromString(c.markup, 'image/svg+xml').documentElement
    expect(group.localName).toBe('g')
    expect(group.getAttribute('fill')).toBe('none')
    expect(group.getAttribute('transform')).toBe('translate(-100 -200)')
    expect([...group.children].map((p) => p.getAttribute('d'))).toEqual(['M100 200h30v20h-30z', 'M100 200L130 220'])
  })

  it('refuses a file without the object group', () => {
    expect(() => versionComponent(coin, 'S', 'bg', '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')).toThrow(/нет группы/)
  })
})

describe('built-in components', () => {
  it('replace their previous copy and keep the user components', () => {
    useLibraryStore.setState({ components: [user('a'), user(versionId('coin', 'L', 'main'))] })
    const fresh = versionComponent(coin, 'L', 'main', file)
    useLibraryStore.getState().setBuiltin([fresh])
    const { components } = useLibraryStore.getState()
    expect(components.map((c) => c.id)).toEqual(['a', 'lib-L-main-coin'])
    expect(components[1]).toBe(fresh)
    expect(isBuiltin('lib-S-bg-pen')).toBe(true)
    expect(isBuiltin('seed-s01-gopher')).toBe(false)
  })
})
