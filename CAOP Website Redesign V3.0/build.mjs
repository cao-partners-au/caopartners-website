import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = new URL('.', import.meta.url);
const out = new URL('dist/', root);
await mkdir(out, { recursive: true });
for (const path of ['index.html', 'styles.css', 'app.js', 'reviews.js', 'logo-flight.js', 'founder-swarm.js', 'point-swarms.js', 'continuity-swarms.js', 'sculpture.js', 'assets', 'vendor']) {
  await cp(new URL(path, root), new URL(path, out), { recursive: true });
}
await writeFile(new URL('robots.txt', out), 'User-agent: *\nDisallow: /\n');
const html = await readFile(new URL('index.html', out), 'utf8');
if (!html.includes('noindex,nofollow') || !html.includes('DEMO') && !html.includes('demo')) throw new Error('Preview markers missing');
console.log('Built standalone static preview.');
