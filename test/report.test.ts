import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReport, renderReport } from '../src/report.js';
import { costOf, normalizeModel, priceFor } from '../src/pricing.js';
import { useTempHome } from './helpers.js';

const NOW = new Date('2026-11-18T12:00:00');

interface Line {
  id: string;
  model?: string;
  at?: string;
  cwd?: string;
  branch?: string;
  session?: string;
  usage?: Record<string, unknown>;
  requestId?: string;
}

function assistant(l: Line): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: l.at ?? '2026-11-18T09:00:00Z',
    cwd: l.cwd,
    gitBranch: l.branch ?? 'main',
    sessionId: l.session ?? 's1',
    requestId: l.requestId ?? `req_${l.id}`,
    message: { id: l.id, model: l.model ?? 'claude-opus-5-5', usage: l.usage ?? { input_tokens: 1_000_000, output_tokens: 0 } },
  });
}

function writeLog(home: string, name: string, lines: string[], dir = path.join(home, '.claude', 'projects', 'p')) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), `${lines.join('\n')}\n`);
}

describe('pricing', () => {
  it('normalizes provider and dated model ids', () => {
    expect(normalizeModel('us.anthropic.claude-opus-4-8-v1:0')).toBe('claude-opus-4-8');
    expect(normalizeModel('claude-sonnet-4-5@20250929')).toBe('claude-sonnet-4-5');
    expect(normalizeModel('claude-opus-4-1-20250805')).toBe('claude-opus-4-1');
    expect(normalizeModel('claude-opus-5-5[1m]')).toBe('claude-opus-5-5');
  });

  it('matches the longest model prefix', () => {
    expect(priceFor('claude-opus-5-5')?.input).toBe(4);
    expect(priceFor('claude-opus-5')?.input).toBe(5);
    expect(priceFor('claude-opus-4')?.input).toBe(15);
    expect(priceFor('claude-opus-4-8')?.input).toBe(5);
    expect(priceFor('gpt-9')).toBeUndefined();
  });

  it('prices input, output, cache reads and both cache write durations', () => {
    const cost = costOf('claude-opus-5-5', {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 2_000_000,
      cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 },
    });
    // 4 + 20 + 0.20 + 4 * 1.25 + 4 * 2
    expect(cost).toBeCloseTo(37.2, 6);
  });

  it('treats cache writes without a breakdown as 5-minute writes and uses 0.1x reads by default', () => {
    expect(costOf('claude-sonnet-4-5', { cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 })).toBeCloseTo(3.75 + 0.3, 6);
  });

  it('doubles fast mode and applies the Haiku 5.5 long-prompt rate', () => {
    expect(costOf('claude-opus-5-5', { output_tokens: 1_000_000, speed: 'fast' })).toBeCloseTo(40, 6);
    expect(costOf('claude-haiku-5-5', { input_tokens: 100_000 })).toBeCloseTo(0.01, 6);
    expect(costOf('claude-haiku-5-5', { input_tokens: 200_000 })).toBeCloseTo(0.1, 6);
  });
});

