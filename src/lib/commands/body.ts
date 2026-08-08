import type { QueryClient } from '@tanstack/react-query'
import { PATHS } from '@/lib/paths'
import { fileQueryKey } from '@/lib/queryKeys'
import { getCachedFile } from '@/lib/cache'
import { loadFile, updateFile } from '@/lib/sync'
import { effectiveTodayISO } from '@/lib/dates'
import type { BodyMetric, BodyMetricsFile, Readiness, ReadinessFile } from '@/lib/types'
import { defineCommand } from './registry'

const empty: BodyMetricsFile = { metrics: [] }
const emptyReadiness: ReadinessFile = { entries: [] }

export function getBodyMetrics(qc: QueryClient): BodyMetric[] {
  return (
    qc.getQueryData<BodyMetricsFile>(fileQueryKey(PATHS.bodyMetrics))?.metrics ??
    getCachedFile<BodyMetricsFile>(PATHS.bodyMetrics)?.content.metrics ??
    []
  )
}

function getReadiness(qc: QueryClient): Readiness[] {
  return (
    qc.getQueryData<ReadinessFile>(fileQueryKey(PATHS.readiness))?.entries ??
    getCachedFile<ReadinessFile>(PATHS.readiness)?.content.entries ??
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

export const logReadinessCommand = defineCommand<Omit<Readiness, 'id' | 'date'> & { date?: string }, Readiness>({
  name: 'body.log_readiness',
  title: 'Log readiness',
  description: 'Log sleep, soreness, stress, energy, HRV, resting heart rate, or a recovery note for a date. Replaces the entry for that date.',
  kind: 'write',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'YYYY-MM-DD; defaults to today' },
      sleepHours: { type: 'number' },
      soreness: { type: 'number', description: '1 low to 5 high' },
      stress: { type: 'number', description: '1 low to 5 high' },
      energy: { type: 'number', description: '1 low to 5 high' },
      hrv: { type: 'number' },
      restingHeartRate: { type: 'number' },
      note: { type: 'string' },
    },
  },
  handler: (args, ctx) => {
    const date = args.date ?? effectiveTodayISO()
    const existing = getReadiness(ctx.qc).find((entry) => entry.date === date)
    const entry: Readiness = { ...args, id: existing?.id ?? crypto.randomUUID(), date }
    const next = updateFile<ReadinessFile>(PATHS.readiness, emptyReadiness, (current) => ({
      entries: [...current.entries.filter((item) => item.date !== date), entry].sort((a, b) => a.date.localeCompare(b.date)),
    }))
    ctx.qc.setQueryData(fileQueryKey(PATHS.readiness), next)
    return entry
  },
  summarize: () => 'Logged readiness',
})

export const getReadinessCommand = defineCommand<{ limit?: number }, Readiness[]>({
  name: 'body.get_readiness',
  title: 'Get readiness history',
  description: 'Read recent sleep, soreness, stress, energy, HRV, resting heart rate, and recovery notes, newest last.',
  kind: 'read',
  parameters: { type: 'object', properties: { limit: { type: 'number', description: 'default 14' } } },
  handler: async (args) => (await loadFile<ReadinessFile>(PATHS.readiness, emptyReadiness)).entries.slice(-(args.limit ?? 14)),
})
