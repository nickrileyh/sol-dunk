import asyncio, os, sys
from playwright.async_api import async_playwright
from PIL import Image
from _paths import URL, SHOTS, CHROME
# AUDIT_SIZE=375x667 (or 1440x900 for desktop) changes the viewport; shots get the size in their names
W, H = (int(v) for v in os.environ.get('AUDIT_SIZE', '390x844').split('x'))
MOBILE = W < 700
OUT = SHOTS + ('/a_' if (W, H) == (390, 844) else f'/a{W}x{H}_')
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        ctx = await b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=2 if MOBILE else 1, is_mobile=MOBILE, has_touch=MOBILE)
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(URL); await page.wait_for_timeout(3000)
        await page.screenshot(path=OUT + 'lobby.png')
        # the Odds link by the tier line opens Odds & fairness; Back returns to Play
        await page.click('#lobby [data-page="odds"]'); await page.wait_for_timeout(500)
        await page.screenshot(path=OUT + 'page_odds.png')
        await page.evaluate("document.getElementById('pgBody').scrollTop = 1e4"); await page.wait_for_timeout(250); await page.screenshot(path=OUT + 'page_odds_end.png')
        await page.click('#pgBack'); await page.wait_for_timeout(400)
        # the other tabs: Challenges (and the pages it opens), Missions (its three parts), Profile, the Locker's six shelves and the player card editor
        await page.click('#tabChallenges'); await page.wait_for_timeout(700); await page.screenshot(path=OUT + 'tab_challenges.png')
        await page.evaluate("document.getElementById('cBody').scrollTop = 1e4"); await page.wait_for_timeout(250); await page.screenshot(path=OUT + 'tab_challenges_end.png')
        await page.evaluate("document.getElementById('cBody').scrollTop = 0"); await page.wait_for_timeout(150)
        for name in ['special', 'pot']:
            await page.click(f'#cBody [data-page="{name}"]'); await page.wait_for_timeout(600)
            await page.screenshot(path=OUT + 'page_' + name + '.png')
            await page.click('#pgBack'); await page.wait_for_timeout(400)
        await page.click('#tabMissions'); await page.wait_for_timeout(700)
        for name in ['day', 'week', 'career']:
            await page.click(f'#mBody .ms-seg [data-seg="{name}"]'); await page.wait_for_timeout(500)
            await page.screenshot(path=OUT + 'tab_missions_' + name + '.png')
        await page.click('#tabProfile'); await page.wait_for_timeout(500); await page.screenshot(path=OUT + 'tab_profile.png')
        await page.click('#pfLocker'); await page.wait_for_timeout(900)
        for cat in ['ball', 'wing', 'trail']:
            await page.click(f'#lkCats [data-cat="{cat}"]'); await page.wait_for_timeout(700); await page.screenshot(path=OUT + 'locker_' + cat + '.png')
        await page.click('#lkBack'); await page.wait_for_timeout(500)
        # the pages Profile opens: trophies, stats, settings, how to play (odds & fairness is above, the wallet below)
        for name in ['trophies', 'stats', 'settings', 'how']:
            await page.click(f'#pBody [data-page="{name}"]'); await page.wait_for_timeout(500)
            await page.screenshot(path=OUT + 'page_' + name + '.png')
            await page.click('#pgBack'); await page.wait_for_timeout(400)
        await page.evaluate("document.getElementById('pBody').scrollTop = 0"); await page.wait_for_timeout(150)
        await page.click('#pfCard'); await page.wait_for_timeout(500); await page.screenshot(path=OUT + 'panel_card.png')
        await page.click('#panelClose'); await page.wait_for_timeout(400)
        await page.click('#tabPlay'); await page.wait_for_timeout(600)
        await page.click('#balBtn'); await page.wait_for_timeout(500); await page.screenshot(path=OUT + 'page_wallet.png')
        await page.click('#pgBack'); await page.wait_for_timeout(400)
        await page.click('#playBtn'); await page.wait_for_timeout(250)
        await page.screenshot(path=OUT + 'glide.png')
        await page.wait_for_timeout(700)
        await page.screenshot(path=OUT + 'ready.png')
        await page.evaluate("__solDunk.autoplay('good'); __solDunk.tap()")
        await page.wait_for_timeout(1800); await page.screenshot(path=OUT + 'play1.png')
        await page.click('#pauseBtn'); await page.wait_for_timeout(400); await page.screenshot(path=OUT + 'pause.png')
        await page.click('#pauseCard [data-page="how"]'); await page.wait_for_timeout(500); await page.screenshot(path=OUT + 'pause_how.png')
        await page.click('#pgBack'); await page.wait_for_timeout(400)
        await page.click('#resumeBtn'); await page.wait_for_timeout(1500)
        await page.wait_for_timeout(1300); await page.screenshot(path=OUT + 'play2.png')
        for i in range(160):
            ph = await page.evaluate('__solDunk.phase()')
            if ph in ('checkpoint', 'over'): break
            await page.wait_for_timeout(120)
        await page.wait_for_timeout(700); await page.screenshot(path=OUT + 'after1.png')
        if ph == 'checkpoint':
            await page.click('#goBtn'); await page.wait_for_timeout(1200); await page.screenshot(path=OUT + 'level2.png')
            await page.evaluate("__solDunk.autoplay(null)")
            await page.evaluate("__solDunk.tap()")
            for i in range(100):
                ph = await page.evaluate('__solDunk.phase()')
                if ph == 'over': break
                await page.wait_for_timeout(120)
            await page.wait_for_timeout(300); await page.screenshot(path=OUT + 'bust_moment.png')
            await page.wait_for_timeout(1400); await page.screenshot(path=OUT + 'result.png')
        print('errors', errs)
        await b.close()
asyncio.run(main())
