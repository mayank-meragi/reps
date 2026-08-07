import { weekStartISO } from './adherence'
import type { Modality, Session } from '@/lib/types'

const CARDIO = new Set<Modality>(['walk', 'run', 'cycle', 'swim', 'hike'])

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00`)
  date.setDate(date.getDate() + days)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export interface CardioWeekPoint {
  weekStart: string
  label: string
  durationMin: number
  distanceKm: number
  sessions: number
}

/** Weekly cardio duration and distance across all cardio modalities. */
export function cardioWeeklyTrend(sessions: Session[], today: string, weeks = 8): CardioWeekPoint[] {
  const currentStart = weekStartISO(today)
  return Array.from({ length: weeks }, (_, index) => {
    const weekStart = addDays(currentStart, (index - weeks + 1) * 7)
    const weekEnd = addDays(weekStart, 6)
    const matches = sessions.filter((s) => s.endedAt && s.cardio && CARDIO.has(s.modality) && s.date >= weekStart && s.date <= weekEnd)
    return {
      weekStart,
      label: weekStart.slice(5),
      durationMin: Math.round(matches.reduce((sum, s) => sum + (s.cardio?.durationSec ?? 0), 0) / 60),
      distanceKm: Math.round((matches.reduce((sum, s) => sum + (s.cardio?.distanceM ?? 0), 0) / 1000) * 10) / 10,
      sessions: matches.length,
    }
  })
}

export interface PacePoint {
  date: string
  modality: Modality
  paceSecPerKm: number
  distanceKm: number
}

/** Pace history for distance-bearing cardio, optionally scoped to one modality. */
export function cardioPaceTrend(sessions: Session[], modality?: Modality): PacePoint[] {
  return sessions
    .filter((s) => s.endedAt && s.cardio?.distanceM && s.cardio.distanceM > 0 && (!modality || s.modality === modality))
    .map((s) => ({
      date: s.date,
      modality: s.modality,
      paceSecPerKm: s.cardio?.avgPaceSecPerKm ?? Math.round((s.cardio?.durationSec ?? 0) / ((s.cardio?.distanceM ?? 1) / 1000)),
      distanceKm: Math.round(((s.cardio?.distanceM ?? 0) / 1000) * 10) / 10,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
