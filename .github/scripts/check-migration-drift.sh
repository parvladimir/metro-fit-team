#!/usr/bin/env bash
# Which migration files of this checkout has production not applied yet?
#
# READ-ONLY: it only lists production's migration history (`supabase migration list --linked`);
# it never writes to the database. The human-triggered fix is deploy-db-migrations.yml.
#
#   pull_request                          A migration that THIS pull request adds cannot be in production
#                                         before the merge, so that is expected: reported as a notice, the
#                                         check stays green. Migrations that main already has but production
#                                         lacks are NOT expected (an earlier merge was never deployed): red.
#   push / workflow_run / workflow_dispatch   Every migration production lacks is a problem ("merged, not
#                                         deployed yet"): red until the deploy workflow has run (it re-runs
#                                         this check when it finishes, so the red turns green by itself).
#
# Environment: EVENT_NAME (github.event_name); for pull_request also PR_NUMBER and GITHUB_REPOSITORY,
# and GH_TOKEN for `gh`. GITHUB_STEP_SUMMARY is optional.
set -euo pipefail

EVENT_NAME="${EVENT_NAME:-}"
SUMMARY_FILE="${GITHUB_STEP_SUMMARY:-/dev/null}"

# --output-format json is required explicitly: without it this CLI renders a human-readable
# markdown table on some runners (observed in GitHub Actions) instead of JSON, even though a
# local terminal may default to JSON already — never rely on the ambient default.
RAW=$(supabase --output-format json migration list --linked)
echo "$RAW"
JSON=$(echo "$RAW" | grep '^{' || true)
if [ -z "$JSON" ]; then
  echo "::error::Could not read production's migration list (the CLI printed no JSON)."
  exit 2
fi

MISSING=$(echo "$JSON" | jq -r '.migrations[] | select(.remote == "") | .local')
if [ -z "$MISSING" ]; then
  echo "Production is in sync with this branch's migrations."
  exit 0
fi

if [ "$EVENT_NAME" = "pull_request" ]; then
  # What this pull request itself adds or changes (the files as the "Files changed" tab shows them).
  FILES=$(gh api --paginate "repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}/files" \
    --jq '.[] | select(.status != "removed") | .filename') || {
    echo "::error::Could not read the files of this pull request, so it is unknown which missing migrations are its own."
    exit 2
  }
  # supabase/migrations/0050_name.sql -> 0050 (the same version the migration list prints)
  OWN=$(echo "$FILES" | sed -n -E 's#^supabase/migrations/([0-9]+)_[^/]*$#\1#p' | sort -u)

  OTHERS=""
  for v in $MISSING; do
    if ! grep -qx "$v" <<<"$OWN"; then
      OTHERS="$OTHERS $v"
    fi
  done

  if [ -n "$OTHERS" ]; then
    echo "::error::Production lacks migration(s) that are already in main — they come from an earlier merge, not from this pull request:"
    for v in $OTHERS; do echo "::error::  - $v"; done
    echo ""
    echo "Run the 'Deploy DB migrations to production' workflow first (Actions tab → Run workflow on main), then re-run this check."
    exit 1
  fi

  LIST=$(echo "$MISSING" | paste -sd, - | sed 's/,/, /g')
  echo "::notice::This pull request adds migration(s) $LIST. Production cannot have them before the merge — expected. After a person merges: Actions → 'Deploy DB migrations to production' → Run workflow on main."
  {
    echo "### This pull request adds migration(s) that production does not have yet"
    echo ""
    for v in $MISSING; do echo "- \`$v\`"; done
    echo ""
    echo "Expected, nothing is wrong. After a person merges it: **Actions → Deploy DB migrations to production → Run workflow** on \`main\`."
    echo "The check on \`main\` stays red until then and turns green by itself when the deploy has finished."
  } >> "$SUMMARY_FILE"
  exit 0
fi

echo "::error::Merged but not deployed: these migrations are in main but NOT applied to production yet:"
for v in $MISSING; do echo "::error::  - $v"; done
echo ""
echo "Run the 'Deploy DB migrations to production' workflow (Actions tab → Run workflow on main) — or 'npx supabase db push --linked' yourself. This check re-runs by itself when that workflow finishes."
{
  echo "### Merged, but not deployed to production yet"
  echo ""
  for v in $MISSING; do echo "- \`$v\`"; done
  echo ""
  echo "**Actions → Deploy DB migrations to production → Run workflow** on \`main\`."
} >> "$SUMMARY_FILE"
exit 1
