import { useMemo, useState } from 'react'
import Body, { type ExtendedBodyPart, type Slug } from 'react-muscle-highlighter'
import { cn } from '@/lib/utils'
import { muscleMapSnapshot, type MuscleMapDatum, type MuscleRegion } from '@/lib/insights/muscleMap'
import type { Exercise, Session } from '@/lib/types'

const REGION_TO_SLUG: Record<MuscleRegion, Slug> = {
  abs: 'abs',
  abductors: 'gluteal',
  adductors: 'adductors',
  biceps: 'biceps',
  calves: 'calves',
  chest: 'chest',
  deltoids: 'deltoids',
  forearms: 'forearm',
  glutes: 'gluteal',
  hamstrings: 'hamstring',
  'lower-back': 'lower-back',
  neck: 'neck',
  quadriceps: 'quadriceps',
  trapezius: 'trapezius',
  triceps: 'triceps',
  'upper-back': 'upper-back',
}

const COLORS = ['#a8e7ce', '#65d3aa', '#24b980', '#07855b'] as const

export default function SessionMuscleMap({ session, exercises }: { session: Session; exercises: Exercise[] }) {
  const [side, setSide] = useState<'front' | 'back'>('front')
  const rows = useMemo(
    () => muscleMapSnapshot([session], session.date, new Map(exercises.map((exercise) => [exercise.id, exercise])), 'target'),
    [session, exercises],
  )
  const active = rows.filter((row) => (row.value ?? 0) > 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  const grouped = new Map<Slug, MuscleMapDatum>()
  for (const row of active) {
    const slug = REGION_TO_SLUG[row.muscle]
    const current = grouped.get(slug)
    if (!current || (row.value ?? 0) > (current.value ?? 0)) grouped.set(slug, row)
  }
  const data: ExtendedBodyPart[] = [...grouped.entries()].map(([slug, row]) => ({
    slug,
    intensity: row.level,
    color: COLORS[Math.max(0, row.level - 1)],
    styles: { stroke: 'rgba(255,255,255,0.2)', strokeWidth: 2 },
  }))

  return (
    <div className="overflow-hidden rounded-2xl bg-[var(--ink-950)] text-white">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--emerald-300)]">Target map</p>
          <p className="mt-0.5 text-sm font-semibold">Muscles this session trains</p>
        </div>
        <div className="flex rounded-full bg-white/[0.08] p-1 text-[10px] font-semibold">
          {(['front', 'back'] as const).map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={side === view}
              onClick={() => setSide(view)}
              className={cn('rounded-full px-2.5 py-1 capitalize text-white/50', side === view && 'bg-white text-[var(--ink-950)]')}
            >
              {view}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-2 px-3 py-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
        <div className="flex justify-center">
          <Body
            data={data}
            side={side}
            gender="male"
            scale={0.42}
            colors={COLORS}
            defaultFill="#292e43"
            defaultStroke="#3d4358"
            defaultStrokeWidth={2}
            border="#646b83"
          />
        </div>
        <div className="space-y-2">
          {active.slice(0, 5).map((row, index) => (
            <div key={row.muscle} className="flex items-center gap-2">
              <span className="size-2 shrink-0 rounded-full" style={{ background: COLORS[Math.min(3, Math.max(0, row.level - 1))] }} />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-white/75">{row.label}</span>
              <span className="reps-figure text-[10px] text-white/40">{row.value} sets</span>
              {index === 0 && <span className="sr-only">Primary focus</span>}
            </div>
          ))}
          {active.length === 0 && <p className="text-xs leading-relaxed text-white/45">Muscle targets will appear after exercises are added.</p>}
          <p className="pt-1 text-[9px] leading-relaxed text-white/35">Secondary involvement counts as half weight in the visual intensity.</p>
        </div>
      </div>
    </div>
  )
}
