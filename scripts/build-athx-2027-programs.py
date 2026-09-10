#!/usr/bin/env python3
"""Build importable program CSVs for the ATHX 2027 twelve-week plan.

The plan is authored as a pair of spreadsheets (one per edition, Men's and
Women's), each holding a Sessions sheet with three division columns — Lite,
ATHX and Pro — plus a Schedule sheet of per-day coaching, fuelling, hydration,
recovery and log prompts, a Weeks sheet, a Teaching sheet and a Reference
sheet. The app stores one program per division, so this script fans the two
editions out into six programs and writes each as a CSV in the app's unified
import format (see `src/lib/program-csv.ts`).

    python3 scripts/build-athx-2027-programs.py

Reads `src/data/athx-2027/source/`, writes `src/data/athx-2027/*.csv`.

Nothing in the source is dropped: every prescribed element becomes an exercise
row, and every note, purpose, teaching block, fuelling line, recovery note and
log prompt becomes a `Note ·` row on the day it belongs to. Note rows are named
so the Garmin mapper treats them as prose rather than as a step to lap past
(`NOTE_ROW` in `src/lib/garmin/workout-mapper.ts`).
"""

from __future__ import annotations

import csv
import re
import sys
from collections import OrderedDict, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src' / 'data' / 'athx-2027' / 'source'
OUT = ROOT / 'src' / 'data' / 'athx-2027'

# The unified import format — order matters, `src/lib/program-csv.ts` reads by name
# but the app's own export writes these columns in this order.
HEADERS = [
    'id', 'programName', 'programDescription', 'programType', 'targetRace',
    'workoutDay', 'workoutTitle', 'sessionType', 'garminSport',
    'exerciseName', 'exerciseDetails',
    'garminExerciseCategory', 'garminExerciseName',
    'weightKg', 'restSeconds', 'sets', 'reps',
    'runType', 'runDistance', 'runPaceZone', 'runDescription', 'runEffortLevel',
    'noIntervals',
]

EDITIONS = [
    ('mens', "Men's"),
    ('womens', "Women's"),
]
DIVISIONS = ['Lite', 'ATHX', 'Pro']

# ── Text helpers ──────────────────────────────────────────────────────────────

# The source is upper-cased throughout; these survive title-casing intact.
CASED = {
    'AM': 'AM', 'PM': 'PM', 'ATHX': 'ATHX', 'DB': 'DB', 'METCON': 'MetCon',
    'SKIERG': 'SkiErg', 'KM': 'km', 'M': 'm', 'S': 's', 'H': 'h', 'X': 'X',
    'RIR': 'RIR', 'RM': 'RM', 'MIN': 'min', 'CAL': 'cal', 'HR': 'HR',
    'Z': 'Z', 'A1': 'A1', 'A2': 'A2', 'B1': 'B1', 'B2': 'B2',
}


SMALL_WORDS = {'or', 'and', 'to', 'of', 'the', 'a', 'an', 'in', 'at', 'on', 'for', 'per', 'with'}


def title_case(text: str) -> str:
    """Title-case an upper-cased source label, keeping known acronyms intact."""
    out = []
    for position, word in enumerate(text.split()):
        bare = word.strip('()[],.')
        if bare.upper() in CASED:
            out.append(word.replace(bare, CASED[bare.upper()]))
        elif re.match(r'^\d', bare):          # 3, 24, 2RM, 40-50
            out.append(word.lower())
        elif position and bare.lower() in SMALL_WORDS:
            out.append(word.lower())
        elif '-' in bare and len(bare) > 1:   # RUN-TO-SKI → Run-to-Ski
            out.append('-'.join(
                part.lower() if index and part.lower() in SMALL_WORDS
                else part[:1].upper() + part[1:].lower()
                for index, part in enumerate(word.split('-'))
            ))
        else:
            out.append(word[:1].upper() + word[1:].lower())
    return ' '.join(out)


def sentence_case(text: str) -> str:
    """Sentence-case a block qualifier: 'REST 3 MIN BETWEEN ROUNDS' → 'Rest 3 min between rounds'."""
    lowered = text.lower()
    lowered = re.sub(r'\bam\b', 'AM', lowered)
    lowered = re.sub(r'\bpm\b', 'PM', lowered)
    lowered = re.sub(r'\bmetcon\b', 'MetCon', lowered)
    return lowered[:1].upper() + lowered[1:]


