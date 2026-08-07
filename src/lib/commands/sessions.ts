import type { QueryClient } from '@tanstack/react-query'
import { PATHS } from '@/lib/paths'
import { fileQueryKey } from '@/lib/queryKeys'
import { getCachedFile } from '@/lib/cache'
import { updateFile, loadFile } from '@/lib/sync'
import { listDir } from '@/lib/github'
import { currentMonthKey, effectiveTodayISO, monthKey } from '@/lib/dates'
import { isTimedCategory } from '@/lib/exerciseDb'
import type { CardioResult, Modality, SetEntry, SetType, Session, SessionExercise } from '@/lib/types'
import { defineCommand } from './registry'
import { allExercises } from './exercises'

const emptySessions: Session[] = []

export function readSessionsMonth(qc: QueryClient, month: string): Session[] {
  return (
    qc.getQueryData<Session[]>(fileQueryKey(PATHS.sessions(month))) ??
    getCachedFile<Session[]>(PATHS.sessions(month))?.content ??
    emptySessions
  )
}

export function writeSessionsMonth(qc: QueryClient, month: string, mutate: (current: Session[]) => Session[]): Session[] {
  const next = updateFile<Session[]>(PATHS.sessions(month), emptySessions, mutate)
  qc.setQueryData(fileQueryKey(PATHS.sessions(month)), next)
  return next
}

async function locateSession(qc: QueryClient, sessionId: string): Promise<{ month: string; session: Session } | null> {
  const current = currentMonthKey()
  const hit = readSessionsMonth(qc, current).find((s) => s.id === sessionId)
  if (hit) return { month: current, session: hit }
  // Fallback for edits to older sessions (e.g. from History) — not on the hot path.
  const files = await listDir(PATHS.sessionsDir)
  for (const f of files) {
    const month = f.name.replace(/\.json$/, '')
    if (!/^\d{4}-\d{2}$/.test(month) || month === current) continue
    const list = await loadFile<Session[]>(PATHS.sessions(month), emptySessions)
    const found = list.find((s) => s.id === sessionId)
    if (found) return { month, session: found }
  }
  return null
}

async function mutateSession(qc: QueryClient, sessionId: string, mutate: (s: Session) => Session): Promise<Session> {
  const located = await locateSession(qc, sessionId)
  if (!located) throw new Error(`Session ${sessionId} not found`)
  let updated: Session | undefined
  writeSessionsMonth(qc, located.month, (current) =>
    current.map((s) => {
      if (s.id !== sessionId) return s
      updated = mutate({ ...s, updatedAt: new Date().toISOString() })
      return updated
    }),
  )
  if (!updated) throw new Error('Session mutation failed')
  return updated
}

function defaultSets(category: string): SetEntry[] {
  if (category === 'cardio') return [{ type: 'working', targetDurationSec: 600, done: false }]
  if (category === 'stretching') {
    return [
      { type: 'working', targetDurationSec: 30, done: false },
      { type: 'working', targetDurationSec: 30, done: false },
    ]
  }
  return [
    { type: 'working', targetReps: 10, done: false },
    { type: 'working', targetReps: 10, done: false },
    { type: 'working', targetReps: 10, done: false },
  ]
}

const MODALITIES: Modality[] = ['strength', 'walk', 'run', 'cycle', 'swim', 'hike', 'mobility', 'sport', 'other']
const DEFAULT_NAME: Record<Modality, string> = {
  strength: 'Workout',
  walk: 'Walk',
  run: 'Run',
  cycle: 'Ride',
  swim: 'Swim',
  hike: 'Hike',
  mobility: 'Mobility',
  sport: 'Session',
  other: 'Session',
}

// ---- session.start ----

interface StartArgs {
  modality: Modality
  venueId?: string
  name?: string
}

