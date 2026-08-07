import type { QueryClient } from '@tanstack/react-query'
import { AiError, generateJson } from '@/lib/llm'
import { PATHS } from '@/lib/paths'
import { fileQueryKey } from '@/lib/queryKeys'
import { getCachedFile } from '@/lib/cache'
import { updateFile, loadFile } from '@/lib/sync'
import { listDir } from '@/lib/github'
import { effectiveTodayISO, monthKey } from '@/lib/dates'
import { fatigueByMuscle, instantiateDay } from '@/lib/engine'
import { weeklyAdherence } from '@/lib/insights/adherence'
import { modalityMixMinutes } from '@/lib/insights/modality'
import type {
  Exercise,
  Modality,
  Program,
  ProgramDay,
  ProgramsIndexFile,
  ProgressionScheme,
  Readiness,
  ReadinessFile,
  Session,
  Venue,
  WeeklyTrainingTarget,
} from '@/lib/types'
import { defineCommand } from './registry'
import { getProfile } from './profile'
import { getVenues } from './venues'
import { allExercises } from './exercises'
import { readSessionsMonth, writeSessionsMonth } from './sessions'

const emptyIndex: ProgramsIndexFile = { activeId: null, list: [] }
const MODALITIES: Modality[] = ['strength', 'walk', 'run', 'cycle', 'swim', 'hike', 'mobility', 'sport', 'other']
const CARDIO = new Set<Modality>(['walk', 'run', 'cycle', 'swim', 'hike'])
const MODALITY_SET = new Set<string>(MODALITIES)

function readIndex(qc: QueryClient): ProgramsIndexFile {
  return qc.getQueryData<ProgramsIndexFile>(fileQueryKey(PATHS.programsIndex)) ?? getCachedFile<ProgramsIndexFile>(PATHS.programsIndex)?.content ?? emptyIndex
}

function writeIndex(qc: QueryClient, mutate: (current: ProgramsIndexFile) => ProgramsIndexFile): ProgramsIndexFile {
  const next = updateFile<ProgramsIndexFile>(PATHS.programsIndex, emptyIndex, mutate)
  qc.setQueryData(fileQueryKey(PATHS.programsIndex), next)
  return next
}

function readProgram(qc: QueryClient, id: string): Program | null {
  return qc.getQueryData<Program>(fileQueryKey(PATHS.program(id))) ?? getCachedFile<Program>(PATHS.program(id))?.content ?? null
}

function writeProgram(qc: QueryClient, program: Program): void {
  const next = updateFile<Program>(PATHS.program(program.id), program, () => program)
  qc.setQueryData(fileQueryKey(PATHS.program(program.id)), next)
}

async function allSessionsAcrossMonths(qc: QueryClient): Promise<Session[]> {
  const byId = new Map<string, Session>()
  try {
    const files = await listDir(PATHS.sessionsDir)
    const months = files.map((f) => f.name.replace(/\.json$/, '')).filter((n) => /^\d{4}-\d{2}$/.test(n))
    for (const month of months) for (const session of await loadFile<Session[]>(PATHS.sessions(month), [])) byId.set(session.id, session)
  } catch {
    // Local-first generation still works before the data repository has a sessions directory.
  }
  for (const session of readSessionsMonth(qc, monthKey(effectiveTodayISO()))) byId.set(session.id, session)
  return [...byId.values()].sort((a, b) => `${a.date}${a.createdAt}`.localeCompare(`${b.date}${b.createdAt}`))
}

function exerciseCandidates(exercises: Exercise[], venues: Venue[], selected?: Venue, limit = 120): Exercise[] {
  const equipment = new Set((selected ? selected.equipment : venues.flatMap((v) => v.equipment)))
  equipment.add('body only')
  const usable = exercises.filter((e) => !e.equipment || equipment.has(e.equipment))
  const rank = (e: Exercise) => (e.mechanic === 'compound' ? 0 : 2) + (e.level === 'beginner' ? 0 : e.level === 'intermediate' ? 1 : 3)
  return usable.sort((a, b) => rank(a) - rank(b)).slice(0, limit)
}

