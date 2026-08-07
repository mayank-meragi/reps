import { useState } from 'react'
import { MapPin, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PATHS } from '@/lib/paths'
import { useFileQuery } from '@/hooks/useData'
import { useRunCommand } from '@/lib/commands/useRunCommand'
import type { Modality, Venue, VenueKind, VenuesFile } from '@/lib/types'

const KIND_OPTIONS: VenueKind[] = ['gym', 'home', 'outdoor', 'pool', 'studio', 'other']
const MODALITY_OPTIONS: Modality[] = ['strength', 'walk', 'run', 'cycle', 'swim', 'hike', 'mobility', 'sport', 'other']

function AddVenueForm() {
  const runCommand = useRunCommand()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<VenueKind>('gym')
  const [modalities, setModalities] = useState<Modality[]>(['strength'])
  const [busy, setBusy] = useState(false)

  function toggleModality(m: Modality) {
    setModalities((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))
  }

  async function submit() {
    if (!name.trim() || modalities.length === 0) return
    setBusy(true)
    try {
      await runCommand('venue.add', { name: name.trim(), kind, modalities })
      setName('')
      setModalities(['strength'])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="venue-name">Name</Label>
          <Input id="venue-name" placeholder="e.g. Gold's Gym, Home, Cubbon Park" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="venue-kind">Kind</Label>
          <select
            id="venue-kind"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-xs"
            value={kind}
            onChange={(e) => setKind(e.target.value as VenueKind)}
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Modalities</Label>
        <div className="flex flex-wrap gap-1.5">
          {MODALITY_OPTIONS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => toggleModality(m)}
              className={
                modalities.includes(m)
                  ? 'rounded-full bg-[var(--ink-900)] px-3 py-1 text-xs font-semibold text-white'
                  : 'rounded-full border border-input px-3 py-1 text-xs text-muted-foreground'
              }
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <Button size="sm" disabled={busy || !name.trim()} onClick={() => void submit()}>
        <Plus className="size-4" /> Add venue
      </Button>
    </div>
  )
}

function VenueRow({ venue }: { venue: Venue }) {
  const runCommand = useRunCommand()
  return (
    <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
      <div>
        <p className="text-sm font-medium">
          {venue.name} <span className="text-xs text-muted-foreground">· {venue.kind}</span>
        </p>
        <p className="text-xs text-muted-foreground">{venue.modalities.join(', ')}</p>
      </div>
      <button
        type="button"
        aria-label="Remove venue"
        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
        onClick={() => void runCommand('venue.remove', { id: venue.id })}
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  )
}

export default function HomePage() {
  const { data } = useFileQuery<VenuesFile>(PATHS.venues, { venues: [] })
  const venues = data?.venues ?? []

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Today</h1>
        <p className="text-sm text-muted-foreground">
          The programmer, the tracker, and the assistant land here in later milestones. This scaffold proves the
          command spine end to end: adding a venue below goes through the same <code>run()</code> path the AI will
          use.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <MapPin className="size-4" /> Venues
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {venues.length === 0 && <p className="text-sm text-muted-foreground">No venues yet — add where you train.</p>}
          <div className="space-y-2">
            {venues.map((v) => (
              <VenueRow key={v.id} venue={v} />
            ))}
          </div>
          <AddVenueForm />
        </CardContent>
      </Card>
    </div>
  )
}
