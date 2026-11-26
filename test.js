// SCALE=2 node test.js runs the same checks at another year level (default 1, today's game).
const S=+process.env.SCALE||1;
process.env.DATA_FILE='/tmp/castaway-test-games-'+S+'.json';
try{require('fs').unlinkSync(process.env.DATA_FILE);}catch(e){}
const assert=require('assert'); const http=require('http');
const {server,games,flush}=require('./server.js');
let ok=0; const t=(n,c)=>{ if(!c){console.log('FAIL',n); process.exitCode=1;} else ok++; };
let base;
async function call(method,path,body,tok){
  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json','x-token':tok||''},body:method==='POST'?JSON.stringify(body||{}):undefined});
  const j=await r.json().catch(()=>({})); return {status:r.status,j};
}
function sse(path){ // returns {last(), close()}
  return new Promise((resolve)=>{ let last=null,buf=''; const u=new URL(base+path);
    const req=http.get({hostname:u.hostname,port:u.port,path:u.pathname+u.search},(res)=>{ res.on('data',d=>{buf+=d; let i; while((i=buf.indexOf('\n\n'))>=0){ const ev=buf.slice(0,i); buf=buf.slice(i+2); const m=ev.match(/^data: (.*)$/m); if(m) last=JSON.parse(m[1]); } }); resolve({last:()=>last,close:()=>req.destroy()}); });
  });
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  await new Promise(r=>server.listen(0,r)); base='http://localhost:'+server.address().port;
  let r=await call('POST','/api/create',{rounds:4,timerLen:240,scale:S}); const code=r.j.code, TT=r.j.teacherToken; t('create',/^[A-Z]{4}$/.test(code));
  const info=(await call('GET','/api/g/'+code+'/info')).j; t('info 6 islands',info.islands.length===6);
  const tok=[]; for(let k=0;k<6;k++){ const j=(await call('POST','/api/g/'+code+'/join',{island:k})).j; tok.push(j.token); }
  t('join taken',(await call('POST','/api/g/'+code+'/join',{island:2})).status===409);
  const T=(a,b)=>call('POST','/api/g/'+code+'/teacher/'+a,b||{},TT);
  const P=(k,a,b)=>call('POST','/api/g/'+code+'/team/'+a,b||{},tok[k]);
  const stu=await sse('/api/g/'+code+'/stream?token='+tok[0]); const tea=await sse('/api/g/'+code+'/stream?token='+TT); await sleep(150);
  t('student view hides others',stu.last()&&stu.last().me&&!stu.last().full&&stu.last().role==='team');
  t('teacher view has all',tea.last()&&tea.last().full.length===6);
  t('students cannot run teacher actions',(await call('POST','/api/g/'+code+'/teacher/reveal',{},tok[0])).status===403);
  t('bad token',(await call('GET','/api/g/'+code+'/state?token=nope')).status===401);

  // phase 0
  t('cannot advance before reveal',(await T('advance')).status===400);
  t('reveal',(await T('reveal')).status===200);
  t('collect',(await T('advance')).status===200);
  t('open market',(await T('advance')).status===200);
  await sleep(100); t('SSE pushes phase 2',stu.last().phase===2);
  // inventories
  const inv=k=>games[code].st.islands[k].inv;
  // give island 0 plenty, island 1 plenty for a deterministic deal
  inv(0).food=6; inv(1).wood=6; inv(1).coins=10;
  r=await P(0,'offer',{to:1,give:[{r:'food',q:2}],get:[{r:'wood',q:2}]}); t('offer ok',r.status===200);
  r=await P(0,'offer',{to:0,give:[{r:'food',q:1}],get:[{r:'wood',q:1}]}); t('offer to self rejected',r.status===400);
  r=await P(0,'offer',{to:1,give:[{r:'food',q:99}],get:[{r:'wood',q:1}]}); t('offer more than owned rejected',r.status===400);
  r=await P(0,'offer',{to:1,give:[{r:'food',q:1}],get:[{r:'food',q:1}]}); t('same good both sides rejected',r.status===400);
  r=await P(0,'offer',{to:1,give:[{r:'food',q:1},{r:'water',q:1},{r:'wood',q:1}],get:[{r:'stone',q:1}]}); t('3 kinds rejected',r.status===400);
  r=await P(0,'offer',{to:1,give:[{r:'food',q:1.5}],get:[{r:'wood',q:1}]}); t('fraction rejected',r.status===400);
  await sleep(100);
  const o1=stu.last().offers[0]; t('student sees own offer',o1&&o1.status==='pending'&&o1.toName);
  r=await P(2,'respond',{id:o1.id,action:'accept'}); t('wrong team cannot accept',r.status===403);
  r=await P(0,'respond',{id:o1.id,action:'accept'}); t('sender cannot accept own',r.status===403);
  const f0=inv(0).food, w0=inv(0).wood, f1=inv(1).food, w1=inv(1).wood;
  r=await P(1,'respond',{id:o1.id,action:'accept'}); t('accept',r.status===200);
  t('goods moved',inv(0).food===f0-2&&inv(0).wood===w0+2&&inv(1).food===f1+2&&inv(1).wood===w1-2);
  r=await P(1,'respond',{id:o1.id,action:'accept'}); t('cannot accept twice',r.status===400);
  // bundle with coins
  r=await P(1,'offer',{to:0,give:[{r:'wood',q:1},{r:'coins',q:2}],get:[{r:'food',q:1}]}); t('bundle offer ok',r.status===200);
  const o2=(await call('GET','/api/g/'+code+'/state?token='+tok[1])).j.offers[0];
  r=await P(0,'respond',{id:o2.id,action:'decline'}); t('decline',r.status===200);
  r=await P(1,'offer',{to:0,give:[{r:'coins',q:1}],get:[{r:'food',q:1}]}); const o3=(await call('GET','/api/g/'+code+'/state?token='+tok[1])).j.offers[0];
  r=await P(1,'respond',{id:o3.id,action:'cancel'}); t('cancel',r.status===200);
  // pending limit
  for(let i=0;i<4;i++) await P(1,'offer',{to:3,give:[{r:'wood',q:1}],get:[{r:'stone',q:1}]});
  r=await P(1,'offer',{to:3,give:[{r:'wood',q:1}],get:[{r:'stone',q:1}]}); t('pending limit',r.status===400);
  // timer + lock
  t('start timer',(await T('timer',{op:'start'})).status===200);
  games[code].timer.left=2; // shrink for the test
  await T('timer',{op:'pause'}); games[code].timer.left=1; await T('timer',{op:'start'});
  await sleep(1400);
  t('locked after timer',games[code].st.locked===true&&stu.last().locked===true);
  r=await P(0,'offer',{to:1,give:[{r:'food',q:1}],get:[{r:'wood',q:1}]}); t('late offer rejected',r.status===400&&/too late/i.test(r.j.error));
  t('pending offers expired',games[code].offers.filter(o=>o.status==='pending').length===0);
  t('add time unlocks',(await T('timer',{op:'add',s:30})).status===200&&games[code].st.locked===false);
  inv(0).food=3;
  r=await P(0,'offer',{to:1,give:[{r:'food',q:1}],get:[{r:'wood',q:1}]}); t('offer after unlock ok',r.status===200);
  // undo
  t('undo last trade',(await T('undo')).status===200);
  t('undone offer marked for students',games[code].offers.find(o=>o.id===o1.id).status==='undone');
  // phase 3
  r=await P(0,'buy',{project:'well'}); t('buy before settle blocked',r.status===400);
  t('close market',(await T('advance')).status===200);
  t('offers expired on close',games[code].offers.filter(o=>o.status==='pending').length===0);
  t('settle',(await T('settle')).status===200);
  inv(0).stone=5*S; inv(0).wood=5*S;
  r=await P(0,'buy',{project:'well'}); t('buy ok',r.status===200&&games[code].st.islands[0].built.well);
  r=await P(0,'buy',{project:'well'}); t('buy twice blocked',r.status===400);
  inv(2).stone=0; inv(2).wood=0;
  r=await P(2,'buy',{project:'lighthouse'}); t('cannot afford',r.status===400&&/afford/.test(r.j.error));
  await sleep(100); t('teacher sees purchase',tea.last().buys.length===1);
  // play through to the end with random bot offers
  const rng=Math.random;
  while(!games[code].st.over){
    const st=games[code].st;
    if(st.phase===3&&!st.settled) await T('settle');
    else await T(st.phase===0&&!st.eventRevealed?'reveal':'advance');
    if(games[code].st.phase===2){
      for(let k=0;k<6;k++){ const to=(k+1+Math.floor(rng()*5))%6; const give=L=>['food','water','wood','stone'][Math.floor(rng()*4)];
        const a=give(),b=give(); if(a!==b) await P(k,'offer',{to,give:[{r:a,q:1}],get:[{r:b,q:1}]}); }
      for(const o of games[code].offers.filter(o=>o.status==='pending')) await P(o.to,'respond',{id:o.id,action:rng()<.6?'accept':'decline'});
    }
    if(games[code].st.phase===3&&games[code].st.settled){ for(let k=0;k<6;k++) for(const p of ['hut','well','boat','lighthouse','feast']) await P(k,'buy',{project:p}); }
  }
  await sleep(150); t('game over with scores',tea.last().over&&tea.last().scores.length===6&&stu.last().scores.length===6);
  t('post-game actions blocked',(await P(0,'offer',{to:1,give:[{r:'food',q:1}],get:[{r:'wood',q:1}]})).status===400);
  t('release works',(await T('release',{idx:3})).status===200&&!games[code].teams[3]);
  // persistence (flush writes straight away, as on shutdown)
  flush(); const saved=JSON.parse(require('fs').readFileSync(process.env.DATA_FILE,'utf8')); t('persisted',saved[code]&&saved[code].st.over===true);
  // play again
  t('students cannot restart',(await call('POST','/api/g/'+code+'/teacher/restart',{},tok[0])).status===403);
  t('restart',(await T('restart')).status===200);
  const ng=games[code].st; t('new game state',ng.scale===S&&!ng.over&&ng.round===1&&ng.phase===0&&ng.rounds===4&&ng.islands.every(i=>i.pts===0)&&games[code].offers.length===0);
  t('teams kept after restart',!!games[code].teams[0]&&(await P(0,'offer',{to:1,give:[{r:'food',q:1}],get:[{r:'wood',q:1}]})).status===400);
  await sleep(150); t('SSE pushes restart',stu.last().over===false&&stu.last().round===1&&!stu.last().scores);
  await T('reveal');
  t('restart mid-game',(await T('restart')).status===200&&games[code].st.round===1&&games[code].st.phase===0&&!games[code].st.eventRevealed);
  // second game: guards added after review
  r=await call('POST','/api/create',{rounds:3,timerLen:60,scale:S}); const c2=r.j.code, TT2=r.j.teacherToken;
  const lone=(await call('POST','/api/g/'+c2+'/join',{island:0})).j.token;
  const T2=(a,b)=>call('POST','/api/g/'+c2+'/teacher/'+a,b||{},TT2);
  const step=async()=>(await call('GET','/api/g/'+c2+'/state?token='+TT2)).j.step;
  let s0=await step(); t('reveal with current step',(await T2('reveal',{step:s0})).status===200);
  t('stale step rejected (double click)',(await T2('reveal',{step:s0})).status===409&&(await T2('advance',{step:s0})).status===409&&games[c2].st.phase===0);
  await T2('advance',{step:await step()}); await T2('advance',{step:await step()});
  t('market open in game 2',games[c2].st.phase===2);
  games[c2].st.islands[0].inv.food=3;
  r=await call('POST','/api/g/'+c2+'/team/offer',{to:1,give:[{r:'food',q:1}],get:[{r:'wood',q:1}]},lone);
  t('offer to island with no team rejected',r.status===400&&/No team/.test(r.j.error));
  await T2('timer',{op:'start'}); await T2('timer',{op:'add',s:-300});
  t('taking the timer to zero locks the market',games[c2].st.locked===true&&games[c2].timer.left===0&&!games[c2].timer.running);
  t('add time after zero reopens',(await T2('timer',{op:'add',s:30})).status===200&&games[c2].st.locked===false);
  const lan=await fetch(base+'/lan',{headers:{'x-forwarded-for':'203.0.113.9'}}).then(r=>r.json());
  t('lan addresses hidden from outside',Array.isArray(lan.addresses)&&lan.addresses.length===0);
  const html=await fetch(base+'/play'); t('nosniff header',html.headers.get('x-content-type-options')==='nosniff');
  console.log(ok,'checks passed at scale '+S); stu.close(); tea.close(); server.close(); process.exit(process.exitCode||0);
})().catch(e=>{console.error(e);process.exit(1);});
