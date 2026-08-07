import type { QueryClient } from '@tanstack/react-query'
import { PATHS } from '@/lib/paths'
import { fileQueryKey } from '@/lib/queryKeys'
import { getCachedFile } from '@/lib/cache'
import { updateFile } from '@/lib/sync'
import type { CoachMemory } from '@/lib/types'
import { defineCommand } from './registry'

const empty: CoachMemory = { summary: '', updatedAt: '', sessionCount: 0 }

export function getCoachMemory(qc: QueryClient): CoachMemory {
  return qc.getQueryData<CoachMemory>(fileQueryKey(PATHS.coachMemory)) ?? getCachedFile<CoachMemory>(PATHS.coachMemory)?.content ?? empty
}

export const getMemoryCommand = defineCommand<Record<string, never>, CoachMemory>({
  name: 'memory.get',
  title: 'Read coach notes',
  description: 'Read the durable coach notes kept about this user across sessions and conversations.',
  kind: 'read',
  parameters: { type: 'object', properties: {} },
  handler: (_args, ctx) => getCoachMemory(ctx.qc),
})

export const updateMemoryCommand = defineCommand<{ summary: string }, CoachMemory>({
  name: 'memory.update',
  title: 'Update coach notes',
  description:
    'Rewrite the durable coach notes (client facts, preferences, working weights, patterns) injected into future programming and conversations. Replaces the whole summary — include everything worth keeping, not just what changed, and never drop permanent facts (age, injuries, goals) that were already there.',
  kind: 'write',
  parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
  handler: (args, ctx) => {
    const next: CoachMemory = {
      summary: args.summary.trim(),
      updatedAt: new Date().toISOString(),
      sessionCount: getCoachMemory(ctx.qc).sessionCount,
    }
    const written = updateFile<CoachMemory>(PATHS.coachMemory, empty, () => next)
    ctx.qc.setQueryData(fileQueryKey(PATHS.coachMemory), written)
    return written
  },
  summarize: () => 'Updated coach notes',
})
