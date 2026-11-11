# Project notes for Claude

## Infrastructure

- **Firebase project ID:** `hyroxedgeai`
- **Firebase App Hosting backend name:** `studio` (the only backend, as of 2026-08-19)
  - Repository: `gymtrackpage-hybridx-app`, region `us-central1`.
  - URL: `https://studio--hyroxedgeai.us-central1.hosted.app`
  - Used as `--backend studio` for commands like `firebase apphosting:secrets:grantaccess`.
  - Confirm with `firebase apphosting:backends:list --project hyroxedgeai` if a deploy
    ever shows more than one backend.

## Deploy gotchas

Firebase App Hosting (`apphosting.yaml`) only redeploys the Next.js app itself when
you push. The following are **not** part of that pipeline and need their own manual
step whenever they change:

- **Firestore rules / indexes** (`firestore.rules`, `firestore.indexes.json`):
  ```bash
  firebase deploy --only firestore:rules,firestore:indexes --project hyroxedgeai
  ```
  Forgetting this after adding a new collection or rule means the *live* rules are
  stale — reads/writes to anything new get denied for every user, which surfaces as
  a generic "Missing or insufficient permissions" error with no obvious cause.

- **New secrets referenced in `apphosting.yaml`**: adding a `secret:` entry there
  isn't enough — the secret must exist in Secret Manager *and* the App Hosting
  backend's service account must be granted access to it, or the build fails with
  `fah/misconfigured-secret`:
  ```bash
  # create/update the secret value
  echo -n "<value>" | firebase apphosting:secrets:set SECRET_NAME --project hyroxedgeai
  # grant the backend read access
  firebase apphosting:secrets:grantaccess SECRET_NAME --project hyroxedgeai --backend studio
  ```
  `grantaccess` also accepts a comma-separated list of secret names in one call.

## The marketing site hand-off (hybridx.club, site plan step 11)

- **`src` says which hybridx.club page sent a sign-up.** The site adds
  `?src=guide-<slug>` (an article) or `?src=page-<path>` to every link in.
  - `src/lib/attribution.ts` keeps the first one with the UTM tags.
  - Sign-up writes it to the user as `acquisitionSrc`.
  - The rule is `src/lib/acquisition-src.ts`, pinned to the site's copy by
    `src/lib/__tests__/acquisition-src.test.ts`.
- **Leads carry `src` too** (bridge contract 1.3.0), kept first touch on the
  subscriber with `srcAt`.
- **`GET /api/marketing/signups-by-src`** (bridge secret) reports sign-ups,
  trials and paying users per `src` to the site's performance page.
  - Counts only: no address or id crosses.
  - The email path depends on the daily account sync linking subscribers to
    users.
- **`/signup` reads a seed from the link** (`src/lib/signup-seed.ts`): `tool`,
  `event`, `experience`, `days`, `goal`, `edition`, `division`, `race`.
  - Each value is checked against the form's own answers and changeable.
  - Never act on a seed without the athlete seeing it.
- **ATHX in sign-up:** the ATHX 2027 plans are offered by edition and division
  (`src/lib/athx-programs.ts`) and found by exact name after the account
  exists.
  - Rename a program in `src/data/athx-2027` and `signup-seed.test.ts` fails
    until the names agree.
  - Their ids come from the admin import, so none are hard-coded.
- **`next dev` adds a block to this file.** Don't commit it.
