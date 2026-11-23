import asyncio, json, statistics
from playwright.async_api import async_playwright
from _paths import URL, SHOTS, CHROME
OUT = SHOTS + '/'
JS = """(n) => new Promise((res) => { const d = __solDunk, out = []; let k = 0;
  function f(t) { out.push([t, d.view.drawX - d.view.camX, d.view.drawY, d.phase()]); if (++k < n) requestAnimationFrame(f); else res(out); }
  requestAnimationFrame(f); })"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        ctx = await b.new_context(viewport={'width': 390, 'height': 780}, device_scale_factor=3, is_mobile=True, has_touch=True)
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(URL); await page.wait_for_timeout(1500)
        await page.click('#playBtn'); await page.wait_for_timeout(200)
        # tap mid-glide: ball must ease, not snap
        await page.evaluate("__solDunk.autoplay('pro'); __solDunk.tap()")
        rows = await page.evaluate(JS, 240)
        play = [r for r in rows if r[3] == 'play']
        xs = [r[1] for r in play]
        dx = [abs(xs[i+1]-xs[i]) for i in range(len(xs)-1)]
        ys = [r[2] for r in rows]
        dy = [abs(ys[i+1]-ys[i]) for i in range(len(ys)-1)]
        print('frames', len(rows), 'play', len(play))
        print('screen-x first/last', round(xs[0],2), round(xs[-1],2), 'max frame dx', round(max(dx),3), 'median', round(statistics.median(dx),3))
        print('max frame dy', round(max(dy),2))
        late = dx[60:]
        print('after settle: max dx', round(max(late),3) if late else None)
        print('errors', errs)
        await b.close()
asyncio.run(main())
