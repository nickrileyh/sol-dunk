import asyncio, sys
from playwright.async_api import async_playwright
from PIL import Image
from _paths import URL, SHOTS, CHROME
OUT = SHOTS + '/a_'
W, H = 390, 844
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        ctx = await b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(URL); await page.wait_for_timeout(3000)
        await page.screenshot(path=OUT + 'lobby.png')
        for name in ['how', 'odds', 'stats', 'fair']:
            await page.click(f'[data-panel="{name}"]'); await page.wait_for_timeout(500)
            await page.screenshot(path=OUT + 'panel_' + name + '.png')
            await page.click('#panelClose'); await page.wait_for_timeout(400)
        await page.click('#balBtn'); await page.wait_for_timeout(500); await page.screenshot(path=OUT + 'wallet.png')
        await page.click('#panelClose'); await page.wait_for_timeout(400)
        await page.click('#menuBtn'); await page.wait_for_timeout(500); await page.screenshot(path=OUT + 'menu.png')
        await page.click('#panelClose'); await page.wait_for_timeout(400)
        await page.click('#playBtn'); await page.wait_for_timeout(250)
        await page.screenshot(path=OUT + 'glide.png')
        await page.wait_for_timeout(700)
        await page.screenshot(path=OUT + 'ready.png')
        await page.evaluate("__solDunk.autoplay('good'); __solDunk.tap()")
        await page.wait_for_timeout(1800); await page.screenshot(path=OUT + 'play1.png')
        await page.wait_for_timeout(1300); await page.screenshot(path=OUT + 'play2.png')
        for i in range(160):
            ph = await page.evaluate('__solDunk.phase()')
            if ph in ('checkpoint', 'over'): break
            await page.wait_for_timeout(120)
        await page.wait_for_timeout(700); await page.screenshot(path=OUT + 'after1.png')
        if ph == 'checkpoint':
            await page.click('#goBtn'); await page.wait_for_timeout(1200); await page.screenshot(path=OUT + 'level2.png')
            await page.evaluate("__solDunk.autoplay(null)")
            await page.evaluate("__solDunk.tap()")
            for i in range(100):
                ph = await page.evaluate('__solDunk.phase()')
                if ph == 'over': break
                await page.wait_for_timeout(120)
            await page.wait_for_timeout(300); await page.screenshot(path=OUT + 'bust_moment.png')
            await page.wait_for_timeout(1400); await page.screenshot(path=OUT + 'result.png')
        print('errors', errs)
        await b.close()
asyncio.run(main())
