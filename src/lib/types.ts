/** Domain model — see docs/plan.md §4 for the design rationale. */

// ---- Library ----

export type ExerciseLevel = 'beginner' | 'intermediate' | 'expert'
export type ExerciseMechanic = 'compound' | 'isolation'
export type ExerciseCategory = 'strength' | 'cardio' | 'stretching' | 'plyometrics' | 'strongman' | 'other'

/** free-exercise-db shape, plus fields for user-created exercises. */
export interface Exercise {
  id: string
  name: string
  force?: string | null
  level: ExerciseLevel
  mechanic?: ExerciseMechanic | null
  equipment?: string | null
  primaryMuscles: string[]
  secondaryMuscles: string[]
  instructions: string[]
  category: string
  images: string[]
  /** Optional richer media for catalogs/custom exercises that provide it. */
  gifUrl?: string
  videoUrl?: string
  /** True for a user-created exercise, absent from free-exercise-db */
  custom?: true
  aliases?: string[]
  /** Another exercise id this one is a user-declared substitute for */
  substitutionsOf?: string
}

export interface CustomExercisesFile {
  exercises: Exercise[]
}

// ---- Venues (§4a: Venue × Modality) ----

export type Modality = 'strength' | 'walk' | 'run' | 'cycle' | 'swim' | 'hike' | 'mobility' | 'sport' | 'other'
export type VenueKind = 'gym' | 'home' | 'outdoor' | 'pool' | 'studio' | 'other'

export interface Venue {
  id: string
  name: string
  kind: VenueKind
  /** free-exercise-db equipment values; empty for a park/road */
  equipment: string[]
  modalities: Modality[]
  /** A modality defaults to this venue when the AI doesn't otherwise know where you are */
  defaultFor?: Modality[]
  travelMinutes?: number
  isDefault?: boolean
  notes?: string
  createdAt: string
}

export interface VenuesFile {
  venues: Venue[]
}

// ---- Planning ----

export type ProgressionScheme = 'double-progression' | 'linear' | 'e1rm-percent'
export type ProgramStatus = 'active' | 'completed' | 'archived'
export type LoadRule = 'e1rm-pct' | 'last-session' | 'fixed' | 'bodyweight'

export interface CardioTarget {
  durationMin?: number
  distanceKm?: number
  effort?: 1 | 2 | 3 | 4 | 5
  style?: 'steady' | 'intervals' | 'easy'
}

export interface PlannedExercise {
  exerciseId: string
  sets: number
  repRange: [number, number]
  targetRir?: number
  restSeconds?: number
  loadRule: LoadRule
  loadValue?: number
  notes?: string
}

export interface ProgramDay {
  key: string
  name: string
  modality: Modality
  venueId?: string
  focus: string[]
  /** Strength/mobility/sport days */
  exercises: PlannedExercise[]
  /** Walk/run/cycle/swim days */
  target?: CardioTarget
}

export interface WeeklyTrainingTarget {
  modality: Modality
  sessions: number
  intent: string
}

export interface Program {
  id: string
  name: string
  goal: string
  weeks: number
  daysPerWeek: number
  startDate: string
  status: ProgramStatus
  progression: ProgressionScheme
  /** The mesocycle's north star. Concrete sessions are generated on demand. */
  theme: string
  weeklyTargets: WeeklyTrainingTarget[]
  priorities: string[]
  progressionGuidance: string
  recoveryGuidance: string
  rationale: string
  generatedBy: 'ai' | 'manual'
  createdAt: string
}

export interface ProgramsIndexFile {
  activeId: string | null
  list: { id: string; name: string; status: ProgramStatus; startDate: string }[]
}

// ---- Execution ----

export type SessionSource = 'program' | 'ai-adhoc' | 'manual' | 'quick-log'
export type SetMode = 'reps' | 'duration' | 'distance'
export type SetType = 'warmup' | 'working' | 'drop' | 'amrap' | 'failure'

