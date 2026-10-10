import { cn } from '@/lib/utils'

const TONE = {
  normal: 'bg-tone-normal',
  favorable: 'bg-tone-favorable',
  attention: 'bg-tone-attention',
  neutral: 'bg-tone-neutral',
  strain: 'bg-score-strain',
} as const

export type IndicatorTone = keyof typeof TONE

interface Props {
  orientation?: 'horizontal' | 'vertical'
  /** Marker position along the track, 0–1; null hides the marker */
  value: number | null
  /** Fill the track from this position to `value` (use 0.5 for a diverging bar) */
  fillFrom?: number
  /** Highlighted stretch of the track, as [low, high] in 0–1 */
  band?: [number, number]
  tone?: IndicatorTone
  className?: string
}

const pct = (n: number) => `${n * 100}%`

/**
 * The one track-with-a-marker used across the health screens: the vertical range bar on
 * a metric tile, the horizontal strain target band, and the diverging recovery bars.
 * Purely visual (the numbers it shows are always printed beside it).
 */
export default function IndicatorBar({ orientation = 'horizontal', value, fillFrom, band, tone = 'neutral', className }: Props) {
  const vertical = orientation === 'vertical'
  // Vertical tracks grow upward: 1 is the top
  const along = (n: number) => (vertical ? { top: pct(1 - n) } : { left: pct(n) })
  const span = (a: number, b: number) =>
    vertical ? { top: pct(1 - Math.max(a, b)), height: pct(Math.abs(b - a)) } : { left: pct(Math.min(a, b)), width: pct(Math.abs(b - a)) }
  const color = TONE[tone]

  return (
    <div aria-hidden className={cn('relative shrink-0 rounded-full bg-background', vertical ? 'my-1 w-4 self-stretch' : 'h-3 w-full', className)}>
      {band && <div className={cn('absolute rounded-full opacity-30', color, vertical ? 'inset-x-0' : 'inset-y-0')} style={span(band[0], band[1])} />}
      {fillFrom !== undefined && value !== null && (
        <div className={cn('absolute rounded-full', color, vertical ? 'inset-x-0' : 'inset-y-0')} style={span(fillFrom, value)} />
      )}
      {fillFrom === undefined && value !== null && (
        <span
          className={cn(
            'absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-background',
            color,
            vertical ? 'left-1/2' : 'top-1/2',
          )}
          style={along(value)}
        />
      )}
      {fillFrom !== undefined && <div className={cn('absolute bg-muted-foreground/60', vertical ? 'inset-x-0 h-px' : 'inset-y-[-2px] w-px')} style={along(fillFrom)} />}
    </div>
  )
}
