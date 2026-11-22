# SpendByTeam plugin for Claude Code

Ask Claude what Claude Code costs you, and track your team's spend per project, branch, ticket and client.

## What you get

- **`cost-report` skill.** Ask "what did Claude Code cost me this week?", "which branch was most expensive?" or "show my priciest sessions". Claude runs the open-source [`spendbyteam`](https://github.com/spendbyteam/cli) CLI (`npx spendbyteam@0.5.1 report --json`), which reads the session logs Claude Code already keeps on your machine and prices them at Anthropic's API list prices. **It makes no network calls and needs no account.**
- **`connect` skill.** Ask "track this for my team" and Claude walks you through connecting this machine to [SpendByTeam](https://spendbyteam.com) (free for up to 3 developers), checking the setup with `doctor`, or removing it with `uninstall`. Claude asks before it runs `connect`.

## Install

```bash
claude plugin marketplace add spendbyteam/cli
claude plugin install spendbyteam@spendbyteam
```

Or inside Claude Code: `/plugin install spendbyteam --marketplace spendbyteam/cli`.

## What this plugin runs, sends and fetches

**The `cost-report` skill** runs `npx --yes spendbyteam@0.5.1 report`. npx downloads that pinned version of the CLI from the npm registry. `report` itself only reads local files and sends nothing.

**The `connect` skill** runs `npx --yes spendbyteam@0.5.1 connect` only after you agree. That turns on Claude Code's built-in OpenTelemetry **metrics only** (cost, tokens, sessions, lines of code, commits) and points them at `https://ingest.spendbyteam.com` with a write-only ingest token. Log events and traces stay off, so no prompts, code, file contents or file paths are sent. It edits `~/.claude/settings.json` (backup in `settings.json.bak`) and writes `~/.spendbyteam/config.json`. The full list is in the [CLI README](https://github.com/spendbyteam/cli#what-gets-sent).

`connect` also installs a small, open-source hook script (`~/.spendbyteam/hook.sh`, [source](https://github.com/spendbyteam/cli/blob/main/hook/hook.sh)) that sends the git remote (credentials stripped), branch and ticket at session start, so team costs can be split by branch and ticket. It never sends your working directory, username, transcript, prompts or file contents.

**This plugin itself contains no hooks, scripts or MCP servers**, only the two skills above, so it does nothing until you ask Claude something.

## Remove

Run `npx spendbyteam uninstall` to undo the telemetry settings, then disable or uninstall the plugin with `/plugin`.

## Support

- Docs: https://spendbyteam.com/docs/install
- Email: support@spendbyteam.com
- Privacy: https://spendbyteam.com/privacy

MIT licensed. © 2026 WebKoding Yazılım ve Teknoloji Çözümleri Ticaret Limited Şirketi.
