import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchExerciseLibrary } from '@/lib/exerciseDb'
import { PATHS } from '@/lib/paths'
import { useFileQuery } from './useData'
import type { CustomExercisesFile, Exercise } from '@/lib/types'

/** Base library + user-created exercises — the same combination exercise.search returns. */
export function useAllExercises(): { data: Exercise[]; isLoading: boolean } {
  const library = useQuery({
    queryKey: ['exercise-library'],
    queryFn: fetchExerciseLibrary,
    staleTime: Infinity,
    gcTime: Infinity,
  })
  const custom = useFileQuery<CustomExercisesFile>(PATHS.customExercises, { exercises: [] })
  const data = useMemo(
    () => [...(library.data ?? []), ...(custom.data?.exercises ?? [])],
    [library.data, custom.data],
  )
  return { data, isLoading: library.isLoading }
}
