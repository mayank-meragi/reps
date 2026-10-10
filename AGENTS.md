# Reps development contract

## AI capability parity is the product

Reps is not a UI with an assistant attached. The human UI and the AI are two clients of the same typed command surface. Every product feature must be fully operable and inspectable by the AI.

Before implementing or extending a feature:

1. Inventory the existing commands, selectors, and external data tools. Reuse capabilities that already exist instead of creating a parallel path.
2. Write the AI workflow first: list the read/search/filter tools the AI needs to understand the state, then the write commands it needs to act.
3. Add or extend those typed commands before building the UI. UI event handlers must dispatch through `run()`/`useRunCommand()`.
4. Give the AI discovery tools, not hidden application decisions. If a feature uses a catalog or API, expose list/search/filter/facet commands and let the AI decide which tools to call and how to use their results. Code may validate permissions, IDs, schemas, safety constraints, and invariants; it must not silently make product decisions on the AI's behalf.
5. Make every meaningful value shown in the UI available through a read command backed by the same selector.
6. Verify the complete AI path, not only the button path: the AI must be able to discover IDs, inspect relevant state, perform the action, and read back the result.

Definition of done for every feature:

- There is no UI-only domain action.
- Every registered product command is automatically exposed as an AI tool.
- Required IDs and options are discoverable through typed list/search/filter/facet commands.
- Tool descriptions and schemas are sufficient for the AI to use without guessing.
- UI and AI writes use the same command handler, validation, audit log, and undo behavior.
- `npm run parity`, `npm run build`, `npm run lint`, and `npm test` pass.
- The feature was exercised in the running app (see "Working agreement"), not only compiled.
- The FE and DRY rules below are met.

Credential entry and ephemeral presentation state (for example, whether a dialog is visually open) are security/UI boundaries, not domain features. They may remain local, but any domain state or behavior behind them must still have command parity.

## Working agreement

- **One feature at a time.** Finish, verify and report a feature before starting the next. Do not bundle a second feature, a redesign or an unrelated refactor into the same change. If something else needs doing, say so and wait.
- **Verify in the running app.** The user's dev server is already on port 5173 (it is also the Google OAuth origin). Open it in the browser pane; never kill it, never start a second copy on another port. Report what you saw, and say plainly what you could not verify.
- **Other people's edits.** Other sessions or the user may edit files at the same time. Do not overwrite or revert a file you did not change; surface the conflict instead. Back up before any bulk removal.
- **Keep the user's data safe.** Do not clear the local database, the sync state or stored Google tokens as a shortcut while testing.

## Frontend: shadcn first

Every piece of UI is built from the shadcn components in `src/components/ui` (style `radix-nova`, configured by `components.json`).

1. **Look before you build.** Check `src/components/ui` for the primitive. If it is missing but shadcn has it (tabs, tooltip, toggle-group, sheet, skeleton, badge, scroll-area, slider, switch, popover, dropdown-menu, …), add it with `npx shadcn@latest add <name>` and use it. Do not hand-write a replacement.
2. **No hand-rolled primitives.** Buttons, inputs, selects, dialogs, cards, tabs, progress bars, badges, tooltips, separators, switches and sheets come from shadcn. A raw `<button>`, `<select>`, `<input>` or `<div>` styled to look like one of them is a bug. Raw elements are for layout and text only.
3. **Compose, don't fork.** Change a look through the component's `cva` variants, `className` and the theme tokens. If a look repeats, add a variant to the shadcn component (or a thin wrapper in `src/components` that composes it), never a copy.
4. **Theme through tokens.** Colors, radii and shadows come from the CSS variables in `src/index.css` (`bg-card`, `text-muted-foreground`, `--viz-*`, score and zone tokens). No hardcoded hex, `rgb()` or one-off pixel values in components. A new color is a new token, defined once for light and dark. The dark health look is a theme (tokens), not per-component colors.
5. **Icons and utilities.** Icons come from `lucide-react`. Class merging goes through `cn()`. Charts use `recharts` with the `--viz-*` tokens.
6. **Accessible by default.** shadcn/Radix gives keyboard and ARIA behavior; do not bypass it. Interactive things are real buttons or links, tap targets are at least 44px on mobile, and nothing relies on color alone.
7. **Check small screens.** Every UI change is looked at at phone width (375px), where most use happens.

## Code must be DRY

1. **Search before you write.** Before adding a helper, formatter, hook, selector, type or component, search the repo for one that already does it (`grep`, `src/lib`, `src/components`, `src/hooks`). Reuse or extend it.
2. **One implementation per concept.** Date math lives in `src/lib/dates.ts`, formatting in one shared `src/lib/format.ts`, class composition in `cn()`. A second copy of the same logic is a bug, even if it is only three lines. Extract on the second occurrence, not the third.
3. **One selector, two clients.** A number shown in the UI is computed by a selector in `src/lib/selectors` or `src/lib/health`, called by both the page (through its command) and the AI command. Never recompute it in a component.
4. **Constants and configuration have one home.** Thresholds, weights, labels, ids, type lists and zone definitions are named, exported constants next to the logic they belong to. UI code imports them; it does not restate them.
5. **Repeated JSX becomes a component.** Two near-identical blocks become one component with props. Pages stay thin: query a command, hand the result to components.
6. **Delete as you go.** Remove dead code, unused exports and superseded files when you replace something.

