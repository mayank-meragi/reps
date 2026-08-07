import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PATHS } from '@/lib/paths'
import { effectiveTodayISO } from '@/lib/dates'
import { useSessionHistory } from '@/hooks/useHistory'
import { useAllExercises } from '@/hooks/useExercises'
import { useProfile } from '@/hooks/useProfile'
import { useFileQuery } from '@/hooks/useData'
import { useRunCommand } from '@/lib/commands/useRunCommand'
import { personalRecords, e1rmTrend, stalledExercises } from '@/lib/insights/records'
import { adherenceByWeek, weeklyAdherence } from '@/lib/insights/adherence'
import { modalityMixMinutes, activeDays } from '@/lib/insights/modality'
import { weeklyVolumeVsLandmarks } from '@/lib/insights/volume'
import { cardioPaceTrend, cardioWeeklyTrend } from '@/lib/insights/cardio'
import { sessionDensity } from '@/lib/insights/density'
import { muscleBalance } from '@/lib/insights/balance'
import { strengthWeightTrend } from '@/lib/insights/combined'
import type { VolumeLandmarks } from '@/lib/engine'
import type { BodyMetricsFile, Modality } from '@/lib/types'

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function VolumeBar({ muscle, sets, landmarks }: { muscle: string; sets: number; landmarks: VolumeLandmarks }) {
  const pct = Math.min(100, (sets / landmarks.mrv) * 100)
  const zone =
    sets < landmarks.mev ? 'bg-amber-400' : sets <= landmarks.mav ? 'bg-emerald-500' : sets <= landmarks.mrv ? 'bg-sky-500' : 'bg-red-500'
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium capitalize">{muscle}</span>
        <span className="text-muted-foreground">
          {sets} sets (mev {landmarks.mev} · mav {landmarks.mav} · mrv {landmarks.mrv})
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full', zone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function BodyWeightSection() {
  const runCommand = useRunCommand()
  const { data } = useFileQuery<BodyMetricsFile>(PATHS.bodyMetrics, { metrics: [] })
  const metrics = data?.metrics ?? []
  const [weight, setWeight] = useState('')
  const [busy, setBusy] = useState(false)

  async function log() {
    const n = Number(weight)
    if (!n) return
    setBusy(true)
    try {
      await runCommand('body.log_weight', { weightKg: n })
      setWeight('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Body weight</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {metrics.length > 1 ? (
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metrics}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                <Tooltip />
                <Line type="monotone" dataKey="weightKg" stroke="var(--viz-1)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Log a couple of entries to see the trend.</p>
        )}
        <div className="flex gap-2">
          <Input type="number" inputMode="decimal" placeholder="kg" value={weight} onChange={(e) => setWeight(e.target.value)} className="max-w-28" />
          <Button size="sm" disabled={busy || !weight} onClick={() => void log()}>
            Log today
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function paceLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, '0')}/km`
}

function BalanceBar({ leftLabel, rightLabel, leftSets, rightSets }: { leftLabel: string; rightLabel: string; leftSets: number; rightSets: number }) {
  const total = leftSets + rightSets
  const leftPct = total > 0 ? (leftSets / total) * 100 : 50
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span>{leftLabel} · {leftSets}</span>
        <span>{rightSets} · {rightLabel}</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        <div className="bg-[var(--viz-1)]" style={{ width: `${leftPct}%` }} />
        <div className="flex-1 bg-[var(--viz-3)]" />
      </div>
    </div>
  )
}

export default function InsightsPage() {
  const { data: sessions, isLoading, isError } = useSessionHistory(500)
  const { data: exercises } = useAllExercises()
  const { profile } = useProfile()
  const { data: bodyFile } = useFileQuery<BodyMetricsFile>(PATHS.bodyMetrics, { metrics: [] })
  const today = effectiveTodayISO()
  const all = useMemo(() => sessions ?? [], [sessions])

  const byId = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises])
  const adherence = useMemo(() => weeklyAdherence(all, profile?.daysPerWeek ?? 3, today), [all, profile, today])
  const adherenceHistory = useMemo(() => adherenceByWeek(all, profile?.daysPerWeek ?? 3, today), [all, profile, today])
  const active = useMemo(() => activeDays(all, today), [all, today])
  const mix = useMemo(() => modalityMixMinutes(all, today), [all, today])
  const volumes = useMemo(
    () => weeklyVolumeVsLandmarks(all, today, byId, profile?.experience ?? 'beginner'),
    [all, byId, profile, today],
  )
  const prs = useMemo(() => personalRecords(all), [all])
  const stalled = useMemo(() => stalledExercises(all, today), [all, today])
  const cardio = useMemo(() => cardioWeeklyTrend(all, today), [all, today])
  const cardioModalities = useMemo(
    () => [...new Set(all.filter((s) => s.cardio?.distanceM).map((s) => s.modality))],
    [all],
  )
  const [paceModality, setPaceModality] = useState<Modality | undefined>(undefined)
  const pace = useMemo(() => cardioPaceTrend(all, paceModality), [all, paceModality])
  const density = useMemo(() => sessionDensity(all), [all])
  const balances = useMemo(() => muscleBalance(all, today, byId), [all, today, byId])

  const [selectedExercise, setSelectedExercise] = useState<string | null>(null)
  const topExerciseId = selectedExercise ?? prs[0]?.exerciseId ?? null
  const trend = useMemo(() => (topExerciseId ? e1rmTrend(topExerciseId, all) : []), [topExerciseId, all])
  const combinedTrend = useMemo(
    () => (topExerciseId ? strengthWeightTrend(topExerciseId, all, bodyFile?.metrics ?? []) : []),
    [topExerciseId, all, bodyFile],
  )
  const trendName = prs.find((p) => p.exerciseId === topExerciseId)?.name

  return (
    <div className="space-y-3 pb-16">
      <h1 className="text-xl font-semibold tracking-tight">Insights</h1>

      {isLoading && <p className="text-sm text-muted-foreground">Loading training history…</p>}
      {isError && <p className="text-sm text-destructive">Training history could not be loaded. Check sync and try again.</p>}

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="This week" value={`${adherence.completedThisWeek}/${adherence.target}`} sub="sessions" />
        <StatTile label="Streak" value={String(adherence.streak)} sub="sessions" />
        <StatTile label="Active days" value={String(active)} sub="last 7 days" />
      </div>

      {all.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Adherence by week</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={adherenceHistory}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="planned" fill="var(--ink-200)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="completed" fill="var(--viz-1)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {mix.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Modality mix (7 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={mix}>
                  <XAxis dataKey="modality" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="minutes" fill="var(--viz-2)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {volumes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Weekly volume vs landmarks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {volumes.map((v) => (
              <VolumeBar key={v.muscle} muscle={v.muscle} sets={v.sets} landmarks={v.landmarks} />
            ))}
          </CardContent>
        </Card>
      )}

      {prs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Personal records</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {prs.slice(0, 10).map((pr) => (
                <button
                  key={pr.exerciseId}
                  type="button"
                  onClick={() => setSelectedExercise(pr.exerciseId)}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-semibold',
                    pr.exerciseId === topExerciseId ? 'bg-[var(--ink-900)] text-white' : 'border border-input text-muted-foreground',
                  )}
                >
                  {pr.name} · {pr.weight}×{pr.reps}
                </button>
              ))}
            </div>
            {combinedTrend.length > 1 && (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={combinedTrend}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
                    <YAxis yAxisId="strength" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                    <YAxis yAxisId="weight" orientation="right" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line yAxisId="strength" type="monotone" dataKey="e1rm" name="e1RM kg" stroke="var(--viz-1)" strokeWidth={2} connectNulls dot={false} />
                    <Line yAxisId="weight" type="monotone" dataKey="weightKg" name="Body kg" stroke="var(--viz-4)" strokeWidth={2} connectNulls dot={false} />
                    {trend.filter((point) => point.isPr).map((point) => (
                      <ReferenceDot
                        key={`${point.date}-${point.e1rm}`}
                        yAxisId="strength"
                        x={point.date}
                        y={point.e1rm}
                        r={4}
                        fill="var(--viz-5)"
                        stroke="white"
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
            {trendName && <p className="text-xs text-muted-foreground">e1RM trend — {trendName}. Gold dots mark new PRs.</p>}
          </CardContent>
        </Card>
      )}

      {cardio.some((point) => point.sessions > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Cardio trend</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={cardio}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="minutes" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="distance" orientation="right" tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="minutes" dataKey="durationMin" name="Minutes" fill="var(--viz-2)" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="distance" type="monotone" dataKey="distanceKm" name="Distance km" stroke="var(--viz-5)" strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {pace.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPaceModality(undefined)}
                    className={cn('rounded-full px-2.5 py-1 text-xs', !paceModality ? 'bg-[var(--ink-900)] text-white' : 'border border-input')}
                  >
                    All pace
                  </button>
                  {cardioModalities.map((modality) => (
                    <button
                      key={modality}
                      type="button"
                      onClick={() => setPaceModality(modality)}
                      className={cn('rounded-full px-2.5 py-1 text-xs capitalize', paceModality === modality ? 'bg-[var(--ink-900)] text-white' : 'border border-input')}
                    >
                      {modality}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Latest pace: <span className="font-medium text-foreground">{paceLabel(pace[pace.length - 1].paceSecPerKm)}</span> over {pace[pace.length - 1].distanceKm}km
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {density.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Session density</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={density}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="workMin" name="Working min" stackId="time" fill="var(--viz-1)" />
                  <Bar dataKey="restMin" name="Rest / transition min" stackId="time" fill="var(--viz-3)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-muted-foreground">
              Latest: {density[density.length - 1].completedSets} sets · {density[density.length - 1].setsPerHour} sets/hour
            </p>
          </CardContent>
        </Card>
      )}

      {balances.some((balance) => balance.leftSets + balance.rightSets > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Muscle balance (4 weeks)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {balances.map((balance) => (
              <BalanceBar
                key={balance.key}
                leftLabel={balance.leftLabel}
                rightLabel={balance.rightLabel}
                leftSets={balance.leftSets}
                rightSets={balance.rightSets}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {stalled.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Might be stalling</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {stalled.map((s) => (
              <p key={s.exerciseId} className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{s.name}</span> — no PR in {s.daysSincePR} days
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <BodyWeightSection />

      {!isLoading && all.length === 0 && (
        <Card>
          <CardContent className="py-6 text-center">
            <p className="text-sm font-semibold">Your trends will build as you train</p>
            <p className="mt-1 text-xs text-muted-foreground">Finish a session to unlock adherence, PR, volume, cardio, and balance insights.</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
