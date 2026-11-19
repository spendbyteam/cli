import fs from 'node:fs';
import path from 'node:path';
import { homeDir } from './paths.js';
import { costOf, normalizeModel, type Usage } from './pricing.js';
import { UsageError } from './env.js';

/**
 * `spendbyteam report`: reads the Claude Code session logs on this machine and prints what that
 * usage costs at API list prices, per project, model, branch or day. Runs fully offline: nothing
 * is sent anywhere and no account or token is needed.
 */

export type GroupBy = 'project' | 'model' | 'branch' | 'day' | 'session';
export const GROUPS: GroupBy[] = ['project', 'model', 'branch', 'day', 'session'];

export interface ReportOptions {
  days?: number;
  all?: boolean;
  by?: GroupBy;
  json?: boolean;
  dirs?: string[];
  now?: Date;
  /** Called while reading, with bytes read so far and the total (for a progress line). */
  onProgress?: (done: number, total: number) => void;
}

/** Where the tokens went: fresh input, output, cache writes (5m + 1h) and cache reads. */
export interface TokenSplit {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

const emptySplit = (): TokenSplit => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });

interface Request {
  model: string;
  cost: number | undefined;
  tokens: number;
  split: TokenSplit;
  session: string;
  project: string;
  branch: string;
  day: string;
  at: number;
}

export interface Row {
  key: string;
  cost: number;
  share: number;
  requests: number;
  sessions: number;
  tokens: number;
  split: TokenSplit;
  topModel: string;
  /** --by=session: when the session started (ISO) and its project. */
  startedAt?: string;
  /** --by=session: the session began before the report window; only its turns inside it are counted. */
  startedBeforeWindow?: boolean;
  project?: string;
}

export interface Report {
  from: string | null;
  to: string;
  by: GroupBy;
  rows: Row[];
  total: { cost: number; requests: number; sessions: number; tokens: number };
  unpriced: { model: string; requests: number }[];
  files: number;
  /** How long Claude Code keeps these logs before deleting them, and the oldest log still on disk. */
  retention: Retention;
}

export interface Retention {
  days: number;
  source: 'default' | 'settings' | 'managed';
  oldestLog: string | null;
}

/** Claude Code's documented default for cleanupPeriodDays. */
export const DEFAULT_CLEANUP_DAYS = 30;

function readCleanupDays(file: string): number | undefined {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'))?.cleanupPeriodDays;
    return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Managed settings win over user settings; without either, Claude Code uses 30 days. */
export function cleanupPeriod(env: NodeJS.ProcessEnv = process.env, platform = process.platform): { days: number; source: Retention['source'] } {
  const managed =
    env.SPENDBYTEAM_MANAGED_SETTINGS ??
    (platform === 'darwin'
      ? '/Library/Application Support/ClaudeCode/managed-settings.json'
      : platform === 'win32'
        ? 'C:\\Program Files\\ClaudeCode\\managed-settings.json'
        : '/etc/claude-code/managed-settings.json');
  const m = readCleanupDays(managed);
  if (m !== undefined) return { days: m, source: 'managed' };
  const configured = env.CLAUDE_CONFIG_DIR?.split(',').map((d) => d.trim()).filter(Boolean);
  const bases = configured?.length ? configured : [path.join(homeDir(), '.claude')];
  for (const b of bases) {
    const u = readCleanupDays(path.join(b, 'settings.json'));
    if (u !== undefined) return { days: u, source: 'settings' };
  }
  return { days: DEFAULT_CLEANUP_DAYS, source: 'default' };
}

/** Where Claude Code keeps its session logs: $CLAUDE_CONFIG_DIR (comma-separated), else ~/.claude and ~/.config/claude. */
export function logDirs(): string[] {
  const configured = process.env.CLAUDE_CONFIG_DIR?.split(',').map((d) => d.trim()).filter(Boolean);
  const bases = configured?.length ? configured : [path.join(homeDir(), '.claude'), path.join(homeDir(), '.config', 'claude')];
  return bases.map((b) => path.join(b, 'projects')).filter((d) => fs.existsSync(d));
}

function jsonlFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) jsonlFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

