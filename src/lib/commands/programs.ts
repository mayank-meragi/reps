import type { QueryClient } from '@tanstack/react-query'
import { AiError, generateJson } from '@/lib/llm'
import { PATHS } from '@/lib/paths'
import { fileQueryKey } from '@/lib/queryKeys'
import { getCachedFile } from '@/lib/cache'
import { updateFile, loadFile } from '@/lib/sync'
import { listDir } from '@/lib/github'
import { effectiveTodayISO, monthKey } from '@/lib/dates'
import { instantiateDay } from '@/lib/engine'
import type { Exercise, Modality, Program, ProgramDay, ProgramsIndexFile, ProgressionScheme, Session } from '@/lib/types'
import { defineCommand } from './registry'
import { getProfile } from './profile'
import { getVenues } from './venues'
import { allExercises } from './exercises'
import { writeSessionsMonth } from './sessions'

const emptyIndex: ProgramsIndexFile = { activeId: null, list: [] }

function readIndex(qc: QueryClient): ProgramsIndexFile {
  return (
    qc.getQueryData<ProgramsIndexFile>(fileQueryKey(PATHS.programsIndex)) ??
    getCachedFile<ProgramsIndexFile>(PATHS.programsIndex)?.content ??
    emptyIndex
  )
}

function writeIndex(qc: QueryClient, mutate: (current: ProgramsIndexFile) => ProgramsIndexFile): ProgramsIndexFile {
  const next = updateFile<ProgramsIndexFile>(PATHS.programsIndex, emptyIndex, mutate)
  qc.setQueryData(fileQueryKey(PATHS.programsIndex), next)
  return next
}

function readProgram(qc: QueryClient, id: string): Program | null {
  return (
    qc.getQueryData<Program>(fileQueryKey(PATHS.program(id))) ??
    getCachedFile<Program>(PATHS.program(id))?.content ??
    null
  )
}

function writeProgram(qc: QueryClient, program: Program): void {
  const next = updateFile<Program>(PATHS.program(program.id), program, () => program)
  qc.setQueryData(fileQueryKey(PATHS.program(program.id)), next)
}

async function allSessionsAcrossMonths(): Promise<Session[]> {
  const files = await listDir(PATHS.sessionsDir)
  const months = files.map((f) => f.name.replace(/\.json$/, '')).filter((n) => /^\d{4}-\d{2}$/.test(n))
  const all: Session[] = []
  for (const month of months) all.push(...(await loadFile<Session[]>(PATHS.sessions(month), [])))
  return all
}

const MODALITIES: Modality[] = ['strength', 'walk', 'run', 'cycle', 'swim', 'hike', 'mobility', 'sport', 'other']
const MODALITY_SET = new Set<string>(MODALITIES)

// ---- AI generation: candidate list, schema, salvage ----

function candidateExercises(exercises: Exercise[], venues: { equipment: string[] }[], limit = 100): Exercise[] {
  const equipment = new Set(venues.flatMap((v) => v.equipment))
  equipment.add('body only')
  const usable = exercises.filter((e) => !e.equipment || equipment.has(e.equipment))
  const rank = (e: Exercise) =>
    (e.mechanic === 'compound' ? 0 : 2) + (e.level === 'beginner' ? 0 : e.level === 'intermediate' ? 1 : 3)
  return usable.sort((a, b) => rank(a) - rank(b)).slice(0, limit)
}

const PROGRAM_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    split: { type: 'string', description: "e.g. 'Push/Pull/Legs', 'Upper/Lower', 'Full body'" },
    rationale: { type: 'string', description: '2-4 sentences: why this structure for this person' },
    deloadWeek: { type: 'number', description: '1-based week number to deload, e.g. 5 for a 6-week block' },
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: "short unique key, e.g. 'push-a'" },
          name: { type: 'string' },
          modality: { type: 'string', enum: MODALITIES },
          venueId: { type: 'string', description: 'a venueId from the list below, when relevant' },
          focus: { type: 'array', items: { type: 'string' } },
          exercises: {
            type: 'array',
            description: 'strength/mobility/sport days only',
            items: {
              type: 'object',
              properties: {
                exerciseId: { type: 'string' },
                sets: { type: 'number' },
                repRangeLo: { type: 'number' },
                repRangeHi: { type: 'number' },
                targetRir: { type: 'number' },
                restSeconds: { type: 'number' },
              },
              required: ['exerciseId', 'sets', 'repRangeLo', 'repRangeHi'],
            },
          },
          cardio: {
            type: 'object',
            description: 'cardio modality days only (walk/run/cycle/swim/hike)',
            properties: {
              durationMin: { type: 'number' },
              distanceKm: { type: 'number' },
              effort: { type: 'number', description: '1 (easy) to 5 (max)' },
              style: { type: 'string', enum: ['steady', 'intervals', 'easy'] },
            },
          },
        },
        required: ['key', 'name', 'modality', 'focus'],
      },
    },
  },
  required: ['name', 'split', 'rationale', 'days'],
}

