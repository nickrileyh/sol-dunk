"""Checks the desktop layout (a window at least 1024 x 600): the sidebar in place of the tab bar, the arena's window
beside the bet on Play and beside the collection in the Locker (with the demo ball flying inside it), Challenges
and Profile in two columns, pages in a reading column beside the sidebar, the keys (Space, C, Enter, Esc, P, M)
through a run, and that a smaller window goes back to the phone layout."""
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
            await page.click('#cBody [data-page="week"]'); await page.wait_for_timeout(500)
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
            if W == 1440:  # the keys, through a run
                check(await page.evaluate("getComputedStyle(document.getElementById('keys')).display") != 'none', 'with a keyboard, the keys are listed')
                snd = await page.evaluate('__solDunk.settings.sound')
                await page.keyboard.press('KeyM'); await page.wait_for_timeout(100)
                check(await page.evaluate('__solDunk.settings.sound') != snd, 'M turns the sound off and on')
                await page.keyboard.press('KeyM')
                await page.keyboard.press('Space'); await page.wait_for_timeout(1300)
                check(await phase() == 'ready', 'Space starts a run from Play')
                check(await page.evaluate("document.getElementById('promptText').textContent") == 'Press Space to fly', 'the prompt names the key')
                check((await rect('#tabbar'))['r'] <= 1, 'the sidebar slides away for the run')
                hud, w = await rect('#hud'), await page.evaluate("parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--col'))")
                check(abs((hud['l'] + hud['r']) / 2 - W / 2) < 2 and abs(hud['w'] - w) < 2, 'in a run the HUD sits over the centred court')
                await page.evaluate("__solDunk.autoplay('pro')"); await page.keyboard.press('Space'); await page.wait_for_timeout(600)
                check(await phase() == 'play', 'Space flaps')
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
                    await page.screenshot(path=f'{SHOTS}/desk_checkpoint.png')
                    await page.keyboard.press('KeyC'); await page.wait_for_timeout(1800)
                    check(await phase() == 'over', 'C cashes out')
                else:
                    print('note the bot missed before the first checkpoint, so C was not tried')
                    await page.wait_for_timeout(1800)
                await page.screenshot(path=f'{SHOTS}/desk_result.png')
                await page.click('#lobbyBtn'); await page.wait_for_timeout(900)
                check(await phase() == 'lobby' and (await rect('#tabbar'))['l'] == 0, 'back between runs, the sidebar returns')
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
