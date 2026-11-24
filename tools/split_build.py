"""Split a SOL DUNK single-file build (dist/index.html or a published artifact) back into src files: the reverse of build.cjs.
Usage: python3 tools/split_build.py build.html out_dir"""
import sys, os, re
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
h = open(src, encoding='utf-8').read()
m = re.search(r'<style>(.*?)</style>', h, re.S)
style = m.group(1)
tmpl = h[:m.start(1)] + '/*@@STYLE@@*/' + h[m.end(1):]
blocks = list(re.finditer(r'<script>(.*?)</script>', tmpl, re.S))
# builds from before the challenge pots (src/pots.cjs) have five scripts, later ones six
names = ['CONFIG', 'ENGINE', 'PAYTABLE', 'BOT', 'GAME'] if len(blocks) == 5 else ['CONFIG', 'ENGINE', 'PAYTABLE', 'BOT', 'POTS', 'GAME']
files = {'ENGINE': 'engine.cjs', 'PAYTABLE': 'paytable.cjs', 'BOT': 'bot.cjs', 'POTS': 'pots.cjs', 'GAME': 'game.js'}
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
