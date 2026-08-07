import type { QueryClient } from '@tanstack/react-query'
import { PATHS } from '@/lib/paths'
import { fileQueryKey } from '@/lib/queryKeys'
import { getCachedFile } from '@/lib/cache'
import { updateFile } from '@/lib/sync'
import { effectiveTodayISO } from '@/lib/dates'
import type { BodyMetric, BodyMetricsFile } from '@/lib/types'
import { defineCommand } from './registry'

const empty: BodyMetricsFile = { metrics: [] }

export function getBodyMetrics(qc: QueryClient): BodyMetric[] {
  return (
    qc.getQueryData<BodyMetricsFile>(fileQueryKey(PATHS.bodyMetrics))?.metrics ??
    getCachedFile<BodyMetricsFile>(PATHS.bodyMetrics)?.content.metrics ??
    []
  )
}

export const logWeightCommand = defineCommand<{ weightKg: number; bodyFatPct?: number }, BodyMetric>({
  name: 'body.log_weight',
  title: 'Log body weight',
  description: "Log today's body weight (kg), optionally body fat %. Replaces today's entry if one already exists.",
  kind: 'write',
  parameters: {
    type: 'object',
    properties: { weightKg: { type: 'number' }, bodyFatPct: { type: 'number' } },
    required: ['weightKg'],
  },
  handler: (args, ctx) => {
    const metric: BodyMetric = { date: effectiveTodayISO(), weightKg: args.weightKg, bodyFatPct: args.bodyFatPct }
    const next = updateFile<BodyMetricsFile>(PATHS.bodyMetrics, empty, (current) => ({
      metrics: [...current.metrics.filter((m) => m.date !== metric.date), metric].sort((a, b) => a.date.localeCompare(b.date)),
    }))
    ctx.qc.setQueryData(fileQueryKey(PATHS.bodyMetrics), next)
    return metric
  },
  summarize: (args) => `Logged weight ${args.weightKg}kg`,
})

export const getMetricsCommand = defineCommand<{ limit?: number }, BodyMetric[]>({
  name: 'body.get_metrics',
  title: 'Get body metrics history',
  description: 'List logged body weight/body-fat entries, oldest first.',
  kind: 'read',
  parameters: { type: 'object', properties: { limit: { type: 'number', description: 'default 60' } } },
  handler: (args, ctx) => getBodyMetrics(ctx.qc).slice(-(args.limit ?? 60)),
})