/** Maps a working directory to its repository root's name, so sub-folders of one repo count as one project. */
function projectResolver() {
  const cache = new Map<string, string>();
  const home = homeDir();
  return (cwd: string | undefined): string => {
    if (!cwd) return '(unknown)';
    const hit = cache.get(cwd);
    if (hit) return hit;
    let label: string | undefined;
    for (let dir = cwd; ; dir = path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, '.git'))) {
        label = path.basename(dir);
        break;
      }
      if (dir === home || path.dirname(dir) === dir) break;
    }
    label ??= cwd === home ? '~ (no repo)' : cwd.startsWith(`${home}${path.sep}`) ? `~${cwd.slice(home.length)}` : cwd;
    cache.set(cwd, label);
    return label;
  };
}

function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const ASSISTANT = Buffer.from('"type":"assistant"');
const USAGE = Buffer.from('"usage"');

/**
 * Yields only the lines that can carry an API response's usage. Logs run to gigabytes, mostly tool
 * output, so lines are filtered as bytes and only the matches are decoded: decoding every line was
 * four times slower than reading the files.
 */
async function* usageLines(file: string): AsyncGenerator<string> {
  let parts: Buffer[] = [];
  const emit = (line: Buffer) => (line.indexOf(ASSISTANT) !== -1 && line.indexOf(USAGE) !== -1 ? line.toString('utf8') : undefined);
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 20 }) as AsyncIterable<Buffer>) {
    let start = 0;
    for (let nl = chunk.indexOf(10); nl !== -1; nl = chunk.indexOf(10, start)) {
      const piece = chunk.subarray(start, nl);
      const line = parts.length ? Buffer.concat([...parts, piece]) : piece;
      parts = [];
      start = nl + 1;
      const text = emit(line);
      if (text !== undefined) yield text;
    }
    if (start < chunk.length) parts.push(chunk.subarray(start));
  }
  if (parts.length) {
    const text = emit(Buffer.concat(parts));
    if (text !== undefined) yield text;
  }
}

