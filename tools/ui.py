"""Checks the lobby's navigation and what lives behind it: the four tabs, the Locker (equip, try-on, leaving
clears the try-on), the missions (daily, weekly, career progress after a run), the player card editor, the
pause card, and that items already earned under the newer unlock list are handed out on load."""
import asyncio, json
from playwright.async_api import async_playwright
from _paths import URL, SHOTS, CHROME
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
        await page.goto(URL); await page.wait_for_timeout(1200)
        tab = lambda: page.evaluate("document.body.dataset.tab")
        vis = lambda sel: page.evaluate(f"!document.querySelector('{sel}').classList.contains('hide')")
        check(await tab() == 'play' and await vis('#lobby'), 'opens on Play with the bet sheet')
        # tabs
        await page.click('#tabMissions'); await page.wait_for_timeout(400)
        check(await tab() == 'missions' and await vis('#vMissions') and not await vis('#lobby'), 'Missions tab shows the missions page')
        n = await page.evaluate("document.querySelectorAll('#mBody .mrow').length")
        check(n == 10, f'missions page lists 3 daily + 3 weekly + 4 career missions ({n})')
        await page.keyboard.press('Space'); await page.wait_for_timeout(400)
        check(await page.evaluate('__solDunk.phase()') == 'lobby', 'Space on the Missions tab does not start a run')
        await page.click('#tabLocker'); await page.wait_for_timeout(600)
        check(await tab() == 'locker' and await vis('#vLocker'), 'Locker tab shows the locker over the arena')
        # equip an owned ball, then try a locked one
        await page.evaluate("__solDunk.profile.owned.push('ball:retro')")
        await page.click('#lkCats [data-cat="ball"]'); await page.wait_for_timeout(200)
        await page.evaluate("document.querySelector('#tabLocker').click()")
        await page.click('#lkGrid .item[data-id="retro"]'); await page.wait_for_timeout(300)
        check(await page.evaluate("__solDunk.profile.eq.ball") == 'retro', 'tapping an owned ball equips it')
        await page.click('#lkGrid .item[data-id="gold"]'); await page.wait_for_timeout(300)
        tr = await page.evaluate("__solDunk.nav.try")
        check(tr == {'t': 'ball', 'id': 'gold'} and await page.evaluate("__solDunk.profile.eq.ball") == 'retro', 'tapping a locked ball tries it on without equipping it')
        info = await page.evaluate("document.getElementById('lkInfo').textContent")
        check('Preview' in info and 'Legendary' in info, 'the info line says it is a preview and how rare it is')
        for cat in ['wing', 'flame', 'trail', 'rim', 'court']:
            await page.click(f'#lkCats [data-cat="{cat}"]'); await page.wait_for_timeout(250)
            c = await page.evaluate("document.querySelectorAll('#lkGrid .item').length")
            check(c >= 6, f'{cat} shelf has {c} items')
        check(await page.evaluate("__solDunk.nav.try") is None, 'changing shelf ends the try-on')
        await page.click('#lkGrid .item[data-id="orbit"]'); await page.wait_for_timeout(300)
        await page.click('#tabPlay'); await page.wait_for_timeout(400)
        check(await page.evaluate("__solDunk.nav.try") is None and await page.evaluate("__solDunk.profile.eq.court") == 'arena', 'leaving the locker ends the try-on')
        # profile and the card editor
        await page.click('#profBtn'); await page.wait_for_timeout(400)
        check(await tab() == 'profile' and await vis('#vProfile'), 'the level capsule opens the Profile tab')
        await page.click('#pfCard'); await page.wait_for_timeout(400)
        await page.fill('#peIn', 'Nick'); await page.dispatch_event('#peIn', 'change')
        await page.click('#panelBody [data-em="crown"]'); await page.wait_for_timeout(150)
        await page.click('#panelBody [data-col="3"]'); await page.wait_for_timeout(150)
        card = await page.evaluate("__solDunk.profile.card")
        check(card['name'] == 'Nick' and card['emblem'] == 'crown' and card['color'] == 3, f'player card saves name, emblem and colour {card}')
        locked = await page.evaluate("document.querySelectorAll('#panelBody [data-ti][disabled]').length")
        check(locked >= 8, f'locked titles are disabled ({locked})')
        await page.click('#panelClose'); await page.wait_for_timeout(300)
        check('Nick' in await page.evaluate("document.getElementById('pBody').textContent"), 'the profile shows the new name')
        # a run: pause card, then mission progress afterwards
        await page.click('#tabPlay'); await page.wait_for_timeout(400)
        before = await page.evaluate("JSON.stringify([__solDunk.profile.weekly, __solDunk.profile.career])")
        await page.click('#playBtn'); await page.wait_for_timeout(900)
        await page.evaluate("__solDunk.autoplay('perfect'); __solDunk.tap()"); await page.wait_for_timeout(1500)
        check(not await vis('#tabbar') or await page.evaluate("getComputedStyle(document.getElementById('tabbar')).opacity") == '0', 'the tab bar hides during a run')
        await page.click('#pauseBtn'); await page.wait_for_timeout(300)
        check(await page.evaluate('__solDunk.phase()') == 'paused' and await vis('#pauseCard'), 'pause shows the pause card')
        await page.click('#resumeBtn'); await page.wait_for_timeout(1600)
        check(await page.evaluate('__solDunk.phase()') in ('play', 'clearing', 'checkpoint') and not await vis('#pauseCard'), 'Resume counts down and plays on')
        for i in range(160):
            ph = await page.evaluate('__solDunk.phase()')
            if ph in ('checkpoint', 'over'): break
            await page.wait_for_timeout(100)
        if ph == 'checkpoint':
            await page.wait_for_timeout(900); await page.click('#cashBtn'); await page.wait_for_timeout(2200)
        after = await page.evaluate("JSON.stringify([__solDunk.profile.weekly, __solDunk.profile.career])")
        check(after != before, 'the run moved the weekly and career missions on')
        car = await page.evaluate("__solDunk.profile.career")
        check(car['p'][0] > 0 or car['ch'] > 0, f"career progress recorded {car}")
        await page.click('#lobbyBtn'); await page.wait_for_timeout(500)
        check(await tab() == 'play' and await vis('#lobby'), 'Change bet returns to the Play tab')
        # items earned under the newer unlock list are handed out on load
        await page.evaluate("""(() => { const p = JSON.parse(localStorage.getItem('soldunk.profile')); p.xp = 3000; p.owned = ['ball:classic', 'wing:angel', 'flame:fire']; p.fresh = []; localStorage.setItem('soldunk.profile', JSON.stringify(p)); })()""")
        await page.reload(); await page.wait_for_timeout(1200)
        owned = await page.evaluate("__solDunk.profile.owned")
        check(all(k in owned for k in ['ball:street', 'court:rooftop', 'rim:chrome', 'trail:sparkle']), 'a level-12 player gets the new items for their level on load')
        check(await page.evaluate("document.getElementById('badgeL').classList.contains('on')"), 'the Locker tab shows a dot for new items')
        await page.screenshot(path=SHOTS + '/ui_end.png')
        check(not errs, 'no page errors ' + json.dumps(errs))
        await b.close()
    print('FAILS', fails if fails else 'none')
asyncio.run(main())
