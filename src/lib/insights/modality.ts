import { daysBetween } from '@/lib/dates'
import type { Modality, Session } from '@/lib/types'

export interface ModalityMinutes {
  modality: Modality
  minutes: number
}

function sessionsInWindow(sessions: Session[], today: string, days: number): Session[] {
  return sessions.filter((s) => {
    const d = daysBetween(s.date, today)
    return d >= 0 && d < days && s.endedAt
  })
}

/** Minutes trained per modality in the trailing window — the "not just lifting" picture. */
export function modalityMixMinutes(sessions: Session[], today: string, days = 7): ModalityMinutes[] {
  const acc = new Map<Modality, number>()
  for (const s of sessionsInWindow(sessions, today, days)) {
    let minutes = 0
    if (s.cardio) minutes = s.cardio.durationSec / 60
    else if (s.startedAt && s.endedAt) minutes = (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 60000
    if (minutes > 0) acc.set(s.modality, (acc.get(s.modality) ?? 0) + minutes)
  }
  return [...acc.entries()]
    .map(([modality, minutes]) => ({ modality, minutes: Math.round(minutes) }))
    .sort((a, b) => b.minutes - a.minutes)
}

export function activeDays(sessions: Session[], today: string, days = 7): number {
  return new Set(sessionsInWindow(sessions, today, days).map((s) => s.date)).size
}
