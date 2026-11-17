import type { ChartType } from '../chart/chartTypes'

/** Small pictures of each chart style, drawn in the same 24x24 stroke style as Icons.tsx. */
export function ChartTypeIcon({ type }: { type: ChartType }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  switch (type) {
    case 'bars':
      return (
        <svg {...common}>
          <path d="M8 4v14M5 7h3M8 15h3M16 7v13M13 10h3M16 17h3" />
        </svg>
      )
    case 'hollow':
      return (
        <svg {...common}>
          <path d="M8 3v3M8 15v4M16 5v4M16 17v4" />
          <rect x="6" y="6" width="4" height="9" rx="1" />
          <rect x="14" y="9" width="4" height="8" rx="1" fill="currentColor" />
        </svg>
      )
    case 'heikinAshi':
      return (
        <svg {...common}>
          <path d="M7 5v3M7 15v3M12 3v3M12 13v3M17 6v3M17 14v3" />
          <rect x="5" y="8" width="4" height="7" rx="1" fill="currentColor" />
          <rect x="10" y="6" width="4" height="7" rx="1" fill="currentColor" />
          <rect x="15" y="9" width="4" height="5" rx="1" />
        </svg>
      )
    case 'line':
      return (
        <svg {...common}>
          <path d="m3 17 5-6 4 3 4-7 5 4" />
        </svg>
      )
    case 'area':
      return (
        <svg {...common}>
          <path d="m3 17 5-6 4 3 4-7 5 4" />
          <path d="M3 17 8 11l4 3 4-7 5 4v9H3z" fill="currentColor" opacity=".25" stroke="none" />
        </svg>
      )
    case 'baseline':
      return (
        <svg {...common}>
          <path d="M3 12h18" strokeDasharray="2 2" />
          <path d="m3 15 4-5 4 4 4-8 6 9" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <path d="M8 3v3M8 15v4M16 5v4M16 17v4" />
          <rect x="6" y="6" width="4" height="9" rx="1" fill="currentColor" />
          <rect x="14" y="9" width="4" height="8" rx="1" />
        </svg>
      )
  }
}
