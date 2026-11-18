import os from 'node:os';
import { spawn } from 'node:child_process';
import { init, type InitResult } from './init.js';
import { UsageError } from './env.js';
import { consoleLogger, type Logger } from './log.js';

/**
 * `spendbyteam connect`: set up this machine without copying a token.
 *
 * Device-authorization flow: ask the panel for a code, open the browser where the person signs
 * up or logs in and approves that code, then poll until the panel hands over an ingest token,
 * and run `init` with it. The only thing sent before approval is this machine's hostname, so the
 * approval page can say which machine is asking.
 */

export const DEFAULT_APP_URL = 'https://app.spendbyteam.com';

export interface ConnectOptions {
  appUrl?: string;
  teamId?: string;
  /** Open the browser (default true). */
  open?: boolean;
  ping?: boolean;
  logger?: Logger;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  openBrowser?: (url: string) => void;
}

interface StartResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export function normalizeAppUrl(raw: string | undefined): string {
  const value = (raw ?? process.env.SPENDBYTEAM_APP_URL ?? DEFAULT_APP_URL).trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError(`Invalid --app-url: ${value}`);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new UsageError('--app-url must use https:// (http:// is only allowed for localhost).');
  }
  return url.origin;
}

/** A name the approval page can show. macOS sometimes reports a LAN IP as the hostname: say "Mac" instead. */
export function machineLabel(hostname = os.hostname(), platform: NodeJS.Platform = process.platform): string {
  const name = hostname.replace(/\.local$/i, '').trim();
  if (!name || /^\d{1,3}(\.\d{1,3}){3}$/.test(name) || name.includes(':')) {
    return platform === 'darwin' ? 'Mac' : platform === 'win32' ? 'Windows PC' : platform === 'linux' ? 'Linux machine' : 'machine';
  }
  return name.slice(0, 64);
}

export function openInBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // No browser here (SSH, container): the URL is printed anyway.
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function postJson(fetchImpl: typeof fetch, url: string, body: unknown): Promise<{ status: number; data: any }> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON error page: status code says enough.
  }
  return { status: res.status, data };
}

export async function connect(opts: ConnectOptions = {}): Promise<InitResult> {
  const log = opts.logger ?? consoleLogger;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? wait;
  const appUrl = normalizeAppUrl(opts.appUrl);

  let start: { status: number; data: StartResponse | null };
  try {
    start = await postJson(fetchImpl, `${appUrl}/cli/connect/start`, { client_name: machineLabel() });
  } catch (err) {
    throw new UsageError(`Could not reach ${appUrl} (${(err as Error).message}). Check your connection and try again.`);
  }
  if (start.status !== 200 || !start.data?.device_code) {
    throw new UsageError(
      start.status === 429 ? 'Too many attempts. Wait a minute and try again.' : `${appUrl} answered ${start.status}. Try again in a moment.`,
    );
  }
  const s = start.data;

  log.info('');
  log.info(`  Your code: ${s.user_code}`);
  log.info('');
  log.info(`Approve it in your browser (sign up free if you have no account):`);
  log.info(`  ${s.verification_uri_complete}`);
  if (opts.open !== false) (opts.openBrowser ?? openInBrowser)(s.verification_uri_complete);
  log.info('');
  log.info('Waiting for approval… (Ctrl+C to stop)');

  let interval = Math.max(1, s.interval) * 1000;
  const deadline = Date.now() + s.expires_in * 1000;
  let failures = 0;
  while (Date.now() < deadline) {
    await sleep(interval);
    let poll: { status: number; data: any };
    try {
      poll = await postJson(fetchImpl, `${appUrl}/cli/connect/poll`, { device_code: s.device_code });
      failures = 0;
    } catch {
      if (++failures >= 5) throw new UsageError(`Lost the connection to ${appUrl}. Run \`npx spendbyteam connect\` again.`);
      continue;
    }
    if (poll.status === 429) {
      interval += 2000;
      continue;
    }
    if (poll.status === 200 && poll.data?.status === 'approved' && typeof poll.data.token === 'string') {
      log.ok('Approved. Setting up Claude Code on this machine…');
      const result = await init({ token: poll.data.token, endpoint: poll.data.endpoint, teamId: opts.teamId, ping: opts.ping, logger: log });
      log.info('');
      log.ok('Connected. New Claude Code sessions here now show up in your SpendByTeam workspace.');
      return result;
    }
    if (poll.status === 410) {
      throw new UsageError(
        poll.data?.status === 'denied'
          ? 'The connection was cancelled in the browser. Nothing was changed on this machine.'
          : 'The code expired. Run `npx spendbyteam connect` again.',
      );
    }
  }
  throw new UsageError('The code expired before it was approved. Run `npx spendbyteam connect` again.');
}
