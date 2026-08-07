import { useQuery } from '@tanstack/react-query'
import { getCachedFile, isConfigured } from '@/lib/cache'
import { PATHS } from '@/lib/paths'
import { loadFile } from '@/lib/sync'
import type { SettingsFile } from '@/lib/types'

export { fileQueryKey } from '@/lib/queryKeys'

/** Query a data file: cached copy shows instantly, remote revalidates in background. */
export function useFileQuery<T>(path: string, fallback: T) {
  return useQuery({
    queryKey: ['file', path],
    queryFn: () => loadFile<T>(path, fallback),
    // Don't fire before onboarding has stored a token
    enabled: isConfigured(),
    // Cached copy renders instantly; updatedAt 0 marks it stale so the remote refetch still runs
    initialData: () => getCachedFile<T>(path)?.content ?? fallback,
    initialDataUpdatedAt: 0,
  })
}

const fallbackSettings: SettingsFile = { schemaVersion: 1, units: 'kg' }

export function useSettings(): SettingsFile {
  const { data } = useFileQuery<SettingsFile>(PATHS.settings, fallbackSettings)
  return data ?? fallbackSettings
}
