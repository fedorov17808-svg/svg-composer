/** A row of radio buttons, one of which is on. */
export function Segmented<T extends string>({ label, items, value, onChange }: { label: string; items: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
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
