import { DEFAULT_ENDPOINT, TOKEN_RE } from './constants.js';

export interface EnvOptions {
  token: string;
  endpoint?: string;
  teamId?: string;
}

export function validateToken(token: string | undefined): string {
  if (!token) throw new UsageError('Missing --token (get it from the SpendByTeam panel: sbt_ing_...).');
  const t = token.trim();
  if (!TOKEN_RE.test(t)) {
    throw new UsageError('Invalid token: expected an ingest token like "sbt_ing_..." (letters, digits, "_" or "-").');
  }
  return t;
}

/** Normalises the ingest endpoint. Only https is allowed, except http for localhost (development). */
export function normalizeEndpoint(endpoint: string | undefined): string {
  const raw = (endpoint ?? DEFAULT_ENDPOINT).trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UsageError(`Invalid --endpoint: ${raw}`);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new UsageError('--endpoint must use https:// (http:// is only allowed for localhost).');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new UsageError('--endpoint must not contain credentials, query or fragment.');
  }
  return url.toString().replace(/\/+$/, '');
}

export function validateTeamId(teamId: string | undefined): string | undefined {
  if (teamId === undefined) return undefined;
  const t = teamId.trim();
  // OTEL_RESOURCE_ATTRIBUTES is a comma separated k=v list; keep the value static and simple (§3.3).
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(t)) {
    throw new UsageError('--team-id may only contain letters, digits, ".", "_" or "-" (max 64 chars).');
  }
  return t;
}

/**
 * The OTel env block from TECHNICAL.md §3.1. Metrics only: logs and traces exporters are
 * explicitly "none" and content flags (OTEL_LOG_USER_PROMPTS etc.) are never touched.
 */
export function buildEnv(opts: EnvOptions): Record<string, string> {
  const token = validateToken(opts.token);
  const endpoint = normalizeEndpoint(opts.endpoint);
  const teamId = validateTeamId(opts.teamId);
  const env: Record<string, string> = {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_LOGS_EXPORTER: 'none',
    OTEL_TRACES_EXPORTER: 'none',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
    OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${token}`,
    OTEL_METRICS_INCLUDE_SESSION_ID: 'true',
    OTEL_METRICS_INCLUDE_REPOSITORY: 'true',
    OTEL_METRICS_INCLUDE_VERSION: 'true',
    OTEL_METRIC_EXPORT_INTERVAL: '60000',
  };
  if (teamId) env.OTEL_RESOURCE_ATTRIBUTES = `team.id=${teamId}`;
  return env;
}

/** Keys we may write; used by uninstall/status even when the original state file is gone. */
export const MANAGED_ENV_KEYS = [
  'CLAUDE_CODE_ENABLE_TELEMETRY',
  'OTEL_METRICS_EXPORTER',
  'OTEL_LOGS_EXPORTER',
  'OTEL_TRACES_EXPORTER',
  'OTEL_EXPORTER_OTLP_PROTOCOL',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_METRICS_INCLUDE_SESSION_ID',
  'OTEL_METRICS_INCLUDE_REPOSITORY',
  'OTEL_METRICS_INCLUDE_VERSION',
  'OTEL_METRIC_EXPORT_INTERVAL',
  'OTEL_RESOURCE_ATTRIBUTES',
] as const;

export function maskToken(token: string): string {
  if (token.length <= 12) return 'sbt_ing_****';
  return `sbt_ing_****${token.slice(-4)}`;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}
