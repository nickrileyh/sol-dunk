// Inline everything into one self-contained HTML file.
//   node build.cjs                 -> dist/index.html (demo SOL)
//   SERVER_URL=/ NETWORK=devnet node build.cjs -> dist/index.server.html, served by server/server.mjs
//   SOL_ICON=path/to/sol.svg node build.cjs   -> also show that icon next to SOL amounts
const fs = require('fs');
const path = require('path');
const r = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const cfg = { serverUrl: process.env.SERVER_URL || null, network: process.env.NETWORK || 'devnet', demoStart: 10, minBet: 0.001, maxBet: 100 };
// Optional SOL token icon shown next to amounts: put the official asset at src/sol-icon.svg (or .png/.webp),
// or point SOL_ICON at it. It is inlined as a data URI so the single-file build stays self-contained.
const iconFile = process.env.SOL_ICON ? path.resolve(process.env.SOL_ICON)
  : ['sol-icon.svg', 'sol-icon.png', 'sol-icon.webp'].map((f) => path.join(__dirname, 'src', f)).find((f) => fs.existsSync(f));
if (iconFile) {
  const mime = { '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' }[path.extname(iconFile).toLowerCase()];
  if (!mime) throw new Error('SOL icon must be .svg, .png or .webp');
  cfg.solIconUrl = 'data:' + mime + ';base64,' + fs.readFileSync(iconFile).toString('base64');
}
let html = r('index.html');
const parts = {
  '/*@@STYLE@@*/': r('style.css'),
  '/*@@CONFIG@@*/': 'window.SOL_DUNK_CONFIG = ' + JSON.stringify(cfg) + ';',
  '/*@@ENGINE@@*/': r('engine.cjs'),
  '/*@@PAYTABLE@@*/': r('paytable.cjs'),
  '/*@@BOT@@*/': r('bot.cjs'),
  '/*@@GAME@@*/': r('game.js')
};
for (const [k, v] of Object.entries(parts)) {
  if (v.includes('</script')) throw new Error(k + ' contains a closing script tag');
  html = html.replace(k, () => v);
}
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
const out = path.join(__dirname, 'dist', cfg.serverUrl ? 'index.server.html' : 'index.html');
fs.writeFileSync(out, html);
// The demo build is also the repo's root index.html, so GitHub Pages (main branch, root folder) serves the game.
if (!cfg.serverUrl) fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log('wrote', out, (html.length / 1024).toFixed(1) + ' KB', cfg.serverUrl ? '(server: ' + cfg.serverUrl + ')' : '(demo)');
