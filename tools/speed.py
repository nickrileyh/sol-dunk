"""Deep-run readability check: plays a perfect-bot run deep into a tier, and each time a ring is
passed records where the NEXT ring sits on screen. A ring is "in view" if all of it is inside the
window everyone sees (wide screens fade their sides to the same window). Also screenshots L1/L4/L7.
Usage: python3 tools/speed.py [html] [tier 0-3] [width height]"""
import asyncio, sys, json
from playwright.async_api import async_playwright
from _paths import URL, SHOTS, CHROME
HTML = ('file://' + sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1] != '-' else URL
TIER = int(sys.argv[2]) if len(sys.argv) > 2 else 1
W = int(sys.argv[3]) if len(sys.argv) > 3 else 390
H = int(sys.argv[4]) if len(sys.argv) > 4 else 844
TAG = sys.argv[5] if len(sys.argv) > 5 else 'speed'
PROBE = """(() => { const d = __solDunk, v = d.view, g = d.geom(), st = d.run.st;
  if (!st || d.phase() !== 'play') return null;
  const S = g.scale * v.zoom, ox = (innerWidth - 352 * S) / 2, h = st.hoops[st.next];
  if (!h) return null;
  const x = ox + (v.offset + h.x - v.camX) * S, right = g.offX + 352 * g.scale;
  return { L: d.run.level, next: st.next, edge: Math.round(right - (x + (h.w / 2 + DunkEngine.PHYS.RP) * S)), zoom: +v.zoom.toFixed(3) }; })()"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        ctx = await b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=2, is_mobile=W < 700, has_touch=W < 700)
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(HTML); await page.wait_for_timeout(1500)
        await page.evaluate(f"document.querySelector('#diff{TIER}').click()")
        await page.click('#playBtn'); await page.wait_for_timeout(700)
        await page.evaluate("__solDunk.autoplay('perfect'); __solDunk.tap()")
        last = None; rows = {}; shot = set()
        for i in range(6000):
            ph = await page.evaluate('__solDunk.phase()')
            if ph == 'checkpoint':
                await page.wait_for_timeout(700)
                await page.evaluate("document.getElementById('goBtn').click()"); await page.wait_for_timeout(600)
                await page.evaluate('__solDunk.tap()'); last = None; continue
            if ph == 'over': break
            r = await page.evaluate(PROBE)
            if r:
                key = (r['L'], r['next'])
                if key != last and r['next'] > 0:  # the ring before this one was just passed
                    rows.setdefault(r['L'], []).append(r['edge']); last = key
                if r['L'] in (1, 4, 7) and r['L'] not in shot and r['next'] == 3:
                    await page.screenshot(path=SHOTS + f'/{TAG}_L{r["L"]}.png'); shot.add(r['L'])
            await page.wait_for_timeout(15)
        z = await page.evaluate('__solDunk.view.zoom')
        print(TAG, 'tier', TIER, f'{W}x{H}', '| final level', await page.evaluate('__solDunk.run.level'), '| zoom at end', round(z, 3))
        for L in sorted(rows):
            e = rows[L]
            print(f'  L{L}: next ring fully in view on passing {sum(1 for x in e if x >= 0)}/{len(e)}   (px to spare: min {min(e)}, median {sorted(e)[len(e) // 2]})')
        print('  errors', errs)
        await b.close()
asyncio.run(main())