export const startSessionCommand = defineCommand<StartArgs, Session>({
  name: 'session.start',
  title: 'Start session',
  description:
    'Start a new training session for today: strength, or a cardio modality (walk/run/cycle/swim/hike), or mobility/sport/other. Call venue.list first to pick a valid venueId.',
  kind: 'write',
  parameters: {
    type: 'object',
    properties: {
      modality: { type: 'string', enum: MODALITIES },
      venueId: { type: 'string' },
      name: { type: 'string' },
    },
    required: ['modality'],
  },
  handler: (args, ctx) => {
    const now = new Date().toISOString()
    const date = effectiveTodayISO()
    const session: Session = {
      id: crypto.randomUUID(),
      date,
      modality: args.modality,
      venueId: args.venueId,
      name: args.name?.trim() || DEFAULT_NAME[args.modality],
      focus: [],
      source: 'manual',
      startedAt: now,
      exercises: [],
      createdAt: now,
      updatedAt: now,
    }
    writeSessionsMonth(ctx.qc, monthKey(date), (current) => [...current, session])
    return session
  },
  undo: (_args, session, ctx) => {
    writeSessionsMonth(ctx.qc, monthKey(session.date), (current) => current.filter((s) => s.id !== session.id))
  },
  summarize: (args) => `Started ${DEFAULT_NAME[args.modality].toLowerCase()}`,
})

// ---- session.add_exercise ----

interface AddExerciseArgs {
  sessionId: string
  exerciseId: string
}

export const addExerciseCommand = defineCommand<AddExerciseArgs, Session>({
  name: 'session.add_exercise',
  title: 'Add exercise to session',
  description:
    'Add an exercise (from exercise.search results) to an in-progress session, with sensible default sets — 3x10 for strength, or a single timed set for cardio/stretching.',
  kind: 'write',
  parameters: {
    type: 'object',
    properties: { sessionId: { type: 'string' }, exerciseId: { type: 'string' } },
    required: ['sessionId', 'exerciseId'],
  },
  handler: async (args, ctx) => {
    const library = await allExercises(ctx.qc)
    const exercise = library.find((e) => e.id === args.exerciseId)
    if (!exercise) throw new Error(`Unknown exercise: ${args.exerciseId}`)
    const entry: SessionExercise = {
      exerciseId: exercise.id,
      name: exercise.name,
      mode: isTimedCategory(exercise.category) ? 'duration' : 'reps',
      restSeconds: isTimedCategory(exercise.category) ? 30 : 90,
      sets: defaultSets(exercise.category),
    }
    return mutateSession(ctx.qc, args.sessionId, (s) => ({ ...s, exercises: [...s.exercises, entry] }))
  },
  undo: async (args, _result, ctx) => {
    await mutateSession(ctx.qc, args.sessionId, (s) => {
      const idx = [...s.exercises].reverse().findIndex((e) => e.exerciseId === args.exerciseId)
      if (idx === -1) return s
      const removeAt = s.exercises.length - 1 - idx
      return { ...s, exercises: s.exercises.filter((_, i) => i !== removeAt) }
    })
  },
  summarize: (_args, result) => `Added ${result.exercises[result.exercises.length - 1]?.name ?? 'exercise'}`,
})

// ---- session.remove_exercise ----

export const removeExerciseCommand = defineCommand<{ sessionId: string; exerciseId: string }, { session: Session; removed: SessionExercise | null }>({
  name: 'session.remove_exercise',
  title: 'Remove exercise from session',
  description: 'Remove an exercise (and its logged sets) from an in-progress session. The user is asked to confirm first.',
  kind: 'destructive',
  parameters: {
    type: 'object',
    properties: { sessionId: { type: 'string' }, exerciseId: { type: 'string' } },
    required: ['sessionId', 'exerciseId'],
  },
  handler: async (args, ctx) => {
    let removed: SessionExercise | null = null
    const session = await mutateSession(ctx.qc, args.sessionId, (s) => {
      const idx = s.exercises.findIndex((e) => e.exerciseId === args.exerciseId)
      if (idx === -1) return s
      removed = s.exercises[idx]
      return { ...s, exercises: s.exercises.filter((_, i) => i !== idx) }
    })
    return { session, removed }
  },
  undo: async (args, result, ctx) => {
    if (!result.removed) return
    await mutateSession(ctx.qc, args.sessionId, (s) => ({ ...s, exercises: [...s.exercises, result.removed!] }))
  },
  summarize: (_args, result) => (result.removed ? `Removed ${result.removed.name}` : 'Removed exercise'),
})

// ---- session.add_set ----

