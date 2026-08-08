import type { QueryClient } from '@tanstack/react-query'
import { PATHS } from '@/lib/paths'
import { fileQueryKey } from '@/lib/queryKeys'
import { getCachedFile } from '@/lib/cache'
import { updateFile } from '@/lib/sync'
import { fetchExerciseLibrary } from '@/lib/exerciseDb'
import type { CustomExercisesFile, Exercise, ExerciseLevel } from '@/lib/types'
import { defineCommand } from './registry'
import { getVenues } from './venues'

const emptyCustom: CustomExercisesFile = { exercises: [] }

export function getCustomExercises(qc: QueryClient): Exercise[] {
  return (
    qc.getQueryData<CustomExercisesFile>(fileQueryKey(PATHS.customExercises))?.exercises ??
    getCachedFile<CustomExercisesFile>(PATHS.customExercises)?.content.exercises ??
    []
  )
}

/** Library + user-created exercises, the one place both are combined. */
export async function allExercises(qc: QueryClient): Promise<Exercise[]> {
  const library = await fetchExerciseLibrary()
  return [...library, ...getCustomExercises(qc)]
}

interface SearchArgs {
  text?: string
  muscle?: string
  equipment?: string
  category?: string
  level?: ExerciseLevel
  limit?: number
}

export const searchExercisesCommand = defineCommand<SearchArgs, Pick<Exercise, 'id' | 'name' | 'category' | 'equipment' | 'primaryMuscles' | 'level'>[]>({
  name: 'exercise.search',
  title: 'Search exercise library',
  description:
    'Search the exercise library (free-exercise-db plus any user-created exercises) by name text, primary muscle, equipment, category (strength/cardio/stretching/...), or level. Returns compact rows — use this before programming or logging so exercise ids are valid.',
  kind: 'read',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'substring match against the exercise name' },
      muscle: { type: 'string' },
      equipment: { type: 'string' },
      category: { type: 'string' },
      level: { type: 'string', enum: ['beginner', 'intermediate', 'expert'] },
      limit: { type: 'number', description: 'default 30' },
    },
  },
  handler: async (args, ctx) => {
    const exercises = await allExercises(ctx.qc)
    const text = args.text?.toLowerCase()
    const filtered = exercises.filter((e) => {
      if (text && !e.name.toLowerCase().includes(text)) return false
      if (args.muscle && !e.primaryMuscles.includes(args.muscle) && !e.secondaryMuscles.includes(args.muscle)) return false
      if (args.equipment && e.equipment !== args.equipment) return false
      if (args.category && e.category !== args.category) return false
      if (args.level && e.level !== args.level) return false
      return true
    })
    return filtered.slice(0, args.limit ?? 30).map((e) => ({
      id: e.id,
      name: e.name,
      category: e.category,
      equipment: e.equipment,
      primaryMuscles: e.primaryMuscles,
      level: e.level,
    }))
  },
})

export const getExerciseCommand = defineCommand<{ id: string }, Exercise>({
  name: 'exercise.get',
  title: 'Get exercise details',
  description:
    'Get one exercise by an exact id, including instructions, primary and secondary muscles, equipment, level, category, and available image/GIF/video media. Call exercise.search first when the id is unknown.',
  kind: 'read',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  handler: async (args, ctx) => {
    const exercise = (await allExercises(ctx.qc)).find((item) => item.id === args.id)
    if (!exercise) throw new Error(`Exercise "${args.id}" not found`)
    return exercise
  },
})

export interface ExerciseFacets {
  muscles: string[]
  equipment: string[]
  categories: string[]
  levels: string[]
  total: number
}

export const getExerciseFacetsCommand = defineCommand<Record<string, never>, ExerciseFacets>({
  name: 'exercise.facets',
  title: 'List exercise catalog filters',
  description:
    'List the exact muscle, equipment, category, and level values supported by the exercise catalog. Call this before exercise.search when you need to discover valid filters rather than guessing them.',
  kind: 'read',
  parameters: { type: 'object', properties: {} },
  handler: async (_args, ctx) => {
    const exercises = await allExercises(ctx.qc)
    const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort()
    return {
      muscles: unique(exercises.flatMap((exercise) => [...exercise.primaryMuscles, ...exercise.secondaryMuscles])),
      equipment: unique(exercises.flatMap((exercise) => exercise.equipment ? [exercise.equipment] : [])),
      categories: unique(exercises.map((exercise) => exercise.category)),
      levels: unique(exercises.map((exercise) => exercise.level)),
      total: exercises.length,
    }
  },
})

