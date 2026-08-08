import { daysBetween } from '@/lib/dates'
import { fatigueByMuscle } from '@/lib/engine/fatigue'
import { e1rmTrend } from '@/lib/insights/records'
import type { Exercise, Session } from '@/lib/types'

export const MUSCLE_REGIONS = [
  'abs',
  'abductors',
  'adductors',
  'biceps',
  'calves',
  'chest',
  'deltoids',
  'forearms',
  'glutes',
  'hamstrings',
  'lower-back',
  'neck',
  'quadriceps',
  'trapezius',
  'triceps',
  'upper-back',
] as const

export type MuscleRegion = (typeof MUSCLE_REGIONS)[number]
export type MuscleMapMode = 'target' | 'load' | 'recovery' | 'progress'
export type MuscleMapConfidence = 'high' | 'medium' | 'low' | 'insufficient'

export interface MuscleExerciseContribution {
  exerciseId: string
  name: string
  directSets: number
  indirectSets: number
  e1rmChangePct?: number
  dataPoints?: number
}
export interface MuscleMapDatum {
  muscle: MuscleRegion
  label: string
  mode: MuscleMapMode
  value: number | null
  unit: 'weighted sets' | 'recovery score' | '% e1RM'
  level: 0 | 1 | 2 | 3 | 4
  status: string
  confidence: MuscleMapConfidence
  directSets: number
  indirectSets: number
  daysSinceTrained: number | null
  exercises: MuscleExerciseContribution[]
  evidence: string[]
}

const LABELS: Record<MuscleRegion, string> = {
  abs: 'Abs',
  abductors: 'Abductors',
  adductors: 'Adductors',
  biceps: 'Biceps',
  calves: 'Calves',
  chest: 'Chest',
  deltoids: 'Shoulders',
  forearms: 'Forearms',
  glutes: 'Glutes',
  hamstrings: 'Hamstrings',
  'lower-back': 'Lower back',
  neck: 'Neck',
  quadriceps: 'Quadriceps',
  trapezius: 'Traps',
  triceps: 'Triceps',
  'upper-back': 'Upper back & lats',
}

const RAW_TO_REGION: Record<string, MuscleRegion> = {
  abdominals: 'abs',
  abs: 'abs',
  abductors: 'abductors',
  adductors: 'adductors',
  biceps: 'biceps',
  calves: 'calves',
  chest: 'chest',
  forearm: 'forearms',
  forearms: 'forearms',
  gluteal: 'glutes',
  glutes: 'glutes',
  hamstring: 'hamstrings',
  hamstrings: 'hamstrings',
  lats: 'upper-back',
  'lower back': 'lower-back',
  'lower-back': 'lower-back',
  'middle back': 'upper-back',
  'middle-back': 'upper-back',
  neck: 'neck',
  quadriceps: 'quadriceps',
  shoulders: 'deltoids',
  deltoids: 'deltoids',
  traps: 'trapezius',
  trapezius: 'trapezius',
  triceps: 'triceps',
  'upper back': 'upper-back',
  'upper-back': 'upper-back',
}

interface MutableDatum {
  directSets: number
  indirectSets: number
  daysSinceTrained: number | null
  recoveryStatus?: 'fresh' | 'recovering' | 'fatigued'
  exercises: Map<string, MuscleExerciseContribution>
  progressChanges: number[]
  progressPoints: number
}

function emptyMutable(): MutableDatum {
  return {
    directSets: 0,
    indirectSets: 0,
    daysSinceTrained: null,
    exercises: new Map(),
    progressChanges: [],
    progressPoints: 0,
  }
}

export function normalizeMuscleRegion(muscle: string): MuscleRegion | null {
  return RAW_TO_REGION[muscle.trim().toLowerCase()] ?? null
}

export function muscleRegionLabel(region: MuscleRegion): string {
  return LABELS[region]
}