const STRATEGY_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    theme: { type: 'string', description: 'One concise description of the mesocycle theme' },
    rationale: { type: 'string' },
    priorities: { type: 'array', items: { type: 'string' } },
    progressionGuidance: { type: 'string' },
    recoveryGuidance: { type: 'string' },
    weeklyTargets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          modality: { type: 'string', enum: MODALITIES },
          sessions: { type: 'number' },
          intent: { type: 'string' },
        },
        required: ['modality', 'sessions', 'intent'],
      },
    },
  },
  required: ['name', 'theme', 'rationale', 'priorities', 'progressionGuidance', 'recoveryGuidance', 'weeklyTargets'],
}

interface RawStrategy {
  name?: string
  theme?: string
  rationale?: string
  priorities?: string[]
  progressionGuidance?: string
  recoveryGuidance?: string
  weeklyTargets?: { modality?: string; sessions?: number; intent?: string }[]
}

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    throw new AiError(`The AI returned an invalid ${label}`)
  }
}

function weeklyTargets(raw: RawStrategy['weeklyTargets'], fallback: number): WeeklyTrainingTarget[] {
  const valid = (raw ?? []).flatMap((target) => {
    if (!target.modality || !MODALITY_SET.has(target.modality) || !Number.isFinite(target.sessions) || (target.sessions ?? 0) <= 0) return []
    return [{ modality: target.modality as Modality, sessions: Math.min(7, Math.max(1, Math.round(target.sessions!))), intent: target.intent?.trim() || 'Build consistency' }]
  })
  return valid.length > 0 ? valid : [{ modality: 'strength', sessions: fallback, intent: 'Build toward the primary goal' }]
}

interface GenerateArgs { weeks?: number; daysPerWeek?: number; request?: string }

export const generateProgramCommand = defineCommand<GenerateArgs, Program>({
  name: 'program.generate',
  title: 'Generate training plan',
  description: 'Generate a multi-week strategy: theme, priorities, weekly modality targets, progression, and recovery rules. It intentionally does not pre-generate daily workouts; use program.generate_today for those.',
  kind: 'write',
  parameters: {
    type: 'object',
    properties: { weeks: { type: 'number', description: 'default 6' }, daysPerWeek: { type: 'number', description: 'weekly active-day target' }, request: { type: 'string' } },
  },
  handler: async (args, ctx) => {
    const profile = getProfile(ctx.qc)
    const venues = getVenues(ctx.qc)
    const weeks = Math.min(24, Math.max(1, Math.round(args.weeks ?? 6)))
    const daysPerWeek = Math.min(7, Math.max(1, Math.round(args.daysPerWeek ?? profile?.daysPerWeek ?? 3)))
    const prompt = `Create an adaptive ${weeks}-week training strategy with a target of ${daysPerWeek} active days per week.
Do NOT create workouts, exercises, or a calendar. Daily sessions will be prescribed later using actual activity, recovery, readiness, venue, time, weather, and user considerations.
${args.request ? `User request: ${args.request}` : ''}
Profile: goal=${profile?.goal ?? 'general-fitness'}, experience=${profile?.experience ?? 'beginner'}.
${profile?.injuries ? `Limitations: ${profile.injuries}` : ''}
${profile?.preferences ? `Preferences: ${profile.preferences}` : ''}
Available modalities by venue: ${venues.length > 0 ? venues.map((v) => `${v.name}: ${v.modalities.join(', ')}`).join('; ') : 'bodyweight/home, walking as practical'}.
Weekly targets are flexible targets, not fixed weekdays. Their session counts should approximately total ${daysPerWeek}. Explain how daily generation should progress successful work and adapt after missed targets, extra activity, soreness, or poor recovery.`

    const raw = parseJson<RawStrategy>(await generateJson({ text: prompt, schema: STRATEGY_SCHEMA, temperature: 0.35, maxOutputTokens: 1800 }), 'training strategy')
    const now = new Date().toISOString()
    const program: Program = {
      id: crypto.randomUUID(),
      name: raw.name?.trim() || 'Adaptive training plan',
      goal: profile?.goal ?? 'general-fitness',
      weeks,
      daysPerWeek,
      startDate: effectiveTodayISO(),
      status: 'active',
      progression: 'double-progression',
      theme: raw.theme?.trim() || 'Train consistently and adapt to recovery',
      weeklyTargets: weeklyTargets(raw.weeklyTargets, daysPerWeek),
      priorities: (raw.priorities ?? []).filter(Boolean).slice(0, 6),
      progressionGuidance: raw.progressionGuidance?.trim() || 'Progress when recent targets are completed with good form.',
      recoveryGuidance: raw.recoveryGuidance?.trim() || 'Adjust load and modality to recent activity and readiness.',
      rationale: raw.rationale?.trim() || '',
      generatedBy: 'ai',
      createdAt: now,
    }

    const previousActiveId = readIndex(ctx.qc).activeId
    if (previousActiveId) {
      const previous = readProgram(ctx.qc, previousActiveId)
      if (previous) writeProgram(ctx.qc, { ...previous, status: 'archived' })
    }
    writeProgram(ctx.qc, program)
    writeIndex(ctx.qc, (current) => ({
      activeId: program.id,
      list: [...current.list.map((p) => (p.id === current.activeId ? { ...p, status: 'archived' as const } : p)), { id: program.id, name: program.name, status: 'active', startDate: program.startDate }],
    }))
    return program
  },
  summarize: (_args, result) => `Generated adaptive plan "${result.name}"`,
})