interface AddSetArgs {
  sessionId: string
  exerciseId: string
  set?: Partial<SetEntry>
}

export const addSetCommand = defineCommand<AddSetArgs, Session>({
  name: 'session.add_set',
  title: 'Add set',
  description: "Add another set to an exercise already in the session, copying the previous set's target as a starting point unless overridden.",
  kind: 'write',
  parameters: {
    type: 'object',
    properties: {
      sessionId: { type: 'string' },
      exerciseId: { type: 'string' },
      set: {
        type: 'object',
        properties: {
          targetReps: { type: 'number' },
          targetWeight: { type: 'number' },
          targetDurationSec: { type: 'number' },
        },
      },
    },
    required: ['sessionId', 'exerciseId'],
  },
  handler: (args, ctx) =>
    mutateSession(ctx.qc, args.sessionId, (s) => ({
      ...s,
      exercises: s.exercises.map((e) => {
        if (e.exerciseId !== args.exerciseId) return e
        const last = e.sets[e.sets.length - 1]
        const newSet: SetEntry = {
          type: 'working',
          done: false,
          targetReps: args.set?.targetReps ?? last?.targetReps,
          targetWeight: args.set?.targetWeight ?? last?.targetWeight,
          targetDurationSec: args.set?.targetDurationSec ?? last?.targetDurationSec,
        }
        return { ...e, sets: [...e.sets, newSet] }
      }),
    })),
  summarize: () => 'Added a set',
})

// ---- session.update_set ----

interface UpdateSetArgs {
  sessionId: string
  exerciseId: string
  setIndex: number
  patch: Partial<Pick<SetEntry, 'reps' | 'weight' | 'durationSec' | 'distanceM' | 'rir' | 'rpe' | 'done' | 'type'>>
}

export const updateSetCommand = defineCommand<UpdateSetArgs, Session>({
  name: 'session.update_set',
  title: 'Update set',
  description:
    'Update a logged set: mark it done (copies targets to actuals if actuals are blank), edit actual reps/weight/duration/distance, or record RIR/RPE.',
  kind: 'write',
  parameters: {
    type: 'object',
    properties: {
      sessionId: { type: 'string' },
      exerciseId: { type: 'string' },
      setIndex: { type: 'number' },
      patch: {
        type: 'object',
        properties: {
          reps: { type: 'number' },
          weight: { type: 'number' },
          durationSec: { type: 'number' },
          distanceM: { type: 'number' },
          rir: { type: 'number' },
          rpe: { type: 'number' },
          done: { type: 'boolean' },
          type: { type: 'string', enum: ['warmup', 'working', 'drop', 'amrap', 'failure'] as SetType[] },
        },
      },
    },
    required: ['sessionId', 'exerciseId', 'setIndex', 'patch'],
  },
  handler: (args, ctx) =>
    mutateSession(ctx.qc, args.sessionId, (s) => ({
      ...s,
      startedAt: s.startedAt ?? new Date().toISOString(),
      exercises: s.exercises.map((e) => {
        if (e.exerciseId !== args.exerciseId) return e
        return {
          ...e,
          sets: e.sets.map((set, i) => {
            if (i !== args.setIndex) return set
            const next: SetEntry = { ...set, ...args.patch }
            if (args.patch.done === true && !set.done) {
              next.reps = next.reps ?? set.targetReps
              next.weight = next.weight ?? set.targetWeight
              next.durationSec = next.durationSec ?? set.targetDurationSec
              next.at = new Date().toISOString()
            }
            return next
          }),
        }
      }),
    })),
  summarize: (args) => (args.patch.done === true ? 'Logged a set' : 'Updated a set'),
})

// ---- session.remove_set ----

export const removeSetCommand = defineCommand<{ sessionId: string; exerciseId: string; setIndex: number }, Session>({
  name: 'session.remove_set',
  title: 'Remove set',
  description: 'Remove one set row from an exercise, e.g. to correct a misclick.',
  kind: 'write',
  parameters: {
    type: 'object',
    properties: { sessionId: { type: 'string' }, exerciseId: { type: 'string' }, setIndex: { type: 'number' } },
    required: ['sessionId', 'exerciseId', 'setIndex'],
  },
  handler: (args, ctx) =>
    mutateSession(ctx.qc, args.sessionId, (s) => ({
      ...s,
      exercises: s.exercises.map((e) =>
        e.exerciseId === args.exerciseId ? { ...e, sets: e.sets.filter((_, i) => i !== args.setIndex) } : e,
      ),
    })),
  summarize: () => 'Removed a set',
})