function addContribution(
  row: MutableDatum,
  exerciseId: string,
  name: string,
  directSets: number,
  indirectSets: number,
) {
  const current = row.exercises.get(exerciseId) ?? { exerciseId, name, directSets: 0, indirectSets: 0 }
  current.directSets += directSets
  current.indirectSets += indirectSets
  row.exercises.set(exerciseId, current)
  row.directSets += directSets
  row.indirectSets += indirectSets
}

function loadLevel(value: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0) return 0
  if (value < 3) return 1
  if (value < 6) return 2
  if (value < 10) return 3
  return 4
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function statusForLoad(value: number, mode: 'target' | 'load'): string {
  if (value === 0) return mode === 'target' ? 'Not targeted today' : 'No completed work'
  if (value < 3) return mode === 'target' ? 'Supporting role' : 'Light exposure'
  if (value < 6) return mode === 'target' ? 'Moderate target' : 'Moderate load'
  if (value < 10) return mode === 'target' ? 'Major target' : 'High load'
  return mode === 'target' ? 'Primary focus' : 'Very high load'
}

function confidenceForLoad(row: MutableDatum): MuscleMapConfidence {
  if (row.directSets > 0) return 'high'
  if (row.indirectSets > 0) return 'medium'
  return 'insufficient'
}

function selectedSessions(sessions: Session[], today: string, mode: MuscleMapMode, days: number): Session[] {
  if (mode === 'target') return sessions.filter((session) => session.date === today)
  return sessions.filter((session) => {
    const age = daysBetween(session.date, today)
    return age >= 0 && age < days
  })
}

/**
 * One source of truth for the body silhouette and its AI read command.
 * Secondary-muscle work is retained as a real set count and weighted 0.5 only
 * when producing the visual load value.
 */
