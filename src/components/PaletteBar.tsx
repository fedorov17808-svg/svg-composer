import { useEffect, useRef, useState } from 'react'
import { PaletteError, parsePaletteFile, type Palette } from '../lib/palette'
import { useCanvasStore } from '../store/canvas'
import { allPalettes, isCustomPalette, usePalettesStore } from '../store/palettes'
import { useUiStore } from '../store/ui'
import { Dialog } from './Dialog'

/** Background colors, then object colors: the scheme at a glance. */
export function Swatches({ palette }: { palette: Pick<Palette, 'background' | 'objects'> }) {
  return (
    <span className="swatches" aria-hidden="true">
      {[...palette.background, ...palette.objects].map((color, i) => (
        <span key={i} className={i === 4 ? 'swatch swatch-gap' : 'swatch'} style={{ background: color }} />
      ))}
    </span>
  )
}

/** Color schemes over the canvas: one click recolors the composition; the user's palettes can go. */
export function PaletteBar() {
  const { status, error, load, builtin, custom } = usePalettesStore()
  const palettes = allPalettes({ builtin, custom })
  const paletteId = useCanvasStore((s) => s.paletteId)
  const setPalette = useCanvasStore((s) => s.setPalette)
  const formOpen = useUiStore((s) => s.paletteForm)
  const inputRef = useRef<HTMLInputElement>(null)
  const [removing, setRemoving] = useState<Palette | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  // An unknown id (a deleted palette) shows the base scheme, as the canvas does.
  const current = palettes.some((p) => p.id === paletteId) ? paletteId : palettes[0]?.id

  const openFile = async (file: File) => {
    setFileError(null)
    try {
      const list = parsePaletteFile(await file.text())
      const saved = []
      for (const p of list) saved.push(await usePalettesStore.getState().add(p))
      setPalette(saved[0].id)
      useUiStore.getState().showToast(saved.length === 1 ? `Добавлена палитра «${saved[0].name}»` : `Добавлено палитр: ${saved.length}`)
    } catch (err) {
      const reason = err instanceof PaletteError ? err.message : `Ошибка: ${err instanceof Error ? err.message : String(err)}`
      setFileError(`Не удалось загрузить «${file.name}». ${reason}`)
    }
  }

  const remove = async (palette: Palette) => {
    setRemoving(null)
    if (useCanvasStore.getState().paletteId === palette.id) setPalette(palettes[0].id)
    await usePalettesStore.getState().remove(palette.id)
    useUiStore.getState().showToast(`Палитра «${palette.name}» удалена`)
  }

  if (status === 'error') return <p className="palette-bar error">Не удалось загрузить палитры ({error}).</p>

  return (
    <div className="palette-bar">
      <span className="muted">Схема</span>
      <div className="palette-list" role="radiogroup" aria-label="Цветовая схема">
        {palettes.map((p) => (
          <span key={p.id} className={p.id === current ? 'palette-item palette-active' : 'palette-item'}>
            <button role="radio" aria-checked={p.id === current} className="palette-choice" data-palette={p.id} title={`${p.name}: фон ${p.background.join(' ')}, объекты ${p.objects.join(' ')}`} onClick={() => setPalette(p.id)}>
              <Swatches palette={p} />
              <span className="palette-name">{p.name}</span>
            </button>
            {isCustomPalette(p.id) && (
              <button className="icon-btn palette-remove" aria-label={`Удалить палитру «${p.name}»`} title="Удалить палитру" onClick={() => setRemoving(p)}>
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      <button className="btn" onClick={() => useUiStore.getState().setPaletteForm(true)} disabled={formOpen}>
        Добавить палитру
      </button>
      <button className="btn" onClick={() => inputRef.current?.click()} title="JSON: { name, background: [4 цвета], objects: [4 цвета] } или список таких">
        Загрузить JSON…
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="open-palette"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void openFile(file)
        }}
      />
      {fileError && (
        <div className="file-error" role="alert">
          <span>{fileError}</span>
          <button className="file-error-close" onClick={() => setFileError(null)} aria-label="Закрыть">
            ×
          </button>
        </div>
      )}
      {removing && (
        <Dialog
          title="Удалить палитру?"
          onClose={() => setRemoving(null)}
          actions={
            <>
              <button className="btn" onClick={() => setRemoving(null)} autoFocus>
                Отмена
              </button>
              <button className="btn btn-danger" onClick={() => void remove(removing)}>
                Удалить
              </button>
            </>
          }
        >
          <p className="dialog-text">
            Палитра «{removing.name}» исчезнет из списка.
            {removing.id === paletteId && ' Композиция перейдёт на сиреневую схему.'}
          </p>
        </Dialog>
      )}
    </div>
  )
}
