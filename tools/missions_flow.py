"""Missions that pay SOL, end to end in the demo: progress from every run, SOL that waits until the day's play reaches
its need (the result card says how much more), paid the moment a bet gets there (a notice, the balance), and the
daily missions on the Challenges tab marking it paid. Screenshots to ./shots/missions_*.png. Usage: python3 tools/missions_flow.py"""
import asyncio, json
from playwright.async_api import async_playwright
from _paths import URL, SHOTS, CHROME
OUT = SHOTS + '/missions_'
fails = []
def check(ok, what):
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok: fails.append(what)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(URL); await page.wait_for_timeout(1500)
        bal = lambda: page.evaluate('__solDunk.bal()')
        mv = lambda: page.evaluate('__solDunk.missions()')
        m0 = await mv()
        need = m0['need']['day']
        check(len(m0['daily']) == 3 and len(m0['weekly']) == 3 and m0['played']['day'] == 0 and need > 0, 'three daily and three weekly missions, nothing played yet')
        check(all(c['reward'] > 0 for c in m0['daily'] + m0['weekly']), 'every daily and weekly mission pays SOL')
        await page.click('#diff0'); await page.fill('#betInput', '1'); await page.evaluate("document.getElementById('betInput').blur()"); await page.wait_for_timeout(200)

        async def run(levels, shot):
            await page.click('#playBtn' if await page.evaluate('__solDunk.phase()') == 'lobby' else '#againBtn'); await page.wait_for_timeout(800)
            await page.evaluate("__solDunk.autoplay('perfect'); __solDunk.tap()")
            for i in range(900):
                ph = await page.evaluate('__solDunk.phase()')
                if ph == 'checkpoint':
                    await page.wait_for_timeout(800)
                    if await page.evaluate('__solDunk.run.level') >= levels: await page.click('#cashBtn'); break
                    await page.click('#goBtn'); await page.wait_for_timeout(900); await page.evaluate('__solDunk.tap()')
                if ph == 'over': break
                await page.wait_for_timeout(100)
            await page.wait_for_timeout(2200)
            await page.screenshot(path=OUT + shot + '.png')
        # run 1: half the day's need; missions get done but their SOL waits
        await run(5, 'run1')
        m1 = await mv()
        done1 = [c for c in m1['daily'] if c['done']]
        check(m1['played']['day'] == 1 and done1, 'run 1: 1 SOL played and daily missions done: ' + json.dumps([(c['k'], c['p'], c['n']) for c in m1['daily']]))
        check(all(not c['paid'] for c in done1), 'their SOL waits until the day\'s play reaches ' + str(need))
        gains = await page.evaluate("document.getElementById('resGains').innerText")
        check('SOL waiting' in gains and 'SOL more today' in gains, 'the result card says how much more play unlocks it: ' + gains.replace('\n', ' | '))
        # run 2: the bet reaches the need, so everything already done pays at once
        b0 = await bal()
        await page.click('#againBtn'); await page.wait_for_timeout(500)
        b1 = await bal()
        m2 = await mv()
        owed = sum(c['reward'] for c in done1)
        check(abs((b1 - b0) - (owed - 1)) < 1e-9, f'run 2 start: the bet is taken and {owed} SOL of rewards paid ({b0} -> {b1})')
        check(all(c['paid'] for c in m2['daily'] if c['done']), 'every done daily mission is paid')
        note = await page.evaluate("document.getElementById('notice').innerText")
        check('Mission rewards' in note, 'a notice says the rewards were paid: ' + note.replace('\n', ' | '))
        await page.screenshot(path=OUT + 'paid.png')
        await page.evaluate("__solDunk.autoplay('perfect'); __solDunk.tap()")
        for i in range(900):
            ph = await page.evaluate('__solDunk.phase()')
            if ph == 'checkpoint': await page.wait_for_timeout(800); await page.click('#cashBtn'); break
            if ph == 'over': break
            await page.wait_for_timeout(100)
        await page.wait_for_timeout(2200)
        await page.click('#lobbyBtn'); await page.wait_for_timeout(500)
        await page.click('#tabChallenges'); await page.wait_for_timeout(600)
        txt = await page.evaluate("document.getElementById('cBody').innerText")
        check('SOL paid' in txt and 'SOL rewards unlocked today' in txt, 'the daily missions on Challenges show the SOL paid and the day unlocked')
        await page.screenshot(path=OUT + 'page.png')
        # the special level's entry counts as play too
        p0 = (await mv())['played']['day']
        await page.click('#tabChallenges'); await page.wait_for_timeout(500)
        fee = await page.evaluate('__solDunk.special().fee')
        await page.click('#chSpPlay0'); await page.wait_for_timeout(600)
        check(abs((await mv())['played']['day'] - (p0 + fee)) < 1e-9, 'a special level entry counts as play')
        check(not errs, 'no page errors ' + json.dumps(errs))
        await b.close()
    print('FAILS', fails if fails else 'none')
asyncio.run(main())
