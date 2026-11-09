// This deployment's own look on the built app: its name (APP_NAME, default ForLife) in place of
// "openGym", and its accent (APP_ACCENT, default #ff6b35) as the default colour in place of the
// green, so the tab, the installed app, the boot screen and every accent fill follow it.
import fs from 'node:fs';
import path from 'node:path';
const name = process.env.APP_NAME || 'ForLife';
const acc = (process.env.APP_ACCENT || '#ff6b35').toLowerCase();
const acc2 = process.env.APP_ACCENT_DARK || '#d9541f';   // pressed / second shade
const ink = process.env.APP_ACCENT_INK || '#b8400f';     // accent as text on the light theme (4.5:1)

const override = `<style id="brand">:root,:root[data-accent="lime"]{--acc:${acc};--acc-2:${acc2};--on-acc:#000}`
  + `:root[data-theme="light"],:root[data-theme="light"][data-accent="lime"]{--acc-2:${acc2};--acc-ink:${ink}}</style>`;

let html = fs.readFileSync('public/index.html', 'utf8').replaceAll('openGym', name).replaceAll('#a3e635', acc);
html = html.replace('</head>', override + '\n</head>');
fs.writeFileSync('public/index.html', html);
fs.writeFileSync('public/manifest.json', fs.readFileSync('public/manifest.json', 'utf8').replaceAll('openGym', name));

// The "lime" preset swatch and the colour handed to notifications live in the bundle.
let hits = 0;
for (const f of fs.readdirSync('public/assets')) {
  if (!f.endsWith('.js')) continue;
  const p = path.join('public/assets', f);
  const s = fs.readFileSync(p, 'utf8');
  const out = s.replace(/lime:(["'`])#30d158\1/g, (m, q) => (hits++, `lime:${q}${acc}${q}`)).replaceAll('#a3e635', acc);
  if (out !== s) fs.writeFileSync(p, out);
}
console.log(`branded as ${name}, accent ${acc} (${hits} preset swatch${hits === 1 ? '' : 'es'})`);
