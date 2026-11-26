// Checks for the "Year level" scale: at scale S every amount is base x S, except the two that must
// not scale (2 points per missing unit, 4 coins per point). Run: node test-scale.js
process.env.DATA_FILE = '/tmp/castaway-test-scale-games.json';
try { require('fs').unlinkSync(process.env.DATA_FILE); } catch (e) {}
const L = require('./logic.js');
const { server, games } = require('./server.js');
let ok = 0;
const t = (n, c) => { if (!c) { console.log('FAIL', n); process.exitCode = 1; } else ok++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const times = (o, S) => { const r = {}; Object.keys(o).forEach((k) => { r[k] = o[k] * S; }); return r; };
const ev = (id) => L.EVENTS.find((e) => e.id === id);
function seeded(n) { let x = n; return () => { x = (x * 16807) % 2147483647; return x / 2147483647; }; }
const fixed = seeded(7); // deterministic rng
function stateAt(S) { return L.newState(6, 6, null, seeded(11), S); }
function allWhole(o) { if (typeof o !== 'number' && (!o || typeof o !== 'object')) return true; return typeof o === 'number' ? Number.isInteger(o) : Object.keys(o).every((k) => allWhole(o[k])); }

// scale 1 is exactly today's game
const R1 = L.rules(1);
t('scale 1 needs unchanged', same(R1.needs, L.BASE_NEEDS));
t('scale 1 start coins unchanged', R1.startCoins === L.START_COINS && stateAt(1).islands[0].inv.coins === 8);
t('scale 1 score unchanged', same(R1.score, L.SCORE));
t('scale 1 project blurbs unchanged', Object.keys(L.PROJECTS).every((id) => R1.projects[id].blurb === L.PROJECTS[id].blurb));
t('scale 1 event text unchanged', R1.events.pirates.text === "Pirates take 2 from each island's biggest pile of resources." && R1.events.aid.text === 'The island(s) in last place receive 2 Food and 1 Water.');
t('old saved game without scale reads as scale 1', L.scaleOf({}) === 1);
t('only 1, 2, 3 are scales', [1, 2, 3].every(L.isScale) && ![0, 4, 1.5, '2', null].some(L.isScale));
let threw = false; try { L.rules(4); } catch (e) { threw = true; } t('rules(4) refused', threw);

for (const S of [2, 3]) {
  const R = L.rules(S), base = L.rules(1), st = stateAt(S), b1 = stateAt(1);
  t(S + ': every scaled amount is whole', allWhole(R));
  t(S + ': needs x S', same(R.needs, times(L.BASE_NEEDS, S)) && same(L.needsFor(null, S), times(L.BASE_NEEDS, S)));
  t(S + ': cold snap extra Wood x S', L.needsFor(ev('cold'), S).wood === (L.BASE_NEEDS.wood + 1) * S);
  t(S + ': start coins x S', R.startCoins === 8 * S && st.islands.every((i) => i.inv.coins === 8 * S));
  t(S + ': scale stored in state', st.scale === S);
  t(S + ': production x S (incl. Gold Coast coins)', st.islands.every((i, k) => same(L.prodFor(st, i, null), times(L.prodFor(b1, b1.islands[k], null), S))) && L.prodFor(st, st.islands[5], null).coins === 5 * S);
  st.islands[0].built.boat = true; st.islands[1].built.well = true;
  t(S + ': boat and well extra x S', L.prodFor(st, st.islands[0], null).food === (5 + 2) * S && L.prodFor(st, st.islands[1], null).water === (5 + 2) * S);
  // halving / doubling stay multipliers, floored
  t(S + ': storm halves food, floored', st.islands.every((i) => L.prodFor(st, i, ev('storm')).food === Math.floor(L.prodFor(st, i, null).food * 0.5)));
  t(S + ': harvest doubles food', st.islands.every((i) => L.prodFor(st, i, ev('harvest')).food === L.prodFor(st, i, null).food * 2));
  t(S + ': project costs and points x S', Object.keys(L.PROJECTS).every((id) => same(R.projects[id].cost, times(L.PROJECTS[id].cost, S)) && R.projects[id].pts === L.PROJECTS[id].pts * S));
  t(S + ': project blurb uses scaled numbers', R.projects.boat.blurb === '+' + S + ' pts, then +' + 2 * S + ' Food every round');
  t(S + ': allMet x S', R.score.allMet === 2 * S);
  t(S + ': missing stays 2 per unit', R.score.missing === 2);
  t(S + ': coins per point stays 4', R.score.coinsPerPoint === 4);
  // event amounts
  const cards = { pirates: { take: 2 }, aid: { food: 2, water: 1 }, treasure: { coins: 4 }, shipwreck: { n: 2 }, cold: { wood: 1 } };
  t(S + ': event amounts x S', Object.keys(cards).every((id) => same(R.events[id].amt, times(cards[id], S))));
  t(S + ': event text uses scaled numbers', R.events.treasure.text === 'A ship runs aground. Every island finds ' + 4 * S + ' coins.' && R.events.cold.text.indexOf(' ' + S + ' extra Wood') > 0 && !/\{/.test(Object.values(R.events).map((e) => e.text).join('')));
  t(S + ': festival bonus x S', R.events.festival.feastBonus === S);
  { const s2 = stateAt(S); s2.deck[0] = 'treasure'; L.revealEvent(s2, fixed); t(S + ': treasure gives 4S coins', s2.islands.every((i) => i.inv.coins === 12 * S)); }
  { const s2 = stateAt(S); s2.deck[0] = 'pirates'; s2.islands.forEach((i) => { i.inv.food = 10 * S; }); L.revealEvent(s2, fixed); t(S + ': pirates take 2S', s2.islands.every((i) => i.inv.food === 8 * S)); }
  { const s2 = stateAt(S); s2.deck[0] = 'aid'; s2.islands[0].pts = 5; L.revealEvent(s2, fixed); t(S + ': aid gives 2S Food and S Water', s2.islands[1].inv.food === 2 * S && s2.islands[1].inv.water === S && s2.islands[0].inv.food === 0); }
  { const s2 = stateAt(S); s2.deck[0] = 'shipwreck'; L.revealEvent(s2, fixed); t(S + ': shipwreck gives 2S', s2.islands.every((i) => L.RES.reduce((a, r) => a + i.inv[r], 0) === 2 * S)); }

  // settling: same proportional position at scale 1 and S
  const pair = [stateAt(1), stateAt(S)];
  pair.forEach((p, j) => {
    const k = j ? S : 1; p.deck[0] = 'storm'; p.eventRevealed = true; p.phase = 3;
    p.islands[0].inv = { food: 2 * k, water: 1 * k, wood: 1 * k, stone: 1 * k, coins: 2 * k };   // all met
    p.islands[1].inv = { food: 1 * k, water: 1 * k, wood: 0, stone: 1 * k, coins: 2 * k };       // short 1 food + 1 wood (x k)
    p.islands[2].inv = { food: 0, water: 0, wood: 0, stone: 0, coins: 0 };                       // short everything
    L.settleNeeds(p);
  });
  t(S + ': all needs met earns S x points', pair[1].islands[0].pts === S * pair[0].islands[0].pts && pair[0].islands[0].pts === 2);
  t(S + ': proportional shortfall costs S x points', pair[1].islands[1].pts === S * pair[0].islands[1].pts && pair[0].islands[1].pts === -4);
  t(S + ': total shortfall costs S x points', pair[1].islands[2].pts === S * pair[0].islands[2].pts && pair[0].islands[2].pts === -14);
  t(S + ': settle leaves whole numbers', pair[1].islands.every((i) => allWhole(i.inv) && Number.isInteger(i.pts)));
  // building and final scores
  pair.forEach((p, j) => {
    const k = j ? S : 1; p.settled = true; p.deck[0] = 'festival';
    p.islands[3].inv = { food: 3 * k, water: 2 * k, wood: 5 * k, stone: 6 * k, coins: 9 * k };
    p.islands[3].pts = 0;
    L.build(p, p.islands[3], 'lighthouse'); L.build(p, p.islands[3], 'feast');
  });
  t(S + ': cannot build at scale-1 cost', (() => { const p = stateAt(S); p.phase = 3; p.settled = true; p.islands[0].inv = { food: 0, water: 0, wood: 3, stone: 1, coins: 0 }; return !L.canBuild(p, p.islands[0], 'boat'); })());
  t(S + ': project + festival feast points x S', pair[1].islands[3].pts === S * pair[0].islands[3].pts && pair[0].islands[3].pts === 5 + 1 + 1);
  const f1 = L.finalScores(pair[0]).find((x) => x.idx === 3), fS = L.finalScores(pair[1]).find((x) => x.idx === 3);
  t(S + ': coin bonus x S (8 coins left -> 2 pts at scale 1)', f1.bonus === 2 && fS.bonus === 2 * S && fS.total === S * f1.total);
}

// server: create, validation, views
(async () => {
  await new Promise((r) => server.listen(0, r)); const base = 'http://localhost:' + server.address().port;
  const post = (p, b, tok) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': tok || '' }, body: JSON.stringify(b || {}) }).then(async (r) => ({ status: r.status, j: await r.json() }));
  for (const bad of [0, 4, -1, 1.5, '2', 'x', true]) t('create rejects scale ' + JSON.stringify(bad), (await post('/api/create', { scale: bad })).status === 400);
  const d = await post('/api/create', {}); t('create without scale uses default 1', games[d.j.code].st.scale === L.DEFAULT_SCALE && L.DEFAULT_SCALE === 1);
  for (const S of [1, 2, 3]) {
    const c = await post('/api/create', { scale: S, rounds: 6 }), g = games[c.j.code];
    t(S + ': game stores scale', g.st.scale === S);
    const tok = (await post('/api/g/' + c.j.code + '/join', { island: 0 })).j.token;
    await post('/api/g/' + c.j.code + '/join', { island: 1 });
    const v = await fetch(base + '/api/g/' + c.j.code + '/state?token=' + tok).then((r) => r.json());
    const lvl = L.YEAR_LEVELS.find((y) => y.scale === S).label;
    t(S + ': view carries scale and level', v.scale === S && v.level === lvl && v.maxQty === 99 * S);
    t(S + ': view constants scaled', v.constants.allMet === 2 * S && v.constants.startCoins === 8 * S && v.constants.coinsPerPoint === 4 && v.constants.missing === 2 && v.constants.baseNeeds.food === 2 * S);
    t(S + ': view needs and projects scaled', v.needs.food === 2 * S && v.projects.find((p) => p.id === 'hut').pts === 3 * S && v.projects.find((p) => p.id === 'hut').cost.wood === 3 * S);
    t(S + ': view production scaled', v.me.prod.food === 5 * S);
    // a scaled offer above 99 is fine at scale 3, above 99 x S is not
    const T = (a, b) => post('/api/g/' + c.j.code + '/teacher/' + a, b, c.j.teacherToken);
    await T('reveal'); await T('advance'); await T('advance');
    g.st.islands[0].inv.coins = 99 * S + 1;
    t(S + ': offer of 99 x S allowed', (await post('/api/g/' + c.j.code + '/team/offer', { to: 1, give: [{ r: 'coins', q: 99 * S }], get: [{ r: 'food', q: 1 }] }, tok)).status === 200);
    t(S + ': offer above 99 x S refused', (await post('/api/g/' + c.j.code + '/team/offer', { to: 1, give: [{ r: 'coins', q: 99 * S + 1 }], get: [{ r: 'food', q: 1 }] }, tok)).status === 400);
    t(S + ': restart keeps the scale', (await T('restart')).status === 200 && games[c.j.code].st.scale === S && games[c.j.code].st.islands[0].inv.coins === 8 * S);
    t(S + ': cannot change scale mid-game', (await T('scale', { scale: 1 })).status === 404 && games[c.j.code].st.scale === S);
  }
  console.log(ok, 'scale checks passed'); server.close(); process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
