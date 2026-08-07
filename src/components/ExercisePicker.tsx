import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useAllExercises } from '@/hooks/useExercises'
import type { Exercise } from '@/lib/types'
import { ExerciseThumb } from './ExerciseImage'

interface Props {
  open: boolean
  title?: string
  /** Bias the list toward these muscles (unused for now, mirrors the swap-picker hook point) */
  muscles?: string[]
  onPick: (exercise: Exercise) => void
  onClose: () => void
}

export default function ExercisePicker({ open, title = 'Add exercise', muscles, onPick, onClose }: Props) {
  const { data: exercises } = useAllExercises()
  const [search, setSearch] = useState('')

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    let result = exercises.filter((e) => !q || e.name.toLowerCase().includes(q))
    if (!q && muscles && muscles.length > 0) {
      result = [...result].sort(
        (a, b) =>
          (b.primaryMuscles.some((m) => muscles.includes(m)) ? 1 : 0) -
          (a.primaryMuscles.some((m) => muscles.includes(m)) ? 1 : 0),
      )
    }
    return result.slice(0, 30)
  }, [exercises, search, muscles])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80svh] gap-3 overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-left">{title}</DialogTitle>
        </DialogHeader>
        <Input autoFocus placeholder="Search exercises…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="space-y-1">
          {list.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => {
                onPick(e)
                setSearch('')
              }}
              className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] p-2 text-left hover:bg-[var(--surface-sunken)]"
            >
              <ExerciseThumb exercise={e} className="size-10" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--text-strong)]">{e.name}</p>
                <p className="truncate text-xs text-muted-foreground">{e.primaryMuscles.join(', ')}</p>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