interface RawDay {
  key?: string
  name?: string
  modality?: string
  venueId?: string
  focus?: string[]
  exercises?: { exerciseId?: string; sets?: number; repRangeLo?: number; repRangeHi?: number; targetRir?: number; restSeconds?: number }[]
  cardio?: { durationMin?: number; distanceKm?: number; effort?: number; style?: string }
}
interface RawProgram {
  name?: string
  split?: string
  rationale?: string
  deloadWeek?: number
  days?: RawDay[]
}

/** Validate the AI's days against the real exercise library; salvage near-miss ids by name. */
function validateDays(rawDays: RawDay[], exercises: Exercise[]): ProgramDay[] {
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const nameIndex = new Map(exercises.map((e) => [e.name.toLowerCase(), e]))
  const days: ProgramDay[] = []
  rawDays.forEach((rd, i) => {
    if (!rd.modality || !MODALITY_SET.has(rd.modality)) return
    const day: ProgramDay = {
      key: rd.key?.trim() || `day${i + 1}`,
      name: rd.name?.trim() || `Day ${i + 1}`,
      modality: rd.modality as Modality,
      venueId: rd.venueId,
      focus: Array.isArray(rd.focus) ? rd.focus.filter((f) => typeof f === 'string').slice(0, 4) : [],
      exercises: [],
    }
    if (rd.cardio) {
      day.target = {
        durationMin: Number.isFinite(rd.cardio.durationMin) ? rd.cardio.durationMin : undefined,
        distanceKm: Number.isFinite(rd.cardio.distanceKm) ? rd.cardio.distanceKm : undefined,
        effort: Number.isFinite(rd.cardio.effort) ? (Math.min(Math.max(Math.round(rd.cardio.effort!), 1), 5) as 1 | 2 | 3 | 4 | 5) : undefined,
        style: rd.cardio.style === 'intervals' || rd.cardio.style === 'easy' ? rd.cardio.style : 'steady',
      }
    }
    for (const re of rd.exercises ?? []) {
      if (!re.exerciseId || !Number.isFinite(re.sets) || (re.sets ?? 0) <= 0) continue
      // Try, in order: exact id, exact name, underscore-slug (DB id format),
      // then a last-resort hyphen+underscore guess. That order matters — the
      // aggressive replace must come last, or it mangles real names that
      // contain a literal " - " (e.g. "Barbell Bench Press - Medium Grip")
      // before the exact-name lookup gets a chance to match them.
      const ex =
        byId.get(re.exerciseId) ??
        nameIndex.get(re.exerciseId.toLowerCase()) ??
        nameIndex.get(re.exerciseId.replace(/_/g, ' ').toLowerCase()) ??
        nameIndex.get(re.exerciseId.replace(/[_-]/g, ' ').toLowerCase()) ??
        exercises.find((e) => e.id.toLowerCase() === re.exerciseId!.toLowerCase())
      if (!ex) continue
      const lo = Number.isFinite(re.repRangeLo) ? re.repRangeLo! : 8
      const hi = Number.isFinite(re.repRangeHi) ? Math.max(re.repRangeHi!, lo) : Math.max(lo, 12)
      day.exercises.push({
        exerciseId: ex.id,
        sets: Math.min(Math.max(Math.round(re.sets!), 1), 6),
        repRange: [lo, hi],
        targetRir: Number.isFinite(re.targetRir) ? re.targetRir : undefined,
        restSeconds: Number.isFinite(re.restSeconds) ? Math.min(Math.max(re.restSeconds!, 15), 300) : ex.mechanic === 'compound' ? 120 : 75,
        loadRule: ex.equipment === 'body only' || !ex.equipment ? 'bodyweight' : 'last-session',
      })
    }
    if (day.exercises.length > 0 || day.target) days.push(day)
  })
  return days
}

// ---- Commands ----

interface GenerateArgs {
  weeks?: number
  daysPerWeek?: number
  request?: string
}

