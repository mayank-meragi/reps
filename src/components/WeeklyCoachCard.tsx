import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PATHS } from '@/lib/paths'
import { useFileQuery } from '@/hooks/useData'
import { useRunCommand } from '@/lib/commands/useRunCommand'
import type { WeeklyReview, WeeklyReviewsFile } from '@/lib/types'

export default function WeeklyCoachCard() {
  const runCommand = useRunCommand()
  const { data } = useFileQuery<WeeklyReviewsFile>(PATHS.weeklyReviews, { reviews: [] })
  const latest = data?.reviews[0]
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)

  async function generate() {
    setBusy(true)
    setNotice(null)
    setProgress('Opening your training record…')
    try {
      await runCommand<Record<string, never>, WeeklyReview>('review.generate_weekly', {}, { onProgress: setProgress })
      setNotice('Weekly review updated.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not generate the weekly review')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  async function applyAdjustment() {
    if (!latest?.proposedAdjustment) return
    setApplying(true)
    setNotice(null)
    try {
      await runCommand('program.apply_adjustment', { adjustment: latest.proposedAdjustment })
      setNotice('The coach adjustment is now part of your active plan.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not apply the plan adjustment')
    } finally {
      setApplying(false)
    }
  }

  return (
    <Card className="border-none bg-[var(--ink-900)] text-white">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/55"><Sparkles className="size-3" /> Adaptive review</p>
          <CardTitle className="text-base text-white">Weekly AI coach</CardTitle>
          {latest && <p className="mt-1 text-xs text-white/50">Week of {latest.weekStart}</p>}
        </div>
        <Button size="sm" className="bg-white text-[var(--ink-900)] hover:bg-white/90" disabled={busy} onClick={() => void generate()}>
          {busy ? 'Reviewing…' : latest ? 'Refresh' : 'Review week'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {busy && progress && <p className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs text-white/70"><span className="size-1.5 animate-pulse rounded-full bg-white" />{progress}</p>}
        {latest ? (
          <>
            <p className="text-sm leading-relaxed text-white/85">{latest.summary}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {latest.wins.length > 0 && <ReviewList title="Working" items={latest.wins} />}
              {latest.concerns.length > 0 && <ReviewList title="Watch" items={latest.concerns} />}
            </div>
            {latest.nextWeekPriorities.length > 0 && <ReviewList title="Next priorities" items={latest.nextWeekPriorities} />}
            {latest.proposedAdjustment && (
              <div className="rounded-xl bg-white/10 p-3 ring-1 ring-white/10">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/50">Plan adjustment</p>
                <p className="mt-1 text-sm text-white/85">{latest.proposedAdjustment.rationale}</p>
                <Button className="mt-3 bg-white text-[var(--ink-900)] hover:bg-white/90" size="sm" disabled={applying} onClick={() => void applyAdjustment()}>
                  {applying ? 'Applying…' : 'Apply to plan'}
                </Button>
              </div>
            )}
          </>
        ) : !busy && (
          <p className="text-sm text-white/65">The coach will inspect your plan, completed sessions, readiness, progression, and training balance before recommending a change.</p>
        )}
        {notice && <p className="text-xs text-white/60">{notice}</p>}
      </CardContent>
    </Card>
  )
}

function ReviewList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">{title}</p>
      <ul className="mt-1 space-y-1 text-sm text-white/75">
        {items.map((item) => <li key={item}>• {item}</li>)}
      </ul>
    </div>
  )
}
