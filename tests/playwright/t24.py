import asyncio, os
DEMO = os.environ.get('ZOOM_DEMO_URL', 'http://localhost:8765/dist/')
SCAN = os.environ.get('ZOOM_SCAN_URL', 'http://localhost:8765/test/scan.html')
CHROMIUM = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') or None
from playwright.async_api import async_playwright
SETUP = """() => { window.__lt=[]; new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({entryTypes:['longtask']});
 window.__fr=[]; let last=performance.now(); const f=(t)=>{ window.__fr.push([Math.round(t), Math.round(t-last)]); last=t; if (window.__fr.length<300) requestAnimationFrame(f)}; requestAnimationFrame(f);
 window.addEventListener('pointerup', () => { const t0=performance.now(); window.__up=t0; queueMicrotask(()=>{}); setTimeout(()=>{ window.__upTask = performance.now()-t0 },0); }, true);
 const orig = window.__dbgClose; }"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROMIUM)
        pg = await b.new_page(viewport={'width':430,'height':900})
        await pg.goto(DEMO); await pg.wait_for_timeout(800)
        for mode in ['own','synced','static']:
            await pg.select_option('.tune select', mode)
            await pg.click('.book >> nth=1'); await pg.wait_for_timeout(1500)
            box = await pg.locator('.phone').bounding_box(); cx, cy = box['x']+box['width']/2, box['y']+300
            await pg.evaluate(SETUP)
            await pg.mouse.move(cx, cy); await pg.mouse.down()
            for i in range(14):
                await pg.mouse.move(cx+3*i, cy+18*i); await pg.wait_for_timeout(16)
            await pg.mouse.up(); await pg.wait_for_timeout(1000)
            up = await pg.evaluate('window.__up'); task = await pg.evaluate('window.__upTask')
            fr = await pg.evaluate('window.__fr'); lt = await pg.evaluate('window.__lt')
            near = [(t-round(up), d) for t,d in fr if -60 < t-up < 200]
            print(mode, 'pointerup task ms', round(task,1), 'frames around release', near, 'longtasks', [(s-round(up),d) for s,d in lt if s-up>-50])
        await b.close()
asyncio.run(main())
