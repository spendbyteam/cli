import { HOOK_COMMAND, HOOK_COMMAND_RE, HOOK_EVENTS, HOOK_TIMEOUT_SECONDS } from './constants.js';
import { MANAGED_ENV_KEYS } from './env.js';
import { isPlainObject, JsonFileError } from './fsutil.js';

export type Settings = Record<string, unknown>;

/** Value a key had before we touched it; null means "did not exist". */
export type PreviousEnv = Record<string, string | null>;

export function hookEntry() {
  return { type: 'command', command: HOOK_COMMAND, async: true, timeout: HOOK_TIMEOUT_SECONDS };
}

function isOurHook(h: unknown): boolean {
  return isPlainObject(h) && typeof h.command === 'string' && HOOK_COMMAND_RE.test(h.command.trim());
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function envOf(settings: Settings, file = 'settings.json'): Record<string, unknown> {
  if (settings.env === undefined) return {};
  if (!isPlainObject(settings.env)) throw new JsonFileError(`"env" in ${file} must be an object.`);
  return settings.env;
}

function hooksOf(settings: Settings, file = 'settings.json'): Record<string, unknown> {
  if (settings.hooks === undefined) return {};
  if (!isPlainObject(settings.hooks)) throw new JsonFileError(`"hooks" in ${file} must be an object.`);
  return settings.hooks;
}

export interface MergeResult {
  settings: Settings;
  /** Values of our env keys before the merge (null = absent). */
  previousEnv: PreviousEnv;
  /** Keys that existed with a different value and were overwritten. */
  overwritten: string[];
}

export interface PriorInstall {
  previousEnv: PreviousEnv;
  appliedEnv: Record<string, string>;
}

/**
 * Merge our env block and hooks into existing settings without touching anything else.
 * Idempotent: merging twice yields identical output. `prior` (from state.json) makes re-runs keep the
 * original pre-install values and drops keys a previous run applied but this run no longer wants.
 */
export function mergeSettings(current: Settings, env: Record<string, string>, prior?: PriorInstall): MergeResult {
  const next = clone(current);
  const curEnv = { ...envOf(next) };
  const previousEnv: PreviousEnv = {};
  const overwritten: string[] = [];

  if (prior) {
    for (const [key, applied] of Object.entries(prior.appliedEnv)) {
      if (key in env || curEnv[key] !== applied) continue;
      const prev = prior.previousEnv[key];
      if (prev === null || prev === undefined) delete curEnv[key];
      else curEnv[key] = prev;
    }
  }

  for (const [key, value] of Object.entries(env)) {
    if (prior && key in prior.appliedEnv && key in prior.previousEnv) {
      previousEnv[key] = prior.previousEnv[key] ?? null;
      continue;
    }
    const has = Object.prototype.hasOwnProperty.call(curEnv, key);
    previousEnv[key] = has ? String(curEnv[key]) : null;
    if (has && String(curEnv[key]) !== value) overwritten.push(key);
  }
  next.env = { ...curEnv, ...env };

  const hooks = hooksOf(next);
  for (const event of HOOK_EVENTS) {
    const groups = hooks[event];
    if (groups !== undefined && !Array.isArray(groups)) {
      throw new JsonFileError(`"hooks.${event}" in settings.json must be an array.`);
    }
    const list: unknown[] = groups ? [...groups] : [];
    let found = false;
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (!isPlainObject(g) || !Array.isArray(g.hooks)) continue;
      if (!g.hooks.some(isOurHook)) continue;
      const inner = g.hooks
        .map((h) => {
          if (!isOurHook(h)) return h;
          if (found) return undefined; // drop duplicates of our hook
          found = true;
          return hookEntry();
        })
        .filter((h) => h !== undefined);
      list[i] = inner.length > 0 ? { ...g, hooks: inner } : undefined;
    }
    if (!found) list.push({ hooks: [hookEntry()] });
    hooks[event] = list.filter((g) => g !== undefined);
  }
  next.hooks = hooks;

  return { settings: next, previousEnv, overwritten };
}

export interface RemoveOptions {
  /** From state.json: what each key was before init. */
  previousEnv?: PreviousEnv;
  /** From state.json: what init wrote. Keys the user changed since then are left alone. */
  appliedEnv?: Record<string, string>;
}

/**
 * Undo mergeSettings: remove our hooks and restore/remove our env keys.
 * Without state (state.json lost) env keys are only removed when the OTLP headers carry an
 * SpendByTeam token, so we never strip a different collector's configuration.
 */
export function removeSettings(current: Settings, opts: RemoveOptions = {}): Settings {
  const next = clone(current);

  if (next.env !== undefined && isPlainObject(next.env)) {
    const env = next.env;
    if (opts.previousEnv && opts.appliedEnv) {
      for (const [key, applied] of Object.entries(opts.appliedEnv)) {
        if (!Object.prototype.hasOwnProperty.call(env, key)) continue;
        if (String(env[key]) !== applied) continue; // user changed it after install; keep
        const prev = opts.previousEnv[key];
        if (prev === null || prev === undefined) delete env[key];
        else env[key] = prev;
      }
    } else if (typeof env.OTEL_EXPORTER_OTLP_HEADERS === 'string' && env.OTEL_EXPORTER_OTLP_HEADERS.includes('sbt_ing_')) {
      for (const key of MANAGED_ENV_KEYS) delete env[key];
    }
    if (Object.keys(env).length === 0) delete next.env;
  }

  if (next.hooks !== undefined && isPlainObject(next.hooks)) {
    const hooks = next.hooks;
    for (const event of HOOK_EVENTS) {
      const groups = hooks[event];
      if (!Array.isArray(groups)) continue;
      const kept = groups
        .map((g) => {
          if (!isPlainObject(g) || !Array.isArray(g.hooks)) return g;
          const had = g.hooks.length;
          const inner = g.hooks.filter((h) => !isOurHook(h));
          if (inner.length === had) return g;
          return inner.length === 0 ? undefined : { ...g, hooks: inner };
        })
        .filter((g) => g !== undefined);
      if (kept.length === 0) delete hooks[event];
      else hooks[event] = kept;
    }
    if (Object.keys(hooks).length === 0) delete next.hooks;
  }

  return next;
}

export interface Inspection {
  envMatches: boolean;
  mismatchedKeys: string[];
  hookEvents: Record<string, boolean>;
}

/** Compare current settings to the env we expect (status/doctor). */
export function inspectSettings(current: Settings, expectedEnv: Record<string, string> | undefined): Inspection {
  const env = isPlainObject(current.env) ? current.env : {};
  const mismatchedKeys: string[] = [];
  if (expectedEnv) {
    for (const [k, v] of Object.entries(expectedEnv)) if (env[k] !== v) mismatchedKeys.push(k);
  }
  const hooks = isPlainObject(current.hooks) ? current.hooks : {};
  const hookEvents: Record<string, boolean> = {};
  for (const event of HOOK_EVENTS) {
    const groups = hooks[event];
    hookEvents[event] = Array.isArray(groups) && groups.some(
      (g) => isPlainObject(g) && Array.isArray(g.hooks) && g.hooks.some(isOurHook),
    );
  }
  return { envMatches: expectedEnv !== undefined && mismatchedKeys.length === 0, mismatchedKeys, hookEvents };
}
