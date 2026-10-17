import { useState } from 'react'

interface NumberFieldProps {
  label: string
  value: number
  onCommit: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** Decimal places shown when the field is not being edited. */
  digits?: number
  /** Apply every valid keystroke and spinner step, not only on Enter/blur. */
  live?: boolean
  suffix?: string
}

const format = (value: number, digits: number) => String(+value.toFixed(digits))

export function NumberField({ label, value, onCommit, min, max, step = 1, digits = 1, live = false, suffix }: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)

  const parse = (text: string) => {
    const n = Number(text.replace(',', '.'))
    if (text.trim() === '' || !Number.isFinite(n)) return null
    return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))
  }

  const commit = () => {
    if (draft === null) return
    const n = parse(draft)
    if (n !== null && n !== value) onCommit(n)
    setDraft(null)
  }

  return (
    <label className="number-field">
      <span className="field-label">{label}</span>
      <span className="number-field-box">
        <input
          className="input"
          type="number"
          inputMode="decimal"
          aria-label={label}
          step={step}
          min={min}
          max={max}
          value={draft ?? format(value, digits)}
          onChange={(e) => {
            setDraft(e.target.value)
            const n = live ? parse(e.target.value) : null
            if (n !== null && n !== value) onCommit(n)
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            // Leaving the field hands arrows and space back to the canvas.
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') {
              setDraft(null)
              e.currentTarget.blur()
            }
          }}
        />
        {suffix && (
          <span className="number-field-suffix" aria-hidden="true">
            {suffix}
          </span>
        )}
      </span>
    </label>
  )
}
