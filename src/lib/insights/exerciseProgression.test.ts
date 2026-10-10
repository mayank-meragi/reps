import { describe, expect, it } from 'vitest'
import { exerciseProgressionInsights } from './exerciseProgression'
import type { Exercise, Session } from '@/lib/types'

const exercise: Exercise = {
  id: 'incline-dumbbell-press',
  name: 'Incline Dumbbell Press',
  level: 'intermediate',
  mechanic: 'compound',
  equipment: 'dumbbell',
  primaryMuscles: ['chest'],
  secondaryMuscles: ['triceps', 'shoulders'],
  instructions: [],
  category: 'strength',
  images: [],
}

function session(id: string, date: string, reps: number, weight: number, rir: number): Session {
  return {
    id,
    date,
    modality: 'strength',
    name: 'Upper body',
    focus: ['chest'],
    source: 'program',
    endedAt: `${date}T10:00:00.000Z`,
    exercises: [{
      exerciseId: exercise.id,
      name: exercise.name,
      mode: 'reps',
      sets: [
        { type: 'working', done: true, reps, weight, rir },
        { type: 'working', done: true, reps, weight, rir },
        { type: 'working', done: true, reps, weight, rir },
      ],
    }],
    createdAt: `${date}T09:00:00.000Z`,
    updatedAt: `${date}T10:00:00.000Z`,
  }
}

describe('exerciseProgressionInsights', () => {
  it('returns continuity evidence newest-first and a deterministic double-progression target', () => {
    const result = exerciseProgressionInsights({
      sessions: [
        session('older', '2026-08-01', 10, 30, 2),
        session('latest', '2026-08-08', 12, 30, 2),
      ],
      exercises: [exercise],
      today: '2026-08-10',
      exerciseId: exercise.id,
      repRange: [8, 12],
      targetRir: 2,
      scheme: 'double-progression',
    })

    expect(result).toHaveLength(1)
    expect(result[0].lastPerformedDate).toBe('2026-08-08')
    expect(result[0].daysSincePerformed).toBe(2)
    expect(result[0].recentPerformances.map((item) => item.sessionId)).toEqual(['latest', 'older'])
    expect(result[0].trend).toBe('improving')
    expect(result[0].nextTarget).toEqual({ targetReps: 8, targetWeight: 32.5 })
  })

  it('does not increase load when the top of the range was too close to failure', () => {
    const result = exerciseProgressionInsights({
      sessions: [session('latest', '2026-08-08', 12, 30, 0)],
      exercises: [exercise],
      today: '2026-08-10',
      exerciseId: exercise.id,
      repRange: [8, 12],
      targetRir: 2,
    })

    expect(result[0].nextTarget).toEqual({ targetReps: 12, targetWeight: 30 })
  })
})
