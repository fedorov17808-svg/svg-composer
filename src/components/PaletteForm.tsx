import { useEffect, useState } from 'react'
import { BACKGROUND_SLOTS, normalizeHex, OBJECT_SLOTS, PaletteError, SLOT_COUNT, validatePalette } from '../lib/palette'
import { useCanvasStore } from '../store/canvas'
import { findPalette, usePalettesStore } from '../store/palettes'
import { useUiStore } from '../store/ui'

const PREVIEW_ID = 'preview'

/** Hex text that the slot table accepts, or null. */
const hexOf = (text: string) => (/^#?[0-9a-f]+$/i.test(text.trim()) ? normalizeHex(text) : null)

/**
 * A new palette from 8 hex fields. It starts from the composition's scheme; while every field holds
 * a color, the canvas shows the composition in the new palette.
 */
export function PaletteForm() {
  const close = () => useUiStore.getState().setPaletteForm(false)
  const [start] = useState(() => findPalette(usePalettesStore.getState(), useCanvasStore.getState().paletteId))
  const [name, setName] = useState('')
  const [background, setBackground] = useState(start.background)
  const [objects, setObjects] = useState(start.objects)
  const [error, setError] = useState<string | null>(null)

  // Live preview of the last complete set of colors; gone when the form closes.
  useEffect(() => {
    const bg = background.map(hexOf)
    const obj = objects.map(hexOf)
    if ([...bg, ...obj].every(Boolean)) {
      usePalettesStore.getState().setPreview({ id: PREVIEW_ID, name: name || 'Новая палитра', background: bg as string[], objects: obj as string[] })
    }
  }, [name, background, objects])
  useEffect(() => () => usePalettesStore.getState().setPreview(null), [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const palette = validatePalette({ name, background, objects })
      const saved = await usePalettesStore.getState().add(palette)
      useCanvasStore.getState().setPalette(saved.id)
      useUiStore.getState().showToast(`Палитра «${saved.name}» добавлена`)
      close()
    } catch (err) {
      setError(err instanceof PaletteError ? err.message : `Не удалось сохранить: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const fields = (label: string, slots: typeof BACKGROUND_SLOTS, values: string[], onChange: (v: string[]) => void) => (
    <fieldset className="palette-fields">
      <legend className="field-label">{label}</legend>
      {Array.from({ length: SLOT_COUNT }, (_, i) => {
        const hex = hexOf(values[i])
        return (
          <label key={slots[i]} className="palette-field">
            <span className="swatch swatch-big" style={{ background: hex ?? 'transparent' }} aria-hidden="true" />
            <span className="palette-slot">{slots[i]}</span>
            <input
              className="input"
              value={values[i]}
              maxLength={7}
              spellCheck={false}
              aria-label={`${label} ${i + 1}`}
              aria-invalid={!hex}
              onChange={(e) => {
                setError(null)
                onChange(values.map((v, j) => (j === i ? e.target.value : v)))
              }}
            />
          </label>
        )
      })}
    </fieldset>
  )

  return (
    <form className="palette-form" onSubmit={submit} aria-label="Новая палитра">
      <label className="field">
        <span className="field-label">Название</span>
        <input className="input" value={name} maxLength={40} placeholder="Например, Морская" onChange={(e) => {
            setError(null)
            setName(e.target.value)
          }}
        />
      </label>
      {fields('Цвет фона', BACKGROUND_SLOTS, background, setBackground)}
      {fields('Цвет объектов', OBJECT_SLOTS, objects, setObjects)}
      <p className="muted palette-note">
        Цвета фона — в объектах и фоне холста (bg1), цвета объектов — только в главных объектах. Холст сразу
        показывает композицию в новых цветах.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="palette-actions">
        <button className="btn" type="button" onClick={close}>
          Отмена
        </button>
        <button className="btn btn-primary" type="submit">
          Сохранить палитру
        </button>
      </div>
    </form>
  )
}
