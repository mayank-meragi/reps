import { useMemo, useState } from 'react'
import { Check, MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAllExercises } from '@/hooks/useExercises'
import { PATHS } from '@/lib/paths'
import { useFileQuery } from '@/hooks/useData'
import { useRunCommand } from '@/lib/commands/useRunCommand'
import type { Modality, Venue, VenueKind, VenuesFile } from '@/lib/types'

const KIND_OPTIONS: VenueKind[] = ['gym', 'home', 'outdoor', 'pool', 'studio', 'other']
const MODALITY_OPTIONS: Modality[] = ['strength', 'walk', 'run', 'cycle', 'swim', 'hike', 'mobility', 'sport', 'other']
const FALLBACK_EQUIPMENT = ['bands', 'barbell', 'body only', 'cable', 'dumbbell', 'e-z curl bar', 'exercise ball', 'foam roll', 'kettlebells', 'machine', 'medicine ball', 'other']

interface VenueDraft {
  name: string
  kind: VenueKind
  modalities: Modality[]
  equipment: string[]
  travelMinutes: string
  notes: string
}

function emptyDraft(): VenueDraft {
  return { name: '', kind: 'gym', modalities: ['strength'], equipment: [], travelMinutes: '', notes: '' }
}

function draftFromVenue(venue: Venue): VenueDraft {
  return {
    name: venue.name,
    kind: venue.kind,
    modalities: venue.modalities,
    equipment: venue.equipment,
    travelMinutes: venue.travelMinutes?.toString() ?? '',
    notes: venue.notes ?? '',
  }
}

function ChoicePill({ selected, children, onClick }: { selected: boolean; children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={
        selected
          ? 'inline-flex items-center gap-1 rounded-full bg-[var(--ink-900)] px-3 py-1 text-xs font-semibold text-white'
          : 'rounded-full border border-input px-3 py-1 text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground'
      }
    >
      {selected && <Check className="size-3" />}
      {children}
    </button>
  )
}

