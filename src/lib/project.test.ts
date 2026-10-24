// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { LibraryComponent } from '../store/library'
import type { CanvasObject } from './canvas'
import { createProject, parseProject, ProjectError, serializeProject } from './project'

const component = (id: string): LibraryComponent => ({
  id,
  name: `Компонент ${id}`,
  sourceId: 's01',
  markup: `<g clip-path="url(#${id}-c)"><path d="M0 0h4v4z"/></g>`,
  defs: `<clipPath id="${id}-c"><rect width="4" height="4"/></clipPath>`,
  width: 4,
  height: 4,
  createdAt: 1,
})

const OBJECTS: CanvasObject[] = [
  { id: 'o1', componentId: 'ca', name: 'Первый', x: 1.5, y: -2, scale: 0.25, rotation: -30, flipX: true },
  { id: 'o2', componentId: 'cb', name: 'Второй', x: 0, y: 0, scale: 3, rotation: 0, flipX: false, hidden: true, locked: true },
  { id: 'o3', componentId: 'ca', name: 'Копия', x: 20, y: 20, scale: 0.25, rotation: 90, flipX: false },
]
const LIBRARY = [component('ca'), component('cb'), component('unused')]

const saved = () => serializeProject(createProject({ width: 640, height: 480 }, OBJECTS, LIBRARY))

describe('project file', () => {
  it('round-trips: save → open gives the same composition', () => {
    const project = parseProject(saved())
    expect(project.canvas).toEqual({ width: 640, height: 480 })
    expect(project.objects).toEqual(OBJECTS)
    expect(project.components).toEqual([component('ca'), component('cb')])
    // And saving the opened project again changes nothing but the date.
    const again = JSON.parse(serializeProject(createProject(project.canvas, project.objects, project.components)))
    expect({ ...again, savedAt: '' }).toEqual({ ...JSON.parse(saved()), savedAt: '' })
  })

  const broken = (mutate: (data: Record<string, any>) => void) => {
    const data = JSON.parse(saved())
    mutate(data)
    return () => parseProject(JSON.stringify(data))
  }

  it.each([
    ['not JSON', () => parseProject('{"format": "svg-comp'), /не JSON/],
    ['another file', () => parseProject('{"hello": 1}'), /не файл проекта/],
    ['future version', broken((d) => (d.version = 2)), /Версия проекта 2/],
    ['bad canvas', broken((d) => (d.canvas.width = -5)), /Холст.*width/],
    ['bad object field', broken((d) => (d.objects[1].scale = 'big')), /Объект №2.*scale/],
    ['missing component', broken((d) => d.components.pop()), /«Второй».*нет его компонента/],
    ['broken markup', broken((d) => (d.components[0].markup = '<g><path></g>')), /разметка SVG повреждена/],
    ['script in markup', broken((d) => (d.components[0].markup = '<g onload="alert(1)"/>')), /скрипты/],
    ['repeated object id', broken((d) => (d.objects[2].id = 'o1')), /повторяется id o1/],
  ])('rejects %s with a clear message', (_, open, message) => {
    expect(open).toThrow(ProjectError)
    expect(open).toThrow(message)
  })

  it('keeps the color scheme and the color variants', () => {
    const palette = { id: 'custom-abc', name: 'Морская', background: ['#E0F0FF', '#A0C8F0', '#3366CC', '#101820'], objects: ['#FFD166', '#EF476F', '#06D6A0', '#FFFFFF'] }
    const objects = [{ ...OBJECTS[0], variant: 4 }]
    const project = parseProject(serializeProject(createProject({ width: 10, height: 10 }, objects, LIBRARY, palette)))
    expect(project.palette).toEqual(palette)
    expect(project.objects[0].variant).toBe(4)
    // Files saved before v2 have no scheme.
    expect(parseProject(saved()).palette).toBeUndefined()
    const bad = JSON.parse(serializeProject(createProject({ width: 10, height: 10 }, objects, LIBRARY, palette)))
    bad.palette.objects[1] = 'pink'
    expect(() => parseProject(JSON.stringify(bad))).toThrow(new ProjectError('Цветовая схема: Цвет объектов 2 — «pink» не hex-цвет. Нужно #RRGGBB, например #D7CDF5.'))
    bad.palette.objects[1] = '#EF476F'
    bad.objects[0].variant = 6
    expect(() => parseProject(JSON.stringify(bad))).toThrow('поле «variant»')
  })

  it('drops unknown fields', () => {
    const project = broken((d) => (d.objects[0].evil = '<script>'))()
    expect(project.objects[0]).not.toHaveProperty('evil')
  })
})
