import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'vitest';

export const TOKEN = 'sbt_ing_abcdefghijklmnopqrstuvwxyz012345';

/** Each test gets an empty temporary HOME and a PATH containing only fake binaries we create. */
export function useTempHome() {
  const ctx = { home: '', bin: '' };
  let savedHome: string | undefined;
  let savedPath: string | undefined;
  beforeEach(() => {
    savedHome = process.env.HOME;
    savedPath = process.env.PATH;
    ctx.home = fs.mkdtempSync(path.join(os.tmpdir(), 'sbt-home-'));
    ctx.bin = path.join(ctx.home, 'bin');
    fs.mkdirSync(ctx.bin);
    process.env.HOME = ctx.home;
    process.env.PATH = ctx.bin;
  });
  afterEach(() => {
    process.env.HOME = savedHome;
    process.env.PATH = savedPath;
    fs.rmSync(ctx.home, { recursive: true, force: true });
  });
  return ctx;
}

export function fakeBin(dir: string, name: string, script = '#!/bin/sh\nexit 0\n') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, script, { mode: 0o755 });
  return file;
}

export function fakeClaude(dir: string, version: string) {
  return fakeBin(dir, 'claude', `#!/bin/sh\necho "${version} (Claude Code)"\n`);
}

export function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

export function mode(file: string) {
  return fs.statSync(file).mode & 0o777;
}
