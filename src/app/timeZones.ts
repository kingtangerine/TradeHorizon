// Time zones for the chart. "auto" follows the computer's own zone, which is what TradingView users expect.
import { zoneOffsetMinutes } from '../chart/timeAxis'

/** Time zone preference meaning "use the computer's own zone". */
export const AUTO_TIME_ZONE = 'auto'

/** Common trading time zones (IANA names), west to east. */
export const TIME_ZONES: ReadonlyArray<{ readonly zone: string; readonly city: string }> = [
  { zone: 'Pacific/Honolulu', city: 'Honolulu' },
  { zone: 'America/Anchorage', city: 'Anchorage' },
  { zone: 'America/Los_Angeles', city: 'Los Angeles' },
  { zone: 'America/Denver', city: 'Denver' },
  { zone: 'America/Phoenix', city: 'Phoenix' },
  { zone: 'America/Chicago', city: 'Chicago' },
  { zone: 'America/Mexico_City', city: 'Mexico City' },
  { zone: 'America/New_York', city: 'New York' },
  { zone: 'America/Toronto', city: 'Toronto' },
  { zone: 'America/Bogota', city: 'Bogotá' },
  { zone: 'America/Caracas', city: 'Caracas' },
  { zone: 'America/Sao_Paulo', city: 'São Paulo' },
  { zone: 'America/Argentina/Buenos_Aires', city: 'Buenos Aires' },
  { zone: 'Atlantic/Reykjavik', city: 'Reykjavík' },
  { zone: 'UTC', city: 'UTC' },
  { zone: 'Europe/London', city: 'London' },
  { zone: 'Europe/Lisbon', city: 'Lisbon' },
  { zone: 'Africa/Lagos', city: 'Lagos' },
  { zone: 'Europe/Berlin', city: 'Berlin' },
  { zone: 'Europe/Paris', city: 'Paris' },
  { zone: 'Europe/Madrid', city: 'Madrid' },
  { zone: 'Europe/Rome', city: 'Rome' },
  { zone: 'Europe/Zurich', city: 'Zurich' },
  { zone: 'Africa/Cairo', city: 'Cairo' },
  { zone: 'Europe/Athens', city: 'Athens' },
  { zone: 'Africa/Johannesburg', city: 'Johannesburg' },
  { zone: 'Europe/Istanbul', city: 'Istanbul' },
  { zone: 'Europe/Moscow', city: 'Moscow' },
  { zone: 'Asia/Riyadh', city: 'Riyadh' },
  { zone: 'Asia/Baghdad', city: 'Baghdad' },
  { zone: 'Asia/Tehran', city: 'Tehran' },
  { zone: 'Asia/Dubai', city: 'Dubai' },
  { zone: 'Asia/Kabul', city: 'Kabul' },
  { zone: 'Asia/Karachi', city: 'Karachi' },
  { zone: 'Asia/Kolkata', city: 'Kolkata' },
  { zone: 'Asia/Kathmandu', city: 'Kathmandu' },
  { zone: 'Asia/Dhaka', city: 'Dhaka' },
  { zone: 'Asia/Bangkok', city: 'Bangkok' },
  { zone: 'Asia/Jakarta', city: 'Jakarta' },
  { zone: 'Asia/Singapore', city: 'Singapore' },
  { zone: 'Asia/Hong_Kong', city: 'Hong Kong' },
  { zone: 'Asia/Shanghai', city: 'Shanghai' },
  { zone: 'Asia/Taipei', city: 'Taipei' },
  { zone: 'Asia/Seoul', city: 'Seoul' },
  { zone: 'Asia/Tokyo', city: 'Tokyo' },
  { zone: 'Australia/Brisbane', city: 'Brisbane' },
  { zone: 'Australia/Sydney', city: 'Sydney' },
  { zone: 'Pacific/Auckland', city: 'Auckland' },
]

/** The computer's own zone, falling back to UTC where the browser cannot tell. */
export function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return zone && isValidTimeZone(zone) ? zone : 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Whether the browser accepts the name as an IANA time zone. */
export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** The zone to draw the chart in for a saved preference ("auto" or an IANA name). */
export function resolveTimeZone(preference: string): string {
  if (preference !== AUTO_TIME_ZONE && isValidTimeZone(preference)) return preference
  return browserTimeZone()
}

/** "UTC+4", "UTC−5", "UTC+5:30", "UTC". */
export function offsetLabel(zone: string, now = Date.now()): string {
  const minutes = zoneOffsetMinutes(now, zone)
  if (minutes === 0) return 'UTC'
  const sign = minutes > 0 ? '+' : '−'
  const absolute = Math.abs(minutes)
  const hours = Math.floor(absolute / 60)
  const rest = absolute % 60
  return `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`
}

/** "(UTC+4) Dubai"; a zone not in the list shows its own name. */
export function timeZoneLabel(zone: string, now = Date.now()): string {
  const known = TIME_ZONES.find((item) => item.zone === zone)
  const city = known?.city ?? zone.split('/').pop()?.replace(/_/g, ' ') ?? zone
  return zone === 'UTC' ? 'UTC' : `(${offsetLabel(zone, now)}) ${city}`
}