def split_block(block: str) -> tuple[str, str]:
    """'GRIP BLOCK  |  12 MIN' → ('Grip Block', '12 min'). Also strips an AM/PM prefix."""
    parts = [p.strip() for p in block.split('|') if p.strip()]
    if not parts:
        return '', ''
    head = re.sub(r'^(AM|PM)\s*-\s*', '', parts[0]).strip()
    qualifier = ' · '.join(sentence_case(p) for p in parts[1:])
    return title_case(head), qualifier


def clean(text: str) -> str:
    """Collapse the source's double-spaced separators."""
    return re.sub(r'\s{2,}', ' ', (text or '').strip())


def join_lines(pairs: list[tuple[str, str]]) -> str:
    """Label/value pairs as one pre-wrapped block of text; the app renders \n."""
    return '\n'.join(f'{label}: {value}' if label else value for label, value in pairs if value)


def split_multi(value: str) -> list[str]:
    """The source packs several statements into one cell with a ' | ' separator."""
    return [clean(p) for p in re.split(r'\s*\|\s*', value or '') if clean(p)]


# ── Garmin routing ────────────────────────────────────────────────────────────

def classify(block: str, session: str) -> tuple[str, str]:
    """(sessionType, garminSport) for a block. Grouped on by `workoutToDays`, so a
    run block and a ski block on the same day become two Garmin workouts."""
    b = block.upper()
    s = session.upper()
    if 'NO SESSION' in b or 'THE BRIEF' in b or s.startswith('COMPLETE REST') or 'REST OR TRAVEL' in s:
        return 'cardio', 'GENERIC'
    if 'SKI' in b:
        return 'cardio', 'CARDIO_TRAINING'
    if 'GRIP' in b:
        return 'strength', 'STRENGTH_TRAINING'
    if re.search(r'\bRUN\b|THRESHOLD|AEROBIC|SHAKEOUT|KM SPECIFIC', b):
        return 'cardio', 'RUNNING'
    if re.search(r'UPPER|LOWER|STRENGTH|PRIMER', b):
        return 'strength', 'STRENGTH_TRAINING'
    if b:                                     # circuit, MetCon, finisher, simulation, zones
        return 'cardio', 'CARDIO_TRAINING'
    # No block name: the day's session title is the only signal.
    if 'SKI' in s:
        return 'cardio', 'CARDIO_TRAINING'
    if 'REST' in s:
        return 'cardio', 'GENERIC'
    return 'cardio', 'RUNNING'


# ── Structured fields for Garmin sync ─────────────────────────────────────────

def structured(name: str, value: str) -> dict:
    """sets/reps/weight/rest parsed out of a prescription, conservatively.

    Only unambiguous shapes are read: '4 x 6' is four sets of six, '12 @ 20 kg'
    is twelve reps at twenty kilos, and a load written into the element name —
    'Sandbag Bear-Hug Hold (50 kg)' — is that exercise's weight. Anything timed,
    measured in metres or expressed as a percentage is left for the mapper to
    read out of the details text at sync time.
    """
    fields: dict[str, str] = {}

    m = re.fullmatch(r'(\d+)\s*x\s*(\d+)', value.strip())
    if m:
        fields['sets'], fields['reps'] = m.group(1), m.group(2)

    m = re.fullmatch(r'(\d+)\s*x\s*(\d+)\s*@\s*\d+%', value.strip())
    if m:
        fields['sets'], fields['reps'] = m.group(1), m.group(2)

    m = re.fullmatch(r'(\d+)\s*(?:dual\s*)?@\s*([\d.]+)\s*kg', value.strip())
    if m:
        fields['reps'], fields['weightKg'] = m.group(1), m.group(2)

    m = re.fullmatch(r'[\d\sx]+m\s*@\s*([\d.]+)\s*kg', value.strip())   # '30 m @ 50 kg'
    if m:
        fields['weightKg'] = m.group(1)

    m = re.search(r'\(([\d.]+)\s*kg\)', name)
    if m and 'weightKg' not in fields:
        fields['weightKg'] = m.group(1)

    m = re.search(r'rest\s+(\d+)\s*s\b', value, re.I)
    if m:
        fields['restSeconds'] = m.group(1)

    return fields


