import asyncio, os
DEMO = os.environ.get('ZOOM_DEMO_URL', 'http://localhost:8765/dist/')
SCAN = os.environ.get('ZOOM_SCAN_URL', 'http://localhost:8765/test/scan.html')
CHROMIUM = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') or None
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROMIUM)
        pg = await b.new_page(viewport={'width':1100,'height':760})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(SCAN); await pg.wait_for_timeout(500)
        await pg.click('[data-zoom-source="b"]'); 
        await pg.wait_for_timeout(110); await pg.screenshot(path='s_a.png')
        await pg.wait_for_timeout(1200); await pg.screenshot(path='s_b.png')
        print(pg.url[-20:], await pg.evaluate("document.querySelector('.zoom-card:not([inert]) h2')?.textContent"))
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(120); await pg.screenshot(path='s_c.png')
        await pg.wait_for_timeout(900)
        print(await pg.evaluate("document.querySelector('.zoom-root').hasAttribute('data-open')"), errs)
        await b.close()
asyncio.run(main())
