import { useEffect, useRef, type ReactNode } from 'react'

/** A modal `<dialog>`: focus stays inside, Esc and a click on the backdrop close it. */
export function Dialog({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)

  // No close() on cleanup: it fires `close`, and StrictMode's second mount would unmount the dialog.
  // Unmounting removes the element, which takes it out of the top layer.
  useEffect(() => {
    if (!ref.current!.open) ref.current!.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="dialog-title"
      onClose={onClose}
      // Canvas shortcuts listen on window and would cancel Esc (and delete objects) behind the dialog.
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="dialog-body">
        <header className="dialog-header">
          <h2 id="dialog-title" className="dialog-title">
            {title}
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>
        {children}
        {actions && <footer className="dialog-actions">{actions}</footer>}
      </div>
    </dialog>
  )
}
