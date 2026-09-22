# METRO Fit Team

A mobile-first team fitness PWA — personal workout tracking, body measurements,
team rankings, challenges, and chat. Built with Next.js + Supabase so the
same backend can later power a React Native / Expo app.

The initial test team is **METRO Marl Fitness Team**; the app name itself is
configurable (`NEXT_PUBLIC_APP_NAME`) and not hardcoded anywhere in the code.

The v1 UI is entirely in **German**. The i18n architecture (`src/lib/i18n`)
supports adding English/Russian later — every UI string already goes through
the `t()` translation function.

## Stack

- **Frontend**: Next.js 14 (App Router), TypeScript (strict), Tailwind CSS, PWA
- **Backend**: Supabase (Postgres, Auth, Realtime, Storage, Row Level Security)
- **Hosting**: Vercel (frontend) + Supabase (backend)

## Architecture at a glance

- `supabase/migrations/*.sql` — the entire database schema, RLS policies, and
  business-logic functions/triggers (scoring, ranking, invite redemption,
  achievements). This is the source of truth; nothing important is configured
  only through the Supabase dashboard.
- `src/lib/data/*.ts` — server-only read queries, one file per domain.
- `src/app/**/actions.ts` — server actions (mutations), colocated with the
  routes that use them.
- `src/lib/server/bootstrap.ts` — the initial-admin bootstrap (see below).
- Business logic (scoring, ranking, privacy, invite validation) lives in
  Postgres functions/triggers, not in React components — so a future
  React Native / Expo app hitting the same Supabase project gets the exact
  same rules for free.

## Getting started

### 1. Create a Supabase project

