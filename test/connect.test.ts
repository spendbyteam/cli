import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { connect, machineLabel, normalizeAppUrl } from '../src/connect.js';
import { silentLogger } from '../src/log.js';
import { fakeClaude, readJson, TOKEN, useTempHome } from './helpers.js';

const START = {
  device_code: 'dev_secret',
  user_code: 'BCDF-GHJK',
  verification_uri: 'https://app.example.test/connect',
  verification_uri_complete: 'https://app.example.test/cli/connect?code=BCDF-GHJK&src=cli',
  expires_in: 600,
  interval: 2,
};

type Reply = { status: number; body?: unknown } | Error;

/** A fake panel: /start answers START, /poll answers the queued replies in order (last one repeats). */
function fakePanel(polls: Reply[], start: Reply = { status: 200, body: START }) {
  const calls: { url: string; body: any }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const reply = url.endsWith('/start') ? start : polls.length > 1 ? polls.shift()! : polls[0]!;
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? 'oops' : JSON.stringify(reply.body), { status: reply.status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const noSleep = async () => {};

describe('connect', () => {
  const ctx = useTempHome();
  const base = { appUrl: 'https://app.example.test', ping: false, logger: silentLogger, sleep: noSleep };

  it('opens the approval page, waits, then installs with the token the panel hands over', async () => {
    fakeClaude(ctx.bin, '2.1.300');
    const opened: string[] = [];
    const panel = fakePanel([
      { status: 200, body: { status: 'pending' } },
      { status: 200, body: { status: 'approved', token: TOKEN, endpoint: 'https://ingest.example.test' } },
    ]);

    await connect({ ...base, fetchImpl: panel.fetchImpl, openBrowser: (u) => opened.push(u) });

    expect(opened).toEqual([START.verification_uri_complete]);
    expect(panel.calls[0]).toMatchObject({ url: 'https://app.example.test/cli/connect/start' });
    expect(typeof panel.calls[0]!.body.client_name).toBe('string');
    expect(panel.calls.slice(1).map((c) => c.body)).toEqual([{ device_code: 'dev_secret' }, { device_code: 'dev_secret' }]);

    const settings = readJson(path.join(ctx.home, '.claude', 'settings.json'));
    expect(settings.env.OTEL_EXPORTER_OTLP_HEADERS).toBe(`Authorization=Bearer ${TOKEN}`);
    expect(settings.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('https://ingest.example.test');
  });

  it('does not open a browser with open: false', async () => {
    const opened: string[] = [];
    const panel = fakePanel([{ status: 200, body: { status: 'approved', token: TOKEN, endpoint: 'https://ingest.example.test' } }]);
    await connect({ ...base, open: false, fetchImpl: panel.fetchImpl, openBrowser: (u) => opened.push(u) });
    expect(opened).toEqual([]);
  });

  it('stops and changes nothing when the person cancels', async () => {
    const panel = fakePanel([{ status: 410, body: { status: 'denied' } }]);
    await expect(connect({ ...base, fetchImpl: panel.fetchImpl, openBrowser: () => {} })).rejects.toThrow('cancelled');
    expect(() => readJson(path.join(ctx.home, '.claude', 'settings.json'))).toThrow();
  });

  it('reports an expired code', async () => {
    const panel = fakePanel([{ status: 410, body: { status: 'expired' } }]);
    await expect(connect({ ...base, fetchImpl: panel.fetchImpl, openBrowser: () => {} })).rejects.toThrow('expired');
  });

  it('rides out a few network errors and rate limits while polling', async () => {
    const panel = fakePanel([
      new Error('ECONNRESET'),
      { status: 429 },
      new Error('ETIMEDOUT'),
      { status: 200, body: { status: 'approved', token: TOKEN, endpoint: 'https://ingest.example.test' } },
    ]);
    await expect(connect({ ...base, fetchImpl: panel.fetchImpl, openBrowser: () => {} })).resolves.toBeDefined();
  });

  it('gives up after repeated network errors', async () => {
    const panel = fakePanel([new Error('ECONNREFUSED')]);
    await expect(connect({ ...base, fetchImpl: panel.fetchImpl, openBrowser: () => {} })).rejects.toThrow('Lost the connection');
  });

  it('explains a failed start', async () => {
    await expect(connect({ ...base, fetchImpl: fakePanel([], { status: 429 }).fetchImpl })).rejects.toThrow('Too many attempts');
    await expect(connect({ ...base, fetchImpl: fakePanel([], new Error('ENOTFOUND')).fetchImpl })).rejects.toThrow('Could not reach');
  });

  it('only talks to https, or http on localhost', () => {
    expect(normalizeAppUrl('https://app.spendbyteam.com/')).toBe('https://app.spendbyteam.com');
    expect(normalizeAppUrl('http://localhost:8000')).toBe('http://localhost:8000');
    expect(() => normalizeAppUrl('http://evil.example.com')).toThrow('https');
  });

  it('names the machine without leaking a LAN address', () => {
    expect(machineLabel('arifs-macbook.local', 'darwin')).toBe('arifs-macbook');
    expect(machineLabel('192.168.1.117', 'darwin')).toBe('Mac');
    expect(machineLabel('fe80::1', 'linux')).toBe('Linux machine');
  });
});
