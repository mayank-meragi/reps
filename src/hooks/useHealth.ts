import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRunCommand } from '@/lib/commands/useRunCommand'
import type { HealthScores, HealthSyncStatus } from '@/lib/commands/health'
import { healthKeys } from '@/lib/queryKeys'
import type { HealthMonitor } from '@/lib/selectors/healthMonitor'

/** The Health screens read through these hooks; each one is a thin wrapper over a health.* command. */

export function useHealthStatus() {
  const run = useRunCommand()
  return useQuery({ queryKey: healthKeys.status, queryFn: () => run<Record<string, never>, HealthSyncStatus>('health.sync_status', {}) })
}

export function useHealthMonitor(date: string) {
  const run = useRunCommand()
  return useQuery({ queryKey: healthKeys.monitor(date), queryFn: () => run<{ date: string }, HealthMonitor>('health.get_monitor', { date }) })
}

export function useHealthScores(date: string) {
  const run = useRunCommand()
  return useQuery({ queryKey: healthKeys.scores(date), queryFn: () => run<{ date: string }, HealthScores>('health.get_scores', { date }) })
}

/** Change the sleep target (profile.update) and refresh every score that depends on it. */
export function useSetSleepNeed() {
  const run = useRunCommand()
  const qc = useQueryClient()
  return useCallback(
    async (minutes: number) => {
      await run('profile.update', { sleepNeedMinutes: minutes })
      await qc.invalidateQueries({ queryKey: healthKeys.all })
    },
    [run, qc],
  )
}
