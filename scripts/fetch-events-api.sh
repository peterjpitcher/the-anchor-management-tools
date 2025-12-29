#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://management.orangejelly.co.uk/api}"
TOKEN="${API_TOKEN:-}"

if [[ -z "$TOKEN" ]]; then
  echo "Missing API_TOKEN. Example:"
  echo "  API_TOKEN=... BASE_URL=http://localhost:3000/api $0"
  exit 1
fi

echo "== /events =="
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE_URL/events" | jq

echo "== /events/today =="
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE_URL/events/today" | jq

# Optional: event detail (set EVENT_ID env var)
if [[ -n "${EVENT_ID:-}" ]]; then
  echo "== /events/$EVENT_ID =="
  curl -sS -H "Authorization: Bearer $TOKEN" "$BASE_URL/events/$EVENT_ID" | jq

  echo "== /events/$EVENT_ID/check-availability =="
  curl -sS -H "Authorization: Bearer $TOKEN" "$BASE_URL/events/$EVENT_ID/check-availability" | jq
fi
