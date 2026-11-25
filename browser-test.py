import asyncio, json, subprocess, time, os, sys
from playwright.async_api import async_playwright
env=dict(os.environ,PORT='3187',DATA_FILE='/tmp/castaway-bt.json')
try: os.remove('/tmp/castaway-bt.json')
except: pass
srv=subprocess.Popen(['node','server.js'],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
time.sleep(1)
B='http://localhost:3187'
async def main():
    async with async_playwright() as p:
        br=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        ctx=await br.new_context(viewport={'width':1280,'height':800})
        host=await ctx.new_page(); errs=[]
        host.on('pageerror',lambda e:errs.append('host:'+str(e)))
        await host.goto(B+'/'); await host.click('#create'); await host.wait_for_url('**/host?c=*')
        code=host.url.split('c=')[1]; print('code',code)
        mctx=await br.new_context(viewport={'width':390,'height':800}, is_mobile=True)
        s1=await mctx.new_page(); s2=await mctx.new_page()
        # separate storage per student: use two contexts
        mctx2=await br.new_context(viewport={'width':390,'height':800}, is_mobile=True); s2=await mctx2.new_page()
        for s,name in ((s1,'s1'),(s2,'s2')): s.on('pageerror',lambda e,name=name:errs.append(name+':'+str(e)))
        await s1.goto(B+'/play?c='+code); await s1.click('[data-island="0"]')
        await s2.goto(B+'/play?c='+code); await s2.wait_for_selector('[data-island="1"]'); await s2.click('[data-island="1"]')
        await s1.wait_for_selector('#s-top .name'); await s2.wait_for_selector('#s-top .name')
        print('student1 island:',await s1.inner_text('#s-top .name'))
        await host.click('button.big')  # reveal
        await host.wait_for_selector('.ev'); await host.click('button.big')  # collect
        await host.wait_for_function("document.querySelector('button.big')&&document.querySelector('button.big').textContent.includes('Open the market')")
        await host.click('button.big')  # open market
        await host.wait_for_selector('#timer')
        await host.click('button[data-t=start]')
        await s1.wait_for_selector('#s-composer select[data-sel=to]'); 
        # give s1 something to trade via UI choices
        await s1.select_option('select[data-sel=to]','1')
        await s1.select_option('select[data-sel=r][data-s=give][data-i="0"]','food')
        await s1.select_option('select[data-sel=r][data-s=get][data-i="0"]','coins')
        await s1.click('[data-act=send]')
        await s2.wait_for_selector('.offer.incoming'); print('student2 got the offer')
        await s2.click('[data-act=resp][data-a=accept]')
        await host.wait_for_selector('.deal'); print('host board:',(await host.inner_text('.deal')).replace('\n',' | '))
        await host.screenshot(path='/tmp/host.png'); await s1.screenshot(path='/tmp/student1.png')
        print('errors:',errs)
        await br.close()
asyncio.run(main())
srv.terminate()
