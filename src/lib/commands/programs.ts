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
  CoachingEvidence,
  CoachingReasonCode,
  ExerciseSelectionDecision,
  TodayStimulusAssessment,
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
const REASON_CODES: CoachingReasonCode[] = [
  'SAFETY_CONSTRAINT', 'USER_REQUEST', 'PROGRAM_CONTINUITY', 'WEEKLY_TARGET_GAP',
  'RECENT_MUSCLE_STIMULUS', 'RECOVERY_REDUCED', 'NORMAL_READINESS', 'VOLUME_BELOW_TARGET',
  'VOLUME_ABOVE_TARGET', 'EXERCISE_CONTINUITY', 'LOAD_PROGRESSION_AVAILABLE', 'TIME_CONSTRAINT',
  'VENUE_CONSTRAINT', 'PREFERENCE', 'MODALITY_CHANGED',
]
const REASON_CODE_SET = new Set<string>(REASON_CODES)

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
  assessment: TodayStimulusAssessment
  exerciseDecisions: ExerciseSelectionDecision[]
  modalityChangeReason?: string
}

const EVIDENCE_SCHEMA = {
  type: 'object',
  properties: {
    code: { type: 'string', enum: REASON_CODES },
    subject: { type: 'string' },
    detail: { type: 'string' },
  },
  required: ['code', 'detail'],
}

const ASSESSMENT_SCHEMA = {
  type: 'object',
  properties: {
    primaryAdaptation: { type: 'string' },
    modality: { type: 'string', enum: MODALITIES },
    preserveExistingIntent: { type: 'boolean' },
    muscleTargets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          muscle: { type: 'string' },
          stimulus: { type: 'string', enum: ['low', 'moderate', 'high'] },
        },
        required: ['muscle', 'stimulus'],
      },
    },
    systemicFatigue: { type: 'string', enum: ['low', 'moderate', 'high'] },
    availableMinutes: { type: 'number' },
    constraints: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
    evidence: { type: 'array', items: EVIDENCE_SCHEMA },
  },
  required: ['primaryAdaptation', 'modality', 'preserveExistingIntent', 'muscleTargets', 'systemicFatigue', 'constraints', 'rationale', 'evidence'],
}

export function validateTodayAssessment(raw: TodayStimulusAssessment): TodayStimulusAssessment {
  if (!raw.modality || !MODALITY_SET.has(raw.modality)) throw new AiError('The coach returned an invalid assessed modality')
  const evidence: CoachingEvidence[] = (raw.evidence ?? []).flatMap((item) => {
    if (!item.detail?.trim() || !REASON_CODE_SET.has(item.code)) return []
    return [{ code: item.code, subject: item.subject?.trim() || undefined, detail: item.detail.trim() }]
  }).slice(0, 12)
  if (evidence.length === 0) throw new AiError('The coach assessment did not cite usable evidence')
  return {
    primaryAdaptation: raw.primaryAdaptation?.trim() || 'general fitness',
    modality: raw.modality,
    preserveExistingIntent: Boolean(raw.preserveExistingIntent),
    muscleTargets: (raw.muscleTargets ?? [])
      .filter((item) => item.muscle?.trim() && ['low', 'moderate', 'high'].includes(item.stimulus))
      .slice(0, 8)
      .map((item) => ({ muscle: item.muscle.trim(), stimulus: item.stimulus })),
    systemicFatigue: ['low', 'moderate', 'high'].includes(raw.systemicFatigue) ? raw.systemicFatigue : 'moderate',
    availableMinutes: Number.isFinite(raw.availableMinutes) ? Math.max(5, Math.round(raw.availableMinutes!)) : undefined,
    constraints: (raw.constraints ?? []).filter(Boolean).map((item) => item.trim()).slice(0, 8),
    rationale: raw.rationale?.trim() || 'Continue the active training trajectory with the smallest appropriate adjustment.',
    evidence,
  }
}