function dailySchema(venues: Venue[], forcedVenueId?: string) {
  return {
    type: 'object',
    properties: {
      name: { type: 'string' },
      modality: { type: 'string', enum: MODALITIES },
      ...(!forcedVenueId && venues.length > 0 ? { venueId: { type: 'string', enum: venues.map((venue) => venue.id) } } : {}),
      focus: { type: 'array', items: { type: 'string' } },
      rationale: { type: 'string' },
      exercises: {
        type: 'array',
        items: {
          type: 'object',
          properties: { exerciseId: { type: 'string' }, sets: { type: 'number' }, repRangeLo: { type: 'number' }, repRangeHi: { type: 'number' }, targetRir: { type: 'number' }, restSeconds: { type: 'number' } },
          required: ['exerciseId', 'sets', 'repRangeLo', 'repRangeHi'],
        },
      },
      cardio: {
        type: 'object',
        properties: { durationMin: { type: 'number' }, distanceKm: { type: 'number' }, effort: { type: 'number' }, style: { type: 'string', enum: ['steady', 'intervals', 'easy'] } },
      },
    },
    // Cardio prescriptions return an empty list. Requiring the field prevents
    // a strength response from silently passing structured-output validation
    // without any exercises.
    required: ['name', 'modality', 'focus', 'rationale', 'exercises'],
  }
}

interface RawDay {
  name?: string
  modality?: string
  venueId?: string
  focus?: string[]
  rationale?: string
  exercises?: { exerciseId?: string; sets?: number; repRangeLo?: number; repRangeHi?: number; targetRir?: number; restSeconds?: number }[]
  cardio?: { durationMin?: number; distanceKm?: number; effort?: number; style?: string }
}

