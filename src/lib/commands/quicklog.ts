import { AiError, generateJson } from '@/lib/llm'
import { effectiveTodayISO, monthKey } from '@/lib/dates'
import type { CardioResult, Exercise, Modality, Session, SessionExercise, SetEntry } from '@/lib/types'
import { defineCommand } from './registry'
import { allExercises } from './exercises'
import { writeSessionsMonth } from './sessions'

const MODALITIES: Modality[] = ['strength', 'walk', 'run', 'cycle', 'swim', 'hike', 'mobility', 'sport', 'other']
const MODALITY_SET = new Set<string>(MODALITIES)

const QUICK_LOG_SCHEMA = {
  type: 'object',
  properties: {
    modality: { type: 'string', enum: MODALITIES },
    name: { type: 'string' },
    exercises: {
      type: 'array',
      description: 'strength/mobility work only — leave empty for a cardio-only log',
      items: {
        type: 'object',
        properties: {
          exercise: { type: 'string', description: 'exercise name as the user wrote it' },
          sets: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                reps: { type: 'number' },
                weight: { type: 'number', description: 'kg; omit if bodyweight' },
              },
            },
          },
        },
        required: ['exercise', 'sets'],
      },
    },
    cardio: {
      type: 'object',
      description: 'walk/run/cycle/swim/hike only — omit for strength logs',
      properties: {
        durationMin: { type: 'number' },
        distanceKm: { type: 'number' },
        effort: { type: 'number', description: '1 (easy) to 5 (max)' },
      },
    },
  },
  required: ['modality'],
}

interface RawQuickLog {
  modality?: string
  name?: string
  exercises?: { exercise?: string; sets?: { reps?: number; weight?: number }[] }[]
  cardio?: { durationMin?: number; distanceKm?: number; effort?: number }
}

const ALIASES: Record<string, string> = {
  run: 'running, treadmill',
  ran: 'running, treadmill',
  running: 'running, treadmill',
  treadmill: 'running, treadmill',
  cycling: 'bicycling',
  cycle: 'bicycling',
  bench: 'barbell bench press - medium grip',
  'bench press': 'barbell bench press - medium grip',
  squat: 'barbell squat',
  squats: 'barbell squat',
  deadlift: 'barbell deadlift',
  deadlifts: 'barbell deadlift',
  ohp: 'standing military press',
  'overhead press': 'standing military press',
  'pull up': 'pullups',
  'pull ups': 'pullups',
  pullup: 'pullups',
  'push up': 'pushups',
  'push ups': 'pushups',
  pushup: 'pushups',
}

/** Fuzzy-match a user-written exercise name against the library. */
function findExercise(name: string, exercises: Exercise[]): Exercise | undefined {
  const q = name.trim().toLowerCase()
  if (!q) return undefined
  const target = ALIASES[q] ?? q
  return (
    exercises.find((e) => e.name.toLowerCase() === target) ??
    exercises.find((e) => e.name.toLowerCase().startsWith(target)) ??
    exercises.find((e) => e.name.toLowerCase().includes(target))
  )
}

export const quickLogCommand = defineCommand<{ text: string }, Session>({
  name: 'quicklog.parse',
  title: 'Quick-log from freeform text',
  description:
    'Parse an informal log of something already done — "bench 3x8 60kg, squats 5x5 80", "walked 40 min in the park", "ran 5k in 28 min" — into a completed session, backdated to today. For anything logged after the fact, not for planning ahead.',
  kind: 'write',
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  handler: async (args, ctx) => {
    const exercises = await allExercises(ctx.qc)
    const text = await generateJson({
      system: `You parse informal fitness logs into structured data. "3x8 60" means 3 sets of 8 reps at
60kg. "3x8,8,6" means three sets with different reps. A bare weight applies to all sets. Weights
are kg unless stated. For cardio (walk/run/cycle/swim/hike), set modality accordingly and fill
"cardio" with durationMin (required) plus distanceKm/effort if mentioned — leave "exercises"
empty. For strength/mobility work, set modality to "strength" or "mobility" and fill
"exercises" — leave "cardio" empty.`,
      text: args.text,
      schema: QUICK_LOG_SCHEMA,
      temperature: 0,
      maxOutputTokens: 1024,
    })
    let raw: RawQuickLog
    try {
      raw = JSON.parse(text)
    } catch {
      throw new AiError('Could not parse that log')
    }

    const modality: Modality = raw.modality && MODALITY_SET.has(raw.modality) ? (raw.modality as Modality) : 'strength'
    const now = new Date().toISOString()
    const date = effectiveTodayISO()

    const sessionExercises: SessionExercise[] = []
    for (const item of raw.exercises ?? []) {
      if (!item.exercise || !Array.isArray(item.sets) || item.sets.length === 0) continue
      const match = findExercise(item.exercise, exercises)
      const sets: SetEntry[] = item.sets
        .filter((s) => Number.isFinite(s.reps) && (s.reps ?? 0) > 0)
        .map((s) => {
          const weight = Number.isFinite(s.weight) && (s.weight ?? 0) > 0 ? s.weight : undefined
          return { type: 'working' as const, reps: Math.round(s.reps!), weight, targetReps: Math.round(s.reps!), targetWeight: weight, done: true, at: now }
        })
      if (sets.length === 0) continue
      sessionExercises.push({
        exerciseId: match?.id ?? item.exercise.toLowerCase().replace(/\s+/g, '-'),
        name: match?.name ?? item.exercise,
        mode: 'reps',
        sets,
      })
    }

    let cardio: CardioResult | undefined
    if (raw.cardio?.durationMin && raw.cardio.durationMin > 0) {
      const durationSec = Math.round(raw.cardio.durationMin * 60)
      const distanceM = raw.cardio.distanceKm && raw.cardio.distanceKm > 0 ? raw.cardio.distanceKm * 1000 : undefined
      cardio = {
        durationSec,
        distanceM,
        effort: Number.isFinite(raw.cardio.effort) ? (Math.min(Math.max(Math.round(raw.cardio.effort!), 1), 5) as 1 | 2 | 3 | 4 | 5) : undefined,
        avgPaceSecPerKm: distanceM ? Math.round(durationSec / (distanceM / 1000)) : undefined,
      }
    }

    if (sessionExercises.length === 0 && !cardio) throw new AiError('Could not find anything loggable in that')

    const session: Session = {
      id: crypto.randomUUID(),
      date,
      modality,
      name: raw.name?.trim() || 'Logged session',
      focus: [],
      source: 'quick-log',
      startedAt: now,
      endedAt: now,
      exercises: sessionExercises,
      cardio,
      createdAt: now,
      updatedAt: now,
    }
    writeSessionsMonth(ctx.qc, monthKey(date), (current) => [...current, session])
    return session
  },
  undo: (_args, session, ctx) => {
    writeSessionsMonth(ctx.qc, monthKey(session.date), (current) => current.filter((s) => s.id !== session.id))
  },
  summarize: (_args, result) => `Logged "${result.name}"`,
})
