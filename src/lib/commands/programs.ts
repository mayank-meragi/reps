import type { QueryClient } from '@tanstack/react-query'
import { AiError, generateJson } from '@/lib/llm'
import { PATHS } from '@/lib/paths'
import { fileQueryKey } from '@/lib/queryKeys'
import { getCachedFile } from '@/lib/cache'
import { updateFile, loadFile } from '@/lib/sync'
import { listDir } from '@/lib/github'
import { effectiveTodayISO, monthKey } from '@/lib/dates'
import { instantiateDay } from '@/lib/engine'
import { runToolAgent } from '@/lib/agent/toolAgent'
import type {
  Exercise,
  Modality,
  Program,
  ProgramDay,
  ProgramsIndexFile,
  ProgressionScheme,
  Session,
  Venue,
  WeeklyTrainingTarget,
  ProgramAdjustment,
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

interface RawDay {
  name: string
  modality: string
  venueId?: string
  focus: string[]
  rationale: string
  exercises: { exerciseId: string; sets: number; repRangeLo: number; repRangeHi: number; targetRir?: number; restSeconds?: number; suggestedWeight?: number; loadGuidance?: string }[]
  cardio?: { durationMin?: number; distanceKm?: number; effort?: number; style?: string }
  considerations?: string
  availableMinutes?: number
  consideredSessionIds?: string[]
  contextSummary?: string[]
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

  for (const item of raw.exercises) {
    const exercise = item.exerciseId ? byId.get(item.exerciseId) : undefined
    if (!exercise || !Number.isFinite(item.sets) || item.sets! <= 0) continue
    const equipmentOk = !venue || !exercise.equipment || exercise.equipment === 'body only' || venue.equipment.includes(exercise.equipment)
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
      loadValue: Number.isFinite(item.suggestedWeight) && item.suggestedWeight! > 0 ? Math.round(item.suggestedWeight! * 2) / 2 : undefined,
      notes: item.loadGuidance?.trim() || undefined,
    })
  }
  if (day.exercises.length === 0) throw new AiError('The AI returned no usable exercises for the selected venue')
  return day
}

