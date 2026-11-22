---
name: cost-report
description: Use when the user asks what Claude Code costs or has cost them — spend, tokens or usage per project, repo, model, git branch, subagent type, day or session; their most expensive sessions; or how much a branch, feature or ticket cost. Reads the local session logs offline with the open-source spendbyteam CLI; no account needed.
---

# Claude Code cost report

Answer with real numbers from this machine's Claude Code session logs (`~/.claude/projects`, or `$CLAUDE_CONFIG_DIR`). The `spendbyteam` CLI (MIT, https://github.com/spendbyteam/cli) reads them and prices them at Anthropic's API list prices. `report` makes **no network calls** and needs no account.

## Run it

Pick the grouping and window from the question, then run:

```bash
npx --yes spendbyteam@0.5.1 report --json --no-web --days=30 --by=project
```

- `--by=` one of `project` (default), `model`, `agent` (main session vs. each subagent type), `branch`, `day`, `session`
- `--days=N` for the last N days including today, or `--all` for everything left in the logs
- "this week" → `--days=7`; "today" → `--days=1`; "which branch / ticket" → `--by=branch`; "most expensive sessions" → `--by=session`

The JSON has `from`, `to`, `by` and `rows[]`; each row has `key`, `cost` (USD), `share` (0–1), `sessions`, `requests`, `tokens`, `split` (`input`, `output`, `cacheWrite`, `cacheRead`) and `topModel`.

## Answer

- Lead with the total and the top 3–5 rows as a short table: name, cost (2 decimals), share %, sessions, top model.
- Say the window (`from` → `to`).
- Say once that these are **API list prices**: on a Pro, Max or Team seat the user pays a flat fee, so this is what the same tokens would cost on the API.
- If cache reads dominate the split, point it out: long sessions re-read their context on every turn, and starting a fresh session with a short handoff is usually cheaper.
- Don't guess numbers the report didn't give.

If the report warns that logs are being deleted after 30 days (`cleanupPeriodDays`), pass that on: adding `"cleanupPeriodDays": 3650` to `~/.claude/settings.json` keeps history for longer reports. Don't edit the file unless the user asks.

## Team view

This report covers one machine. If the user wants spend across their team, per client or with budgets, use the `connect` skill of this plugin.
