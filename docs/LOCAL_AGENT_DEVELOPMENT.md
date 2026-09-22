# Local agent development (Mac)

This setup gives Codex or another coding agent a complete, disposable copy of Metro Fit Team: frontend, authentication, database, storage, demo users, workouts, ranking, and chat. It does not use production data.

## One-time preparation

1. Open the existing folder `~/Projects/GitHub/metro-fit-team` in VS Code.
2. Click **Trust this folder** in the Restricted Mode banner.
3. Install and start Docker Desktop.
4. Open the VS Code terminal in the project folder.
5. Save your current work and update the repository:

```bash
git status
git switch main
git pull
npm install
```

If `git status` shows your own uncommitted changes, do not discard them. Commit or stash them before switching branches.

## Create the isolated local copy

```bash
npm run dev:setup
```

The command:

- starts Supabase locally in Docker;
- saves an existing `.env.local` as `.env.local.backup-<date>`;
- creates a new `.env.local` containing only local Supabase credentials;
- applies all migrations and the SQL seed;
- creates disposable demo users and sample workouts/chat data;
- prints the local demo password.

Then start the application:

```bash
npm run dev
```

Open `http://localhost:3000` and sign in as `thorsten@demo.metro-fit-team.local` with the password printed by setup. The same password works for the other demo accounts.

## Normal daily use

```bash
npm run dev:db:start
npm run dev
```

Stop the local database when finished:

```bash
npm run dev:db:stop
```

Reset all disposable local data at any time:

```bash
npm run dev:db:reset
npm run seed
```

## Safe agent prompt

```text
Work in the current Metro Fit Team repository.

Read AGENTS.md and README.md first. Use only the local application at
http://localhost:3000 and the local Supabase instance. Never use, inspect,
modify, seed, reset, or migrate production. Do not reveal or commit secrets.

First inspect the architecture and run the existing checks. Then test the
requested user flow in the browser with disposable demo accounts. Before a
substantial feature, explain the problem, proposed behavior, affected files,
database/RLS impact, and test plan. Implement the approved work in a new Git
branch. Add tests for the changed behavior and run lint, typecheck, unit tests,
build, and relevant local security integration tests. Do not deploy or merge
without my explicit approval.
```

## Optional disposable cloud DEV

A separate hosted Supabase DEV project can be added later for testing from an iPhone or another device. Do not reuse the production Supabase project. Remote demo seeding is blocked unless `ALLOW_REMOTE_DEV_SEED=true` is deliberately set outside a production environment.
