"""Checks the desktop layout (a window at least 1024 x 600): the sidebar in place of the tab bar, the arena's window
beside the bet on Play and beside the collection in the Locker (with the demo ball flying inside it), Challenges
and Profile in two columns, pages in a reading column beside the sidebar, the keys between runs (1 to 4 for the
tabs, the arrows for the mode and the bet) and through a run (Space, C, Enter, Esc, P, M), a run from Play playing
inside the Play tab's window with a phone's view ahead (the sidebar and the bet staying, quiet), a window too small for
that taking the screen with the hall carrying on dimly at its sides, the pointer out of the way while the ball flies,
and that a smaller window goes back to the phone layout."""
import asyncio, json
from playwright.async_api import async_playwright
from _paths import URL, SHOTS, CHROME
fails = []
def check(ok, what):
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok: fails.append(what)
RECT = "(q) => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        for W, H in [(1440, 900), (1024, 600), (1920, 1080)]:
            ctx = await b.new_context(viewport={'width': W, 'height': H})
            page = await ctx.new_page(); errs = []
            page.on('pageerror', lambda e: errs.append(str(e)[:300]))
            await page.goto(URL); await page.wait_for_timeout(1500)
            rect = lambda q: page.evaluate(RECT, q)
            phase = lambda: page.evaluate('__solDunk.phase()')
            tag = f'{W}x{H}: '
            check(await page.evaluate("document.body.classList.contains('desk')"), tag + 'the desktop layout is on')
            tb = await rect('#tabbar')
            check(tb['l'] == 0 and tb['t'] == 0 and abs(tb['h'] - H) < 1 and 200 <= tb['w'] <= 260, tag + 'the tab bar is a sidebar down the left edge')
            hero, ctl, bal = await rect('#hero'), await rect('#lobby .controls'), await rect('#balBtn')
            check(hero['l'] >= tb['r'] and hero['r'] <= ctl['l'] and ctl['r'] <= W and hero['w'] >= 220 and hero['h'] >= H * 0.7, tag + f"Play: the window stands between the sidebar and the bet ({round(hero['w'])} x {round(hero['h'])})")
            check(ctl['b'] <= H and bal['l'] >= hero['r'] and bal['b'] <= ctl['t'], tag + 'Play: the bet fits under the balance')
            check(abs((ctl['t'] + ctl['b']) / 2 - (hero['t'] + hero['b']) / 2) < H * 0.1, tag + 'Play: the bet sits beside the middle of the window')
            inside = n = 0
            for i in range(50):
                s = await page.evaluate('__solDunk.ballScreen()'); n += 1
                if hero['l'] + 10 < s['x'] < hero['r'] - 10 and hero['t'] < s['y'] < hero['b']: inside += 1
                await page.wait_for_timeout(100)
            check(inside / n >= 0.9, tag + f'Play: the demo ball flies inside the window ({inside}/{n})')
            await page.click('#tabChallenges'); await page.wait_for_timeout(600)
            v, cols = await rect('#vChallenges'), await page.evaluate("[...document.querySelectorAll('#cBody .dk-col')].map(e => { const r = e.getBoundingClientRect(); return [r.left, r.right, r.top]; })")
            check(abs(v['l'] - tb['r']) < 1 and len(cols) == 2 and cols[0][1] < cols[1][0] and abs(cols[0][2] - cols[1][2]) < 1, tag + 'Challenges: two columns beside the sidebar')
            check(await page.evaluate("document.getElementById('tabChallenges').getAttribute('aria-selected')") == 'true', tag + 'the sidebar marks the open tab')
            await page.click('#tabMissions'); await page.wait_for_timeout(600)
            v, cols = await rect('#vMissions'), await page.evaluate("[...document.querySelectorAll('#mBody .msp')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [r.left, r.right, r.top]; })")
            check(abs(v['l'] - tb['r']) < 1 and len(cols) == 3 and cols[0][1] < cols[1][0] and (cols[1][1] < cols[2][0] or cols[2][2] > cols[0][2]) and all(c[1] <= v['r'] + 1 for c in cols), tag + 'Missions: today, this week and the career all in view beside the sidebar')
            check(not await page.evaluate("!!document.querySelector('#mBody .ms-seg').offsetParent"), tag + 'Missions: no control to switch between them')
            await page.click('#tabChallenges'); await page.wait_for_timeout(500)
            await page.click('#cBody [data-page="pot"]'); await page.wait_for_timeout(500)
            pg, col = await rect('#vPage'), await rect('#pgBody .vcol')
            check(abs(pg['l'] - tb['r']) < 1 and col['w'] <= 681 and col['l'] > pg['l'], tag + f"a page opens beside the sidebar in a reading column ({round(col['w'])} px)")
            await page.keyboard.press('Escape'); await page.wait_for_timeout(450)
            check(not await page.evaluate("document.body.classList.contains('page-open')"), tag + 'Esc closes the page')
            await page.click('#tabProfile'); await page.wait_for_timeout(500)
            cols = await page.evaluate("[...document.querySelectorAll('#pBody .dk-col')].map(e => { const r = e.getBoundingClientRect(); return [r.left, r.right]; })")
            check(len(cols) == 2 and cols[0][1] < cols[1][0], tag + 'Profile: two columns')
            await page.click('#pfLocker'); await page.wait_for_timeout(1300)
            lh, lg = await rect('#lkHero'), await rect('#lkGrid')
            check(lh['l'] >= tb['r'] and lh['r'] <= lg['l'] and lg['b'] <= H and lg['h'] > 150, tag + 'Locker: the window beside the collection')
            s = await page.evaluate('__solDunk.ballScreen()')
            check(lh['l'] < s['x'] < lh['r'], tag + 'Locker: the ball you dress is in the window')
            await page.screenshot(path=f'{SHOTS}/desk_{W}_locker.png')
            await page.keyboard.press('Escape'); await page.wait_for_timeout(400)
            await page.click('#tabPlay'); await page.wait_for_timeout(700)
            await page.screenshot(path=f'{SHOTS}/desk_{W}_play.png')
            if W == 1920:  # a big window: the run plays in it
                hero3 = await rect('#hero')
                await page.keyboard.press('Space'); await page.wait_for_timeout(1300)
                g, hud = await page.evaluate('__solDunk.geom()'), await rect('#hud')
                check(g['inWin'] and abs(g['stW'] - hero3['w']) < 1 and abs(hud['l'] - g['runL']) < 2 and abs(g['runR'] - g['runBX'] - (352 - 56) * g['scale']) < 0.5, tag + f"the run plays in the window, with a phone's view ahead (the ball {round((g['runBX'] - g['runL']) / (g['runR'] - g['runL']) * 100)}% across)")
            if W == 1024:  # a window too small for the cards: the run takes the screen, wider than a phone's behind the ball only
                await page.keyboard.press('Space'); await page.wait_for_timeout(1300)
                hud, w, g = await rect('#hud'), await page.evaluate("parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--col'))"), await page.evaluate('__solDunk.geom()')
                runw = g['runR'] - g['runL']
                check(not g['inWin'] and (await rect('#tabbar'))['r'] <= 1, tag + 'a small window: the run takes the screen and the sidebar slides away')
                check(abs((hud['l'] + hud['r']) / 2 - W / 2) < 2 and abs(hud['w'] - max(runw, 400)) < 2, tag + f"the HUD sits over the centred court ({round(hud['w'])} px)")
                check(runw > w * 1.3 and abs(g['runR'] - g['runBX'] - g['ahead']) < 0.5 and abs(g['ahead'] - (352 - 56) * g['scale']) < 0.5, tag + f"its window is wider than a phone's ({round(runw)} px against {round(w)}) with the same view ahead ({round(g['ahead'])} px)")
                await page.evaluate("__solDunk.autoplay('pro')"); await page.keyboard.press('Space'); await page.wait_for_timeout(1300)
                # the hall carries on at the sides of the play column, dim, and the column's edge stays dark
                SUM = "(a) => { const cv = document.getElementById('game'), k = cv.width / innerWidth, g = cv.getContext('2d'); let m = 0; for (let y = a[1]; y < a[2]; y += 4) { const d = g.getImageData(Math.round(a[0] * k), Math.round(y * k), 1, 1).data; m = Math.max(m, d[0] + d[1] + d[2]); } return m; }"
                side, seam = await page.evaluate(SUM, [g['runL'] - 150, int(H * 0.6), H - 10]), await page.evaluate(SUM, [g['runL'] - 40, 60, H - 10])
                check(side > 60 and seam < 45, tag + f'the hall carries on at the sides (brightest {side}) and the column\'s edge is dark ({seam})')
            if W == 1440:  # the keys, through a run
                check(await page.evaluate("getComputedStyle(document.getElementById('keys')).display") != 'none', 'with a keyboard, the keys are listed')
                snd = await page.evaluate('__solDunk.settings.sound')
                await page.keyboard.press('KeyM'); await page.wait_for_timeout(100)
                check(await page.evaluate('__solDunk.settings.sound') != snd, 'M turns the sound off and on')
                await page.keyboard.press('KeyM')
                # between runs: 1, 2 and 3 open the tabs, the arrows pick the mode and step the bet
                tab = lambda: page.evaluate('__solDunk.nav.tab')
                chips = await page.evaluate("[...document.querySelectorAll('#tabbar .kc')].map((e) => [e.textContent, getComputedStyle(e).display])")
                check([c[0] for c in chips] == ['1', '2', '3', '4'] and all(c[1] != 'none' for c in chips), 'the sidebar rows show their keys ' + json.dumps(chips))
                await page.keyboard.press('Digit2'); await page.wait_for_timeout(300); t2 = await tab()
                await page.keyboard.press('Digit3'); await page.wait_for_timeout(300); t3 = await tab()
                await page.keyboard.press('Digit4'); await page.wait_for_timeout(300); t4 = await tab()
                await page.keyboard.press('ArrowRight'); await page.wait_for_timeout(100); off = await page.evaluate('__solDunk.prefs.di')
                await page.keyboard.press('Digit1'); await page.wait_for_timeout(400)
                check([t2, t3, t4, await tab()] == ['challenges', 'missions', 'profile', 'play'] and off == 0, '1 to 4 open the tabs (and the arrows do nothing away from Play)')
                await page.keyboard.press('ArrowRight'); await page.wait_for_timeout(150); d1 = await page.evaluate('__solDunk.prefs.di')
                await page.keyboard.press('ArrowLeft'); await page.wait_for_timeout(150)
                check(d1 == 1 and await page.evaluate('__solDunk.prefs.di') == 0, 'left and right pick the mode')
                b0 = await page.evaluate('__solDunk.prefs.bet')
                await page.keyboard.press('ArrowUp'); await page.wait_for_timeout(150); b1 = await page.evaluate('__solDunk.prefs.bet')
                await page.keyboard.press('ArrowDown'); await page.wait_for_timeout(150)
                check(b1 > b0 and await page.evaluate('__solDunk.prefs.bet') == b0 and await phase() == 'lobby', f'up and down step the bet ({b0} to {b1} and back)')
                legend = await page.evaluate("[...document.querySelectorAll('#keys > div')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.textContent.trim().replace(/\\s+/g, ' '))")
                check(any('Mode' in x for x in legend) and any('Bet' in x for x in legend), 'the legend lists them on Play ' + json.dumps(legend))
                await page.wait_for_timeout(900)
                await page.keyboard.press('Space'); await page.wait_for_timeout(1300)
                check(await phase() == 'ready', 'Space starts a run from Play')
                check(await page.evaluate("document.getElementById('promptText').textContent") == 'Press Space to fly', 'the prompt names the key')
                # the run plays inside the Play tab's window: the sidebar and the bet stay, quiet and out of reach
                tb2, hero2, ctl2 = await rect('#tabbar'), await rect('#hero'), await rect('#lobby .controls')
                quiet = await page.evaluate("[getComputedStyle(document.getElementById('tabbar')).opacity, getComputedStyle(document.getElementById('tabbar')).pointerEvents, getComputedStyle(document.querySelector('#lobby .controls')).opacity, getComputedStyle(document.getElementById('lobby')).pointerEvents, getComputedStyle(document.getElementById('playBtn')).visibility]")
                check(tb2['l'] == 0 and float(quiet[0]) < 0.5 and quiet[1] == 'none' and ctl2['w'] > 0 and float(quiet[2]) < 0.5 and quiet[3] == 'none' and quiet[4] == 'hidden', 'the run plays in the window: the sidebar and the bet stay, quiet and out of reach ' + json.dumps(quiet))
                hud, g = await rect('#hud'), await page.evaluate('__solDunk.geom()')
                check(g['inWin'] and abs(g['stL'] - hero2['l']) < 1 and abs(g['stW'] - hero2['w']) < 1 and abs(g['stH'] - hero2['h']) < 1, f"the run's stage is the window ({round(g['stW'])} x {round(g['stH'])})")
                check(abs(hud['l'] - g['runL']) < 2 and abs(hud['w'] - (g['runR'] - g['runL'])) < 2 and abs(hud['t'] - hero2['t']) < 2, f"the HUD sits over the window ({round(hud['w'])} px)")
                # the window ends a phone's distance ahead of the ball, at the window's scale: no more of the course in view
                check(abs(g['scale'] - min(hero2['w'] / 352, hero2['h'] / 690)) < 1e-6 and abs(g['runR'] - g['runBX'] - g['ahead']) < 0.5 and abs(g['ahead'] - (352 - 56) * g['scale']) < 0.5 and g['runR'] <= hero2['r'] + 0.5, f"the view ahead is a phone's ({round(g['ahead'])} px; the ball {round((g['runBX'] - g['runL']) / (g['runR'] - g['runL']) * 100)}% across)")
                await page.evaluate("__solDunk.autoplay('pro')"); await page.keyboard.press('Space'); await page.wait_for_timeout(600)
                check(await phase() == 'play', 'Space flaps')
                await page.wait_for_timeout(700)
                bs, v = await page.evaluate('__solDunk.ballScreen()'), await page.evaluate('({ wr: __solDunk.view.wr, x: __solDunk.view.drawX, z: __solDunk.view.zoom })')
                check(abs(bs['x'] - g['runBX']) < 6 and hero2['t'] < bs['y'] < hero2['b'] and abs((v['wr'] - v['x']) - 296 / v['z']) < 3, f"the ball flies at its spot in the window and sees {round(v['wr'] - v['x'])} units ahead, a phone's {round(296 / v['z'])}")
                check(await page.evaluate("document.body.classList.contains('nocursor')"), 'the pointer hides while the ball flies')
                await page.mouse.move(700, 450); await page.wait_for_timeout(100)
                check(not await page.evaluate("document.body.classList.contains('nocursor')"), 'and comes back when the mouse moves')
                await page.screenshot(path=f'{SHOTS}/desk_run.png')
                await page.keyboard.press('KeyP'); await page.wait_for_timeout(300)
                check(await phase() == 'paused', 'P pauses')
                await page.keyboard.press('Escape')
                for i in range(60):
                    if await phase() == 'play': break
                    await page.wait_for_timeout(100)
                check(await phase() == 'play', 'Esc resumes after the count-in')
                ph = None
                for i in range(400):
                    ph = await phase()
                    if ph in ('checkpoint', 'over'): break
                    await page.wait_for_timeout(100)
                if ph == 'checkpoint':
                    await page.wait_for_timeout(1200)
                    go, kc = await rect('#goBtn'), await rect('#goBtn .kc')
                    check(kc and kc['w'] > 0 and kc['r'] <= go['r'], 'the checkpoint buttons show their keys')
                    cpr = await rect('#checkpoint')
                    check(abs((cpr['l'] + cpr['r']) / 2 - (hero2['l'] + hero2['r']) / 2) < 2 and hero2['t'] < cpr['t'] and cpr['b'] < hero2['b'], 'the checkpoint card sits over the window')
                    await page.screenshot(path=f'{SHOTS}/desk_checkpoint.png')
                    await page.keyboard.press('KeyC'); await page.wait_for_timeout(1800)
                    check(await phase() == 'over', 'C cashes out')
                else:
                    print('note the bot missed before the first checkpoint, so C was not tried')
                    await page.wait_for_timeout(1800)
                await page.screenshot(path=f'{SHOTS}/desk_result.png')
                await page.click('#lobbyBtn'); await page.wait_for_timeout(900)
                check(await phase() == 'lobby' and (await rect('#tabbar'))['l'] == 0 and await page.evaluate("getComputedStyle(document.getElementById('tabbar')).opacity") == '1' and not await page.evaluate("document.body.classList.contains('inwin')"), 'back between runs, the sidebar and the bet come up again')
                # a smaller window goes back to the phone layout, and a bigger one to the desktop's
                await page.set_viewport_size({'width': 900, 'height': 800}); await page.wait_for_timeout(700)
                tb2 = await rect('#tabbar')
                check(not await page.evaluate("document.body.classList.contains('desk')") and tb2['b'] >= 799 and tb2['w'] == 900 and tb2['h'] < 100, 'under 1024 px wide: the phone layout, tab bar at the bottom')
                h2 = await rect('#hero')
                check(abs((h2['l'] + h2['r']) / 2 - 450) < 2, 'the window is centred again')
                await page.set_viewport_size({'width': 1440, 'height': 900}); await page.wait_for_timeout(700)
                check(await page.evaluate("document.body.classList.contains('desk')") and (await rect('#tabbar'))['h'] > 800, 'and back to the desktop layout')
            check(not errs, tag + 'no page errors ' + json.dumps(errs))
            await ctx.close()
        # a touch screen as wide as a desktop: the layout, without the keys
        ctx = await b.new_context(viewport={'width': 1180, 'height': 820}, is_mobile=True, has_touch=True)
        page = await ctx.new_page()
        await page.goto(URL); await page.wait_for_timeout(1200)
        check(await page.evaluate("document.body.classList.contains('desk') && !document.body.classList.contains('kb')"), 'a wide touch screen gets the desktop layout')
        check(await page.evaluate("getComputedStyle(document.getElementById('keys')).display") == 'none' and await page.evaluate("getComputedStyle(document.querySelector('#playBtn .kc')).display") == 'none', 'and no keys are shown')
        await b.close()
    print('FAILS', fails if fails else 'none')
asyncio.run(main())
