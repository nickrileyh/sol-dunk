import asyncio
from playwright.async_api import async_playwright
from PIL import Image
from _paths import URL, SHOTS, CHROME
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        ctx = await b.new_context(viewport={'width': 390, 'height': 780}, device_scale_factor=3, is_mobile=True, has_touch=True)
        page = await ctx.new_page()
        await page.goto(URL)
        await page.wait_for_timeout(2200)
        await page.screenshot(path=SHOTS + '/f_lobby.png')
        await page.click('#playBtn'); await page.wait_for_timeout(1300)
        g = await page.evaluate('(() => { const d = __solDunk, gm = d.geom(); return { x: gm.offX + (d.ball.x - d.view.camX) * gm.scale, y: gm.offY + (d.ball.y - d.view.camY) * gm.scale }; })()')
        await page.screenshot(path=SHOTS + '/f_ready.png')
        im = Image.open(SHOTS + '/f_ready.png')
        x, y = int(g['x'] * 3), int(g['y'] * 3)
        im.crop((x - 150, y - 150, x + 150, y + 150)).resize((450, 450)).save(SHOTS + '/f_ball.png')
        print(g)
        await b.close()
asyncio.run(main())
