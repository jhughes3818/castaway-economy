# End-to-end smoke test: one teacher and two phones make a trade.
# Needs Python Playwright (pip install playwright && playwright install chromium).
# Set CHROME=/path/to/chrome to use an existing browser instead.
import asyncio, subprocess, tempfile, time, os
from playwright.async_api import async_playwright
OUT=tempfile.mkdtemp(prefix='castaway-bt-')
env=dict(os.environ,PORT='3187',DATA_FILE=os.path.join(OUT,'games.json'))
srv=subprocess.Popen(['node','server.js'],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
time.sleep(1)
B='http://localhost:3187'
async def main():
    async with async_playwright() as p:
        opts={'args':['--no-sandbox']}
        if os.environ.get('CHROME'): opts['executable_path']=os.environ['CHROME']
        br=await p.chromium.launch(**opts)
        ctx=await br.new_context(viewport={'width':1280,'height':800})
        host=await ctx.new_page(); errs=[]
        host.on('pageerror',lambda e:errs.append('host:'+str(e)))
        await host.goto(B+'/'); await host.click('#create'); await host.wait_for_url('**/host?c=*')
        code=host.url.split('c=')[1]; print('code',code)
        # separate storage per student: one browser context each
        mctx=await br.new_context(viewport={'width':390,'height':800}, is_mobile=True); s1=await mctx.new_page()
        mctx2=await br.new_context(viewport={'width':390,'height':800}, is_mobile=True); s2=await mctx2.new_page()
        for s,name in ((s1,'s1'),(s2,'s2')): s.on('pageerror',lambda e,name=name:errs.append(name+':'+str(e)))
        await s1.goto(B+'/play?c='+code); await s1.click('[data-island="0"]')
        await s2.goto(B+'/play?c='+code); await s2.wait_for_selector('[data-island="1"]'); await s2.click('[data-island="1"]')
        await s1.wait_for_selector('#s-top .name'); await s2.wait_for_selector('#s-top .name')
        print('student1 island:',await s1.inner_text('#s-top .name'))
        async def step(label):
            await host.wait_for_function("(l)=>{const b=document.querySelector('button.big');return b&&b.textContent.includes(l)}",arg=label)
            await host.wait_for_timeout(600)  # the teacher screen ignores a second click within half a second
            await host.click('button.big')
        await step('Reveal the event'); await step('Collect production'); await step('Open the market')
        await host.wait_for_selector('#timer')
        await host.click('button[data-t=start]')
        await s1.wait_for_selector('#s-composer [data-act=to]')
        # give s1 something to trade via the tap-to-add tiles
        await s1.click('[data-act=to][data-to="1"]')
        await s1.click('[data-act=q][data-s=give][data-r=food][data-d="1"]')
        await s1.click('[data-act=q][data-s=get][data-r=coins][data-d="1"]')
        await s1.click('[data-act=send]')
        await s2.wait_for_selector('.offer.incoming'); print('student2 got the offer')
        await s2.click('[data-act=resp][data-a=accept]')
        await host.wait_for_selector('.deal-card'); print('host board:',(await host.inner_text('.deal-card')).replace('\n',' | '))
        await host.screenshot(path=os.path.join(OUT,'host.png')); await s1.screenshot(path=os.path.join(OUT,'student1.png'))
        print('screenshots in',OUT)
        print('errors:',errs)
        if errs: raise SystemExit(1)
        await br.close()
try: asyncio.run(main())
finally: srv.terminate()
