// Builds a server-less copy of the game into dist/static (solo vs bots, see
// public/js/offline.js). Three.js is loaded from the jsDelivr CDN instead of
// node_modules, and the page is emitted without <html>/<head>/<body> wrappers
// so it can be published as a hosted page that adds its own document skeleton.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'dist/static');
const three = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/three/package.json'), 'utf8')).version;
const cdn = `https://cdn.jsdelivr.net/npm/three@${three}`;

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public/js'), path.join(out, 'js'), { recursive: true });
fs.cpSync(path.join(root, 'public/css'), path.join(out, 'css'), { recursive: true });
fs.mkdirSync(path.join(out, 'shared'));
for (const f of ['constants.js', 'skins.js', 'match.js', 'parkour-physics.js', 'parkour-levels.js']) {
  fs.copyFileSync(path.join(root, 'shared', f), path.join(out, 'shared', f));
}

// index.html is the entry page; other pages keep their own document skeleton
// because only the entry page gets one added by the host.
for (const page of ['index.html', 'parkour.html']) {
  const html = fs.readFileSync(path.join(root, 'public', page), 'utf8')
    .replace('./vendor/three/build/three.module.js', `${cdn}/build/three.module.js`)
    .replace('./vendor/three/examples/jsm/', `${cdn}/examples/jsm/`);
  if (page !== 'index.html') { fs.writeFileSync(path.join(out, page), html); continue; }
  const head = html.match(/<head>([\s\S]*)<\/head>/)[1]
    .replace(/\s*<meta charset[^>]*>/, '')
    .replace(/\s*<meta name="viewport"[^>]*>/, '');
  const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
  fs.writeFileSync(path.join(out, page), `${head.trim()}\n${body.trim()}\n`);
}

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name !== 'index.html') files.push(path.relative(out, p));
  }
})(out);
console.log(`Built ${out} (three ${three})\n${files.join('\n')}`);
