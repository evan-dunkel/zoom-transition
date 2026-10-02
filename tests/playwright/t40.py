import asyncio, os
DEMO = os.environ.get('ZOOM_DEMO_URL', 'http://localhost:8765/dist/')
SCAN = os.environ.get('ZOOM_SCAN_URL', 'http://localhost:8765/test/scan.html')
CHROMIUM = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') or None
from playwright.async_api import async_playwright
TRK = """(id) => { window.__c=[]; const src=document.querySelector('.book[aria-label^="Field Notes"] .cover-wrap'); const f=()=>{ const c=document.querySelector('.zoom-clone[data-zoom-id="'+id+'"]');
  const hidden = src.hasAttribute('data-zoom-hidden');
  if (c) { const r=c.getBoundingClientRect(); window.__c.push(['clone', Math.round(r.top*10)/10, Math.round(r.left*10)/10]); }
  else if (!hidden) { const r=src.getBoundingClientRect(); window.__c.push(['source', Math.round(r.top*10)/10, Math.round(r.left*10)/10]); }
  if (window.__c.length<600) requestAnimationFrame(f)}; f(); }"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROMIUM)
        pg = await b.new_page(viewport={'width':430,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(DEMO); await pg.wait_for_timeout(800)
        await pg.click('.book >> nth=2'); await pg.wait_for_timeout(1200)
        await pg.click('.slowmo', force=True) if False else None
        await pg.evaluate(TRK, 'field-notes-on-leaving')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(60)
        await pg.mouse.move(215, 700)
        for _ in range(3):
            await pg.mouse.wheel(0, 60); await pg.wait_for_timeout(20)
        await pg.wait_for_timeout(1500)
        c = await pg.evaluate('window.__c')
        swap = next((i for i in range(1,len(c)) if c[i-1][0]=='clone' and c[i][0]=='source'), None)
        print('store scrolled', await pg.evaluate("document.querySelector('.store').scrollTop"))
        if swap: print('hand-over: ', c[swap-1], '->', c[swap], 'jump', round(c[swap][1]-c[swap-1][1],1), round(c[swap][2]-c[swap-1][2],1))
        else: print('no swap', c[:3], c[-3:])
        print(errs)
        await b.close()
asyncio.run(main())
