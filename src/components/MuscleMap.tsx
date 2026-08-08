import { useMemo, useState } from 'react'
import Body, { type ExtendedBodyPart, type Slug } from 'react-muscle-highlighter'
import { Activity, ScanLine } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  muscleMapSnapshot,
  type MuscleMapDatum,
  type MuscleMapMode,
  type MuscleRegion,
} from '@/lib/insights/muscleMap'
import type { Exercise, Session } from '@/lib/types'

interface Props {
  sessions: Session[]
  exercises: Exercise[]
  today: string
}

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

const SLUG_TO_REGIONS = Object.entries(REGION_TO_SLUG).reduce<Partial<Record<Slug, MuscleRegion[]>>>((acc, [region, slug]) => {
  acc[slug] = [...(acc[slug] ?? []), region as MuscleRegion]
  return acc
}, {})
SLUG_TO_REGIONS.obliques = ['abs']

const MODES: { id: MuscleMapMode; label: string; range: string }[] = [
  { id: 'target', label: 'Today', range: 'Prescribed' },
  { id: 'load', label: '7 days', range: 'Completed' },
  { id: 'recovery', label: 'Recovery', range: 'Estimated' },
  { id: 'progress', label: '12 weeks', range: 'Progress' },
]

const PALETTES: Record<MuscleMapMode, readonly string[]> = {
  target: ['#a8e7ce', '#65d3aa', '#24b980', '#07855b'],
  load: ['#d9d4ff', '#b4a9fb', '#8774ed', '#6047d8'],
  recovery: ['#a8e7ce', '#f2c85b', '#ef985c', '#e75d50'],
  progress: ['#b9eee0', '#72d8ba', '#2bbb8b', '#07855b'],
}

function isMeaningful(row: MuscleMapDatum): boolean {
  if (row.mode === 'recovery') return row.daysSinceTrained !== null
  return row.value !== null && row.value !== 0
}

function rowColor(row: MuscleMapDatum): string | undefined {
  if (!isMeaningful(row)) return undefined
  if (row.mode === 'recovery') {
    if (row.status === 'Fatigued') return '#e75d50'
    if (row.status === 'Recovering') return '#f2c85b'
    return '#65d3aa'
  }
  if (row.mode === 'progress' && (row.value ?? 0) < -1) return '#ef7a50'
  return PALETTES[row.mode][Math.max(0, row.level - 1)]
}

function headline(row: MuscleMapDatum): string {
  if (row.mode === 'recovery') return row.daysSinceTrained === null ? 'No estimate' : `${row.value}/100`
  if (row.mode === 'progress') return row.value === null ? 'Not enough data' : `${row.value > 0 ? '+' : ''}${row.value}%`
  return `${row.value ?? 0} weighted sets`
}

function detailCaption(row: MuscleMapDatum): string {
  if (row.mode === 'target') return 'Today’s prescribed work'
  if (row.mode === 'load') return 'Completed work over the last 7 days'
  if (row.mode === 'recovery') return 'Training-history estimate, not a biological measurement'
  return 'Median e1RM change across comparable lifts'
}

