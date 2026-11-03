/** Shared formatting helpers for durations, dates and identity initials. */

/** `3:34` — used in track rows and the player. */
export function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** `42 min` / `1 hr 12 min` — used for playlist totals. */
export function formatTotalLength(totalSeconds: number): string {
  const totalMinutes = Math.max(0, Math.round(totalSeconds / 60))

  if (totalMinutes < 60) return `${totalMinutes} min`

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`
}

const relativeUnits: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['week', 60 * 60 * 24 * 7],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
]

/** `4 days ago` / `just now` for mock timestamps. */
export function formatRelativeTime(isoDate: string, now: Date = new Date()): string {
  const timestamp = new Date(isoDate).getTime()

  if (Number.isNaN(timestamp)) return 'unknown date'

  const differenceSeconds = Math.round((timestamp - now.getTime()) / 1000)
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

  for (const [unit, unitSeconds] of relativeUnits) {
    if (Math.abs(differenceSeconds) >= unitSeconds) {
      return formatter.format(Math.round(differenceSeconds / unitSeconds), unit)
    }
  }

  return 'just now'
}

/** `Ana Reyes` → `AR`, tolerant of punctuation and single-word names. */
export function initialsOf(displayName: string): string {
  const parts = displayName
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)

  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

  return initials || '?'
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}
