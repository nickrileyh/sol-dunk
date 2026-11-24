# Screens for a visual review: lobby, ready, mid-play, on fire, nova, checkpoint, result; plus ball close-ups.
import asyncio, base64, io
from playwright.async_api import async_playwright
from PIL import Image
from _paths import URL, SHOTS, CHROME
OUT = SHOTS + '/r_'
async def canvas_crop(page, name, half=110):
    r = await page.evaluate("""() => { const d = __solDunk, p = d.ballScreen(); const cv = document.getElementById('game'); return { url: cv.toDataURL('image/png'), x: p.x, y: p.y, k: cv.width / innerWidth }; }""")
    im = Image.open(io.BytesIO(base64.b64decode(r['url'].split(',')[1])))
    k = r['k']; x, y = int(r['x'] * k), int(r['y'] * k)
    hk = int(half * k); im.crop((x - hk, y - hk, x + hk, y + hk)).resize((half * 2, half * 2)).save(OUT + name + '.png')
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(URL); await page.wait_for_timeout(2600)
        await page.screenshot(path=OUT + 'lobby.png')
        await page.click('#playBtn'); await page.wait_for_timeout(1000)
        await page.screenshot(path=OUT + 'ready.png')
        await canvas_crop(page, 'ball_ready')
        await page.evaluate("__solDunk.autoplay('pro'); __solDunk.tap()")
        await page.wait_for_timeout(1400); await page.screenshot(path=OUT + 'play.png')
        await canvas_crop(page, 'ball_play')
        await page.evaluate("__solDunk.fx(3)"); await page.wait_for_timeout(700)
        await page.evaluate("__solDunk.hold(true)"); await page.screenshot(path=OUT + 'fire.png'); await canvas_crop(page, 'ball_fire'); await page.evaluate("__solDunk.hold(false)")
        await page.evaluate("__solDunk.fx(5)"); await page.wait_for_timeout(900)
        await page.evaluate("__solDunk.hold(true)"); await canvas_crop(page, 'ball_nova'); await page.evaluate("__solDunk.hold(false)")
        await page.evaluate("__solDunk.fx(null)")
        for i in range(160):
            if await page.evaluate('__solDunk.phase()') in ('checkpoint', 'over'): break
            await page.wait_for_timeout(120)
        await page.wait_for_timeout(1000); await page.screenshot(path=OUT + 'cp.png')
        if await page.evaluate('__solDunk.phase()') == 'checkpoint':
            await page.click('#cashBtn'); await page.wait_for_timeout(1600)
        await page.screenshot(path=OUT + 'result.png')
        print('errors', errs)
        await b.close()
asyncio.run(main())
