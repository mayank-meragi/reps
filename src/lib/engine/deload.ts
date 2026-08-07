import { daysBetween } from '@/lib/dates'
import { completedSetCount } from '@/lib/sessionStats'
import type { Program, Session } from '@/lib/types'

export interface DeloadSignal {
  due: boolean
  reason: string
}

/**
 * Two independent triggers: the program's own scheduled deload week, and an
 * adherence-drop signal (completion rate falling off a cliff week over week
 * suggests accumulated fatigue the schedule didn't anticipate).
 */
export function deloadDue(program: Program, programSessions: Session[], today: string): DeloadSignal {
  const weeksElapsed = Math.floor(daysBetween(program.startDate, today) / 7) + 1
  if (program.deloadWeek && weeksElapsed >= program.deloadWeek) {
    return { due: true, reason: `Week ${weeksElapsed} of "${program.name}" — a scheduled deload is due.` }
  }

  const inWindow = (lo: number, hi: number) =>
    programSessions.filter((s) => {
      const d = daysBetween(s.date, today)
      return d >= lo && d < hi
    })
  const completionRate = (list: Session[]): number | null => {
    const totals = list.reduce(
      (acc, s) => {
        const { done, total } = completedSetCount(s.exercises)
        return { done: acc.done + done, total: acc.total + total }
      },
      { done: 0, total: 0 },
    )
    return totals.total > 0 ? totals.done / totals.total : null
  }

  const recentRate = completionRate(inWindow(0, 7))
  const priorRate = completionRate(inWindow(7, 21))
  if (recentRate !== null && priorRate !== null && priorRate > 0.7 && recentRate < priorRate - 0.25) {
    return { due: true, reason: 'Completion rate dropped sharply over the last week — signs of accumulated fatigue.' }
  }
  return { due: false, reason: '' }
}
