#!/usr/bin/env bash
set -euo pipefail

echo "==> Checking Supabase CLI availability"
if ! command -v supabase >/dev/null 2>&1; then
  echo "Error: supabase CLI not found in PATH" >&2
  exit 1
fi

echo "==> Remote migration list"
supabase migration list remote || true

echo "==> Local migration list"
supabase migration list local || true

VERSION=20250913

echo "==> Attempting to mark version $VERSION as applied locally to match remote"
if ! supabase migration repair --status applied "$VERSION"; then
  echo "==> Applied failed, trying reverted for $VERSION"
  supabase migration repair --status reverted "$VERSION" || true
fi

echo "==> Pushing local migrations"
if ! supabase db push --include-all; then
  echo "==> Push failed, attempting pull then push"
  supabase db pull
  supabase db push --include-all
fi

echo "==> Final remote migration list"
supabase migration list remote || true

echo "==> Final local migration list"
supabase migration list local || true

echo "==> Done"

