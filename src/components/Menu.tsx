import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  /** Shortcut shown on the right, e.g. "⌘E". */
  hint?: string
}

/** A list of items; a string starts a titled section. */
export type MenuEntry = MenuItem | string

const items = (menu: HTMLElement) => [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]

/** A button with a dropdown list. Closes on a pick, Esc, or a click outside; ↑/↓ move between items. */
export function Menu({ label, entries, primary, title }: { label: ReactNode; entries: MenuEntry[]; primary?: boolean; title?: string }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    items(menuRef.current!)[0]?.focus()
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current!.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
      buttonRef.current!.focus()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const list = items(menuRef.current!)
      const index = list.indexOf(document.activeElement as HTMLButtonElement)
      const step = e.key === 'ArrowDown' ? 1 : -1
      list[(index + step + list.length) % list.length]?.focus()
    } else if (e.key === 'Tab') setOpen(false)
  }

  return (
    <div className="menu" ref={rootRef}>
      <button
        ref={buttonRef}
        className={primary ? 'btn btn-primary' : 'btn'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        title={title}
        onClick={() => setOpen(!open)}
      >
        {label} <span className="menu-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="menu-list" role="menu" id={id} ref={menuRef} onKeyDown={onKeyDown}>
          {entries.map((entry, i) =>
            typeof entry === 'string' ? (
              <div key={i} className="menu-section" role="presentation">
                {entry}
              </div>
            ) : (
              <button
                key={i}
                role="menuitem"
                className="menu-item"
                disabled={entry.disabled}
                onClick={() => {
                  setOpen(false)
                  buttonRef.current!.focus()
                  entry.onSelect()
                }}
              >
                <span>{entry.label}</span>
                {entry.hint && <kbd className="menu-hint">{entry.hint}</kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
