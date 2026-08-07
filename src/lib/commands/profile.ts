import { PATHS } from '@/lib/paths'
import { fileQueryKey } from '@/lib/queryKeys'
import { getCachedFile } from '@/lib/cache'
import { updateFile } from '@/lib/sync'
import type { Experience, Profile, TrainingGoal, Units } from '@/lib/types'
import { defineCommand } from './registry'

export function getProfile(qc: import('@tanstack/react-query').QueryClient): Profile | null {
  return qc.getQueryData<Profile | null>(fileQueryKey(PATHS.profile)) ?? getCachedFile<Profile | null>(PATHS.profile)?.content ?? null
}

interface ProfilePatch {
  goal?: TrainingGoal
  experience?: Experience
  daysPerWeek?: number
  sessionMinutes?: number
  heightCm?: number
  birthYear?: number
  injuries?: string
  preferences?: string
  units?: Units
  barbellWeight?: number
  plateInventory?: number[]
}

const GOALS: TrainingGoal[] = ['build-muscle', 'strength', 'fat-loss', 'general-fitness', 'endurance']
const EXPERIENCE: Experience[] = ['beginner', 'intermediate', 'advanced']

export const getProfileCommand = defineCommand<Record<string, never>, Profile | null>({
  name: 'profile.get',
  title: 'Read training profile',
  description: "Get the user's training profile: goal, experience, days per week, injuries, preferences, units.",
  kind: 'read',
  parameters: { type: 'object', properties: {} },
  handler: (_args, ctx) => getProfile(ctx.qc),
})

export const updateProfileCommand = defineCommand<ProfilePatch, Profile>({
  name: 'profile.update',
  title: 'Update training profile',
  description:
    'Create or update the training profile. Pass only the fields that changed; existing fields are preserved.',
  kind: 'write',
  parameters: {
    type: 'object',
    properties: {
      goal: { type: 'string', enum: GOALS },
      experience: { type: 'string', enum: EXPERIENCE },
      daysPerWeek: { type: 'number' },
      sessionMinutes: { type: 'number' },
      heightCm: { type: 'number' },
      birthYear: { type: 'number' },
      injuries: { type: 'string' },
      preferences: { type: 'string' },
      units: { type: 'string', enum: ['kg', 'lb'] },
      barbellWeight: { type: 'number' },
      plateInventory: { type: 'array', items: { type: 'number' } },
    },
  },
  handler: (patch, ctx) => {
    const now = new Date().toISOString()
    const fallback: Profile = {
      goal: 'general-fitness',
      experience: 'beginner',
      daysPerWeek: 3,
      units: 'kg',
      createdAt: now,
      updatedAt: now,
    }
    const next = updateFile<Profile>(PATHS.profile, fallback, (current) => ({
      ...current,
      ...patch,
      updatedAt: now,
    }))
    ctx.qc.setQueryData(fileQueryKey(PATHS.profile), next)
    return next
  },
  summarize: (patch) => `Updated profile (${Object.keys(patch).join(', ')})`,
})
