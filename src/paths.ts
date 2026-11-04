import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolved lazily so tests (and users) can point HOME somewhere else. */
export function homeDir(): string {
  return process.env.HOME && process.env.HOME.length > 0 ? process.env.HOME : os.homedir();
}

export function paths() {
  const home = homeDir();
  const claudeDir = path.join(home, '.claude');
  const sbtDir = path.join(home, '.spendbyteam');
  return {
    home,
    claudeDir,
    settings: path.join(claudeDir, 'settings.json'),
    settingsBackup: path.join(claudeDir, 'settings.json.bak'),
    sbtDir,
    config: path.join(sbtDir, 'config.json'),
    state: path.join(sbtDir, 'state.json'),
    hook: path.join(sbtDir, 'hook.sh'),
  };
}

/** hook/hook.sh shipped in the package (works from src/ under vitest and from dist/ when built). */
export function bundledHookPath(): string {
  return fileURLToPath(new URL('../hook/hook.sh', import.meta.url));
}
