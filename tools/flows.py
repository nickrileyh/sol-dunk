import asyncio
from playwright.async_api import async_playwright
from _paths import URL, SHOTS, CHROME
OUT = SHOTS + '/'
async def run_flow(page, di, skill, keep_going_until, shots_prefix, shoot=False):
    await page.evaluate(f"document.querySelector('#diff{di}').click()")
    await page.click('#playBtn')
    await page.wait_for_timeout(800)
    if shoot: await page.screenshot(path=OUT + shots_prefix + '_ready.png')
    await page.evaluate(f"__solDunk.autoplay('{skill}'); __solDunk.tap()")
    seen = []
    for step in range(2000):
        ph = await page.evaluate('__solDunk.phase()')
        if ph == 'checkpoint':
            lvl = await page.evaluate('__solDunk.run.level')
            seen.append(('cp', lvl, round(await page.evaluate('__solDunk.run.total'), 4)))
            if lvl < keep_going_until:
                await page.click('#goBtn'); await page.wait_for_timeout(700); await page.evaluate('__solDunk.tap()')
            else:
                await page.click('#cashBtn'); await page.wait_for_timeout(900); break
        elif ph == 'over':
            await page.wait_for_timeout(1300)
            break
        await page.wait_for_timeout(120)
    res = await page.evaluate("({phase: __solDunk.phase(), level: __solDunk.run.level, total: __solDunk.run.total, bal: __solDunk.wallet.balance, title: document.getElementById('resTitle').textContent, amt: document.getElementById('resAmount').textContent, toast: document.getElementById('toast').textContent, resVisible: !document.getElementById('result').classList.contains('hide')})")
    if shoot: await page.screenshot(path=OUT + shots_prefix + '_end.png')
    return seen, res

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        ctx = await b.new_context(viewport={'width': 390, 'height': 780}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page = await ctx.new_page()
        logs = []
        page.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if m.type in ('error','warning') else None)
        page.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        await page.goto(URL)
        await page.wait_for_timeout(2600)
        await page.screenshot(path=OUT + 'a_lobby.png')
        # 1) novice on Pro: expect an early bust
        seen, res = await run_flow(page, 1, 'novice', 8, 'b_bust', shoot=True)
        print('bust flow:', seen, res)
        await page.click('#lobbyBtn'); await page.wait_for_timeout(500)
        # 2) perfect on Rookie through all 8 levels -> champion
        seen, res = await run_flow(page, 0, 'perfect', 8, 'c_final')
        print('final flow:', seen, res)
        await page.click('#lobbyBtn'); await page.wait_for_timeout(500)
        # 3) perfect on Legend -> max win cap
        seen, res = await run_flow(page, 3, 'perfect', 8, 'd_max', shoot=True)
        print('maxwin flow:', seen, res)
        # play again works after a win
        await page.click('#againBtn'); await page.wait_for_timeout(900)
        print('after play again phase:', await page.evaluate('__solDunk.phase()'))
        await page.screenshot(path=OUT + 'e_again_ready.png')
        print('stats:', await page.evaluate('JSON.stringify({runs: __solDunk.stats.runs, wag: __solDunk.stats.wagered, ret: __solDunk.stats.returned})'))
        print('\n'.join(logs) or 'no errors')
        await b.close()
asyncio.run(main())
