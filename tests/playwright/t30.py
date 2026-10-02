import asyncio, os
DEMO = os.environ.get('ZOOM_DEMO_URL', 'http://localhost:8765/dist/')
SCAN = os.environ.get('ZOOM_SCAN_URL', 'http://localhost:8765/test/scan.html')
CHROMIUM = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') or None
from playwright.async_api import async_playwright
ST = """() => ({phase: document.querySelector('.zoom-root').dataset.phase || 'idle', top: Math.round(document.querySelector('.zoom-card:not([inert]) .zoom-card-scroll')?.scrollTop ?? -1)})"""
async def seq(pg, deltas, gap=16):
    for d in deltas:
        await pg.mouse.wheel(0, d); await pg.wait_for_timeout(gap)
async def fresh(pg):
    st = await pg.evaluate(ST)
    if st['phase'] != 'open':
        await pg.wait_for_timeout(900); await pg.click('.book >> nth=1'); await pg.wait_for_timeout(1000); await pg.mouse.move(215, 500)
    await pg.evaluate("document.querySelector('.zoom-card:not([inert]) .zoom-card-scroll').scrollTop = 0"); await pg.wait_for_timeout(400)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROMIUM)
        pg = await b.new_page(viewport={'width':430,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(DEMO); await pg.wait_for_timeout(800)
        await pg.click('.book >> nth=1'); await pg.wait_for_timeout(1000); await pg.mouse.move(215, 500)
        swipe = [3,8,16,28,40,45,45,40]                     # fingers
        momentum = [38,32,27,22,18,15,12,10,8,6,5,4,3,2,2,1,1]  # decays after lift
        retry = [2,5,10,18,28,36,45,50,50,45,40,30]
        s = lambda: pg.evaluate(ST)
        await fresh(pg)
        await seq(pg, swipe + momentum); await pg.wait_for_timeout(60)
        print('trackpad: one swipe + momentum through the bottom ->', await s(), '(expect open)')
        await seq(pg, retry); await pg.wait_for_timeout(60)
        print('trackpad: immediate second swipe ->', await s(), '(expect closing)')
        await fresh(pg)
        await seq(pg, swipe + momentum[:6]); 
        await seq(pg, retry); await pg.wait_for_timeout(60)
        print('trackpad: second swipe interrupting momentum ->', await s(), '(expect closing)')
        await fresh(pg)
        await seq(pg, [3,8,16,28,40,50,60,70,80,90,90,90,90]); await pg.wait_for_timeout(60)
        print('trackpad: one accelerating swipe through the bottom ->', await s(), '(expect open)')
        await fresh(pg)
        await seq(pg, [100]*8, gap=30); await pg.wait_for_timeout(60)
        print('mouse: one spin through the bottom ->', await s(), '(expect open)')
        await pg.wait_for_timeout(110); await seq(pg, [100]*4, gap=30); await pg.wait_for_timeout(60)
        print('mouse: quick second spin ->', await s(), '(expect closing)')
        await fresh(pg)
        await seq(pg, [-100]*1); await pg.wait_for_timeout(60)
        print('mouse at top after pause, one notch ->', await s(), '(pull starts, not closed)')
        await fresh(pg)
        await seq(pg, [100]*10, gap=90); await pg.wait_for_timeout(60)
        print('mouse: one slow spin through the bottom ->', await s(), '(expect open)')
        print(errs)
        await b.close()
asyncio.run(main())
