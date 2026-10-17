/** 16×16 line icons drawn with `currentColor`. */
function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export const UndoIcon = () => <Icon d="M5.5 3.5 2.5 6.5l3 3M2.5 6.5H10a3.5 3.5 0 0 1 0 7H7" />
export const RedoIcon = () => <Icon d="m10.5 3.5 3 3-3 3M13.5 6.5H6a3.5 3.5 0 0 0 0 7h3" />
export const DuplicateIcon = () => <Icon d="M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3" />
export const TrashIcon = () => <Icon d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4" />
export const FlipIcon = () => <Icon d="M8 1.5v13M6 4 2 12h4zM10 4l4 8h-4z" />
export const FrontIcon = () => <Icon d="M2.5 14.5h11M8 11.5v-10M4.5 5 8 1.5 11.5 5" />
export const ForwardIcon = () => <Icon d="M8 13.5v-10M4.5 7 8 3.5 11.5 7" />
export const BackwardIcon = () => <Icon d="M8 2.5v10M4.5 9 8 12.5 11.5 9" />
export const BackIcon = () => <Icon d="M2.5 1.5h11M8 4.5v10M4.5 11 8 14.5l3.5-3.5" />
export const EyeIcon = () => <Icon size={14} d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
export const EyeOffIcon = () => <Icon size={14} d="M2 2l12 12M6.6 3.7A6 6 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.8 2.3M4.3 4.9A11 11 0 0 0 1.5 8S4 12.5 8 12.5c1 0 2-.3 2.8-.8" />
export const LockIcon = () => <Icon size={14} d="M3.5 7.5h9v6h-9zM5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5" />
export const UnlockIcon = () => <Icon size={14} d="M3.5 7.5h9v6h-9zM5.5 7.5V5a2.5 2.5 0 0 1 4.9-.7" />
