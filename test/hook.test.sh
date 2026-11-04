#!/usr/bin/env bash
# Shell tests for hook/hook.sh. No network: a fake `curl` earlier on PATH records its
# arguments and the JSON body it would send. Requires bash, jq and git.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$HERE/../hook/hook.sh"
TOKEN="sbt_ing_abcdefghijklmnopqrstuvwxyz012345"
PASS=0
FAIL=0
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/sbt-hook-test.XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

for dep in jq git; do
  command -v "$dep" >/dev/null || { echo "missing $dep, cannot run hook tests"; exit 1; }
done
SYS_PATH="$(dirname "$(command -v jq)"):$(dirname "$(command -v git)"):/usr/bin:/bin"

ok()   { PASS=$((PASS + 1)); echo "  ok   $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; [ $# -gt 1 ] && echo "       $2"; }
assert_eq() { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1" "expected [$3], got [$2]"; fi; }

# Fresh HOME + fake curl for each case.
setup() {
  T="$ROOT/case$((PASS + FAIL))_$RANDOM"
  mkdir -p "$T/home/.spendbyteam" "$T/bin" "$T/out"
  export HOME="$T/home"
  cat >"$T/bin/curl" <<CURL
#!/usr/bin/env bash
printf '%s\n' "\$@" >"$T/out/argv"
: >"$T/out/args"
for a in "\$@"; do
  # -H @file: curl reads headers from the file; record its content like a plain -H value.
  if [ "\${a#@}" != "\$a" ] && [ "\$a" != "@-" ] && [ -r "\${a#@}" ]; then cat "\${a#@}" >>"$T/out/args"; else printf '%s\n' "\$a" >>"$T/out/args"; fi
done
cat >"$T/out/body"
CURL
  chmod +x "$T/bin/curl"
  export PATH="$T/bin:$SYS_PATH"
  printf '{"token":"%s","endpoint":"https://ingest.example.com"}\n' "$TOKEN" >"$HOME/.spendbyteam/config.json"
  chmod 600 "$HOME/.spendbyteam/config.json"
}

make_repo() { # dir branch remote
  mkdir -p "$1"
  git -C "$1" init -q -b "$2"
  git -C "$1" -c user.email=t@example.com -c user.name=t commit -q --allow-empty -m init
  [ -n "${3:-}" ] && git -C "$1" remote add origin "$3"
  return 0
}

run_hook() { # json → exit code in RC
  printf '%s' "$1" | bash "$HOOK" >"$T/out/stdout" 2>"$T/out/stderr"
  RC=$?
}

echo "hook.sh"

# 1. Full payload from a git repo with credentials in the remote URL.
setup
make_repo "$T/work/secret-client-folder" "feature/ABC-123-login" "https://alice:ghp_SECRET@github.com/acme/web.git"
run_hook "{\"session_id\":\"sess-1\",\"cwd\":\"$T/work/secret-client-folder\",\"hook_event_name\":\"SessionStart\",\"transcript_path\":\"/x/y.jsonl\"}"
assert_eq "exits 0" "$RC" 0
assert_eq "no stdout (never injects context)" "$(cat "$T/out/stdout")" ""
BODY="$(cat "$T/out/body")"
assert_eq "payload has exactly the documented keys" "$(jq -c 'keys' <<<"$BODY")" '["at","branch","event","repo_url","session_id","ticket"]'
assert_eq "session_id" "$(jq -r .session_id <<<"$BODY")" "sess-1"
assert_eq "event" "$(jq -r .event <<<"$BODY")" "SessionStart"
assert_eq "branch" "$(jq -r .branch <<<"$BODY")" "feature/ABC-123-login"
assert_eq "ticket extracted" "$(jq -r .ticket <<<"$BODY")" "ABC-123"
assert_eq "credentials stripped from remote" "$(jq -r .repo_url <<<"$BODY")" "https://github.com/acme/web.git"
if jq -r .at <<<"$BODY" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'; then ok "at is UTC ISO-8601"; else fail "at is UTC ISO-8601" "$BODY"; fi
if grep -q "secret-client-folder" <<<"$BODY" || grep -q "$HOME" <<<"$BODY"; then fail "cwd/home path never sent" "$BODY"; else ok "cwd/home path never sent"; fi
if grep -q "ghp_SECRET\|alice" <<<"$BODY"; then fail "no git credentials in body"; else ok "no git credentials in body"; fi
if grep -q "y.jsonl" <<<"$BODY"; then fail "transcript path never sent"; else ok "transcript path never sent"; fi
ARGS="$(cat "$T/out/args")"
grep -qx "https://ingest.example.com/v1/context" <<<"$ARGS" && ok "posts to {endpoint}/v1/context" || fail "posts to {endpoint}/v1/context" "$ARGS"
grep -qx "Authorization: Bearer $TOKEN" <<<"$ARGS" && ok "sends bearer token" || fail "sends bearer token" "$ARGS"
grep -qx -- "-m" <<<"$ARGS" && ok "uses a curl timeout" || fail "uses a curl timeout" "$ARGS"

# 2. ssh remote, branch without ticket, CwdChanged.
setup
make_repo "$T/r2" "main" "git@github.com:acme/api.git"
run_hook "{\"session_id\":\"s2\",\"cwd\":\"$T/r2\",\"hook_event_name\":\"CwdChanged\"}"
BODY="$(cat "$T/out/body")"
assert_eq "ssh remote kept" "$(jq -r .repo_url <<<"$BODY")" "git@github.com:acme/api.git"
assert_eq "empty ticket" "$(jq -r .ticket <<<"$BODY")" ""
assert_eq "CwdChanged event" "$(jq -r .event <<<"$BODY")" "CwdChanged"

# 3. Lowercase ticket-like names are not tickets; first match wins.
setup
make_repo "$T/r3" "abc-1-PROJ-42-and-OPS-7" ""
run_hook "{\"session_id\":\"s3\",\"cwd\":\"$T/r3\",\"hook_event_name\":\"SessionStart\"}"
BODY="$(cat "$T/out/body")"
assert_eq "first uppercase ticket" "$(jq -r .ticket <<<"$BODY")" "PROJ-42"
assert_eq "no remote → empty repo_url" "$(jq -r .repo_url <<<"$BODY")" ""

# 4. Not a git repository.
setup
mkdir -p "$T/plain"
run_hook "{\"session_id\":\"s4\",\"cwd\":\"$T/plain\",\"hook_event_name\":\"SessionStart\"}"
assert_eq "non-repo exits 0" "$RC" 0
BODY="$(cat "$T/out/body")"
assert_eq "non-repo: empty branch" "$(jq -r .branch <<<"$BODY")" ""
assert_eq "non-repo: session still sent" "$(jq -r .session_id <<<"$BODY")" "s4"

# 5. No config → silent no-op.
setup
rm "$HOME/.spendbyteam/config.json"
run_hook '{"session_id":"s5","cwd":"/tmp","hook_event_name":"SessionStart"}'
assert_eq "no config exits 0" "$RC" 0
[ -e "$T/out/body" ] && fail "no config: nothing sent" || ok "no config: nothing sent"

# 6. Missing session_id / cwd / garbage input → no request.
for input in '{"cwd":"/tmp"}' '{"session_id":"x"}' 'not json' ''; do
  setup
  run_hook "$input"
  assert_eq "bad input [$input] exits 0" "$RC" 0
  [ -e "$T/out/body" ] && fail "bad input [$input]: nothing sent" || ok "bad input [$input]: nothing sent"
done

# 7. curl failing (network down) must not fail the hook.
setup
printf '#!/usr/bin/env bash\ncat >/dev/null; exit 7\n' >"$T/bin/curl"
make_repo "$T/r7" "main" ""
run_hook "{\"session_id\":\"s7\",\"cwd\":\"$T/r7\",\"hook_event_name\":\"SessionStart\"}"
assert_eq "curl failure still exits 0" "$RC" 0

# 8. jq missing → exits 0 without sending (PATH without jq).
setup
mkdir -p "$T/nojq"
for b in bash git cat sed grep head date dirname env printf; do
  p="$(PATH="$SYS_PATH" command -v "$b" 2>/dev/null)" && [ -n "$p" ] && [ "${p#/}" != "$p" ] && ln -sf "$p" "$T/nojq/$b"
done
ln -sf "$T/bin/curl" "$T/nojq/curl"
printf '{"session_id":"s8","cwd":"/tmp","hook_event_name":"SessionStart"}' | PATH="$T/nojq" "$T/nojq/bash" "$HOOK" >/dev/null 2>&1
RC=$?
assert_eq "missing jq exits 0" "$RC" 0
[ -e "$T/out/body" ] && fail "missing jq: nothing sent" || ok "missing jq: nothing sent"

# 9. Repo without commits (unborn branch) → empty branch, never the literal "HEAD".
setup
mkdir -p "$T/unborn" && git -C "$T/unborn" init -q -b PROJ-9-start
run_hook "{\"session_id\":\"s9\",\"cwd\":\"$T/unborn\",\"hook_event_name\":\"SessionStart\"}"
assert_eq "unborn repo exits 0" "$RC" 0
BODY="$(cat "$T/out/body")"
assert_eq "unborn repo: empty branch (not HEAD)" "$(jq -r .branch <<<"$BODY")" ""
assert_eq "unborn repo: empty ticket" "$(jq -r .ticket <<<"$BODY")" ""

# 10. Detached HEAD → empty branch.
setup
make_repo "$T/det" "main" ""
git -C "$T/det" checkout -q --detach
run_hook "{\"session_id\":\"s10\",\"cwd\":\"$T/det\",\"hook_event_name\":\"SessionStart\"}"
assert_eq "detached HEAD: empty branch" "$(jq -r .branch "$T/out/body")" ""

# 11. Token never on curl's argv (visible to other local users via ps).
setup
make_repo "$T/r11" "main" ""
run_hook "{\"session_id\":\"s11\",\"cwd\":\"$T/r11\",\"hook_event_name\":\"SessionStart\"}"
if grep -q "$TOKEN" "$T/out/argv"; then fail "token not in curl argv" "$(cat "$T/out/argv")"; else ok "token not in curl argv"; fi
grep -qx "Authorization: Bearer $TOKEN" "$T/out/args" && ok "token sent via header file" || fail "token sent via header file"

# 12. Remote URL sanitising: credentials (also with '@' in the password), query, local paths.
check_remote() { # remote expected label
  setup
  make_repo "$T/rr" "main" "$1"
  run_hook "{\"session_id\":\"sr\",\"cwd\":\"$T/rr\",\"hook_event_name\":\"SessionStart\"}"
  assert_eq "remote: $3" "$(jq -r .repo_url "$T/out/body")" "$2"
}
check_remote "https://u:p@ss@github.com/acme/web.git" "https://github.com/acme/web.git" "password containing @ fully stripped"
check_remote "ssh://deploy:hunter2@git.example.com:2222/acme/api.git" "ssh://git.example.com:2222/acme/api.git" "ssh:// credentials stripped"
check_remote "https://gitlab.example.com/acme/web.git?private_token=glpat-XYZ" "https://gitlab.example.com/acme/web.git" "query string dropped"
check_remote "HTTPS://oauth2:tok@GitHub.com/a/b" "HTTPS://GitHub.com/a/b" "uppercase scheme stripped"
check_remote "/home/alice/clients/secret-co/repo.git" "" "local path not sent"
check_remote "../secret-co/repo.git" "" "relative path not sent"
check_remote "file:///home/alice/secret/repo.git" "" "file:// not sent"
check_remote "github.com:acme/api.git" "github.com:acme/api.git" "scp-like without user kept"

# 13. JSON / shell injection through hook input and paths.
setup
WEIRD="$T/w \$(touch $T/pwned) \`touch $T/pwned2\` \"q\""
make_repo "$WEIRD" 'feat/"x"-ABC-1' ""
SID=$(jq -n --arg c "$WEIRD" '{session_id:"a\"b\nc}", cwd:$c, hook_event_name:"SessionStart"}')
run_hook "$SID"
assert_eq "weird input exits 0" "$RC" 0
assert_eq "session_id JSON-escaped round trip" "$(jq -r .session_id "$T/out/body")" "$(printf 'a"b\nc}')"
assert_eq "branch with quotes round trip" "$(jq -r .branch "$T/out/body")" 'feat/"x"-ABC-1'
[ -e "$T/pwned" ] || [ -e "$T/pwned2" ] && fail "no command execution from cwd" || ok "no command execution from cwd"
assert_eq "payload keys unchanged with weird input" "$(jq -c 'keys' "$T/out/body")" '["at","branch","event","repo_url","session_id","ticket"]'

# 14. Tampered config: plain-http endpoint, header injection in token → nothing sent.
for cfg in '{"token":"sbt_ing_abc","endpoint":"http://evil.example.com"}' \
           '{"token":"sbt_ing_abc\r\nX-Evil: 1","endpoint":"https://ingest.example.com"}' \
           '{"token":"sbt_ing_abc","endpoint":"https://ingest.example.com -o /tmp/x"}' \
           '{"endpoint":"https://ingest.example.com"}'; do
  setup
  printf '%s' "$cfg" >"$HOME/.spendbyteam/config.json"
  make_repo "$T/r14" "main" ""
  run_hook "{\"session_id\":\"s14\",\"cwd\":\"$T/r14\",\"hook_event_name\":\"SessionStart\"}"
  assert_eq "bad config exits 0 [$cfg]" "$RC" 0
  [ -e "$T/out/body" ] && fail "bad config: nothing sent [$cfg]" || ok "bad config: nothing sent [$cfg]"
done

# 15. http://localhost stays allowed (development).
setup
printf '{"token":"%s","endpoint":"http://127.0.0.1:4319"}' "$TOKEN" >"$HOME/.spendbyteam/config.json"
make_repo "$T/r15" "main" ""
run_hook "{\"session_id\":\"s15\",\"cwd\":\"$T/r15\",\"hook_event_name\":\"SessionStart\"}"
grep -qx "http://127.0.0.1:4319/v1/context" "$T/out/args" && ok "localhost http endpoint allowed" || fail "localhost http endpoint allowed"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
