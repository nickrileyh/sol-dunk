# Render game sounds offline (no speaker needed) and measure them: peak, loudness, brightness, length.
# python3 tools/sfx.py flap unlockItem 'flap:[0.8]' ...   -> shots/sfx_<name>.wav
import asyncio, json, sys, wave
import numpy as np
from playwright.async_api import async_playwright
from _paths import URL, SHOTS, CHROME
SR = 44100
def stats(x):
    x = np.asarray(x, dtype=np.float64)
    peak = np.max(np.abs(x)) + 1e-12
    on = np.where(np.abs(x) > peak * 0.01)[0]  # within 40 dB of the peak
    length = (on[-1] - on[0]) / SR if len(on) else 0
    seg = x[on[0]:on[-1] + 1] if len(on) else x
    rms = np.sqrt(np.mean(seg ** 2)) + 1e-12
    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) ** 2
    f = np.fft.rfftfreq(len(seg), 1 / SR)
    centroid = float(np.sum(f * spec) / (np.sum(spec) + 1e-12))
    # how tonal: the share of energy in the 1% strongest frequency bins
    k = max(1, len(spec) // 100); tonal = float(np.sort(spec)[-k:].sum() / (spec.sum() + 1e-12))
    return dict(peak_db=round(20 * np.log10(peak), 1), rms_db=round(20 * np.log10(rms), 1), centroid_hz=round(centroid), length_s=round(length, 3), tonal=round(tonal, 2))
def write_wav(path, x):
    y = np.clip(np.asarray(x) * 32767, -32768, 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(y.tobytes())
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        page = await b.new_page(); await page.goto(URL); await page.wait_for_timeout(800)
        for spec in sys.argv[1:]:
            name, _, args = spec.partition(':')
            data = await page.evaluate(f"__solDunk.sfx('{name}', {args or '[]'}, 1.2)")
            tag = spec.replace(':', '_').replace('[', '').replace(']', '').replace(',', '_')
            write_wav(f'{SHOTS}/sfx_{tag}.wav', data)
            print(f'{spec:24s}', json.dumps(stats(data)))
        await b.close()
asyncio.run(main())
