"""The special level, end to end in the demo: its card on the Challenges tab and its own page, the entry (debited), the HUD during
an attempt (recipe name, one segment per ring, rings done and the prize), a cleared attempt (the prize is paid, the
result card, tries and wins), a missed one (nothing paid, where it ended), Try again, Back, the history and the
fairness check. Screenshots to ./shots/special_*.png. Usage: python3 tools/special_flow.py"""
import asyncio, json
from playwright.async_api import async_playwright
from _paths import URL, SHOTS, CHROME
OUT = SHOTS + '/special_'
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
        sp = await page.evaluate('__solDunk.special()')
        check(sp and sp['prize'] > sp['fee'] and sp['recipe']['rings'] >= 12, 'today\'s special: ' + json.dumps(sp and sp['recipe']))
        check(await page.evaluate("document.getElementById('badgeC').classList.contains('on')"), 'the Challenges tab has a dot for a special not seen yet')
        await page.click('#tabChallenges'); await page.wait_for_timeout(700)
        check(await page.evaluate("document.body.dataset.tab") == 'challenges' and await page.evaluate("!document.getElementById('vChallenges').classList.contains('hide') && !!document.getElementById('chSpPlay')"), 'the Challenges tab shows today\'s special with its Play button')
        check(await page.evaluate("!document.getElementById('badgeC').classList.contains('on')"), 'opening it clears the dot')
        await page.click('#cBody [data-page="special"]'); await page.wait_for_timeout(700)
        check(await page.evaluate("__solDunk.nav.page") == 'special' and await page.evaluate("!!document.getElementById('spPlay')"), 'the card opens the special\'s own page')
        drawn = await page.evaluate("(() => { const c = document.getElementById('spCourse'); if (!c || !c.width) return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; })()")
        check(drawn > 200, f'the sample course is drawn ({drawn} px)')
        await page.screenshot(path=OUT + 'page.png')

        async def attempt(skill, shot):
            b0 = await bal()
            await page.click('#spPlay' if await page.evaluate('__solDunk.phase()') == 'lobby' else '#againBtn')
            await page.wait_for_timeout(800)
            check(await page.evaluate('__solDunk.mode()') == 'special' and abs((b0 - await bal()) - sp['fee']) < 1e-9, f'{skill}: the entry is debited ({b0} -> {await bal()})')
            hud = await page.evaluate("[document.getElementById('hudLevel').textContent, document.querySelectorAll('#pips .seg-i').length, document.getElementById('hudMult').textContent, document.getElementById('hudPot').textContent, document.getElementById('potCap').classList.contains('prize')]")
            check(hud[0] == sp['recipe']['name'] and hud[1] == sp['recipe']['rings'] and hud[2] == '0/' + str(sp['recipe']['rings']) and abs(float(hud[3]) - sp['prize']) < 1e-4 and hud[4], 'HUD: ' + json.dumps(hud))
            await page.evaluate(f"__solDunk.autoplay('{skill}'); __solDunk.tap()")
            await page.wait_for_timeout(2500)
            await page.screenshot(path=OUT + shot + '_play.png')
            for i in range(600):
                if await page.evaluate('__solDunk.phase()') == 'over' and await page.evaluate("!document.getElementById('result').classList.contains('hide')"): break
                await page.wait_for_timeout(100)
            await page.wait_for_timeout(1200)
            await page.screenshot(path=OUT + shot + '_result.png')
            t = await page.evaluate("[document.getElementById('resTitle').textContent, document.getElementById('resSub').textContent, document.getElementById('againT').textContent, document.getElementById('lobbyBtn').textContent]")
            return b0, t
        # a cleared attempt (the perfect autopilot almost always clears it; give it three tries)
        won = False
        for k in range(3):
            b0, t = await attempt('perfect', 'win' if k == 0 else f'win{k}')
            if t[0] == 'Special cleared': won = True; break
        check(won, 'the perfect autopilot clears the special: ' + json.dumps(t))
        if won:
            check(abs(await bal() - (b0 - sp['fee'] + sp['prize'])) < 1e-9, f"the prize is paid ({b0} -> {await bal()})")
            check(t[2] == 'Try again' and t[3] == 'Back', 'the result card offers Try again and Back: ' + json.dumps(t))
        # a missed attempt
        lost = False
        for k in range(3):
            b0, t = await attempt('novice', 'loss' if k == 0 else f'loss{k}')
            if t[0] != 'Special cleared': lost = True; break
        check(lost and 'out at ring' in t[1], 'a missed attempt says where it ended: ' + json.dumps(t))
        if lost: check(abs(await bal() - (b0 - sp['fee'])) < 1e-9, 'a missed attempt pays nothing')
        h = await page.evaluate('__solDunk.stats.history[0]')
        check(h['kind'] == 'special' and h['recipe'] == sp['recipe']['id'] and h['serverSeed'], 'the attempt is in the history with its seed')
        await page.click('#lobbyBtn'); await page.wait_for_timeout(800)
        check(await page.evaluate("document.body.dataset.tab") == 'challenges' and await page.evaluate("__solDunk.phase()") == 'lobby', 'Back returns to Challenges')
        me = await page.evaluate('__solDunk.special().me')
        check(me['tries'] >= 2 and me['wins'] >= 1, 'tries and wins today: ' + json.dumps(me))
        await page.click('#cBody [data-page="special"]'); await page.wait_for_timeout(600)
        tiles = await page.evaluate("document.querySelector('#pgBody .tiles').innerText")
        check(str(me['tries']) in tiles, 'the page shows the tally')
        await page.click('#pgBack'); await page.wait_for_timeout(400)
        # fairness: the special's seed verifies
        await page.click('#tabPlay'); await page.wait_for_timeout(400)
        await page.click('#lobby .foot-link'); await page.wait_for_timeout(500)   # Odds & fairness
        await page.click('#fairVerify'); await page.wait_for_timeout(300)
        out = await page.evaluate("document.getElementById('fairOut').innerText")
        check('Verified' in out and 'Special' in out, 'the fairness check verifies the special: ' + out[:80])
        await page.click('#pgBack'); await page.wait_for_timeout(400)
        # recent runs (on the Stats page from Profile) says how each special attempt ended
        await page.click('#tabProfile'); await page.wait_for_timeout(400)
        await page.click('#pBody [data-page="stats"]'); await page.wait_for_timeout(400)
        runs = await page.evaluate("document.getElementById('pgBody').innerText")
        check('Cleared ' + sp['recipe']['name'] in runs and 'Missed ' + sp['recipe']['name'] in runs and 'Special level' in runs, 'Recent runs lists the special attempts')
        await page.click('#pgBack'); await page.wait_for_timeout(400)
        # the daily pot has its own page
        await page.click('#tabChallenges'); await page.wait_for_timeout(500)
        await page.click('#cBody [data-page="pot"]'); await page.wait_for_timeout(500)
        check(await page.evaluate("!!document.getElementById('potEnter') || document.getElementById('pgBody').innerText.includes('You’re in')"), 'the Daily pot page has the pot')
        await page.screenshot(path=OUT + 'pot.png')
        check(not errs, 'no page errors ' + json.dumps(errs))
        await b.close()
    print('FAILS', fails if fails else 'none')
asyncio.run(main())
