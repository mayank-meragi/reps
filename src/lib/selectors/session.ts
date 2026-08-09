import { effectiveTodayISO } from '@/lib/dates'
import type { Session } from '@/lib/types'

/** The exact priority used by Home and the AI when choosing what comes next. */
export function selectNextSession(sessions: Session[], today = effectiveTodayISO()): Session | null {
  const open = sessions.filter((session) => !session.endedAt)
  const started = [...open]
    .filter((session) => session.startedAt)
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))[0]
  if (started) return started

  const upcoming = [...open]
    .filter((session) => session.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))[0]
  if (upcoming) return upcoming

  return [...open].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0] ?? null
}