export const generateProgramCommand = defineCommand<GenerateArgs, Program>({
  name: 'program.generate',
  title: 'Generate training program',
  description:
    'Generate a new multi-week training program from the profile, venues, and history, replacing the current active program. Mixes modalities and venues across the week — not strength-only unless that fits the goal. Optionally pass weeks, daysPerWeek, or a free-text request ("more cardio", "only 3 days this month").',
  kind: 'write',
  parameters: {
    type: 'object',
    properties: {
      weeks: { type: 'number', description: 'default 6' },
      daysPerWeek: { type: 'number', description: 'default from profile' },
      request: { type: 'string' },
    },
  },
  handler: async (args, ctx) => {
    const profile = getProfile(ctx.qc)
    const venues = getVenues(ctx.qc)
    const exercises = await allExercises(ctx.qc)
    const weeks = args.weeks ?? 6
    const daysPerWeek = args.daysPerWeek ?? profile?.daysPerWeek ?? 3
    const candidates = candidateExercises(exercises, venues)

    const venueLines =
      venues.length > 0
        ? venues
            .map((v) => `${v.id} | ${v.name} | ${v.kind} | modalities: ${v.modalities.join(',')} | equipment: ${v.equipment.join(',') || 'none'}`)
            .join('\n')
        : '(no venues configured yet — assume bodyweight/home only, and do not set venueId)'

    const prompt = `Design a ${weeks}-week training program, ${daysPerWeek} sessions/week.
${args.request ? `\nThe user specifically asked: "${args.request}" — honor this within safe programming.\n` : ''}
Profile:
- Goal: ${profile?.goal ?? 'general-fitness'}; experience: ${profile?.experience ?? 'beginner'}
${profile?.injuries ? `- Injuries/limitations (NEVER program around these carelessly): ${profile.injuries}` : ''}
${profile?.preferences ? `- Preferences: ${profile.preferences}` : ''}

Venues (put a matching venueId on each day; only pick exercises whose equipment is available there):
${venueLines}

Rules:
- Mix modalities across the week where venues support it — a cardio day (walk/run/cycle/swim/hike)
  needs "cardio" populated, not "exercises". Strength/mobility/sport days need "exercises", not "cardio".
- 4-6 exercises per strength day: compounds first, isolation after. 2-4 sets each. Rep ranges by
  goal (strength: 3-6, hypertrophy: 8-12, endurance/fat-loss: 12-20).
- Respect 48-72h recovery per muscle group across the week's split.
- Use ONLY exerciseId values from this list:
${candidates.map((e) => `${e.id} | ${e.name} | ${e.primaryMuscles.join('/')} | ${e.equipment ?? 'body only'}${e.mechanic ? ` | ${e.mechanic}` : ''}`).join('\n')}`

    const text = await generateJson({ text: prompt, schema: PROGRAM_SCHEMA, temperature: 0.4, maxOutputTokens: 4096 })
    let raw: RawProgram
    try {
      raw = JSON.parse(text)
    } catch {
      throw new AiError('The AI returned an invalid program')
    }

    const days = validateDays(raw.days ?? [], exercises)
    if (days.length === 0) throw new AiError('The AI returned no usable program days')

    const now = new Date().toISOString()
    const program: Program = {
      id: crypto.randomUUID(),
      name: raw.name?.trim() || 'Program',
      goal: profile?.goal ?? 'general-fitness',
      weeks,
      daysPerWeek,
      split: raw.split?.trim() || 'Custom',
      startDate: effectiveTodayISO(),
      status: 'active',
      progression: 'double-progression',
      days,
      rationale: raw.rationale?.trim() || '',
      generatedBy: 'ai',
      deloadWeek: Number.isFinite(raw.deloadWeek) ? raw.deloadWeek : undefined,
      createdAt: now,
    }

    const previousActiveId = readIndex(ctx.qc).activeId
    if (previousActiveId) {
      const previous = readProgram(ctx.qc, previousActiveId)
      if (previous) writeProgram(ctx.qc, { ...previous, status: 'archived' })
    }
    writeProgram(ctx.qc, program)
    writeIndex(ctx.qc, (current) => ({
      activeId: program.id,
      list: [
        ...current.list.map((p) => (p.id === current.activeId ? { ...p, status: 'archived' as const } : p)),
        { id: program.id, name: program.name, status: 'active' as const, startDate: program.startDate },
      ],
    }))
    return program
  },
  summarize: (_args, result) => `Generated program "${result.name}" (${result.days.length} days)`,
})

export const listProgramsCommand = defineCommand<Record<string, never>, ProgramsIndexFile['list']>({
  name: 'program.list',
  title: 'List programs',
  description: 'List saved programs: id, name, status, start date.',
  kind: 'read',
  parameters: { type: 'object', properties: {} },
  handler: (_args, ctx) => readIndex(ctx.qc).list,
})

export const getProgramCommand = defineCommand<{ id?: string }, Program | null>({
  name: 'program.get',
  title: 'Get program details',
  description: 'Get full details of a program — its days, exercises, rep ranges, rationale. Omit id for the active program.',
  kind: 'read',
  parameters: { type: 'object', properties: { id: { type: 'string' } } },
  handler: (args, ctx) => {
    const id = args.id ?? readIndex(ctx.qc).activeId
    return id ? readProgram(ctx.qc, id) : null
  },
})

