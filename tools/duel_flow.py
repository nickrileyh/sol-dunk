"""A duel in the demo, end to end: the card and its page, a flight beside the rival's ghost, the result and the money.
Plays three duels with different bots so a win, a loss and stopping once past a rival who's out all come up."""
import asyncio, json
from playwright.async_api import async_playwright
from _paths import URL, CHROME, SHOTS
fails = []
def check(ok, msg):
    if not ok: fails.append(msg); print('  FAIL', msg)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(URL); await page.wait_for_timeout(2500)
        ev = page.evaluate
        await page.click('#tabChallenges'); await page.wait_for_timeout(700)
        d = await ev('__solDunk.duel()')
        check(d and d['demo'] and abs(d['fee'] - 0.05) < 1e-9 and abs(d['prize'] - 0.09) < 1e-9, 'the duel costs 0.05 SOL and the winner takes 0.09: ' + json.dumps(d))
        card = await page.inner_text('#cBody .cc.du')
        check('Race a rival' in card and '0.09' in card, 'the Challenges tab has the duel card: ' + card.replace('\n', ' | '))
        await page.click('#cBody [data-page="duel"]'); await page.wait_for_timeout(500)
        body = await page.inner_text('#pgBody')
        check('The winner takes' in body and 'simulated' not in body and 'autopilot' in body and 'house keeps 10%' in body, 'the duel page gives the prize, the rules and says the demo rival is the autopilot')
        results = []
        for k, skill in enumerate(['perfect', 'novice', 'good']):
            bal0 = await ev('__solDunk.bal()')
            if k == 0: await page.click('#duPlay')
            else: await page.click('#againBtn')
            await page.wait_for_timeout(1300)
            check(await ev('__solDunk.mode()') == 'duel' and abs(await ev('__solDunk.bal()') - (bal0 - 0.05)) < 1e-9, f'duel {k}: the entry is taken at the start')
            check('rival' in (await page.inner_text('#prompt')).lower(), f'duel {k}: the start says what wins')
            await ev(f"__solDunk.autoplay('{skill}'); __solDunk.tap()")
            seen = False; clinch = None
            for i in range(900):
                g = await ev('__solDunk.ghost()'); ph = await ev('__solDunk.phase()')
                if g and g['tick'] > 0 and g['a'] > 0.5: seen = True
                if ph == 'over': break
                await page.wait_for_timeout(100)
            check(seen, f'duel {k}: the rival flies beside the ball')
            await page.wait_for_timeout(1900)
            L = (await ev('__solDunk.duel()'))['last']; bal1 = await ev('__solDunk.bal()')
            title = await page.inner_text('#resTitle'); sub = await page.inner_text('#resSub'); hud = await page.inner_text('#hudMult')
            you, rv = L['you'], L['rival']
            exp = 'won' if (you['rings'], you['score']) > (rv['rings'], rv['score']) else 'lost' if (you['rings'], you['score']) < (rv['rings'], rv['score']) else 'draw'
            pay = {'won': 0.09, 'lost': 0, 'draw': 0.045}[exp]
            check(L['status'] == exp and abs(L['payout'] - pay) < 1e-9 and abs(bal1 - (bal0 - 0.05 + pay)) < 1e-9, f'duel {k}: {you} v {rv} is {L["status"]} and pays {L["payout"]}')
            check(f"You {you['rings']} ring" in sub and f"rival {rv['rings']}" in sub and hud.replace(' ', '') == f"{you['rings']}–{rv['rings']}", f'duel {k}: the result gives both flights ({title} · {sub} · {hud})')
            # the perfect bot would fly all 30 rings: a win short of that means the flight stopped once the rival was out
            if skill == 'perfect': check(exp == 'won' and rv['rings'] < you['rings'] < 30 and title == 'Duel won', f'duel {k}: past a rival who is out, the flight stops and wins ({you["rings"]} v {rv["rings"]})')
            check((await page.inner_text('#againT')) == 'Duel again', f'duel {k}: the result offers another duel')
            results.append(exp)
            await ev("__solDunk.autoplay(null)")
        check('won' in results and 'lost' in results, 'a win and a loss both came up: ' + str(results))
        await page.click('#lobbyBtn'); await page.wait_for_timeout(700)
        t = (await ev('__solDunk.duel()'))['today']
        check(t['w'] == results.count('won') and t['l'] == results.count('lost') and await ev('__solDunk.nav.tab') == 'challenges', 'Back returns to Challenges with today\'s tally: ' + json.dumps(t))
        await page.click('#tabProfile'); await page.wait_for_timeout(400); await page.click('#pBody [data-page="stats"]'); await page.wait_for_timeout(500)
        st = await page.inner_text('#pgBody')
        check('a duel' in st and 'Duel ·' in st, 'Stats lists the duels')
        await page.click('#pgBack'); await page.wait_for_timeout(300); await page.click('#pBody [data-page="odds"]'); await page.wait_for_timeout(400)
        await page.click('#fairVerify'); await page.wait_for_timeout(300)
        fo = await page.inner_text('#fairOut')
        check('Duel course' in fo, 'the latest duel checks against its committed seed: ' + fo.replace('\n', ' | ')[:120])
        # stakes: the duel's stepper picks what both players stake; the winner takes 1.8x it
        await page.click('#pgBack'); await page.wait_for_timeout(300); await page.click('#tabChallenges'); await page.wait_for_timeout(500)
        await page.click('#cBody [data-page="duel"]'); await page.wait_for_timeout(500)
        d = await ev('__solDunk.duel()')
        check([x['stake'] for x in d['stakes']] == [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1] and all(abs(x['prize'] - 1.8 * x['stake']) < 1e-9 for x in d['stakes']), 'the duel\'s stakes, the winner taking 1.8x: ' + json.dumps(d['stakes']))
        await page.click('#pgBody [data-stake="du"] .stake-b[data-d="1"]'); await page.wait_for_timeout(300)
        body = await page.inner_text('#pgBody')
        check(await ev('__solDunk.prefs.duStake') == 0.1 and '0.18' in body and 'Play for 0.1 SOL' in body and '1.8× your 0.1 SOL stake' in body, 'stepping up to 0.1: the winner takes 0.18 and Play says 0.1')
        await page.screenshot(path=SHOTS + '/duel_stake.png')
        bal0 = await ev('__solDunk.bal()')
        await page.click('#duPlay'); await page.wait_for_timeout(1300)
        hp = await ev("document.getElementById('hudPot').textContent")
        check(abs(await ev('__solDunk.bal()') - (bal0 - 0.1)) < 1e-9 and abs(float(hp) - 0.18) < 1e-6, 'a 0.1 SOL duel takes 0.1 and the HUD shows the 0.18 it wins: ' + hp)
        await ev("__solDunk.autoplay('perfect'); __solDunk.tap()")
        for i in range(900):
            if await ev('__solDunk.phase()') == 'over': break
            await page.wait_for_timeout(100)
        await page.wait_for_timeout(1900); await ev("__solDunk.autoplay(null)")
        L = (await ev('__solDunk.duel()'))['last']
        check(abs(L['payout'] - {'won': 0.18, 'lost': 0, 'draw': 0.09}[L['status']]) < 1e-9 and abs(await ev('__solDunk.bal()') - (bal0 - 0.1 + L['payout'])) < 1e-9, f'a 0.1 SOL duel {L["status"]} pays {L["payout"]}')
        check(not errs, 'no page errors: ' + str(errs))
        print('duel flow:', 'all checks passed' if not fails else f'{len(fails)} check(s) failed')
        await b.close()
asyncio.run(main())
raise SystemExit(1 if fails else 0)