## Data layer: local first

- All app data is stored in the local IndexedDB database (`src/lib/db`, Dexie) first. Writes go to the local database, then sync to the GitHub data repo in the background. Reads come from the local database.
- Only `src/lib/commands`, `src/lib/db`, `src/lib/google` and `src/lib/cache.ts` may import the database or `src/lib/sync` (enforced by `scripts/check-parity.mjs`). Components and pages read and write through commands.
- Large or high-frequency data (for example heart rate, ~38,000 samples a day) is rolled up while syncing into small per-day rows. Never store raw high-volume samples.
- Google OAuth uses only the client ID (Settings, stored like the other keys). Tokens are short-lived and kept locally.

## Health algorithms: research, propose, get approval, then build

Scores, baselines, thresholds and any other health computation are product decisions. Do not pick one silently and do not write code for it first.

1. **Research thoroughly.** Look at how established products and the literature do it: Whoop, Oura, Garmin (Firstbeat Body Battery, Training Status), Fitbit and Google Health, Polar (Nightly Recharge, Training Load), Apple, Bevel, Elite HRV, Athlytic, and the research behind them (for example Banister impulse-response and TRIMP, Edwards TRIMP, Lucia, RMSSD and HRV-guided training papers, sleep-staging and sleep-quality research, Karvonen and heart-rate-reserve methods). Use published docs, papers, patents and open implementations. Say clearly where a method is proprietary or unpublished and what is only inferred. Cite every source with a link.
2. **Present several options, not one.** For each metric, put at least three candidate algorithms side by side (fewer only if you can show that fewer genuinely exist, and say why). For each: inputs, formula, what it measures, what data we actually have from the Fitbit Air and the Google Health API, cold-start behavior, personalization, known limits, and cost to build.
3. **Test candidates on the user's own data before recommending.** Read-only probes of their stored data are allowed. Show how each option behaves on real days, and against reference values (for example Bevel's number for the same day) when the user can supply them. Report error honestly, including held-out error when fitting, and call small samples small.
4. **Recommend one, and stop.** State your pick and why, then wait. Get explicit approval from the user before writing any implementation code. "Defaults" counts only if the user was shown the options.
5. **After approval, implement it properly.** A pure, tested selector in `src/lib/health` whose doc comment states the formula, constants and sources; every part of the score returned as components so the UI and the AI can explain it; a command description that spells out the method; missing-data and cold-start behavior defined and tested; calibration limits stated.
6. **Record it.** Add or update the entry in `docs/health-algorithms.md` (options considered, choice, sources, constants, validation, open issues). Changing a shipped algorithm repeats this whole process.

## Shared building blocks (use these, don't re-create them)

- Dates: `src/lib/dates.ts` (`addDays`, `formatDateLabel`, `effectiveTodayISO`). Numbers: `src/lib/math.ts` (`clamp`, `toNumber`, `meanSd`). Text: `src/lib/format.ts` (`formatMinutes`, `formatFixed`).
- Health data: `readHealthWindow` (`src/lib/db/health.ts`) reads time windows; `baselineStats` and `BASELINE_DAYS` (`src/lib/health/baseline.ts`) define a personal baseline; `StoredPoint` is `src/lib/health/types.ts`.
- Health UI: read through `src/hooks/useHealth.ts`; query keys live in `healthKeys` (`src/lib/queryKeys.ts`); `IndicatorBar`, `ScoreRing`, `BreakdownCard`/`BreakdownRow`, `MetricCard`, `Timeline` and `DaySwitcher` are in `src/components/health`. Tones, zones and score gradients are theme tokens in `src/index.css`; the dark look is the `.health-theme` scope.

## shadcn gotchas

- After `npx shadcn@latest add`, check the generated files: the CLI can write `import { cn } from "cn"` (an unrelated npm package it also installs). Change it to `@/lib/utils` and `npm uninstall cn`. It must run on a modern Node (v22 here; `nvm use 22`).
- Toggle and Toggle Group force `size-4` on child SVGs. Give a custom SVG inside one a `size-*` class (see `ScoreRing`).

## Known debt (fix when you touch the code, one feature at a time)

- Pages outside the Health screens have not been audited against the shadcn rule. For example `src/pages/SettingsPage.tsx` still has a raw `<table>` and `<textarea>`, and `TodayPage`/`SessionPage` use hand-styled buttons and cards.
- The sleep, recovery and strain algorithms still need the research-and-approval process (see `docs/health-algorithms.md`).
