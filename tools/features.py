# Checks this round's features: first-run guide, streak chip, armed decision cards, seed verification.
import asyncio
from playwright.async_api import async_playwright
from _paths import URL, SHOTS, CHROME
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(URL); await page.wait_for_timeout(1200)
        await page.click('#playBtn'); await page.wait_for_timeout(1000)
        await page.screenshot(path=SHOTS + '/x_guide.png')
        await page.evaluate("__solDunk.autoplay('perfect'); __solDunk.tap()")
        chip = None
        for i in range(200):
            st = await page.evaluate(r"({ph: __solDunk.phase(), s: __solDunk.run.streak, cls: document.getElementById('streak').className, txt: document.getElementById('streak').innerText.replace(/\s+/g, ' ').trim()})")
            if st['s'] >= 3 and chip is None:
                await page.wait_for_timeout(250); await page.screenshot(path=SHOTS + '/x_streak.png', clip={'x': 0, 'y': 0, 'width': 390, 'height': 130}); chip = st
            if st['ph'] == 'checkpoint': break
            await page.wait_for_timeout(100)
        print('chip:', chip)
        # decision buttons must ignore taps for a moment after the card appears
        early = await page.evaluate("(() => { const c = document.getElementById('checkpoint'); return c.classList.contains('arming'); })()")
        await page.evaluate("document.getElementById('goBtn').click()")   # programmatic click while arming: must be ignored
        await page.wait_for_timeout(100)
        still = await page.evaluate("__solDunk.phase()")
        await page.wait_for_timeout(800)
        armed = await page.evaluate("!document.getElementById('checkpoint').classList.contains('arming')")
        print('arming at show:', early, '| phase after early click:', still, '| armed later:', armed)
        await page.click('#cashBtn'); await page.wait_for_timeout(1500)
        res_arming = await page.evaluate("document.getElementById('result').classList.contains('arming')")
        await page.wait_for_timeout(800)
        await page.click('#lobbyBtn'); await page.wait_for_timeout(700)
        await page.click('[data-panel="fair"]'); await page.wait_for_timeout(500)
        await page.click('#fairVerify'); await page.wait_for_timeout(300)
        out = await page.evaluate("document.getElementById('fairOut').className + ' | ' + document.getElementById('fairOut').innerText.slice(0, 120)")
        await page.screenshot(path=SHOTS + '/x_fair.png')
        print('result arming right after cash-out:', res_arming)
        print('verify:', out)
        print('errors', errs)
        await b.close()
asyncio.run(main())
