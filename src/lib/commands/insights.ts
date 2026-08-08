import { PATHS } from '@/lib/paths'
import { loadFile } from '@/lib/sync'
import { listDir } from '@/lib/github'
import { effectiveTodayISO } from '@/lib/dates'
import { personalRecords, e1rmTrend, stalledExercises, type ExercisePR, type E1rmPoint, type StalledExercise } from '@/lib/insights/records'
import { adherenceByWeek, weeklyAdherence, type AdherenceStat, type WeeklyAdherencePoint } from '@/lib/insights/adherence'
import { modalityMixMinutes, activeDays, type ModalityMinutes } from '@/lib/insights/modality'
import { weeklyVolumeVsLandmarks, type MuscleVolumeStatus } from '@/lib/insights/volume'
import { cardioPaceTrend, cardioWeeklyTrend, type CardioWeekPoint, type PacePoint } from '@/lib/insights/cardio'
import { sessionDensity, type SessionDensityPoint } from '@/lib/insights/density'
import { muscleBalance, type BalanceRatio } from '@/lib/insights/balance'
import { strengthWeightTrend, type StrengthWeightPoint } from '@/lib/insights/combined'
import {
  MUSCLE_REGIONS,
  muscleMapSnapshot,
  type MuscleMapDatum,
  type MuscleMapMode,
  type MuscleRegion,
} from '@/lib/insights/muscleMap'
import type { Modality, Session } from '@/lib/types'
import { defineCommand } from './registry'
import { getProfile } from './profile'
import { allExercises } from './exercises'
import { getBodyMetrics } from './body'

async function allSessions(): Promise<Session[]> {
  const files = await listDir(PATHS.sessionsDir)
  const months = files.map((f) => f.name.replace(/\.json$/, '')).filter((n) => /^\d{4}-\d{2}$/.test(n))
  const all: Session[] = []
  for (const month of months) all.push(...(await loadFile<Session[]>(PATHS.sessions(month), [])))
  return all
}

export const getPersonalRecordsCommand = defineCommand<Record<string, never>, ExercisePR[]>({
  name: 'insights.personal_records',
  title: 'Get personal records',
  description: 'Best estimated 1RM per exercise across all logged history, highest first. Use for "what are my PRs" / "what have I lifted" questions.',
  kind: 'read',
  parameters: { type: 'object', properties: {} },
  handler: async () => personalRecords(await allSessions()),
})

export const getE1rmTrendCommand = defineCommand<{ exerciseId: string }, E1rmPoint[]>({
  name: 'insights.e1rm_trend',
  title: 'Get e1RM trend for an exercise',
  description: 'Estimated 1RM over time for one exercise, oldest first — the strength progress line for that lift.',
  kind: 'read',
  parameters: { type: 'object', properties: { exerciseId: { type: 'string' } }, required: ['exerciseId'] },
  handler: async (args) => e1rmTrend(args.exerciseId, await allSessions()),
})

export const getStalledExercisesCommand = defineCommand<{ weeks?: number }, StalledExercise[]>({
  name: 'insights.stalled_exercises',
  title: 'Get stalled exercises',
  description: "Exercises trained recently whose personal record predates the window — no strength progress despite showing up. Default window 4 weeks.",
  kind: 'read',
  parameters: { type: 'object', properties: { weeks: { type: 'number' } } },
  handler: async (args) => stalledExercises(await allSessions(), effectiveTodayISO(), args.weeks ?? 4),
})

export interface AdherenceInsight extends AdherenceStat {
  weeks: WeeklyAdherencePoint[]
}

export const getAdherenceCommand = defineCommand<{ weeks?: number }, AdherenceInsight>({
  name: 'insights.adherence',
  title: 'Get training adherence',
  description: 'Calendar-week planned target versus completed sessions, plus the current "kept showing up" streak. Includes weekly history (default 8 weeks).',
  kind: 'read',
  parameters: { type: 'object', properties: { weeks: { type: 'number', description: 'default 8' } } },
  handler: async (args, ctx) => {
    const profile = getProfile(ctx.qc)
    const sessions = await allSessions()
    const target = profile?.daysPerWeek ?? 3
    const today = effectiveTodayISO()
    return { ...weeklyAdherence(sessions, target, today), weeks: adherenceByWeek(sessions, target, today, args.weeks ?? 8) }
  },
})

export const getModalityMixCommand = defineCommand<{ days?: number }, { minutes: ModalityMinutes[]; activeDays: number }>({
  name: 'insights.modality_mix',
  title: 'Get modality mix',
  description: 'Minutes trained per modality (strength/walk/run/cycle/...) and distinct active days, over the trailing window (default 7 days) — the "not just lifting" picture.',
  kind: 'read',
  parameters: { type: 'object', properties: { days: { type: 'number' } } },
  handler: async (args) => {
    const sessions = await allSessions()
    const today = effectiveTodayISO()
    return { minutes: modalityMixMinutes(sessions, today, args.days ?? 7), activeDays: activeDays(sessions, today, args.days ?? 7) }
  },
})

export const getVolumeVsLandmarksCommand = defineCommand<Record<string, never>, MuscleVolumeStatus[]>({
  name: 'insights.volume_vs_landmarks',
  title: 'Get weekly volume vs landmarks',
  description: 'This week\'s hard sets per muscle group against MEV/MAV/MRV landmarks for the profile\'s experience level — under-training vs over-training signal.',
  kind: 'read',
  parameters: { type: 'object', properties: {} },
  handler: async (_args, ctx) => {
    const [sessions, exercises, profile] = [await allSessions(), await allExercises(ctx.qc), getProfile(ctx.qc)]
    const byId = new Map(exercises.map((e) => [e.id, e]))
    return weeklyVolumeVsLandmarks(sessions, effectiveTodayISO(), byId, profile?.experience ?? 'beginner')
  },
})

