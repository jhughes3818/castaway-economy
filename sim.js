// Bot-simulation balance harness. Plays many 6-island games with simple trading bots on the real
// rules in logic.js and reports, per scale: which island wins how often, and the share of islands
// that meet all their needs each round.
//   node sim.js [games=3000] [rounds=6]
// The same seeds are used at every scale, so differences come from the scale alone.
const L = require('./logic.js');
const GAMES = +process.argv[2] || 3000, ROUNDS = +process.argv[3] || 6;

function seeded(n) { let x = (n * 2654435761) % 2147483647 || 1; return () => { x = (x * 16807) % 2147483647; return x / 2147483647; }; }
const ALL = L.RES.concat('coins');
const ORDER = ['lighthouse', 'hut', 'boat', 'well', 'feast'];

/** What an island still wants this round: its needs plus (optionally) the cost of one project goal. */
function wants(R, isl, needs, goal) {
  const w = {}; ALL.forEach((r) => { w[r] = needs[r] || 0; });
  if (goal) Object.keys(R.projects[goal].cost).forEach((r) => { w[r] += R.projects[goal].cost[r]; });
  return w;
}
function pickGoal(R, isl, rng) {
  const open = ORDER.filter((p) => !(R.projects[p].once && isl.built[p]));
  return open[Math.floor(rng() * Math.min(open.length, 3))];
}
/** One market: each bot, in random order, tries to cover each gap by buying from the island with the
 *  biggest spare pile, paying coins at a price per unit drawn from [1, 2], or bartering a spare good 1 for 1. */
function market(st, R, rng) {
  const needs = L.needsFor(L.curEvent(st), R.scale);
  const goals = st.islands.map((i) => pickGoal(R, i, rng));
  let trades = 0;
  for (let pass = 0; pass < 3; pass++) {
    const order = L.shuffle(st.islands.map((_, k) => k), rng);
    for (const b of order) {
      const B = st.islands[b], wB = wants(R, B, needs, pass ? goals[b] : null);
      for (const r of L.RES) {
        let gap = wB[r] - B.inv[r]; if (gap <= 0) continue;
        // seller: the island with the most to spare of r after its own needs and goal
        let s = -1, best = 0;
        st.islands.forEach((S, k) => { if (k === b) return; const spare = S.inv[r] - wants(R, S, needs, goals[k])[r]; if (spare > best) { best = spare; s = k; } });
        if (s < 0) continue;
        const A = st.islands[s], q = Math.min(gap, best);
        const price = Math.max(1, Math.round(q * (1 + rng())));
        const spareCoins = B.inv.coins - needs.coins;
        let err = null;
        if (spareCoins >= price) err = L.logTrade(st, b, s, [{ r: 'coins', q: price }], [{ r, q }]);
        else {
          // barter: give a good B has spare and A is short of (or just has least of)
          const wA = wants(R, A, needs, goals[s]);
          const opts = L.RES.filter((x) => x !== r && B.inv[x] - wB[x] >= q).sort((x, y) => (A.inv[x] - wA[x]) - (A.inv[y] - wA[y]));
          if (!opts.length) continue;
          err = L.logTrade(st, b, s, [{ r: opts[0], q }], [{ r, q }]);
        }
        if (!err) trades++;
      }
    }
  }
  return trades;
}
function buyAll(st, R) {
  st.islands.forEach((i) => {
    for (let guard = 0; guard < 20; guard++) {
      const p = ORDER.find((id) => L.canBuild(st, i, id) && !(id === 'feast' && i.inv.coins < 0));
      if (!p) break; L.build(st, i, p);
    }
  });
}
function play(seed, S) {
  const rng = seeded(seed), st = L.newState(6, ROUNDS, null, rng, S), R = L.rules(S);
  const metByRound = [];
  let trades = 0;
  while (!st.over) {
    L.revealEvent(st, rng); L.advance(st); L.advance(st);
    trades += market(st, R, rng);
    L.advance(st); L.settleNeeds(st);
    metByRound.push(st.islands.filter((i) => i.last.delta > 0).length / 6);
    buyAll(st, R);
    L.advance(st);
  }
  return { scores: L.finalScores(st), metByRound, trades };
}
function run(S) {
  const wins = {}, met = Array(ROUNDS).fill(0), totals = Array(6).fill(0);
  let trades = 0, spread = 0;
  L.ISLANDS.forEach((t) => { wins[t.name] = 0; });
  for (let g = 0; g < GAMES; g++) {
    const r = play(g + 1, S);
    const top = r.scores[0].total, winners = r.scores.filter((x) => x.total === top && x.coins === r.scores[0].coins);
    winners.forEach((w) => { wins[L.ISLANDS[w.idx].name] += 1 / winners.length; });
    r.scores.forEach((x) => { totals[x.idx] += x.total / S; });
    spread += (top - r.scores[5].total) / S;
    r.metByRound.forEach((m, k) => { met[k] += m; });
    trades += r.trades;
  }
  return { S, wins, met: met.map((m) => m / GAMES), avg: totals.map((x) => x / GAMES), spread: spread / GAMES, trades: trades / GAMES };
}
const pct = (x) => (100 * x).toFixed(1).padStart(5) + '%';
const res = [1, 2, 3].map(run);
console.log('Bot simulation: ' + GAMES + ' games x ' + ROUNDS + ' rounds per scale (same seeds). Points shown divided by S.\n');
console.log('Win share by island'.padEnd(22) + res.map((r) => ('scale ' + r.S).padStart(10)).join('') + '   avg pts/S at 1, 2, 3');
L.ISLANDS.forEach((t, k) => console.log(t.name.padEnd(22) + res.map((r) => pct(r.wins[t.name] / GAMES).padStart(10)).join('') + '   ' + res.map((r) => r.avg[k].toFixed(2)).join(', ')));
console.log('\nIslands meeting all needs, by round');
for (let k = 0; k < ROUNDS; k++) console.log(('round ' + (k + 1)).padEnd(22) + res.map((r) => pct(r.met[k]).padStart(10)).join(''));
console.log('all rounds'.padEnd(22) + res.map((r) => pct(r.met.reduce((a, b) => a + b, 0) / ROUNDS).padStart(10)).join(''));
console.log('\nGap 1st to 6th (pts/S)'.padEnd(23) + res.map((r) => r.spread.toFixed(2).padStart(10)).join(''));
console.log('Trades per game'.padEnd(22) + res.map((r) => r.trades.toFixed(1).padStart(10)).join(''));
