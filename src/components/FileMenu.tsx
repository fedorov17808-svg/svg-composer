import { useEffect, useRef, useState } from 'react'
import { exportFileName, exportSvg } from '../lib/exportSvg'
import { createProject, parseProject, ProjectError, serializeProject } from '../lib/project'
import { useCanvasStore } from '../store/canvas'
import { useLibraryStore } from '../store/library'
import { activePalette, findPalette, paintObject, usePalettesStore } from '../store/palettes'
import { assetUrl } from '../store/sources'
import { useUiStore } from '../store/ui'
import { Dialog } from './Dialog'
import { HelpDialog } from './HelpDialog'
import { Menu, type MenuEntry } from './Menu'

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform)
const PNG_SCALE = 2
const SHOW_GOPHERS = false
/** Safari refuses canvases over about 16.7 million pixels. */
const MAX_PNG_PIXELS = 16_000_000

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** The composition as the canvas shows it: library objects and the background in the color scheme. */
function compositionSvg() {
  const { size, objects } = useCanvasStore.getState()
  const components = new Map(useLibraryStore.getState().components.map((c) => [c.id, c]))
  const palette = activePalette()
  const svg = exportSvg({ size, objects, components, paint: (obj, c) => paintObject(obj, c, palette), background: palette.background[0] })
  return { svg, size }
}

const hasVisible = () => {
  const ids = new Set(useLibraryStore.getState().components.map((c) => c.id))
  return useCanvasStore.getState().objects.some((o) => !o.hidden && ids.has(o.componentId))
}

function downloadSvg() {
  if (!hasVisible()) {
    useUiStore.getState().showToast('На холсте нет видимых объектов')
    return
  }
  download(new Blob([compositionSvg().svg], { type: 'image/svg+xml' }), exportFileName('svg'))
}

/** Rasterizes the exported SVG itself, so the PNG shows exactly what the SVG file does. */
async function downloadPng() {
  const { svg, size } = compositionSvg()
  const scale = Math.min(PNG_SCALE, Math.sqrt(MAX_PNG_PIXELS / (size.width * size.height)))
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(size.width * scale)
    canvas.height = Math.round(size.height * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('браузер не смог создать PNG')
    download(blob, exportFileName('png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

interface Example {
  id: string
  title: string
  file: string
}

/** Project and export menus and help in the header; ⌘E downloads the SVG from anywhere. */
export function FileMenu() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [examples, setExamples] = useState<Example[]>([])
  const [dialog, setDialog] = useState<'help' | 'reset' | null>(null)
  const visible = useCanvasStore((s) => s.objects.some((o) => !o.hidden))

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.code !== 'KeyE') return
      e.preventDefault()
      downloadSvg()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    fetch(assetUrl('examples/index.json'))
      .then((res) => (res.ok ? res.json() : []))
      .then(setExamples)
      .catch(() => setExamples([]))
  }, [])

  const saveProject = () => {
    const { size, objects, paletteId, format, objectSize } = useCanvasStore.getState()
    // The saved scheme, not a palette still being edited in the form.
    const palette = findPalette(usePalettesStore.getState(), paletteId)
    const project = createProject(size, objects, useLibraryStore.getState().components, palette, { format, objectSize })
    download(new Blob([serializeProject(project)], { type: 'application/json' }), exportFileName('json', new Date(), 'project'))
  }

  const openProject = async (kind: 'Проект' | 'Пример', name: string, text: () => Promise<string>) => {
    setError(null)
    try {
      const project = parseProject(await text())
      await useLibraryStore.getState().addMissing(project.components)
      // A palette of the user that is not here yet comes with the project.
      if (project.palette) await usePalettesStore.getState().addMissing(project.palette)
      useCanvasStore.getState().replace(project.canvas, project.objects, {
        paletteId: project.palette?.id,
        format: project.canvasFormat,
        objectSize: project.objectSize,
      })
      useUiStore.getState().setWorkspaceMode('composition')
      useUiStore.getState().showToast(`${kind} «${name}» открыт`)
    } catch (err) {
      const reason = err instanceof ProjectError ? err.message : `Ошибка: ${err instanceof Error ? err.message : String(err)}`
      setError(`Не удалось открыть «${name}». ${reason}`)
    }
  }

  const openExample = (example: Example) =>
    openProject('Пример', example.title, async () => {
      const res = await fetch(assetUrl(example.file))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.text()
    })

  const resetToDemo = async () => {
    setDialog(null)
    try {
      await useLibraryStore.getState().resetToDemo()
      useUiStore.getState().setLeftTab('library')
      useUiStore.getState().showToast('Библиотека сброшена к демо-набору')
    } catch (err) {
      setError(`Не удалось сбросить библиотеку: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const png = async () => {
    try {
      await downloadPng()
    } catch (err) {
      setError(`Не удалось сохранить PNG: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // The gopher examples and the demo library of v1 are off until the examples of the object library.
  const gopherEntries: MenuEntry[] = [
    ...(examples.length ? ['Примеры', ...examples.map((ex) => ({ label: ex.title, onSelect: () => void openExample(ex) }))] : []),
    'Библиотека',
    { label: 'Сбросить к демо…', onSelect: () => setDialog('reset') },
  ]
  const projectEntries: MenuEntry[] = [
    { label: 'Открыть проект…', onSelect: () => inputRef.current?.click() },
    { label: 'Сохранить проект', onSelect: saveProject },
    ...(SHOW_GOPHERS ? gopherEntries : []),
  ]

  return (
    <div className="file-menu">
      <Menu label="Проект" entries={projectEntries} title="Открыть, сохранить, примеры" />
      <Menu
        label="Экспорт"
        primary
        title={visible ? 'Скачать композицию' : 'На холсте нет видимых объектов'}
        entries={[
          { label: 'SVG', hint: IS_MAC ? '⌘E' : 'Ctrl+E', onSelect: downloadSvg, disabled: !visible },
          { label: 'PNG (2×)', onSelect: () => void png(), disabled: !visible },
        ]}
      />
      <button className="btn btn-icon" onClick={() => setDialog('help')} title="Как пользоваться" aria-label="Справка">
        ?
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="open-project"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void openProject('Проект', file.name, () => file.text())
        }}
      />
      {error && (
        <div className="file-error" role="alert">
          <span>{error}</span>
          <button className="file-error-close" onClick={() => setError(null)} aria-label="Закрыть">
            ×
          </button>
        </div>
      )}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
      {dialog === 'reset' && (
        <Dialog
          title="Сбросить библиотеку?"
          onClose={() => setDialog(null)}
          actions={
            <>
              <button className="btn" onClick={() => setDialog(null)} autoFocus>
                Отмена
              </button>
              <button className="btn btn-danger" onClick={() => void resetToDemo()}>
                Сбросить
              </button>
            </>
          }
        >
          <p className="dialog-text">
            Все компоненты библиотеки заменятся демо-набором. Объекты холста из удалённых компонентов тоже исчезнут.
          </p>
        </Dialog>
      )}
    </div>
  )
}
