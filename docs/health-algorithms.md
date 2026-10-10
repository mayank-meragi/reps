# Health algorithm decision log

Every health computation is recorded here: the options considered, the choice, sources, constants, validation and open issues. The process is in `AGENTS.md` ("Health algorithms"). A shipped algorithm is only changed by repeating that process.

Status key: **shipped** (in the app), **needs review** (shipped before the research-and-approval rule existed, to be revisited with options and sources before anyone builds on it).

---

## Sleep score — shipped, needs review

- Code: `src/lib/health/sleepScore.ts`. Command: `health.get_scores` (`sleep`).
- Choice: 0–100 from duration (40, minutes asleep vs sleep need, default 8 h), efficiency (20, full at 92% or more, zero at 75% or less), restorative sleep (25, deep and REM shares against 13% and 20%), consistency (15, bedtime vs the previous 7 nights). Missing parts are dropped and the rest rescaled.
- Options considered: none documented. Chosen from a short discussion with the user; not researched against published methods.
- Data notes: Fitbit Air reports 0 minutes to fall asleep, so latency is not used. Some nights have no stage breakdown; some naps are flagged as main sleep.
- Open: research and compare against Oura, Whoop, Fitbit, Garmin and published sleep-quality work before treating this as final.

## Recovery score — shipped, needs review

- Code: `src/lib/health/recoveryScore.ts`. Command: `health.get_scores` (`recovery`).
- Choice: z-scores of today's HRV (log RMSSD), resting heart rate, sleep score and respiratory rate against the user's previous 30 days (at least 5 needed), weighted 40/25/20/10 and rescaled over the inputs present, mapped through an S-curve (z 0 gives 50), minus up to 5 points each for unusual skin temperature or low SpO2. Zones: red under 34, yellow 34–66, green 67 and up.
- Options considered: none documented. Weights are inspired by the inputs Whoop and Bevel name publicly; their formulas are unpublished.
- Validation: none against a reference. With about 5 days of baseline the z-scores are noisy.
- Open: research HRV-guided training literature, Whoop, Oura Readiness, Garmin, Polar Nightly Recharge and Elite HRV, compare options on the user's data, and decide the baseline window and minimum days.

## Strain — shipped, needs review

- Code: `src/lib/health/strainScore.ts`. Command: `health.get_scores` (`strain`).
- Choice: `load = Σ minutes × max(0, bpm − 110)`, `strain = 100 × (1 − e^(−load/1234))`, from the all-day heart-rate histogram. Target band set by the day's recovery zone (red under 35%, yellow 35–60%, green 60–85%).
- Options compared on the user's data (7 days, 3–9 Oct 2026, against Bevel's strain 34, 17, 89, 12, 13, 10, 16):
  - Fitbit zone minutes weighted 1/2/3 with a saturating curve: average miss 11 points (correlation 0.98, scale and low-intensity effort off).
  - Banister TRIMP (HR reserve, exponential weighting): average miss 21 points.
  - Heart-rate reserve power weighting: average miss 13 points.
  - Linear excess over a threshold, saturating: average miss 3 points. Chosen.
- Validation: 3 points average miss on the data it was fitted to, about 8 when each day is predicted without being used in the fit. Only 7 days, dominated by one workout day.
- Constants (110 bpm, 1234) were fitted to Bevel's numbers, not derived from a physiological model.
- Open: read the published training-load literature (Banister, Edwards, Lucia, Whoop and Garmin load models), re-fit as more reference days arrive, decide whether the threshold should personalize from resting heart rate and age, and whether the target bands are right.
