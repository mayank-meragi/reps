import type { QueryClient } from '@tanstack/react-query'
import { PATHS } from '@/lib/paths'
import { fileQueryKey } from '@/lib/queryKeys'
import { getCachedFile } from '@/lib/cache'
import { updateFile } from '@/lib/sync'
import type { Modality, Venue, VenueKind, VenuesFile } from '@/lib/types'
import { defineCommand } from './registry'

const emptyVenues: VenuesFile = { venues: [] }

export function getVenues(qc: QueryClient): Venue[] {
  return (
    qc.getQueryData<VenuesFile>(fileQueryKey(PATHS.venues))?.venues ??
    getCachedFile<VenuesFile>(PATHS.venues)?.content.venues ??
    []
  )
}

function writeVenues(qc: QueryClient, mutate: (current: Venue[]) => Venue[]): Venue[] {
  const next = updateFile<VenuesFile>(PATHS.venues, emptyVenues, (current) => ({
    ...current,
    venues: mutate(current.venues),
  }))
  qc.setQueryData(fileQueryKey(PATHS.venues), next)
  return next.venues
}

const VENUE_KINDS: VenueKind[] = ['gym', 'home', 'outdoor', 'pool', 'studio', 'other']
const MODALITIES: Modality[] = ['strength', 'walk', 'run', 'cycle', 'swim', 'hike', 'mobility', 'sport', 'other']

export const listVenuesCommand = defineCommand<Record<string, never>, Venue[]>({
  name: 'venue.list',
  title: 'List training venues',
  description:
    'List every place the user trains: gym, home, park, road, pool, etc, with the equipment and modalities each supports. Use this before programming or instantiating a session so exercise choices match what is actually available.',
  kind: 'read',
  parameters: { type: 'object', properties: {} },
  handler: (_args, ctx) => getVenues(ctx.qc),
})

interface AddVenueArgs {
  name: string
  kind: VenueKind
  equipment?: string[]
  modalities: Modality[]
  travelMinutes?: number
  notes?: string
}

export const addVenueCommand = defineCommand<AddVenueArgs, Venue>({
  name: 'venue.add',
  title: 'Add training venue',
  description:
    'Add a place the user trains — a gym (with its equipment), home, a park for walks, a road for cycling, a pool, etc.',
  kind: 'write',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      kind: { type: 'string', enum: VENUE_KINDS },
      equipment: {
        type: 'array',
        items: { type: 'string' },
        description: 'free-exercise-db equipment values available here; omit/empty for a park or road',
      },
      modalities: { type: 'array', items: { type: 'string', enum: MODALITIES } },
      travelMinutes: { type: 'number' },
      notes: { type: 'string' },
    },
    required: ['name', 'kind', 'modalities'],
  },
  handler: (args, ctx) => {
    const venue: Venue = {
      id: crypto.randomUUID(),
      name: args.name,
      kind: args.kind,
      equipment: args.equipment ?? [],
      modalities: args.modalities,
      travelMinutes: args.travelMinutes,
      notes: args.notes,
      isDefault: getVenues(ctx.qc).length === 0,
      createdAt: new Date().toISOString(),
    }
    writeVenues(ctx.qc, (current) => [...current, venue])
    return venue
  },
  undo: (_args, result, ctx) => {
    writeVenues(ctx.qc, (current) => current.filter((v) => v.id !== result.id))
  },
  summarize: (args) => `Added venue "${args.name}"`,
})

interface UpdateVenueArgs {
  id: string
  patch: Partial<Pick<Venue, 'name' | 'kind' | 'equipment' | 'modalities' | 'travelMinutes' | 'notes' | 'isDefault'>>
}

export const updateVenueCommand = defineCommand<UpdateVenueArgs, Venue | null>({
  name: 'venue.update',
  title: 'Update training venue',
  description: "Update a venue's name, kind, equipment list, supported modalities, or default status.",
  kind: 'write',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      patch: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          kind: { type: 'string', enum: VENUE_KINDS },
          equipment: { type: 'array', items: { type: 'string' } },
          modalities: { type: 'array', items: { type: 'string', enum: MODALITIES } },
          travelMinutes: { type: 'number' },
          notes: { type: 'string' },
          isDefault: { type: 'boolean' },
        },
      },
    },
    required: ['id', 'patch'],
  },
  handler: (args, ctx) => {
    let updated: Venue | null = null
    writeVenues(ctx.qc, (current) =>
      current.map((v) => {
        if (v.id !== args.id) return v
        updated = { ...v, ...args.patch }
        return updated
      }),
    )
    return updated
  },
  summarize: (args) => `Updated venue (${Object.keys(args.patch).join(', ')})`,
})

export const removeVenueCommand = defineCommand<{ id: string }, Venue | null>({
  name: 'venue.remove',
  title: 'Remove training venue',
  description: 'Remove a training venue permanently. The user is asked to confirm first.',
  kind: 'destructive',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  handler: (args, ctx) => {
    const removed = getVenues(ctx.qc).find((v) => v.id === args.id) ?? null
    if (removed) writeVenues(ctx.qc, (current) => current.filter((v) => v.id !== args.id))
    return removed
  },
  undo: (_args, removed, ctx) => {
    if (removed) writeVenues(ctx.qc, (current) => [...current, removed])
  },
  summarize: (_args, removed) => (removed ? `Removed venue "${removed.name}"` : 'Removed venue'),
})
