import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HOOK_DEPS, MIN_CLAUDE_VERSION } from './constants.js';

/** Look a binary up on PATH without spawning a shell. */
export function which(name: string, envPath = process.env.PATH ?? ''): string | undefined {
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* not here */
    }
  }
  return undefined;
}

export function missingDeps(envPath?: string): string[] {
  return HOOK_DEPS.filter((d) => !which(d, envPath));
}

export function parseVersion(text: string): [number, number, number] | undefined {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (!m) return undefined;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    const d = a[i]! - b[i]!;
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export type ClaudeVersionCheck =
  | { status: 'ok'; version: string }
  | { status: 'old'; version: string }
  | { status: 'missing' }
  | { status: 'unknown'; output: string };

export function checkClaudeVersion(): ClaudeVersionCheck {
  const bin = which('claude');
  if (!bin) return { status: 'missing' };
  const res = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 10_000 });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim();
  const v = parseVersion(out);
  if (!v) return { status: 'unknown', output: out };
  const version = v.join('.');
  const min = parseVersion(MIN_CLAUDE_VERSION)!;
  return compareVersions(v, min) >= 0 ? { status: 'ok', version } : { status: 'old', version };
}

export function describeClaudeVersion(c: ClaudeVersionCheck): string {
  switch (c.status) {
    case 'ok':
      return `Claude Code ${c.version} (>= ${MIN_CLAUDE_VERSION})`;
    case 'old':
      return `Claude Code ${c.version} is older than ${MIN_CLAUDE_VERSION}: repository attributes (vcs.*) will not be sent; projects fall back to hook context. Update with "claude update".`;
    case 'missing':
      return `"claude" was not found on PATH. Settings are written anyway; install Claude Code >= ${MIN_CLAUDE_VERSION}.`;
    case 'unknown':
      return `Could not read the Claude Code version (got: ${c.output || 'no output'}). Make sure it is >= ${MIN_CLAUDE_VERSION}.`;
  }
}

export type PingResult = { ok: true; status: number } | { ok: false; error: string };

/** GET {endpoint}/v1/ping with the ingest token (TECHNICAL.md §5). */
export async function ping(endpoint: string, token: string, timeoutMs = 5000): Promise<PingResult> {
  try {
    const res = await fetch(`${endpoint}/v1/ping`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'spendbyteam-cli' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return { ok: true, status: res.status };
    if (res.status === 401 || res.status === 403) return { ok: false, error: `token rejected (HTTP ${res.status})` };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
