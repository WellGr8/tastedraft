// Rebuild a single-file Claude Design .dc.html from the split parts.
// Usage: node build.mjs [out.dc.html]   (default ../dist/TasteDraft.dc.html)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const d = dirname(fileURLToPath(import.meta.url));
const r = (f) => readFileSync(join(d, f), 'utf8');
const out = process.argv[2] || join(d, '..', 'dist', 'TasteDraft.dc.html');
const script = ['mock-data.js', 'evidence.js', 'engine.js', 'view-model.js', 'api.js', 'logic.js', 'brief-model.js', 'brief.js', 'flow.js'].map((f) => r(f)).join('\n');
const tpl = r('template.html')
  .replace('@@FONTS_CSS@@', () => r('fonts.css'))
  .replace('@@STYLES_CSS@@', () => r('styles.css') + '\n' + r('brief.css') + '\n' + r('flow.css'))
  .replace('@@SCRIPT_JS@@', () => script);
mkdirSync(dirname(out), { recursive: true });
const enc = JSON.stringify(tpl).replaceAll('</', '<\\u002F');
const html = r('shell.html')
  .replace('@@MANIFEST@@', () => r('runtime.manifest.json'))
  .replace('@@TEMPLATE@@', () => enc);
writeFileSync(out, html);
console.log('wrote', out, html.length, 'chars');