describe('report', () => {
  const ctx = useTempHome();

  it('counts a response logged once per content block only once, using its last usage', async () => {
    writeLog(ctx.home, 'a.jsonl', [
      assistant({ id: 'm1', usage: { input_tokens: 1_000_000, output_tokens: 10 } }),
      assistant({ id: 'm1', usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } }),
      JSON.stringify({ type: 'user', timestamp: '2026-11-18T09:00:00Z', message: { content: 'hi' } }),
      'not json',
    ]);
    const r = await buildReport({ now: NOW });
    expect(r.total.requests).toBe(1);
    expect(r.total.cost).toBeCloseTo(24, 6);
  });

  it('groups sub-folders of one repository as one project and reads subagent logs', async () => {
    const repo = path.join(ctx.home, 'code', 'web');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    writeLog(ctx.home, 'a.jsonl', [assistant({ id: 'm1', cwd: repo }), assistant({ id: 'm2', cwd: path.join(repo, 'src') })]);
    writeLog(ctx.home, 'agent-x.jsonl', [assistant({ id: 'm3', cwd: path.join(ctx.home, 'notes') })], path.join(ctx.home, '.claude', 'projects', 'p', 's1', 'subagents'));
    const r = await buildReport({ now: NOW });
    expect(r.rows.map((x) => [x.key, x.requests])).toEqual([
      ['web', 2],
      ['~/notes', 1],
    ]);
  });

  it('keeps only the requested days, counted in local time, and --all ignores the window', async () => {
    writeLog(ctx.home, 'a.jsonl', [
      assistant({ id: 'old', at: '2026-10-01T09:00:00Z' }),
      assistant({ id: 'new', at: '2026-11-17T09:00:00Z' }),
    ]);
    expect((await buildReport({ now: NOW, days: 7 })).total.requests).toBe(1);
    expect((await buildReport({ now: NOW, all: true })).total.requests).toBe(2);
  });

  it('groups by model, branch and day', async () => {
    writeLog(ctx.home, 'a.jsonl', [
      assistant({ id: 'm1', model: 'claude-opus-5-5', branch: 'main', at: '2026-11-17T09:00:00Z' }),
      assistant({ id: 'm2', model: 'claude-sonnet-5-5', branch: 'feat/x', at: '2026-11-18T09:00:00Z' }),
      assistant({ id: 'm3', model: 'claude-sonnet-5-5', branch: 'HEAD', at: '2026-11-18T10:00:00Z' }),
    ]);
    // Opus: 1 × $4. Sonnet: 2 × $2. Equal cost, so check the totals rather than the order.
    const byModel = (await buildReport({ now: NOW, by: 'model' })).rows.map((x) => [x.key, x.requests, Number(x.cost.toFixed(2))]);
    expect(byModel).toEqual(expect.arrayContaining([['claude-opus-5-5', 1, 4], ['claude-sonnet-5-5', 2, 4]]));
    expect((await buildReport({ now: NOW, by: 'branch' })).rows.map((x) => x.key).sort()).toEqual(['(no branch)', 'feat/x', 'main']);
    expect((await buildReport({ now: NOW, by: 'day' })).rows.map((x) => x.key)).toEqual(['2026-11-17', '2026-11-18']);
  });

  it('groups by session, with start time, project and where the tokens went', async () => {
    const repo = path.join(ctx.home, 'code', 'api');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    writeLog(ctx.home, 'a.jsonl', [
      assistant({ id: 'm1', session: 'big', cwd: repo, at: '2026-11-18T08:00:00Z', usage: { input_tokens: 10, output_tokens: 1000, cache_read_input_tokens: 2_000_000, cache_creation_input_tokens: 500 } }),
      assistant({ id: 'm2', session: 'big', cwd: repo, at: '2026-11-18T08:05:00Z', usage: { input_tokens: 5, output_tokens: 2000, cache_read_input_tokens: 3_000_000 } }),
      assistant({ id: 'm3', session: 'small', cwd: repo, at: '2026-11-18T09:00:00Z', usage: { input_tokens: 100, output_tokens: 10 } }),
    ]);
    const r = await buildReport({ now: NOW, by: 'session' });

    expect(r.rows.map((x) => [x.key, x.requests, x.project])).toEqual([
      ['big', 2, 'api'],
      ['small', 1, 'api'],
    ]);
    expect(r.rows[0]!.split).toEqual({ input: 15, output: 3000, cacheWrite: 500, cacheRead: 5_000_000 });
    expect(r.rows[0]!.startedAt).toBe('2026-11-18T08:00:00.000Z');

    const text = renderReport(r);
    expect(text).toMatch(/Started\s+Project\s+Cost\s+Turns\s+Input\s+Output\s+Cache write\s+Cache read\s+Model/);
    expect(text).toContain('2 sessions');
  });

  it('marks sessions that began before the window and counts only their turns inside it', async () => {
    writeLog(ctx.home, 'a.jsonl', [
      assistant({ id: 'm1', session: 'long', at: '2026-10-01T08:00:00Z' }),
      assistant({ id: 'm2', session: 'long', at: '2026-11-18T08:00:00Z' }),
      assistant({ id: 'm3', session: 'fresh', at: '2026-11-18T09:00:00Z' }),
    ]);
    const r = await buildReport({ now: NOW, days: 7, by: 'session' });
    const long = r.rows.find((x) => x.key === 'long')!;
    const fresh = r.rows.find((x) => x.key === 'fresh')!;

    expect(long.requests).toBe(1);
    expect(long.startedAt).toBe('2026-10-01T08:00:00.000Z');
    expect(long.startedBeforeWindow).toBe(true);
    expect(fresh.startedBeforeWindow).toBe(false);
    const text = renderReport(r);
    expect(text).toContain('≤2026-10-01');
    expect(text).toContain('started before this window');
  });

  it('reports reading progress up to the total', async () => {
    writeLog(ctx.home, 'a.jsonl', [assistant({ id: 'm1' })]);
    const seen: [number, number][] = [];
    await buildReport({ now: NOW, onProgress: (done, total) => seen.push([done, total]) });
    const total = seen.at(-1)![1];
    expect(total).toBeGreaterThan(0);
    expect(seen.at(-1)).toEqual([total, total]);
  });

  it('lists unknown models instead of guessing a price, and skips synthetic messages', async () => {
    writeLog(ctx.home, 'a.jsonl', [assistant({ id: 'm1', model: 'some-other-model' }), assistant({ id: 'm2', model: '<synthetic>' })]);
    const r = await buildReport({ now: NOW });
    expect(r.total.requests).toBe(0);
    expect(r.unpriced).toEqual([{ model: 'some-other-model', requests: 1 }]);
    expect(renderReport(r)).toContain('No priced Claude Code usage');
  });

  it('reads CLAUDE_CONFIG_DIR when set', async () => {
    const custom = path.join(ctx.home, 'cfg');
    writeLog(ctx.home, 'a.jsonl', [assistant({ id: 'm1' })], path.join(custom, 'projects', 'p'));
    process.env.CLAUDE_CONFIG_DIR = custom;
    try {
      expect((await buildReport({ now: NOW })).total.requests).toBe(1);
    } finally {
      delete process.env.CLAUDE_CONFIG_DIR;
    }
  });

  it('says where it looked when there are no logs', async () => {
    const text = renderReport(await buildReport({ now: NOW }));
    expect(text).toContain('No Claude Code session logs found');
  });

  it('renders a table with a total and the team link', async () => {
    writeLog(ctx.home, 'a.jsonl', [assistant({ id: 'm1' })]);
    const text = renderReport(await buildReport({ now: NOW }));
    expect(text).toMatch(/Total\s+\$4\.00/);
    expect(text).toContain('spendbyteam.com');
  });

  it('rejects a bad --days or --by', async () => {
    await expect(buildReport({ now: NOW, days: 0 })).rejects.toThrow('--days');
    await expect(buildReport({ now: NOW, by: 'team' as never })).rejects.toThrow('--by');
  });
});
