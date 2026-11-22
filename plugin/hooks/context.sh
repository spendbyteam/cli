#!/usr/bin/env bash
# SpendByTeam context hook (plugin edition).
#
# Runs on SessionStart and CwdChanged, async, and always exits 0.
# Sends ONE request to POST {endpoint}/v1/context with exactly these fields:
#   session_id, event, repo_url (credentials stripped), branch, ticket, at
# Never sends: the working directory path, your username, the transcript, prompts or file contents.
#
# Does nothing unless you connected this machine to SpendByTeam:
#   - the plugin's "ingest_token" option (CLAUDE_PLUGIN_OPTION_INGEST_TOKEN), or
#   - ~/.spendbyteam/config.json written by `npx spendbyteam connect` / `init`.
set -u

CFG="$HOME/.spendbyteam/config.json"
SETTINGS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"

command -v jq >/dev/null 2>&1 || exit 0
command -v curl >/dev/null 2>&1 || exit 0

# `npx spendbyteam init` already registered ~/.spendbyteam/hook.sh: let that one send, not both.
if [[ -r "$SETTINGS" ]] && grep -q '\.spendbyteam/hook\.sh' "$SETTINGS" 2>/dev/null; then
  exit 0
fi

TOKEN="${CLAUDE_PLUGIN_OPTION_INGEST_TOKEN:-}"
ENDPOINT=""
if [[ -r "$CFG" ]]; then
  [[ -n "$TOKEN" ]] || TOKEN=$(jq -r '.token // empty' "$CFG" 2>/dev/null)
  ENDPOINT=$(jq -r '.endpoint // empty' "$CFG" 2>/dev/null)
fi
[[ -n "$ENDPOINT" ]] || ENDPOINT="https://ingest.spendbyteam.com"

# Token: safe characters only (no header injection). Endpoint: https (http for localhost only).
printf '%s' "$TOKEN" | grep -qE '^sbt_ing_[A-Za-z0-9_-]{1,120}$' || exit 0
printf '%s' "$ENDPOINT" | grep -qE '^(https://[^[:space:]]+|http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?(/[^[:space:]]*)?)$' || exit 0 # NOSONAR

INPUT=$(cat)
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty')
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty')
EVENT=$(printf '%s' "$INPUT" | jq -r '.hook_event_name // empty')
[[ -n "$SESSION_ID" && -n "$CWD" ]] || exit 0

REMOTE=$(git -C "$CWD" config --get remote.origin.url 2>/dev/null || true)
# Repo without commits and detached HEAD return "HEAD": treat as no branch.
BRANCH=$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null) || BRANCH=""
[[ "$BRANCH" = "HEAD" ]] && BRANCH=""
TICKET=$(printf '%s' "$BRANCH" | grep -oE '[A-Z][A-Z0-9]+-[0-9]+' | head -1 || true)

# Strip credentials (scheme://user:token@host/...), query and fragment from the remote URL.
REMOTE=$(printf '%s' "$REMOTE" | sed -E 's#^([A-Za-z][A-Za-z0-9+.-]*://)[^/]*@#\1#; s#[?\#].*$##')
# Never send a local-path or file:// remote: it would leak the username and folder layout.
printf '%s' "$REMOTE" | grep -qE '^(([A-Za-z][A-Za-z0-9+.-]*://[^/]+)|([^/:@[:space:]]+@[^/:[:space:]]+:)|([A-Za-z0-9-]+\.[A-Za-z0-9.-]+:))' \
  && ! printf '%s' "$REMOTE" | grep -qiE '^file://' || REMOTE=""

# The token is passed to curl through a file descriptor, never on its command line.
jq -n --arg s "$SESSION_ID" --arg e "$EVENT" --arg r "$REMOTE" \
      --arg b "$BRANCH" --arg t "$TICKET" --arg ts "$(date -u +%FT%TZ)" \
  '{session_id:$s, event:$e, repo_url:$r, branch:$b, ticket:$t, at:$ts}' |
curl -sS -m 5 -X POST "$ENDPOINT/v1/context" \
  -H @<(printf 'Authorization: Bearer %s\n' "$TOKEN") -H "Content-Type: application/json" \
  --data-binary @- >/dev/null 2>&1 || true
exit 0
