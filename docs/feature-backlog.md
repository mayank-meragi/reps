# Reps feature backlog

This document is a parking lot for product ideas worth revisiting. It is not a committed
roadmap and the ordering can change.

The Reps product rule still applies to every item below:

> Design the AI capability first. Every fact shown in the interface must be readable by the
> AI, and every domain action available in the interface must be available through the same
> typed command surface.

## Candidate features

### 1. Daily readiness check-in

Ask about sleep, soreness, energy, stress, pain, available time, and motivation before a
session. Let the AI inspect the answers and decide whether to alter volume, intensity,
exercise selection, or recommend recovery. Keep the raw answers, the AI's decision, and its
rationale visible.

### 2. Muscle recovery map

Estimate recovery for each muscle group from recent training load, proximity to failure,
elapsed time, soreness, and imported activity. Display it on an interactive human silhouette.
Allow the user to correct the estimate when their body feels different from the model.

### 3. Automatic progressive overload

Recommend load and reps for every working set using prior performance, RPE/RIR, completed and
failed reps, rep-range position, and recent fatigue. Explain why a target went up, stayed the
same, or decreased.

### 4. AI-managed deloads and program changes

Detect stalls, unusually high fatigue, poor adherence, recurring pain, or persistent
underperformance. Let the AI propose a deload or program adjustment, show the evidence, and
apply it only after approval.

### 5. Exercise preference learning

Support explicit "more like this", "less like this", and "never suggest" feedback. Also let
the AI infer possible preferences from repeated swaps or skipped movements, but expose those
inferences in the editable coach profile rather than silently treating them as facts.

### 6. Focused live-workout mode

Provide a one-handed session interface with automatic rest timers, previous performance,
today's target, large set controls, live personal-record notices, and minimal navigation.
Support warm-up, working, drop, failure, and AMRAP sets plus supersets and circuits.

### 7. Warm-up generator

Give the AI tools to inspect the working weight, movement, training history, readiness, and
available equipment, then create ramp-up sets and a short movement-specific warm-up.

### 8. Plate and equipment calculator

Show the exact plates required on each side. Account for bar weight, available plates, machine
increments, dumbbell conventions, and whether a displayed load is total, per side, or per hand.

### 9. Intelligent exercise substitutions

Handle requests such as "the machine is occupied", "my shoulder hurts", or "I'm at another
gym". Give the AI exercise-search and comparison tools so it can preserve the movement goal,
target muscles, fatigue cost, equipment constraints, and progression intent. A substitution
can apply once or to future sessions.

### 10. Technique video analysis

Let users record or upload a set. AI-assisted review could comment cautiously on visible range
of motion, tempo, symmetry, setup, and bar path, while making uncertainty explicit. Preserve
videos privately and allow comparison over time. This should not diagnose injuries.

### 11. Contextual personal records

Track more than maximum weight:

- Estimated one-rep max
- Rep record at a given load
- Best session or exercise volume
- Best performance at a given body weight
- Tempo or pause record
- First pain-free performance after a limitation
- Best set completed above a chosen RIR threshold

### 12. Muscle-volume and balance analysis

Calculate weekly hard sets by muscle, direct and indirect work, movement-pattern balance,
push/pull balance, frequency, and change over time. The AI should be able to inspect the same
numbers and explain gaps without treating generic volume ranges as universal prescriptions.

### 13. Adaptive training calendar

When a workout is missed or moved, let the AI reorganize the rest of the week while preserving
recovery, important lifts, venue availability, and the program's priorities. Show the proposed
calendar changes before applying them.

### 14. Health and wearable integrations

Potential integrations include Apple Health, Health Connect, Garmin, Fitbit, and Strava.
Useful inputs include external workouts, sleep, steps, resting heart rate, heart-rate
variability, body weight, and cardio load. Imported data must remain inspectable and removable.

### 15. Progress photos and body measurements

Offer private photo comparisons with consistent framing plus measurements and body-weight
timelines. Correlate these with training history, but avoid claiming that a visual change was
caused by one exercise or program.

### 16. Shareable workouts and programs

Create attractive workout summaries and shareable program links. Allow users to import a
shared routine and ask the AI to adapt it to their goals, experience, venue, equipment, and
limitations.

### 17. Human-coach collaboration

Let a human coach inspect AI-generated programming, comment on sessions, review technique
videos, message the athlete, and override recommendations. Preserve authorship so users can
see whether a decision came from themselves, the AI, or a human coach.

