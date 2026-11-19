// Writes the spendbyteam.com/report page from the CLI's report UI, so both stay identical.
// Run after `npm run build`: node scripts/web-shell.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webShell } from '../dist/html.js';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../landing/public');
const { html, js } = webShell();
fs.writeFileSync(path.join(out, 'report.html'), html);
fs.writeFileSync(path.join(out, 'report.js'), js);
console.log(`wrote ${path.join(out, 'report.html')} and report.js`);