export const getCardioTrendCommand = defineCommand<{ weeks?: number; modality?: Modality }, { weekly: CardioWeekPoint[]; pace: PacePoint[] }>({
  name: 'insights.cardio_trend',
  title: 'Get cardio trend',
  description: 'Weekly cardio duration and distance, plus per-session pace for distance-bearing cardio. Optionally filter pace to a modality.',
  kind: 'read',
  parameters: {
    type: 'object',
    properties: {
      weeks: { type: 'number', description: 'default 8' },
      modality: { type: 'string', enum: ['walk', 'run', 'cycle', 'swim', 'hike'] },
    },
  },
  handler: async (args) => {
    const sessions = await allSessions()
    return {
      weekly: cardioWeeklyTrend(sessions, effectiveTodayISO(), args.weeks ?? 8),
      pace: cardioPaceTrend(sessions, args.modality),
    }
  },
})

export const getSessionDensityCommand = defineCommand<{ limit?: number }, SessionDensityPoint[]>({
  name: 'insights.session_density',
  title: 'Get session density',
  description: 'Recent strength-session duration, estimated working versus rest/transition time, completed sets, and sets per hour from session/set timestamps.',
  kind: 'read',
  parameters: { type: 'object', properties: { limit: { type: 'number', description: 'default 12' } } },
  handler: async (args) => sessionDensity(await allSessions(), args.limit ?? 12),
})

export const getMuscleBalanceCommand = defineCommand<{ days?: number }, BalanceRatio[]>({
  name: 'insights.muscle_balance',
  title: 'Get muscle balance',
  description: 'Hard-set ratios for push versus pull and quads versus hamstrings/glutes over a trailing window (default 28 days).',
  kind: 'read',
  parameters: { type: 'object', properties: { days: { type: 'number', description: 'default 28' } } },
  handler: async (args, ctx) => {
    const [sessions, exercises] = [await allSessions(), await allExercises(ctx.qc)]
    return muscleBalance(sessions, effectiveTodayISO(), new Map(exercises.map((e) => [e.id, e])), args.days ?? 28)
  },
})

export const getStrengthWeightTrendCommand = defineCommand<{ exerciseId: string }, StrengthWeightPoint[]>({
  name: 'insights.strength_weight_trend',
  title: 'Get strength and body-weight trend',
  description: "Date-aligned estimated 1RM history for one exercise and the user's body-weight history, for comparing strength progress with weight change.",
  kind: 'read',
  parameters: { type: 'object', properties: { exerciseId: { type: 'string' } }, required: ['exerciseId'] },
  handler: async (args, ctx) => strengthWeightTrend(args.exerciseId, await allSessions(), getBodyMetrics(ctx.qc)),
})

interface MuscleMapArgs {
  mode: MuscleMapMode
  days?: number
}

async function muscleMapFor(args: MuscleMapArgs, ctx: Parameters<typeof getProfile>[0]): Promise<MuscleMapDatum[]> {
  const [sessions, exercises] = [await allSessions(), await allExercises(ctx)]
  return muscleMapSnapshot(
    sessions,
    effectiveTodayISO(),
    new Map(exercises.map((exercise) => [exercise.id, exercise])),
    args.mode,
    args.days,
  )
}

export const getMuscleMapCommand = defineCommand<MuscleMapArgs, MuscleMapDatum[]>({
  name: 'insights.muscle_map',
  title: 'Get muscle map',
  description:
    'Read the exact per-muscle values shown on the interactive body map. Modes: target = prescribed sets in today\'s sessions; load = completed direct and secondary work over the trailing window; recovery = estimated readiness from recent training; progress = median exercise-specific e1RM change where comparable data exists. Values include evidence and confidence—do not describe an estimated recovery score as measured biology.',
  kind: 'read',
  parameters: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['target', 'load', 'recovery', 'progress'] },
      days: { type: 'number', description: 'Trailing window. Defaults to 7, or 84 for progress; ignored for today target mode.' },
    },
    required: ['mode'],
  },
  handler: (args, ctx) => muscleMapFor(args, ctx.qc),
})

export const getMuscleDetailCommand = defineCommand<MuscleMapArgs & { muscle: MuscleRegion }, MuscleMapDatum>({
  name: 'insights.muscle_detail',
  title: 'Get muscle detail',
  description:
    'Inspect one body-map muscle region with its direct and secondary sets, contributing exercises, trend evidence, recovery estimate, and confidence. Call insights.muscle_map first when the exact canonical muscle id is unknown.',
  kind: 'read',
  parameters: {
    type: 'object',
    properties: {
      muscle: { type: 'string', enum: [...MUSCLE_REGIONS] },
      mode: { type: 'string', enum: ['target', 'load', 'recovery', 'progress'] },
      days: { type: 'number', description: 'Trailing window. Defaults to 7, or 84 for progress.' },
    },
    required: ['muscle', 'mode'],
  },
  handler: async (args, ctx) => {
    if (!MUSCLE_REGIONS.includes(args.muscle)) throw new Error(`Unknown muscle region: ${args.muscle}`)
    const row = (await muscleMapFor(args, ctx.qc)).find((datum) => datum.muscle === args.muscle)
    if (!row) throw new Error(`No muscle detail available for ${args.muscle}`)
    return row
  },
})
