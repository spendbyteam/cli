import fs from 'node:fs';
import { paths } from './paths.js';
import { isPlainObject, readJsonObject, toJson, writeFileAtomic } from './fsutil.js';
import type { PreviousEnv } from './settings.js';

export interface Config {
  token: string;
  endpoint: string;
}

export interface State {
  version: 1;
  installed_at: string;
  updated_at: string;
  previous_env: PreviousEnv;
  applied_env: Record<string, string>;
}

export function ensureSbtDir(): void {
  const { sbtDir } = paths();
  fs.mkdirSync(sbtDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(sbtDir, 0o700);
}

/** config.json is read by hook.sh; it holds the token, so it is always chmod 600. */
export function writeConfig(cfg: Config): void {
  ensureSbtDir();
  writeFileAtomic(paths().config, toJson({ token: cfg.token, endpoint: cfg.endpoint }), 0o600);
}

export function readConfig(): Config | undefined {
  const data = readJsonObject(paths().config);
  if (!data || typeof data.token !== 'string' || typeof data.endpoint !== 'string') return undefined;
  return { token: data.token, endpoint: data.endpoint };
}

export function writeState(state: State): void {
  ensureSbtDir();
  writeFileAtomic(paths().state, toJson(state), 0o600);
}

export function readState(): State | undefined {
  let data: Record<string, unknown> | undefined;
  try {
    data = readJsonObject(paths().state);
  } catch {
    return undefined;
  }
  if (!data || !isPlainObject(data.previous_env) || !isPlainObject(data.applied_env)) return undefined;
  return data as unknown as State;
}
