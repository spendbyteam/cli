import fs from 'node:fs';
import { buildEnv, normalizeEndpoint, validateToken } from './env.js';
import { bundledHookPath, paths } from './paths.js';
import { fileMode, readJsonObject, toJson, writeFileAtomic } from './fsutil.js';
import { mergeSettings } from './settings.js';
import { readState, writeConfig, writeState, ensureSbtDir } from './state.js';
import { checkClaudeVersion, describeClaudeVersion, missingDeps, ping, type ClaudeVersionCheck, type PingResult } from './checks.js';
import { consoleLogger, type Logger } from './log.js';

export interface InitOptions {
  token: string;
  endpoint?: string;
  teamId?: string;
  /** Send GET /v1/ping after installing (default true). */
  ping?: boolean;
  logger?: Logger;
}

export interface InitResult {
  settingsChanged: boolean;
  backupPath?: string;
  overwritten: string[];
  missingDeps: string[];
  claude: ClaudeVersionCheck;
  ping?: PingResult;
}

export async function init(opts: InitOptions): Promise<InitResult> {
  const log = opts.logger ?? consoleLogger;
  const token = validateToken(opts.token);
  const endpoint = normalizeEndpoint(opts.endpoint);
  const env = buildEnv({ token, endpoint, teamId: opts.teamId });
  const p = paths();

  // 1. Claude Code version (warn only).
  const claude = checkClaudeVersion();
  if (claude.status === 'ok') log.ok(describeClaudeVersion(claude));
  else log.warn(describeClaudeVersion(claude));

  const missing = missingDeps();
  if (missing.length > 0) {
    log.warn(`Missing ${missing.join(', ')}: the branch/ticket hook will silently do nothing until installed. Cost metrics still work.`);
  }

  // 2. Merge into ~/.claude/settings.json (reads first; aborts on invalid JSON before writing anything).
  const existing = readJsonObject(p.settings);
  const current = existing ?? {};
  const prevState = readState();
  const merged = mergeSettings(
    current,
    env,
    prevState ? { previousEnv: prevState.previous_env, appliedEnv: prevState.applied_env } : undefined,
  );
  const before = existing === undefined ? undefined : toJson(existing);
  const after = toJson(merged.settings);
  const settingsChanged = before !== after;
  let backupPath: string | undefined;
  if (settingsChanged) {
    if (existing !== undefined) {
      fs.copyFileSync(p.settings, p.settingsBackup);
      backupPath = p.settingsBackup;
    }
    // The file now contains the ingest token in OTEL_EXPORTER_OTLP_HEADERS: keep it private.
    const mode = (fileMode(p.settings) ?? 0o600) & 0o700;
    writeFileAtomic(p.settings, after, mode);
    log.ok(`Updated ${p.settings}${backupPath ? ` (backup: ${backupPath})` : ''}`);
  } else {
    log.ok(`${p.settings} already up to date`);
  }
  for (const k of merged.overwritten) log.warn(`Replaced existing env ${k} (restored on uninstall).`);

  // 3. ~/.spendbyteam/config.json (chmod 600) + state for a clean uninstall.
  ensureSbtDir();
  writeConfig({ token, endpoint });
  const now = new Date().toISOString();
  writeState({
    version: 1,
    installed_at: prevState?.installed_at ?? now,
    updated_at: now,
    previous_env: merged.previousEnv,
    applied_env: env,
  });
  log.ok(`Wrote ${p.config} (mode 600)`);

  // 4. Hook script.
  fs.copyFileSync(bundledHookPath(), p.hook);
  fs.chmodSync(p.hook, 0o755);
  log.ok(`Installed ${p.hook}`);

  // 5. Connectivity test.
  let pingResult: PingResult | undefined;
  if (opts.ping !== false) {
    pingResult = await ping(endpoint, token);
    if (pingResult.ok) log.ok(`Connected to ${endpoint} — the panel will show this machine as connected.`);
    else log.warn(`Could not reach ${endpoint}/v1/ping: ${pingResult.error}. Settings are installed; run "npx spendbyteam doctor" later.`);
  }

  log.info('Restart Claude Code sessions for the new settings to take effect.');
  return { settingsChanged, backupPath, overwritten: merged.overwritten, missingDeps: missing, claude, ping: pingResult };
}
