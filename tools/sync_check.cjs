// Is every copy of SOL DUNK the same build? Run it from anywhere in a clone (npm run check).
//   node tools/sync_check.cjs             dist/index.html, dist/index.server.html and index.html (what GitHub Pages
//                                         serves) must be the build of src/, with nothing uncommitted or unpushed.
//   node tools/sync_check.cjs LIVE_FILE   also checks the live claude.ai demo. LIVE_FILE is the file a read_artifact
//                                         call saved its output to, or a plain HTML copy of the page.
//   --no-fetch                            skip the git fetch that brings origin/main up to date first.
// Prints one line per check and exits with code 1 if anything is out of sync.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const noFetch = args.includes('--no-fetch');
const liveFile = args.find((a) => !a.startsWith('--'));
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let bad = 0;
const ok = (msg) => console.log('ok            ' + msg);
const off = (msg) => { console.log('OUT OF SYNC   ' + msg); bad++; };

// 1. The three built files must be what build.cjs makes from src/ now. Build in a scratch copy so nothing here changes.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sol-dunk-check-'));
try {
  fs.cpSync(path.join(ROOT, 'src'), path.join(tmp, 'src'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'build.cjs'), path.join(tmp, 'build.cjs'));
  const env = { ...process.env };
  delete env.SERVER_URL;
  if (env.SOL_ICON) env.SOL_ICON = path.resolve(env.SOL_ICON);
  const build = (extra) => execFileSync(process.execPath, ['build.cjs'], { cwd: tmp, env: { ...env, ...extra }, stdio: 'ignore' });
  build({});                     // same two builds as npm run build
  build({ SERVER_URL: '/' });
  for (const [made, kept] of [['dist/index.html', 'dist/index.html'], ['dist/index.server.html', 'dist/index.server.html'], ['dist/index.html', 'index.html']]) {
    const want = fs.readFileSync(path.join(tmp, made), 'utf8');
    const have = fs.existsSync(path.join(ROOT, kept)) ? read(kept) : null;
    if (have === want) ok(kept + ' is the build of src/');
    else off(kept + ' is not the build of src/: run npm run build and commit the result');
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 2. Committed and pushed? Compare with origin/main, fetched fresh because other chats push too.
const dirty = git('status', '--porcelain', '--', 'src', 'build.cjs', 'dist', 'index.html').split('\n').filter(Boolean).map((l) => l.slice(3));
if (dirty.length) off('uncommitted changes in ' + dirty.join(', ') + ': commit and push them');
else ok('src/ and the builds are committed');
if (!noFetch) {
  try {
    const shallow = git('rev-parse', '--is-shallow-repository').trim() === 'true';
    git('fetch', '--quiet', ...(shallow ? ['--depth=50'] : []), 'origin', 'main');
  } catch (e) {
    console.log('note          could not fetch origin/main, so the next line is as of your last fetch');
  }
}
try {
  const [ahead, behind] = git('rev-list', '--left-right', '--count', 'HEAD...origin/main').trim().split(/\s+/).map(Number);
  if (behind) off('origin/main has ' + behind + ' commit(s) this clone doesn\'t: rebase onto origin/main before you build or publish');
  if (ahead) off(ahead + ' commit(s) not pushed yet: git push');
  if (!ahead && !behind) ok('HEAD is origin/main (' + git('rev-parse', '--short', 'HEAD').trim() + ')');
} catch (e) {
  off('there is no origin/main to compare with');
}

// 3. The live claude.ai demo, if a copy was given.
if (liveFile) {
  let text = fs.readFileSync(liveFile, 'utf8');
  let version = '';
  if (/^\s*\[/.test(text)) {      // a saved read_artifact result: [{type, text}, ...] with the page in one item
    try {
      const items = JSON.parse(text).map((x) => (x && x.text) || '');
      const m = /"version"\s*:\s*"([^"]+)"/.exec(items[0] || '');
      if (m) version = ' (version ' + m[1] + ')';
      text = items.find((t) => /<!DOCTYPE html>/i.test(t)) || items.join('\n');
    } catch (e) { /* not JSON after all: read it as HTML */ }
  }
  const s = text.search(/<!DOCTYPE html>/i);
  const e = text.lastIndexOf('</html>');
  if (s < 0 || e < s) off('there is no HTML page in ' + liveFile);
  else {
    // read_artifact wraps the page in a tag, which changes the trailing newline, so ignore trailing whitespace.
    const live = text.slice(s, e + '</html>'.length).trimEnd();
    const same = (html) => html.trimEnd() === live;
    if (same(read('dist/index.html'))) ok('the live demo' + version + ' is this clone\'s dist/index.html');
    else {
      let match = '';
      for (const line of git('log', '--format=%H %s', '--', 'dist/index.html').trim().split('\n').filter(Boolean)) {
        try { if (same(git('show', line.slice(0, 40) + ':dist/index.html'))) { match = line; break; } } catch (err) { /* not in that commit */ }
      }
      if (match) off('the live demo' + version + ' is the build of an older commit, ' + match.slice(0, 7) + ' "' + match.slice(41) + '": publish dist/index.html');
      else off('the live demo' + version + ' is a build this clone\'s history doesn\'t have (published without pushing?): split it with python3 tools/split_build.py, merge it into src/ and push before you publish');
    }
  }
}

console.log(bad ? '\n' + bad + ' thing(s) out of sync' : '\neverything is in sync');
process.exitCode = bad ? 1 : 0;