## Interactive muscle silhouette

### Product concept

Use front and back anatomical silhouettes as a shared visual language across Today, Workout,
Progress, and Recovery. The silhouette should answer one question at a time rather than mix
several incompatible meanings into a single heat map.

The memorable interaction is **time-scrubbing the body**: drag across the current week or the
last twelve weeks and watch training load, recovery, or progress move across muscle groups.

### Four distinct modes

#### Targeted today

Highlight muscles involved in the selected workout:

- Primary muscles use the strongest color.
- Secondary muscles use a lighter tint.
- Tapping a muscle shows the exercises contributing to it and whether each contribution is
  primary or secondary.
- Before generation, the AI can use this view to explain the intended focus. After generation,
  the user can ask it to increase or reduce work for a selected muscle.

#### Weekly load

Show effective sets, frequency, and recent volume for each muscle group. Tapping a muscle opens
its weekly history and the exercises that contributed to the total. Direct and estimated
indirect work must be shown separately or clearly labelled.

#### Recovery

Show an estimated recovery state per muscle, such as fatigued, recovering, or ready. Display
the inputs behind the estimate—recent sets, RPE/RIR, soreness, elapsed time, and external
activity—and allow manual correction.

#### Progress

Show a progress trend only when there is enough comparable data. The detail panel should expose
the real measurements behind it:

- Change in estimated strength for exercises involving the muscle
- Rep and load progression
- Weekly volume tolerance
- Training consistency and frequency
- Body measurements, when supplied
- Relevant personal records

### Avoid a misleading "muscle improvement percentage"

Reps cannot directly know that a user's chest, quadriceps, or biceps improved by a precise
percentage from workout logs alone. Strength is exercise-specific, hypertrophy is not directly
measured, and a muscle often contributes to several movements.

Use one of these honest alternatives:

1. **Metric-specific percentages** — for example, "bench-press estimated 1RM +8.4% in 12
   weeks" or "weekly completed chest volume +12%".
2. **Muscle progress trend** — improving, stable, declining, or insufficient data, with the
   evidence shown underneath.
3. **A transparent 0–100 progress score** — only if the score is labelled as a Reps score, not
   biological muscle growth. Its calculation and confidence must be visible.

A possible progress score could combine normalized strength trend, rep progression,
consistency, and volume tolerance. It should never include soreness as improvement, and it
should not compare unrelated exercises as though they were equivalent.

### Confidence and data quality

Every muscle-level result should have a confidence state:

- **High:** repeated comparable exercises and consistent logging
- **Medium:** useful history, but exercises or conditions changed
- **Low:** sparse data or mostly indirect work
- **Not enough data:** do not invent a score

Tapping the confidence label should explain what data would make the result more reliable.

### Suggested detail sheet

When a muscle is selected, open a bottom sheet containing:

- Current state: targeted, load, recovery, or progress
- The principal number and its time window
- Trend chart
- Contributing exercises
- Direct versus indirect sets
- Recent records
- AI explanation in plain language
- Actions: ask the coach, adjust today's emphasis, reduce volume, or correct recovery

### AI capabilities required before UI work

The capability layer should be able to:

- List the canonical muscle taxonomy and body-map regions.
- Resolve exercise primary and secondary muscles from the exercise catalog.
- Calculate workout muscle contribution through shared selectors.
- Read muscle load for a date range.
- Read and correct estimated recovery.
- Read metric-specific progress and confidence for a muscle and time range.
- Explain which exercises and sessions contributed to every displayed value.
- Ask the AI to rebalance or regenerate a workout around selected muscles.
- Apply proposed changes through existing workout and program commands.

The UI and AI must use the same selectors for every highlight, percentage, status, and chart.

### Visual direction

Keep the surrounding interface quiet and let the anatomical silhouette be the signature
element. Use a neutral body base with one semantic color scale per mode; do not stack recovery,
load, and progress colors simultaneously. Provide a legend, front/back toggle, accessible list
equivalent, keyboard selection, and patterns or labels that do not rely on color alone.

### Suggested delivery order

1. Canonical muscle taxonomy and exercise-to-muscle mapping
2. Today's target view
3. Weekly direct/indirect set view
4. Muscle detail sheet and AI explanations
5. Recovery estimates and manual corrections
6. Metric-specific progress trends and confidence
7. Time scrubber and wearable-informed recovery

### Implementation options

#### Recommended package: `react-muscle-highlighter`