interface FindSubstitutesArgs {
  exerciseId: string
  venueId?: string
  muscle?: string
  equipment?: string
  limit?: number
}

type SubstituteCandidate = Pick<Exercise, 'id' | 'name' | 'category' | 'equipment' | 'primaryMuscles' | 'secondaryMuscles' | 'level'>

export const findExerciseSubstitutesCommand = defineCommand<FindSubstitutesArgs, SubstituteCandidate[]>({
  name: 'exercise.find_substitutes',
  title: 'Find exercise substitution candidates',
  description:
    'Filter the exercise catalog to plausible replacements for an exercise, optionally constrained to a venue, muscle, or equipment. This tool supplies candidates only: the AI must inspect context and choose the best replacement itself.',
  kind: 'read',
  parameters: {
    type: 'object',
    properties: {
      exerciseId: { type: 'string' },
      venueId: { type: 'string' },
      muscle: { type: 'string', description: 'optional muscle to prioritize instead of the original primary muscles' },
      equipment: { type: 'string', description: 'optional exact equipment constraint' },
      limit: { type: 'number', description: 'default 20' },
    },
    required: ['exerciseId'],
  },
  handler: async (args, ctx) => {
    const exercises = await allExercises(ctx.qc)
    const original = exercises.find((exercise) => exercise.id === args.exerciseId)
    if (!original) throw new Error(`Exercise "${args.exerciseId}" not found`)

    const venue = args.venueId ? getVenues(ctx.qc).find((item) => item.id === args.venueId) : undefined
    if (args.venueId && !venue) throw new Error(`Venue "${args.venueId}" not found`)
    const targetMuscles = args.muscle ? [args.muscle] : original.primaryMuscles
    const availableEquipment = new Set(venue?.equipment ?? [])

    return exercises
      .filter((exercise) => {
        if (exercise.id === original.id || exercise.category !== original.category) return false
        if (args.equipment && exercise.equipment !== args.equipment) return false
        if (venue && exercise.equipment && exercise.equipment !== 'body only' && !availableEquipment.has(exercise.equipment)) return false
        return [...exercise.primaryMuscles, ...exercise.secondaryMuscles].some((muscle) => targetMuscles.includes(muscle))
      })
      .sort((a, b) => {
        const aPrimary = a.primaryMuscles.filter((muscle) => targetMuscles.includes(muscle)).length
        const bPrimary = b.primaryMuscles.filter((muscle) => targetMuscles.includes(muscle)).length
        return bPrimary - aPrimary || a.name.localeCompare(b.name)
      })
      .slice(0, args.limit ?? 20)
      .map(({ id, name, category, equipment, primaryMuscles, secondaryMuscles, level }) => ({
        id,
        name,
        category,
        equipment,
        primaryMuscles,
        secondaryMuscles,
        level,
      }))
  },
})

interface AddCustomExerciseArgs {
  name: string
  category: string
  level: ExerciseLevel
  equipment?: string
  primaryMuscles: string[]
  secondaryMuscles?: string[]
  aliases?: string[]
}

export const addCustomExerciseCommand = defineCommand<AddCustomExerciseArgs, Exercise>({
  name: 'exercise.add_custom',
  title: 'Add custom exercise',
  description: "Add an exercise that isn't in the standard library — a gym-specific machine, a variation, etc.",
  kind: 'write',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      category: { type: 'string', description: "e.g. 'strength', 'cardio', 'stretching'" },
      level: { type: 'string', enum: ['beginner', 'intermediate', 'expert'] },
      equipment: { type: 'string' },
      primaryMuscles: { type: 'array', items: { type: 'string' } },
      secondaryMuscles: { type: 'array', items: { type: 'string' } },
      aliases: { type: 'array', items: { type: 'string' } },
    },
    required: ['name', 'category', 'level', 'primaryMuscles'],
  },
  handler: (args, ctx) => {
    const exercise: Exercise = {
      id: 'custom-' + args.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
      name: args.name,
      category: args.category,
      level: args.level,
      equipment: args.equipment ?? null,
      primaryMuscles: args.primaryMuscles,
      secondaryMuscles: args.secondaryMuscles ?? [],
      instructions: [],
      images: [],
      custom: true,
      aliases: args.aliases,
    }
    const next = updateFile<CustomExercisesFile>(PATHS.customExercises, emptyCustom, (current) => ({
      exercises: [...current.exercises.filter((e) => e.id !== exercise.id), exercise],
    }))
    ctx.qc.setQueryData(fileQueryKey(PATHS.customExercises), next)
    return exercise
  },
  summarize: (args) => `Added custom exercise "${args.name}"`,
})
