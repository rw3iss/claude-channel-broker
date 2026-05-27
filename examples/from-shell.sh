#!/usr/bin/env bash
# Shell one-liners. Set CLAUDE_CHANNEL_TOKEN first.

BROKER="${BROKER:-http://127.0.0.1:4180}"
TOKEN="${CLAUDE_CHANNEL_TOKEN:?CLAUDE_CHANNEL_TOKEN is required}"

# Submit a job by label, return job_id only:
submit() {
  local label="$1"; shift
  local content="$*"
  curl -sS -X POST "$BROKER/jobs" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"session_label\":\"$label\",\"content\":\"$content\"}" \
    | jq -r .job_id
}

# Wait for a job and print the result JSON:
wait_job() {
  local id="$1"
  curl -sS "$BROKER/jobs/$id/wait?timeout=120" \
    -H "Authorization: Bearer $TOKEN"
}

# Submit + wait in one go:
submit_and_wait() {
  local id; id="$(submit "$@")"
  wait_job "$id" | jq .
}

# List attached sessions:
sessions() {
  curl -sS "$BROKER/sessions" -H "Authorization: Bearer $TOKEN" | jq .
}

# Examples:
#   submit_and_wait trader-debug 'Investigate why /trade is slow'
#   sessions
