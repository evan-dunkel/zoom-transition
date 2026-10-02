import asyncio
from playwright.async_api import async_playwright
ST = """() => { const sc=document.querySelector('.zoom-card:not([inert]) .zoom-card-scroll'); const z=document.querySelector('.zoom-zoomer');
 return {phase: document.querySelector('.zoom-root').dataset.phase || 'idle', scrollTop: sc ? Math.round(sc.scrollTop) : null, zoom: z.style.transform.slice(0,60), store: Math.round(document.querySelector('.store').scrollTop)} }"""
async def wheel(pg, dy, n, gap=30):
    for _ in range(n):
        await pg.mouse.wheel(0, dy); await pg.wait_for_timeout(gap)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width':430,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8765/book-store-zoom.html'); await pg.wait_for_timeout(800)
        s = lambda: pg.evaluate(ST)
        await pg.click('.book >> nth=1'); await pg.wait_for_timeout(1000)
        await pg.mouse.move(215, 500)
        print('1 small pull at top')
        await wheel(pg, -60, 2); print('  during', await s())
        await pg.wait_for_timeout(700); print('  after pause', await s())
        print('2 normal scroll down inside card')
        await pg.wait_for_timeout(300); await wheel(pg, 80, 4); await pg.wait_for_timeout(300); print('  ', await s())
        print('3 fast scroll up through the top in one gesture (momentum)')
        await wheel(pg, -80, 10, gap=20); await pg.wait_for_timeout(500); print('  ', await s())
        print('4 fresh pull at top past threshold')
        await pg.wait_for_timeout(300); await wheel(pg, -60, 6); 
        await pg.wait_for_timeout(100); print('  ', await s())
        await wheel(pg, -60, 5, gap=40)  # momentum tail
        await pg.wait_for_timeout(1000); print('  after', await s())
        print('5 bottom pull')
        await pg.click('.book >> nth=1'); await pg.wait_for_timeout(1000); await pg.mouse.move(215, 500)
        await wheel(pg, 400, 6); await pg.wait_for_timeout(400); print('  at bottom', await s())
        await wheel(pg, 60, 6); await pg.wait_for_timeout(800); print('  after', await s())
        print(errs)
        await b.close()
asyncio.run(main())
