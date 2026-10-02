import asyncio, json, os
DEMO = os.environ.get('ZOOM_DEMO_URL', 'http://localhost:8765/dist/')
SCAN = os.environ.get('ZOOM_SCAN_URL', 'http://localhost:8765/test/scan.html')
CHROMIUM = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') or None
from playwright.async_api import async_playwright
TRACK = """(sel) => { window.__t=[]; const f=()=>{ const c=document.querySelector('.zoom-clone[data-zoom-id="'+sel+'"]') || document.querySelector('.zoom-card[data-zoom-id="'+sel+'"] [data-zoom-hero]');
  const card=document.querySelector('.zoom-card[data-zoom-id="'+sel+'"]');
  if (c && card) { const r=c.getBoundingClientRect(), k=card.getBoundingClientRect(); window.__t.push([performance.now(), r.left, r.top, r.width, k.left, k.top, k.width, document.querySelector('.zoom-dim').style.opacity]); }
  if (window.__t.length<400) requestAnimationFrame(f);}; f(); }"""
def maxjump(t):
    m=0
    for a,b in zip(t,t[1:]):
        for i in range(1,7):
            m=max(m,abs(b[i]-a[i]))
    return round(m,1)
async def state(pg):
    return await pg.evaluate("""() => ({phase: document.querySelector('.zoom-root').dataset.phase, open: document.querySelector('.zoom-root').hasAttribute('data-open'),
      hidden: document.querySelectorAll('[data-zoom-hidden]').length, clones: document.querySelectorAll('.zoom-clone').length,
      hiddenHeroes: [...document.querySelectorAll('[data-zoom-hero]')].filter(h=>h.style.visibility==='hidden').length,
      active: document.querySelector('.zoom-card:not([inert])')?.dataset.zoomId})""")
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROMIUM)
        pg = await b.new_page(viewport={'width':430,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(DEMO); await pg.wait_for_timeout(800)
        # 1. interrupt opening with Escape
        await pg.click('.book >> nth=1'); await pg.wait_for_timeout(30)
        await pg.evaluate(TRACK, 'night-shift-at-the-observatory')
        await pg.wait_for_timeout(120); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(1200)
        t = await pg.evaluate('window.__t'); print('1 open->close  max per-frame move', maxjump(t), await state(pg))
        # 2. interrupt closing by tapping the card
        await pg.click('.book >> nth=1'); await pg.wait_for_timeout(1000)
        await pg.evaluate(TRACK, 'night-shift-at-the-observatory')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(70)
        box = await pg.locator('.zoom-clone[data-zoom-id="night-shift-at-the-observatory"]').bounding_box()
        await pg.mouse.click(box['x']+box['width']/2, box['y']+box['height']/2); await pg.wait_for_timeout(1200)
        t = await pg.evaluate('window.__t'); print('2 close->reopen max per-frame move', maxjump(t), await state(pg))
        # 3. close in slow motion, tap a different landed/landing book -> reopen with it
        await pg.evaluate("document.querySelector('.slowmo').click()") if False else None
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(600)
        print('3a after close', await state(pg))
        await pg.click('.book >> nth=2'); await pg.wait_for_timeout(1000)
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(160)
        # click on the first book's slot (its card may have landed)
        bb = await pg.locator('.book >> nth=0').bounding_box()
        await pg.mouse.click(bb['x']+50, bb['y']+80); await pg.wait_for_timeout(1300)
        print('3b reopened via slot', await state(pg))
        # 4. rapid toggling
        for k in range(6):
            await pg.keyboard.press('Escape') if k%2==0 else await pg.mouse.click(215, 400)
            await pg.wait_for_timeout(60)
        await pg.wait_for_timeout(1500)
        print('4 after rapid toggles', await state(pg))
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(1200)
        print('final', await state(pg), errs)
        await b.close()
asyncio.run(main())
