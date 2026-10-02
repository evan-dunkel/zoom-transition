import asyncio, os
DEMO = os.environ.get('ZOOM_DEMO_URL', 'http://localhost:8765/dist/')
SCAN = os.environ.get('ZOOM_SCAN_URL', 'http://localhost:8765/test/scan.html')
CHROMIUM = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') or None
from playwright.async_api import async_playwright
ST = "() => ({phase: document.querySelector('.zoom-root').dataset.phase || 'idle', top: Math.round(document.querySelector('.zoom-card:not([inert]) .zoom-card-scroll')?.scrollTop ?? -1)})"
async def touch_drag(cdp, x, y0, y1, steps=12, dt=16, pg=None):
    await cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y0}]})
    for i in range(1, steps+1):
        y = y0 + (y1-y0)*i/steps
        await cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':x,'y':y}]})
        await pg.wait_for_timeout(dt)
    await cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROMIUM)
        ctx = await b.new_context(viewport={'width':430,'height':900}, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); cdp = await ctx.new_cdp_session(pg)
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(DEMO); await pg.wait_for_timeout(800); await pg.check('input[name=drag-bottom]')  # bottom edges are off by default
        s = lambda: pg.evaluate(ST)
        async def openbook():
            await pg.tap('.book >> nth=1'); await pg.wait_for_timeout(1200)
        await openbook()
        await pg.evaluate("document.querySelector('.zoom-card:not([inert]) .zoom-card-scroll').scrollTop = 90"); await pg.wait_for_timeout(300)
        await touch_drag(cdp, 215, 600, 380, pg=pg); await pg.wait_for_timeout(600)
        print('mid-content, drag up ->', await s(), '(expect open, scrolled further)')
        await pg.evaluate("document.querySelector('.zoom-card:not([inert]) .zoom-card-scroll').scrollTop = 9999"); await pg.wait_for_timeout(300)
        await touch_drag(cdp, 215, 600, 560, steps=8, dt=40, pg=pg); await pg.wait_for_timeout(800)
        print('at bottom, short slow drag up ->', await s(), '(expect open: springs back)')
        z = await pg.evaluate("document.querySelector('.zoom-zoomer').style.transform || 'none'")
        print('   zoom after spring-back:', z)
        await touch_drag(cdp, 215, 650, 380, pg=pg); await pg.wait_for_timeout(100)
        print('at bottom, drag up ->', await s(), '(expect closing)')
        await pg.wait_for_timeout(1200)
        await openbook()
        await touch_drag(cdp, 215, 300, 560, pg=pg); await pg.wait_for_timeout(100)
        print('at top, drag down ->', await s(), '(expect closing)')
        await pg.wait_for_timeout(1200)
        print(errs)
        await b.close()
asyncio.run(main())
