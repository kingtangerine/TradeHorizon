import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function IconBase({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export function CursorIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m5 3 13.2 8.2-6 1.5-3.1 5.6L5 3Z" />
    </IconBase>
  )
}

export function TrendLineIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m4 17 6-7 4 3 6-8" />
      <circle cx="4" cy="17" r="1.7" />
      <circle cx="20" cy="5" r="1.7" />
    </IconBase>
  )
}

export function HorizontalLineIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <line x1="3" y1="12" x2="21" y2="12" strokeWidth="2" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
    </IconBase>
  )
}

export function RectangleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="4" y="6" width="16" height="12" rx="1" />
      <circle cx="4" cy="6" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="20" cy="18" r="1.25" fill="currentColor" stroke="none" />
    </IconBase>
  )
}

export function PriceRangeIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="2.5 2.5" />
      <line x1="12" y1="7" x2="12" y2="17" />
      <path d="m9.5 9 2.5-2.5 2.5 2.5M9.5 15l2.5 2.5 2.5-2.5" />
    </IconBase>
  )
}

export function LayersIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </IconBase>
  )
}

export function EyeIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </IconBase>
  )
}

export function EyeOffIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m3 3 18 18" />
      <path d="M10.6 6.1A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-2.1 2.8M6.2 6.3C3.8 8 2.5 12 2.5 12s3.5 6 9.5 6a9.4 9.4 0 0 0 3-.5" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </IconBase>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </IconBase>
  )
}

export function LockIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </IconBase>
  )
}

export function UnlockIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 7.7-1.5" />
    </IconBase>
  )
}

export function LongPositionIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 12h14M8 5h8M8 19h8" />
      <path d="M8 5v14M16 5v14" opacity=".55" />
      <path d="m12 9 3-3M15 6v3M12 15l-3 3M9 18v-3" />
    </IconBase>
  )
}

export function ShortPositionIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 12h14M8 5h8M8 19h8" />
      <path d="M8 5v14M16 5v14" opacity=".55" />
      <path d="m12 15 3 3M15 18v-3M12 9 9 6M9 6v3" />
    </IconBase>
  )
}

export function RayIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 18 21 5" />
      <circle cx="5" cy="18" r="1.7" />
      <circle cx="12.4" cy="12" r="1.7" />
    </IconBase>
  )
}

export function VerticalLineIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3v18" />
      <circle cx="12" cy="12" r="1.7" />
    </IconBase>
  )
}

export function FibIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 5h16M4 10h16M4 14h16M4 19h16" />
      <path d="m6 19 12-14" opacity=".55" />
    </IconBase>
  )
}

export function MagnetIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4H6Z" />
      <path d="M6 8h4M14 8h4" />
    </IconBase>
  )
}

export function CopyIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </IconBase>
  )
}

export function CandlesIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 3v3M8 15v4M16 5v4M16 17v4" />
      <rect x="6" y="6" width="4" height="9" rx="1" />
      <rect x="14" y="9" width="4" height="8" rx="1" />
    </IconBase>
  )
}

export function LineChartIcon(props: IconProps) {
  return <IconBase {...props}><path d="m3 17 5-6 4 3 4-7 5 4" /></IconBase>
}

export function ReplayIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m11 7-6 5 6 5V7Z" />
      <path d="m19 7-6 5 6 5V7Z" />
    </IconBase>
  )
}

export function PlayIcon(props: IconProps) {
  return <IconBase {...props}><path d="M8 5v14l11-7L8 5Z" /></IconBase>
}

export function PauseIcon(props: IconProps) {
  return <IconBase {...props}><path d="M8 5v14M16 5v14" /></IconBase>
}

export function StepForwardIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 5v14l9-7-9-7Z" />
      <path d="M18 5v14" />
    </IconBase>
  )
}

export function SettingsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </IconBase>
  )
}

export function StarIcon({ filled, ...props }: IconProps & { filled?: boolean }) {
  return (
    <IconBase {...props} fill={filled ? 'currentColor' : 'none'}>
      <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z" />
    </IconBase>
  )
}

export function MoreVerticalIcon(props: IconProps) {
  return (
    <IconBase {...props} fill="currentColor" stroke="none">
      <circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" />
    </IconBase>
  )
}

export function SortIcon(props: IconProps) {
  return <IconBase {...props}><path d="M7 20V5m0 0L3.5 8.5M7 5l3.5 3.5M13 7h8M13 12h6M13 17h4" /></IconBase>
}

export function SearchIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></IconBase>
}

export function PlusIcon(props: IconProps) {
  return <IconBase {...props}><path d="M12 5v14M5 12h14" /></IconBase>
}

export function BellIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </IconBase>
  )
}

export function UserIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </IconBase>
  )
}

export function UndoIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 7 5 11l4 4" />
      <path d="M5 11h8a6 6 0 0 1 6 6" />
    </IconBase>
  )
}

export function RedoIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m15 7 4 4-4 4" />
      <path d="M19 11h-8a6 6 0 0 0-6 6" />
    </IconBase>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7" />
      <path d="M10 11v5M14 11v5" />
    </IconBase>
  )
}

export function TargetIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </IconBase>
  )
}

export function RefreshIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M20 7v5h-5" />
      <path d="M18.5 16a8 8 0 1 1 .8-7.5L20 12" />
    </IconBase>
  )
}

export function HorizonLogo() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 34 34" fill="none">
        <path d="M7 23.5 13.5 17l4.5 4 9-10" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M22 11h5v5" stroke="#f4b860" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

export function TextIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 6V4h14v2" />
      <path d="M12 4v16" />
      <path d="M9 20h6" />
    </IconBase>
  )
}

export function MidlineIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="4" y="5" width="16" height="14" rx="1" />
      <line x1="4" y1="12" x2="20" y2="12" strokeDasharray="3 2" />
    </IconBase>
  )
}

export function FolderIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </IconBase>
  )
}

export function ChevronIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m6 9 6 6 6-6" />
    </IconBase>
  )
}

export function TemplateIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z" />
    </IconBase>
  )
}
