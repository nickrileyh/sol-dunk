"""Missions that pay SOL, end to end in the demo: progress from every run, SOL that waits until the day's play reaches
its round's need (the result card says how much more), paid the moment a bet gets there (a notice, the balance), the
daily missions on the Challenges tab with their three rounds, a finished round opening the next, the next mission on
the result card, and level-up rakeback (set aside by a bet, released by a level up, claimed once).
Screenshots to ./shots/missions_*.png. Usage: python3 tools/missions_flow.py"""
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
        # run 2: the bet reaches the need, so everything already done pays at once
        b0 = await bal()
        await page.click('#againBtn'); await page.wait_for_timeout(500)
        b1 = await bal()
        m2 = await mv()
        owed = sum(c['reward'] for c in done1)
        check(abs((b1 - b0) - (owed - 1)) < 1e-9, f'run 2 start: the bet is taken and {owed} SOL of rewards paid ({b0} -> {b1})')
        check(all(c['paid'] for c in m2['all']['day'] if c['done'] and c['need'] <= m2['played']['day'] + 1e-9), 'every done daily mission whose round has been played for is paid')
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
        m3 = await mv()
        met = m3['played']['day'] >= m3['need']['day'] - 1e-9
        check('Round 1' in txt and 'Round 2' in txt and 'Round 3' in txt, 'the daily missions on Challenges show their three rounds')
        check(('SOL rewards unlocked today' in txt) if met else ('Bet %g SOL today' % m3['need']['day'] in txt), 'and what the open round\'s SOL waits for')
        check(('SOL paid' in txt) if any(c['paid'] for c in m3['daily']) else True, 'paid missions say so')
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
        check(abs(await page.evaluate('__solDunk.bal()') - (b0 - 1 + a1['waiting']['day'])) < 1e-9 and a2['waiting']['day'] == 0 and abs(a2['paid']['day'] - a1['waiting']['day']) < 1e-9, 'and pays the moment the day\'s play reaches it')
        await page.evaluate("__solDunk.autoplay('perfect'); __solDunk.tap()")
        for i in range(900):
            ph = await page.evaluate('__solDunk.phase()')
            if ph == 'checkpoint': await page.wait_for_timeout(800); await page.click('#cashBtn'); break
            if ph == 'over': break
            await page.wait_for_timeout(100)
        await page.wait_for_timeout(2200)
        await page.click('#lobbyBtn'); await page.wait_for_timeout(500)
        await page.click('#tabChallenges'); await page.wait_for_timeout(600)
        await page.evaluate("document.querySelector('.ms-cc').scrollIntoView({block:'center'})"); await page.wait_for_timeout(300)
        await page.screenshot(path=OUT + 'round2_page.png')
        cls = await page.evaluate("[...document.querySelectorAll('.ms-cc .rd')].map((e) => e.className)")
        check(cls == ['rd paid', 'rd now', 'rd lock'], 'the rounds on Challenges: round 1 paid, round 2 open, round 3 locked ' + json.dumps(cls))
        await page.click('#tabProfile'); await page.wait_for_timeout(500)
        ptxt = await page.evaluate("document.getElementById('pBody').innerText")
        check('Rakeback' in ptxt, 'Profile shows the rakeback under the player card')
        await page.screenshot(path=OUT + 'profile.png')
        check(not errs, 'no page errors ' + json.dumps(errs))
        await b.close()
    print('FAILS', fails if fails else 'none')
asyncio.run(main())
