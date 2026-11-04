import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { init } from '../src/init.js';
import { uninstall } from '../src/uninstall.js';
import { collectStatus } from '../src/status.js';
import { runDoctor } from '../src/doctor.js';
import { silentLogger } from '../src/log.js';
import { bundledHookPath } from '../src/paths.js';
import { fakeBin, fakeClaude, mode, readJson, TOKEN, useTempHome, writeJson } from './helpers.js';

const ctx = useTempHome();
const settingsFile = () => path.join(ctx.home, '.claude', 'settings.json');
const sbt = (f: string) => path.join(ctx.home, '.spendbyteam', f);
const run = (extra: Partial<Parameters<typeof init>[0]> = {}) =>
  init({ token: TOKEN, ping: false, logger: silentLogger, ...extra });

describe('init', () => {
  it('creates settings, config (600) and hook on a clean machine', async () => {
    fakeClaude(ctx.bin, '2.1.300');
    const r = await run();
    expect(r.settingsChanged).toBe(true);
    expect(r.backupPath).toBeUndefined(); // nothing to back up
    const s = readJson(settingsFile());
    expect(s.env.OTEL_EXPORTER_OTLP_HEADERS).toBe(`Authorization=Bearer ${TOKEN}`);
    expect(s.hooks.SessionStart[0].hooks[0]).toEqual({
      type: 'command', command: '~/.spendbyteam/hook.sh', async: true, timeout: 10,
    });
    expect(mode(settingsFile())).toBe(0o600);

    expect(readJson(sbt('config.json'))).toEqual({ token: TOKEN, endpoint: 'https://ingest.spendbyteam.com' });
    expect(mode(sbt('config.json'))).toBe(0o600);
    expect(mode(path.join(ctx.home, '.spendbyteam'))).toBe(0o700);
    expect(mode(sbt('state.json'))).toBe(0o600);

    expect(fs.readFileSync(sbt('hook.sh'), 'utf8')).toBe(fs.readFileSync(bundledHookPath(), 'utf8'));
    expect(mode(sbt('hook.sh'))).toBe(0o755);
  });

  it('backs up existing settings before merging and keeps user keys', async () => {
    const original = { model: 'sonnet', env: { FOO: 'bar' }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] } };
    writeJson(settingsFile(), original);
    const before = fs.readFileSync(settingsFile(), 'utf8');
    const r = await run();
    expect(r.backupPath).toBe(`${settingsFile()}.bak`);
    expect(fs.readFileSync(`${settingsFile()}.bak`, 'utf8')).toBe(before);
    const s = readJson(settingsFile());
    expect(s.model).toBe('sonnet');
    expect(s.env.FOO).toBe('bar');
    expect(s.hooks.Stop).toEqual(original.hooks.Stop);
  });

  it('is idempotent: a second run changes nothing and does not overwrite the backup', async () => {
    writeJson(settingsFile(), { model: 'sonnet' });
    await run();
    const afterFirst = fs.readFileSync(settingsFile(), 'utf8');
    const bakFirst = fs.readFileSync(`${settingsFile()}.bak`, 'utf8');
    const r = await run();
    expect(r.settingsChanged).toBe(false);
    expect(fs.readFileSync(settingsFile(), 'utf8')).toBe(afterFirst);
    expect(fs.readFileSync(`${settingsFile()}.bak`, 'utf8')).toBe(bakFirst);
    const s = readJson(settingsFile());
    expect(s.hooks.SessionStart).toHaveLength(1);
    expect(s.hooks.CwdChanged).toHaveLength(1);
  });

  it('re-run with a new token updates settings and config', async () => {
    await run();
    const other = 'sbt_ing_ZYXWVUTSRQPONMLKJIHGFEDCBA987654';
    await run({ token: other, endpoint: 'https://eu.ingest.example.com' });
    expect(readJson(settingsFile()).env.OTEL_EXPORTER_OTLP_HEADERS).toBe(`Authorization=Bearer ${other}`);
    expect(readJson(sbt('config.json'))).toEqual({ token: other, endpoint: 'https://eu.ingest.example.com' });
  });

  it('refuses to touch invalid settings.json', async () => {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), '{ "model": "opus", ');
    await expect(run()).rejects.toThrow(/not valid JSON/);
    expect(fs.readFileSync(settingsFile(), 'utf8')).toBe('{ "model": "opus", ');
    expect(fs.existsSync(sbt('config.json'))).toBe(false);
  });

  it('tightens permissions of an existing world-readable config', async () => {
    fs.mkdirSync(path.join(ctx.home, '.spendbyteam'), { recursive: true });
    fs.writeFileSync(sbt('config.json'), '{}', { mode: 0o644 });
    await run();
    expect(mode(sbt('config.json'))).toBe(0o600);
  });

  it('warns about old Claude Code and missing deps but still installs', async () => {
    fakeClaude(ctx.bin, '2.1.100');
    fakeBin(ctx.bin, 'git');
    const warnings: string[] = [];
    const r = await init({ token: TOKEN, ping: false, logger: { ...silentLogger, warn: (m) => warnings.push(m) } });
    expect(r.claude).toEqual({ status: 'old', version: '2.1.100' });
    expect(r.missingDeps).toEqual(['jq', 'curl']);
    expect(warnings.join('\n')).toMatch(/older than 2\.1\.269/);
    expect(warnings.join('\n')).toMatch(/Missing jq, curl/);
    expect(fs.existsSync(sbt('hook.sh'))).toBe(true);
  });
});

