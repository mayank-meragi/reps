import { Dumbbell, Moon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { formatMinutes } from '@/lib/format'
import type { MonitorEvent } from '@/lib/selectors/healthMonitor'

const ICON = { sleep: Moon, exercise: Dumbbell } as const

/** The day's sleep and workouts, as returned by health.get_monitor. */
export default function Timeline({ events }: { events: MonitorEvent[] }) {
  return (
    <ul className="space-y-3">
      {events.map((e, i) => {
        const Icon = ICON[e.kind]
        return (
          <li key={i}>
            <Card>
              <CardContent className="flex items-center gap-4">
                <span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary/20 text-primary">
                  <Icon className="size-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{e.at ? new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}</p>
                  <p className="truncate text-base font-semibold capitalize">{e.title}</p>
                  {e.durationMinutes !== null && <p className="text-sm text-muted-foreground">{formatMinutes(e.durationMinutes)}</p>}
                </div>
              </CardContent>
            </Card>
          </li>
        )
      })}
    </ul>
  )
}
