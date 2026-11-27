"""The real-SOL page against a real server, in a browser: starts server/server.mjs on the mock chain (and its local
Postgres), loads the page it serves under its content security policy, connects a stand-in wallet (the Phantom API,
signing with a real ed25519 key), plays a run that the server verifies, cashes out and withdraws. Fails on any
content-security-policy violation or page error, so a change that the policy would break in production shows up here.
Screenshots to ./shots/server_*.png. Usage: python3 tools/server_flow.py"""
import asyncio, json, os, signal, socket, subprocess, sys, tempfile, time, urllib.request
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
from playwright.async_api import async_playwright
from _paths import ROOT, SHOTS, CHROME
OUT = SHOTS + '/server_'
B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
def b58(b):
    n = int.from_bytes(b, 'big'); out = ''
    while n: n, r = divmod(n, 58); out = B58[r] + out
    return '1' * (len(b) - len(b.lstrip(b'\0'))) + out
def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p
def call(base, path, body=None, token=None):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'content-type': 'application/json', **({'authorization': 'Bearer ' + token} if token else {})})
    with urllib.request.urlopen(req, timeout=20) as r: return json.loads(r.read())

async def main():
    port = free_port(); base = f'http://127.0.0.1:{port}'
    env = dict(os.environ, MOCK_CHAIN='1', PORT=str(port), DATA_DIR=tempfile.mkdtemp(prefix='soldunk-srv-'), LOG_LEVEL='warn', SPECIAL_UNLOCK_LAMPORTS='0', MISSION_DAY_LAMPORTS='5000000')  # 0.005 SOL: one small run unlocks mission SOL
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'server', 'server.mjs')], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    fails = []
    try:
        for _ in range(300):
            try: urllib.request.urlopen(base + '/healthz', timeout=1); break
            except Exception:
                if srv.poll() is not None: raise SystemExit('server exited: ' + srv.stdout.read().decode()[-1500:])
                time.sleep(0.2)
        else: raise SystemExit('server did not start')
        key = Ed25519PrivateKey.generate()
        address = b58(key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))
        # the same wallet signs in from here too, to use the mock faucet
        msg = call(base, '/api/auth/nonce', {'address': address})['message']
        token = call(base, '/api/auth/verify', {'address': address, 'signature': b58(key.sign(msg.encode()))})['token']
        call(base, '/api/dev/faucet', {'lamports': 2_000_000_000}, token)

        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path=CHROME)
            ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
            page = await ctx.new_page(); errs = []; csp = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.on('console', lambda m: csp.append(m.text) if 'Content Security Policy' in m.text or 'Content-Security-Policy' in m.text else None)
            await page.expose_function('__walletSign', lambda hexmsg: key.sign(bytes.fromhex(hexmsg)).hex())
            await page.add_init_script("""
              const hex = (u) => Array.from(u).map((x) => x.toString(16).padStart(2, '0')).join('');
              const unhex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
              const pk = { toString: () => '%s' };
              window.phantom = { solana: { isPhantom: true, publicKey: pk,
                connect: async () => ({ publicKey: pk }),
                signMessage: async (bytes) => ({ signature: unhex(await window.__walletSign(hex(bytes))) }) } };
            """ % address)
            resp = await page.goto(base + '/?notour'); await page.wait_for_timeout(2200)  # past the quick tour
            policy = resp.headers.get('content-security-policy', '')
            if "script-src 'self' 'sha256-" not in policy: fails.append('the page was served without its script policy: ' + policy[:80])
            if not await page.evaluate("typeof __solDunk === 'object'"): fails.append('the game did not start under the policy')
            # connect the wallet from the Wallet page
            await page.click('#tabProfile'); await page.wait_for_timeout(400)
            await page.click('#pBody [data-page="wallet"]'); await page.wait_for_timeout(500)
            await page.click('#wConnect'); await page.wait_for_timeout(1500)
            await page.screenshot(path=OUT + 'wallet.png')
            bal = lambda: page.evaluate("__solDunk.bal()")
            if abs(await bal() - 2) > 1e-9: fails.append(f'after connecting, the balance should be the server\'s 2 SOL, not {await bal()}: ' + await page.evaluate("(document.getElementById('wErr') || {}).textContent || ''"))
            await page.click('#pgBack'); await page.wait_for_timeout(400)
            await page.click('#tabPlay'); await page.wait_for_timeout(400)
            # the bet can't go past the server's live limit for the mode
            cfg = call(base, '/api/config')
            cap = cfg['difficulties'][0]['maxBet'] / 1e9
            press = lambda id, n: page.evaluate("([id, n]) => { for (let i = 0; i < n; i++) { const b = document.getElementById(id); if (!b.disabled) b.click(); } }", [id, n])
            await press('betUp', 20)
            bet = await page.evaluate("__solDunk.prefs.bet")
            if bet > min(cap, 2) + 1e-9: fails.append(f'the bet went to {bet}, past the limit {cap}')
            await press('betDown', 20); await press('betUp', 3)  # 0.01 SOL
            bet = await page.evaluate("__solDunk.prefs.bet")
            # a run the server verifies, played in real time
            await page.click('#diff0'); await page.click('#playBtn'); await page.wait_for_timeout(600)
            await page.evaluate("__solDunk.autoplay('perfect'); __solDunk.tap()")
            ph = None
            for _ in range(240):
                ph = await page.evaluate("__solDunk.phase()")
                if ph in ('checkpoint', 'over'): break
                await page.wait_for_timeout(250)
            await page.wait_for_timeout(1200); await page.screenshot(path=OUT + 'checkpoint.png')
            if ph != 'checkpoint': fails.append('the perfect bot did not reach the first checkpoint: ' + str(ph))
            else:
                await page.click('#cashBtn'); await page.wait_for_timeout(1500)
                await page.screenshot(path=OUT + 'result.png')
            me = call(base, '/api/me', None, token)
            if abs(await bal() - me['balance'] / 1e9) > 1e-9: fails.append(f"the page's balance {await bal()} is not the server's {me['balance'] / 1e9}")
            if ph == 'checkpoint' and not (me['balance'] / 1e9 >= 2 - 1e-9): fails.append(f"cashing out a cleared level should pay at least the bet back: {me['balance'] / 1e9}")
            runs = call(base, '/api/missions', None, token)
            if not isinstance(runs.get('daily'), list): fails.append('missions did not come back from the server')
            # mission SOL the run released waits for a claim: the result card's ticket claims it through the server
            ready = runs.get('readyLamports', 0)
            if ph == 'checkpoint' and not ready: fails.append('the perfect run released no mission SOL to claim')
            if ready:
                if not await page.query_selector('#msChip'): fails.append('no Claim ticket for mission SOL on the result card')
                else:
                    await page.wait_for_timeout(700); await page.click('#msChip'); await page.wait_for_timeout(1500)
                    me1, m1 = call(base, '/api/me', None, token), call(base, '/api/missions', None, token)
                    if me1['balance'] != me['balance'] + ready or m1['readyLamports'] != 0: fails.append(f"claiming mission SOL should pay {ready} lamports once: {me['balance']} -> {me1['balance']}, ready {m1['readyLamports']}")
                    if abs(await bal() - me1['balance'] / 1e9) > 1e-9: fails.append("the page's balance after the claim is not the server's")
                    me = me1
            # withdraw from the Wallet page
            await page.wait_for_timeout(700); await page.click('#lobbyBtn'); await page.wait_for_timeout(700)
            await page.click('#tabProfile'); await page.wait_for_timeout(400)
            await page.click('#pBody [data-page="wallet"]'); await page.wait_for_timeout(500)
            await page.fill('#wAmt', '0.5'); await page.click('#wWithdraw'); await page.wait_for_timeout(1800)
            await page.screenshot(path=OUT + 'withdraw.png')
            me2 = call(base, '/api/me', None, token)
            w = me2.get('withdrawals') or []
            if not (w and w[0]['lamports'] == 500_000_000 and w[0]['status'] == 'sent'): fails.append('the withdrawal did not go out: ' + json.dumps(w[:1]) + ' ' + await page.evaluate("(document.getElementById('wErr') || {}).textContent || ''"))
            if abs(me2['balance'] - (me['balance'] - 500_000_000)) > 0: fails.append('the withdrawal did not come off the balance')
            # a duel with nobody to race: the flight sets the mark and waits, its entry held
            await page.click('#pgBack'); await page.wait_for_timeout(400); await page.click('#tabChallenges'); await page.wait_for_timeout(900)
            d0 = await page.evaluate("__solDunk.duel()")
            if not (d0 and d0['demo'] is False and abs(d0['fee'] - 0.05) < 1e-9 and abs(d0['prize'] - 0.09) < 1e-9): fails.append('the duel did not come from the server: ' + json.dumps(d0))
            await page.evaluate("document.getElementById('chDuel').click()"); await page.wait_for_timeout(1500)
            await page.evaluate("__solDunk.autoplay('novice'); __solDunk.tap()")
            for _ in range(400):
                if await page.evaluate("__solDunk.phase()") == 'over': break
                await page.wait_for_timeout(250)
            await page.wait_for_timeout(1800); await page.screenshot(path=OUT + 'duel.png')
            d1 = await page.evaluate("__solDunk.duel()"); me3 = call(base, '/api/me', None, token)
            title = await page.evaluate("document.getElementById('resTitle').textContent")
            if not (title == 'Mark set' and d1 and len(d1['waiting']) == 1 and me3['balance'] == me2['balance'] - 50_000_000): fails.append(f"the duel mark was not set: {title} {json.dumps(d1)} {me3['balance'] - me2['balance']}")
            # a pot attempt on the day's course: the entry goes in, the flight is replayed and becomes the player's best
            await page.click('#lobbyBtn'); await page.wait_for_timeout(900)
            if await page.evaluate("!!document.getElementById('chPot')"):
                await page.evaluate("document.getElementById('chPot').click()"); await page.wait_for_timeout(1500)
                await page.evaluate("__solDunk.autoplay('average'); __solDunk.tap()")
                for _ in range(600):
                    if await page.evaluate("__solDunk.phase()") == 'over': break
                    await page.wait_for_timeout(250)
                await page.wait_for_timeout(1800); await page.screenshot(path=OUT + 'pot.png')
                pv = call(base, '/api/pot', None, token); me4 = call(base, '/api/me', None, token)
                unit = await page.evaluate("document.querySelector('#resAmount .unit').textContent")
                if not (pv['me']['attempts'] == 1 and pv['me']['best'] is not None and unit in ('point', 'points') and me4['balance'] == me3['balance'] - 50_000_000): fails.append('the pot attempt did not go through: ' + json.dumps(pv.get('me'))[:200] + ' ' + unit)
            else: fails.append('no pot card on Challenges')
            if csp: fails.append('content security policy violations: ' + ' | '.join(csp[:3]))
            if errs: fails.append('page errors: ' + ' | '.join(errs[:3]))
            await b.close()
    finally:
        os.killpg(srv.pid, signal.SIGTERM)
        try: srv.wait(timeout=15)
        except Exception: os.killpg(srv.pid, signal.SIGKILL)
    print('server flow:', 'FAIL ' + '; '.join(fails) if fails else 'ok (wallet sign-in, a verified run, cash-out, a mission SOL claim, a withdrawal, a duel mark and a pot attempt under the page\'s security policy)')
    sys.exit(1 if fails else 0)
asyncio.run(main())
