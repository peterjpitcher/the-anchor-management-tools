#!/bin/bash
# run-codex-review.sh — Runs a Codex specialist review
# Usage: ./run-codex-review.sh <specialist> <project-root> <workspace> <prompt>
#
# Arguments:
#   specialist   - Name for the report file (e.g., "assumption-breaker", "repo-reality-mapper")
#   project-root - Path to the project being reviewed
#   workspace    - Directory to save the report
#   prompt       - The review prompt (can be a file path or string)

set -uo pipefail

SPECIALIST="${1:?Usage: $0 <specialist> <project-root> <workspace> <prompt>}"
PROJECT_ROOT="${2:?Missing project root}"
WORKSPACE="${3:?Missing workspace directory}"
PROMPT="${4:?Missing prompt}"

# --- Retry configuration ---
MAX_RETRIES="${CODEX_MAX_RETRIES:-5}"
INITIAL_BACKOFF="${CODEX_INITIAL_BACKOFF:-30}"  # seconds
MAX_BACKOFF="${CODEX_MAX_BACKOFF:-300}"          # 5 minutes cap

# --- Capacity error detection ---
# Matches common capacity/rate-limit error strings from OpenAI APIs
is_capacity_error() {
  local output="$1"
  local exit_code="$2"
  # Exit code 0 means success — not a capacity error
  if [ "$exit_code" -eq 0 ]; then
    return 1
  fi
  # Check for known capacity/rate-limit patterns in stderr/stdout
  if echo "$output" | grep -qiE \
    '(capacity|rate.?limit|too.?many.?requests|overloaded|server.?busy|503|429|quota|resource.?exhausted|try.?again|retry.?after|currently.?unavailable|service.?unavailable)'; then
    return 0
  fi
  return 1
}

# Find codex binary
CODEX_BIN="${CODEX_BIN:-codex}"
if ! command -v "$CODEX_BIN" &> /dev/null; then
  # Try common install locations
  for candidate in \
    "$HOME/.npm-global/bin/codex" \
    "/sessions/dreamy-festive-gauss/.npm-global/bin/codex" \
    "$(npm root -g 2>/dev/null)/.bin/codex" \
  ; do
    if [ -x "$candidate" ]; then
      CODEX_BIN="$candidate"
      break
    fi
  done
fi

if ! command -v "$CODEX_BIN" &> /dev/null && [ ! -x "$CODEX_BIN" ]; then
  echo "ERROR: Codex CLI not found. Install with: npm install -g @openai/codex" >&2
  echo "EXIT_REASON=NOT_INSTALLED" >&2
  exit 1
fi

mkdir -p "$WORKSPACE"

REPORT_FILE="$WORKSPACE/${SPECIALIST}-report.md"

# If prompt is a file, read it
if [ -f "$PROMPT" ]; then
  PROMPT_TEXT="$(cat "$PROMPT")"
else
  PROMPT_TEXT="$PROMPT"
fi

echo "Running Codex $SPECIALIST review..."
echo "Project: $PROJECT_ROOT"
echo "Output: $REPORT_FILE"

# --- Run with retry logic for capacity errors ---
attempt=0
backoff=$INITIAL_BACKOFF

while [ "$attempt" -le "$MAX_RETRIES" ]; do
  attempt=$((attempt + 1))

  # Capture both stdout+stderr and the exit code
  OUTPUT=$( "$CODEX_BIN" exec \
    --full-auto \
    -C "$PROJECT_ROOT" \
    -o "$REPORT_FILE" \
    "$PROMPT_TEXT" 2>&1 ) && EXIT_CODE=0 || EXIT_CODE=$?

  # Exit code 0 — but verify output is non-empty before declaring success.
  # Codex can exhaust its token budget exploring files and never produce a
  # final message, resulting in a 0-byte output file despite exit code 0.
  if [ "$EXIT_CODE" -eq 0 ]; then
    if [ ! -s "$REPORT_FILE" ]; then
      echo "WARNING: Codex exited 0 but wrote empty output to $REPORT_FILE" >&2
      echo "EXIT_REASON=EMPTY_OUTPUT" >&2
      exit 1  # Force non-zero so retry/fallback logic kicks in
    fi
    echo "Done. Report saved to: $REPORT_FILE"
    exit 0
  fi

  # Check if it's a capacity/rate-limit error
  if is_capacity_error "$OUTPUT" "$EXIT_CODE"; then
    if [ "$attempt" -gt "$MAX_RETRIES" ]; then
      echo "ERROR: Codex still at capacity after $MAX_RETRIES retries. Giving up." >&2
      echo "$OUTPUT" >&2
      echo "EXIT_REASON=CAPACITY_EXHAUSTED" >&2
      exit 2
    fi
    echo "⏳ Codex at capacity (attempt $attempt/$MAX_RETRIES). Waiting ${backoff}s before retry..." >&2
    sleep "$backoff"
    # Exponential backoff with jitter, capped at MAX_BACKOFF
    jitter=$((RANDOM % 10))
    backoff=$(( (backoff * 2) + jitter ))
    if [ "$backoff" -gt "$MAX_BACKOFF" ]; then
      backoff=$MAX_BACKOFF
    fi
  else
    # Non-capacity error — fail immediately, don't retry
    echo "ERROR: Codex failed with a non-capacity error (exit code $EXIT_CODE):" >&2
    echo "$OUTPUT" >&2
    echo "EXIT_REASON=OTHER_ERROR" >&2
    exit 1
  fi
done
