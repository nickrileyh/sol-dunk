# Exact 60 fps frames of a bot run (held clock, stepped one frame at a time), cropped around the ball.
# Writes shots/clip_<name>/NNN.png, a contact sheet shots/clip_<name>.png and, with ffmpeg, shots/clip_<name>.mp4.
# python3 tools/clip.py <name> [streak=3|none] [frames=90] [sheet_every=3] [half=110, 0 = whole screen] [unused] [skill=pro] [warm_ms=1500]
# (the sixth argument used to pick a flame; there is one flame now, in Solana's colours)
import asyncio, base64, io, os, shutil, subprocess, sys
from playwright.async_api import async_playwright
from PIL import Image
from _paths import URL, SHOTS, CHROME
a = sys.argv
name = a[1] if len(a) > 1 else 'clip'
streak = a[2] if len(a) > 2 else '3'
frames = int(a[3]) if len(a) > 3 else 90
every = int(a[4]) if len(a) > 4 else 3
half = int(a[5]) if len(a) > 5 else 110
skill = a[7] if len(a) > 7 else 'pro'
warm = int(a[8]) if len(a) > 8 else 1500
out = f'{SHOTS}/clip_{name}'
async def main():
    shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(URL); await page.wait_for_timeout(2000)
        await page.click('#playBtn'); await page.wait_for_timeout(700)
        fx = 'null' if streak == 'none' else streak
        await page.evaluate(f"__solDunk.fx({fx}); __solDunk.autoplay('{skill}'); __solDunk.tap()")
        await page.wait_for_timeout(warm)
        await page.evaluate("__solDunk.hold(true)")
        tiles = []
        for i in range(frames):
            await page.evaluate("__solDunk.step(1)")
            await page.wait_for_function("__solDunk.stepsLeft() === 0")
            r = await page.evaluate("""() => { const p = __solDunk.ballScreen(); const cv = document.getElementById('game'); return { url: cv.toDataURL('image/png'), x: p.x, y: p.y, k: cv.width / innerWidth }; }""")
            im = Image.open(io.BytesIO(base64.b64decode(r['url'].split(',')[1])))
            k = r['k']; x, y = int(r['x'] * k), int(r['y'] * k)
            if half:  # keep the crop inside the canvas (the ball sits near the left edge)
                hk = int(half * k); x = min(max(x, hk), im.width - hk); y = min(max(y, hk), im.height - hk)
            t = im.crop((x - hk, y - hk, x + hk, y + hk)).resize((half * 2, half * 2)) if half else im.resize((int(im.width / k * 2 / 3), int(im.height / k * 2 / 3)))
            t.save(f'{out}/{i:03d}.png'); tiles.append(t)
        sheet = tiles[::every]; cols = 6; rows = (len(sheet) + cols - 1) // cols
        TW = 180 if half else 130; TH = 180 if half else int(130 * tiles[0].height / tiles[0].width)
        im = Image.new('RGB', (cols * TW, rows * TH))
        for i, t in enumerate(sheet): im.paste(t.resize((TW, TH)), ((i % cols) * TW, (i // cols) * TH))
        im.save(f'{out}.png')
        print('errors', errs)
        await b.close()
    if shutil.which('ffmpeg'):
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '60', '-i', f'{out}/%03d.png', '-vf', 'scale=440:-2', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', f'{out}.mp4'], check=False)
asyncio.run(main())
