import { HOOK_DEPS } from './constants.js';
import { checkClaudeVersion, describeClaudeVersion, missingDeps, ping } from './checks.js';
import { collectStatus } from './status.js';
import { paths } from './paths.js';
import { consoleLogger, type Logger } from './log.js';

export type Level = 'ok' | 'warn' | 'fail';
export interface Check {
  level: Level;
  name: string;
  detail: string;
}

export async function runDoctor(opts: { ping?: boolean } = {}): Promise<Check[]> {
  const p = paths();
  const checks: Check[] = [];
  const add = (level: Level, name: string, detail: string) => checks.push({ level, name, detail });

  const missing = missingDeps();
  for (const dep of HOOK_DEPS) {
    if (missing.includes(dep)) add('warn', dep, `${dep} not found on PATH: the context hook (branch/ticket) will not send anything`);
    else add('ok', dep, `${dep} found`);
  }

  const claude = checkClaudeVersion();
  add(claude.status === 'ok' ? 'ok' : 'warn', 'claude', describeClaudeVersion(claude));

  const s = collectStatus();
  if (!s.config) add('fail', 'config', `${p.config} missing or invalid (run init)`);
  else add('ok', 'config', `${p.config}`);
  if (s.configMode !== undefined) {
    if (s.configMode === 0o600) add('ok', 'config mode', '600');
    else add('fail', 'config mode', `${s.configMode.toString(8)} (expected 600; fix: chmod 600 ${p.config})`);
  }
  if (s.settingsError) add('fail', 'settings', s.settingsError);
  else if (s.inspection) {
    if (s.inspection.envMatches) add('ok', 'settings env', 'OTel env present and matches config');
    else add('fail', 'settings env', `missing or changed: ${s.inspection.mismatchedKeys.join(', ') || 'no config to compare'}`);
    for (const [event, ok] of Object.entries(s.inspection.hookEvents)) {
      add(ok ? 'ok' : 'fail', `${event} hook`, ok ? 'registered' : 'not registered in settings.json');
    }
  }
  if (!s.hookInstalled) add('fail', 'hook.sh', `${p.hook} missing`);
  else if (!s.hookExecutable) add('fail', 'hook.sh', `${p.hook} not executable (fix: chmod +x ${p.hook})`);
  else add('ok', 'hook.sh', p.hook);

  if (opts.ping !== false && s.config) {
    const r = await ping(s.config.endpoint, s.config.token);
    if (r.ok) add('ok', 'ingest', `${s.config.endpoint}/v1/ping reachable`);
    else add('fail', 'ingest', `${s.config.endpoint}/v1/ping: ${r.error}`);
  }
  return checks;
}

export async function doctor(opts: { ping?: boolean; logger?: Logger } = {}): Promise<boolean> {
  const log = opts.logger ?? consoleLogger;
  const checks = await runDoctor(opts);
  for (const c of checks) {
    const line = `${c.name}: ${c.detail}`;
    if (c.level === 'ok') log.ok(line);
    else if (c.level === 'warn') log.warn(line);
    else log.error(line);
  }
  const failed = checks.filter((c) => c.level === 'fail').length;
  log.info(failed === 0 ? 'No problems found.' : `${failed} problem(s) found.`);
  return failed === 0;
}
