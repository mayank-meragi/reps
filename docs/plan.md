# Reps — AI-first training generator & tracker

> Standalone app, same stack and hosting model as `personal-fin`. **`personal-fin` is not
> touched** — no changes to Life OS, no shared data, no migration. Reps starts clean.

---

## 1. The goal, stated precisely

A dedicated workout app where **the AI is a first-class client of the app, not a bolted-on
chat box**. The contract:

> **Parity contract:** every action a human can take in the UI, and every number the UI can
> show, is available to the AI as a typed command — and it is *structurally impossible* for a
> new feature to be UI-only.

That last clause is the whole design. In `personal-fin`, the assistant's tools were written
by hand alongside the UI (`src/lib/assistant/tools.ts`, 873 lines), so parity is maintained
by discipline and drifts the moment a feature ships in a hurry. Reps inverts it: there is one
**command registry**, the UI dispatches through it, and the AI's tool list *is* that registry.
Adding a feature adds an AI capability automatically; skipping it is a build error.

Three things follow that are worth naming up front:

- **Write parity** — AI can do anything you can do (log, edit, delete, plan, configure).
- **Read parity** — every chart/tile is computed by a named selector that's also a read
  command, so the AI answers with the *exact* numbers on screen, never a re-derivation.
- **Control parity** — navigation, dialogs, filters, timers are commands too. The AI can
  drive the screen, not just the database.

### Feature gate: capability before interface

Every feature starts by designing the AI's capability path, before any UI is added:

1. Check the registry for existing read, search, filter, facet, and write commands.
2. Define every additional typed tool the AI needs to discover state and act without guessing.
3. Implement those commands and shared selectors first; the UI then becomes another caller.
4. Exercise the feature through the AI path and read the result back before calling it done.

External catalogs and APIs must be exposed as tools rather than hidden inside a UI flow. The AI
chooses which searches and filters to run and makes the product decision from their results. Code
still enforces permissions, valid IDs, schemas, safety constraints, and domain invariants, but it
does not replace the AI's judgment with an invisible recommendation algorithm.

---

## 2. Stack (mirrors personal-fin deliberately)

| Layer | Choice | Notes |
|---|---|---|
| App | React 19 + Vite 8 + TypeScript 6 | same versions as personal-fin |
| Styling | Tailwind 4 + shadcn/ui on radix-ui | `components.json` copied |
| State/data | TanStack Query 5 | file-path query keys |
| Routing | react-router-dom 7, `HashRouter` | required for GitHub Pages |
| Charts | recharts 3 | |
| Icons | lucide-react | |
| Lint | oxlint | no test suite by default (see §12) |
| Hosting | GitHub Pages, public app repo | `mayank-meragi/reps` |
| Database | **GitHub repo as JSON store** via Contents API | fine-grained PAT in localStorage |
| AI | Vercel AI SDK Core + Gemini / OpenAI / Anthropic providers | Unified structured output, tools, images, usage, and model switching |

