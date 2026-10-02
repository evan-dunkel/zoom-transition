import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width':430,'height':900}, color_scheme='dark')
        errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type in ('error','warning') else None)
        await pg.goto('file:///mnt/user-data/outputs/book-store-zoom.html')
        await pg.wait_for_timeout(800)
        await pg.click('.book >> nth=0'); await pg.wait_for_timeout(1300)
        box = await pg.locator('.phone').bounding_box()
        cx, cy = box['x']+box['width']/2, box['y']+300
        # swipe to next
        await pg.mouse.move(cx, cy); await pg.mouse.down()
        for i in range(10):
            await pg.mouse.move(cx-25*i, cy); await pg.wait_for_timeout(16)
        await pg.mouse.up(); await pg.wait_for_timeout(900)
        await pg.keyboard.press('ArrowRight'); await pg.wait_for_timeout(900)
        print('active label', await pg.evaluate("document.querySelector('.zoom-card:not([inert])').getAttribute('aria-label')"))
        await pg.click('.slowmo', force=True) if False else None
        # drag dismiss, slow mo by setting speed? capture frames
        await pg.mouse.move(cx, cy); await pg.mouse.down()
        for i in range(14):
            await pg.mouse.move(cx+3*i, cy+18*i); await pg.wait_for_timeout(16)
        await pg.mouse.up()
        for k in range(4):
            await pg.wait_for_timeout(70)
            await pg.screenshot(path=f'n{k}.png')
        await pg.wait_for_timeout(1200)
        await pg.screenshot(path='n4.png')
        print('hidden', await pg.evaluate("document.querySelectorAll('[data-zoom-hidden]').length"),
              'open', await pg.evaluate("document.querySelector('.zoom-root').hasAttribute('data-open')"),
              'focus', await pg.evaluate("document.activeElement.getAttribute('aria-label')"),
              'clones', await pg.evaluate("document.querySelectorAll('.zoom-clone').length"))
        # escape path + reopen another row
        await pg.click('.book >> nth=7'); await pg.wait_for_timeout(1300)
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(1200)
        print('after esc open?', await pg.evaluate("document.querySelector('.zoom-root').hasAttribute('data-open')"), errs)
        # reduced motion
        ctx = await b.new_context(viewport={'width':430,'height':900}, reduced_motion='reduce')
        p2 = await ctx.new_page(); p2.on('pageerror', lambda e: errs.append(str(e)))
        await p2.goto('file:///mnt/user-data/outputs/book-store-zoom.html'); await p2.wait_for_timeout(800)
        await p2.click('.book >> nth=2'); await p2.wait_for_timeout(150); await p2.screenshot(path='r0.png')
        await p2.wait_for_timeout(900); await p2.keyboard.press('Escape'); await p2.wait_for_timeout(900)
        print('reduced ok', await p2.evaluate("document.querySelector('.zoom-root').hasAttribute('data-open')"), errs)
        await b.close()
asyncio.run(main())
