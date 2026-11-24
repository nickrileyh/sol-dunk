import asyncio
from playwright.async_api import async_playwright
from _paths import URL, SHOTS, CHROME
OUT = SHOTS + '/'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        ctx = await b.new_context(viewport={'width': 390, 'height': 780}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page = await ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(URL); await page.wait_for_timeout(1500)
        await page.evaluate("document.querySelector('#diff1').click()")
        await page.click('#playBtn'); await page.wait_for_timeout(800)
        await page.evaluate("__solDunk.autoplay('perfect'); __solDunk.tap()")
        shot = 0
        for i in range(900):
            ph = await page.evaluate('__solDunk.phase()')
            lvl = await page.evaluate('__solDunk.run.level')
            if ph == 'checkpoint':
                if lvl in (2, 4): await page.screenshot(path=OUT + f'h_cp{lvl}.png')
                await page.click('#goBtn'); await page.wait_for_timeout(800)
                if lvl == 2: await page.screenshot(path=OUT + 'h_l3_ready.png')
                await page.evaluate('__solDunk.tap()')
            elif ph == 'over':
                await page.wait_for_timeout(1000); await page.screenshot(path=OUT + 'h_over.png'); break
            elif ph == 'play' and lvl >= 3 and shot < 4 and i % 9 == 0:
                await page.screenshot(path=OUT + f'h_play{shot}_L{lvl}.png'); shot += 1
            await page.wait_for_timeout(110)
        print('errors:', errs, 'final level', await page.evaluate('__solDunk.run.level'), await page.evaluate('__solDunk.run.total'))
        await b.close()
asyncio.run(main())
