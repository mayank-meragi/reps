import type { QueryClient } from '@tanstack/react-query'
import { PATHS } from '@/lib/paths'
import { fileQueryKey } from '@/lib/queryKeys'
import { getCachedFile } from '@/lib/cache'
import { updateFile } from '@/lib/sync'
import { effectiveTodayISO } from '@/lib/dates'
import { runToolAgent } from '@/lib/agent/toolAgent'
import type { Modality, ProgramAdjustment, WeeklyReview, WeeklyReviewsFile } from '@/lib/types'
import { defineCommand } from './registry'

const emptyReviews: WeeklyReviewsFile = { reviews: [] }
const MODALITIES: Modality[] = ['strength', 'walk', 'run', 'cycle', 'swim', 'hike', 'mobility', 'sport', 'other']

function readReviews(qc: QueryClient): WeeklyReviewsFile {
  return qc.getQueryData<WeeklyReviewsFile>(fileQueryKey(PATHS.weeklyReviews))
    ?? getCachedFile<WeeklyReviewsFile>(PATHS.weeklyReviews)?.content
    ?? emptyReviews
}

function writeReviews(qc: QueryClient, mutate: (current: WeeklyReviewsFile) => WeeklyReviewsFile): WeeklyReviewsFile {
  const next = updateFile<WeeklyReviewsFile>(PATHS.weeklyReviews, emptyReviews, mutate)
  qc.setQueryData(fileQueryKey(PATHS.weeklyReviews), next)
  return next
}

function mondayFor(dateIso: string): string {
  const date = new Date(`${dateIso}T12:00:00`)
  const day = date.getDay() || 7
  date.setDate(date.getDate() - day + 1)
  return date.toISOString().slice(0, 10)
}

interface SaveReviewArgs {
  weekStart: string
  summary: string
  wins: string[]
  concerns: string[]
  nextWeekPriorities: string[]
  evidence: string[]
  consideredSessionIds: string[]
  proposedAdjustment?: ProgramAdjustment
}

export const saveWeeklyReviewCommand = defineCommand<SaveReviewArgs, WeeklyReview>({
  name: 'review.save',
  title: 'Save weekly coach review',
  description: 'Save the AI coach\'s evidence-based weekly review and optional proposed plan adjustment. This is the required final step of review.generate_weekly.',
  kind: 'write',
  parameters: {
    type: 'object',
    properties: {
      weekStart: { type: 'string', description: 'Monday in YYYY-MM-DD format' },
      summary: { type: 'string' },
      wins: { type: 'array', items: { type: 'string' } },
      concerns: { type: 'array', items: { type: 'string' } },
      nextWeekPriorities: { type: 'array', items: { type: 'string' } },
      evidence: { type: 'array', items: { type: 'string' } },
      consideredSessionIds: { type: 'array', items: { type: 'string' } },
      proposedAdjustment: {
        type: 'object',
        properties: {
          theme: { type: 'string' },
          priorities: { type: 'array', items: { type: 'string' } },
          weeklyTargets: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                modality: { type: 'string', enum: MODALITIES },
                sessions: { type: 'number' },
                intent: { type: 'string' },
              },
              required: ['modality', 'sessions', 'intent'],
            },
          },
          progressionGuidance: { type: 'string' },
          recoveryGuidance: { type: 'string' },
          daysPerWeek: { type: 'number' },
          rationale: { type: 'string' },
        },
        required: ['rationale'],
      },
    },
    required: ['weekStart', 'summary', 'wins', 'concerns', 'nextWeekPriorities', 'evidence', 'consideredSessionIds'],
  },
  handler: (args, ctx) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.weekStart)) throw new Error('weekStart must be YYYY-MM-DD')
    const now = new Date().toISOString()
    const review: WeeklyReview = {
      id: args.weekStart,
      weekStart: args.weekStart,
      generatedAt: now,
      summary: args.summary.trim(),
      wins: args.wins.filter(Boolean).slice(0, 6),
      concerns: args.concerns.filter(Boolean).slice(0, 6),
      nextWeekPriorities: args.nextWeekPriorities.filter(Boolean).slice(0, 6),
      evidence: args.evidence.filter(Boolean).slice(0, 12),
      consideredSessionIds: [...new Set(args.consideredSessionIds)],
      proposedAdjustment: args.proposedAdjustment,
      updatedAt: now,
    }
    writeReviews(ctx.qc, (current) => ({
      reviews: [...current.reviews.filter((item) => item.weekStart !== review.weekStart), review]
        .sort((a, b) => b.weekStart.localeCompare(a.weekStart)),
    }))
    return review
  },
  undo: (_args, result, ctx) => {
    writeReviews(ctx.qc, (current) => ({ reviews: current.reviews.filter((item) => item.id !== result.id) }))
  },
  summarize: (_args, result) => `Saved weekly coach review for ${result.weekStart}`,
})

export const listWeeklyReviewsCommand = defineCommand<Record<string, never>, WeeklyReview[]>({
  name: 'review.list',
  title: 'List weekly coach reviews',
  description: 'List saved weekly coach reviews, newest first.',
  kind: 'read',
  parameters: { type: 'object', properties: {} },
  handler: (_args, ctx) => readReviews(ctx.qc).reviews,
})

interface GenerateWeeklyReviewArgs { weekStart?: string; request?: string }

export const generateWeeklyReviewCommand = defineCommand<GenerateWeeklyReviewArgs, WeeklyReview>({
  name: 'review.generate_weekly',
  title: 'Generate weekly AI coach review',
  description:
    'Have the AI coach investigate the plan, sessions, readiness, progress, volume, balance, cardio and adherence using tools, then save an evidence-based review with an optional plan adjustment.',
  kind: 'read',
  parameters: {
    type: 'object',
    properties: {
      weekStart: { type: 'string', description: 'review week Monday; defaults to the current week' },
      request: { type: 'string', description: 'optional concern or coaching question to emphasize' },
    },
  },
  handler: async (args, ctx) => {
    const weekStart = args.weekStart ?? mondayFor(effectiveTodayISO())
    return runToolAgent<WeeklyReview>({
      ctx,
      finalTool: 'review.save',
      allowedTools: [
        'profile.get', 'program.get', 'session.list', 'body.get_readiness', 'body.get_metrics',
        'insights.personal_records', 'insights.e1rm_trend', 'insights.stalled_exercises',
        'insights.adherence', 'insights.modality_mix', 'insights.volume_vs_landmarks',
        'insights.cardio_trend', 'insights.session_density', 'insights.muscle_balance',
        'insights.strength_weight_trend', 'review.list', 'review.save',
      ],
      system: `You are the app's weekly training coach. Investigate before judging: use the available tools to inspect the active plan and actual evidence. Distinguish missing data from poor performance. Be concise, specific, and supportive. Propose a plan adjustment only when evidence supports changing the strategy; otherwise omit it. Any proposal must include rationale and may change only the fields exposed by the tool. Finish only by calling review.save for week ${weekStart}.`,
      user: `Create the weekly coach review for the week starting ${weekStart}. Today is ${effectiveTodayISO()}.${args.request ? ` User emphasis: ${args.request}` : ''}`,
    })
  },
})
