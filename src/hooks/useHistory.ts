import { useQuery, useQueryClient } from '@tanstack/react-query'
import { run } from '@/lib/commands/registry'
import type { Session } from '@/lib/types'

/**
 * Full-history session list — deliberately routed through the session.list
 * command (not a direct file read) so this view is provably the same data
 * the AI's read tool returns, not a UI-only reimplementation.
 */
export function useSessionHistory(limit = 200) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: ['session-history', limit],
    queryFn: () =>
      run<{ limit?: number }, Session[]>(
        'session.list',
        { limit },
        { qc, navigate: () => {}, confirm: async () => true, source: 'ui' },
      ),
    staleTime: 30_000,
  })
}
