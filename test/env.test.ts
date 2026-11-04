import { describe, expect, it } from 'vitest';
import { buildEnv, maskToken, normalizeEndpoint, UsageError, validateToken } from '../src/env.js';
import { managedSettings, managedSettingsJson } from '../src/managed.js';
import { TOKEN } from './helpers.js';

describe('buildEnv', () => {
  it('produces exactly the §3.1 env block', () => {
    expect(buildEnv({ token: TOKEN })).toEqual({
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_LOGS_EXPORTER: 'none',
      OTEL_TRACES_EXPORTER: 'none',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://ingest.spendbyteam.com',
      OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${TOKEN}`,
      OTEL_METRICS_INCLUDE_SESSION_ID: 'true',
      OTEL_METRICS_INCLUDE_REPOSITORY: 'true',
      OTEL_METRICS_INCLUDE_VERSION: 'true',
      OTEL_METRIC_EXPORT_INTERVAL: '60000',
    });
  });

  it('never enables content flags', () => {
    const env = buildEnv({ token: TOKEN, teamId: 'mobile' });
    for (const k of ['OTEL_LOG_USER_PROMPTS', 'OTEL_LOG_TOOL_DETAILS', 'OTEL_LOG_RAW_API_BODIES']) {
      expect(env).not.toHaveProperty(k);
    }
  });

  it('adds a static team id', () => {
    expect(buildEnv({ token: TOKEN, teamId: 'mobile' }).OTEL_RESOURCE_ATTRIBUTES).toBe('team.id=mobile');
    expect(() => buildEnv({ token: TOKEN, teamId: '$(whoami)' })).toThrow(UsageError);
    expect(() => buildEnv({ token: TOKEN, teamId: 'a,b=c' })).toThrow(UsageError);
  });
});

describe('validation', () => {
  it('rejects bad tokens', () => {
    expect(() => validateToken('')).toThrow(UsageError);
    expect(() => validateToken('sk-ant-123')).toThrow(UsageError);
  });

  it('enforces token shape', () => {
    expect(() => validateToken('sbt_ing_abc')).toThrow(UsageError);
    expect(() => validateToken('sbt_ing_abc def ghij')).toThrow(UsageError);
    expect(validateToken(`  ${TOKEN}\n`)).toBe(TOKEN);
  });

  it('normalises endpoints', () => {
    expect(normalizeEndpoint(undefined)).toBe('https://ingest.spendbyteam.com');
    expect(normalizeEndpoint('https://eu.example.com/')).toBe('https://eu.example.com');
    expect(normalizeEndpoint('http://localhost:4318')).toBe('http://localhost:4318');
    expect(() => normalizeEndpoint('http://ingest.example.com')).toThrow(UsageError);
    expect(() => normalizeEndpoint('https://u:p@example.com')).toThrow(UsageError);
    expect(() => normalizeEndpoint('not a url')).toThrow(UsageError);
  });

  it('masks tokens', () => {
    expect(maskToken(TOKEN)).toBe('sbt_ing_****2345');
    expect(maskToken(TOKEN)).not.toContain('abcdef');
  });
});

describe('print-managed', () => {
  it('outputs valid managed settings JSON', () => {
    const json = managedSettingsJson({ token: TOKEN, endpoint: 'https://ingest.example.eu' });
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(managedSettings({ token: TOKEN, endpoint: 'https://ingest.example.eu' }));
    expect(Object.keys(parsed)).toEqual(['env']);
    expect(parsed.env.OTEL_LOGS_EXPORTER).toBe('none');
    expect(parsed.env.OTEL_TRACES_EXPORTER).toBe('none');
    expect(parsed.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('https://ingest.example.eu');
  });

  it('requires a token', () => {
    expect(() => managedSettingsJson({ token: '' })).toThrow(UsageError);
  });
});
