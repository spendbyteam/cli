import fs from 'node:fs';
import { buildEnv, maskToken } from './env.js';
import { paths } from './paths.js';
import { fileMode, readJsonObject } from './fsutil.js';
import { inspectSettings, type Inspection } from './settings.js';
import { readConfig, readState, type Config } from './state.js';
import { HOOK_EVENTS } from './constants.js';
import { consoleLogger, type Logger } from './log.js';

export interface StatusReport {
  installed: boolean;
  config?: Config;
  configMode?: number;
  hookInstalled: boolean;
  hookExecutable: boolean;
  settingsError?: string;
  inspection?: Inspection;
}

export function collectStatus(): StatusReport {
  const p = paths();
  let config: Config | undefined;
  try {
    config = readConfig();
  } catch {
    config = undefined;
  }
  const hookMode = fileMode(p.hook);
  const report: StatusReport = {
    installed: false,
    config,
    configMode: fileMode(p.config),
    hookInstalled: hookMode !== undefined,
    hookExecutable: hookMode !== undefined && (hookMode & 0o100) !== 0,
  };
  let settings: Record<string, unknown> | undefined;
  try {
    settings = readJsonObject(p.settings) ?? {};
  } catch (err) {
    report.settingsError = (err as Error).message;
  }
  if (settings) {
    // Prefer what init actually applied (includes team id); fall back to config.
    const state = readState();
    let expected: Record<string, string> | undefined = state?.applied_env;
    if (!expected && config) {
      try {
        expected = buildEnv({ token: config.token, endpoint: config.endpoint });
      } catch {
        expected = undefined;
      }
    }
    report.inspection = inspectSettings(settings, expected);
  }
  report.installed = Boolean(
    config && report.hookInstalled && report.inspection?.envMatches && HOOK_EVENTS.every((e) => report.inspection?.hookEvents[e]),
  );
  return report;
}

export function status(opts: { logger?: Logger } = {}): StatusReport {
  const log = opts.logger ?? consoleLogger;
  const p = paths();
  const r = collectStatus();
  if (!r.config && !r.hookInstalled && !r.inspection?.hookEvents.SessionStart) {
    log.info('SpendByTeam is not installed. Run: npx spendbyteam init --token=sbt_ing_...');
    return r;
  }
  if (r.config) log.ok(`Config ${p.config}: endpoint ${r.config.endpoint}, token ${maskToken(r.config.token)}`);
  else log.error(`Config ${p.config} missing or invalid`);
  if (r.configMode !== undefined && r.configMode !== 0o600) log.warn(`Config mode is ${r.configMode.toString(8)}, expected 600`);
  if (r.settingsError) log.error(r.settingsError);
  if (r.inspection) {
    if (r.inspection.envMatches) log.ok('OTel env in ~/.claude/settings.json');
    else log.error(`OTel env in ~/.claude/settings.json missing or changed: ${r.inspection.mismatchedKeys.join(', ') || 'unknown'}`);
    for (const e of HOOK_EVENTS) {
      if (r.inspection.hookEvents[e]) log.ok(`${e} hook registered`);
      else log.error(`${e} hook not registered`);
    }
  }
  if (r.hookExecutable) log.ok(`Hook script ${p.hook}`);
  else log.error(`Hook script ${p.hook} ${r.hookInstalled ? 'is not executable' : 'missing'}`);
  log.info(r.installed ? 'Status: installed' : 'Status: incomplete — run "npx spendbyteam init" again or "npx spendbyteam doctor"');
  return r;
}
