# ATHX 2027 — twelve-week plan

Six import-ready program files, one per edition and division:

| File | Program name in the app |
| --- | --- |
| `athx-2027-men-s-lite-division.csv` | ATHX 2027 — Men's Lite Division |
| `athx-2027-men-s-athx-division.csv` | ATHX 2027 — Men's ATHX Division |
| `athx-2027-men-s-pro-division.csv` | ATHX 2027 — Men's Pro Division |
| `athx-2027-women-s-lite-division.csv` | ATHX 2027 — Women's Lite Division |
| `athx-2027-women-s-athx-division.csv` | ATHX 2027 — Women's ATHX Division |
| `athx-2027-women-s-pro-division.csv` | ATHX 2027 — Women's Pro Division |

Each is 84 days (12 weeks), `programType: hybrid`, 107 sessions — 84 days of
which 23 are doubled into an AM and a PM session. Rest days are included so the
calendar stays aligned to the plan's own week.

## Importing

Admin → Programs → **Import**, one file at a time. The `id` column is
deliberately empty, so each import creates a **new** program. To update one
later, export it (which fills `id` in), edit, and re-import — importing an
edited file that still has a blank `id` creates a duplicate instead.

The importer only sets the program's audience; if these should not be public,
set visibility in the import dialog at upload time.

## How the plan maps onto the app's format

The plan is authored as a spreadsheet per edition with a Sessions sheet (three
division columns), a Schedule sheet (one row per day), plus Weeks, Teaching,
Reference and Legend sheets. The app stores one program per division and one
`details` string per row, so:

* **Divisions become programs.** Each file carries only its own division's
  loads. Where a prescription is not tiered, the three divisions share a value.
* **Double days become two sessions on the same day number**, titled
  `AM — …` and `PM — …`. `getWorkoutForDay` returns both, in order, and the
  calendar tracks them separately.
* **Prescribed elements become exercise rows.** `Effort` is appended after a
  `·`, so `4 x 6 · 3 RIR` is four sets of six at three reps in reserve. Where a
  workout has more than one block, rows are prefixed with the block —
  `Grip Block · Dead Hang`.
* **Everything else becomes a `Note ·` row** on the day it belongs to: the
  session's own coaching notes, the day's purpose, its teaching block, fuel and
  hydration, recovery, the three log prompts and a day-at-a-glance summary.
  Week-opening days also carry that week's focus, priority and volume targets;
  day 1 carries the plan overview and the division's reference tables.
  Names beginning `Note` are skipped as Garmin *steps* (see `NOTE_ROW` in
  `src/lib/garmin/workout-mapper.ts`) but still ride along in the workout's
  description, so the text reaches the watch without becoming something to lap
  past.
* **Garmin sport is set per block**, so a run-then-ski day syncs as two
  workouts — `RUNNING` then `CARDIO_TRAINING` — rather than one mislabelled
  session. Sets, reps, weight and rest are filled in where the prescription
  states them unambiguously (`4 x 6`, `12 @ 20 kg`, a load in the exercise
  name); anything timed, in metres or a percentage is left for the mapper to
  read out of the details at sync time.
* **Rest days keep their guidance but schedule no work.** They import with a
  title containing "rest", which the calendar reads as a rest day, and they map
  to no Garmin workout at all.

## Regenerating

```bash
python3 scripts/build-athx-2027-programs.py
```

Reads `source/` and rewrites the six CSVs. `source/` holds the four CSV exports
supplied with the plan plus the four other sheets of each workbook, exported to
CSV so the script needs no spreadsheet library. Edit the source, re-run, and
re-import.

`src/lib/__tests__/athx-2027-programs.test.ts` parses all six files with the
importer's own parser and checks the result, so a regenerated file that no
longer imports cleanly fails in CI rather than at upload time.

## Known quirks in the source

Carried through as-is rather than corrected — worth a look before these go out:

* **Day 80** is `Double` on the Schedule sheet but has a single block on the
  Sessions sheet. The session list wins (one session), and the day-at-a-glance
  note says both.
* **Days 83 and 84** (Rest or Travel, Competition) carry `Session type`,
  `Garmin sport`, fuel, hydration, recovery and log prompts from the weekly
  rotation rather than values written for those days — e.g. competition day's
  log prompt reads "Compare to the same session in Week 1".
* **Day 80's** `Session type` reads "Aerobic + Lower strength" while the session
  itself is a concentric-only strength primer.
