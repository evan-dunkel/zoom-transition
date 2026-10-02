import asyncio
from playwright.async_api import async_playwright
JS_LOG = """() => { window.__log=[]; const r=document.querySelector('.row'); const books=document.querySelectorAll('.row')[0].querySelectorAll('.cover-wrap');
 const f=()=>{ window.__log.push([r.scrollLeft, [...books].map(b=>Math.round(b.getBoundingClientRect().left)).join(','), document.querySelector('.zoom-root').hasAttribute('data-open')]); if(window.__log.length<150) requestAnimationFrame(f)}; f(); }"""
async def run(pg, label, pages):
    await pg.click('.book >> nth=3'); await pg.wait_for_timeout(1300)
    for _ in range(pages):
        await pg.keyboard.press('ArrowRight'); await pg.wait_for_timeout(700)
    await pg.evaluate(JS_LOG)
    await pg.keyboard.press('Escape'); await pg.wait_for_timeout(2500)
    log = await pg.evaluate("window.__log")
    closed = [l for l in log if not l[2]]
    # after the overlay closes, positions must not change any more
    print(label, 'scrollLeft at start', log[0][0], 'after landing', closed[0][0] if closed else None, 'stable after close:', len({(l[0],l[1]) for l in closed})==1)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width':430,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file:///mnt/user-data/outputs/book-store-zoom.html'); await pg.wait_for_timeout(800)
        bb = await pg.locator('.row').first.bounding_box()
        await pg.mouse.move(bb['x']+200, bb['y']+80)
        for _ in range(30):
            await pg.mouse.wheel(23, 0); await pg.wait_for_timeout(30)
        await pg.wait_for_timeout(1200)
        await run(pg, 'scrolled to end, close visible book:', 0)
        await pg.evaluate("document.querySelector('.row').scrollLeft=0"); await pg.wait_for_timeout(500)
        await run(pg, 'page to offscreen book, close:', 3)
        print(errs, await pg.evaluate("[...document.querySelectorAll('.tune label')].map(l=>l.textContent.trim().slice(0,12))"))
        await b.close()
asyncio.run(main())
