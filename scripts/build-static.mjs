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
for (const f of ['constants.js', 'skins.js', 'match.js']) {
  fs.copyFileSync(path.join(root, 'shared', f), path.join(out, 'shared', f));
}

let html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8')
  .replace('./vendor/three/build/three.module.js', `${cdn}/build/three.module.js`)
  .replace('./vendor/three/examples/jsm/', `${cdn}/examples/jsm/`);
const head = html.match(/<head>([\s\S]*)<\/head>/)[1]
  .replace(/\s*<meta charset[^>]*>/, '')
  .replace(/\s*<meta name="viewport"[^>]*>/, '');
const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
fs.writeFileSync(path.join(out, 'index.html'), `${head.trim()}\n${body.trim()}\n`);

// Penguin City (open-world mode) is a second, full page under city/.
fs.cpSync(path.join(root, 'public/city'), path.join(out, 'city'), { recursive: true });
const cityHtml = fs.readFileSync(path.join(root, 'public/city/index.html'), 'utf8')
  .replace('../vendor/three/build/three.module.js', `${cdn}/build/three.module.js`)
  .replace('../vendor/three/examples/jsm/', `${cdn}/examples/jsm/`);
fs.writeFileSync(path.join(out, 'city/index.html'), cityHtml);

// A self-contained copy of Penguin City with the game page at the root, for hosting the
// open world on its own (no <html>/<head>/<body>: the host adds the document skeleton).
const cityOut = path.join(root, 'dist/city');
fs.rmSync(cityOut, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public/city/js'), path.join(cityOut, 'city/js'), { recursive: true });
fs.cpSync(path.join(root, 'public/city/css'), path.join(cityOut, 'city/css'), { recursive: true });
fs.mkdirSync(path.join(cityOut, 'js'));
fs.copyFileSync(path.join(root, 'public/js/penguin.js'), path.join(cityOut, 'js/penguin.js'));
fs.mkdirSync(path.join(cityOut, 'shared'));
fs.copyFileSync(path.join(root, 'shared/skins.js'), path.join(cityOut, 'shared/skins.js'));
const cityPage = cityHtml
  .replace('href="css/city.css"', 'href="city/css/city.css"')
  .replace('src="js/main.js"', 'src="city/js/main.js"')
  .replace(/\s*<a class="ghost" href="\.\.\/">[^<]*<\/a>/, '');
const cityHead = cityPage.match(/<head>([\s\S]*)<\/head>/)[1]
  .replace(/\s*<meta charset[^>]*>/, '')
  .replace(/\s*<meta name="viewport"[^>]*>/, '');
const cityBody = cityPage.match(/<body>([\s\S]*)<\/body>/)[1];
fs.writeFileSync(path.join(cityOut, 'index.html'), `${cityHead.trim()}\n${cityBody.trim()}\n`);

// Grand Prix Time Attack (public/f1) as its own hostable page, same treatment as above.
const f1Out = path.join(root, 'dist/f1');
fs.rmSync(f1Out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public/f1'), f1Out, { recursive: true });
const f1Page = fs.readFileSync(path.join(root, 'public/f1/index.html'), 'utf8')
  .replace('../vendor/three/build/three.module.js', `${cdn}/build/three.module.js`)
  .replace('../vendor/three/examples/jsm/', `${cdn}/examples/jsm/`);
const f1Head = f1Page.match(/<head>([\s\S]*)<\/head>/)[1]
  .replace(/\s*<meta charset[^>]*>/, '')
  .replace(/\s*<meta name="viewport"[^>]*>/, '');
const f1Body = f1Page.match(/<body>([\s\S]*)<\/body>/)[1];
fs.writeFileSync(path.join(f1Out, 'index.html'), `${f1Head.trim()}\n${f1Body.trim()}\n`);

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name !== 'index.html') files.push(path.relative(out, p));
  }
})(out);
console.log(`Built ${out} (three ${three})\n${files.join('\n')}`);
