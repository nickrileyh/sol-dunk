import asyncio
from playwright.async_api import async_playwright
from PIL import Image
from _paths import URL, SHOTS, CHROME
OUT = SHOTS + '/'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        ctx = await b.new_context(viewport={'width': 390, 'height': 780}, device_scale_factor=3, is_mobile=True, has_touch=True)
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(URL); await page.wait_for_timeout(3000)
        await page.screenshot(path=OUT + 'k_lobby.png')
        await page.click('#playBtn'); await page.wait_for_timeout(900)
        await page.evaluate("__solDunk.autoplay('pro'); __solDunk.tap()")
        await page.wait_for_timeout(2600); await page.screenshot(path=OUT + 'k_play.png')
        # close-up of ball near a ring
        g = await page.evaluate("(() => { const d = __solDunk, gm = d.geom(); return { x: gm.offX + (d.ball.x - d.view.camX) * gm.scale, y: gm.offY + (d.ball.y - d.view.camY) * gm.scale }; })()")
        im = Image.open(OUT + 'k_play.png'); x, y = int(g['x'] * 3), int(g['y'] * 3)
        im.crop((max(0, x - 220), max(0, y - 200), x + 420, y + 260)).save(OUT + 'k_close.png')
        for i in range(100):
            if await page.evaluate('__solDunk.phase()') in ('checkpoint', 'over'): break
            await page.wait_for_timeout(150)
        await page.wait_for_timeout(500); await page.screenshot(path=OUT + 'k_cp.png')
        print('errors', errs)
        await b.close()
asyncio.run(main())