# ── Source loading ────────────────────────────────────────────────────────────

def read_csv(path: Path) -> list[dict]:
    with path.open(newline='', encoding='utf-8') as fh:
        return list(csv.DictReader(fh))


def read_rows(path: Path) -> list[list[str]]:
    with path.open(newline='', encoding='utf-8') as fh:
        return [row for row in csv.reader(fh) if any(c.strip() for c in row)]


class Edition:
    def __init__(self, slug: str):
        self.slug = slug
        self.sessions = read_csv(SOURCE / f'{slug}-sessions.csv')
        self.schedule = {int(r['Day']): r for r in read_csv(SOURCE / f'{slug}-schedule.csv')}
        self.weeks = {r[0]: r for r in read_rows(SOURCE / f'{slug}-weeks.csv')[1:] if r[0].isdigit()}
        self.week_headers = read_rows(SOURCE / f'{slug}-weeks.csv')[0]
        self.teaching = {int(r[0]): r for r in read_rows(SOURCE / f'{slug}-teaching.csv')[1:] if r[0].isdigit()}
        self.reference = read_rows(SOURCE / f'{slug}-reference.csv')
        self.legend = read_rows(SOURCE / f'{slug}-legend.csv')

        self.by_day: dict[int, list[dict]] = defaultdict(list)
        for row in self.sessions:
            self.by_day[int(row['Day'])].append(row)

    def legend_value(self, label: str) -> str:
        for row in self.legend:
            if row and row[0].strip().lower() == label.lower():
                return clean(row[1]) if len(row) > 1 else ''
        return ''


# ── Reference material, carried on day 1 ──────────────────────────────────────

UNTIERED_SECTIONS = {'Strength Zone', 'Key figures'}


def reference_notes(ed: Edition, division: str) -> list[tuple[str, str]]:
    """The Reference sheet, narrowed to one division's column.

    The sheet is a stack of small tables. A table headed with the three
    division names (MetCon X, Endurance Zone) is read down this program's own
    column; the rest — the strength windows, the benchmark tiers and the key
    figures — are carried whole.
    """
    notes: list[tuple[str, str]] = []
    section: str | None = None
    column: int | None = None
    lines: list[str] = []

    def flush():
        if section and lines:
            notes.append((f'Note · {section}', '\n'.join(lines)))

    for row in ed.reference:
        cells = [clean(c) for c in row] + [''] * 4
        head = cells[0]
        if not head:
            continue

        tiered = cells[1:4] == DIVISIONS
        if tiered or head in UNTIERED_SECTIONS or head.startswith('Benchmarks'):
            flush()
            section = f'{head} — {division} division' if tiered else head
            column = DIVISIONS.index(division) + 1 if tiered else None
            lines = [] if tiered else [' · '.join(c for c in cells[1:4] if c)]
            lines = [l for l in lines if l]
            continue

        if section is None:
            continue
        if column is not None:
            lines.append(f'{head}: {cells[column]}')
        else:
            values = ' · '.join(c for c in cells[1:4] if c)
            lines.append(f'{head}: {values}' if values else head)
    flush()
    return notes


def overview_note(ed: Edition, edition_label: str, division: str) -> tuple[str, str]:
    lines = [
        f'{ed.legend[0][0].strip()} — {division} division.',
        f"Assumed start: {ed.legend_value('Assumed start')}.",
        f"Assumed competition: {ed.legend_value('Assumed competition')}.",
        ed.legend_value('Note'),
        '',
        'Twelve weeks in four phases: Base (weeks 1-4), Development (5-8), Specific (9-11), '
        'Taper and Competition (12). Seventy-two training days, twelve rest days, '
        'twenty-four of the training days doubled AM and PM with at least six hours between them.',
        '',
        'Loads shown are the ' + division + ' division. Where a prescription is not tiered, '
        'all three divisions share the same value.',
        'Standards are built from the 2027 workout specifications and the 2026 movement standards. '
        'Check athxgames.com before competing.',
    ]
    return 'Note · Plan overview', '\n'.join(l for l in lines if l is not None)


