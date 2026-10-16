import { useEffect } from 'react'
import { useUiStore } from '../store/ui'

export function Toast() {
  const toast = useUiStore((s) => s.toast)
  const hideToast = useUiStore((s) => s.hideToast)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(hideToast, 2000)
    return () => clearTimeout(timer)
  }, [toast, hideToast])

  if (!toast) return null
  return (
    <div className="toast" role="status" key={toast.id}>
      {toast.text}
    </div>
  )
}