export interface SetEntry {
  type: SetType
  targetReps?: number
  targetWeight?: number
  targetDurationSec?: number
  targetDistanceM?: number
  targetRir?: number
  reps?: number
  weight?: number
  durationSec?: number
  distanceM?: number
  rir?: number
  rpe?: number
  restActualSec?: number
  done: boolean
  /** Completion timestamp — real rest times and session pacing come free from this */
  at?: string
}

export interface SessionExercise {
  exerciseId: string
  name: string
  mode: SetMode
  restSeconds?: number
  sets: SetEntry[]
  /** Set when this exercise replaced a planned one (venue swap, injury, preference) */
  swappedFrom?: string
  notes?: string
}

export interface CardioResult {
  durationSec: number
  distanceM?: number
  effort?: 1 | 2 | 3 | 4 | 5
  avgPaceSecPerKm?: number
}

export interface SessionPrescription {
  generatedAt: string
  /** One-time input used for this recommendation, not permanent coach memory. */
  considerations?: string
  rationale: string
  target?: CardioTarget
  consideredSessionIds: string[]
  contextSummary: string[]
  availableMinutes?: number
}

export interface Session {
  id: string
  /** YYYY-MM-DD */
  date: string
  modality: Modality
  venueId?: string
  programId?: string
  programDayKey?: string
  name: string
  focus: string[]
  source: SessionSource
  startedAt?: string
  endedAt?: string
  readinessId?: string
  exercises: SessionExercise[]
  cardio?: CardioResult
  /** Present while this session is a generated recommendation, and retained for audit after completion. */
  prescription?: SessionPrescription
  rationale?: string
  debrief?: string
  feeling?: 1 | 2 | 3 | 4 | 5
  notes?: string
  createdAt: string
  updatedAt: string
}

// ---- Context the coach needs ----

export type TrainingGoal = 'build-muscle' | 'strength' | 'fat-loss' | 'general-fitness' | 'endurance'
export type Experience = 'beginner' | 'intermediate' | 'advanced'
export type Units = 'kg' | 'lb'

export interface Profile {
  goal: TrainingGoal
  experience: Experience
  daysPerWeek: number
  sessionMinutes?: number
  heightCm?: number
  birthYear?: number
  injuries?: string
  preferences?: string
  units: Units
  /** Available barbell + plate inventory, in the profile's units */
  barbellWeight?: number
  plateInventory?: number[]
  createdAt: string
  updatedAt: string
}

export interface BodyMetric {
  date: string
  weightKg: number
  bodyFatPct?: number
  measurements?: Record<string, number>
}

export interface BodyMetricsFile {
  metrics: BodyMetric[]
}

export interface Readiness {
  id: string
  date: string
  sleepHours?: number
  soreness?: 1 | 2 | 3 | 4 | 5
  stress?: 1 | 2 | 3 | 4 | 5
  energy?: 1 | 2 | 3 | 4 | 5
  /** From a wearable, when connected later — cheap to carry now, awkward to backfill */
  hrv?: number
  restingHeartRate?: number
  note?: string
}

export interface ReadinessFile {
  entries: Readiness[]
}

export type PersonalRecordKind = '1rm' | 'e1rm' | 'volume' | 'reps' | 'distance'

export interface PersonalRecord {
  exerciseId: string
  kind: PersonalRecordKind
  value: number
  date: string
  sessionId: string
}

export interface RecordsFile {
  records: PersonalRecord[]
}

export interface CoachMemory {
  summary: string
  updatedAt: string
  sessionCount: number
}

export interface SettingsFile {
  schemaVersion: number
  units: Units
}

// ---- Activity log (command audit trail, §3) ----

export type ActivitySource = 'ui' | 'ai' | 'system'

export interface ActivityEntry {
  id: string
  at: string
  source: ActivitySource
  command: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any>
  summary: string
  undoable: boolean
}
