# SpendByTeam plugin for Claude Code

Ask Claude what Claude Code costs you, and track your team's spend per project, branch, ticket and client.

## What you get

- **`cost-report` skill.** Ask "what did Claude Code cost me this week?", "which branch was most expensive?" or "show my priciest sessions". Claude runs the open-source [`spendbyteam`](https://github.com/spendbyteam/cli) CLI (`npx spendbyteam@0.5.0 report --json`), which reads the session logs Claude Code already keeps on your machine and prices them at Anthropic's API list prices. **It makes no network calls and needs no account.**
- **`connect` skill.** Ask "track this for my team" and Claude walks you through connecting this machine to [SpendByTeam](https://spendbyteam.com) (free for up to 3 developers), checking the setup with `doctor`, or removing it with `uninstall`. Claude asks before it runs `connect`.
- **Context hook** (`SessionStart`, `CwdChanged`, async). Once this machine is connected, it sends the git branch and ticket of each session so team costs can be split by branch and ticket. If you are not connected, it does nothing.

## Install

```bash
claude plugin marketplace add spendbyteam/cli
claude plugin install spendbyteam@spendbyteam
```

Or inside Claude Code: `/plugin install spendbyteam --marketplace spendbyteam/cli`.

## What this plugin runs, sends and fetches

**The `cost-report` skill** runs `npx --yes spendbyteam@0.5.0 report`. npx downloads that pinned version of the CLI from the npm registry. `report` itself only reads local files and sends nothing.

**The `connect` skill** runs `npx --yes spendbyteam@0.5.0 connect` only after you agree. That turns on Claude Code's built-in OpenTelemetry **metrics only** (cost, tokens, sessions, lines of code, commits) and points them at `https://ingest.spendbyteam.com` with a write-only ingest token. Log events and traces stay off, so no prompts, code, file contents or file paths are sent. It edits `~/.claude/settings.json` (backup in `settings.json.bak`) and writes `~/.spendbyteam/config.json`. The full list is in the [CLI README](https://github.com/spendbyteam/cli#what-gets-sent).

**The context hook** ([`hooks/context.sh`](hooks/context.sh), about 60 lines) sends nothing unless it finds an ingest token, either in this plugin's optional `ingest_token` setting (stored in your system keychain) or in `~/.spendbyteam/config.json`. With a token, it sends one `POST https://ingest.spendbyteam.com/v1/context` per session start or directory change with exactly this body:

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

`repo_url` has any embedded credentials, query and fragment removed, and local-path or `file://` remotes are never sent. The hook never sends your working directory, username, transcript, prompts or file contents. If you already ran `npx spendbyteam init`, its own hook sends this request and the plugin's hook stays quiet, so nothing is sent twice. The hook needs `jq`, `git` and `curl`; without them it does nothing. It always exits 0, so it can't break a session.

## Remove

Run `npx spendbyteam uninstall` to undo the telemetry settings, then disable or uninstall the plugin with `/plugin`.

## Support

- Docs: https://spendbyteam.com/docs/install
- Email: support@spendbyteam.com
- Privacy: https://spendbyteam.com/privacy

MIT licensed. © 2026 WebKoding Yazılım ve Teknoloji Çözümleri Ticaret Limited Şirketi.