This is the best starting point for the current React application. Version 1.2.0 supports
React 18 and 19, includes TypeScript declarations, uses SVG, and provides front/back and
male/female models, per-muscle colors and styles, left/right targeting, disabled/hidden parts,
and click callbacks. It is MIT licensed.

Do not let package slugs become Reps domain values. Import the package only inside a
Reps-owned `MuscleMap` adapter and translate between the canonical Reps taxonomy and the
package's body-part slugs. This makes replacing or forking the renderer possible without a
data migration.

#### Alternative: `react-body-highlighter`

This package is smaller, MIT licensed, and supports anterior/posterior SVG views, intensity
colors, and muscle click callbacks. However, its latest published version is older and its
muscle taxonomy is relatively coarse. It is suitable for a quick prototype but is a weaker
long-term foundation.

#### Maximum-control option: Reps-owned SVG

Maintain front and back SVGs in the repository with stable IDs on every muscle path. This
provides complete visual, animation, accessibility, and taxonomy control, at the cost of
creating and maintaining the anatomical artwork. An open-source illustration can only be used
after confirming that its license and attribution requirements are compatible with the app.

The practical path is to prototype behind the adapter with `react-muscle-highlighter`, then
fork or replace the SVG renderer only if its anatomy or accessibility becomes limiting.

### Proposed implementation architecture

```text
exercise catalog
      ↓ canonical name normalization
exercise-muscle contribution selector
      ↓
muscle analytics selectors ──→ typed insight commands ──→ AI coach
      ↓                                      ↓
MuscleMapDatum[]                     same exact values
      ↓
Reps MuscleMap adapter ──→ SVG package ──→ detail sheet
```

Core types:

```ts
type MuscleMapMode = 'target' | 'load' | 'recovery' | 'progress'

interface MuscleMapDatum {
  muscle: CanonicalMuscle
  value: number | null
  unit: 'contribution' | 'sets' | 'recovery-score' | 'percent'
  level: 0 | 1 | 2 | 3 | 4
  status: string
  confidence: 'high' | 'medium' | 'low' | 'insufficient'
  primaryExerciseIds: string[]
  secondaryExerciseIds: string[]
  evidence: string[]
}
```

Suggested shared selectors and commands:

- `selectWorkoutMuscleTargets(session)` / `insights.muscle_targets`
- `selectMuscleLoad(sessions, range)` / `insights.muscle_load`
- `selectMuscleRecovery(sessions, readiness, date)` / `insights.muscle_recovery`
- `selectMuscleProgress(sessions, range)` / `insights.muscle_progress`
- `selectMuscleDetail(muscle, mode, range)` / `insights.muscle_detail`
- `readiness.correct_muscle_recovery` for user corrections

Computed body-map values should not be stored. Derive them from sessions, exercises,
readiness, and body metrics so historical views remain reproducible. Store only genuine user
inputs such as soreness or a recovery correction.

Reps already has useful foundations: primary/secondary muscles in the exercise catalog,
weekly volume and muscle-balance selectors, a basic fatigue model, insight commands, React
Query, and Recharts. The first version therefore needs a taxonomy adapter, renderer, target
selector, and detail sheet rather than a new analytics system from scratch.

## Reference products

- [Hevy features](https://www.hevyapp.com/features/): live logging, set types, timers,
  personal records, muscle charts, progress media, social features, and utilities.
- [Hevy Trainer](https://www.hevyapp.com/features/workout-plan-generator/): adaptive plans,
  progressive overload, working-weight adjustment, and muscle distribution.
- [Fitbod workout generation](https://help.fitbod.me/hc/en-us/articles/360004429814-How-Fitbod-Creates-Your-Workout): recovery-aware generation and explicit exercise preferences.
- [Fitbod recovery](https://help.fitbod.me/hc/en-us/sections/360012732693-App-Features): muscle recovery visualization and imported activity.
- [Alpha Progression](https://alphaprogression.com/en/): per-set progression targets,
  periodization, RIR, deloads, and exercise video.
- [Freeletics](https://www.freeletics.com/en/hiit-workout-app/): adaptation using feedback,
  available time, soreness, and desired difficulty.
- [TrainHeroic for athletes](https://www.trainheroic.com/athlete/): training calendar,
  exercise instruction, recovery, and progress tracking.
- [TrainHeroic for coaches](https://www.trainheroic.com/coach/): messaging, compliance,
  programming, technique-video review, and human coaching.
