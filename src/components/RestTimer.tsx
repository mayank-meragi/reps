import { useEffect, useState } from 'react'
import { TimerReset, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  /** Timestamp (ms) the rest started + duration; null hides the timer. */
  timer: { startedAt: number; seconds: number } | null
  onDone: () => void
  onAdjust?: (deltaSeconds: number) => void
  immersive?: boolean
}

/** Floating rest countdown, pinned above the bottom nav during a session. */
export default function RestTimer({ timer, onDone, onAdjust, immersive = false }: Props) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!timer) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [timer])

  useEffect(() => {
    if (!timer) return
    const remaining = timer.seconds - (now - timer.startedAt) / 1000
    if (remaining <= 0) {
      navigator.vibrate?.([200, 100, 200])
      onDone()
    }
  }, [now, timer, onDone])

  if (!timer) return null
  const remaining = Math.max(0, Math.ceil(timer.seconds - (now - timer.startedAt) / 1000))
  const progress = 1 - remaining / timer.seconds

  return (
    <div className={cn('fixed inset-x-4 z-40 mx-auto max-w-md', immersive ? 'bottom-[calc(env(safe-area-inset-bottom)+1rem)]' : 'bottom-24 md:bottom-8')}>
      <div className="overflow-hidden rounded-full bg-[var(--ink-900)] text-white shadow-xl">
        <div className="relative flex items-center gap-3 px-4 py-2.5">
          <div className="absolute inset-0 bg-white/15" style={{ width: `${progress * 100}%` }} />
          <TimerReset className="relative size-4 shrink-0" />
          <p className="relative flex-1 text-sm font-semibold">
            Rest — {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
          </p>
          {onAdjust && (
            <>
              <button type="button" onClick={() => onAdjust(-15)} className="relative rounded-full px-2 py-1 text-xs font-bold hover:bg-white/10">−15</button>
              <button type="button" onClick={() => onAdjust(15)} className="relative rounded-full px-2 py-1 text-xs font-bold hover:bg-white/10">+15</button>
            </>
          )}
          <button type="button" onClick={onDone} aria-label="Skip rest" className="relative rounded-full p-1 hover:bg-white/10">
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
