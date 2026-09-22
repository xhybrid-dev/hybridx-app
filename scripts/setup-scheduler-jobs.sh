#!/usr/bin/env bash
#
# Create or repair the Cloud Scheduler jobs that drive the marketing engine.
#
# This exists because the documented one-liner it replaces read the secret from
# a shell variable. Run in a shell where that variable happened to be unset and
# gcloud accepts it without complaint, storing the header as a literal
# "Bearer " — which is exactly how marketing-send came to fail authentication
# on every run for three days while looking perfectly configured.
#
# So: the secret is read from Secret Manager, never from the environment, and
# the script refuses to touch anything if it comes back empty.
#
# Idempotent. Creates a job that is missing, updates one that exists, and can
# be re-run safely after a secret rotation.
#
#   ./scripts/setup-scheduler-jobs.sh              # create/repair all jobs
#   ./scripts/setup-scheduler-jobs.sh --dry-run    # show what it would do
#   ./scripts/setup-scheduler-jobs.sh marketing-send   # just one job

set -euo pipefail

PROJECT="${PROJECT:-hyroxedgeai}"
LOCATION="${LOCATION:-us-central1}"
BASE_URL="${BASE_URL:-https://app.hybridx.club}"

# attemptDeadline must stay ABOVE the route's own TIME_BUDGET_MS (150s in
# src/app/api/cron/marketing-send/route.ts). If a run outlives the deadline,
# Scheduler records a failure and retries while the first run is still going.
DEADLINE="300s"

DRY_RUN=false
ONLY_JOB=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    -*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) ONLY_JOB="$arg" ;;
  esac
done

# name|schedule|path
#
# Schedules are UTC.
JOBS=(
  "marketing-send|* * * * *|/api/cron/marketing-send"
  "marketing-journeys|*/5 * * * *|/api/cron/marketing-journeys"
  "marketing-journeys-daily|0 3 * * *|/api/cron/marketing-journeys?derived=1"
  "marketing-sync|30 3 * * *|/api/cron/marketing-sync"
  "marketing-brief|0 8 * * 1|/api/cron/marketing-brief"
  # Adaptive coaching. Judges "did they train yesterday" in each athlete's own
  # timezone, and pushes its own notice when it changes a session.
  "daily-coach|0 6 * * *|/api/cron/daily-coach"
  # Workout reminders. Every 15 minutes: each athlete is reminded at the time
  # they chose, in their own timezone, at most once a day.
  "push-notifications|*/15 * * * *|/api/cron/push-notifications"
  # Safety net only — a program change triggers an immediate re-sync, and the
  # job itself skips anyone synced within the last 8 days.
  "garmin-sync|0 3 */10 * *|/api/cron/garmin-sync"
)

echo "Reading CRON_SECRET from Secret Manager (project: ${PROJECT})..."

# Read preserving any trailing newline. Plain "$(...)" strips them, which would
# make the check below unable to ever fire — the sentinel keeps the raw bytes.
# This matters because App Hosting injects the secret verbatim: a stored newline
# means the app's expected header is one byte longer than anything gcloud can
# be told to send, and every request 401s for a reason nothing reports.
SECRET_RAW="$(gcloud secrets versions access latest --secret=CRON_SECRET --project="${PROJECT}"; printf 'x')"
SECRET_RAW="${SECRET_RAW%x}"

# The whole point of this script. An empty or whitespace-only secret produces a
# job that authenticates against nothing, and the failure is invisible until
# every run has been 401ing for days.
if [[ -z "${SECRET_RAW//[[:space:]]/}" ]]; then
  echo "REFUSING: CRON_SECRET is empty. Nothing has been changed." >&2
  echo "Set it first:  printf '%s' \"\$NEW\" | firebase apphosting:secrets:set CRON_SECRET --project ${PROJECT}" >&2
  exit 1
fi

# A trailing newline in the stored secret makes every request mismatch by one
# character. Caught here rather than in production logs.
if [[ "${SECRET_RAW}" != "${SECRET_RAW%$'\n'}" ]]; then
  echo "REFUSING: the stored CRON_SECRET ends in a newline." >&2
  echo "Re-set it with printf, not echo:  printf '%s' \"\$VALUE\" | firebase apphosting:secrets:set CRON_SECRET --project ${PROJECT}" >&2
  exit 1
fi

SECRET="${SECRET_RAW}"
echo "Secret looks sane (${#SECRET} chars). Applying jobs..."
APPLY_FAILED=()
echo

for entry in "${JOBS[@]}"; do
  IFS='|' read -r NAME SCHEDULE PATH_ <<< "${entry}"
  [[ -n "${ONLY_JOB}" && "${NAME}" != "${ONLY_JOB}" ]] && continue

  URI="${BASE_URL}${PATH_}"

  if gcloud scheduler jobs describe "${NAME}" --location="${LOCATION}" --project="${PROJECT}" >/dev/null 2>&1; then
    ACTION="update"
  else
    ACTION="create"
  fi

  echo "  ${ACTION}  ${NAME}  (${SCHEDULE})  -> ${URI}"
  if [[ "${DRY_RUN}" == true ]]; then
    continue
  fi

  # create and update spell this differently: create takes --headers, update
  # takes --update-headers (it merges rather than replaces). Passing the wrong
  # one fails the whole command with "unrecognized arguments".
  if [[ "${ACTION}" == "create" ]]; then
    HEADER_FLAG="--headers"
  else
    HEADER_FLAG="--update-headers"
  fi

  # Run without `set -e` aborting the loop: one job failing should not leave
  # the other seven untouched and the operator guessing which applied. Failures
  # are collected and reported at the end, and the exit code reflects them.
  #
  # stderr is captured rather than passed through because gcloud echoes the
  # arguments it did not understand — which includes the Authorization header,
  # and therefore the secret, straight into the terminal and its scrollback.
  if ! OUTPUT="$(gcloud scheduler jobs "${ACTION}" http "${NAME}" \
      --location="${LOCATION}" \
      --project="${PROJECT}" \
      --schedule="${SCHEDULE}" \
      --uri="${URI}" \
      --http-method=GET \
      --attempt-deadline="${DEADLINE}" \
      "${HEADER_FLAG}=Authorization=Bearer ${SECRET}" 2>&1)"; then
    echo "    FAILED: ${OUTPUT//${SECRET}/<redacted>}" >&2
    APPLY_FAILED+=("${NAME}")
  fi
done

echo
if [[ "${DRY_RUN}" == true ]]; then
  echo "Dry run — nothing was changed."
  exit 0
fi

# Verify rather than assume. A job whose header is present but empty is the
# failure this script exists to prevent, so prove it did not just recreate it.
if (( ${#APPLY_FAILED[@]} )); then
  echo "Failed to apply: ${APPLY_FAILED[*]}" >&2
  echo
fi

echo "Verifying stored headers..."
FAILED=0
(( ${#APPLY_FAILED[@]} )) && FAILED=1
for entry in "${JOBS[@]}"; do
  IFS='|' read -r NAME _ _ <<< "${entry}"
  [[ -n "${ONLY_JOB}" && "${NAME}" != "${ONLY_JOB}" ]] && continue

  STORED="$(gcloud scheduler jobs describe "${NAME}" --location="${LOCATION}" --project="${PROJECT}" \
    --format='value(httpTarget.headers.Authorization)' 2>/dev/null || true)"

  if [[ "${STORED}" == "Bearer ${SECRET}" ]]; then
    echo "  ok    ${NAME}"
  else
    echo "  BAD   ${NAME} — stored header does not match the secret" >&2
    FAILED=1
  fi
done

exit "${FAILED}"