function MuscleDetail({ row }: { row: MuscleMapDatum }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.055] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/50">Selected region</p>
          <h3 className="mt-1 text-xl font-bold text-white">{row.label}</h3>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white/60">
          {row.confidence} confidence
        </span>
      </div>

      <p className="reps-figure mt-5 text-3xl font-bold text-white">{headline(row)}</p>
      <p className="mt-1 text-xs leading-relaxed text-white/50">{detailCaption(row)}</p>
      <div className="mt-4 h-px bg-white/10" />

      {row.evidence.length > 0 ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {row.evidence.map((item) => (
            <div key={item} className="rounded-xl bg-black/15 px-3 py-2 text-xs leading-snug text-white/70">{item}</div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-white/55">
          {row.mode === 'target'
            ? 'This region is not part of today’s prescribed workout.'
            : row.mode === 'progress'
              ? 'Log the same weighted exercises on multiple dates to build a comparable trend.'
              : 'Complete more sessions to build this signal.'}
        </p>
      )}

      {row.exercises.length > 0 && (
        <div className="mt-5 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">Contributing exercises</p>
          {row.exercises.slice(0, 5).map((exercise) => (
            <div key={exercise.exerciseId} className="flex items-center justify-between gap-3 border-b border-white/[0.07] py-2 last:border-0">
              <span className="truncate text-sm font-medium text-white/85">{exercise.name}</span>
              <span className="reps-figure shrink-0 text-xs text-white/50">
                {row.mode === 'progress'
                  ? `${(exercise.e1rmChangePct ?? 0) > 0 ? '+' : ''}${exercise.e1rmChangePct}%`
                  : exercise.directSets > 0
                    ? `${exercise.directSets} direct`
                    : `${exercise.indirectSets} secondary`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function MuscleMap({ sessions, exercises, today }: Props) {
  const [mode, setMode] = useState<MuscleMapMode>('target')
  const [side, setSide] = useState<'front' | 'back'>('front')
  const [selected, setSelected] = useState<MuscleRegion>('chest')
  const byId = useMemo(() => new Map(exercises.map((exercise) => [exercise.id, exercise])), [exercises])
  const rows = useMemo(
    () => muscleMapSnapshot(sessions, today, byId, mode, mode === 'progress' ? 84 : 7),
    [sessions, today, byId, mode],
  )
  const selectedRow = rows.find((row) => row.muscle === selected) ?? rows[0]
  const activeRows = rows.filter(isMeaningful).sort((a, b) => (b.value ?? 0) - (a.value ?? 0))

  const bodyData = Object.entries(SLUG_TO_REGIONS).flatMap<ExtendedBodyPart>(([slug, regions]) => {
    if (!regions?.length) return []
    const candidates = regions.map((region) => rows.find((row) => row.muscle === region)).filter((row): row is MuscleMapDatum => Boolean(row))
    const strongest = [...candidates].sort((a, b) => (b.level - a.level) || ((b.value ?? 0) - (a.value ?? 0)))[0]
    if (!strongest) return []
    const isSelected = regions.includes(selected)
    return [{
      slug: slug as Slug,
      intensity: strongest.level || undefined,
      color: rowColor(strongest),
      styles: isSelected
        ? { stroke: '#ffffff', strokeWidth: 7 }
        : { stroke: candidates.some(isMeaningful) ? 'rgba(255,255,255,0.2)' : '#3d4358', strokeWidth: 2 },
    }]
  })

  function selectFromBody(part: ExtendedBodyPart) {
    if (!part.slug) return
    const regions = SLUG_TO_REGIONS[part.slug]
    if (!regions?.length) return
    const best = regions
      .map((region) => rows.find((row) => row.muscle === region))
      .filter((row): row is MuscleMapDatum => Boolean(row))
      .sort((a, b) => (Number(isMeaningful(b)) - Number(isMeaningful(a))) || ((b.value ?? 0) - (a.value ?? 0)))[0]
    if (best) setSelected(best.muscle)
  }

  return (
    <section className="overflow-hidden rounded-[1.4rem] bg-[var(--ink-950)] text-white shadow-[0_20px_50px_rgba(21,24,50,0.18)]">
      <div className="border-b border-white/10 px-4 pb-3 pt-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300/80">
              <ScanLine className="size-3.5" /> Body readout
            </div>
            <h2 className="mt-1 text-lg font-bold text-white">Where your training is landing</h2>
          </div>
          <div className="flex rounded-full bg-white/[0.07] p-1 text-[11px] font-semibold">
            {(['front', 'back'] as const).map((view) => (
              <button
                key={view}
                type="button"
                aria-pressed={side === view}
                onClick={() => setSide(view)}
                className={cn('rounded-full px-3 py-1.5 capitalize text-white/55 transition-colors', side === view && 'bg-white text-[var(--ink-950)]')}
              >
                {view}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Muscle map metric">
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={mode === item.id}
              onClick={() => setMode(item.id)}
              className={cn(
                'min-w-[76px] flex-1 rounded-xl px-2 py-2 text-left transition-colors',
                mode === item.id ? 'bg-white/[0.12] text-white ring-1 ring-white/15' : 'text-white/45 hover:bg-white/[0.06]',
              )}
            >
              <span className="block text-xs font-bold">{item.label}</span>
              <span className="block text-[9px] uppercase tracking-wide">{item.range}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-[230px_minmax(0,1fr)]">
        <div className="flex min-h-[310px] flex-col items-center justify-between overflow-hidden rounded-2xl bg-[radial-gradient(circle_at_50%_42%,rgba(87,99,142,0.25),rgba(9,11,27,0.15)_62%)] px-3 py-3">
          <div className="pointer-events-none flex w-full items-center justify-between text-[10px] font-semibold uppercase tracking-[0.1em] text-white/35">
            <span>{side} view</span>
            <span>{activeRows.length} active</span>
          </div>
          <div className="my-1 transition-opacity duration-200 motion-reduce:transition-none">
            <Body
              data={bodyData}
              side={side}
              gender="male"
              scale={0.72}
              colors={PALETTES[mode]}
              defaultFill="#292e43"
              defaultStroke="#3d4358"
              defaultStrokeWidth={2}
              border="#646b83"
              onBodyPartPress={selectFromBody}
            />
          </div>
          <p className="text-center text-[10px] text-white/35">Tap a muscle for its evidence</p>
        </div>

        <MuscleDetail row={selectedRow} />
      </div>

      <div className="border-t border-white/10 px-4 py-4 sm:px-5">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">
          <Activity className="size-3.5" /> Regions with data
        </div>
        {activeRows.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Muscle regions with data">
            {activeRows.map((row) => (
              <button
                key={row.muscle}
                type="button"
                onClick={() => setSelected(row.muscle)}
                className={cn(
                  'shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300',
                  selected === row.muscle
                    ? 'border-white bg-white text-[var(--ink-950)]'
                    : 'border-white/10 bg-white/[0.04] text-white/65 hover:bg-white/[0.09]',
                )}
              >
                {row.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-white/45">
            {mode === 'target'
              ? 'Generate or add a workout for today to see its target map.'
              : mode === 'progress'
                ? 'Repeat weighted exercises across multiple sessions to unlock progress.'
                : 'Complete a workout to begin building this map.'}
          </p>
        )}
      </div>
    </section>
  )
}