**Infra to copy from personal-fin as-is** (it's generic and already battle-tested):
`lib/github.ts`, `lib/sync.ts`, `lib/cache.ts`, `lib/merge.ts`, `lib/dates.ts`,
`lib/queryKeys.ts`, `lib/utils.ts`, the whole of `lib/llm/`, `components/Onboarding.tsx`,
`components/SyncStatus.tsx`, `hooks/useData.ts`, `.github/workflows/deploy.yml`.

> Not extracting these into a shared package yet — copying is faster and the two apps will
> diverge (Reps needs offline-first hardening that finance doesn't). Revisit if a third app
> appears.

**Data repo:** new private repo `mayank-meragi/reps-data`. Separate from `finance-data` so the
two apps never contend over the same file SHAs, and so Reps can restructure freely. No data is
imported from Life OS — Reps starts empty and builds its own history (§10 covers how the first
program gets built without prior history).

---

## 3. Architecture — the command spine

```
src/
  lib/
    commands/
      registry.ts        # define(), run(), toolDefs(), the parity guarantee
      context.ts         # CommandContext: qc, navigate, confirm, emit
      log.ts             # activity log + shared undo stack (UI and AI)
      workouts.ts        # workout.* commands
      program.ts         # program.* commands
      exercises.ts       # exercise.* commands
      profile.ts         # profile.* / venue.* commands
      body.ts            # body.* commands (weight, measurements, readiness)
      insights.ts        # read-only analytics commands
      ui.ts              # ui.* — navigate, open, filter, timer
    selectors/           # pure functions: the ONLY source of displayed numbers
    engine/              # deterministic programming math (no LLM)
    agent/               # loop, system prompt, context builder
    llm/                 # copied from personal-fin
    data/                # thin persistence: path -> typed read/write via sync.ts
  components/            # shell, assistant, shared UI
  features/              # today, session, program, exercises, history, insights, settings
```

### The command definition

```ts
export interface Command<A = any, R = any> {
  name: string                 // 'workout.log_set'  — namespace.verb_noun
  title: string                // 'Log set'          — undo card / audit label
  description: string          // fed verbatim to the LLM as the tool description
  schema: JsonSchema           // params; used for LLM tool defs AND runtime validation
  kind: 'read' | 'write' | 'destructive'
  handler(args: A, ctx: CommandContext): R | Promise<R>
  /** Inverse operation for the shared undo stack. */
  undo?(args: A, before: Snapshot, ctx: CommandContext): void
  /** One-line past-tense summary for the activity log and chat action cards. */
  summarize?(args: A, result: R): string
}
```

- `run(name, args)` — validates against `schema`, snapshots the touched files, executes,
  pushes to the activity log, returns a result. **Both UI event handlers and the agent call
  this.** A button's `onClick` is `() => run('workout.log_set', { … })`.
- `kind: 'destructive'` → `ctx.confirm()` prompt, in the UI *and* in chat.
- `toolDefs()` → `ToolDef[]` for the LLM, generated from the registry. Never hand-written.

### How parity is enforced (not just intended)

1. **Persistence is private.** `lib/data/*` exports are only importable from `lib/commands/*`.
   Enforced by an oxlint `no-restricted-imports` rule plus a `scripts/check-parity.mjs` run in
   `npm run build`. A component that tries to write directly fails the build.
2. **Selectors are the only numbers.** Components import from `lib/selectors/*`; each selector
   is registered as a read command by a single `defineSelectorCommand()` wrapper, so
   registering a chart registers the AI's ability to read it.
3. **No hidden product commands.** Every registered command becomes an AI tool. There is no
   `aiExposed: false` escape hatch; security boundaries such as credential entry are not domain
   commands and stay outside the product command surface.
4. **Coverage report.** `npm run parity` prints every command, whether it's AI-exposed, whether
   it has `undo`, and any selector without a read command. Cheap, visible, keeps it honest.

### Shared undo + audit

Every `run()` appends to an activity log persisted to `reps-data/activity/YYYY-MM.json`:
`{ id, at, source: 'ui' | 'ai' | 'system', command, args, summary, undoable }`.

- Chat renders AI writes as action cards with **Undo** (same pattern as personal-fin).
- A **Settings → AI activity** page lists every write the AI has made, with revert. This is the
  trust mechanism that makes "let the AI do everything" acceptable.

---

## 4. Domain model

Richer than personal-fin's fitness module — this is a dedicated app, so programs,
autoregulation, and **non-gym training** are first-class.

### 4a. Venues and modalities — the generalization

Training isn't only barbells in a gym. A walk in the park, a Sunday cycle, a swim, and a
mobility session are all sessions, and where you are determines what's possible. So the "which
gym am I at" idea generalizes into **Venue × Modality**, and both feed the programmer.

```ts
Modality = 'strength' | 'walk' | 'run' | 'cycle' | 'swim' | 'hike'
         | 'mobility' | 'sport' | 'other'

Venue               // where training happens — gym, home, park, road, pool, studio
  id, name,
  kind: 'gym' | 'home' | 'outdoor' | 'pool' | 'studio' | 'other',
  equipment: string[],          // free-exercise-db equipment values; empty for a park
  modalities: Modality[],       // what this venue supports
  defaultFor?: Modality[],      // "cycling" implies the road venue
  travelMinutes?: number,       // AI weighs this: short window → home session
  isDefault?: boolean, notes?   // "squat rack usually busy 6-8pm"
```

Consequences that make this more than a label:

- The programmer only selects exercises the **current venue's equipment** supports, and only
  programs modalities the venue offers. "I'm at the park today" → bodyweight circuit or a walk,
  never barbell rows.
- A week can be **mixed**: 3 lifting days at the gym, a Tuesday walk, a weekend cycle. The
  program's days each carry a `modality` and a preferred `venueId`.
- Recovery reasoning gets honest: a long cycle is leg fatigue, a walk is not. The engine's
  fatigue model weights cardio load into lower-body recovery rather than ignoring it.

### 4b. Types

```ts
// ---- Library ----
Exercise            // free-exercise-db shape + custom user exercises
  id, name, category, force, level, mechanic, equipment,
  primaryMuscles[], secondaryMuscles[], instructions[], images[],
  custom?: true, aliases?: string[], substitutionsOf?: string  // user-defined swaps

// ---- Planning ----
Program             // a mesocycle: the AI's actual output
  id, name, goal, weeks, daysPerWeek, split,           // 'PPL' | 'ULx2' | 'full-body' | custom
  startDate, status: 'active' | 'completed' | 'archived',
  progression: ProgressionScheme,                       // see §6
  days: ProgramDay[],                                   // ordered template days
  rationale, generatedBy: 'ai' | 'manual', deloadWeek?: number

ProgramDay          // a template, not a dated session
  key, name, modality: Modality, venueId?, focus[],
  exercises: PlannedExercise[],                         // strength days
  target?: CardioTarget                                 // walk/run/cycle/swim days
CardioTarget
  durationMin?, distanceKm?, effort?: 1..5, style?: 'steady' | 'intervals' | 'easy'
PlannedExercise
  exerciseId, sets, repRange: [lo, hi], targetRir?, restSeconds,
  loadRule: 'e1rm-pct' | 'last-session' | 'fixed' | 'bodyweight', loadValue?, notes?

// ---- Execution ----
Session             // a dated, logged instance (any modality)
  id, date, modality, venueId?, programId?, programDayKey?, name, focus[],
  source: 'program' | 'ai-adhoc' | 'manual' | 'quick-log',
  startedAt?, endedAt?, readinessId?,
  exercises: SessionExercise[],                         // strength/mobility/sport
  cardio?: CardioResult,                                // walk/run/cycle/swim/hike
  rationale?, debrief?: string, feeling?: 1..5, notes?
CardioResult
  durationSec, distanceM?, effort?: 1..5, avgPaceSecPerKm?  // derived, elevationM?, route?
SessionExercise
  exerciseId, name, mode: 'reps' | 'duration' | 'distance',
  restSeconds?, sets: SetEntry[], swappedFrom?, notes?
SetEntry
  type: 'warmup' | 'working' | 'drop' | 'amrap' | 'failure',
  targetReps?, targetWeight?, targetDurationSec?, targetDistanceM?, targetRir?,
  reps?, weight?, durationSec?, distanceM?, rir?, rpe?,
  restActualSec?, done, at?                             // timestamp → real session pacing

// ---- Context the coach needs ----
Profile             // goal, experience, daysPerWeek, height, birthYear,
                    // injuries, preferences, units ('kg'|'lb'), bar/plate inventory
Venue[]             // §4a
BodyMetric          // date, weightKg, bodyFatPct?, measurements{}
Readiness           // date, sleepHours, soreness 1-5, stress 1-5, energy 1-5, note
PersonalRecord      // derived, cached: exerciseId, kind: '1rm'|'e1rm'|'volume'|'reps'|'distance', value, date
CoachMemory         // rolling summary the AI rewrites; durable client facts survive rewrites
```

**Design notes**

- **One `Session` type for every modality.** A walk is a session with `cardio` populated and no
  exercises; a lifting day is the inverse; a "gym + 10 min bike finisher" populates both. This
  keeps history, streaks, adherence, and the AI's tool surface unified instead of forking into
  two apps.
- **Cardio is logged manually in v1** — duration, distance, effort. No GPS tracking, no map, no
  wearable import; that's a separate scope and the app should not pretend to be Strava.
- **RIR/RPE from day one.** Without it the progression engine is guessing, and it's the single
  highest-value field a lifter can log. One tap, optional.
- **Per-set timestamps** give real rest times and session density for free — zero extra input.
- **Program ≠ session.** personal-fin regenerates one workout at a time; that can't produce
  coherent progressive overload across weeks. Reps generates a mesocycle, then *instantiates*
  each day, then autoregulates it against readiness.

### Data repo layout (`reps-data`)

```
profile.json                 # Profile
venues.json                  # Venue[]
programs/<id>.json           # Program
programs/index.json          # { activeId, list: [{id,name,status,startDate}] }
sessions/2026-08.json        # Session[]   (one file per month, all modalities)
body/metrics.json            # BodyMetric[]
body/readiness.json          # Readiness[]
exercises/custom.json        # user-created exercises + aliases + substitutions
records.json                 # PersonalRecord[] (derived cache, rebuildable)
coach-memory.json            # CoachMemory
activity/2026-08.json        # command audit log
settings.json                # app prefs (never tokens)
```

Same local-first sync semantics as personal-fin: writes hit localStorage instantly, mark dirty,
debounce-push to GitHub, conflict → id-keyed merge.

---

## 5. Exercise library

- **free-exercise-db** (873 exercises, public domain, images) via jsDelivr, cached in the Cache
  API — same as personal-fin's `exerciseDb.ts`, copy it.
- **Additions:** user-created custom exercises, user aliases ("OHP" → standing military press),
  and a substitution graph (AI-populated: "no cable machine → use X").
- **Search must be AI-usable:** `exercise.search` command with filters (muscle, equipment,
  mechanic, level, text) returning compact rows — this is what keeps the plan prompt small.

---

## 6. The programming engine — deterministic core, AI judgment layer

The most important engineering decision in the app.

**Rule: never ask the LLM to compute what TypeScript can compute.**

`lib/engine/` (pure, synchronous, offline, free):

- `e1rm(weight, reps, rir)` — Epley/Brzycki with RIR adjustment.
- `progress(exercise, lastPerformance, scheme)` — double progression, linear, or %-of-e1RM.
  Completed all sets at top of rep range at target RIR → add load. Missed → hold or back off.
- `volumeByMuscle(sessions, window)` — hard sets per muscle group per week.
- `landmarks(profile)` — MEV/MAV/MRV heuristics per muscle for the experience level.
- `fatigue(sessions, today)` — per-muscle recovery state from the 48–72h model + set volume,
  **including cardio load** (a long ride counts against quads; a walk barely counts at all).
- `deloadDue(program, sessions, readiness)` — week counter + performance-drop signal.
- `plateMath(targetKg, barKg, inventory)` — what to actually load on the bar.
- `instantiate(programDay, history, venue, engine)` — turns a template into today's concrete
  session with real target weights, **filtered to the venue's equipment**. Runs offline with no
  API key. For a cardio day it resolves the target (duration/distance/effort) the same way.

`lib/agent/` + `lib/coach/` (LLM):

- **Program generation** — choose the split, **the weekly mix of modalities** (which days lift,
  which walk or ride, and at which venue), exercise selection, ordering, set/rep prescription,
  and the rationale. Structured output, validated against the library and against each venue's
  equipment; near-miss ids salvaged by name (reuse personal-fin's `planner.ts` salvage logic).
- **Autoregulation** — given today's instantiated session + readiness + recent adherence +
  where you actually are, adjust: cut volume, swap a lift around a niggle, extend a deload, or
  downgrade a hard session to a walk when you're wrecked. It edits, it doesn't regenerate.
- **Explanation** — why this workout, what to focus on, what to watch.

Practical consequences: the app is fully usable in the gym with no network and no API key; AI
calls happen at program boundaries and on explicit asks, not every session. Cost stays trivial.

---

## 7. The tracker (in-session UX)

This has to be excellent or the AI is decorating a tool nobody opens.

- **Today screen** — the session card, big set rows, one tap to complete a set (prefilled with
  targets), `+/−` steppers for weight/reps, RIR as a 4-chip row. A cardio day collapses to a
  single card: start, elapsed timer, distance and effort on finish.
- **Rest timer** — auto-starts on set completion, per-exercise duration, notification + sound,
  keeps running in background (copy/extend personal-fin's `RestTimer.tsx`).
- **Plate visualizer** — what to put on each side. Small feature, disproportionate joy.
- **Last-time ghost** — every set row shows what you did last time, greyed. This is what makes
  progressive overload feel automatic.
- **Swap in place** — long-press an exercise → AI-ranked substitutes given the current venue's
  equipment (`exercise.suggest_substitutes`).
- **Venue switch** — one tap in the session header ("at home today"), which re-instantiates the
  session against what's actually available.
- **PWA installable, offline-first.** Everything above works with no network.
- **Quick log** — freeform "bench 3x8 60, squat 5x5 80" or "walked 40 min in the park" parsed
  into a session (port and extend `parseQuickLog`), for anything done outside the app.

*Deliberately out of v1:* voice logging and screen wake lock. Both are additive later and
neither blocks the core loop.

---

## 8. AI surfaces

Chat is one of six. All of them route through the same command registry.

1. **Omnipresent assistant** — floating button, bottom sheet, full tool surface, action cards
   with undo, confirmations on destructive commands. Adds over personal-fin: **streaming
   replies** (chat-heavy app, latency is felt) and inline rich results (a rendered set table
   instead of a paragraph).
2. **Camera** — the LLM layer already carries `ImageAttachment`. Photograph a gym's equipment →
   populate a Venue. Photograph a whiteboard or paper log → parse into a session.
3. **Home coach card** — generated on open, not on a schedule: readiness + days since last
   session + program position + where you are → "Push day B, and drop OHP to 3 sets — you slept
   5h." On a rest day it can just say go for a walk, and log it in one tap.
4. **Post-session debrief** — on finishing: what progressed, what stalled, PRs hit, what's next.
   Written into the session and into coach memory.
5. **Mesocycle review** — at program end: deload, repeat with more volume, or change the split
   or the modality mix. Produces the next Program as a proposal you accept or edit.
6. **Ask-anywhere** — every list/chart has an ask box that runs a read command and filters the
   view. "Show me every session where I benched over 70" narrows the actual history list.

*Deliberately out of v1:* voice mode. The parity contract means it's purely a new input surface
over existing commands whenever it's wanted — no re-architecture.

### Agent loop

Port `agent.ts` (round cap 6, tool-call budget 12, tool errors returned to the model) with:

- **Tool defs generated from the registry** — the parity payoff.
- **Layered context**: static profile + venues → compact state overview (active program, today's
  session, current venue, last 5 sessions across all modalities, PRs on main lifts, readiness) →
  coach memory. Detail is fetched by tool call, never dumped into the prompt.
- **Tiered models**: the cheap flash/mini/haiku default for chat and parsing; a stronger model
  selectable for program generation (a per-task model override in settings). Note the known
  Provider-specific request formats are owned by the Vercel AI SDK adapters rather than Reps.

---

## 9. Insights

Every one of these is a selector + read command, so the AI can quote it exactly:

- e1RM trend per lift, with PR markers
- Weekly hard sets per muscle group vs MEV/MAV/MRV bands
- Adherence: planned vs completed sessions, by week
- **Modality mix** — lifting vs walking vs cycling minutes per week, and total active days
- Cardio trend: weekly distance and duration, pace on repeated routes
- Session density (work time vs rest, from set timestamps)
- Body weight overlaid on strength trend
- Stall detector: exercises with no e1RM progress in N weeks
- Muscle balance: push/pull ratio, quad/hamstring ratio

---

## 10. Cold start — no migration

No data comes over from Life OS, and Life OS is not modified. Reps begins empty, which makes
the **first-run setup the thing that has to be good** — the first program is otherwise
programmed blind.

An **AI-led setup conversation** (the pattern personal-fin uses in `SetupChat.tsx`, extended)
that fills in, through a handful of questions rather than a form wall:

1. Goal, experience, how many days a week, how long a session can be.
2. **Venues** — "where do you train?" → gym (which equipment), home (what's there), park, road.
   The camera surface (§8.2) can populate a gym's equipment from one photo.
3. Injuries, hard constraints, things you refuse to do.
4. **Baseline strength** — rough current working weights on the main lifts, or "I don't know",
   in which case week 1 is deliberately conservative and treated as a calibration week: the
   engine sets easy targets, watches your actual RIR, and corrects loads from real data.
5. Anything else in their own words → seeds `coach-memory.json`.

Everything the setup writes goes through commands, so the AI can also do the whole thing
conversationally later ("actually I've got a bench at home now").

Baseline calibration is what replaces imported history — after two weeks of logging, the
engine has better data than any migration would have given it.

---

## 11. Milestones

Sized in focused sessions, assuming the fast-iteration workflow (build + screenshot, no tests).

| # | Milestone | Contents | Size |
|---|---|---|---|
| **M0** | Scaffold | Vite app, copied infra (github/sync/cache/llm/onboarding), shell + routing, Pages workflow, `reps-data` repo created | 1 |
| **M1** | Command spine | `registry.ts`, `context.ts`, activity log + undo stack, parity lint + `npm run parity` | 1 |
| **M2** | Model + manual tracker | Types, data layer, exercise library, venues, Today screen, set logging, cardio logging, rest timer, history — **all via commands** | 2–3 |
| **M3** | Assistant v1 | Agent loop, generated tool defs, chat sheet with action cards/undo, confirmations. AI can now do everything M2 does | 1–2 |
| **M4** | Programming engine | `lib/engine/*` deterministic math, AI program generation (mixed modality, venue-aware), instantiate-day, swap/edit commands | 2 |
| **M5** | Setup + in-gym polish | AI-led first-run setup, calibration week, PWA + offline, ghost sets, plate math, venue switch, quick log | 2 |
| **M6** | Insights | Selectors + charts + matching read commands, PR detection, modality mix | 1–2 |
| **M7** | Proactive coach | Readiness check, home coach card, post-session debrief, mesocycle review, coach memory | 1–2 |
| **M8** | Polish | AI activity page, settings, empty states, camera surface | 1 |

**Order rationale:** M1 before M2 is non-negotiable — retrofitting the command spine onto a
built UI is exactly the drift this design exists to prevent. M3 lands right after the first real
feature set so the parity contract is proven while the surface is small.

---

## 12. Decisions taken (flag any you disagree with)

- **New app repo + new data repo**, and **Life OS is left completely alone** — no code changes,
  no data migration, its fitness module keeps working as-is.
- **Training is multi-modality from v1** — lifting, walks, cycling, swims, mobility — organized
  as Venue × Modality, because where you are decides what's trainable.
- **No voice mode, no voice logging, no wake lock in v1.** All additive later over the same
  commands.
- **No GPS/route tracking and no wearable import.** Cardio is logged by hand.
- **Copy infra rather than share a package** — matches the fast-iteration preference; extract
  later if a third app appears.
- **No test suite by default**, consistent with how you work on personal-fin: verify via
  `npm run build` (typecheck) + headless screenshot. *One exception worth considering:* a
  `npm run eval` script — ~30 utterances mapped to expected command calls, run manually against
  a provider. Not a test suite; a way to notice when a new tool description breaks routing.
  Say the word and I'll include it, otherwise it's out.
- **Deterministic-first programming engine.** Costs more upfront than "ask the LLM each time,"
  buys offline capability, consistency, and near-zero API spend.
- **kg default, lb supported** via `Profile.units`; stored always in kg.

## 13. Known gotchas carried over

- Local builds need Node 22: `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"` —
  the default shell node (18.16) crashes Vite with `CustomEvent is not defined`.
- Never "rerun failed jobs" on the Pages workflow (duplicate-artifact error) — dispatch fresh
  with `gh workflow run deploy.yml`.
- Contents API GETs can be stale for a second or two after a commit.
- App repo must be public for free-plan Pages; data repo private.
- Keep Vercel AI SDK and its provider packages on compatible major versions; they own provider request-shape changes.

## 14. Settled

- Name: **Reps**. Repos: `mayank-meragi/reps` (public app), `mayank-meragi/reps-data` (private).
- Multi-modality training in v1, via Venue × Modality.
- No migration; no changes to Life OS.
- Voice and wake lock deferred.

## 15. Still open

1. **Wearables later?** Doesn't affect M0–M4, but if Apple Health / Strava import is ever
   wanted, `Readiness` should carry HRV and resting HR fields from the start — they're cheap to
   add now and awkward to backfill.
2. **The `npm run eval` script** (§12) — in or out?
