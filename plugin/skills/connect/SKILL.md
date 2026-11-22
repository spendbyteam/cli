---
name: connect
description: Use when the user wants to track Claude Code spend across their team, per client or project, set budgets or alerts, or connect this machine to SpendByTeam — and to check, troubleshoot or remove that setup.
---

# Connect this machine to SpendByTeam

SpendByTeam (https://spendbyteam.com) shows a team's Claude Code spend per developer, project, branch, ticket and client, with budgets. Free for up to 3 developers.

## Before you run anything

Tell the user in two or three lines what connecting does, and get a yes:

- It turns on Claude Code's built-in OpenTelemetry **metrics only** (cost, tokens, sessions, lines of code) and sends them to `https://ingest.spendbyteam.com`. Log events and traces stay off, so **no prompts, code, file contents or file paths** are sent.
- It edits `~/.claude/settings.json` (a backup is kept as `settings.json.bak`) and writes `~/.spendbyteam/config.json` with a write-only ingest token.
- This plugin's hook then sends the git remote, branch and ticket (e.g. `ABC-123` from the branch name) at session start, so cost can be split by branch and ticket.

Full list of what leaves the machine: https://github.com/spendbyteam/cli#what-gets-sent

## Connect

Run it in the background, because it waits for the user to approve in the browser:

```bash
npx --yes spendbyteam@0.5.0 connect
```

It prints a short code and opens the browser. Tell the user to sign up or log in, check the code matches, and click **Connect**. On a server or over SSH, add `--no-browser` and give the user the printed link.

When it finishes, a **new** Claude Code session is needed for the telemetry settings to take effect. Say so.

## Check or fix

```bash
npx --yes spendbyteam@0.5.0 doctor
```

Report each failing line with its fix. Common ones: `jq`, `git` or `curl` missing (the branch hook sends nothing without them; cost metrics still work), or an old Claude Code version (`claude update`).

`npx --yes spendbyteam@0.5.0 status` shows what is installed.

## Remove

```bash
npx --yes spendbyteam@0.5.0 uninstall
```

Undoes everything `connect`/`init` changed in `settings.json`. Then the user can disable or uninstall this plugin with `/plugin`.

## Team admins

To roll out to a whole Team or Enterprise org without each developer running `connect`, `npx --yes spendbyteam@0.5.0 print-managed --token=sbt_ing_...` prints a managed-settings block. Developers still install this plugin for branch and ticket attribution.
