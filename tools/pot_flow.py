"""The daily pot in the demo, end to end: a game of its own on the day's course. The card on Challenges and its page
(the course, the pot, each place's share, the board), attempts (each takes the entry and goes into the pot, the best
counts), the leader's ghost and the live place in a run, the result card, and closing the pot (the best three paid)."""
import asyncio, json
from playwright.async_api import async_playwright
from _paths import URL, CHROME
fails = []
def check(ok, msg):
    if not ok: fails.append(msg); print('  FAIL', msg)
    else: print('  ok  ', msg)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        ev = page.evaluate
        await page.goto(URL); await page.wait_for_timeout(3500)
        await page.click('#tabChallenges'); await page.wait_for_timeout(1200)
        p0 = await ev('__solDunk.pot()')
        check(p0 and p0['simulated'] and p0['theme'] and p0['rings'] == 40 and abs(p0['fee'] - 0.05) < 1e-9 and p0['places'] == [0.5, 0.3, 0.2], 'the pot has a course, a theme, an entry and three places: ' + json.dumps({k: p0[k] for k in ('theme', 'rings', 'fee', 'places')}))
        check(p0['entrants'] > 0 and len(p0['board']) > 0 and p0['leader'] and abs(p0['pool'] - p0['attempts'] * 0.05 * 0.9) < 1e-6, 'the simulated field has flown it, and every attempt is in the pot: ' + json.dumps([p0['entrants'], p0['attempts'], p0['pool']]))
        card = await page.inner_text('#cBody .cc.pot')
        check(p0['theme']['name'] in card and 'best three split it' in card and '1st' in card and 'Fly 0.05' in card, 'the card shows the theme, the top of the board and Fly: ' + card.replace('\n', ' | ')[:160])
        await page.click('#cBody [data-page="pot"]'); await page.wait_for_timeout(900)
        body = await page.inner_text('#pgBody')
        check('In the pot' in body and '1st · 50%' in body and 'Today’s board' in body and 'simulated' in body and await ev("!!document.getElementById('potPlay')"), 'the page has the pot, the places, the board, Fly and the demo note')
        check('the highest score, then the most rings' in body and 'A rim hit scores 1' in body, 'the rules say the best score counts, and how a ring scores')
        top = p0['board'][0]; heads = await ev("[...document.querySelectorAll('#pgBody .pboard li:not(.gap)')].slice(0, 2).map((li) => [li.querySelector('b').textContent, li.querySelector('.sc').textContent])")
        check(heads and heads[0][0] == str(top['score']) and heads[0][1] == str(top['rings']) + (' ring' if top['rings'] == 1 else ' rings') and all(p0['board'][i]['score'] >= p0['board'][i + 1]['score'] for i in range(len(p0['board']) - 1)), 'the board ranks by points, with rings beside them: ' + json.dumps(heads))
        check(not any(T in p0['theme']['name'] for T in ('Side doors', 'Switchback', 'Heartbeat', 'Everything')), 'the pot flies a theme of its own, not a special\'s: ' + p0['theme']['name'])
        drawn = await ev("(() => { const c = document.getElementById('potCourse'); if (!c) return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; })()")
        check(drawn > 200, f'the course sketch is drawn ({drawn} px)')
        bal0 = await ev('__solDunk.bal()')
        await page.click('#potPlay'); await page.wait_for_timeout(1400)
        check(await ev('__solDunk.mode()') == 'pot' and abs(await ev('__solDunk.bal()') - (bal0 - 0.05)) < 1e-9, 'an attempt takes the entry')
        g = await ev('__solDunk.ghost()')
        check(g is not None, 'the leader flies beside the ball as a ghost')
        prompt = await page.inner_text('#prompt')
        check('leader' in prompt.lower(), 'the start says what to beat: ' + prompt.replace('\n', ' '))
        await ev("__solDunk.autoplay('good'); __solDunk.tap()")
        places = set(); hud = []
        for i in range(900):
            ph = await ev('__solDunk.phase()')
            if ph == 'over': break
            if i % 6 == 0: places.add(await page.inner_text('#hudPot')); hud.append(await ev("[document.getElementById('hudMult').textContent, __solDunk.run.score]"))
            await page.wait_for_timeout(100)
        check(hud and all(h[0] == str(h[1]) for h in hud) and any(h[1] > 0 for h in hud), 'the HUD counts the points: ' + json.dumps(hud[-3:]))
        check(any('place' in x for x in places), 'the HUD shows the place the flight would take: ' + ', '.join(sorted(places))[:120])
        await page.wait_for_timeout(2000)
        p1 = await ev('__solDunk.pot()')
        me = p1['me']
        unit = await page.inner_text('#resAmount .unit'); num = await page.inner_text('#resNum')
        check(me['attempts'] == 1 and me['best'] and me['place'] and int(num) == me['best']['score'] and unit in ('point', 'points'), f"the attempt is the player's best, shown as points: {num} {unit}, place {me['place']}")
        tiles = await page.inner_text('#resStats')
        check('Rings' in tiles and 'Swishes' in tiles and 'Score' not in tiles, 'the result card counts its rings and swishes beside the points: ' + tiles.replace('\n', ' '))
        check(abs(p1['pool'] - p0['pool'] - 0.045) < 0.0451 * 3, 'the attempt went into the pot')
        check(await page.inner_text('#againT') == 'Fly again', 'the result offers another attempt')
        await ev("__solDunk.autoplay(null)")
        # a second attempt that hits the floor at once: the best stays
        await page.click('#againBtn'); await page.wait_for_timeout(1400)
        g2 = await ev('__solDunk.ghost()')
        await ev('__solDunk.tap()')
        for i in range(200):
            if await ev('__solDunk.phase()') == 'over': break
            await page.wait_for_timeout(100)
        await page.wait_for_timeout(1800)
        p2 = await ev('__solDunk.pot()')
        check(p2['me']['attempts'] == 2 and p2['me']['best']['score'] == me['best']['score'] and p2['me']['best']['rings'] == me['best']['rings'] and await page.inner_text('#resTitle') != 'New best', 'a worse attempt keeps the best')
        # close the pot now (demo): the best three are paid, a new pot opens, and the result is told
        await page.click('#lobbyBtn'); await page.wait_for_timeout(800)
        await page.click('#cBody [data-page="pot"]'); await page.wait_for_timeout(700)
        bal1 = await ev('__solDunk.bal()')
        await page.click('#potClose'); await page.wait_for_timeout(2500)
        p3 = await ev('__solDunk.pot()'); L = p3['last']
        check(L and L['key'] == p0['key'] and len(L['results']) == 3 and abs(sum(r['won'] for r in L['results']) - L['results'][0]['won'] / 0.5) < 1e-6, 'closing pays the best three half, three tenths and a fifth: ' + json.dumps(L['results'])[:220])
        won = L['me']['won'] if L['me'] else 0
        check(abs(await ev('__solDunk.bal()') - (bal1 + won)) < 1e-9 and (won > 0) == (L['me']['place'] is not None and L['me']['place'] <= 3), f"the player is paid for a top-three place only (place {L['me']['place']}, won {won})")
        check(p3['key'] != p0['key'] and p3['seed'] != p0['seed'] and p3['me']['attempts'] == 0, 'a new pot opens on a new course')
        check('Last pot' in await page.inner_text('#pgBody'), 'the page shows the last pot')
        await page.click('#tabProfile'); await page.wait_for_timeout(400); await page.click('#pBody [data-page="stats"]'); await page.wait_for_timeout(500)
        check('Daily pot' in await page.inner_text('#pgBody'), 'Stats lists the pot attempts')
        check(not errs, 'no page errors: ' + str(errs))
        await b.close()
    print('pot flow:', 'all checks passed' if not fails else f'{len(fails)} check(s) failed')
asyncio.run(main())
raise SystemExit(1 if fails else 0)
