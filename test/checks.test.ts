import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkClaudeVersion, compareVersions, missingDeps, parseVersion, which } from '../src/checks.js';
import { fakeBin, fakeClaude, useTempHome } from './helpers.js';

const ctx = useTempHome();

describe('version parsing', () => {
  it('parses `claude --version` output', () => {
    expect(parseVersion('2.1.317 (Claude Code)')).toEqual([2, 1, 317]);
    expect(parseVersion('garbage')).toBeUndefined();
  });

  it('compares numerically, not lexically', () => {
    expect(compareVersions([2, 1, 269], [2, 1, 269])).toBe(0);
    expect(compareVersions([2, 1, 1000], [2, 1, 269])).toBe(1);
    expect(compareVersions([2, 0, 999], [2, 1, 269])).toBe(-1);
    expect(compareVersions([3, 0, 0], [2, 1, 269])).toBe(1);
  });
});

describe('checkClaudeVersion', () => {
  it('ok at exactly the minimum', () => {
    fakeClaude(ctx.bin, '2.1.269');
    expect(checkClaudeVersion()).toEqual({ status: 'ok', version: '2.1.269' });
  });
  it('old below the minimum', () => {
    fakeClaude(ctx.bin, '2.1.268');
    expect(checkClaudeVersion()).toEqual({ status: 'old', version: '2.1.268' });
  });
  it('missing when not on PATH', () => {
    expect(checkClaudeVersion()).toEqual({ status: 'missing' });
  });
  it('unknown on unparsable output', () => {
    fakeBin(ctx.bin, 'claude', '#!/bin/sh\necho dev-build\n');
    expect(checkClaudeVersion()).toEqual({ status: 'unknown', output: 'dev-build' });
  });
});

describe('dependency lookup', () => {
  it('finds executables on PATH only', () => {
    fakeBin(ctx.bin, 'jq');
    fakeBin(ctx.bin, 'git', '');
    // non-executable file does not count
    fs.chmodSync(`${ctx.bin}/git`, 0o644);
    expect(which('jq')).toBe(`${ctx.bin}/jq`);
    expect(which('git')).toBeUndefined();
    expect(missingDeps()).toEqual(['git', 'curl']);
  });
});
