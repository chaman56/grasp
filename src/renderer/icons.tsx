import type { ReactNode } from 'react'

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export const CheckIcon = () => <Icon size={12}><path d="M5 12.5l4.5 4.5L19 7.5" /></Icon>
export const FlagIcon = () => <Icon size={12}><path d="M5 21V4h11l-2 4 2 4H5" /></Icon>
export const RefreshIcon = () => <Icon><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></Icon>
export const GearIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Icon>
)
export const FolderIcon = () => <Icon><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Icon>
export const PlusIcon = () => <Icon><path d="M12 5v14M5 12h14" /></Icon>
export const MinusIcon = () => <Icon><path d="M5 12h14" /></Icon>
export const FitIcon = () => <Icon><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Icon>
export const ChevronIcon = () => <Icon size={14}><path d="M9 6l6 6-6 6" /></Icon>
export const CloseIcon = () => <Icon><path d="M6 6l12 12M18 6L6 18" /></Icon>
export const SparkIcon = () => <Icon size={14}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" /></Icon>
export const TrashIcon = () => <Icon size={14}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></Icon>

export function LensLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="14" cy="14" r="9.5" fill="none" stroke="#4C8DFF" strokeWidth="3.5" />
      <circle cx="14" cy="14" r="3.5" fill="#E6E8EB" />
      <path d="M21 21l6.5 6.5" stroke="#4C8DFF" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  )
}
