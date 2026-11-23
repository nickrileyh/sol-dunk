import asyncio, sys, json, time
from playwright.async_api import async_playwright
from _paths import URL, SHOTS, CHROME
OUT = SHOTS + '/'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=['--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 780}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page = await ctx.new_page()
        logs = []
        page.on('console', lambda m: logs.append(f'{m.type}: {m.text}'))
        page.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        await page.goto(URL)
        await page.wait_for_timeout(2500)
        await page.screenshot(path=OUT + '1_lobby.png')
        await page.click('#playBtn')
        await page.wait_for_timeout(900)
        await page.screenshot(path=OUT + '2_ready.png')
        await page.evaluate("__solDunk.autoplay('pro'); __solDunk.tap()")
        await page.wait_for_timeout(3200)
        await page.screenshot(path=OUT + '3_play.png')
        # wait for checkpoint or over
        phase = None
        for i in range(120):
            phase = await page.evaluate('__solDunk.phase()')
            if phase in ('checkpoint', 'over'): break
            await page.wait_for_timeout(250)
        await page.wait_for_timeout(400)
        await page.screenshot(path=OUT + '4_' + phase + '.png')
        info = await page.evaluate('({phase: __solDunk.phase(), level: __solDunk.run.level, total: __solDunk.run.total, streak: __solDunk.run.streak, bal: __solDunk.wallet.balance})')
        print('after L1:', info)
        if phase == 'checkpoint':
            await page.click('#goBtn')
            await page.wait_for_timeout(1200)
            await page.screenshot(path=OUT + '5_level2_ready.png')
            await page.evaluate("__solDunk.tap()")
            await page.wait_for_timeout(4000)
            await page.screenshot(path=OUT + '6_level2_play.png')
            for i in range(120):
                phase = await page.evaluate('__solDunk.phase()')
                if phase in ('checkpoint', 'over'): break
                await page.wait_for_timeout(250)
            await page.wait_for_timeout(400)
            if phase == 'checkpoint':
                await page.click('#cashBtn')
                await page.wait_for_timeout(1200)
            else:
                await page.wait_for_timeout(1200)
            await page.screenshot(path=OUT + '7_result.png')
        info = await page.evaluate('({phase: __solDunk.phase(), level: __solDunk.run.level, total: __solDunk.run.total, bal: __solDunk.wallet.balance, toast: document.getElementById("toast").textContent})')
        print('end:', info)
        await page.click('[data-panel="odds"]') if await page.is_visible('#lobby:not(.hide)') else None
        print('\n'.join(logs[-20:]) or 'no console output')
        await b.close()
asyncio.run(main())
