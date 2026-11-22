import { describe, expect, it } from 'vitest';
import { HTML_CTA_URL, renderHtml } from '../src/html.js';
import type { Report } from '../src/report.js';

const base: Report = {
  from: '2026-10-21',
  to: '2026-11-19',
  by: 'project',
  rows: [
    {
      key: '<script>alert(1)</script>',
      cost: 12.5,
      share: 0.75,
      requests: 10,
      sessions: 2,
      tokens: 1_500_000,
      split: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
      topModel: 'claude-opus-5-5',
    },
  ],
  total: { cost: 16.67, requests: 12, sessions: 3, tokens: 2_000_000 },
  unpriced: [],
  files: 2,
  compactions: 0,
  retention: { days: 30, source: 'default', oldestLog: '2026-10-04' },
};

describe('html report', () => {
  const html = renderHtml(base, { generatedAt: new Date('2026-11-19T10:00:00Z') });

  it('never puts a project name into the page as raw HTML', () => {
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('textContent');
  });

  it('loads nothing from the network: no external scripts, stylesheets or images, and a CSP that forbids requests', () => {
    expect(html).not.toMatch(/<script[^>]*\ssrc=|<link|<img|@import/i);
    expect(html).not.toMatch(/[^A-Za-z]url\(/);
    expect(html).toMatch(/default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:"/);
    expect(html).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/);
  });

  it('embeds the data as JSON that cannot close its script tag', () => {
    const m = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    const data = JSON.parse(m![1]!);
    expect(data.views.project[0][0]).toBe('<script>alert(1)</script>');
    expect(data.total.cost).toBe(16.67);
  });

  it('links to the team dashboard with the CLI as the source, and says nothing was uploaded', () => {
    expect(html).toContain(HTML_CTA_URL);
    expect(HTML_CTA_URL).toContain('src=cli');
    expect(html).toContain('Nothing was uploaded');
  });

  it('carries the retention setting for the heads-up', () => {
    const m = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
    expect(JSON.parse(m![1]!).retention).toEqual({ days: 30, source: 'default', oldestLog: '2026-10-04' });
  });
});

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { webReportUrl, webShell, WEB_REPORT_URL } from '../src/html.js';

describe('web report link', () => {
  const secret: Report = {
    ...base,
    rows: [],
    views: {
      project: [{ ...base.rows[0]!, key: 'acme-client-portal', cost: 9 }, { ...base.rows[0]!, key: '~/work/bigbank', cost: 3 }],
      branch: [{ ...base.rows[0]!, key: 'feature/acme-sso' }],
      model: [{ ...base.rows[0]!, key: 'claude-opus-5-5' }],
      day: [{ ...base.rows[0]!, key: '2026-11-19' }],
      session: [{ ...base.rows[0]!, key: 'sess-uuid-1', project: 'acme-client-portal', startedAt: '2026-11-19T09:00:00.000Z' }],
    },
  };
  const url = webReportUrl(secret, { deflate: (s) => zlib.deflateRawSync(s), generatedAt: new Date('2026-11-19T10:00:00Z') });
  const payload = () => JSON.parse(zlib.inflateRawSync(Buffer.from(url.split('#d=')[1]!, 'base64url')).toString());

  it('puts the data after # on spendbyteam.com/report, so it never reaches the server', () => {
    expect(url.startsWith(`${WEB_REPORT_URL}#d=`)).toBe(true);
    expect(url.split('#')[0]).toBe(WEB_REPORT_URL);
  });

  it('carries real names in the fragment; the page can hide them and shared text always does', () => {
    const d = payload();
    expect(d.mode).toBe('web');
    expect(d.views.project.map((r: unknown[]) => r[0])).toEqual(['acme-client-portal', '~/work/bigbank']);
    const { js } = webShell();
    expect(js).toContain('Hide names');
    expect(js).toContain("nm('project',r.key,true)");
  });

  it('the web page has no inline script and drops the fragment after reading it', () => {
    const { html, js } = webShell();
    expect(html).not.toMatch(/<script>(?!<\/script>)/);
    expect(html).toMatch(/<script src="\/report\.js\?v=[0-9a-f]{10}"><\/script>/);
    expect(js).toContain("history.replaceState(null,'',location.pathname)");
    expect(js).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/);
  });

  const landing = path.resolve(__dirname, '../../landing/public');
  it.runIf(fs.existsSync(landing))('the committed spendbyteam.com/report page matches the CLI (run npm run web-shell)', () => {
    const { html, js } = webShell();
    expect(fs.readFileSync(path.join(landing, 'report.html'), 'utf8')).toBe(html);
    expect(fs.readFileSync(path.join(landing, 'report.js'), 'utf8')).toBe(js);
  });
});