function validatePrescription(raw: RawDay, exercises: Exercise[], venues: Venue[], forcedVenueId?: string): ProgramDay {
  if (!raw.modality || !MODALITY_SET.has(raw.modality)) throw new AiError('The AI returned an invalid modality')
  const modality = raw.modality as Modality
  const venueId = forcedVenueId ?? raw.venueId
  const venue = venueId ? venues.find((v) => v.id === venueId) : undefined
  if (venueId && !venue) throw new AiError('The AI selected an unknown venue')
  if (venue && !venue.modalities.includes(modality)) throw new AiError(`${venue.name} does not support ${modality}`)
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const day: ProgramDay = { key: effectiveTodayISO(), name: raw.name?.trim() || 'Today', modality, venueId, focus: (raw.focus ?? []).filter(Boolean).slice(0, 4), exercises: [] }

  if (CARDIO.has(modality)) {
    if (!raw.cardio?.durationMin && !raw.cardio?.distanceKm) throw new AiError('The AI returned cardio without a duration or distance target')
    day.target = {
      durationMin: Number.isFinite(raw.cardio.durationMin) ? Math.max(5, Math.round(raw.cardio.durationMin!)) : undefined,
      distanceKm: Number.isFinite(raw.cardio.distanceKm) ? Math.max(0.1, raw.cardio.distanceKm!) : undefined,
      effort: Number.isFinite(raw.cardio.effort) ? Math.min(5, Math.max(1, Math.round(raw.cardio.effort!))) as 1 | 2 | 3 | 4 | 5 : undefined,
      style: raw.cardio.style === 'intervals' || raw.cardio.style === 'steady' ? raw.cardio.style : 'easy',
    }
    return day
  }

  if (!raw.exercises) throw new AiError(`The AI returned ${modality} without an exercises list`)

  for (const item of raw.exercises) {
    const exercise = item.exerciseId ? byId.get(item.exerciseId) : undefined
    if (!exercise || !Number.isFinite(item.sets) || item.sets! <= 0) continue
    const equipmentOk = !venue || venue.equipment.length === 0 || !exercise.equipment || exercise.equipment === 'body only' || venue.equipment.includes(exercise.equipment)
    if (!equipmentOk) continue
    const lo = Number.isFinite(item.repRangeLo) ? Math.max(1, Math.round(item.repRangeLo!)) : 8
    const hi = Number.isFinite(item.repRangeHi) ? Math.max(lo, Math.round(item.repRangeHi!)) : Math.max(12, lo)
    day.exercises.push({
      exerciseId: exercise.id,
      sets: Math.min(6, Math.max(1, Math.round(item.sets!))),
      repRange: [lo, hi],
      targetRir: Number.isFinite(item.targetRir) ? Math.min(5, Math.max(0, Math.round(item.targetRir!))) : 2,
      restSeconds: Number.isFinite(item.restSeconds) ? Math.min(300, Math.max(15, Math.round(item.restSeconds!))) : exercise.mechanic === 'compound' ? 120 : 75,
      loadRule: exercise.equipment === 'body only' || !exercise.equipment ? 'bodyweight' : 'last-session',
    })
  }
  if (day.exercises.length === 0) throw new AiError('The AI returned no usable exercises for the selected venue')
  return day
}

function recentSessionLine(session: Session): string {
  const strength = session.exercises.map((exercise) => {
    const done = exercise.sets.filter((set) => set.done)
    const misses = done.filter((set) => set.targetReps && (set.reps ?? 0) < set.targetReps).length
    return `${exercise.name}: ${done.length}/${exercise.sets.length} sets completed${misses ? `, ${misses} below target` : ''}`
  }).join('; ')
  const cardio = session.cardio ? `${Math.round(session.cardio.durationSec / 60)} min, effort ${session.cardio.effort ?? 'unknown'}` : ''
  return `${session.date} ${session.name} (${session.modality}): ${strength || cardio || 'no completed work'}`
}

async function latestReadiness(today: string): Promise<Readiness | undefined> {
  const file = await loadFile<ReadinessFile>(PATHS.readiness, { entries: [] })
  return [...file.entries].filter((entry) => entry.date <= today).sort((a, b) => b.date.localeCompare(a.date))[0]
}

interface GenerateTodayArgs { considerations?: string; venueId?: string; availableMinutes?: number }

