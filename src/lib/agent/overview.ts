import type { QueryClient } from '@tanstack/react-query'
import { getProfile } from '../commands/profile'
import { getVenues } from '../commands/venues'
import { readSessionsMonth } from '../commands/sessions'
import { getCoachMemory } from '../commands/memory'
import { currentMonthKey, effectiveTodayISO } from '../dates'
import { setSummary, completedSetCount, formatDuration } from '../sessionStats'

/** The AI's snapshot of app state — same underlying reads the UI uses, kept compact. */
export function buildOverview(qc: QueryClient): string {
  const profile = getProfile(qc)
  const venues = getVenues(qc)
  const today = effectiveTodayISO()
  const monthSessions = readSessionsMonth(qc, currentMonthKey())
  const todaySessions = monthSessions.filter((s) => s.date === today)
  const active = todaySessions.find((s) => !s.endedAt) ?? null
  const completedToday = todaySessions.filter((s) => s.endedAt)
  const recent = [...monthSessions].sort((a, b) => a.date.localeCompare(b.date)).slice(-5)

  const profileLine = profile
    ? `Goal ${profile.goal}, experience ${profile.experience}, ${profile.daysPerWeek} sessions/week intended, units ${profile.units}` +
      (profile.injuries ? `; injuries/limits: ${profile.injuries}` : '') +
      (profile.preferences ? `; preferences: ${profile.preferences}` : '')
    : 'Not set up yet — ask their goal, experience, and days/week, then call profile.update.'

  const venueLines =
    venues.length > 0
      ? venues
          .map(
            (v) =>
              `- ${v.id} — ${v.name} (${v.kind}): ${v.modalities.join(', ')}` +
              (v.equipment.length > 0 ? `; equipment: ${v.equipment.join(', ')}` : ''),
          )
          .join('\n')
      : '(none yet — ask where they train and call venue.add)'

  const activeLine = active
    ? (() => {
        const { done, total } = completedSetCount(active.exercises)
        return `In progress: "${active.name}" (${active.modality}${active.venueId ? `, at venue ${active.venueId}` : ''}), sessionId=${active.id}${total > 0 ? `, ${done}/${total} sets done` : ''}.`
      })()
    : 'No session in progress right now.'

  const completedLine =
    completedToday.length > 0 ? completedToday.map((s) => `- ${s.name} (${s.modality})`).join('\n') : '(none)'

  const recentLine =
    recent.length > 0
      ? recent
          .map((s) => {
            const detail =
              s.exercises.length > 0
                ? s.exercises.map((e) => `${e.name} ${setSummary(e.sets)}`).join('; ')
                : s.cardio
                  ? formatDuration(s.cardio.durationSec) + (s.cardio.distanceM ? `, ${(s.cardio.distanceM / 1000).toFixed(1)}km` : '')
                  : ''
            return `- ${s.date} "${s.name}" (${s.modality}): ${detail}`
          })
          .join('\n')
      : '(none yet this month)'

  const memory = getCoachMemory(qc).summary

  return `Today: ${today}.
Profile: ${profileLine}
Venues:
${venueLines}
${activeLine}
Finished today:
${completedLine}
Recent sessions this month:
${recentLine}
${memory ? `\nCoach notes:\n${memory}\n` : ''}`
}