def week_note(ed: Edition, week: int) -> tuple[str, str] | None:
    row = ed.weeks.get(str(week))
    if not row:
        return None
    cells = [clean(c) for c in row] + [''] * 12
    (_, phase, phase_week, commencing, run_vol, ski_vol, lifts, hours,
     changes, priority, missed, ahead) = cells[:12]
    name = f'Note · Week {week} of 12 — {phase}'
    details = join_lines([
        ('', f'{phase_week}, week commencing {commencing}.'),
        ('What changes', changes),
        ('One priority', priority),
        ('If you miss a session', missed),
        ('Looking ahead', ahead),
        ('Volume', f'run {run_vol} · ski {ski_vol} · {lifts} lift sessions · {hours} total'),
    ])
    return name, details


def teaching_note(ed: Edition, day: int) -> tuple[str, str] | None:
    row = ed.teaching.get(day)
    if not row:
        return None
    _, _, _, _, label, figure, unit, text = (list(row) + [''] * 8)[:8]
    label, figure, unit, text = clean(label), clean(figure), clean(unit), clean(text)
    if not text:
        return None
    # 'Coach's note - The push press' would read as 'Note · Coach's note - …'.
    label = re.sub(r"^Coach's note\s*-\s*", '', label)
    heading = f'Note · {label}' if label else 'Note · Coaching'
    if figure:
        heading += f' — {figure} {unit}'.rstrip()
    return heading, text


# ── Day → rows ────────────────────────────────────────────────────────────────

MERGE_INTO_PREVIOUS = {'at', 'Mode'}

# The strength sequence is written against a clock: '12-13 Deadlift window 1' is
# minutes twelve to thirteen of a fifteen-minute block.
MINUTE_WINDOW = re.compile(r'^(\d+)-(\d+)\s+(.*)$')


def name_and_details(element: str, value: str, effort: str) -> tuple[str, str]:
    """Read a clock-anchored element name, and give a windowed row that carries no
    prescription ('-') the length of its window as its detail."""
    m = MINUTE_WINDOW.match(element)
    if not m:
        return element, value
    start, end, label = int(m.group(1)), int(m.group(2)), m.group(3)
    name = f'{label} (min {start}-{end})'
    if value in ('', '-'):
        return name, f'{end - start} min window'
    return name, value


