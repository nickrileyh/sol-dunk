import asyncio
from playwright.async_api import async_playwright
from PIL import Image
from _paths import URL, SHOTS, CHROME
OUT = SHOTS + '/'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        ctx = await b.new_context(viewport={'width': 390, 'height': 780}, device_scale_factor=3, is_mobile=True, has_touch=True)
        page = await ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(URL)
        await page.wait_for_timeout(4200)   # let the lobby demo run a while
        await page.screenshot(path=OUT + 'g_lobby.png')
        await page.click('#playBtn'); await page.wait_for_timeout(900)
        await page.screenshot(path=OUT + 'g_start.png')     # no leftover demo rings
        await page.evaluate("__solDunk.autoplay('casual'); __solDunk.tap()")
        crops = []
        for k in range(6):
            await page.evaluate("__solDunk.dbg.freezeOnRim = true")
            for i in range(80):
                st = await page.evaluate("({f: __solDunk.dbg.frozen, ph: __solDunk.phase()})")
                if st['f'] or st['ph'] in ('over', 'checkpoint'): break
                await page.wait_for_timeout(100)
            if st['ph'] == 'checkpoint':
                await page.click('#goBtn'); await page.wait_for_timeout(700); await page.evaluate("__solDunk.tap()"); continue
            if st['ph'] == 'over':
                await page.wait_for_timeout(1200); await page.click('#againBtn'); await page.wait_for_timeout(900)
                await page.screenshot(path=OUT + f'g_again_{k}.png')
                await page.evaluate("__solDunk.tap()"); continue
            g = await page.evaluate("(() => { const d = __solDunk, gm = d.geom(); return { x: gm.offX + (d.ball.x - d.view.camX) * gm.scale, y: gm.offY + (d.ball.y - d.view.camY) * gm.scale }; })()")
            await page.screenshot(path=OUT + 'tmp.png')
            im = Image.open(OUT + 'tmp.png'); x, y = int(g['x'] * 3), int(g['y'] * 3)
            crops.append(im.crop((x - 130, y - 110, x + 130, y + 110)))
            await page.evaluate("__solDunk.unfreeze()")
        if crops:
            W = 260 * len(crops); sheet = Image.new('RGB', (W, 220))
            for i, cimg in enumerate(crops): sheet.paste(cimg, (i * 260, 0))
            sheet.save(OUT + 'g_contacts.png')
        print('contacts captured:', len(crops), 'errors:', errs)
        await b.close()
asyncio.run(main())
