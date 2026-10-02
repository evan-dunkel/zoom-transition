import asyncio, os
DEMO = os.environ.get('ZOOM_DEMO_URL', 'http://localhost:8765/dist/')
SCAN = os.environ.get('ZOOM_SCAN_URL', 'http://localhost:8765/test/scan.html')
CHROMIUM = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') or None
from playwright.async_api import async_playwright
TRK = """(id) => { window.__h=[]; const f=()=>{ const c=document.querySelector('.zoom-clone[data-zoom-id="'+id+'"]'); const h=document.querySelector('.zoom-card[data-zoom-id="'+id+'"] [data-zoom-hero]');
  let r=null, src='';
  if (c) { r=c.getBoundingClientRect(); src='clone'; } else if (h && h.style.visibility!=='hidden') { r=h.getBoundingClientRect(); src='hero'; }
  if (r) window.__h.push([src, Math.round(r.top*10)/10, Math.round(r.width*10)/10]);
  if (window.__h.length<500) requestAnimationFrame(f)}; f(); }"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROMIUM)
        pg = await b.new_page(viewport={'width':430,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(DEMO); await pg.wait_for_timeout(800)
        await pg.click('.slowmo')
        await pg.click('.book >> nth=2'); await pg.evaluate(TRK, 'field-notes-on-leaving')
        await pg.wait_for_timeout(500); await pg.mouse.move(215, 600)
        for _ in range(4):
            await pg.mouse.wheel(0, 50); await pg.wait_for_timeout(40)
        await pg.wait_for_timeout(3500)
        h = await pg.evaluate('window.__h')
        swap = next((i for i in range(1,len(h)) if h[i-1][0]=='clone' and h[i][0]=='hero'), None)
        print('open with scroll mid-flight: scrollTop', await pg.evaluate("document.querySelector('.zoom-card:not([inert]) .zoom-card-scroll').scrollTop"))
        if swap: print('  at hand-over: clone', h[swap-1], '-> hero', h[swap], ' jump', round(h[swap][1]-h[swap-1][1],1), 'px')
        else: print('  no swap seen', h[-3:])
        # close, then scroll the page behind during the close
        await pg.evaluate("timeScale=1") if False else None
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        await pg.mouse.move(215, 700)
        for _ in range(3):
            await pg.mouse.wheel(0, 80); await pg.wait_for_timeout(40)
        await pg.wait_for_timeout(3500)
        print('closed:', await pg.evaluate("document.querySelector('.zoom-root').dataset.phase || 'idle'"), 'store scrolled', await pg.evaluate("document.querySelector('.store').scrollTop"))
        print(errs)
        await b.close()
asyncio.run(main())