// ---- session.log_cardio ----

export const logCardioCommand = defineCommand<{ sessionId: string; cardio: CardioResult }, Session>({
  name: 'session.log_cardio',
  title: 'Log cardio result',
  description: 'Record the result of a walk/run/cycle/swim/hike session: duration, optionally distance and perceived effort (1-5).',
  kind: 'write',
  parameters: {
    type: 'object',
    properties: {
      sessionId: { type: 'string' },
      cardio: {
        type: 'object',
        properties: {
          durationSec: { type: 'number' },
          distanceM: { type: 'number' },
          effort: { type: 'number', description: '1 (very easy) to 5 (max effort)' },
        },
        required: ['durationSec'],
      },
    },
    required: ['sessionId', 'cardio'],
  },
  handler: (args, ctx) =>
    mutateSession(ctx.qc, args.sessionId, (s) => ({
      ...s,
      cardio: {
        ...args.cardio,
        avgPaceSecPerKm:
          args.cardio.distanceM && args.cardio.distanceM > 0
            ? Math.round(args.cardio.durationSec / (args.cardio.distanceM / 1000))
            : undefined,
      },
    })),
  summarize: (args) => `Logged ${Math.round(args.cardio.durationSec / 60)} min cardio`,
})

// ---- session.finish ----

export const finishSessionCommand = defineCommand<{ sessionId: string }, Session>({
  name: 'session.finish',
  title: 'Finish session',
  description: 'Mark a session as finished (sets the end time).',
  kind: 'write',
  parameters: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] },
  handler: (args, ctx) => mutateSession(ctx.qc, args.sessionId, (s) => ({ ...s, endedAt: new Date().toISOString() })),
  summarize: (_args, result) => `Finished "${result.name}"`,
})

// ---- session.delete ----

export const deleteSessionCommand = defineCommand<{ sessionId: string }, Session | null>({
  name: 'session.delete',
  title: 'Delete session',
  description: 'Delete a session permanently. The user is asked to confirm first.',
  kind: 'destructive',
  parameters: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] },
  handler: async (args, ctx) => {
    const located = await locateSession(ctx.qc, args.sessionId)
    if (!located) return null
    writeSessionsMonth(ctx.qc, located.month, (current) => current.filter((s) => s.id !== args.sessionId))
    return located.session
  },
  undo: (_args, removed, ctx) => {
    if (removed) writeSessionsMonth(ctx.qc, monthKey(removed.date), (current) => [...current, removed])
  },
  summarize: (_args, removed) => (removed ? `Deleted "${removed.name}"` : 'Deleted session'),
})

// ---- session.list ----

interface ListArgs {
  month?: string
  limit?: number
}

export const listSessionsCommand = defineCommand<ListArgs, Session[]>({
  name: 'session.list',
  title: 'List sessions',
  description:
    'List training sessions, newest last. Pass month (YYYY-MM) to scope to one month (fast); omit for full history (slower — scans every month).',
  kind: 'read',
  parameters: {
    type: 'object',
    properties: {
      month: { type: 'string' },
      limit: { type: 'number', description: 'max sessions, most recent first, default 20' },
    },
  },
  handler: async (args, ctx) => {
    let all: Session[]
    if (args.month) {
      all = readSessionsMonth(ctx.qc, args.month)
    } else {
      const files = await listDir(PATHS.sessionsDir)
      const months = files.map((f) => f.name.replace(/\.json$/, '')).filter((n) => /^\d{4}-\d{2}$/.test(n))
      all = []
      for (const month of months) all.push(...(await loadFile<Session[]>(PATHS.sessions(month), emptySessions)))
    }
    const sorted = [...all].sort((a, b) => a.date.localeCompare(b.date))
    const limit = args.limit ?? 20
    return sorted.slice(-limit)
  },
})
