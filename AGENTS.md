# Metro Fit Team — agent workspace rules

## Safety boundary

- Work only against the local Supabase instance at `127.0.0.1:54321`, or an explicitly disposable remote DEV project.
- Never copy, print, commit, or reuse `.env.local`, service-role keys, SMTP credentials, or production user data.
- Never run `supabase db reset`, `supabase db push`, `npm run seed`, or destructive SQL against production yourself, interactively. (The one sanctioned exception is the human-triggered `Deploy DB migrations to production` GitHub Actions workflow — see "Production migration sync" below — which only ever runs when a person explicitly clicks it, never automatically and never invoked by an agent.)
- Do not link this working directory to the production Supabase project.
- Create a feature branch for every change. Do not push directly to `main`.
- Do not deploy or change Vercel/Supabase production settings without explicit user approval.
- Merging: once CI is green, a PR that does not add or modify anything under `supabase/migrations/` may use GitHub's auto-merge — no need to wait for a manual click. A PR that touches `supabase/migrations/` must still be merged by a person, never auto-merged: merging ships the code via Vercel's auto-deploy on `main`, and the migration itself still needs the separate, human-clicked `Deploy DB migrations to production` run (see "Production migration sync" below) — a person needs to be present at the merge moment to actually go trigger that second step. This split exists because of the exact "button whose backing table didn't exist in prod" incidents this file already describes: removing the human from an ordinary merge is safe, removing them from a migration-touching one quietly recreates the original bug.

## First local run

1. Confirm Docker Desktop is running.
2. Run `npm install`.
3. Run `npm run dev:setup` once. It starts local Supabase, rebuilds the local database from migrations, creates demo users, and writes a local-only `.env.local`.
4. Run `npm run dev` and test at `http://localhost:3000`.

The setup command preserves any existing `.env.local` as a timestamped ignored backup before replacing it. Never commit either file.

## Architecture

- `supabase/migrations/`: schema, RLS, functions, triggers, scoring, ranking, and invite rules. Treat migrations as the database source of truth.
- `src/lib/data/`: server-side reads by domain.
- `src/app/**/actions.ts`: server mutations.
- `src/components/`: interactive UI.
- `supabase/tests/security.test.ts`: RLS and privilege-regression tests.

Keep authorization and business invariants in Postgres/RLS where appropriate; hiding a control in React is not authorization.

## Required checks

Before presenting a change, run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

For database/RLS changes, also run the integration suite only against local Supabase:

```bash
RUN_INTEGRATION_TESTS=1 npx vitest run supabase/tests/security.test.ts
```

Explain the problem, proposed behavior, files affected, migration/RLS impact, and test plan before implementing a substantial new feature.

## Production migration sync

Merging a PR only ships the *code* (Vercel auto-deploys `main`); it never applies a new `supabase/migrations/*.sql` file to the production database by itself. That mismatch has shipped a broken feature twice (a button whose backing table/RPC didn't exist yet in production) before this was set up. This is also exactly why a migration-touching PR is excluded from auto-merge in the Safety boundary above — a human needs to be at the merge moment to remember the second, separate deploy step. Two GitHub Actions workflows now guard this:

- **`Check production migration drift`** (`.github/workflows/check-db-migrations.yml`, logic in `.github/scripts/check-migration-drift.sh`, tests in `scripts/check-migration-drift.test.ts`) — runs automatically on any PR or push to `main` that touches `supabase/migrations/`, and again whenever the deploy workflow finishes. Read-only: it compares the migration files in the checkout against what production has actually applied (`supabase migration list --linked`). It never writes anything. What turns it red:
  - **On `main`** (a push, a finished deploy, or a manual run): any migration production lacks — "merged, not deployed yet". Because it re-runs when the deploy workflow finishes, the red turns green by itself once the migration is applied.
  - **On a pull request**: only migrations that `main` already has but production lacks (an earlier merge was never deployed). The migration a PR itself adds cannot be in production before the merge, so for that one it passes and says so (a notice and a job summary), instead of showing a red error on every migration PR.
- **`Deploy DB migrations to production`** (`.github/workflows/deploy-db-migrations.yml`) — `workflow_dispatch` only, i.e. a person must click "Run workflow" on `main` in the Actions tab. Runs `supabase db push --linked`, which applies only the migrations production doesn't have yet. This is the one place a migration is allowed to reach production, and it's always a deliberate, human-clicked action — never automatic, never run by an agent.

One-time setup (a repo admin does this once, not per-PR): generate a Supabase personal access token at `supabase.com/dashboard/account/tokens` and add it as the `SUPABASE_ACCESS_TOKEN` repository secret (Settings → Secrets and variables → Actions). Both workflows need it to authenticate as `supabase link --project-ref hlkihcerghatdckkqtza`.

After merging a PR with new migrations: watch for the drift check going red on `main`, then run the deploy workflow (it must run AFTER the merge — a run before the merge applies nothing); the check goes green again by itself afterwards. Consider making "Check production migration drift" a required status check on `main` so this can't be missed: since a PR's own migration no longer turns it red, requiring it only blocks a PR while `main` still holds a migration that was never deployed.
