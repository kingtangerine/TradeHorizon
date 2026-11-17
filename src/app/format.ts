/** Number with a fixed number of decimals and thousands separators (en-US); "—" when missing or not finite. */
export function formatPrice(value?: number, precision = 2): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(value)
}

/** Short number such as "1.5K" or "2.3M" (en-US); "—" when missing or not finite. */
export function formatCompact(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value)
}
