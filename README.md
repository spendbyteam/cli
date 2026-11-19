# spendbyteam

See what [Claude Code](https://code.claude.com) costs, per project, model, branch or day. Then share it with your team on **SpendByTeam**.

## See your own spend (no account needed)

```bash
npx spendbyteam report
```

```
Claude Code spend on this machine  2026-10-20 → 2026-11-18
At API list prices. On a Pro, Max or Team seat you pay a flat fee; this is what the same tokens cost on the API.

Project            Cost  Share  Sessions  Tokens  Top model
checkout-api    $412.80    38%        41  980.2M  opus-5-5
web             $301.15    28%        33  702.6M  opus-5-5
infra           $118.40    11%         9  250.1M  sonnet-5-5
…
Total         $1,086.20             112    2.4B
```

`report` reads the session logs Claude Code already keeps on your machine (`~/.claude/projects`, or `$CLAUDE_CONFIG_DIR`). It works offline and **sends nothing anywhere**.

**`report` makes no network calls at all.** It only reads those files and prints a table; you can run it with Wi-Fi off. The network code in this package belongs to `connect` and `init`, and runs only when you call them. On a work laptop you may prefer to pin a version instead of pulling the latest each time:

```bash
npx spendbyteam@0.3.0 report
```

Costs use Anthropic's API list prices, including cache reads, 5-minute and 1-hour cache writes, and fast mode.

### In the browser

On a terminal, `report` asks whether to open the same numbers as an interactive page (Enter = yes). `--web` opens it without asking, `--no-web` never asks.

The page has a cost-per-day chart, the split by model and by token type, and tabs for projects, models, branches, days and sessions, each with a filter, sorting and paging. **Save as PDF** uses your browser's print dialog, **Export CSV** saves the current tab, and **Share** copies a short summary or opens a pre-filled post on X.

It is a single local HTML file (in your temp folder) with its data inline. Its Content-Security-Policy blocks every network request, so it works with Wi-Fi off and uploads nothing; links only open when you click them.

**Claude Code deletes these logs after 30 days by default** ([`cleanupPeriodDays`](https://code.claude.com/docs/en/settings)), so `report` can never look further back than that. It tells you when your logs are on the default and shows the oldest one left. To keep them, add this to `~/.claude/settings.json`:

```json
{ "cleanupPeriodDays": 3650 }
```

If your organization sets `cleanupPeriodDays` in managed settings, that value wins and `report` says so.

| Option | |
|---|---|
| `--days=N` | Last N days, including today (default 30) |
| `--all` | Everything in the logs |
| `--by=project\|model\|branch\|day\|session` | How to group (default `project`; sub-folders of a git repo count as one project). `session` lists your most expensive sessions with turns and the input / output / cache-write / cache-read split |
| `--json` | Machine-readable output |

## Track it for the whole team

```bash
npx spendbyteam connect
```

`connect` prints a short code and opens your browser. Sign up (free for 3 developers) or log in, check the code matches, and click **Connect**. The panel issues an ingest token for this machine and the CLI installs it, so there is nothing to copy. Before you approve, the only thing sent is this machine's name, so the page can show which machine is asking. Use `--no-browser` on a server or over SSH.

Already have a token, or setting up many machines? Use `init` directly:

```bash
npx spendbyteam init --token=sbt_ing_xxxxxxxx
```

This package is open source (MIT) so you can check exactly what leaves your machine. The short version: **numbers only.** No prompts, no code, no file contents, no file paths.

---

## What gets sent

There are only two data flows. Both use your write-only ingest token (`sbt_ing_...`). It can send data but cannot read anything back.

### 1. Claude Code OpenTelemetry metrics (sent by Claude Code itself)

`init` turns on Claude Code's built-in telemetry, **metrics only**:

| Setting | Value | Why |
|---|---|---|
| `CLAUDE_CODE_ENABLE_TELEMETRY` | `1` | turn telemetry on |
| `OTEL_METRICS_EXPORTER` | `otlp` | send metrics |
| `OTEL_LOGS_EXPORTER` | `none` | **no log events** (these can carry prompts and tool details) |
| `OTEL_TRACES_EXPORTER` | `none` | **no traces** |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/json` | |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `https://ingest.spendbyteam.com` | |
| `OTEL_EXPORTER_OTLP_HEADERS` | `Authorization=Bearer sbt_ing_...` | your ingest token |
| `OTEL_METRICS_INCLUDE_SESSION_ID` | `true` | group metrics per session |
| `OTEL_METRICS_INCLUDE_REPOSITORY` | `true` | map cost to a project (Claude Code ≥ 2.1.269) |
| `OTEL_METRICS_INCLUDE_VERSION` | `true` | Claude Code version |
| `OTEL_METRIC_EXPORT_INTERVAL` | `60000` | once a minute |
| `OTEL_RESOURCE_ATTRIBUTES` | `team.id=<id>` | only if you pass `--team-id` |

The content flags `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_DETAILS` and `OTEL_LOG_RAW_API_BODIES` are **never set**. They stay off (the default).

Claude Code then sends counters such as `claude_code.cost.usage`, `claude_code.token.usage`, `claude_code.session.count`, `claude_code.lines_of_code.count`, `claude_code.commit.count`, `claude_code.pull_request.count`, `claude_code.code_edit_tool.decision` and `claude_code.active_time.total`. Each one comes with attributes like `session.id`, `user.email`, `organization.id`, `model`, `type` and `vcs.repository.url.full`.

The server keeps only an allowlist of attributes and drops everything else:
`session.id, user.email, user.account_uuid, organization.id, model, type, query_source, agent.name, skill.name, decision, start_type, vcs.repository.url.full, vcs.repository.name, vcs.owner.name, vcs.provider.name, team.id, app.version, terminal.type`.
`/v1/logs` and `/v1/traces` accept requests and throw them away unread, even if some other setting turns those exporters on.

### 2. The context hook (`~/.spendbyteam/hook.sh`)

OTel metrics don't include your git branch, so a small hook runs on the `SessionStart` and `CwdChanged` events (async, so it never slows Claude Code down). It sends **one** request to `POST {endpoint}/v1/context`. This is the complete body:

```json
{
  "session_id": "6f1c1f1e-3a51-4c2e-9d4c-5f0e2b7d8a90",
  "event": "SessionStart",
  "repo_url": "https://github.com/acme/web.git",
  "branch": "feature/ABC-123-login",
  "ticket": "ABC-123",
  "at": "2026-11-03T09:14:05Z"
}
```

| Field | Source |
|---|---|
| `session_id` | from Claude Code's hook input |
| `event` | `SessionStart` or `CwdChanged` |
| `repo_url` | `git config --get remote.origin.url`, with embedded credentials, query and fragment removed (`https://user:token@host/...` → `https://host/...`). Local-path and `file://` remotes are never sent (empty string). |
| `branch` | `git rev-parse --abbrev-ref HEAD`; empty in a repo without commits or on a detached HEAD |
| `ticket` | first `ABC-123` style match in the branch name, otherwise empty |
| `at` | current UTC time |

The hook **never** sends the working directory path (`cwd`), your username or home directory, the transcript path, or any file contents. Outside a git repo, `repo_url`, `branch` and `ticket` are empty strings.

The hook always exits `0`. If something is missing or broken (no config, no `jq`, no network, not a git repo), it does nothing and can never break a Claude Code session. Read it yourself: [`hook/hook.sh`](hook/hook.sh) is about 35 lines. The token is passed to `curl` through a file descriptor, never on its command line, and nothing is sent unless the endpoint is `https://` (plain `http://` only for localhost).

---

## Commands

```bash
npx spendbyteam init --token=sbt_ing_... [--endpoint=URL] [--team-id=ID] [--no-ping]
npx spendbyteam status
npx spendbyteam doctor [--no-ping]
npx spendbyteam uninstall
npx spendbyteam print-managed --token=sbt_ing_... [--endpoint=URL] [--team-id=ID]
```

### `init`

1. Runs `claude --version` and warns if it is older than **2.1.269**. Older versions don't send repository attributes, so project mapping falls back to the hook. It also warns if `claude` isn't installed. Neither stops the install.
2. Warns if `jq`, `git` or `curl` is missing. The hook needs them; the cost metrics don't.
3. **Merges** the env block and the two hooks into `~/.claude/settings.json`:
   - copies the current file to `~/.claude/settings.json.bak` before it writes anything
   - keeps every other setting, env var and hook as it was
   - is idempotent: running it again changes nothing, and running it with a new token or endpoint updates the existing entries in place (no duplicate hooks)
   - stops without writing anything if `settings.json` is not valid JSON
   - restricts the file to the owner (`go-rwx`), because it now contains the ingest token
4. Writes `~/.spendbyteam/config.json` as `{ "token": "...", "endpoint": "..." }` with mode **600** (directory 700). The hook reads it because Claude Code doesn't pass `OTEL_*` variables to hooks.
5. Writes `~/.spendbyteam/state.json` (mode 600): the values your env keys had before the install, so `uninstall` can put them back.
6. Copies the hook to `~/.spendbyteam/hook.sh` (mode 755).
7. Sends `GET {endpoint}/v1/ping` with the token so the panel shows the machine as connected. Skip this with `--no-ping`.

Restart running Claude Code sessions afterwards.

### `uninstall`

Removes the two hook entries, restores env keys to their pre-install values (deleting keys that didn't exist before) and deletes `~/.spendbyteam/`. If you changed one of those keys yourself after installing, your value is kept. Before writing, it saves a backup to `~/.claude/settings.json.bak`. That backup still contains the ingest token; delete it if you don't need it.

### `status` / `doctor`

`status` shows what is installed and exits `1` if anything is missing. `doctor` also checks `jq`/`git`/`curl`, the Claude Code version, the config file's permissions and whether the hook is executable, and pings the endpoint. It exits `1` if any check fails.

### `print-managed` (Team / Enterprise)

Prints [managed settings](https://code.claude.com/docs/en/settings) JSON with the same `env` block, so an admin can roll it out to everyone at once:

```bash
npx spendbyteam print-managed --token=sbt_ing_... > managed-settings.json
```

Put the file at `/Library/Application Support/ClaudeCode/managed-settings.json` (macOS) or `/etc/claude-code/managed-settings.json` (Linux/WSL), or paste it into server-managed settings (this also covers claude.ai/code cloud sessions). When the endpoint and headers come from managed settings, Claude Code ignores endpoints set by individual developers. The hook needs a script on each machine, so it isn't included here; developers who want branch/ticket attribution also run `npx spendbyteam init`.

---

## Requirements

- Node.js ≥ 18.17 (only for running the CLI; nothing stays running)
- macOS, Linux or WSL
- Claude Code ≥ 2.1.269 recommended
- `jq`, `git`, `curl` for the context hook

## Development

```bash
npm install
npm test          # vitest unit tests (temporary HOME) + shell tests for hook.sh
npm run build     # → dist/
```

The unit tests run every command against a throwaway `HOME` and a fake `PATH`, so they never touch your real `~/.claude`. `test/hook.test.sh` runs the real `hook.sh` with a fake `curl` and checks the exact payload: no `cwd`, credentials removed from the remote, exit 0 on any failure.

## License

[MIT](LICENSE)
