import { useEffect, useState } from 'react'
import { Dumbbell, Images, Play } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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

export function ExerciseMedia({ exercise }: { exercise: Exercise }) {
  const [frame, setFrame] = useState(0)
  const frames = exercise.images.map(exerciseImageUrl)

  useEffect(() => {
    setFrame(0)
    if (exercise.videoUrl || exercise.gifUrl || frames.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(() => setFrame((current) => (current + 1) % frames.length), 1100)
    return () => window.clearInterval(timer)
  }, [exercise.id, exercise.videoUrl, exercise.gifUrl, frames.length])

  if (exercise.videoUrl) {
    return (
      <div className="overflow-hidden rounded-xl bg-black">
        <video className="aspect-[4/3] w-full object-contain" src={exerciseImageUrl(exercise.videoUrl)} poster={frames[0]} controls autoPlay muted loop playsInline />
      </div>
    )
  }

  if (exercise.gifUrl) {
    return <img className="aspect-[4/3] w-full rounded-xl bg-white object-contain" src={exerciseImageUrl(exercise.gifUrl)} alt={`${exercise.name} demonstration`} />
  }

  if (frames.length === 0) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-xl bg-[var(--surface-sunken)] text-muted-foreground">
        <div className="text-center">
          <Dumbbell className="mx-auto size-10" />
          <p className="mt-2 text-xs">No demonstration available</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-white ring-1 ring-border">
        {frames.map((src, index) => (
          <img
            key={src}
            src={src}
            alt={`${exercise.name}, position ${index + 1}`}
            className={cn('absolute inset-0 size-full object-contain transition-opacity duration-300', index === frame ? 'opacity-100' : 'opacity-0')}
          />
        ))}
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
          <Images className="size-3" /> Demo · {frame + 1}/{frames.length}
        </span>
      </div>
      {frames.length > 1 && (
        <div className="flex justify-center gap-1.5" aria-label="Demonstration frames">
          {frames.map((_, index) => (
            <button
              key={index}
              type="button"
              aria-label={`Show position ${index + 1}`}
              aria-pressed={index === frame}
              onClick={() => setFrame(index)}
              className={cn('h-1.5 rounded-full transition-all', index === frame ? 'w-6 bg-foreground' : 'w-1.5 bg-border hover:bg-muted-foreground')}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function ExerciseDetailsDialog({ exercise, open, onOpenChange }: { exercise: Exercise; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <div className="pr-8">
            <p className="reps-eyebrow mb-1">Movement guide</p>
            <DialogTitle className="text-left text-lg">{exercise.name}</DialogTitle>
          </div>
        </DialogHeader>

        <ExerciseMedia exercise={exercise} />

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary" className="capitalize">{exercise.category}</Badge>
          <Badge variant="outline" className="capitalize">{exercise.level}</Badge>
          {exercise.equipment && <Badge variant="outline" className="capitalize">{exercise.equipment}</Badge>}
          {exercise.mechanic && <Badge variant="outline" className="capitalize">{exercise.mechanic}</Badge>}
        </div>

        <div className="grid gap-3 rounded-lg bg-[var(--surface-sunken)] p-3 sm:grid-cols-2">
          <div>
            <p className="reps-eyebrow">Primary</p>
            <p className="mt-1 text-sm capitalize">{exercise.primaryMuscles.join(', ') || 'Not specified'}</p>
          </div>
          <div>
            <p className="reps-eyebrow">Secondary</p>
            <p className="mt-1 text-sm capitalize">{exercise.secondaryMuscles.join(', ') || 'None'}</p>
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold">How to perform it</p>
          {exercise.instructions.length > 0 ? (
            <ol className="space-y-3">
              {exercise.instructions.map((instruction, index) => (
                <li key={`${index}-${instruction}`} className="grid grid-cols-[1.5rem_1fr] gap-2 text-sm leading-relaxed text-muted-foreground">
                  <span className="reps-figure flex size-6 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background">{index + 1}</span>
                  <span>{instruction}</span>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-muted-foreground">No written instructions are available for this exercise.</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ExerciseDetailsTrigger({ exercise, className }: { exercise?: Exercise; className?: string }) {
  const [open, setOpen] = useState(false)
  if (!exercise) return <ExerciseThumb className={className} />

  return (
    <>
      <button
        type="button"
        aria-label={`View details for ${exercise.name}`}
        className="group relative shrink-0 rounded-[var(--radius-md)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen(true)}
      >
        <ExerciseThumb exercise={exercise} className={className} />
        <span className="absolute inset-0 flex items-center justify-center rounded-[var(--radius-md)] bg-black/0 text-white opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100 group-focus-visible:bg-black/35 group-focus-visible:opacity-100">
          <Play className="size-4 fill-current" />
        </span>
      </button>
      <ExerciseDetailsDialog exercise={exercise} open={open} onOpenChange={setOpen} />
    </>
  )
}
