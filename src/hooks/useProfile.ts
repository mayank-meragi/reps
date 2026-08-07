import { PATHS } from '@/lib/paths'
import { useFileQuery } from './useData'
import type { Profile } from '@/lib/types'

export function useProfile() {
  const query = useFileQuery<Profile | null>(PATHS.profile, null)
  return { profile: query.data ?? null, isReady: query.isFetchedAfterMount }
}
