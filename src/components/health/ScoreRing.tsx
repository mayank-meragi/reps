import { useId } from 'react'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export type RingScheme = 'strain' | 'sleep' | 'recovery-green' | 'recovery-yellow' | 'recovery-red'

const SIZE = 88
const STROKE = 10
const R = (SIZE - STROKE) / 2
const C = 2 * Math.PI * R

const valueText = cva('absolute inset-0 grid place-items-center font-semibold tracking-tight', {
  variants: { filled: { true: 'text-2xl text-foreground', false: 'text-base text-muted-foreground' } },
})

interface Props {
  /** 0–100, or null when there is no score yet */
  value: number | null
  label: string
  /** Gradient stops come from the --score-<scheme>-from/to theme tokens */
  scheme: RingScheme
  /** Shown instead of the number while value is null */
  placeholder?: string
  className?: string
}

/** A circular score with a gradient arc (the Bevel-style ring). Presentational only; wrap it to make it interactive. */
export default function ScoreRing({ value, label, scheme, placeholder = '—', className }: Props) {
  const gradientId = useId()
  const pct = value === null ? 0 : Math.min(100, Math.max(0, value))
  return (
    <span className={cn('flex flex-col items-center gap-2', className)}>
      <span className="relative" style={{ width: SIZE, height: SIZE }}>
        {/* size-22 matches SIZE; it also exempts the svg from the toggle-group rule that shrinks child icons to 16px */}
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-22 -rotate-90" aria-hidden>
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style={{ stopColor: `var(--score-${scheme}-from)` }} />
              <stop offset="100%" style={{ stopColor: `var(--score-${scheme}-to)` }} />
            </linearGradient>
          </defs>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" className="stroke-background" strokeWidth={STROKE} />
          {pct > 0 && (
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * C} ${C}`}
              className="transition-[stroke-dasharray] duration-700 motion-reduce:transition-none"
            />
          )}
        </svg>
        <span className={valueText({ filled: value !== null })}>
          {value === null ? (
            placeholder
          ) : (
            <span>
              {Math.round(pct)}
              <span className="text-sm">%</span>
            </span>
          )}
        </span>
      </span>
      <span className="text-base font-semibold">{label}</span>
    </span>
  )
}
