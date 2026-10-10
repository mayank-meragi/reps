import { ArrowDown, ArrowUp, Check } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatFixed, formatMinutes } from '@/lib/format'
import type { MonitorMetric, MonitorStatus } from '@/lib/selectors/healthMonitor'
import IndicatorBar from './IndicatorBar'
import { METRIC_TILES } from './metricTiles'

const STATUS_ICON = { lower: ArrowDown, higher: ArrowUp, normal: Check } as const

function statusLabel(m: MonitorMetric): string {
  if (m.status === 'unknown') return m.value === null ? 'No data' : 'Building baseline'
  return m.status[0].toUpperCase() + m.status.slice(1)
}

const rangeTitle = (m: MonitorMetric) =>
  m.baseline ? `${m.label}: usual range ${formatFixed(m.baseline.low)}–${formatFixed(m.baseline.high)} ${m.unit} (${m.baseline.days}-day baseline)` : m.label

/** One Health Monitor tile: the day's value, its status against the personal baseline, and where it sits in the usual range. */
export default function MetricCard({ metric }: { metric: MonitorMetric }) {
  const tile = METRIC_TILES.find((t) => t.id === metric.id)!
  const Icon = tile.icon
  const StatusIcon = metric.status === 'unknown' ? null : STATUS_ICON[metric.status as Exclude<MonitorStatus, 'unknown'>]
  const isSleep = metric.id === 'sleep'
  return (
    <Card title={rangeTitle(metric)}>
      <CardContent className="flex items-stretch justify-between gap-3">
        <div className="min-w-0 space-y-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Icon className="size-4" aria-hidden />
            {tile.short}
          </p>
          <p className="text-3xl leading-none font-semibold tracking-tight">
            {metric.value === null ? '—' : isSleep ? formatMinutes(metric.value) : formatFixed(metric.value)}
            {metric.value !== null && !isSleep && <span className="ml-1 text-sm font-medium text-muted-foreground">{metric.unit}</span>}
          </p>
          <Badge variant={metric.tone}>
            {StatusIcon && <StatusIcon aria-hidden />}
            {statusLabel(metric)}
          </Badge>
        </div>
        <IndicatorBar orientation="vertical" value={metric.position} band={[0.25, 0.75]} tone={metric.tone} />
      </CardContent>
    </Card>
  )
}
