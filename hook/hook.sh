#!/usr/bin/env bash
# SpendByTeam context hook — açık kaynak, sadece aşağıdaki alanları gönderir.
set -u
CFG="$HOME/.spendbyteam/config.json"
[ -r "$CFG" ] || exit 0

INPUT=$(cat)
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty')
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty')
EVENT=$(printf '%s' "$INPUT" | jq -r '.hook_event_name // empty')
[ -n "$SESSION_ID" ] && [ -n "$CWD" ] || exit 0

TOKEN=$(jq -r '.token // empty' "$CFG"); ENDPOINT=$(jq -r '.endpoint // empty' "$CFG")
# Token yalnızca güvenli karakterler (header enjeksiyonu yok); endpoint https (http sadece localhost).
printf '%s' "$TOKEN" | grep -qE '^sbt_ing_[A-Za-z0-9_-]{1,120}$' || exit 0
printf '%s' "$ENDPOINT" | grep -qE '^(https://[^[:space:]]+|http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?(/[^[:space:]]*)?)$' || exit 0

REMOTE=$(git -C "$CWD" config --get remote.origin.url 2>/dev/null || true)
# Commit'siz repo ve detached HEAD'de rev-parse "HEAD" döner: branch yok say.
BRANCH=$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null) || BRANCH=""
[ "$BRANCH" = "HEAD" ] && BRANCH=""
TICKET=$(printf '%s' "$BRANCH" | grep -oE '[A-Z][A-Z0-9]+-[0-9]+' | head -1 || true)

# Remote URL'den kimlik bilgisini (scheme://user:token@host/...), query ve fragment'ı temizle.
REMOTE=$(printf '%s' "$REMOTE" | sed -E 's#^([A-Za-z][A-Za-z0-9+.-]*://)[^/]*@#\1#; s#[?\#].*$##')
# Yerel yol / file:// remote'u gönderme: kullanıcı adı ve klasör yapısı sızar (cwd kuralı).
printf '%s' "$REMOTE" | grep -qE '^(([A-Za-z][A-Za-z0-9+.-]*://[^/]+)|([^/:@[:space:]]+@[^/:[:space:]]+:)|([A-Za-z0-9-]+\.[A-Za-z0-9.-]+:))' \
  && ! printf '%s' "$REMOTE" | grep -qiE '^file://' || REMOTE=""

# Token argv'de değil (ps ile diğer kullanıcılar göremesin): header bir fd'den okunur.
jq -n --arg s "$SESSION_ID" --arg e "$EVENT" --arg r "$REMOTE" \
      --arg b "$BRANCH" --arg t "$TICKET" --arg ts "$(date -u +%FT%TZ)" \
  '{session_id:$s, event:$e, repo_url:$r, branch:$b, ticket:$t, at:$ts}' |
curl -sS -m 5 -X POST "$ENDPOINT/v1/context" \
  -H @<(printf 'Authorization: Bearer %s\n' "$TOKEN") -H "Content-Type: application/json" \
  --data-binary @- >/dev/null 2>&1 || true
exit 0
