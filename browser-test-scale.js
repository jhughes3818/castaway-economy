// End-to-end check at scale 3 (Years 9 to 12) in a real browser: the teacher picks the level on the
// landing page, two phones trade every round and buy projects, the game runs all 6 rounds, and the
// final scoreboard is checked against scale 3 points.   node browser-test-scale.js
// Uses Node Playwright (CHROME=/path/to/chrome to pick a browser binary).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const os = require('os'), path = require('path'), fs = require('fs');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'castaway-bt3-'));
const PORT = 3188, B = 'http://localhost:' + PORT, S = 3;
const PTS = { 'Fishing boat': 1, Well: 1, 'Sturdy hut': 3, Lighthouse: 5, Feast: 1 };
const srv = spawn('node', ['server.js'], { env: Object.assign({}, process.env, { PORT: String(PORT), DATA_FILE: path.join(OUT, 'games.json') }), stdio: 'ignore' });
const fail = (m) => { throw new Error(m); };

(async () => {
  await new Promise((r) => setTimeout(r, 800));
  const br = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME, args: ['--no-sandbox'] } : {});
  const errs = [];
  const host = await (await br.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  host.on('pageerror', (e) => errs.push('host:' + e));
  await host.goto(B + '/');
  await host.selectOption('#level', String(S));
  if (await host.inputValue('#tlen') !== '180' || await host.inputValue('#rounds') !== '6') fail('Year level did not pre-fill timer and rounds');
  await host.click('#create'); await host.waitForURL('**/host?c=*');
  const code = host.url().split('c=')[1];
  const levelTag = await host.innerText('.joinbar .level');
  console.log('code', code, '| level shown:', levelTag);
  if (!/Years 9 to 12/.test(levelTag) || !/3/.test(levelTag)) fail('level tag missing');

  const phone = async (idx) => {
    const p = await (await br.newContext({ viewport: { width: 390, height: 800 }, isMobile: true })).newPage();
    p.on('pageerror', (e) => errs.push('s' + idx + ':' + e));
    await p.goto(B + '/play?c=' + code); await p.waitForSelector('[data-island="' + idx + '"]'); await p.click('[data-island="' + idx + '"]');
    await p.waitForSelector('#s-top .name'); return p;
  };
  const s1 = await phone(0), s2 = await phone(5); // Fisher's Reef sells Food to Gold Coast for coins
  const state = () => host.evaluate((c) => fetch('/api/g/' + c + '/state?token=' + localStorage.getItem('castaway-host-' + c)).then((r) => r.json()), code);
  const step = async (label) => {
    await host.waitForFunction((l) => { const b = document.querySelector('button.big'); return b && b.textContent.includes(l); }, label);
    await host.waitForTimeout(600); await host.click('button.big');
  };
  const pts = Array(6).fill(0); let trades = 0, buys = 0;
  for (let round = 1; round <= 6; round++) {
    await step('Reveal the event');
    const ev = (await state()).event;
    if (/\{/.test(ev.text)) fail('unfilled event text: ' + ev.text);
    await step('Collect production'); await step('Open the market');
    await host.waitForSelector('#timer'); await host.click('button[data-t=start]');
    await s1.waitForSelector('#s-composer [data-act=to]');
    const v = await state();
    if (v.full[0].inv.food >= S && v.full[5].inv.coins >= 4) {
      await s1.click('[data-act=to][data-to="5"]');
      await s1.click('[data-act=q][data-s=give][data-r=food][data-d="' + S + '"]');          // tile tap adds 3
      await s1.click('.tside.get [data-act=q][data-r=coins].tb[data-d="1"]');                 // fine-grained price: 4 coins
      for (let i = 0; i < 3; i++) await s1.click('.tside.get [data-act=q][data-r=coins].tb[data-d="1"]');
      const sum = await s1.innerText('.tsum');
      if (!/3\s*🐟/.test(sum) || !/4\s*🪙/.test(sum)) fail('composer summary wrong: ' + sum);
      await s1.click('[data-act=send]');
      await s2.waitForSelector('.offer.incoming [data-a=accept]:not([disabled])'); await s2.click('.offer.incoming [data-a=accept]');
      await host.waitForFunction((n) => document.querySelectorAll('.deal-card').length >= n, 1);
      trades++;
    }
    await step('Close the market'); await step('Pay needs');
    await host.waitForFunction(() => /Next round|Finish the game/.test((document.querySelector('button.big') || {}).textContent || ''));
    const after = await state();
    after.full.forEach((f, k) => {
      const d = f.last.delta;
      if (Object.keys(f.last.short).length === 0 ? d !== 2 * S : d !== -2 * Object.values(f.last.short).reduce((a, b) => a + b, 0)) fail('settle delta wrong for ' + f.name + ': ' + d);
      pts[k] += d;
    });
    // phones buy whatever they can afford, best first
    for (const [p, k] of [[s1, 0], [s2, 5]]) {
      await p.waitForSelector('[data-act=buy], .proj .tag');
      for (let guard = 0; guard < 8; guard++) {
        const btn = await p.$('[data-act=buy]:not([disabled])'); if (!btn) break;
        const name = await btn.evaluate((b) => b.closest('.proj').querySelector('.t').textContent);
        const before = (await state()).full[k].pts;
        await btn.click();
        await host.waitForFunction(([c, k, b]) => fetch('/api/g/' + c + '/state?token=' + localStorage.getItem('castaway-host-' + c)).then((r) => r.json()).then((v) => v.full[k].pts !== b), [code, k, before]);
        const gain = (await state()).full[k].pts - before;
        const expect = PTS[name] * S * (name === 'Feast' && ev.id === 'festival' ? 2 : 1);
        if (gain !== expect) fail(name + ' gave ' + gain + ' pts, expected ' + expect);
        pts[k] += gain; buys++;
      }
    }
    await step(round < 6 ? 'Next round' : 'Finish the game');
  }
  await host.waitForSelector('.winner');
  const fin = await state();
  fin.scores.forEach((s) => {
    if (s.pts !== pts[s.idx]) fail(s.name + ' points ' + s.pts + ' but rounds and buys add to ' + pts[s.idx]);
    if (s.bonus !== Math.floor(s.coins / 4) || s.total !== s.pts + s.bonus) fail(s.name + ' total does not add up');
  });
  const rows = await host.$$eval('.panel table tr', (tr) => tr.slice(1).map((r) => [...r.cells].map((c) => c.innerText)));
  rows.forEach((r, i) => { const sc = fin.scores[i]; if (+r[1] !== sc.pts || +r[3] !== sc.total) fail('scoreboard row ' + i + ' does not match'); });
  const note = await host.innerText('.panel p.muted');
  console.log('trades:', trades, '| purchases:', buys);
  fin.scores.forEach((s) => console.log('  ' + s.name.padEnd(15) + ' pts ' + String(s.pts).padStart(4) + '  coins ' + String(s.coins).padStart(3) + ' -> +' + s.bonus + '  total ' + s.total));
  console.log('scoreboard note:', note);
  if (trades < 2) fail('fewer than 2 trades'); if (buys < 1) fail('no project bought');
  await host.screenshot({ path: path.join(OUT, 'host-final.png') });
  await s1.screenshot({ path: path.join(OUT, 'student-final.png') });
  console.log('screenshots in', OUT, '| errors:', errs);
  if (errs.length) fail('page errors');
  await br.close();
  console.log('browser test at scale 3 passed');
})().catch((e) => { console.error('FAIL', e.message); process.exitCode = 1; }).finally(() => srv.kill());
