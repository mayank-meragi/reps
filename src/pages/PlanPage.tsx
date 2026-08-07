import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PATHS } from '@/lib/paths'
import { useFileQuery } from '@/hooks/useData'
import { useAllExercises } from '@/hooks/useExercises'
import { useRunCommand } from '@/lib/commands/useRunCommand'
import type { Program, ProgramsIndexFile } from '@/lib/types'

function GenerateForm({ hasActive }: { hasActive: boolean }) {
  const runCommand = useRunCommand()
  const [weeks, setWeeks] = useState('6')
  const [daysPerWeek, setDaysPerWeek] = useState('')
  const [request, setRequest] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setBusy(true)
    setError(null)
    try {
      await runCommand('program.generate', {
        weeks: Number(weeks) || undefined,
        daysPerWeek: Number(daysPerWeek) || undefined,
        request: request.trim() || undefined,
      })
      setRequest('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate a program')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{hasActive ? 'Generate a new program' : 'Generate your first program'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="plan-weeks">Weeks</Label>
            <Input id="plan-weeks" type="number" value={weeks} onChange={(e) => setWeeks(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="plan-days">Days/week</Label>
            <Input id="plan-days" type="number" placeholder="from profile" value={daysPerWeek} onChange={(e) => setDaysPerWeek(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="plan-request">Anything specific? (optional)</Label>
          <Input id="plan-request" placeholder='"more cardio", "only 3 days"' value={request} onChange={(e) => setRequest(e.target.value)} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button disabled={busy} onClick={() => void generate()}>
          <Sparkles className="size-4" /> {busy ? 'Generating…' : hasActive ? 'Replace program' : 'Generate'}
        </Button>
      </CardContent>
    </Card>
  )
}

function ProgramView({ program }: { program: Program }) {
  const { data: exercises } = useAllExercises()
  const byId = new Map(exercises.map((e) => [e.id, e.name]))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{program.name}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {program.split} · {program.weeks} weeks · {program.daysPerWeek}/week
          {program.deloadWeek ? ` · deload week ${program.deloadWeek}` : ''}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {program.rationale && <p className="text-sm text-muted-foreground">{program.rationale}</p>}
        <div className="space-y-2">
          {program.days.map((day) => (
            <div key={day.key} className="rounded-lg border border-border px-3 py-2">
              <p className="text-sm font-semibold">
                {day.name} <span className="text-xs font-normal capitalize text-muted-foreground">· {day.modality}</span>
              </p>
              {day.focus.length > 0 && <p className="text-xs capitalize text-muted-foreground">{day.focus.join(' · ')}</p>}
              {day.exercises.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {day.exercises.map((e, i) => (
                    <li key={`${e.exerciseId}-${i}`}>
                      {e.sets}×{e.repRange[0]}-{e.repRange[1]} — {byId.get(e.exerciseId) ?? e.exerciseId}
                    </li>
                  ))}
                </ul>
              )}
              {day.target && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {[day.target.durationMin && `${day.target.durationMin} min`, day.target.distanceKm && `${day.target.distanceKm}km`, day.target.style]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export default function PlanPage() {
  const runCommand = useRunCommand()
  const { data: index } = useFileQuery<ProgramsIndexFile>(PATHS.programsIndex, { activeId: null, list: [] })
  const activeId = index?.activeId ?? null
  const { data: activeProgram } = useFileQuery<Program | null>(PATHS.program(activeId ?? '_none'), null)
  const others = (index?.list ?? []).filter((p) => p.id !== activeId)

  return (
    <div className="space-y-3 pb-16">
      <h1 className="text-xl font-semibold tracking-tight">Plan</h1>
      {activeProgram && <ProgramView program={activeProgram} />}
      <GenerateForm hasActive={Boolean(activeProgram)} />
      {others.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Past programs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {others.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.status} · started {p.startDate}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => void runCommand('program.set_active', { id: p.id })}>
                  Make active
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
