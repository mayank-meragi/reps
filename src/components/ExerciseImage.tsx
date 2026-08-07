import { useState } from 'react'
import { Dumbbell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { exerciseImageUrl } from '@/lib/exerciseDb'
import type { Exercise } from '@/lib/types'

/** Thumbnail: first frame, graceful fallback icon. */
export function ExerciseThumb({ exercise, className }: { exercise?: Exercise; className?: string }) {
  const [failed, setFailed] = useState(false)
  const src = exercise?.images[0]
  if (!src || failed) {
    return (
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-sunken)] text-[var(--text-muted)]',
          className,
        )}
      >
        <Dumbbell className="size-[45%]" strokeWidth={2} />
      </span>
    )
  }
  return (
    <img
      src={exerciseImageUrl(src)}
      alt={exercise.name}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn('shrink-0 rounded-[var(--radius-md)] bg-white object-cover object-top', className)}
    />
  )
}