function VenueFields({ draft, setDraft, equipmentOptions, idPrefix }: {
  draft: VenueDraft
  setDraft: (next: VenueDraft) => void
  equipmentOptions: string[]
  idPrefix: string
}) {
  function toggleModality(value: Modality) {
    setDraft({ ...draft, modalities: draft.modalities.includes(value) ? draft.modalities.filter((item) => item !== value) : [...draft.modalities, value] })
  }

  function toggleEquipment(value: string) {
    setDraft({ ...draft, equipment: draft.equipment.includes(value) ? draft.equipment.filter((item) => item !== value) : [...draft.equipment, value] })
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-name`}>Name</Label>
          <Input id={`${idPrefix}-name`} placeholder="Home, Cult Fit, Cubbon Park" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-kind`}>Kind</Label>
          <select
            id={`${idPrefix}-kind`}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-xs"
            value={draft.kind}
            onChange={(event) => setDraft({ ...draft, kind: event.target.value as VenueKind })}
          >
            {KIND_OPTIONS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>What can you do here?</Label>
        <div className="flex flex-wrap gap-1.5">
          {MODALITY_OPTIONS.map((modality) => (
            <ChoicePill key={modality} selected={draft.modalities.includes(modality)} onClick={() => toggleModality(modality)}>{modality}</ChoicePill>
          ))}
        </div>
      </div>

      <div className="space-y-1.5 rounded-lg bg-[var(--surface-sunken)] p-3">
        <div>
          <Label>Available equipment</Label>
          <p className="mt-0.5 text-xs text-muted-foreground">Used to filter the exercise library before a workout is generated.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {equipmentOptions.map((equipment) => (
            <ChoicePill key={equipment} selected={draft.equipment.includes(equipment)} onClick={() => toggleEquipment(equipment)}>{equipment}</ChoicePill>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-travel`}>Travel (minutes)</Label>
          <Input id={`${idPrefix}-travel`} type="number" min="0" inputMode="numeric" value={draft.travelMinutes} onChange={(event) => setDraft({ ...draft, travelMinutes: event.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-notes`}>Notes</Label>
          <Input id={`${idPrefix}-notes`} placeholder="Crowded after 7pm, no squat rack…" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
        </div>
      </div>
    </div>
  )
}

function AddVenueForm({ equipmentOptions }: { equipmentOptions: string[] }) {
  const runCommand = useRunCommand()
  const [draft, setDraft] = useState<VenueDraft>(emptyDraft)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!draft.name.trim() || draft.modalities.length === 0) return
    setBusy(true)
    try {
      await runCommand('venue.add', {
        name: draft.name.trim(),
        kind: draft.kind,
        modalities: draft.modalities,
        equipment: draft.equipment,
        travelMinutes: Number(draft.travelMinutes) || undefined,
        notes: draft.notes.trim() || undefined,
      })
      setDraft(emptyDraft())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add a training space</p>
      <VenueFields draft={draft} setDraft={setDraft} equipmentOptions={equipmentOptions} idPrefix="venue-add" />
      <Button size="sm" disabled={busy || !draft.name.trim() || draft.modalities.length === 0} onClick={() => void submit()}>
        <Plus className="size-4" /> {busy ? 'Adding…' : 'Add venue'}
      </Button>
    </div>
  )
}

function VenueRow({ venue, equipmentOptions }: { venue: Venue; equipmentOptions: string[] }) {
  const runCommand = useRunCommand()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<VenueDraft>(() => draftFromVenue(venue))
  const [busy, setBusy] = useState(false)

  function openEditor() {
    setDraft(draftFromVenue(venue))
    setEditing(true)
  }

  async function save() {
    if (!draft.name.trim() || draft.modalities.length === 0) return
    setBusy(true)
    try {
      await runCommand('venue.update', {
        id: venue.id,
        patch: {
          name: draft.name.trim(),
          kind: draft.kind,
          modalities: draft.modalities,
          equipment: draft.equipment,
          travelMinutes: Number(draft.travelMinutes) || undefined,
          notes: draft.notes.trim() || undefined,
        },
      })
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="rounded-lg border border-border px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {venue.name} <span className="text-xs font-normal text-muted-foreground">· {venue.kind}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{venue.modalities.join(' · ')}</p>
          </div>
          <div className="flex shrink-0 gap-0.5">
            <button type="button" aria-label={`Edit ${venue.name}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={openEditor}>
              <Pencil className="size-4" />
            </button>
            <button type="button" aria-label={`Remove ${venue.name}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive" onClick={() => void runCommand('venue.remove', { id: venue.id })}>
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>
        {venue.equipment.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {venue.equipment.map((item) => <span key={item} className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[11px] text-muted-foreground">{item}</span>)}
          </div>
        )}
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit {venue.name}</DialogTitle>
          </DialogHeader>
          <VenueFields draft={draft} setDraft={setDraft} equipmentOptions={equipmentOptions} idPrefix={`venue-${venue.id}`} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" disabled={busy || !draft.name.trim() || draft.modalities.length === 0} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default function VenuesManager() {
  const { data } = useFileQuery<VenuesFile>(PATHS.venues, { venues: [] })
  const { data: exercises } = useAllExercises()
  const venues = data?.venues ?? []
  const equipmentOptions = useMemo(() => {
    const fromLibrary = exercises.flatMap((exercise) => exercise.equipment ? [exercise.equipment] : [])
    return [...new Set([...FALLBACK_EQUIPMENT, ...fromLibrary])].sort()
  }, [exercises])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <MapPin className="size-4" /> Venues
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {venues.length === 0 && <p className="text-sm text-muted-foreground">No venues yet. Add where you train and what is available there.</p>}
        <div className="space-y-2">
          {venues.map((venue) => <VenueRow key={venue.id} venue={venue} equipmentOptions={equipmentOptions} />)}
        </div>
        <AddVenueForm equipmentOptions={equipmentOptions} />
        <p className="text-[11px] text-muted-foreground">Exercise catalog: Free Exercise DB · {exercises.length || '873'} movements · cached for offline use</p>
      </CardContent>
    </Card>
  )
}
