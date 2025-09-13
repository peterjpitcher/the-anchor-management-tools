#!/usr/bin/env bash
set -euo pipefail

# This script auto-creates local placeholder migrations for any remote-only
# versions, then pushes all local migrations.

if ! command -v supabase >/dev/null 2>&1; then
  echo "Error: supabase CLI not found in PATH" >&2
  exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
MIG_DIR="$REPO_ROOT/supabase/migrations"

mkdir -p "$MIG_DIR"

echo "==> Gathering remote migration versions"
REMOTE_LIST=$(supabase migration list remote || true)

echo "==> Gathering local migration versions"
LOCAL_LIST=$(supabase migration list local || true)

echo "==> Parsing versions"
mapfile -t REMOTE_VERSIONS < <(echo "$REMOTE_LIST" | awk '{print $1}' | grep -E '^[0-9]{8,}$' | sort | uniq)
mapfile -t LOCAL_VERSIONS < <(ls -1 "$MIG_DIR" 2>/dev/null | sed 's/_.*//' | grep -E '^[0-9]{8,}$' | sort | uniq)

echo "Remote versions: ${REMOTE_VERSIONS[*]:-none}"
echo "Local versions:  ${LOCAL_VERSIONS[*]:-none}"

missing=()
for v in "${REMOTE_VERSIONS[@]}"; do
  if ! printf '%s\n' "${LOCAL_VERSIONS[@]}" | grep -qx "$v"; then
    missing+=("$v")
  fi
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "==> Creating local placeholders for remote-only versions: ${missing[*]}"
  for v in "${missing[@]}"; do
    file="$MIG_DIR/${v}_remote_placeholder.sql"
    if [ ! -f "$file" ]; then
      cat >"$file" <<SQL
-- Auto-generated placeholder to align with remote migration $v
DO $$ BEGIN END $$;
SQL
      echo "Created $file"
    fi
  done
else
  echo "==> No missing remote versions."
fi

echo "==> Pushing migrations"
supabase db push --include-all

echo "==> Done"

