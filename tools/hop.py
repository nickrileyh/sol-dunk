# Filmstrip of the ball around a flap, captured from the canvas on consecutive frames.
import asyncio, base64, io, sys
from playwright.async_api import async_playwright
from PIL import Image
from _paths import URL, SHOTS, CHROME
OUT = SHOTS + '/'
JS = """(n) => new Promise((res) => { const d = __solDunk, out = []; let k = 0;
  function f() { const gm = d.geom(), cv = document.getElementById('game');
    out.push({ url: cv.toDataURL('image/png'), x: gm.offX + (d.view.drawX - d.view.camX) * gm.scale, y: gm.offY + (d.view.drawY - d.view.camY) * gm.scale, tilt: d.ball.tilt, vy: d.ball.vy });
    if (++k < n) requestAnimationFrame(f); else res(out); }
  requestAnimationFrame(f); })"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(URL); await page.wait_for_timeout(1200)
        await page.click('#playBtn'); await page.wait_for_timeout(900)
        await page.evaluate("__solDunk.tap()")   # start: first flap
        await page.wait_for_timeout(450)
        await page.evaluate("__solDunk.tap()")
        frames = await page.evaluate(JS, 40)
        crops = []
        for i, f in enumerate(frames):
            if i % 3: continue
            im = Image.open(io.BytesIO(base64.b64decode(f['url'].split(',')[1])))
            x, y = int(f['x'] * 2), int(f['y'] * 2)
            crops.append(im.crop((x - 70, y - 75, x + 70, y + 55)))
        sheet = Image.new('RGB', (140 * len(crops), 130))
        for i, c in enumerate(crops): sheet.paste(c, (i * 140, 0))
        sheet.save(OUT + 'hop.png')
        print('tilt per 3 frames:', [round(f['tilt'] * 57.3) for i, f in enumerate(frames) if i % 3 == 0])
        print('errors', errs)
        await b.close()
asyncio.run(main())
