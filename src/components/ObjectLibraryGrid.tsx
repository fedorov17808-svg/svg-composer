import { useEffect, useMemo } from 'react'
import { componentSvg } from '../lib/extract'
import { COMPONENT_DRAG_TYPE, useCanvasStore } from '../store/canvas'
import { useLibraryStore } from '../store/library'
import { paintObject, useActivePalette } from '../store/palettes'
import {
  OBJECT_SIZES,
  OBJECT_STATES,
  STATE_LABELS,
  useObjectLibraryStore,
  versionId,
  type LibraryObject,
} from '../store/objectLibrary'

function Segmented<T extends string>({ label, items, value, onChange }: { label: string; items: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          role="radio"
          aria-checked={value === item.id}
          className={value === item.id ? 'segmented-item segmented-active' : 'segmented-item'}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

function ObjectTile({ object }: { object: LibraryObject }) {
  const size = useObjectLibraryStore((s) => s.size)
  const state = useObjectLibraryStore((s) => s.state)
  const id = versionId(object.id, size, state)
  const stored = useLibraryStore((s) => s.components.find((c) => c.id === id))
  // Previews in the composition's scheme, as the object will look when placed.
  const palette = useActivePalette()
  const component = stored && paintObject({}, stored, palette)
  // A data URL isolates each preview, so ids never clash with the canvas or other tiles.
  const src = useMemo(() => component && `data:image/svg+xml;charset=utf-8,${encodeURIComponent(componentSvg(component))}`, [component])
  if (!component) return null

  return (
    <li
      className="library-tile"
      draggable
      data-object={object.id}
      onDragStart={(e) => {
        e.dataTransfer.setData(COMPONENT_DRAG_TYPE, id)
        e.dataTransfer.effectAllowed = 'copy'
        const img = e.currentTarget.querySelector('img')
        if (img) e.dataTransfer.setDragImage(img, img.width / 2, img.height / 2)
      }}
    >
      <button
        className="library-preview"
        onClick={() => useCanvasStore.getState().add(stored!)}
        title={`${object.name}: добавить в центр холста или перетащить на холст`}
      >
        <img src={src} alt={object.name} draggable={false} />
      </button>
      <span className="library-name">{object.name}</span>
    </li>
  )
}

/** The objects of the library in the chosen size and state; a click or a drag puts one on the canvas. */
export function ObjectLibraryGrid() {
  const { status, error, objects, size, state, load, setSize, setState } = useObjectLibraryStore()

  useEffect(() => {
    void load()
  }, [load])

  if (status === 'error') {
    return (
      <p className="empty">
        Не удалось загрузить библиотеку объектов ({error}). Запустите <code>npm run import-library</code>.
      </p>
    )
  }
  if (status !== 'ready') return <p className="empty">Загрузка библиотеки объектов…</p>

  return (
    <>
      <div className="object-library-controls">
        <Segmented label="Размер" items={OBJECT_SIZES.map((id) => ({ id, label: `Размер ${id}` }))} value={size} onChange={setSize} />
        <Segmented label="Состояние" items={OBJECT_STATES.map((id) => ({ id, label: STATE_LABELS[id] }))} value={state} onChange={setState} />
      </div>
      <ul className="source-grid" aria-label="Объекты библиотеки">
        {objects.map((object) => (
          <ObjectTile key={object.id} object={object} />
        ))}
      </ul>
    </>
  )
}
