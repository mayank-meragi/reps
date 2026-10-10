import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import DaySwitcher from '@/components/health/DaySwitcher'
import MetricCard from '@/components/health/MetricCard'
import { METRIC_TILES } from '@/components/health/metricTiles'
import RecoveryBreakdown from '@/components/health/RecoveryBreakdown'
import ScoreRings, { type ScorePanel } from '@/components/health/ScoreRings'
import SleepBreakdown from '@/components/health/SleepBreakdown'
import StrainBreakdown from '@/components/health/StrainBreakdown'
import Timeline from '@/components/health/Timeline'
import { useHealthMonitor, useHealthScores, useSetSleepNeed } from '@/hooks/useHealth'
import { effectiveTodayISO, formatDateLabel } from '@/lib/dates'

/** Health Monitor: every number comes from the health.get_monitor / health.get_scores commands, which the AI can call too. */
export default function HealthPage() {
  const today = effectiveTodayISO()
  const [date, setDate] = useState(today)
  const [panel, setPanel] = useState<ScorePanel | null>(null)
  const monitor = useHealthMonitor(date)
  const scores = useHealthScores(date)
  const setSleepNeed = useSetSleepNeed()
  const empty = monitor.data?.metrics.every((m) => m.value === null)
  const error = monitor.error ?? scores.error

  return (
    <div className="health-theme min-h-[70vh] space-y-4 rounded-4xl bg-background p-4 text-foreground">
      <DaySwitcher date={date} today={today} onChange={setDate} />

      <ScoreRings scores={scores.data} selected={panel} onSelect={setPanel} />
      {panel === 'strain' && scores.data && <StrainBreakdown score={scores.data.strain} />}
      {panel === 'recovery' && scores.data && <RecoveryBreakdown score={scores.data.recovery} />}
      {panel === 'sleep' && scores.data && <SleepBreakdown score={scores.data.sleep} onChangeNeed={(m) => void setSleepNeed(m)} />}

      <h1 className="pt-2 text-xl font-semibold">Health Monitor</h1>

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>Could not read health data: {String(error)}</AlertDescription>
        </Alert>
      )}
      {empty && (
        <Alert>
          <AlertDescription>
            No synced data for {formatDateLabel(date)}. Connect and sync Google Health in{' '}
            <Link to="/settings" className="font-semibold text-foreground underline">
              Settings
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3">
        {monitor.data
          ? monitor.data.metrics.map((m) => <MetricCard key={m.id} metric={m} />)
          : METRIC_TILES.map((t) => <Skeleton key={t.id} className="h-36 rounded-3xl" />)}
      </div>

      <div className="space-y-1 pt-4">
        <h2 className="text-xl font-semibold">Timeline</h2>
        <p className="text-sm text-muted-foreground">
          {monitor.data?.timeline.length ?? 0} event{monitor.data?.timeline.length === 1 ? '' : 's'}
        </p>
      </div>
      <Timeline events={monitor.data?.timeline ?? []} />
    </div>
  )
}
