import { daysBetween } from '@/lib/dates'
import type { Session } from '@/lib/types'

function dateFromISO(iso: string): Date {
  return new Date(`${iso}T12:00:00`)
}

function isoFromDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Monday-based calendar week containing the supplied ISO date. */
export function weekStartISO(iso: string): string {
  const date = dateFromISO(iso)
  const mondayOffset = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - mondayOffset)
  return isoFromDate(date)
}

function addDays(iso: string, days: number): string {
  const date = dateFromISO(iso)
  date.setDate(date.getDate() + days)
  return isoFromDate(date)
}

/**
 * "Kept showing up" streak in days: consecutive completed-session dates
 * walking back from the most recent, allowing up to 2 rest days between
 * them. Zero when the last session is more than 2 days ago.
 */
export function currentStreak(sessions: Session[], today: string): number {
  const dates = [...new Set(sessions.filter((s) => s.endedAt).map((s) => s.date))].sort().reverse()
  if (dates.length === 0 || daysBetween(dates[0], today) > 2) return 0
  let streak = 1
  for (let i = 1; i < dates.length; i++) {
    if (daysBetween(dates[i], dates[i - 1]) <= 3) streak++
    else break
  }
  return streak
}

export interface AdherenceStat {
  completedThisWeek: number
  target: number
  streak: number
}

export function weeklyAdherence(sessions: Session[], daysPerWeek: number, today: string): AdherenceStat {
  const start = weekStartISO(today)
  const completedThisWeek = new Set(sessions.filter((s) => s.endedAt && s.date >= start && s.date <= today).map((s) => s.id)).size
  return { completedThisWeek, target: daysPerWeek, streak: currentStreak(sessions, today) }
}

export interface WeeklyAdherencePoint {
  weekStart: string
  label: string
  planned: number
  completed: number
  percent: number
}

/** Planned target versus completed sessions for each Monday-based week. */
export function adherenceByWeek(sessions: Session[], daysPerWeek: number, today: string, weeks = 8): WeeklyAdherencePoint[] {
  const currentStart = weekStartISO(today)
  return Array.from({ length: weeks }, (_, index) => {
    const weekStart = addDays(currentStart, (index - weeks + 1) * 7)
    const weekEnd = addDays(weekStart, 6)
    const completed = sessions.filter((s) => s.endedAt && s.date >= weekStart && s.date <= weekEnd).length
    return {
      weekStart,
      label: weekStart.slice(5),
      planned: daysPerWeek,
      completed,
      percent: daysPerWeek > 0 ? Math.round((completed / daysPerWeek) * 100) : 0,
    }
  })
}
