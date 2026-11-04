import { buildEnv, type EnvOptions } from './env.js';

/**
 * Managed settings (TECHNICAL.md §3.1) for Team/Enterprise admins. Only the env block: the hook
 * needs ~/.spendbyteam/hook.sh on each machine, so it is installed per developer with `init`.
 */
export function managedSettings(opts: EnvOptions): { env: Record<string, string> } {
  return { env: buildEnv(opts) };
}

export function managedSettingsJson(opts: EnvOptions): string {
  return `${JSON.stringify(managedSettings(opts), null, 2)}\n`;
}