export function muscleMapSnapshot(
  sessions: Session[],
  today: string,
  byId: Map<string, Exercise>,
  mode: MuscleMapMode,
  days = mode === 'progress' ? 84 : 7,
): MuscleMapDatum[] {
  const rows = new Map<MuscleRegion, MutableDatum>(MUSCLE_REGIONS.map((region) => [region, emptyMutable()]))

  if (mode === 'target' || mode === 'load') {
    for (const session of selectedSessions(sessions, today, mode, days)) {
      for (const sessionExercise of session.exercises) {
        const exercise = byId.get(sessionExercise.exerciseId)
        if (!exercise) continue
        const sets = sessionExercise.sets.filter((set) =>
          set.type !== 'warmup' && (mode === 'target' || set.done),
        ).length
        if (sets === 0) continue
        for (const raw of exercise.primaryMuscles) {
          const region = normalizeMuscleRegion(raw)
          if (region) addContribution(rows.get(region)!, exercise.id, exercise.name, sets, 0)
        }
        for (const raw of exercise.secondaryMuscles) {
          const region = normalizeMuscleRegion(raw)
          if (region) addContribution(rows.get(region)!, exercise.id, exercise.name, 0, sets)
        }
      }
    }
  }

  if (mode === 'recovery') {
    for (const fatigue of fatigueByMuscle(sessions, today, byId)) {
      const region = normalizeMuscleRegion(fatigue.muscle)
      if (!region) continue
      const row = rows.get(region)!
      row.directSets += fatigue.recentSets
      row.daysSinceTrained = row.daysSinceTrained === null
        ? fatigue.daysSinceTrained
        : Math.min(row.daysSinceTrained, fatigue.daysSinceTrained ?? row.daysSinceTrained)
      const rank = { fresh: 1, recovering: 2, fatigued: 3 }
      if (!row.recoveryStatus || rank[fatigue.status] > rank[row.recoveryStatus]) row.recoveryStatus = fatigue.status
    }
  }

  if (mode === 'progress') {
    const cutoffDays = Math.max(14, days)
    for (const exercise of byId.values()) {
      const points = e1rmTrend(exercise.id, sessions).filter((point) => {
        const age = daysBetween(point.date, today)
        return age >= 0 && age < cutoffDays
      })
      if (points.length < 2) continue
      const first = points[0].e1rm
      const latest = points[points.length - 1].e1rm
      if (first <= 0) continue
      const change = round(((latest - first) / first) * 100)
      for (const raw of exercise.primaryMuscles) {
        const region = normalizeMuscleRegion(raw)
        if (!region) continue
        const row = rows.get(region)!
        row.progressChanges.push(change)
        row.progressPoints += points.length
        row.exercises.set(exercise.id, {
          exerciseId: exercise.id,
          name: exercise.name,
          directSets: 0,
          indirectSets: 0,
          e1rmChangePct: change,
          dataPoints: points.length,
        })
      }
    }
  }

  return MUSCLE_REGIONS.map((muscle) => {
    const row = rows.get(muscle)!
    const weightedSets = round(row.directSets + row.indirectSets * 0.5)
    const exercises = [...row.exercises.values()].sort((a, b) =>
      (b.directSets + b.indirectSets * 0.5) - (a.directSets + a.indirectSets * 0.5),
    )

    if (mode === 'target' || mode === 'load') {
      return {
        muscle,
        label: LABELS[muscle],
        mode,
        value: weightedSets,
        unit: 'weighted sets' as const,
        level: loadLevel(weightedSets),
        status: statusForLoad(weightedSets, mode),
        confidence: confidenceForLoad(row),
        directSets: row.directSets,
        indirectSets: row.indirectSets,
        daysSinceTrained: null,
        exercises,
        evidence: weightedSets > 0
          ? [`${row.directSets} direct sets`, `${row.indirectSets} secondary sets`, `${exercises.length} contributing exercises`]
          : [],
      }
    }

    if (mode === 'recovery') {
      const status = row.recoveryStatus ?? 'fresh'
      const score = status === 'fatigued' ? 25 : status === 'recovering' ? 60 : 100
      return {
        muscle,
        label: LABELS[muscle],
        mode,
        value: score,
        unit: 'recovery score' as const,
        level: status === 'fatigued' ? 4 : status === 'recovering' ? 2 : row.daysSinceTrained === null ? 0 : 1,
        status: row.daysSinceTrained === null ? 'No recent data' : status === 'fatigued' ? 'Fatigued' : status === 'recovering' ? 'Recovering' : 'Ready',
        confidence: row.daysSinceTrained === null ? 'insufficient' : 'medium',
        directSets: row.directSets,
        indirectSets: 0,
        daysSinceTrained: row.daysSinceTrained,
        exercises: [],
        evidence: row.daysSinceTrained === null
          ? []
          : [`Last trained ${row.daysSinceTrained} day${row.daysSinceTrained === 1 ? '' : 's'} ago`, `${round(row.directSets)} recent set equivalents`],
      }
    }

    const change = median(row.progressChanges)
    const roundedChange = change === null ? null : round(change)
    const confidence: MuscleMapConfidence =
      row.progressPoints >= 8 || row.progressChanges.length >= 2
        ? 'high'
        : row.progressPoints >= 3
          ? 'medium'
          : change === null
            ? 'insufficient'
            : 'low'
    const level: 0 | 1 | 2 | 3 | 4 = roundedChange === null ? 0 : roundedChange <= 0 ? 1 : roundedChange < 3 ? 2 : roundedChange < 8 ? 3 : 4
    return {
      muscle,
      label: LABELS[muscle],
      mode,
      value: roundedChange,
      unit: '% e1RM' as const,
      level,
      status: roundedChange === null ? 'Not enough comparable data' : roundedChange > 1 ? 'Improving' : roundedChange < -1 ? 'Declining' : 'Stable',
      confidence,
      directSets: 0,
      indirectSets: 0,
      daysSinceTrained: null,
      exercises,
      evidence: roundedChange === null
        ? []
        : [`Median e1RM change ${roundedChange > 0 ? '+' : ''}${roundedChange}%`, `${row.progressChanges.length} comparable exercise${row.progressChanges.length === 1 ? '' : 's'}`, `${row.progressPoints} logged performance points`],
    }
  })
}
