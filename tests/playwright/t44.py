import asyncio
from playwright.async_api import async_playwright
TRK = """() => { window.__s={}; const ids=['the-salt-orchard','night-shift-at-the-observatory','field-notes-on-leaving','glass-harbor'];
 const f=()=>{ ids.forEach(id => { const c=document.querySelector('.zoom-clone[data-zoom-id="'+id+'"]'); const h=document.querySelector('.zoom-card[data-zoom-id="'+id+'"] [data-zoom-hero]');
   let r=null, src=''; if (c) { r=c.getBoundingClientRect(); src='clone'; } else if (h && h.style.visibility!=='hidden') { r=h.getBoundingClientRect(); src='hero'; }
   if (r) (window.__s[id] = window.__s[id] || []).push([src, Math.round(r.left*10)/10, Math.round(r.top*10)/10]); });
   if ((window.__s['night-shift-at-the-observatory']||[]).length < 400) requestAnimationFrame(f) }; f(); }"""
def jumps(series):
    out={}
    for id, s in series.items():
        for a,b in zip(s, s[1:]):
            if a[0]=='clone' and b[0]=='hero':
                out[id.split('-')[0]] = (round(b[1]-a[1],1), round(b[2]-a[2],1))
    return out
ANG = """() => Object.fromEntries([...document.querySelectorAll('.zoom-card')].map(c => { const f=c.querySelector('.front'); const m=new DOMMatrix(getComputedStyle(f).transform); return [c.dataset.zoomId.split('-')[0]+(c.inert?'':'*'), Math.round(Math.abs(Math.atan2(m.m13,m.m11))*180/Math.PI)]; }))"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width':430,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8765/book-store-zoom.html'); await pg.wait_for_timeout(800)
        await pg.click('.book >> nth=1'); await pg.evaluate(TRK)
        await pg.wait_for_timeout(120); await pg.keyboard.press('ArrowRight')
        await pg.wait_for_timeout(1500)
        print('1) arrow 120 ms into opening: hand-over jumps (dx, dy):', jumps(await pg.evaluate('window.__s')))
        print('   phase', await pg.evaluate("document.querySelector('.zoom-root').dataset.phase"), 'hash', await pg.evaluate('location.hash'), 'angles', await pg.evaluate(ANG))
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(1200)
        await pg.click('.book >> nth=1'); await pg.evaluate(TRK)
        await pg.wait_for_timeout(80); await pg.keyboard.press('ArrowRight'); await pg.wait_for_timeout(60); await pg.keyboard.press('ArrowRight')
        await pg.wait_for_timeout(1500)
        print('2) two arrows during opening: jumps', jumps(await pg.evaluate('window.__s')), 'active', await pg.evaluate("document.querySelector('.zoom-card:not([inert])').dataset.zoomId"))
        # 3) reopen (cards mode) then arrow during it
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(70)
        box = await pg.locator('.zoom-clone[data-zoom-id="glass-harbor"]').bounding_box()
        await pg.evaluate(TRK)
        await pg.mouse.click(box['x']+box['width']/2, box['y']+box['height']/2); await pg.wait_for_timeout(60)
        await pg.keyboard.press('ArrowLeft'); await pg.wait_for_timeout(1500)
        print('3) arrow during a turned-around close: jumps', jumps(await pg.evaluate('window.__s')), 'active', await pg.evaluate("document.querySelector('.zoom-card:not([inert])').dataset.zoomId"))
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(1200)
        print('final', await pg.evaluate("({p: document.querySelector('.zoom-root').dataset.phase, clones: document.querySelectorAll('.zoom-clone').length, hidden: document.querySelectorAll('[data-zoom-hidden]').length, hash: location.hash})"), errs)
        await b.close()
asyncio.run(main())
