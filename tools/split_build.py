"""Split a SOL DUNK single-file build (dist/index.html or a published artifact) back into src files: the reverse of build.cjs.
Usage: python3 tools/split_build.py build.html out_dir"""
import sys, os, re, base64
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
h = open(src, encoding='utf-8').read()
m = re.search(r'<style>(.*?)</style>', h, re.S)
style = m.group(1)
# inlined fonts go back to fonts/ (build.cjs leaves each one's file name in a comment before it)
def unfont(fm):
    os.makedirs(os.path.join(out, 'fonts'), exist_ok=True)
    open(os.path.join(out, 'fonts', fm.group(1)), 'wb').write(base64.b64decode(fm.group(2)))
    return 'url("fonts/' + fm.group(1) + '")'
style = re.sub(r'/\*fonts/([\w.-]+\.woff2)\*/url\("data:font/woff2;base64,([A-Za-z0-9+/=]+)"\)', unfont, style)
tmpl = h[:m.start(1)] + '/*@@STYLE@@*/' + h[m.end(1):]
blocks = list(re.finditer(r'<script>(.*?)</script>', tmpl, re.S))
# builds from before the challenge pots (src/pots.cjs) have five scripts, then six; from the SOL missions and the
# special level (src/missions.cjs, src/special.cjs) on, eight; from levels and rakeback (src/levels.cjs) on, nine
names = {5: ['CONFIG', 'ENGINE', 'PAYTABLE', 'BOT', 'GAME'], 6: ['CONFIG', 'ENGINE', 'PAYTABLE', 'BOT', 'POTS', 'GAME'],
         8: ['CONFIG', 'ENGINE', 'PAYTABLE', 'BOT', 'POTS', 'MISSIONS', 'SPECIAL', 'GAME'],
         9: ['CONFIG', 'ENGINE', 'PAYTABLE', 'BOT', 'POTS', 'MISSIONS', 'SPECIAL', 'LEVELS', 'GAME']}.get(len(blocks), [])
files = {'ENGINE': 'engine.cjs', 'PAYTABLE': 'paytable.cjs', 'BOT': 'bot.cjs', 'POTS': 'pots.cjs', 'MISSIONS': 'missions.cjs', 'SPECIAL': 'special.cjs', 'LEVELS': 'levels.cjs', 'GAME': 'game.js'}
assert len(blocks) == len(names), len(blocks)
files = {k: f for k, f in files.items() if k in names}
parts = {}
for name, bm in zip(names, blocks): parts[name] = bm.group(1)
# rebuild the template from the end so offsets stay valid
for name, bm in reversed(list(zip(names, blocks))):
    tmpl = tmpl[:bm.start(1)] + '/*@@' + name + '@@*/' + tmpl[bm.end(1):]
open(os.path.join(out, 'index.html'), 'w', encoding='utf-8').write(tmpl)
open(os.path.join(out, 'style.css'), 'w', encoding='utf-8').write(style)
for k, f in files.items(): open(os.path.join(out, f), 'w', encoding='utf-8').write(parts[k])
open(os.path.join(out, 'config.js'), 'w', encoding='utf-8').write(parts['CONFIG'])
print('split ok', {k: len(v) for k, v in parts.items()}, 'style', len(style))