export const assessTodayCommand = defineCommand<TodayStimulusAssessment, TodayStimulusAssessment>({
  name: 'program.assess_today',
  title: "Assess today's training stimulus",
  description: 'Finish the evidence-gathering phase of daily planning by recording the required adaptation, modality, muscle stimulus, fatigue, constraints, and coded evidence before any exercises are searched.',
  kind: 'read',
  parameters: ASSESSMENT_SCHEMA,
  handler: (args) => validateTodayAssessment(args),
})

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

  const seen = new Set<string>()
  for (const item of raw.exercises.slice(0, 8)) {
    const exercise = item.exerciseId ? byId.get(item.exerciseId) : undefined
    if (!exercise || !Number.isFinite(item.sets) || item.sets! <= 0) continue
    if (seen.has(exercise.id)) throw new AiError(`The AI returned duplicate exercise ${exercise.name}`)
    seen.add(exercise.id)
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
      assessment: ASSESSMENT_SCHEMA,
      exerciseDecisions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            exerciseId: { type: 'string' },
            purpose: { type: 'string' },
            continuity: { type: 'string', enum: ['continued', 'returning', 'new', 'substitution'] },
            replacesExerciseId: { type: 'string' },
            selectionRationale: { type: 'string' },
          },
          required: ['exerciseId', 'purpose', 'continuity', 'selectionRationale'],
        },
      },
      modalityChangeReason: { type: 'string' },
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
    required: ['name', 'modality', 'focus', 'rationale', 'assessment', 'exerciseDecisions', 'exercises'],
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
    const assessment = validateTodayAssessment(args.assessment)
    if (assessment.modality !== args.modality) throw new AiError('The prescription modality does not match the assessed stimulus')
    const day = validatePrescription(args, exercises, venues, args.venueId)
    const selectedIds = new Set(day.exercises.map((exercise) => exercise.exerciseId))
    const decisions = (args.exerciseDecisions ?? []).filter((decision) => selectedIds.has(decision.exerciseId))
    if (day.exercises.length > 0 && day.exercises.some((exercise) => !decisions.some((decision) => decision.exerciseId === exercise.exerciseId))) {
      throw new AiError('Every selected exercise needs a continuity and selection rationale')
    }
    const modalityChanged = Boolean(existing && existing.modality !== day.modality)
    if (modalityChanged && !args.modalityChangeReason?.trim()) throw new AiError('Changing an existing prescription modality requires a reason')
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
        availableMinutes: args.availableMinutes ?? assessment.availableMinutes,
        stimulusAssessment: assessment,
        reasonCodes: assessment.evidence,
        exerciseDecisions: decisions,
        modalityChanged,
        modalityChangeReason: args.modalityChangeReason?.trim() || undefined,
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
    const assessment = await runToolAgent<TodayStimulusAssessment>({
      ctx,
      finalTool: 'program.assess_today',
      allowedTools: [
        'profile.get', 'program.get', 'venue.list',
        'session.list', 'body.get_readiness', 'body.get_metrics', 'insights.adherence', 'insights.modality_mix',
        'insights.volume_vs_landmarks', 'insights.muscle_map', 'insights.exercise_progression',
        'insights.stalled_exercises', 'insights.personal_records', 'insights.cardio_trend',
      ],
      system: `You are Reps' evidence-led training coach. Decide the stimulus before choosing exercises. Exercise catalog tools are deliberately unavailable in this phase.

Decision hierarchy, highest priority first:
1. Safety and injury constraints.
2. The user's explicit request for today, when safe.
3. Active-program intent and continuity with any existing unstarted prescription.
4. Recovery and readiness.
5. Recent training stimulus, muscle frequency, volume, and fatigue.
6. The user's long-term goal.
7. Exercise progression and continuity.
8. Preferences and variety.

Make the smallest appropriate modification to the user's ongoing training trajectory. Preserve the intended stimulus whenever reasonably possible. Adjust volume, load, RIR, duration, or eventual exercise selection before changing modality. Treat readiness and wearable metrics as supporting evidence: react to meaningful deviations from the user's baseline combined with subjective feedback and recent performance, not one noisy value.

Read the active program, profile, venues, recent sessions, readiness, weekly volume, muscle recovery/load, and recent exercise progression. Account for every completed activity today. Decide the required adaptation and finish only with program.assess_today. Do not name or choose exercises.`,
      user: `Assess today's required training stimulus (${effectiveTodayISO()}).
User considerations: ${args.considerations?.trim() || '(none)'}
Available minutes: ${args.availableMinutes ?? profile?.sessionMinutes ?? '(not specified)'}
${args.venueId ? `Required venueId: ${args.venueId}. Use this exact venue.` : 'No venue was forced; choose a saved compatible venue or omit venueId.'}`,
    })

    return runToolAgent<Session>({
      ctx,
      finalTool: 'program.create_prescription',
      allowedTools: [
        'exercise.facets', 'exercise.search', 'exercise.get', 'insights.exercise_progression',
        'session.list', 'venue.list',
      ],
      system: `You are Reps' exercise-prescription coach. The training stimulus has already been decided from the program, history, recovery, and user context. Select the smallest set of exercises that delivers it; do not redesign the session.

Selection priorities: goal relevance, pain/injury safety, stimulus-to-fatigue ratio, exercise history, equipment, progression continuity, and preferences. Strongly prefer an exercise with recent usable history unless there is a concrete reason to replace it. Never change exercises merely for variety. Avoid redundant movements with substantially overlapping mechanics and muscles unless added volume is specifically warranted.

Most resistance sessions contain 3-7 exercises, but stimulus and available time take precedence; one exercise can be correct for a very short session. Most exercises use 2-4 working sets. Choose total volume from the assessed stimulus, recent volume, recovery, fatigue cost, and time. Do not try to fill an entire weekly volume deficit today.

For hypertrophy, most work should finish around 1-3 RIR. Isolation work may occasionally go closer to failure. Avoid 0 RIR on large compounds unless explicitly justified. Prefer rep progression within the range before load progression. Use recent completed weight, reps, and RIR. For every externally loaded exercise provide a conservative suggestedWeight in ${unit}; use 0 for bodyweight. Dumbbell/kettlebell values are per implement; barbell, machine, and cable values are total displayed load. The deterministic progression engine has final authority over reps and load.

Call exercise.search before using an ID and insights.exercise_progression for continuity evidence. For cardio, provide cardio and an empty exercises and exerciseDecisions array. Include session IDs actually considered. Finish only with program.create_prescription, copying the assessment exactly into assessment and explaining every selected exercise in exerciseDecisions.`,
      user: `Build today's prescription (${effectiveTodayISO()}) from this validated assessment:
${JSON.stringify(assessment)}

User considerations: ${args.considerations?.trim() || '(none)'}
Available minutes: ${args.availableMinutes ?? assessment.availableMinutes ?? profile?.sessionMinutes ?? '(not specified)'}
${args.venueId ? `Required venueId: ${args.venueId}. Use this exact venue.` : 'Choose a saved compatible venue or omit venueId.'}`,
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