export const setActiveProgramCommand = defineCommand<{ id: string }, ProgramsIndexFile>({
  name: 'program.set_active',
  title: 'Set active program',
  description: 'Make a saved program the active one (used by program.start_today and shown on the Plan page).',
  kind: 'write',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  handler: (args, ctx) =>
    writeIndex(ctx.qc, (current) => ({
      activeId: args.id,
      list: current.list.map((p) => ({ ...p, status: p.id === args.id ? 'active' : p.status === 'active' ? 'archived' : p.status })),
    })),
  summarize: () => 'Changed active program',
})

export const archiveProgramCommand = defineCommand<{ id: string }, ProgramsIndexFile>({
  name: 'program.archive',
  title: 'Archive program',
  description: 'Archive a program so it stops being used for program.start_today.',
  kind: 'write',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  handler: (args, ctx) =>
    writeIndex(ctx.qc, (current) => ({
      activeId: current.activeId === args.id ? null : current.activeId,
      list: current.list.map((p) => (p.id === args.id ? { ...p, status: 'archived' as const } : p)),
    })),
  summarize: () => 'Archived program',
})

export const swapProgramExerciseCommand = defineCommand<{ programId: string; dayKey: string; exerciseId: string; newExerciseId: string }, Program>({
  name: 'program.swap_exercise',
  title: 'Swap exercise in program day',
  description:
    "Replace one exercise in a program day's template with another (e.g. no cable machine at this venue → use a substitute). Affects future instantiations of that day, not sessions already logged.",
  kind: 'write',
  parameters: {
    type: 'object',
    properties: {
      programId: { type: 'string' },
      dayKey: { type: 'string' },
      exerciseId: { type: 'string' },
      newExerciseId: { type: 'string' },
    },
    required: ['programId', 'dayKey', 'exerciseId', 'newExerciseId'],
  },
  handler: async (args, ctx) => {
    const program = readProgram(ctx.qc, args.programId)
    if (!program) throw new Error('Program not found')
    const exercises = await allExercises(ctx.qc)
    const newEx = exercises.find((e) => e.id === args.newExerciseId)
    if (!newEx) throw new Error(`Unknown exercise: ${args.newExerciseId}`)
    const next: Program = {
      ...program,
      days: program.days.map((d) =>
        d.key !== args.dayKey ? d : { ...d, exercises: d.exercises.map((e) => (e.exerciseId === args.exerciseId ? { ...e, exerciseId: newEx.id } : e)) },
      ),
    }
    writeProgram(ctx.qc, next)
    return next
  },
  summarize: (args) => `Swapped an exercise in program day ${args.dayKey}`,
})

export const startTodayCommand = defineCommand<Record<string, never>, Session>({
  name: 'program.start_today',
  title: "Start today's planned session",
  description:
    "Instantiate today's session from the active program — computes real target weights from training history and the program's progression scheme — and start it. Rotates through the program's days in order each time it's called.",
  kind: 'write',
  parameters: { type: 'object', properties: {} },
  handler: async (_args, ctx) => {
    const index = readIndex(ctx.qc)
    if (!index.activeId) throw new Error('No active program — call program.generate first')
    const program = readProgram(ctx.qc, index.activeId)
    if (!program) throw new Error('Active program not found')
    if (program.days.length === 0) throw new Error('Program has no days')

    const exercises = await allExercises(ctx.qc)
    const byId = new Map(exercises.map((e) => [e.id, e]))
    const venues = getVenues(ctx.qc)
    const history = await allSessionsAcrossMonths()
    const programSessions = history.filter((s) => s.programId === program.id)
    const day = program.days[programSessions.length % program.days.length]
    const venue = venues.find((v) => v.id === day.venueId)

    const { exercises: sessionExercises } = instantiateDay({
      day,
      history: programSessions,
      scheme: program.progression as ProgressionScheme,
      exercisesById: byId,
      venue,
    })

    const now = new Date().toISOString()
    const date = effectiveTodayISO()
    const session: Session = {
      id: crypto.randomUUID(),
      date,
      modality: day.modality,
      venueId: day.venueId,
      programId: program.id,
      programDayKey: day.key,
      name: day.name,
      focus: day.focus,
      source: 'program',
      startedAt: now,
      exercises: sessionExercises,
      rationale: day.target
        ? `Target: ${[day.target.durationMin && `${day.target.durationMin} min`, day.target.distanceKm && `${day.target.distanceKm}km`, day.target.style]
            .filter(Boolean)
            .join(' · ')}`
        : undefined,
      createdAt: now,
      updatedAt: now,
    }
    writeSessionsMonth(ctx.qc, monthKey(date), (current) => [...current, session])
    return session
  },
  undo: (_args, session, ctx) => {
    writeSessionsMonth(ctx.qc, monthKey(session.date), (current) => current.filter((s) => s.id !== session.id))
  },
  summarize: (_args, result) => `Started "${result.name}" from the program`,
})
