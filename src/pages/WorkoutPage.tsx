import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Flag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import WorkoutFeed from '@/components/workout/WorkoutFeed'
import RestTimer from '@/components/RestTimer'
import { PATHS } from '@/lib/paths'
import { currentMonthKey } from '@/lib/dates'
import { useFileQuery } from '@/hooks/useData'
import { useRunCommand } from '@/lib/commands/useRunCommand'
import { cn } from '@/lib/utils'
import type { Modality, Session } from '@/lib/types'

const CARDIO: Modality[] = ['walk', 'run', 'cycle', 'swim', 'hike']

function CardioWorkout({ session, onFinish, onExit }: { session: Session; onFinish: () => void; onExit: () => void }) {
  const runCommand = useRunCommand()
  const target = session.prescription?.target
  const [minutes, setMinutes] = useState(target?.durationMin ? String(target.durationMin) : '')
  const [distanceKm, setDistanceKm] = useState(target?.distanceKm ? String(target.distanceKm) : '')
  const [effort, setEffort] = useState<1 | 2 | 3 | 4 | 5>(target?.effort ?? 3)
  const [busy, setBusy] = useState(false)

  async function logAndFinish() {
    const durationSec = Math.round((Number(minutes) || 0) * 60)
    if (durationSec <= 0) return
    setBusy(true)
    try {
      await runCommand('session.log_cardio', {
        sessionId: session.id,
        cardio: { durationSec, distanceM: Number(distanceKm) > 0 ? Number(distanceKm) * 1000 : undefined, effort },
      })
      await runCommand('session.finish', { sessionId: session.id })
      onFinish()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center bg-[var(--ink-950)] px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+1rem)] text-white">
      <div className="mx-auto w-full max-w-md">
        <button type="button" onClick={onExit} className="mb-8 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-white/55"><ArrowLeft className="size-4" /> Session</button>
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--emerald-300)]">{session.modality} in progress</p>
        <h1 className="mt-2 text-3xl font-bold text-white">{session.name}</h1>
        {target && <p className="mt-2 text-sm text-white/55">{[target.durationMin && `${target.durationMin} min`, target.distanceKm && `${target.distanceKm} km`, target.style].filter(Boolean).join(' · ')}</p>}
        <div className="mt-8 space-y-4 rounded-2xl bg-white/[0.07] p-4 ring-1 ring-white/10">
          <label className="block text-xs font-semibold text-white/55">Duration (minutes)<Input type="number" inputMode="decimal" value={minutes} onChange={(event) => setMinutes(event.target.value)} className="mt-1.5 h-12 border-white/10 bg-white text-foreground" /></label>
          <label className="block text-xs font-semibold text-white/55">Distance (km, optional)<Input type="number" inputMode="decimal" value={distanceKm} onChange={(event) => setDistanceKm(event.target.value)} className="mt-1.5 h-12 border-white/10 bg-white text-foreground" /></label>
          <div>
            <p className="text-xs font-semibold text-white/55">Effort</p>
            <div className="mt-2 grid grid-cols-5 gap-2">
              {([1, 2, 3, 4, 5] as const).map((value) => <button key={value} type="button" onClick={() => setEffort(value)} className={cn('flex aspect-square items-center justify-center rounded-full text-sm font-bold', effort === value ? 'bg-white text-[var(--ink-950)]' : 'bg-white/8 text-white/55 ring-1 ring-white/10')}>{value}</button>)}
            </div>
          </div>
        </div>
        <Button className="mt-6 h-12 w-full rounded-xl bg-white text-base text-[var(--ink-950)] hover:bg-white/90" disabled={busy || !minutes} onClick={() => void logAndFinish()}><Flag className="size-4" /> {busy ? 'Finishing…' : 'Log & finish'}</Button>
      </div>
    </div>
  )
}

export default function WorkoutPage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const runCommand = useRunCommand()
  const { data: sessions, isLoading } = useFileQuery<Session[]>(PATHS.sessions(currentMonthKey()), [])
  const [timer, setTimer] = useState<{ startedAt: number; seconds: number } | null>(null)
  const session = sessions?.find((item) => item.id === sessionId)

  if (isLoading && !session) return <div className="min-h-dvh bg-[var(--ink-950)]" />
  if (!session) return <Navigate to="/" replace />
  if (!session.startedAt) return <Navigate to={`/session/${session.id}`} replace />
  if (session.endedAt) return <Navigate to="/" replace />

  async function finish() {
    await runCommand('session.finish', { sessionId })
    navigate('/', { replace: true })
  }

  if (CARDIO.includes(session.modality)) {
    return <CardioWorkout session={session} onFinish={() => navigate('/', { replace: true })} onExit={() => navigate(`/session/${session.id}`)} />
  }

  return (
    <>
      <WorkoutFeed session={session} sessions={sessions ?? []} onRest={(seconds) => setTimer({ startedAt: Date.now(), seconds })} onFinish={() => void finish()} onExit={() => navigate(`/session/${session.id}`)} />
      <RestTimer immersive timer={timer} onDone={() => setTimer(null)} onAdjust={(delta) => setTimer((current) => current ? { ...current, seconds: Math.max(5, current.seconds + delta) } : null)} />
    </>
  )
}
