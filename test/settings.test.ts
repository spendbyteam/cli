import { describe, expect, it } from 'vitest';
import { buildEnv } from '../src/env.js';
import { hookEntry, inspectSettings, mergeSettings, removeSettings } from '../src/settings.js';
import { TOKEN } from './helpers.js';

const env = buildEnv({ token: TOKEN });

const userSettings = {
  model: 'opus',
  permissions: { allow: ['Bash(npm test)'] },
  env: { MY_VAR: 'keep', OTEL_METRIC_EXPORT_INTERVAL: '10000' },
  hooks: {
    SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo hi' }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard.sh' }] }],
  },
};

describe('mergeSettings', () => {
  it('adds env and hooks without touching other settings', () => {
    const { settings, previousEnv, overwritten } = mergeSettings(userSettings, env);
    const s = settings as any;
    expect(s.model).toBe('opus');
    expect(s.permissions).toEqual(userSettings.permissions);
    expect(s.env.MY_VAR).toBe('keep');
    expect(s.env.OTEL_LOGS_EXPORTER).toBe('none');
    expect(s.hooks.PreToolUse).toEqual(userSettings.hooks.PreToolUse);
    expect(s.hooks.SessionStart).toEqual([userSettings.hooks.SessionStart[0], { hooks: [hookEntry()] }]);
    expect(s.hooks.CwdChanged).toEqual([{ hooks: [hookEntry()] }]);
    expect(previousEnv.OTEL_METRIC_EXPORT_INTERVAL).toBe('10000');
    expect(previousEnv.OTEL_LOGS_EXPORTER).toBeNull();
    expect(overwritten).toEqual(['OTEL_METRIC_EXPORT_INTERVAL']);
  });

  it('does not mutate its input', () => {
    const copy = JSON.parse(JSON.stringify(userSettings));
    mergeSettings(userSettings, env);
    expect(userSettings).toEqual(copy);
  });

  it('is idempotent', () => {
    const once = mergeSettings(userSettings, env).settings;
    const twice = mergeSettings(once, env).settings;
    expect(twice).toEqual(once);
  });

  it('normalises an existing (absolute-path) hook entry and drops duplicates', () => {
    const current = {
      hooks: {
        CwdChanged: [
          { hooks: [{ type: 'command', command: '/home/me/.spendbyteam/hook.sh' }, { type: 'command', command: 'other' }] },
          { hooks: [{ type: 'command', command: '~/.spendbyteam/hook.sh' }] },
        ],
      },
    };
    const s = mergeSettings(current, env).settings as any;
    expect(s.hooks.CwdChanged).toEqual([{ hooks: [hookEntry(), { type: 'command', command: 'other' }] }]);
  });

  it('rejects malformed env/hooks instead of overwriting', () => {
    expect(() => mergeSettings({ env: 'x' }, env)).toThrow();
    expect(() => mergeSettings({ hooks: [] }, env)).toThrow();
    expect(() => mergeSettings({ hooks: { SessionStart: {} } }, env)).toThrow();
  });

  it('drops keys a prior run applied but this run no longer sets', () => {
    const withTeam = buildEnv({ token: TOKEN, teamId: 'mobile' });
    const first = mergeSettings({ env: { OTEL_RESOURCE_ATTRIBUTES: 'service.name=x' } }, withTeam);
    const second = mergeSettings(first.settings, env, { previousEnv: first.previousEnv, appliedEnv: withTeam });
    expect((second.settings as any).env.OTEL_RESOURCE_ATTRIBUTES).toBe('service.name=x');
  });

  it('keeps original previous values across re-runs', () => {
    const first = mergeSettings(userSettings, env);
    const second = mergeSettings(first.settings, env, { previousEnv: first.previousEnv, appliedEnv: env });
    expect(second.previousEnv).toEqual(first.previousEnv);
    expect(second.overwritten).toEqual([]);
  });
});

describe('removeSettings', () => {
  it('restores the exact original settings', () => {
    const { settings, previousEnv } = mergeSettings(userSettings, env);
    expect(removeSettings(settings, { previousEnv, appliedEnv: env })).toEqual(userSettings);
  });

  it('removes empty env/hooks objects it created', () => {
    const { settings, previousEnv } = mergeSettings({}, env);
    expect(removeSettings(settings, { previousEnv, appliedEnv: env })).toEqual({});
  });

  it('keeps values the user changed after install', () => {
    const { settings, previousEnv } = mergeSettings({}, env);
    (settings as any).env.OTEL_METRIC_EXPORT_INTERVAL = '5000';
    const out = removeSettings(settings, { previousEnv, appliedEnv: env }) as any;
    expect(out.env).toEqual({ OTEL_METRIC_EXPORT_INTERVAL: '5000' });
  });

  it('without state, only strips env when it carries a SpendByTeam token', () => {
    const { settings } = mergeSettings({ env: { A: '1' } }, env);
    expect(removeSettings(settings)).toEqual({ env: { A: '1' } });

    const foreign = { env: { OTEL_EXPORTER_OTLP_HEADERS: 'x-api-key=abc', OTEL_METRICS_EXPORTER: 'otlp' } };
    expect(removeSettings(foreign)).toEqual(foreign);
  });
});

describe('inspectSettings', () => {
  it('reports env and hook presence', () => {
    const { settings } = mergeSettings({}, env);
    expect(inspectSettings(settings, env)).toEqual({
      envMatches: true,
      mismatchedKeys: [],
      hookEvents: { SessionStart: true, CwdChanged: true },
    });
    const r = inspectSettings({ env: { ...env, OTEL_LOGS_EXPORTER: 'otlp' } }, env);
    expect(r.envMatches).toBe(false);
    expect(r.mismatchedKeys).toEqual(['OTEL_LOGS_EXPORTER']);
    expect(r.hookEvents).toEqual({ SessionStart: false, CwdChanged: false });
  });
});