def build_day(ed: Edition, day: int, division: str, consumed: set[int]) -> list[dict]:
    """Every session on one day of the plan, as (title, rows) groups flattened
    into import rows. A double day yields two workouts on the same day number —
    `getWorkoutForDay` returns them both, in this order."""
    day_rows = ed.by_day[day]
    sched = ed.schedule[day]
    session_name = clean(sched['Session'])
    periods = list(OrderedDict.fromkeys(r['Period'] for r in day_rows))
    is_double = set(periods) == {'AM', 'PM'}
    groups = [(p, [r for r in day_rows if r['Period'] == p]) for p in periods] if is_double \
        else [(None, day_rows)]

    out: list[dict] = []
    for index, (period, rows) in enumerate(groups):
        first = index == 0
        last = index == len(groups) - 1
        blocks = list(OrderedDict.fromkeys(r['Block'] for r in rows))
        multi_block = len(blocks) > 1

        if period:
            head, _ = split_block(blocks[0])
            title = f'{period} — {head}' if head else f'{session_name} ({period})'
        else:
            title = title_case(session_name)

        # Day-level guidance rides with the session's opening block so it lands in
        # that block's Garmin workout rather than opening one of its own.
        lead_type, lead_sport = classify(blocks[0], session_name)
        session_type, garmin_sport = lead_type, lead_sport
        entries: list[dict] = []

        def add(name: str, details: str, **extra) -> dict:
            entry = {'name': name, 'details': details,
                     'sessionType': session_type, 'garminSport': garmin_sport, **extra}
            entries.append(entry)
            return entry

        for block in blocks:
            session_type, garmin_sport = classify(block, session_name)
            brows = [r for r in rows if r['Block'] == block]
            btitle, bqual = split_block(block)
            prescribed = [r for r in brows if r['Order'].strip()]
            notes = [clean(r['Note']) for r in brows if r['Element'] == 'Note' and clean(r['Note'])]

            rounds = ''
            for row in prescribed:
                if row['Element'] == 'Rounds':
                    rounds = clean(row[division])
                    consumed.add(id(row))

            # An AM easy aerobic block prescribes nothing but its own heading —
            # 'AM - EASY AEROBIC | 45-55 MIN' is the session. Keep that as work
            # rather than as a note, or the session reaches the watch empty.
            duration_only = not prescribed and btitle and re.search(r'\d.*\bmin\b', bqual, re.I)
            if duration_only:
                add(btitle, bqual)

            header_bits = []
            if rounds:
                header_bits.append(f'{rounds} rounds')
            if bqual and not duration_only:
                header_bits.append(bqual)
            if header_bits and btitle:
                add(f'Note · {btitle}', '. '.join(header_bits) + '.')
            elif header_bits:
                add('Note · This session', '. '.join(header_bits) + '.')

            emitted_in_block: list[dict] = []
            for row in prescribed:
                element = clean(row['Element'])
                value = clean(row[division])
                effort = clean(row['Effort'])
                if element == 'Rounds':
                    continue
                consumed.add(id(row))

                if element in MERGE_INTO_PREVIOUS and emitted_in_block:
                    joiner = ' at ' if element == 'at' else ' — '
                    emitted_in_block[-1]['details'] += f'{joiner}{value}'
                    continue
                # 'Recovery' inside an interval block is the rest between reps;
                # in the full simulation it is a genuine gap between zones.
                if element == 'Recovery' and emitted_in_block and \
                        emitted_in_block[-1]['name'].endswith('Main'):
                    emitted_in_block[-1]['details'] += f', {value} recovery between reps'
                    continue
                if element == 'Score':
                    add('Note · Score', value)
                    continue

                # 'Duration', and a lone 'Main', are the block itself rather than a
                # movement — name them after the block so the row reads as the work.
                only_element = len([r for r in prescribed
                                    if clean(r['Element']) not in MERGE_INTO_PREVIOUS
                                    and clean(r['Element']) != 'Rounds']) == 1
                if element == 'Duration' or (element == 'Main' and only_element):
                    name = btitle or title_case(session_name)
                    details = value
                else:
                    name, details = name_and_details(element, value, effort)
                    if multi_block and btitle:
                        name = f'{btitle} · {name}'
                if effort and effort != '-':
                    details = f'{details} · {effort}'

                emitted_in_block.append(
                    add(name, details, **structured(element, value))
                )

            if notes:
                add(f'Note · {btitle}' if multi_block and btitle else 'Note',
                    '\n\n'.join(notes))
            for row in brows:
                if row['Element'] == 'Note':
                    consumed.add(id(row))

        # ── Day-level guidance from the Schedule, Weeks and Teaching sheets ──
        session_type, garmin_sport = lead_type, lead_sport
        if first:
            if day % 7 == 1:
                note = week_note(ed, (day - 1) // 7 + 1)
                if note:
                    add(*note)
            purpose = clean(sched['Purpose'])
            if purpose:
                add('Note · Why this session', purpose)
            note = teaching_note(ed, day)
            if note:
                add(*note)
        if last:
            fuel = join_lines(
                [('', line) for line in split_multi(sched['Fuel'])] +
                [('Daily macros', clean(sched['Daily macros']))] +
                [('Hydration', ' · '.join(split_multi(sched['Hydration'])))] +
                [('', clean(sched['Electrolytes']))]
            )
            if fuel:
                add('Note · Fuel and hydration', fuel)
            recovery = join_lines([
                ('', ' · '.join(split_multi(sched['Recovery category']))),
                ('', clean(sched['Recovery guidance'])),
            ])
            if recovery:
                add('Note · Recovery', recovery)
            logs = [clean(sched[f'Log {n}']) for n in (1, 2, 3)]
            logs = [l for l in logs if l]
            if logs:
                add('Note · Log today', '\n'.join(f'- {l}' for l in logs))
            shape = clean(sched['Shape'])
            load = clean(sched['Load'])
            session_type_label = clean(sched['Session type'])
            add('Note · Day at a glance', join_lines([
                ('Session', title_case(session_name)),
                ('Type', session_type_label),
                ('Shape', 'Double — the AM and PM sessions need six hours between them' if is_double
                          # Day 80 is the one day the schedule calls a double while the
                          # session sheet lists a single block. Say so rather than pick.
                          else f'{shape} in the plan schedule, one session in the session list'
                          if shape == 'Double' else shape),
                ('Relative load', load if load != '-' else 'not rated'),
            ]))

        for entry in entries:
            out.append({
                'workoutDay': str(day),
                'workoutTitle': title,
                'sessionType': entry['sessionType'],
                'garminSport': entry['garminSport'],
                'exerciseName': entry['name'],
                'exerciseDetails': entry['details'],
                'weightKg': entry.get('weightKg', ''),
                'restSeconds': entry.get('restSeconds', ''),
                'sets': entry.get('sets', ''),
                'reps': entry.get('reps', ''),
            })

    return out


# ── Program assembly ──────────────────────────────────────────────────────────

def description(edition_label: str, division: str) -> str:
    return (
        f"Twelve-week preparation plan for ATHX 2027 — {edition_label} edition, {division} division loads. "
        "Starts Monday 2 November 2026 and runs to competition weekend, ATHX London on 23-24 January 2027. "
        "Four phases: Base (weeks 1-4), Development (5-8), Specific (9-11), then Taper and Competition (12). "
        "Six training days a week across 72 training days and 12 rest days, 24 of them doubled AM and PM. "
        "Trains all three competition zones — Strength, Endurance and MetCon X — and carries the plan's own "
        "fuelling, hydration, recovery, teaching and daily log prompts on each day."
    )


def build_program(ed: Edition, edition_label: str, division: str) -> list[dict]:
    name = f"ATHX 2027 — {edition_label} {division} Division"
    consumed: set[int] = set()
    rows: list[dict] = []

    for day in range(1, max(ed.by_day) + 1):
        rows.extend(build_day(ed, day, division, consumed))

    # Day 1 carries the plan overview and the reference tables for this division,
    # at the end of the day's opening session.
    extras = [overview_note(ed, edition_label, division)] + reference_notes(ed, division)
    first_title = rows[0]['workoutTitle']
    opening = [r for r in rows if r['workoutDay'] == '1' and r['workoutTitle'] == first_title]
    insert_at = rows.index(opening[-1]) + 1
    template = opening[-1]
    for offset, (note_name, note_details) in enumerate(extras):
        rows.insert(insert_at + offset, {
            'workoutDay': '1',
            'workoutTitle': template['workoutTitle'],
            'sessionType': template['sessionType'],
            'garminSport': template['garminSport'],
            'exerciseName': note_name,
            'exerciseDetails': note_details,
            'weightKg': '', 'restSeconds': '', 'sets': '', 'reps': '',
        })

    missed = [r for r in ed.sessions if id(r) not in consumed]
    if missed:
        raise SystemExit(f'{name}: {len(missed)} source rows were not carried over, '
                         f'first is day {missed[0]["Day"]} {missed[0]["Element"]!r}')

    full = []
    for row in rows:
        record = {h: '' for h in HEADERS}
        record.update({
            'programName': name,
            'programDescription': description(edition_label, division),
            'programType': 'hybrid',
        })
        record.update(row)
        full.append(record)
    return full


def slugify(name: str) -> str:
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    return slug


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    written = []
    for slug, edition_label in EDITIONS:
        ed = Edition(slug)
        for division in DIVISIONS:
            rows = build_program(ed, edition_label, division)
            name = rows[0]['programName']
            path = OUT / f'{slugify(name)}.csv'
            with path.open('w', newline='', encoding='utf-8') as fh:
                writer = csv.DictWriter(fh, fieldnames=HEADERS, quoting=csv.QUOTE_ALL)
                writer.writeheader()
                writer.writerows(rows)
            days = len({r['workoutDay'] for r in rows})
            titles = len({(r['workoutDay'], r['workoutTitle']) for r in rows})
            written.append((path.name, len(rows), days, titles))

    width = max(len(n) for n, *_ in written)
    for name, rows, days, sessions in written:
        print(f'{name:<{width}}  {rows:>5} rows  {days:>3} days  {sessions:>3} sessions')
    return 0


if __name__ == '__main__':
    sys.exit(main())
