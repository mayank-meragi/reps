/** "2026-07" for a Date or ISO date string */
export function monthKey(date: Date | string): string {
  const iso = typeof date === 'string' ? date : toISODate(date)
  return iso.slice(0, 7)
}

/** Local-timezone YYYY-MM-DD */
export function toISODate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function todayISO(): string {
  return toISODate(new Date())
}

/**
 * The HUMAN day, which ends when you sleep, not at midnight: 00:00–03:59
 * still belongs to yesterday. Training lives on this clock — a midnight gym
 * session after a late night still counts as "today's" workout.
 */
export function effectiveTodayISO(): string {
  const d = new Date()
  if (d.getHours() < 4) d.setDate(d.getDate() - 1)
  return toISODate(d)
}

export function currentMonthKey(): string {
  return monthKey(new Date())
}

/** ["2026-02", ..., "2026-07"] — last n months ending at the given month */
export function lastNMonthKeys(n: number, ending: string = currentMonthKey()): string[] {
  const [y, m] = ending.split('-').map(Number)
  const keys: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

/** "2026-07" → "Jul 2026" */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

/** Shift a month key by delta months: addMonths("2026-07", -1) → "2026-06" */
export function addMonths(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Whole days between two ISO dates (b - a), signed. */
export function daysBetween(a: string, b: string): number {
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / msPerDay)
}
