import fs from 'node:fs';
import { paths } from './paths.js';
import { fileMode, readJsonObject, toJson, writeFileAtomic } from './fsutil.js';
import { removeSettings } from './settings.js';
import { readState } from './state.js';
import { consoleLogger, type Logger } from './log.js';

export interface UninstallResult {
  settingsChanged: boolean;
  backupPath?: string;
  removedDir: boolean;
}

export function uninstall(opts: { logger?: Logger } = {}): UninstallResult {
  const log = opts.logger ?? consoleLogger;
  const p = paths();
  const state = readState();

  let settingsChanged = false;
  let backupPath: string | undefined;
  const existing = readJsonObject(p.settings);
  if (existing !== undefined) {
    const next = removeSettings(existing, state ? { previousEnv: state.previous_env, appliedEnv: state.applied_env } : {});
    const after = toJson(next);
    if (after !== toJson(existing)) {
      fs.copyFileSync(p.settings, p.settingsBackup);
      backupPath = p.settingsBackup;
      writeFileAtomic(p.settings, after, fileMode(p.settings) ?? 0o600);
      settingsChanged = true;
      log.ok(`Removed SpendByTeam settings from ${p.settings} (backup: ${backupPath})`);
    } else {
      log.ok(`${p.settings} has no SpendByTeam settings`);
    }
  }

  const removedDir = fs.existsSync(p.sbtDir);
  fs.rmSync(p.sbtDir, { recursive: true, force: true });
  if (removedDir) log.ok(`Removed ${p.sbtDir}`);
  log.info('SpendByTeam is uninstalled. Restart Claude Code sessions to stop sending metrics.');
  return { settingsChanged, backupPath, removedDir };
}