export const createTodayPrescriptionCommand = defineCommand<RawDay, Session>({
  name: 'program.create_prescription',
  title: "Create today's prescription",
  description: 'Persist a fully specified workout prescription after inspecting the plan, profile, venues, readiness, history, insights, and exercise catalog. For resistance work, use only exact IDs returned by exercise.search. Include a conservative suggestedWeight for every externally loaded exercise; use 0 for bodyweight. Existing performance history will override the estimate when progression has stronger evidence.',
  kind: 'write',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      modality: { type: 'string', enum: MODALITIES },
      venueId: { type: 'string' },
      focus: { type: 'array', items: { type: 'string' } },
      rationale: { type: 'string' },
      considerations: { type: 'string' },
      availableMinutes: { type: 'number' },
      consideredSessionIds: { type: 'array', items: { type: 'string' } },
      contextSummary: { type: 'array', items: { type: 'string' } },
      exercises: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            exerciseId: { type: 'string' }, sets: { type: 'number' }, repRangeLo: { type: 'number' }, repRangeHi: { type: 'number' },
            targetRir: { type: 'number' }, restSeconds: { type: 'number' }, suggestedWeight: { type: 'number' }, loadGuidance: { type: 'string' },
          },
          required: ['exerciseId', 'sets', 'repRangeLo', 'repRangeHi', 'suggestedWeight'],
        },
      },
      cardio: {
        type: 'object',
        properties: { durationMin: { type: 'number' }, distanceKm: { type: 'number' }, effort: { type: 'number' }, style: { type: 'string', enum: ['steady', 'intervals', 'easy'] } },
      },
    },
    required: ['name', 'modality', 'focus', 'rationale', 'exercises'],
  },
  handler: async (args, ctx) => {
    const index = readIndex(ctx.qc)
    if (!index.activeId) throw new Error('No active plan — generate one first')
    const program = readProgram(ctx.qc, index.activeId)
    if (!program) throw new Error('Active plan not found')
    const venues = getVenues(ctx.qc)
    const exercises = await allExercises(ctx.qc)
    const today = effectiveTodayISO()
    const history = await allSessionsAcrossMonths(ctx.qc)
    const existing = history.find((session) => session.date === today && session.programId === program.id && session.prescription && !session.startedAt && !session.endedAt)
    const completed = history.filter((session) => session.endedAt && session.id !== existing?.id)
    const day = validatePrescription(args, exercises, venues, args.venueId)
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
      rationale: args.rationale.trim() || 'Adapted from your plan and recent activity.',
      prescription: {
        generatedAt: now,
        considerations: args.considerations?.trim() || undefined,
        rationale: args.rationale.trim() || 'Adapted from your plan and recent activity.',
        target: day.target,
        consideredSessionIds: (args.consideredSessionIds ?? []).filter((id) => completed.some((session) => session.id === id)),
        contextSummary: (args.contextSummary ?? []).filter(Boolean).slice(0, 8),
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

interface GenerateTodayArgs { considerations?: string; venueId?: string; availableMinutes?: number }

export const generateTodayCommand = defineCommand<GenerateTodayArgs, Session>({
  name: 'program.generate_today',
  title: "Generate today's session",
  description: 'Run the workout-planning agent. It inspects the active plan, profile, venues, readiness, history and insights; searches the exercise catalog itself; then creates a fully specified prescription with suggested loads.',
  // This command orchestrates reads. The final program.create_prescription
  // tool is the audited write.
  kind: 'read',
  parameters: {
    type: 'object',
    properties: { considerations: { type: 'string' }, venueId: { type: 'string' }, availableMinutes: { type: 'number' } },
  },
  handler: async (args, ctx) => {
    const index = readIndex(ctx.qc)
    if (!index.activeId) throw new Error('No active plan — generate one first')
    if (args.venueId && !getVenues(ctx.qc).some((venue) => venue.id === args.venueId)) throw new Error('Selected venue not found')
    const profile = getProfile(ctx.qc)
    const unit = profile?.units ?? 'kg'
    return runToolAgent<Session>({
      ctx,
      finalTool: 'program.create_prescription',
      allowedTools: [
        'profile.get', 'program.get', 'venue.list', 'exercise.facets', 'exercise.search', 'exercise.get',
        'session.list', 'body.get_readiness', 'body.get_metrics', 'insights.adherence', 'insights.modality_mix',
        'insights.volume_vs_landmarks', 'insights.stalled_exercises', 'insights.personal_records', 'insights.cardio_trend',
      ],
      system: `You are Reps' workout-planning agent. Decide the session by using tools, not by relying on a preselected exercise list.

Required workflow:
1. Read the active program and profile, venues, recent sessions, readiness, and relevant insights.
2. Honor explicit user considerations first when safe. Account for all completed activity today.
3. For resistance, mobility, or sport sessions, call exercise.facets when useful and exercise.search one or more times. Never invent an exercise id.
4. Finish only by calling program.create_prescription.

Use 2-6 exercises and 1-5 working sets when resistance work is appropriate. For every externally loaded exercise, provide a conservative suggestedWeight in ${unit}; use recent logged loads when available. Use 0 for bodyweight. For dumbbells or kettlebells the value is per implement; for barbells, machines, and cables it is total displayed load, and explain this briefly in loadGuidance. The progression engine will override estimates when history provides a stronger target.

For cardio, provide cardio and an empty exercises array. Include concise contextSummary evidence and the IDs of sessions actually considered. Respect injuries, venue equipment, recovery, time, and the active plan.`,
      user: `Prepare today's session (${effectiveTodayISO()}).
User considerations: ${args.considerations?.trim() || '(none)'}
Available minutes: ${args.availableMinutes ?? profile?.sessionMinutes ?? '(not specified)'}
${args.venueId ? `Required venueId: ${args.venueId}. Use this exact venue.` : 'No venue was forced; choose a saved compatible venue or omit venueId.'}`,
    })
  },
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

interface ApplyProgramAdjustmentArgs {
  programId?: string
  adjustment: ProgramAdjustment
}

export const applyProgramAdjustmentCommand = defineCommand<ApplyProgramAdjustmentArgs, { program: Program; previous: Program }>({
  name: 'program.apply_adjustment',
  title: 'Apply coaching adjustment to plan',
  description:
    'Apply an AI-proposed weekly coaching adjustment to the active adaptive plan. Use only after reviewing evidence and explaining the rationale; changes the strategy, not completed workouts.',
  kind: 'write',
  parameters: {
    type: 'object',
    properties: {
      programId: { type: 'string' },
      adjustment: {
        type: 'object',
        properties: {
          theme: { type: 'string' },
          priorities: { type: 'array', items: { type: 'string' } },
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
          progressionGuidance: { type: 'string' },
          recoveryGuidance: { type: 'string' },
          daysPerWeek: { type: 'number' },
          rationale: { type: 'string' },
        },
        required: ['rationale'],
      },
    },
    required: ['adjustment'],
  },
  handler: (args, ctx) => {
    const id = args.programId ?? readIndex(ctx.qc).activeId
    if (!id) throw new Error('No active plan to adjust')
    const previous = readProgram(ctx.qc, id)
    if (!previous) throw new Error(`Plan ${id} not found`)
    const adjustment = args.adjustment
    const nextTargets = adjustment.weeklyTargets === undefined
      ? previous.weeklyTargets
      : weeklyTargets(adjustment.weeklyTargets, adjustment.daysPerWeek ?? previous.daysPerWeek)
    const program: Program = {
      ...previous,
      theme: adjustment.theme?.trim() || previous.theme,
      priorities: adjustment.priorities?.filter(Boolean).slice(0, 6) ?? previous.priorities,
      weeklyTargets: nextTargets,
      progressionGuidance: adjustment.progressionGuidance?.trim() || previous.progressionGuidance,
      recoveryGuidance: adjustment.recoveryGuidance?.trim() || previous.recoveryGuidance,
      daysPerWeek: adjustment.daysPerWeek === undefined
        ? previous.daysPerWeek
        : Math.min(7, Math.max(1, Math.round(adjustment.daysPerWeek))),
      rationale: adjustment.rationale.trim() || previous.rationale,
    }
    writeProgram(ctx.qc, program)
    return { program, previous }
  },
  undo: (_args, result, ctx) => writeProgram(ctx.qc, result.previous),
  summarize: (_args, result) => `Adjusted adaptive plan "${result.program.name}"`,
})
