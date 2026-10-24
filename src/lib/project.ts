import type { LibraryComponent } from '../store/library'
import type { CanvasObject, Size } from './canvas'
import { FORMAT_IDS, type FormatId } from './formats'
import type { ObjectSize } from './libraryObjects'
import { PaletteError, validatePalette, VARIANTS, type Palette } from './palette'

export const PROJECT_FORMAT = 'svg-composer-project'
export const PROJECT_VERSION = 1

/** A composition with the components it uses, so it opens on a machine with an empty library. */
export interface Project {
  format: typeof PROJECT_FORMAT
  version: typeof PROJECT_VERSION
  savedAt: string
  canvas: Size
  /** Bottom to top. */
  objects: CanvasObject[]
  components: LibraryComponent[]
  /** Color scheme of the composition; missing in files saved before v2 (then the base scheme). */
  palette?: Palette
  /** Canvas format and size of the library objects; missing in files saved before v2 stage 3. */
  canvasFormat?: FormatId
  objectSize?: ObjectSize
}

/** Format and object size of a composition, as saved with it. */
export interface ProjectLayout {
  format: FormatId
  objectSize: ObjectSize
}

/** A file that cannot be opened; the message is for the user. */
export class ProjectError extends Error {}

export function createProject(size: Size, objects: CanvasObject[], library: LibraryComponent[], palette?: Palette, layout?: ProjectLayout): Project {
  const used = new Set(objects.map((o) => o.componentId))
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    canvas: { width: size.width, height: size.height },
    objects: objects.map((o) => ({ ...o })),
    components: library.filter((c) => used.has(c.id)),
    ...(palette ? { palette: { id: palette.id, name: palette.name, background: [...palette.background], objects: [...palette.objects] } } : {}),
    ...(layout ? { canvasFormat: layout.format, objectSize: layout.objectSize } : {}),
  }
}

export const serializeProject = (project: Project) => JSON.stringify(project, null, 2)

type Check = (value: unknown) => boolean
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNumber: Check = (v) => typeof v === 'number' && Number.isFinite(v)
const isPositive: Check = (v) => isNumber(v) && (v as number) > 0
const isString: Check = (v) => typeof v === 'string'
const isId: Check = (v) => typeof v === 'string' && v.length > 0
const isBoolean: Check = (v) => typeof v === 'boolean'
const optional = (check: Check): Check => (v) => v === undefined || check(v)

const OBJECT_FIELDS: Record<keyof CanvasObject, Check> = {
  id: isId,
  componentId: isId,
  name: isString,
  x: isNumber,
  y: isNumber,
  scale: isPositive,
  rotation: isNumber,
  flipX: isBoolean,
  hidden: optional(isBoolean),
  locked: optional(isBoolean),
  variant: optional((v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < VARIANTS.length),
}

const COMPONENT_FIELDS: Record<keyof LibraryComponent, Check> = {
  id: isId,
  name: isString,
  sourceId: isString,
  markup: isString,
  defs: isString,
  width: isPositive,
  height: isPositive,
  createdAt: isNumber,
}

function checkFields<T>(value: unknown, fields: Record<string, Check>, where: string): T {
  if (!isObject(value)) throw new ProjectError(`${where}: ожидался объект.`)
  for (const [key, check] of Object.entries(fields)) {
    if (!check(value[key])) throw new ProjectError(`${where}: неверное или отсутствующее поле «${key}».`)
  }
  // Only known fields, so nothing unexpected reaches the stores.
  return Object.fromEntries(Object.keys(fields).filter((k) => value[k] !== undefined).map((k) => [k, value[k]])) as T
}

/** Component markup goes into the page as SVG, so it has to be well-formed and script-free. */
function checkMarkup(component: LibraryComponent, where: string) {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs>${component.defs}</defs>${component.markup}</svg>`,
    'image/svg+xml',
  )
  if (doc.querySelector('parsererror')) throw new ProjectError(`${where}: разметка SVG повреждена.`)
  for (const el of doc.querySelectorAll('*')) {
    const unsafe =
      ['script', 'foreignObject'].includes(el.localName) ||
      [...el.attributes].some((a) => /^on/i.test(a.name) || /^\s*javascript:/i.test(a.value))
    if (unsafe) throw new ProjectError(`${where}: разметка содержит скрипты.`)
  }
}

/** Parses and validates a project file; throws `ProjectError` with a message for the user. */
export function parseProject(text: string): Project {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new ProjectError('Файл повреждён: это не JSON.')
  }
  if (!isObject(data) || data.format !== PROJECT_FORMAT) {
    throw new ProjectError('Это не файл проекта SVG Composer.')
  }
  if (data.version !== PROJECT_VERSION) {
    throw new ProjectError(`Версия проекта ${String(data.version)} не поддерживается (нужна ${PROJECT_VERSION}).`)
  }
  const canvas = checkFields<Size>(data.canvas, { width: isPositive, height: isPositive }, 'Холст')
  if (!Array.isArray(data.objects)) throw new ProjectError('Нет списка объектов.')
  if (!Array.isArray(data.components)) throw new ProjectError('Нет списка компонентов.')

  const components = data.components.map((c, i) => {
    const component = checkFields<LibraryComponent>(c, COMPONENT_FIELDS, `Компонент №${i + 1}`)
    checkMarkup(component, `Компонент «${component.name}»`)
    return component
  })
  let palette: Palette | undefined
  if (data.palette !== undefined) {
    try {
      const checked = validatePalette(data.palette, 'Цветовая схема')
      if (!isId(checked.id)) throw new PaletteError('Цветовая схема: нет id.')
      palette = checked as Palette
    } catch (err) {
      throw err instanceof PaletteError ? new ProjectError(err.message) : err
    }
  }
  if (data.canvasFormat !== undefined && !FORMAT_IDS.includes(data.canvasFormat as FormatId)) {
    throw new ProjectError(`Неизвестный формат холста «${String(data.canvasFormat)}».`)
  }
  if (data.objectSize !== undefined && data.objectSize !== 'L' && data.objectSize !== 'S') {
    throw new ProjectError(`Неизвестный размер объектов «${String(data.objectSize)}» (нужен L или S).`)
  }
  const componentIds = new Set(components.map((c) => c.id))
  const objectIds = new Set<string>()
  const objects = data.objects.map((o, i) => {
    const obj = checkFields<CanvasObject>(o, OBJECT_FIELDS, `Объект №${i + 1}`)
    if (!componentIds.has(obj.componentId)) {
      throw new ProjectError(`Объект «${obj.name}»: в файле нет его компонента.`)
    }
    if (objectIds.has(obj.id)) throw new ProjectError(`Объект «${obj.name}»: повторяется id ${obj.id}.`)
    objectIds.add(obj.id)
    return obj
  })
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: isString(data.savedAt) ? (data.savedAt as string) : '',
    canvas,
    objects,
    components,
    ...(palette ? { palette } : {}),
    ...(data.canvasFormat !== undefined ? { canvasFormat: data.canvasFormat as FormatId } : {}),
    ...(data.objectSize !== undefined ? { objectSize: data.objectSize as ObjectSize } : {}),
  }
}
