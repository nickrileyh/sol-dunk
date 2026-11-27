"""Missions that pay SOL, end to end in the demo: progress from every run, SOL that waits until the day's play reaches
its round's need (the result card says how much more), released to claim the moment a bet gets there (a notice, nothing
credited yet), claimed with a mission's Claim key on the Missions tab (coins into the balance, the row says claimed) or
the result card's ticket, SOL from an earlier day claimed from its own ticket, the daily missions with their three
rounds, a finished round opening the next, the next mission on the result card, and level-up rakeback (set aside by a
bet, released by a level up, claimed once).
Screenshots to ./shots/missions_*.png. Usage: python3 tools/missions_flow.py"""
import asyncio, json
from playwright.async_api import async_playwright
from _paths import URL, SHOTS, CHROME
OUT = SHOTS + '/missions_'
# The day's missions are drawn from the UTC date, and on some days the perfect bot finishes all of round 1 in the
# first run, which opens round 2 before the checks below expect it. The clock is held on one day (timers still run),
# so the check plays the same missions whatever the date.
DAY = '2026-11-26T12:00:00Z'
fails = []
def check(ok, what):
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok: fails.append(what)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        await ctx.clock.set_fixed_time(DAY)
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(URL); await page.wait_for_timeout(1500)
        bal = lambda: page.evaluate('__solDunk.bal()')
        mv = lambda: page.evaluate('__solDunk.missions()')
        m0 = await mv()
        need = m0['need']['day']
        check(len(m0['daily']) == 3 and len(m0['weekly']) == 3 and m0['played']['day'] == 0 and need > 0, 'three daily and three weekly missions, nothing played yet')
        check(m0['rounds'] == 3 and m0['round'] == {'day': 0, 'week': 0} and m0['next']['day']['need'] > need and m0['next']['day']['reward'] > sum(c['reward'] for c in m0['daily']), 'round 1 of 3 is open, and round 2 needs more play and pays more')
        rb0 = await page.evaluate('__solDunk.rakeback()'); lv0 = await page.evaluate('__solDunk.level()')
        check(rb0 == {'acc': 0, 'ready': 0, 'paid': 0} and lv0['l'] == 1 and lv0['need'] == 70, 'no rakeback yet, level 1, 70 XP to level 2')
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
        done1 = [c for c in m1['all']['day'] if c['done'] and c['round'] == 0]
        check(m1['played']['day'] == 1 and done1, 'run 1: 1 SOL played and daily missions done: ' + json.dumps([(c['k'], c['p'], c['n']) for c in m1['all']['day']]))
        check(all(not c['paid'] for c in done1) and abs(m1['waiting']['day'] - sum(c['reward'] for c in done1)) < 1e-9 and m1['due']['day'] == need, 'their SOL waits until the day\'s play reaches ' + str(need))
        gains = await page.evaluate("document.getElementById('resGains').innerText")
        check('SOL waiting' in gains and 'SOL more today' in gains, 'the result card says how much more play unlocks it: ' + gains.replace('\n', ' | '))
        nxt = await page.evaluate("document.getElementById('resNext').innerText")
        check('/' in nxt and ('SOL' in nxt or 'XP' in nxt), 'the result card shows the next mission to go for: ' + nxt.replace('\n', ' | '))
        # level-up rakeback: the 1 SOL bet set 0.002 SOL aside, the run levelled up, and one tap claims it
        rb1 = await page.evaluate('__solDunk.rakeback()'); lv1 = await page.evaluate('__solDunk.level()')
        check(lv1['l'] > 1 and abs(rb1['ready'] - 0.002) < 1e-9 and rb1['acc'] == 0, 'the run levelled up and released 0.2% of the bet as rakeback: ' + json.dumps([lv1, rb1]))
        check('Claim 0.002 SOL' in gains, 'the result card offers the claim')
        bc = await bal()
        await page.click('#rbChip'); await page.wait_for_timeout(400)
        rb2 = await page.evaluate('__solDunk.rakeback()')
        check(abs(await bal() - (bc + 0.002)) < 1e-9 and rb2['ready'] == 0 and abs(rb2['paid'] - 0.002) < 1e-9, 'claiming pays it to the balance, once')
        check('Rakeback claimed' in await page.evaluate("document.getElementById('rbChip').innerText"), 'and the chip says so')
        await page.screenshot(path=OUT + 'rakeback.png')
        # run 2: the bet reaches the need, so everything already done is released to claim (nothing is credited yet)
        b0 = await bal()
        await page.click('#againBtn'); await page.wait_for_timeout(500)
        b1 = await bal()
        m2 = await mv()
        owed = sum(c['reward'] for c in done1)
        check(abs((b1 - b0) + 1) < 1e-9 and abs(m2['readyAll'] - owed) < 1e-9, f'run 2 start: the bet is taken and {owed} SOL of rewards released to claim, not paid ({b0} -> {b1})')
        check(all(c['paid'] and c['ready'] and not c['claimed'] for c in m2['all']['day'] if c['done'] and c['need'] <= m2['played']['day'] + 1e-9), 'every done daily mission whose round has been played for is ready to claim')
        note = await page.evaluate("document.getElementById('notice').innerText")
        check('Mission SOL ready' in note and 'to claim' in note, 'a notice says the SOL is ready to claim: ' + note.replace('\n', ' | '))
        await page.screenshot(path=OUT + 'paid.png')
        await page.evaluate("__solDunk.autoplay('perfect'); __solDunk.tap()")
        for i in range(900):
            ph = await page.evaluate('__solDunk.phase()')
            if ph == 'checkpoint': await page.wait_for_timeout(800); await page.click('#cashBtn'); break
            if ph == 'over': break
            await page.wait_for_timeout(100)
        await page.wait_for_timeout(2200)
        ready = (await mv())['readyAll']
        chip = await page.evaluate("document.getElementById('msChip') ? document.getElementById('msChip').innerText : ''")
        check(ready > 0 and 'Mission SOL ready' in chip and ('Claim %g SOL' % round(ready, 4)) in chip, 'the result card offers the ready mission SOL: ' + chip.replace('\n', ' | '))
        await page.click('#lobbyBtn'); await page.wait_for_timeout(500)
        check(await page.evaluate("document.getElementById('badgeM').classList.contains('on')"), 'a dot on the Missions tab says there is SOL to claim')
        await page.click('#tabMissions'); await page.wait_for_timeout(700)
        day = '#mBody .msp[data-seg="day"]'
        txt = await page.evaluate(f"document.querySelector('{day}').innerText")
        m3 = await mv()
        check('Round 1' in txt and 'Round 2' in txt and 'Round 3' in txt, 'the daily missions on the Missions tab show their three rounds')
        # SOL ready on the open round's rows has a Claim key on each; a run that finished the whole round has already
        # opened the next, so its SOL isn't on any row and the ticket at the top of the tab claims it
        off = any(c['ready'] and c['round'] < m3['round']['day'] for c in m3['all']['day'])
        tk = await page.evaluate("(document.getElementById('msEarlier') || {}).innerText || ''")
        check((('%g SOL ready to claim' % round(m3['ready']['day'], 4)) in txt or ('Claim %g SOL' % round(m3['readyAll'], 4)) in tk) if m3['ready']['day'] > 0 else True, 'and how much is ready to claim: ' + (tk or txt).replace('\n', ' | ')[:160])
        keys = await page.evaluate(f"document.querySelectorAll('{day} .m-claim').length")
        check(keys == sum(1 for c in m3['daily'] if c['ready']) and (keys > 0 or (off and tk)), f'each ready mission has a Claim key, or the ticket has SOL from a finished round ({keys}, {tk!r})')
        await page.screenshot(path=OUT + 'claim_keys.png')
        if keys == 0 and off and tk:
            # the whole round was finished in a run: the ticket claims its SOL (and anything else ready), once
            bc = await bal(); allr = m3['readyAll']
            await page.click('#msEarlier'); await page.wait_for_timeout(1500)
            m4 = await mv()
            check(m4['readyAll'] == 0 and abs(await bal() - (bc + allr)) < 1e-9, 'the ticket claims every ready SOL, once (%g)' % allr)
            check(not await page.evaluate("document.getElementById('msEarlier')") and not await page.evaluate("document.getElementById('badgeM').classList.contains('on')"), 'then the ticket and the dot go')
            txt = await page.evaluate(f"document.querySelector('{day}').innerText")
        else:
            # claim one: its SOL goes to the balance, coins fly, the balance counts up and the row says claimed
            first = next(c for c in m3['daily'] if c['ready'])
            bc = await bal()
            await page.click(f'{day} .m-claim'); await page.wait_for_timeout(250)
            await page.screenshot(path=OUT + 'claim_fly.png')
            check(abs(await bal() - (bc + first['reward'])) < 1e-9 and await page.evaluate(f"document.querySelector('{day} .m-claim.got') !== null"), 'Claim pays that mission\'s SOL and the key turns to what it paid')
            await page.wait_for_timeout(900)
            gain = await page.evaluate("document.querySelector('.claim-gain') ? document.querySelector('.claim-gain').textContent : ''")
            shown = await page.evaluate("document.getElementById('balTxt').textContent")
            check(gain == '+%g SOL' % first['reward'] and abs(float(shown) - (bc + first['reward'])) <= 0.5 * 10 ** -len(shown.split('.')[1]) + 1e-9 and len(shown.split('.')[1]) >= 3, f'the balance counts up to show it ({shown}) with {gain} under it')
            await page.wait_for_timeout(400)
            txt = await page.evaluate(f"document.querySelector('{day}').innerText")
            check('%g SOL claimed' % first['reward'] in txt and await page.evaluate(f"document.querySelectorAll('{day} .m-claim').length") == keys - 1, 'the row says it was claimed and the other keys stay')
            await page.screenshot(path=OUT + 'claimed.png')
            # claim the rest, one key at a time; then nothing is ready and the dot goes
            for _ in range(8):
                if not await page.evaluate(f"document.querySelector('{day} .m-claim:not(.got)') !== null"): break
                await page.click(f'{day} .m-claim:not(.got)'); await page.wait_for_timeout(1300)
            m4 = await mv()
            check(m4['ready']['day'] == 0 and abs(await bal() - (bc + m3['ready']['day'])) < 1e-9, 'claiming every key pays all of the day\'s ready SOL, once')
            check(not await page.evaluate("document.getElementById('badgeM').classList.contains('on')") or m4['readyAll'] > 0, 'and the dot goes once nothing is left to claim')
            txt = await page.evaluate(f"document.querySelector('{day}').innerText")
        met = m4['played']['day'] >= m4['need']['day'] - 1e-9
        check(('SOL rewards unlocked today' in txt) if met else ('Bet %g SOL today' % m4['need']['day'] in txt), 'and what the open round\'s SOL waits for')
        check(('to open round %d' % (m3['round']['day'] + 2)) in txt if m3['next']['day'] and not all(c['done'] for c in m3['daily']) else True, 'and what finishing all three opens')
        await page.screenshot(path=OUT + 'page.png')
        # the special level's entry counts as play too
        p0 = (await mv())['played']['day']
        await page.click('#tabChallenges'); await page.wait_for_timeout(500)
        fee = await page.evaluate('__solDunk.special().fee')
        await page.click('#chSpPlay0'); await page.wait_for_timeout(600)
        check(abs((await mv())['played']['day'] - (p0 + fee)) < 1e-9, 'a special level entry counts as play')
        check(not errs, 'no page errors ' + json.dumps(errs))
        await ctx.close()

        # a finished round opens the next: start a player with today's first round done (its SOL still waiting)
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        await ctx.clock.set_fixed_time(DAY)
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.add_init_script("""(() => { if (localStorage.getItem('soldunk.profile')) return; const d = new Date().toISOString().slice(0, 10);
          const done = () => [0, 1, 2].map(() => ({ p: 1, done: true, paid: false }));
          localStorage.setItem('soldunk.profile', JSON.stringify({ xp: 0, xpv: 2, ms: { day: d, dp: 0, d: done() } })); })()""")
        await page.goto(URL); await page.wait_for_timeout(1500)
        mv = lambda: page.evaluate('__solDunk.missions()')
        a0 = await mv()
        check(a0['round']['day'] == 0 and all(c['done'] and not c['paid'] for c in a0['daily']) and a0['days'] == 0, 'a player with round 1 done and its SOL waiting')
        await page.click('#diff0'); await page.fill('#betInput', '1'); await page.evaluate("document.getElementById('betInput').blur()"); await page.wait_for_timeout(200)
        await run(1, 'round2')
        a1 = await mv()
        gains = await page.evaluate("document.getElementById('resGains').innerText")
        check(a1['round']['day'] == 1 and len(a1['all']['day']) == 6 and a1['need']['day'] == 2.5 * need and a1['days'] == 1, 'the next run opens round 2, which waits for more play, and the day counts for the week: ' + json.dumps([a1['round'], a1['need'], a1['days']]))
        check(all(c['p'] == 0 and not c['done'] for c in a1['daily']) and abs(sum(c['reward'] for c in a1['daily']) - 1.5 * sum(c['reward'] for c in a0['daily'])) < 1e-9, 'round 2 starts fresh and pays half as much again')
        check(abs(a1['waiting']['day'] - sum(c['reward'] for c in a0['daily'])) < 1e-9 and a1['due']['day'] == need, 'round 1\'s SOL still waits for round 1\'s need')
        b0 = await page.evaluate('__solDunk.bal()')
        await page.click('#againBtn'); await page.wait_for_timeout(500)
        a2 = await mv()
        check(abs(await page.evaluate('__solDunk.bal()') - (b0 - 1)) < 1e-9 and a2['waiting']['day'] == 0 and abs(a2['paid']['day'] - a1['waiting']['day']) < 1e-9 and abs(a2['ready']['day'] - a1['waiting']['day']) < 1e-9, 'and is released to claim the moment the day\'s play reaches it')
        await page.evaluate("__solDunk.autoplay('perfect'); __solDunk.tap()")
        for i in range(900):
            ph = await page.evaluate('__solDunk.phase()')
            if ph == 'checkpoint': await page.wait_for_timeout(800); await page.click('#cashBtn'); break
            if ph == 'over': break
            await page.wait_for_timeout(100)
        await page.wait_for_timeout(2200)
        # the result card's ticket claims everything ready at once
        r2 = (await mv())['readyAll']; b2 = await page.evaluate('__solDunk.bal()')
        await page.screenshot(path=OUT + 'result_ticket.png')
        await page.click('#msChip'); await page.wait_for_timeout(500)
        chip = await page.evaluate("document.getElementById('msChip').innerText")
        check(r2 > 0 and abs(await page.evaluate('__solDunk.bal()') - (b2 + r2)) < 1e-9 and (await mv())['readyAll'] == 0 and 'Mission SOL claimed' in chip, 'the result card\'s ticket claims it all: ' + chip.replace('\n', ' | '))
        await page.screenshot(path=OUT + 'result_claimed.png')
        await page.click('#lobbyBtn'); await page.wait_for_timeout(500)
        await page.click('#tabMissions'); await page.wait_for_timeout(600)
        await page.screenshot(path=OUT + 'round2_page.png')
        cls = await page.evaluate("[...document.querySelectorAll('#mBody .msp[data-seg=\"day\"] .rd')].map((e) => e.className)")
        check(cls == ['rd paid', 'rd now', 'rd lock'], 'the rounds on Missions: round 1 paid, round 2 open, round 3 locked ' + json.dumps(cls))
        await page.click('#tabProfile'); await page.wait_for_timeout(500)
        ptxt = await page.evaluate("document.getElementById('pBody').innerText")
        check('Rakeback' in ptxt, 'Profile shows the rakeback under the player card')
        await page.screenshot(path=OUT + 'profile.png')
        check(not errs, 'no page errors ' + json.dumps(errs))
        await ctx.close()

        # SOL released on an earlier day and never claimed is still the player's: a ticket at the top of Missions claims it
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        await ctx.clock.set_fixed_time(DAY)
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.add_init_script("""(() => { if (localStorage.getItem('soldunk.profile')) return; const d = new Date().toISOString().slice(0, 10);
          localStorage.setItem('soldunk.profile', JSON.stringify({ xp: 0, xpv: 2, ms: { day: d, dp: 0, d: [0, 1, 2].map(() => ({ p: 0, done: false, paid: false })), ready: 0.006 } })); })()""")
        await page.goto(URL); await page.wait_for_timeout(1500)
        v = await page.evaluate('__solDunk.missions()')
        check(abs(v['readyAll'] - 0.006) < 1e-9 and abs(v['earlier'] - 0.006) < 1e-9 and await page.evaluate("document.getElementById('badgeM').classList.contains('on')"), 'SOL from an earlier day waits to be claimed, with a dot on Missions')
        await page.click('#tabMissions'); await page.wait_for_timeout(700)
        t = await page.evaluate("document.getElementById('msEarlier') ? document.getElementById('msEarlier').innerText : ''")
        check('Unclaimed mission SOL' in t and 'Claim 0.006 SOL' in t, 'a ticket at the top of Missions offers it: ' + t.replace('\n', ' | '))
        await page.screenshot(path=OUT + 'earlier.png')
        b0 = await page.evaluate('__solDunk.bal()')
        await page.click('#msEarlier'); await page.wait_for_timeout(1500)
        check(abs(await page.evaluate('__solDunk.bal()') - (b0 + 0.006)) < 1e-9 and (await page.evaluate('__solDunk.missions()'))['readyAll'] == 0 and not await page.evaluate("!!document.getElementById('msEarlier')"), 'claiming it pays it and the ticket goes')
        check(not await page.evaluate("document.getElementById('badgeM').classList.contains('on')"), 'and so does the dot')
        check(not errs, 'no page errors ' + json.dumps(errs))
        await b.close()
    print('FAILS', fails if fails else 'none')
asyncio.run(main())