Create a project at [supabase.com](https://supabase.com) (or run one locally
with the [Supabase CLI](https://supabase.com/docs/guides/cli): `supabase start`).

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in:

| Variable | Where to find it | Exposed to browser? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API | **Never** — server-only |
| `INITIAL_ADMIN_EMAIL` | The email Thorsten Roloff will register with | Server-only |
| `INITIAL_TEAM_NAME` | e.g. `METRO Marl Fitness Team` | Server-only |
| `NEXT_PUBLIC_APP_NAME` | Branding shown in the UI | Yes |
| `NEXT_PUBLIC_APP_URL` | Your deployed URL (used to build invite links) | Yes |

`SUPABASE_SERVICE_ROLE_KEY` is only ever imported by files that pull in
`src/lib/supabase/admin.ts`, which is guarded by the `server-only` package —
importing it from a Client Component is a **build error**, not just a lint
warning.

### 3. Run migrations

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push          # applies supabase/migrations/*.sql
```

(Or, for local development: `supabase start` then `supabase db reset`, which
applies migrations and `supabase/seed.sql` automatically.)

`supabase/seed.sql` only seeds the global exercise catalogue (plain SQL data).
Demo **users** must go through Supabase Auth, so they're seeded separately:

```bash
npm install
npm run seed          # creates demo team members + sample workouts/history
```

This prints generated demo credentials once — they're for local/test use only,
never committed anywhere.

### 4. Configure authentication

In Supabase → Authentication → URL Configuration, set:
- Site URL: your deployed URL (or `http://localhost:3000` for local dev)
- Redirect URLs: `<your-url>/auth/callback`

Email confirmation should stay **enabled** (default) — the admin bootstrap
below relies on `email_confirmed_at` being set before granting any role.

### 5. Initial admin bootstrap (Thorsten Roloff)

No password is ever hardcoded, and no email domain is auto-admin. The flow:

1. Thorsten registers normally at `/registrieren` with the email configured in
   `INITIAL_ADMIN_EMAIL`, and confirms it via the email link.
2. The next time he authenticates (sign-in, or the confirmation redirect
   itself), `src/lib/server/bootstrap.ts` runs server-side: it checks his
   **verified** Supabase Auth email against the server-only env var, and if
   it matches, upserts `METRO Marl Fitness Team` (creating it if needed) and
   sets his `team_members.role` to `team_admin`.
3. This is idempotent — running it any number of times never creates
   duplicate teams or memberships, and after the first run it becomes a
   fast no-op for every other user (their email simply doesn't match).
4. From then on, **the database is the sole source of truth** for his role.
   RLS policies check `team_members.role` via `auth.uid()` — nothing in the
   frontend, and no email string comparison anywhere, can grant admin rights.

You can also run this explicitly (e.g. right after deploying, or to confirm
idempotency) with:

```bash
npm run bootstrap:admin
```

### 6. Local development

```bash
npm install
npm run dev:setup
npm run dev
```

Open `http://localhost:3000`.

`npm run dev:setup` is the recommended safe setup for coding agents and local
testing. It starts an isolated Supabase stack in Docker, backs up an existing
`.env.local`, writes local-only credentials, resets the local database, and
creates disposable demo data. See [docs/LOCAL_AGENT_DEVELOPMENT.md](docs/LOCAL_AGENT_DEVELOPMENT.md).

### 7. Deploy to Vercel

- Import the repo in Vercel.
- Add the same environment variables from `.env.local` (except point
  `NEXT_PUBLIC_APP_URL` at your production URL).
- Deploy. `npm run build` must succeed with zero errors — verified locally
  before every commit in this repo.

## Security model

- **Row Level Security is enabled on every table.** The anon/browser client
  never has elevated privileges — every read/write is authorized by Postgres
  policies keyed on `auth.uid()`, not by anything the frontend decides to
  show or hide.
- **Health data (body measurements, nutrition) is private by default** and
  owner-only at the RLS level — `team_admin` has **no** read policy on those
  tables, full stop. Admin status never overrides this.
- **Team invites** are single-use-configurable, hashed tokens (SHA-256; the
  raw token is never stored). Joining a team happens exclusively through the
  `redeem_team_invite()` Postgres function, which validates expiry/revocation/
  use-count — there is no INSERT policy on `team_members` for clients, so a
  crafted request cannot self-assign to a team or role.
- **Fitness scoring** is event-sourced (`fitness_score_events`) with unique
  constraints preventing duplicate awards, and a per-user daily point cap
  enforced inside the awarding function — not in the UI.
- **Admin bootstrap** never trusts client input (see above) — the target
  email/team name are server-only env vars, and the check is against the
  Auth-verified email of the currently authenticated user.

See `supabase/tests/security.test.ts` for the automated RLS regression suite
covering the scenarios above (cross-user data access, privilege escalation,
outsider chat access, revoked invites).

## Testing

```bash
npm test                                    # fast unit tests
RUN_INTEGRATION_TESTS=1 npx vitest run supabase/tests/security.test.ts
```

The integration suite provisions and deletes real (disposable) Supabase Auth
users against whichever project your `.env.local` points at — run it against
a local `supabase start` instance or a throwaway test project, never
production.

## What's intentionally scoped down in v1

- **Health platform integrations** (Apple HealthKit, Android Health Connect):
  the data model already has a `source` column (`manual` / `apple_health` /
  `health_connect`) and a `health_connections` table, but the web app only
  ever writes `manual` — real HealthKit/Health Connect access requires native
  code and will come with the Expo app.
- **Push notifications**: `notifications` + `notification_preferences` tables
  and in-app UI exist; native push delivery arrives with the Expo app.
- Additional locales (English/Russian): dictionary files exist
  (`src/lib/i18n/en.ts`, `ru.ts`) but are intentionally partial — v1 ships
  German-only by product requirement.

## Future React Native / Expo app

Point an Expo app at the same `NEXT_PUBLIC_SUPABASE_URL` /
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and it inherits, unchanged: the schema, RLS
policies, scoring/ranking functions, invite redemption, and chat — none of
that logic lives in this Next.js app's components.
