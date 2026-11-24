"""Challenge pot, end to end in the demo: its page on the Challenges tab, entering (the entry is debited), completing
the challenge in a run on its tier (live notice + result chip), and closing the pot (the share is paid).
Screenshots to ./shots/pot_*.png. Usage: python3 tools/pot_flow.py"""
import asyncio, re
from playwright.async_api import async_playwright
from _paths import URL, SHOTS, CHROME
OUT = SHOTS + '/pot_'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page = await ctx.new_page(); errs = []; fails = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(URL); await page.wait_for_timeout(2200)
        bal = lambda: page.evaluate("__solDunk.bal()")
        await page.wait_for_function('__solDunk.pot()', timeout=5000)
        goal = await page.evaluate("__solDunk.pot().goal.text")
        await page.click('#tabChallenges'); await page.wait_for_timeout(500)
        if not await page.evaluate("!!document.getElementById('chPotEnter')"): fails.append('the Challenges page has no Enter button on the pot card')
        await page.click('#cBody [data-page="pot"]'); await page.wait_for_timeout(500)
        await page.screenshot(path=OUT + 'sheet.png')
        b0 = await bal()
        await page.click('#potEnter'); await page.wait_for_timeout(600)
        await page.screenshot(path=OUT + 'entered.png')
        b1 = await bal()
        if abs((b0 - b1) - 0.05) > 1e-6: fails.append(f'entry debit {b0} -> {b1}')
        if 'You’re in' not in await page.evaluate("document.getElementById('pgBody').innerText"): fails.append('the pot page does not say you are in')
        await page.click('#pgBack'); await page.wait_for_timeout(450)
        if 'You’re in' not in await page.evaluate("document.querySelector('#cBody .cc-act') ? [...document.querySelectorAll('#cBody .cc-act')].map((e) => e.innerText).join() : ''"): fails.append('the pot card does not say you are in')
        tier = await page.evaluate("__solDunk.pot().goal.tier")
        await page.click('#tabPlay'); await page.wait_for_timeout(400)
        await page.click(f'#diff{tier}'); await page.wait_for_timeout(200)
        await page.click('#playBtn'); await page.wait_for_timeout(700)
        await page.evaluate("__solDunk.autoplay('perfect'); __solDunk.tap()")
        noticed = False
        for i in range(400):
            ph = await page.evaluate('__solDunk.phase()')
            if not noticed and await page.evaluate("document.getElementById('notice').classList.contains('n-pot') && document.getElementById('notice').classList.contains('show')"):
                noticed = True; await page.screenshot(path=OUT + 'notice.png')
            if ph == 'checkpoint':
                done = await page.evaluate("!!(__solDunk.pot().me && __solDunk.pot().me.done)")
                await page.wait_for_timeout(900)
                if done: await page.click('#cashBtn'); break
                await page.click('#goBtn'); await page.wait_for_timeout(900); await page.evaluate('__solDunk.tap()')
            if ph == 'over': break
            await page.wait_for_timeout(120)
        await page.wait_for_timeout(1800)
        await page.screenshot(path=OUT + 'result.png')
        gains = await page.evaluate("document.getElementById('resGains').innerText")
        if not noticed: fails.append('no pot notice during the run')
        if 'Pot challenge done' not in gains: fails.append('no pot chip on the result card: ' + gains)
        await page.click('#lobbyBtn'); await page.wait_for_timeout(800)
        await page.click('#tabChallenges'); await page.wait_for_timeout(600)
        await page.click('#cBody [data-page="pot"]'); await page.wait_for_timeout(500)
        await page.screenshot(path=OUT + 'made.png')
        b2 = await bal()
        await page.click('#potClose'); await page.wait_for_timeout(900)
        b3 = await bal()
        toast = await page.evaluate("document.getElementById('toast').textContent")
        await page.screenshot(path=OUT + 'closed.png')
        won = re.search(r'you won ([0-9.]+) SOL', toast)
        if not won: fails.append('no payout toast: ' + toast)
        elif abs((b3 - b2) - float(won.group(1))) > 1e-4: fails.append(f'payout {won.group(1)} but balance {b2} -> {b3}')
        print('goal', goal, '| toast', toast, '| fails', fails, '| errors', errs)
        await b.close()
asyncio.run(main())
