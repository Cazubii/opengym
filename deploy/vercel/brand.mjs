// Puts this deployment's own name (APP_NAME, default ForLife) on the built app, in place of
// "openGym": the tab title, the installed app name and the boot messages.
import fs from 'node:fs';
const name = process.env.APP_NAME || 'ForLife';
for (const f of ['public/index.html', 'public/manifest.json']) {
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replaceAll('openGym', name));
}
console.log(`branded as ${name}`);