describe('uninstall', () => {
  it('restores the original settings exactly and removes ~/.spendbyteam', async () => {
    const original = { env: { OTEL_METRIC_EXPORT_INTERVAL: '5000', A: 'b' }, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'mine' }] }] } };
    writeJson(settingsFile(), original);
    await run();
    await run(); // idempotent re-run must not lose the original values
    const r = uninstall({ logger: silentLogger });
    expect(r.settingsChanged).toBe(true);
    expect(readJson(settingsFile())).toEqual(original);
    expect(fs.existsSync(path.join(ctx.home, '.spendbyteam'))).toBe(false);
  });

  it('leaves an empty object when settings did not exist before', async () => {
    await run();
    uninstall({ logger: silentLogger });
    expect(readJson(settingsFile())).toEqual({});
  });

  it('is safe to run when nothing is installed', () => {
    const r = uninstall({ logger: silentLogger });
    expect(r).toEqual({ settingsChanged: false, backupPath: undefined, removedDir: false });
    expect(fs.existsSync(settingsFile())).toBe(false);
  });
});

describe('status / doctor', () => {
  let server: http.Server;
  let endpoint = '';
  const seen: { url?: string; auth?: string }[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen.push({ url: req.url, auth: req.headers.authorization });
      const ok = req.url === '/v1/ping' && req.headers.authorization === `Bearer ${TOKEN}`;
      res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' }).end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('status reports not installed, then installed', async () => {
    expect(collectStatus().installed).toBe(false);
    await run({ teamId: 'mobile' });
    const s = collectStatus();
    expect(s.installed).toBe(true);
    expect(s.configMode).toBe(0o600);
  });

  it('status detects a removed hook', async () => {
    await run();
    const s = readJson(settingsFile());
    delete s.hooks.CwdChanged;
    writeJson(settingsFile(), s);
    const r = collectStatus();
    expect(r.installed).toBe(false);
    expect(r.inspection?.hookEvents).toEqual({ SessionStart: true, CwdChanged: false });
  });

  it('init pings the endpoint with the token', async () => {
    const r = await init({ token: TOKEN, endpoint: endpoint.replace('127.0.0.1', 'localhost'), logger: silentLogger });
    expect(r.ping).toEqual({ ok: true, status: 200 });
    expect(seen.at(-1)).toEqual({ url: '/v1/ping', auth: `Bearer ${TOKEN}` });
  });

  it('doctor passes on a healthy install and flags problems', async () => {
    for (const b of ['jq', 'git', 'curl']) fakeBin(ctx.bin, b);
    fakeClaude(ctx.bin, '2.1.269');
    await run({ endpoint: endpoint.replace('127.0.0.1', 'localhost') });
    let checks = await runDoctor();
    expect(checks.filter((c) => c.level !== 'ok')).toEqual([]);

    fs.chmodSync(sbt('config.json'), 0o644);
    fs.chmodSync(sbt('hook.sh'), 0o644);
    checks = await runDoctor({ ping: false });
    expect(checks.filter((c) => c.level === 'fail').map((c) => c.name)).toEqual(['config mode', 'hook.sh']);
  });

  it('doctor reports a rejected token', async () => {
    await run({ token: 'sbt_ing_wrongwrongwrongwrong', endpoint: endpoint.replace('127.0.0.1', 'localhost') });
    const ingest = (await runDoctor()).find((c) => c.name === 'ingest');
    expect(ingest?.level).toBe('fail');
    expect(ingest?.detail).toMatch(/token rejected/);
  });

  it('doctor fails on invalid settings.json', async () => {
    await run();
    fs.writeFileSync(settingsFile(), 'nope');
    const checks = await runDoctor({ ping: false });
    expect(checks.find((c) => c.name === 'settings')?.level).toBe('fail');
  });
});
