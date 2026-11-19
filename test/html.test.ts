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