async function readRequests(
  files: string[],
  since: number | null,
  onProgress?: (done: number, total: number) => void,
): Promise<{ requests: Map<string, Request>; sessionStart: Map<string, number> }> {
  const requests = new Map<string, Request>();
  // Earliest turn seen per session, inside the window or not, to tell when a session really began.
  const sessionStart = new Map<string, number>();
  const project = projectResolver();
  const todo = files.map((file) => ({ file, stat: fs.statSync(file) })).filter(({ stat }) => since === null || stat.mtimeMs >= since);
  const totalBytes = todo.reduce((n, f) => n + f.stat.size, 0);
  let doneBytes = 0;
  for (const { file, stat } of todo) {
    onProgress?.(doneBytes, totalBytes);
    doneBytes += stat.size;
    for await (const line of usageLines(file)) {
      let row: any;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      const message = row?.message;
      const usage: Usage | undefined = message?.usage;
      const model: unknown = message?.model;
      if (row?.type !== 'assistant' || !usage || typeof model !== 'string' || model === '<synthetic>') continue;
      const at = Date.parse(row.timestamp);
      if (Number.isNaN(at)) continue;
      const sessionId: string = row.sessionId ?? file;
      if (at < (sessionStart.get(sessionId) ?? Infinity)) sessionStart.set(sessionId, at);
      if (since !== null && at < since) continue;
      // One API response is logged once per content block; the last copy carries the final usage.
      const key = `${message.id ?? row.uuid}:${row.requestId ?? ''}`;
      requests.set(key, {
        model: normalizeModel(model),
        cost: costOf(model, usage),
        tokens:
          (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
        split: {
          input: usage.input_tokens ?? 0,
          output: usage.output_tokens ?? 0,
          cacheWrite: usage.cache_creation_input_tokens ?? 0,
          cacheRead: usage.cache_read_input_tokens ?? 0,
        },
        session: sessionId,
        project: project(row.cwd),
        branch: row.gitBranch && row.gitBranch !== 'HEAD' ? row.gitBranch : '(no branch)',
        day: localDay(at),
        at,
      });
    }
  }
  onProgress?.(totalBytes, totalBytes);
  return { requests, sessionStart };
}

export async function buildReport(opts: ReportOptions = {}): Promise<Report> {
  const now = opts.now ?? new Date();
  const days = opts.days ?? 30;
  if (!opts.all && (!Number.isInteger(days) || days < 1)) throw new UsageError('--days must be a whole number of 1 or more.');
  const by = opts.by ?? 'project';
  if (!GROUPS.includes(by)) throw new UsageError(`--by must be one of: ${GROUPS.join(', ')}.`);

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const since = opts.all ? null : start.getTime();

  const dirs = opts.dirs ?? logDirs();
  const files = dirs.flatMap((d) => jsonlFiles(d));
  const { requests, sessionStart } = await readRequests(files, since, opts.onProgress);
  let oldestMs = Infinity;
  for (const f of files) oldestMs = Math.min(oldestMs, fs.statSync(f).mtimeMs);

  const groups = new Map<
    string,
    { cost: number; requests: number; sessions: Set<string>; tokens: number; split: TokenSplit; models: Map<string, number>; first: number; projects: Map<string, number> }
  >();
  const unpriced = new Map<string, number>();
  const sessions = new Set<string>();
  let total = 0;
  let tokens = 0;
  let first = Infinity;
  for (const r of requests.values()) {
    if (r.cost === undefined) {
      unpriced.set(r.model, (unpriced.get(r.model) ?? 0) + 1);
      continue;
    }
    const key = by === 'model' ? r.model : r[by];
    const g = groups.get(key) ?? {
      cost: 0,
      requests: 0,
      sessions: new Set<string>(),
      tokens: 0,
      split: emptySplit(),
      models: new Map<string, number>(),
      first: Infinity,
      projects: new Map<string, number>(),
    };
    g.cost += r.cost;
    g.requests += 1;
    g.sessions.add(r.session);
    g.tokens += r.tokens;
    g.split.input += r.split.input;
    g.split.output += r.split.output;
    g.split.cacheWrite += r.split.cacheWrite;
    g.split.cacheRead += r.split.cacheRead;
    g.first = Math.min(g.first, r.at);
    g.projects.set(r.project, (g.projects.get(r.project) ?? 0) + r.cost);
    g.models.set(r.model, (g.models.get(r.model) ?? 0) + r.cost);
    groups.set(key, g);
    sessions.add(r.session);
    total += r.cost;
    tokens += r.tokens;
    first = Math.min(first, r.at);
  }

  const rows: Row[] = [...groups.entries()]
    .map(([key, g]) => ({
      key,
      cost: g.cost,
      share: total > 0 ? g.cost / total : 0,
      requests: g.requests,
      sessions: g.sessions.size,
      tokens: g.tokens,
      split: g.split,
      topModel: [...g.models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '',
      ...(by === 'session'
        ? {
            startedAt: new Date(sessionStart.get(key) ?? g.first).toISOString(),
            startedBeforeWindow: since !== null && (sessionStart.get(key) ?? g.first) < since,
            project: [...g.projects.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '',
          }
        : {}),
    }))
    .sort((a, b) => (by === 'day' ? a.key.localeCompare(b.key) : b.cost - a.cost));

  return {
    from: since !== null ? localDay(since) : Number.isFinite(first) ? localDay(first) : null,
    to: localDay(now.getTime()),
    by,
    rows,
    total: { cost: total, requests: [...groups.values()].reduce((n, g) => n + g.requests, 0), sessions: sessions.size, tokens },
    unpriced: [...unpriced.entries()].map(([model, n]) => ({ model, requests: n })).sort((a, b) => b.requests - a.requests),
    files: files.length,
    retention: { ...cleanupPeriod(), oldestLog: Number.isFinite(oldestMs) ? localDay(oldestMs) : null },
  };
}

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const compact = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);
const shortModel = (m: string) => m.replace(/^claude-/, '');

const style = (code: string) => (s: string) => (process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = style('1');
const dim = style('2');

const HEADINGS: Record<GroupBy, string> = { project: 'Project', model: 'Model', branch: 'Branch', day: 'Day', session: 'Session' };
const MAX_ROWS = 15;
export const CTA_URL = 'https://spendbyteam.com/?utm_source=cli&utm_medium=report';

export function renderReport(r: Report): string {
  const out: string[] = [];
  const range = r.from ? `${r.from} → ${r.to}` : 'no usage found';
  out.push(`${bold('Claude Code spend on this machine')}  ${dim(range)}`);
  out.push(dim('At API list prices. On a Pro, Max or Team seat you pay a flat fee; this is what the same tokens cost on the API.'));
  out.push('');

  if (r.rows.length === 0) {
    out.push(
      r.files === 0
        ? 'No Claude Code session logs found (looked in ~/.claude/projects and ~/.config/claude/projects; set CLAUDE_CONFIG_DIR if yours live elsewhere).'
        : 'No priced Claude Code usage in this period. Try --days=90 or --all.',
    );
    return out.join('\n');
  }

  if (r.by === 'session') return renderSessions(r, out);

  const shown = r.rows.slice(0, MAX_ROWS);
  const rest = r.rows.slice(MAX_ROWS);
  const showModel = r.by !== 'model';
  const header = [HEADINGS[r.by], 'Cost', 'Share', 'Sessions', 'Tokens', ...(showModel ? ['Top model'] : [])];
  const body = shown.map((row) => [
    row.key,
    usd(row.cost),
    `${Math.round(row.share * 100)}%`,
    String(row.sessions),
    compact(row.tokens),
    ...(showModel ? [shortModel(row.topModel)] : []),
  ]);
  if (rest.length) {
    const cost = rest.reduce((n, x) => n + x.cost, 0);
    body.push([`… ${rest.length} more`, usd(cost), `${Math.round((cost / r.total.cost) * 100)}%`, '', compact(rest.reduce((n, x) => n + x.tokens, 0)), ...(showModel ? [''] : [])]);
  }
  const totalRow = ['Total', usd(r.total.cost), '', String(r.total.sessions), compact(r.total.tokens), ...(showModel ? [''] : [])];
  const table = [header, ...body, totalRow];
  const firstWidth = Math.min(36, Math.max(...table.map((t) => t[0]!.length)));
  const widths = header.map((_, i) => (i === 0 ? firstWidth : Math.max(...table.map((t) => t[i]!.length))));
  const fmt = (cells: string[]) =>
    cells
      .map((c, i) => {
        const cell = i === 0 && c.length > firstWidth ? `${c.slice(0, firstWidth - 1)}…` : c;
        return i === 0 || (showModel && i === cells.length - 1) ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!);
      })
      .join('  ')
      .trimEnd();

  out.push(bold(fmt(header)));
  for (const cells of body) out.push(fmt(cells));
  out.push(dim('─'.repeat(widths.reduce((n, w) => n + w + 2, -2))));
  out.push(bold(fmt(totalRow)));

  return finish(r, out);
}

/** Claude Code deletes session logs after cleanupPeriodDays (30 by default); say so, since this report can't see past it. */
export function retentionNote(t: Retention): string[] {
  if (t.days > 90) return [];
  const since = t.oldestLog ? `, so the oldest log left on this machine is from ${t.oldestLog}` : '';
  const why = t.source === 'default' ? 'by default' : t.source === 'managed' ? 'set by your organization' : 'set in your settings.json';
  const lines = ['', `${bold('Heads-up:')} Claude Code deletes these logs after ${t.days} days (${why})${since}.`];
  if (t.source !== 'managed') lines.push(dim(`To keep them, add "cleanupPeriodDays": 3650 to ~/.claude/settings.json.`));
  return lines;
}

function finish(r: Report, out: string[]): string {
  if (r.unpriced.length) {
    out.push('');
    out.push(dim(`Not priced (unknown model): ${r.unpriced.map((u) => `${u.model} × ${u.requests}`).join(', ')}`));
  }
  out.push(...retentionNote(r.retention));
  out.push('');
  out.push(`This is one machine. To see it for your whole team, per project and client, with up to 13 months of history:`);
  out.push(`  ${bold('npx spendbyteam connect')}   ${dim(`(free for 3 developers · ${CTA_URL})`)}`);
  return out.join('\n');
}

function localDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** --by=session: the most expensive sessions, with where their tokens went. */
function renderSessions(r: Report, out: string[]): string {
  const shown = r.rows.slice(0, MAX_ROWS);
  const header = [' Started', 'Project', 'Cost', 'Turns', 'Input', 'Output', 'Cache write', 'Cache read', 'Model'];
  const body = shown.map((row) => [
    `${row.startedBeforeWindow ? '≤' : ' '}${localDateTime(row.startedAt!)}`,
    row.project ?? '',
    usd(row.cost),
    String(row.requests),
    compact(row.split.input),
    compact(row.split.output),
    compact(row.split.cacheWrite),
    compact(row.split.cacheRead),
    shortModel(row.topModel),
  ]);
  const left = new Set([0, 1, 8]);
  const projectWidth = Math.min(28, Math.max(...[header, ...body].map((t) => t[1]!.length)));
  const widths = header.map((_, i) => (i === 1 ? projectWidth : Math.max(...[header, ...body].map((t) => t[i]!.length))));
  const fmt = (cells: string[]) =>
    cells
      .map((c, i) => {
        const cell = i === 1 && c.length > projectWidth ? `${c.slice(0, projectWidth - 1)}…` : c;
        return left.has(i) ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!);
      })
      .join('  ')
      .trimEnd();

  out.push(bold(fmt(header)));
  for (const cells of body) out.push(fmt(cells));
  out.push(dim('─'.repeat(widths.reduce((n, w) => n + w + 2, -2))));
  const rest = r.rows.length - shown.length;
  out.push(`${bold(`${r.rows.length} sessions, ${usd(r.total.cost)}`)}${rest > 0 ? dim(`  (top ${shown.length} shown; --json for all)`) : ''}`);
  if (shown.some((row) => row.startedBeforeWindow)) out.push(dim('≤ started before this window; only its turns inside the window are counted.'));
  out.push(dim('Long sessions re-read their whole context every turn; /clear resets it.'));
  return finish(r, out);
}

/** A "Reading logs… 42%" line on stderr while reading, only on a terminal and never with --json. */
function progressLine(): { onProgress?: ReportOptions['onProgress']; clear: () => void } {
  if (!process.stderr.isTTY) return { clear: () => {} };
  let shown = false;
  let last = -1;
  return {
    onProgress: (done, total) => {
      if (total < 50_000_000) return; // small log folders finish before a line is worth showing
      const pct = Math.floor((done / total) * 100);
      if (pct === last) return;
      last = pct;
      shown = true;
      process.stderr.write(`\r\x1b[2KReading ${(total / 1e9).toFixed(1)} GB of Claude Code logs… ${pct}%`);
    },
    clear: () => {
      if (shown) process.stderr.write('\r\x1b[2K');
    },
  };
}

export async function report(opts: ReportOptions = {}): Promise<Report> {
  const progress = progressLine();
  let r: Report;
  try {
    r = await buildReport({ onProgress: progress.onProgress, ...opts });
  } finally {
    progress.clear();
  }
  console.log(opts.json ? JSON.stringify(r, null, 2) : renderReport(r));
  return r;
}
