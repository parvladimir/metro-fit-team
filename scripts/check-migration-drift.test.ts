import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The script behind the "Check production migration drift" workflow decides what turns red. It runs in CI against
// the real production history; here the two programs it calls (`supabase`, `gh`) are replaced by stubs.
const SCRIPT = path.resolve(__dirname, '../.github/scripts/check-migration-drift.sh');
const hasJq = spawnSync('jq', ['--version']).status === 0;

let stubDir: string;
beforeAll(() => {
  stubDir = mkdtempSync(path.join(tmpdir(), 'drift-stubs-'));
  const stub = (name: string, body: string) => {
    const file = path.join(stubDir, name);
    writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(file, 0o755);
  };
  // the real CLI prints a couple of progress lines before the JSON line
  stub('supabase', 'echo "Initialising login role..."\necho "Connecting to remote database..."\necho "$STUB_JSON"');
  stub('gh', 'if [ -n "${STUB_GH_FAIL:-}" ]; then echo "gh: boom" >&2; exit 1; fi\nprintf "%s" "$STUB_FILES"');
});
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

/** [local, remote] pairs → the JSON line `supabase migration list` prints; remote '' = not applied in production. */
function list(...pairs: Array<[string, string]>): string {
  return JSON.stringify({ migrations: pairs.map(([local, remote]) => ({ local, remote, time: local })), message: 'Migrations listed' });
}

function run(event: string, json: string, prFiles: string[] = [], extraEnv: Record<string, string> = {}) {
  const summary = path.join(stubDir, `summary-${Math.random().toString(36).slice(2)}.md`);
  writeFileSync(summary, '');
  const res = spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test', // part of the ProcessEnv type of this project; the script ignores it
      PATH: `${stubDir}:${process.env.PATH}`,
      EVENT_NAME: event,
      PR_NUMBER: '40',
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_STEP_SUMMARY: summary,
      STUB_JSON: json,
      STUB_FILES: prFiles.join('\n'),
      ...extraEnv,
    },
  });
  return { status: res.status, out: `${res.stdout}\n${res.stderr}`, summary: readFileSync(summary, 'utf8') };
}

const IN_SYNC = list(['0049', '0049'], ['0050', '0050']);
const ONLY_0050_MISSING = list(['0049', '0049'], ['0050', '']);
const BOTH_MISSING = list(['0049', ''], ['0050', '']);

describe.skipIf(!hasJq)('check-migration-drift.sh', () => {
  it.each(['pull_request', 'push', 'workflow_run', 'workflow_dispatch'])('%s: green when production has everything', (event) => {
    const r = run(event, IN_SYNC, ['src/a.ts']);
    expect(r.status).toBe(0);
    expect(r.out).toContain('Production is in sync');
  });

  describe('on a pull request', () => {
    it('the migration the PR itself adds is expected: a notice and a summary, the check stays green', () => {
      const r = run('pull_request', ONLY_0050_MISSING, ['src/a.ts', 'supabase/migrations/0050_exercise_favorites.sql']);
      expect(r.status).toBe(0);
      expect(r.out).toContain('::notice::');
      expect(r.out).not.toContain('::error::');
      expect(r.summary).toContain('0050');
      expect(r.summary).toContain('Expected');
    });

    it('a migration main already has but production lacks is NOT expected: red, and only that one is named', () => {
      const r = run('pull_request', BOTH_MISSING, ['supabase/migrations/0050_exercise_favorites.sql']);
      expect(r.status).toBe(1);
      expect(r.out).toContain('::error::  - 0049');
      expect(r.out).not.toContain('::error::  - 0050');
    });

    it('a PR that does not add the missing migration is red', () => {
      const r = run('pull_request', ONLY_0050_MISSING, ['src/a.ts']);
      expect(r.status).toBe(1);
      expect(r.out).toContain('::error::  - 0050');
    });

    it('matches the whole version: a file 00500_… is not migration 0050', () => {
      const r = run('pull_request', ONLY_0050_MISSING, ['supabase/migrations/00500_something.sql']);
      expect(r.status).toBe(1);
    });

    it('a migration file in another folder does not count', () => {
      const r = run('pull_request', ONLY_0050_MISSING, ['docs/supabase/migrations/0050_x.sql', 'supabase/tests/0050_x.sql']);
      expect(r.status).toBe(1);
    });

    it('if the PR files cannot be read it is red — never silently green', () => {
      const r = run('pull_request', ONLY_0050_MISSING, [], { STUB_GH_FAIL: '1' });
      expect(r.status).toBe(2);
      expect(r.out).toContain('Could not read the files of this pull request');
    });
  });

  describe.each(['push', 'workflow_run', 'workflow_dispatch'])('on %s (main)', (event) => {
    it('any migration production lacks is red: merged, not deployed', () => {
      const r = run(event, ONLY_0050_MISSING, ['supabase/migrations/0050_exercise_favorites.sql']);
      expect(r.status).toBe(1);
      expect(r.out).toContain('Merged but not deployed');
      expect(r.out).toContain('::error::  - 0050');
      expect(r.summary).toContain('0050');
    });
  });

  it('red when the CLI output has no JSON (the table format)', () => {
    const r = run('push', '| local | remote |');
    expect(r.status).toBe(2);
    expect(r.out).toContain("Could not read production's migration list");
  });
});
