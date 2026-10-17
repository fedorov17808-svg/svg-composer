import { useEffect, useRef, useState } from 'react'
import { exportFileName, exportSvg } from '../lib/exportSvg'
import { createProject, parseProject, ProjectError, serializeProject } from '../lib/project'
import { useCanvasStore } from '../store/canvas'
import { useLibraryStore } from '../store/library'
import { useUiStore } from '../store/ui'

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform)
const PNG_SCALE = 2
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

function compositionSvg() {
  const { size, objects } = useCanvasStore.getState()
  const components = new Map(useLibraryStore.getState().components.map((c) => [c.id, c]))
  return { svg: exportSvg({ size, objects, components }), size }
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

/** Project and export actions in the header; ⌘E downloads the SVG from anywhere. */
export function FileMenu() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
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

  const saveProject = () => {
    const { size, objects } = useCanvasStore.getState()
    const project = createProject(size, objects, useLibraryStore.getState().components)
    download(new Blob([serializeProject(project)], { type: 'application/json' }), exportFileName('json', new Date(), 'project'))
  }

  const openProject = async (file: File) => {
    setError(null)
    try {
      const project = parseProject(await file.text())
      await useLibraryStore.getState().addMissing(project.components)
      useCanvasStore.getState().replace(project.canvas, project.objects)
      useUiStore.getState().setWorkspaceMode('composition')
      useUiStore.getState().showToast(`Проект «${file.name}» открыт`)
    } catch (err) {
      const reason = err instanceof ProjectError ? err.message : `Ошибка: ${err instanceof Error ? err.message : String(err)}`
      setError(`Не удалось открыть «${file.name}». ${reason}`)
    }
  }

  const png = async () => {
    try {
      await downloadPng()
    } catch (err) {
      setError(`Не удалось сохранить PNG: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="file-menu">
      <button className="btn" onClick={() => inputRef.current?.click()} title="Открыть проект из файла .json">
        Открыть проект
      </button>
      <button className="btn" onClick={saveProject} title="Холст, объекты и их компоненты в одном файле .json">
        Сохранить проект
      </button>
      <span className="toolbar-divider" />
      <button className="btn" onClick={png} disabled={!visible} title="Растр из того же SVG, 2×">
        Скачать PNG
      </button>
      <button
        className="btn btn-primary"
        onClick={downloadSvg}
        disabled={!visible}
        title={`Скачать SVG (${IS_MAC ? '⌘E' : 'Ctrl+E'})`}
      >
        Скачать SVG
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
          if (file) void openProject(file)
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
    </div>
  )
}
