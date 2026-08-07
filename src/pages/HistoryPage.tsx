import { Trash2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { useSessionHistory } from '@/hooks/useHistory'
import { useRunCommand } from '@/lib/commands/useRunCommand'
import { formatDuration, sessionVolumeKg } from '@/lib/sessionStats'
import type { Session } from '@/lib/types'

function summarize(session: Session): string {
  if (session.exercises.length > 0) {
    return `${session.exercises.length} exercise${session.exercises.length > 1 ? 's' : ''} · volume ${Math.round(sessionVolumeKg(session)).toLocaleString()}kg`
  }
  if (session.cardio) {
    return `${formatDuration(session.cardio.durationSec)}${session.cardio.distanceM ? ` · ${(session.cardio.distanceM / 1000).toFixed(1)}km` : ''}`
  }
  return 'No sets logged'
}

function SessionRow({ session }: { session: Session }) {
  const runCommand = useRunCommand()
  return (
    <Card>
      <CardContent className="flex items-center justify-between py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {session.name} <span className="text-xs font-normal capitalize text-muted-foreground">· {session.modality}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {session.date} · {summarize(session)}
          </p>
        </div>
        <button
          type="button"
          aria-label="Delete session"
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
          onClick={() => void runCommand('session.delete', { sessionId: session.id })}
        >
          <Trash2 className="size-4" />
        </button>
      </CardContent>
    </Card>
  )
}

export default function HistoryPage() {
  const { data: sessions, isLoading } = useSessionHistory()
  const sorted = [...(sessions ?? [])].reverse()

  return (
    <div className="space-y-3 pb-16">
      <h1 className="text-xl font-semibold tracking-tight">History</h1>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && sorted.length === 0 && <p className="text-sm text-muted-foreground">No sessions logged yet.</p>}
      <div className="space-y-2">
        {sorted.map((s) => (
          <SessionRow key={s.id} session={s} />
        ))}
      </div>
    </div>
  )
}
