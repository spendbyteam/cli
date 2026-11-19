#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { init } from './init.js';
import { uninstall } from './uninstall.js';
import { status } from './status.js';
import { doctor } from './doctor.js';
import { managedSettingsJson } from './managed.js';
import { report, GROUPS, type GroupBy } from './report.js';
import { connect } from './connect.js';
import { UsageError } from './env.js';
import { JsonFileError } from './fsutil.js';
import { consoleLogger } from './log.js';

const HELP = `spendbyteam — see and share what Claude Code costs (metrics only, no prompts or code)

Usage:
  npx spendbyteam report [--days=30 | --all] [--by=project|model|branch|day|session] [--json] [--web | --local | --no-web]
  npx spendbyteam connect [--team-id=ID] [--no-browser]
  npx spendbyteam init --token=sbt_ing_... [--endpoint=URL] [--team-id=ID] [--no-ping]
  npx spendbyteam uninstall
  npx spendbyteam status
  npx spendbyteam doctor [--no-ping]
  npx spendbyteam print-managed --token=sbt_ing_... [--endpoint=URL] [--team-id=ID]

Commands:
  report         What Claude Code cost on this machine, per project, model, branch, day or session, at API list
                 prices. Reads the local session logs only: works offline, no account or token needed.
  connect        Sign up or log in in the browser, approve this machine, and set it up: no token to copy.
  init           Merge the OTel env + context hook into ~/.claude/settings.json (backup: settings.json.bak),
                 write ~/.spendbyteam/config.json (mode 600) and ~/.spendbyteam/hook.sh. Safe to re-run.
  uninstall      Undo everything init did (restores env values that existed before).
  status         Show what is installed.
  doctor         Check jq/git/curl, Claude Code version, settings, permissions and connectivity.
  print-managed  Print managed-settings JSON for Team/Enterprise admins (stdout).

Options:
  --token        Ingest token from the SpendByTeam panel (write-only).
  --endpoint     Ingest endpoint (default https://ingest.spendbyteam.com).
  --team-id      Optional static team id, sent as OTEL_RESOURCE_ATTRIBUTES=team.id=<id>.
  --no-ping      Skip the GET /v1/ping connectivity test.
  --days         report: how many days back to look, including today (default 30).
  --all          report: everything in the logs.
  --by           report: group by project (default), model, branch, day or session.
  --json         report: print JSON instead of a table.
  --web          report: open it on spendbyteam.com with names hidden; the numbers ride in the link, nothing is stored (asked by default).
  --local        report: open it as a local HTML file with real names, fully offline.
  --no-web       report: don't ask to open it in the browser.
  --no-browser   connect: print the approval link instead of opening a browser.
  --app-url      connect: panel URL (default https://app.spendbyteam.com).
  -h, --help     Show this help.
  -v, --version  Show version.
`;

function version(): string {
  const require = createRequire(import.meta.url);
  return (require('../package.json') as { version: string }).version;
}

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      token: { type: 'string' },
      endpoint: { type: 'string' },
      'team-id': { type: 'string' },
      'no-ping': { type: 'boolean', default: false },
      days: { type: 'string' },
      all: { type: 'boolean', default: false },
      by: { type: 'string' },
      json: { type: 'boolean', default: false },
      web: { type: 'boolean' },
      'no-web': { type: 'boolean', default: false },
      local: { type: 'boolean' },
      'no-browser': { type: 'boolean', default: false },
      'app-url': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  });
  if (values.version) {
    console.log(version());
    return 0;
  }
  const cmd = positionals[0];
  if (values.help || !cmd || cmd === 'help') {
    console.log(HELP);
    return cmd || values.help ? 0 : 1;
  }
  if (positionals.length > 1) throw new UsageError(`Unexpected argument: ${positionals[1]}`);
  const envOpts = { token: values.token ?? '', endpoint: values.endpoint, teamId: values['team-id'] };

  switch (cmd) {
    case 'report': {
      const days = values.days === undefined ? undefined : Number(values.days);
      if (values.by !== undefined && !GROUPS.includes(values.by as GroupBy)) {
        throw new UsageError(`--by must be one of: ${GROUPS.join(', ')}.`);
      }
      await report({ days, all: values.all, by: values.by as GroupBy | undefined, json: values.json, web: values['no-web'] ? false : values.web, local: values.local });
      return 0;
    }
    case 'connect':
      await connect({ appUrl: values['app-url'], teamId: values['team-id'], open: !values['no-browser'], ping: !values['no-ping'] });
      return 0;
    case 'init':
      await init({ ...envOpts, ping: !values['no-ping'] });
      return 0;
    case 'uninstall':
      uninstall();
      return 0;
    case 'status':
      return status().installed ? 0 : 1;
    case 'doctor':
      return (await doctor({ ping: !values['no-ping'] })) ? 0 : 1;
    case 'print-managed':
      process.stdout.write(managedSettingsJson(envOpts));
      console.error(
        '# Put this in managed-settings.json (macOS: /Library/Application Support/ClaudeCode/, Linux/WSL: /etc/claude-code/)\n' +
          '# or in server-managed settings. Developers still run `npx spendbyteam init` for the branch/ticket hook.',
      );
      return 0;
    default:
      throw new UsageError(`Unknown command "${cmd}". Run "npx spendbyteam --help".`);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    if (err instanceof UsageError || err instanceof JsonFileError || (err as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      consoleLogger.error((err as Error).message);
      process.exitCode = 2;
    } else {
      consoleLogger.error(`Unexpected error: ${(err as Error).stack ?? String(err)}`);
      process.exitCode = 1;
    }
  },
);
