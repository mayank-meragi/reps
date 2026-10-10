import { describe, expect, it } from 'vitest'
import { validateTodayAssessment } from './programs'

describe('validateTodayAssessment', () => {
  it('normalizes the typed assessment while preserving auditable evidence', () => {
    const result = validateTodayAssessment({
      primaryAdaptation: ' hypertrophy ',
      modality: 'strength',
      preserveExistingIntent: true,
      muscleTargets: [{ muscle: ' chest ', stimulus: 'moderate' }],
      systemicFatigue: 'low',
      availableMinutes: 2,
      constraints: [' 45 minutes '],
      rationale: ' Continue productive work. ',
      evidence: [{ code: 'PROGRAM_CONTINUITY', subject: 'Upper body', detail: ' Recent work is progressing. ' }],
    })

    expect(result.primaryAdaptation).toBe('hypertrophy')
    expect(result.availableMinutes).toBe(5)
    expect(result.muscleTargets[0].muscle).toBe('chest')
    expect(result.evidence[0].detail).toBe('Recent work is progressing.')
  })

  it('rejects an assessment without usable evidence', () => {
    expect(() => validateTodayAssessment({
      primaryAdaptation: 'strength',
      modality: 'strength',
      preserveExistingIntent: false,
      muscleTargets: [],
      systemicFatigue: 'moderate',
      constraints: [],
      rationale: 'Train.',
      evidence: [],
    })).toThrow('did not cite usable evidence')
  })
})
