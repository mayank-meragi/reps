import { Link } from 'react-router-dom'
import { ChevronRight, Clock3, Dumbbell, MapPin, Play } from 'lucide-react'
import { ExerciseThumb } from '@/components/ExerciseImage'
import type { Exercise, Session, Venue } from '@/lib/types'

interface Props {
  session: Session
  programName?: string
  venue?: Venue
  exercises: Exercise[]
}

export default function NextSessionCard({ session, programName, venue, exercises }: Props) {
  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]))
  const hero = byId.get(session.exercises[0]?.exerciseId)
  const totalSets = session.exercises.reduce((sum, exercise) => sum + exercise.sets.filter((set) => set.type !== 'warmup').length, 0)
  const doneSets = session.exercises.reduce((sum, exercise) => sum + exercise.sets.filter((set) => set.done).length, 0)
  const resume = Boolean(session.startedAt)
  const duration = session.prescription?.availableMinutes
    ?? Math.max(15, Math.round(totalSets * 2.5 + session.exercises.length * 3))

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="reps-eyebrow">{resume ? 'Workout in progress' : 'Next session'}</p>
        {programName && <p className="max-w-[55%] truncate text-[10px] font-semibold text-muted-foreground">{programName}</p>}
      </div>
      <Link
        to={`/session/${session.id}`}
        aria-label={`${resume ? 'Resume' : 'Open'} ${session.name}`}
        className="group block overflow-hidden rounded-[1.35rem] bg-[var(--ink-950)] text-white shadow-[0_18px_45px_rgba(21,24,50,0.2)] outline-none transition-transform active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      >
        <div className="grid min-h-48 grid-cols-[minmax(0,1.12fr)_minmax(8rem,0.88fr)]">
          <div className="flex min-w-0 flex-col p-5 pr-2">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--emerald-300)]">
              {resume ? <Play className="size-3.5 fill-current" /> : <Dumbbell className="size-3.5" />}
              {resume ? `${doneSets}/${Math.max(1, totalSets)} sets complete` : 'Ready when you are'}
            </div>
            <h2 className="mt-3 text-xl font-bold leading-tight text-white">{session.name}</h2>
            <p className="mt-1 line-clamp-2 text-xs capitalize leading-relaxed text-white/55">
              {session.focus.length > 0 ? session.focus.join(' · ') : session.modality}
            </p>
            <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-4 text-[11px] font-medium text-white/65">
              <span className="inline-flex items-center gap-1"><Clock3 className="size-3.5" /> {duration} min</span>
              <span className="inline-flex items-center gap-1"><Dumbbell className="size-3.5" /> {session.exercises.length} exercises</span>
              {venue && <span className="inline-flex max-w-full items-center gap-1 truncate"><MapPin className="size-3.5" /> {venue.name}</span>}
            </div>
          </div>
          <div className="relative min-h-48 overflow-hidden bg-[var(--ink-900)]">
            <ExerciseThumb exercise={hero} className="absolute inset-0 size-full rounded-none object-cover opacity-80 transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none" />
            <div className="absolute inset-0 bg-gradient-to-r from-[var(--ink-950)] via-[var(--ink-950)]/15 to-transparent" />
            <span className="absolute bottom-4 right-4 flex size-11 items-center justify-center rounded-full bg-white text-[var(--ink-950)] shadow-lg transition-transform group-hover:translate-x-0.5">
              <ChevronRight className="size-5" />
            </span>
          </div>
        </div>
      </Link>
    </section>
  )
}