export const generateTodayCommand = defineCommand<GenerateTodayArgs, Session>({
  name: 'program.generate_today',
  title: "Generate today's session",
  description: "Generate or revise today's unstarted prescription from the active strategy, completed sessions including extra activity today, recent performance, fatigue, readiness, adherence, venue, available time, and free-text considerations. Explicit requests such as 'just walk' or 'keep it light' take highest priority.",
  kind: 'write',
  parameters: {
    type: 'object',
    properties: { considerations: { type: 'string' }, venueId: { type: 'string' }, availableMinutes: { type: 'number' } },
  },
  handler: async (args, ctx) => {
    const index = readIndex(ctx.qc)
    if (!index.activeId) throw new Error('No active plan — generate one first')
    const program = readProgram(ctx.qc, index.activeId)
    if (!program) throw new Error('Active plan not found')
    const profile = getProfile(ctx.qc)
    const venues = getVenues(ctx.qc)
    const selectedVenue = args.venueId ? venues.find((v) => v.id === args.venueId) : undefined
    if (args.venueId && !selectedVenue) throw new Error('Selected venue not found')
    const exercises = await allExercises(ctx.qc)
    const candidates = exerciseCandidates(exercises, venues, selectedVenue)
    const today = effectiveTodayISO()
    const history = await allSessionsAcrossMonths(ctx.qc)
    const existing = history.find((session) => session.date === today && session.programId === program.id && session.prescription && !session.startedAt && !session.endedAt)
    const completed = history.filter((session) => session.endedAt && session.id !== existing?.id)
    const recent = completed.slice(-10)
    const readiness = await latestReadiness(today)
    const fatigue = fatigueByMuscle(completed, today, new Map(exercises.map((exercise) => [exercise.id, exercise])))
    const adherence = weeklyAdherence(completed, program.daysPerWeek, today)
    const mix = modalityMixMinutes(completed, today, 7)
    const todayActivity = completed.filter((session) => session.date === today)
    const contextSummary = [
      `${adherence.completedThisWeek}/${adherence.target} weekly sessions completed`,
      `7-day modality mix: ${mix.map((item) => `${item.modality} ${item.minutes}m`).join(', ') || 'none'}`,
      `today: ${todayActivity.map((session) => `${session.name} (${session.modality})`).join(', ') || 'no completed activity'}`,
      `fatigue: ${fatigue.filter((item) => item.status !== 'fresh').map((item) => `${item.muscle} ${item.status}`).join(', ') || 'no recently loaded muscles'}`,
    ]
    const venueLines = venues.length > 0 ? venues.map((v) => `${v.id} | ${v.name} | modalities=${v.modalities.join(',')} | equipment=${v.equipment.join(',') || 'none'}`).join('\n') : '(none configured: use bodyweight only and omit venueId)'
    const prompt = `Prescribe one session for today. This is an adaptive recommendation, not a fixed calendar day.

Priority order:
1. Honor the user's explicit one-time considerations literally when safe. "Just walk" means prescribe a walk only. "Keep it light" means low effort/volume.
2. Respect injuries, readiness, selected venue, and available time.
3. Account for ALL completed activity today, including extra walks/cardio, before prescribing more work.
4. Adapt to recent success, missed targets, muscle recovery, and weekly progress.
5. Serve the overall plan without forcing a session when recovery or the user's request calls for something lighter.

Plan: ${program.name}
Theme: ${program.theme}
Goal: ${program.goal}; progression: ${program.progression}
Weekly targets: ${program.weeklyTargets.map((target) => `${target.sessions}x ${target.modality} (${target.intent})`).join('; ')}
Priorities: ${program.priorities.join('; ')}
Progression guidance: ${program.progressionGuidance}
Recovery guidance: ${program.recoveryGuidance}
User considerations: ${args.considerations?.trim() || '(none)'}
Available minutes: ${args.availableMinutes ?? profile?.sessionMinutes ?? '(not specified)'}
Forced venue: ${selectedVenue ? `${selectedVenue.id} (${selectedVenue.name})` : '(none)'}
Profile: ${profile?.experience ?? 'beginner'}, ${profile?.goal ?? 'general-fitness'}${profile?.injuries ? `; limitations=${profile.injuries}` : ''}${profile?.preferences ? `; preferences=${profile.preferences}` : ''}
Latest readiness: ${readiness ? JSON.stringify(readiness) : '(none logged)'}
Adaptive context: ${contextSummary.join(' | ')}
Recent completed sessions:
${recent.map(recentSessionLine).join('\n') || '(none)'}
Venues:
${venueLines}

${selectedVenue ? 'The venue is already fixed by the app. Do not return venueId.' : 'If choosing a venue, copy one exact venueId from the Venues list. Never explain or modify the ID.'}
For walk/run/cycle/swim/hike, populate cardio and return exercises as an empty array. For strength/mobility/sport/other, exercises is REQUIRED and must contain 2-6 entries; omit cardio. Use 1-5 sets as appropriate to the available time and recovery. Use only these exact exerciseId values:
${candidates.map((exercise) => `${exercise.id} | ${exercise.name} | ${exercise.primaryMuscles.join('/')} | ${exercise.equipment ?? 'body only'} | ${exercise.mechanic ?? 'compound'}`).join('\n')}`

    const raw = parseJson<RawDay>(await generateJson({ text: prompt, schema: dailySchema(venues, args.venueId), temperature: 0.25, maxOutputTokens: 2200 }), 'daily prescription')
    const day = validatePrescription(raw, exercises, venues, args.venueId)
    const venue = day.venueId ? venues.find((item) => item.id === day.venueId) : undefined
    const instantiated = instantiateDay({ day, history: completed, scheme: program.progression as ProgressionScheme, exercisesById: new Map(exercises.map((exercise) => [exercise.id, exercise])), venue })
    const now = new Date().toISOString()
    const session: Session = {
      id: existing?.id ?? crypto.randomUUID(),
      date: today,
      modality: day.modality,
      venueId: day.venueId,
      programId: program.id,
      name: day.name,
      focus: day.focus,
      source: 'program',
      exercises: instantiated.exercises,
      rationale: raw.rationale?.trim() || 'Adapted from your plan and recent activity.',
      prescription: {
        generatedAt: now,
        considerations: args.considerations?.trim() || undefined,
        rationale: raw.rationale?.trim() || 'Adapted from your plan and recent activity.',
        target: day.target,
        consideredSessionIds: recent.map((session) => session.id),
        contextSummary,
        availableMinutes: args.availableMinutes,
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    writeSessionsMonth(ctx.qc, monthKey(today), (current) => existing ? current.map((item) => item.id === existing.id ? session : item) : [...current, session])
    return session
  },
  summarize: (_args, result) => `Prepared "${result.name}" for today`,
})

export const listProgramsCommand = defineCommand<Record<string, never>, ProgramsIndexFile['list']>({
  name: 'program.list', title: 'List plans', description: 'List saved adaptive plans.', kind: 'read', parameters: { type: 'object', properties: {} }, handler: (_args, ctx) => readIndex(ctx.qc).list,
})

export const getProgramCommand = defineCommand<{ id?: string }, Program | null>({
  name: 'program.get', title: 'Get plan details', description: 'Get an adaptive plan: theme, targets, priorities, and progression/recovery guidance. Omit id for the active plan.', kind: 'read', parameters: { type: 'object', properties: { id: { type: 'string' } } }, handler: (args, ctx) => { const id = args.id ?? readIndex(ctx.qc).activeId; return id ? readProgram(ctx.qc, id) : null },
})

export const setActiveProgramCommand = defineCommand<{ id: string }, ProgramsIndexFile>({
  name: 'program.set_active', title: 'Set active plan', description: 'Make a saved adaptive plan active.', kind: 'write', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, handler: (args, ctx) => writeIndex(ctx.qc, (current) => ({ activeId: args.id, list: current.list.map((p) => ({ ...p, status: p.id === args.id ? 'active' : p.status === 'active' ? 'archived' : p.status })) })), summarize: () => 'Changed active plan',
})

export const archiveProgramCommand = defineCommand<{ id: string }, ProgramsIndexFile>({
  name: 'program.archive', title: 'Archive plan', description: 'Archive a plan so it is no longer used for daily prescriptions.', kind: 'write', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, handler: (args, ctx) => writeIndex(ctx.qc, (current) => ({ activeId: current.activeId === args.id ? null : current.activeId, list: current.list.map((p) => p.id === args.id ? { ...p, status: 'archived' as const } : p) })), summarize: () => 'Archived plan',
})
