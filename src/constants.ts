export const DEFAULT_ENDPOINT = 'https://ingest.spendbyteam.com';
export const MIN_CLAUDE_VERSION = '2.1.269';

/** Command written into ~/.claude/settings.json (TECHNICAL.md §4.1). */
export const HOOK_COMMAND = '~/.spendbyteam/hook.sh';
export const HOOK_EVENTS = ['SessionStart', 'CwdChanged'] as const;
export const HOOK_TIMEOUT_SECONDS = 10;

/** Any hook command pointing at our script counts as "ours" (also absolute-path variants). */
export const HOOK_COMMAND_RE = /(^|\/)\.spendbyteam\/hook\.sh$/;

export const TOKEN_RE = /^sbt_ing_[A-Za-z0-9_-]{8,}$/;

/** Dependencies the hook script needs at runtime. */
export const HOOK_DEPS = ['jq', 'git', 'curl'] as const;
