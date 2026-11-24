"""The special levels, end to end in the demo: three a day in one card on the Challenges tab (a row each with its twist,
length, prize and Play), each with its own page (a sketch of the course set for the player, the prize, Play, tallies,
the level it's set for and the rules); the entry (debited), the HUD during an attempt (twist name, one segment per
ring, rings done and the prize), a cleared attempt (the prize is paid, the result card, the level goes up), Try again
on the same special, a missed one (nothing paid, where it ended, the level comes down), Play from the tab, Back, the
tallies, the fairness check and Stats. Screenshots to ./shots/special_*.png. Usage: python3 tools/special_flow.py"""
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
        spec = lambda: page.evaluate('__solDunk.special()')
        sp = await spec()
        L = sp['specials'] if sp else []
        check(len(L) == 3 and [s['x'] for s in L] == [2, 3, 5] and all(abs(s['prize'] - sp['fee'] * s['x']) < 1e-9 for s in L), 'three specials, prizes 2x 3x 5x the entry: ' + json.dumps([(s['recipe']['id'], s['prize']) for s in L]))
        check(all(6 <= s['course']['rings'] <= 24 and s['course']['chance'] * s['x'] <= 0.9 + 1e-9 and abs(s['course']['level'] - 1.8) < 1e-9 for s in L), 'a new player\'s courses are set for the starting level: ' + json.dumps([s['course'] for s in L]))
        check(len(set(s['recipe']['id'] for s in L)) == 3, 'three different twists')
        check(await page.evaluate("document.getElementById('badgeC').classList.contains('on')"), 'the Challenges tab has a dot for specials not seen yet')
        await page.click('#tabChallenges'); await page.wait_for_timeout(700)
        check(await page.evaluate("document.body.dataset.tab") == 'challenges' and await page.evaluate("document.querySelectorAll('#cBody .spr').length") == 3 and await page.evaluate("[0,1,2].every((k) => !!document.getElementById('chSpPlay' + k))"), 'the Challenges tab shows the three specials, each with a Play button')
        check(await page.evaluate("!document.getElementById('badgeC').classList.contains('on')"), 'opening it clears the dot')
        txt = await page.evaluate("document.querySelector('#cBody .sp-cc').innerText")
        check(all(s['recipe']['name'] in txt and f"{s['course']['rings']} rings" in txt for s in L), 'each row shows its twist and length: ' + txt.replace('\n', ' | ')[:160])
        await page.screenshot(path=OUT + 'tab.png')

        slot = 2; R = L[slot]
        async def openSpecial(k):
            await page.click(f'#cBody .spr-open[data-slot="{k}"]'); await page.wait_for_timeout(700)
        await openSpecial(slot)
        check(await page.evaluate("__solDunk.nav.page") == 'special' and await page.evaluate("__solDunk.nav.sp") == slot and await page.evaluate("document.getElementById('pgTitle').textContent") == R['recipe']['name'] and await page.evaluate("!!document.getElementById('spPlay')"), 'a row opens that special\'s page, titled with its twist')
        drawn = await page.evaluate("(() => { const c = document.getElementById('spCourse'); if (!c || !c.width) return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; })()")
        check(drawn > 200, f'the sample course is drawn ({drawn} px)')
        ptxt = await page.evaluate("document.getElementById('pgBody').innerText")
        check('This course is set for' in ptxt and 'Average' in ptxt and 'over time you get back about 90%' in ptxt, 'the page says the level the course is set for, and the rules')
        await page.screenshot(path=OUT + 'page.png', full_page=True)

        async def attempt(skill, shot, how):
            b0 = await bal()
            before = (await spec())['specials'][slot]
            await page.click({'page': '#spPlay', 'again': '#againBtn'}[how])
            await page.wait_for_timeout(800)
            n = before['course']['rings']
            check(await page.evaluate('__solDunk.mode()') == 'special' and abs((b0 - await bal()) - sp['fee']) < 1e-9, f'{skill}: the entry is debited ({b0} -> {await bal()})')
            hud = await page.evaluate("[document.getElementById('hudLevel').textContent, document.querySelectorAll('#pips .seg-i').length, document.getElementById('hudMult').textContent, document.getElementById('hudPot').textContent, document.getElementById('potCap').classList.contains('prize')]")
            check(hud[0] == R['recipe']['name'] and hud[1] == n and hud[2] == '0/' + str(n) and abs(float(hud[3]) - R['prize']) < 1e-4 and hud[4], f'HUD shows the course offered ({n} rings): ' + json.dumps(hud))
            await page.evaluate(f"__solDunk.autoplay('{skill}'); __solDunk.tap()")
            await page.wait_for_timeout(2500)
            await page.screenshot(path=OUT + shot + '_play.png')
            for i in range(700):
                if await page.evaluate('__solDunk.phase()') == 'over' and await page.evaluate("!document.getElementById('result').classList.contains('hide')"): break
                await page.wait_for_timeout(100)
            await page.wait_for_timeout(1200)
            await page.screenshot(path=OUT + shot + '_result.png')
            t = await page.evaluate("[document.getElementById('resTitle').textContent, document.getElementById('resSub').textContent, document.getElementById('againT').textContent, document.getElementById('lobbyBtn').textContent]")
            after = (await spec())['specials'][slot]
            return b0, t, before, after
        # a cleared attempt on the 5x special (the perfect autopilot almost always clears it; give it three tries)
        won, how = False, 'page'
        for k in range(3):
            b0, t, before, after = await attempt('perfect', 'win' if k == 0 else f'win{k}', how); how = 'again'
            if t[0] == 'Special cleared': won = True; break
        check(won, 'the perfect autopilot clears the special: ' + json.dumps(t))
        if won:
            check(abs(await bal() - (b0 - sp['fee'] + R['prize'])) < 1e-9, f"the prize is paid ({b0} -> {await bal()})")
            check(t[2] == 'Try again' and t[3] == 'Back', 'the result card offers Try again and Back: ' + json.dumps(t))
            lv0, lv1 = before['course']['level'], after['course']['level']
            up = await page.evaluate(f"window.DunkSpecial.up({R['x']})")
            check(abs(lv1 - min(5, lv0 + up)) < 0.01, f'clearing it raises its level by {up:.2f} ({lv0} -> {lv1})')
            harder = await page.evaluate(f"(() => {{ const S = window.DunkSpecial; return S.clearP('{R['recipe']['id']}', {after['course']['grade']}, {after['course']['rings']}, 2) < S.clearP('{R['recipe']['id']}', {before['course']['grade']}, {before['course']['rings']}, 2); }})()")
            check(harder, 'the next course is harder: ' + json.dumps([before['course'], after['course']]))
        # Try again: the same special, then a missed attempt
        lost = False
        for k in range(3):
            b0, t, before, after = await attempt('novice', 'loss' if k == 0 else f'loss{k}', 'again')
            if t[0] != 'Special cleared': lost = True; break
        check(lost and 'out at ring' in t[1], 'a missed attempt says where it ended: ' + json.dumps(t))
        if lost:
            check(abs(await bal() - (b0 - sp['fee'])) < 1e-9, 'a missed attempt pays nothing')
            check(abs(after['course']['level'] - max(-1, before['course']['level'] - 0.3)) < 0.01, f"missing lowers its level by 0.3 ({before['course']['level']} -> {after['course']['level']})")
        h = await page.evaluate('__solDunk.stats.history[0]')
        check(h['kind'] == 'special' and h['slot'] == slot and h['recipe'] == R['recipe']['id'] and h['n'] >= 6 and h['serverSeed'], 'the attempt is in the history with its course and seed')
        await page.click('#lobbyBtn'); await page.wait_for_timeout(800)
        check(await page.evaluate("document.body.dataset.tab") == 'challenges' and await page.evaluate("__solDunk.phase()") == 'lobby', 'Back returns to Challenges')
        # Play straight from the tab's row (the 2x special)
        b0 = await bal(); R0 = (await spec())['specials'][0]
        await page.click('#chSpPlay0'); await page.wait_for_timeout(800)
        hud = await page.evaluate("[document.getElementById('hudLevel').textContent, document.querySelectorAll('#pips .seg-i').length]")
        check(await page.evaluate('__solDunk.mode()') == 'special' and hud[0] == R0['recipe']['name'] and hud[1] == R0['course']['rings'] and abs((b0 - await bal()) - sp['fee']) < 1e-9, 'Play on a row starts that special: ' + json.dumps(hud))
        await page.evaluate("__solDunk.autoplay('novice'); __solDunk.tap()")
        for i in range(700):
            if await page.evaluate('__solDunk.phase()') == 'over' and await page.evaluate("!document.getElementById('result').classList.contains('hide')"): break
            await page.wait_for_timeout(100)
        await page.wait_for_timeout(1000)
        await page.click('#lobbyBtn'); await page.wait_for_timeout(800)
        sp2 = await spec()
        me = sp2['specials'][slot]['me']
        check(me['tries'] >= 2 and me['wins'] >= 1 and sp2['specials'][0]['me']['tries'] == 1 and sp2['specials'][1]['me']['tries'] == 0, 'tries and wins today, by special: ' + json.dumps([o['me'] for o in sp2['specials']]))
        await openSpecial(slot)
        tiles = await page.evaluate("document.querySelector('#pgBody .tiles').innerText")
        check(str(me['tries']) in tiles and str(me['wins']) in tiles, 'the special\'s page shows the tally: ' + tiles.replace('\n', ' | '))
        await page.screenshot(path=OUT + 'after.png', full_page=True)
        await page.click('#pgBack'); await page.wait_for_timeout(400)
        # fairness: the special's seed and course verify
        await page.click('#tabPlay'); await page.wait_for_timeout(400)
        await page.click('#lobby .foot-link'); await page.wait_for_timeout(500)   # Odds & fairness
        await page.click('#fairVerify'); await page.wait_for_timeout(300)
        out = await page.evaluate("document.getElementById('fairOut').innerText")
        check('Verified' in out and 'Special' in out and 'Course' in out, 'the fairness check verifies the special: ' + out[:120].replace('\n', ' | '))
        await page.click('#pgBack'); await page.wait_for_timeout(400)
        # recent runs (on the Stats page from Profile) says how each special attempt ended
        await page.click('#tabProfile'); await page.wait_for_timeout(400)
        await page.click('#pBody [data-page="stats"]'); await page.wait_for_timeout(400)
        runs = await page.evaluate("document.getElementById('pgBody').innerText")
        check('Cleared ' + R['recipe']['name'] in runs and 'Missed ' + R['recipe']['name'] in runs and 'Special level' in runs, 'Recent runs lists the special attempts')
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
