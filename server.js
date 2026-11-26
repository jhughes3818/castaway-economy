'use strict';
/**
 * Castaway Economy: live classroom server (prototype)
 * Zero dependencies. Node 18+.  Run: node server.js   (PORT env var, default 3000)
 *
 * Teachers create a game and get a 4 letter code. Students open /play, enter the code
 * and pick an island. Everything (rules, balance) comes from logic.js, which is
 * generated from the single-file classroom page so the rules have one source of truth.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const L = require('./logic.js');

const PORT = +process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'games.json');
const PUBLIC = path.join(__dirname, 'public');
const RESK = L.RES.concat('coins');
const MAX_PENDING_OUT = 4;
const GAME_TTL_MS = 36 * 3600 * 1000;

const games = {};

/* ---------- helpers ---------- */
const now = () => Date.now();
const token = () => crypto.randomBytes(12).toString('hex');
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += A[crypto.randomInt(A.length)];
    if (!games[c]) return c;
  }
}
class HttpError extends Error { constructor(code, msg) { super(msg); this.status = code; } }
const bad = (msg, code) => { throw new HttpError(code || 400, msg); };

/* ---------- persistence ---------- */
let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      const out = {};
      Object.keys(games).forEach((c) => {
        const g = games[c];
        out[c] = { code: g.code, tt: g.tt, st: g.st, teams: g.teams, offers: g.offers, nextOffer: g.nextOffer, timer: { len: g.timer.len, left: timerLeft(g) }, created: g.created, touched: g.touched };
      });
      fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(out));
      fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
    } catch (e) { console.error('save failed', e.message); }
  }, 800);
}
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    Object.keys(raw).forEach((c) => {
      const r = raw[c];
      games[c] = { code: r.code, tt: r.tt, st: r.st, teams: r.teams || {}, offers: r.offers || [], nextOffer: r.nextOffer || 1,
        timer: { len: r.timer.len, left: r.timer.left, running: false, endsAt: null, tid: null }, clients: new Set(), created: r.created, touched: r.touched || r.created };
    });
    console.log('restored', Object.keys(games).length, 'game(s)');
  } catch (e) { /* first run */ }
}

/* ---------- timer ---------- */
function timerLeft(g) {
  const t = g.timer;
  return t.running ? Math.max(0, Math.ceil((t.endsAt - now()) / 1000)) : t.left;
}
function stopTimer(g) {
  const t = g.timer;
  if (t.running) t.left = timerLeft(g);
  t.running = false; t.endsAt = null;
  if (t.tid) { clearTimeout(t.tid); t.tid = null; }
}
function expireOffers(g) {
  g.offers.forEach((o) => { if (o.status === 'pending') o.status = 'expired'; });
}
function startTimer(g) {
  const t = g.timer;
  if (t.running || t.left <= 0) return;
  t.running = true; t.endsAt = now() + t.left * 1000;
  t.tid = setTimeout(() => {
    t.tid = null; t.running = false; t.left = 0; t.endsAt = null;
    if (g.st.phase === 2) { g.st.locked = true; expireOffers(g); }
    changed(g);
  }, t.left * 1000 + 60);
}
function resetTimer(g) { stopTimer(g); g.timer.left = g.timer.len; g.st.locked = false; }

/* ---------- game creation ---------- */
function createGame(opts) {
  opts = opts || {};
  const n = 6; // balance is only validated for 6 islands
  const rounds = Math.max(3, Math.min(8, +opts.rounds || 6));
  const len = Math.max(30, Math.min(900, +opts.timerLen || 240));
  const code = newCode();
  const g = { code, tt: token(), st: L.newState(n, rounds, null), teams: {}, offers: [], nextOffer: 1,
    timer: { len, left: len, running: false, endsAt: null, tid: null }, clients: new Set(), created: now(), touched: now() };
  games[code] = g;
  save();
  return g;
}

/* ---------- views ---------- */
function eventView(st) {
  if (!st.eventRevealed) return null;
  const ev = L.curEvent(st);
  return { id: ev.id, title: ev.title, text: ev.text, term: ev.term, ask: ev.ask, notes: st.eventNotes || [] };
}
function offerView(g, o) {
  const st = g.st;
  return { id: o.id, from: o.from, to: o.to, fromName: st.islands[o.from].name, toName: st.islands[o.to].name, give: o.give, get: o.get, status: o.status, note: o.note || '', round: o.round };
}
function boardView(g) {
  const st = g.st;
  return st.trades.filter((t) => t.round === st.round).slice(-12).reverse().map((t) => {
    const s = L.tradeSides(t);
    return { a: st.islands[t.a].name, b: st.islands[t.b].name, aColor: st.islands[t.a].color, bColor: st.islands[t.b].color, aItems: s.A, bItems: s.B };
  });
}
function common(g) {
  const st = g.st, ev = L.curEvent(st);
  return {
    code: g.code, serverNow: now(), phase: st.phase, round: st.round, rounds: st.rounds, over: st.over, settled: st.settled, locked: !!st.locked,
    event: st.over ? null : eventView(st),
    needs: st.over ? null : L.needsFor(st.eventRevealed ? ev : null),
    timer: { left: timerLeft(g), running: g.timer.running, endsAt: g.timer.endsAt, len: g.timer.len },
    islands: st.islands.map((i, k) => ({ idx: k, name: i.name, color: i.color, pts: i.pts, claimed: !!g.teams[k] })),
    board: boardView(g),
    scores: st.over ? L.finalScores(st) : null,
    constants: { coinsPerPoint: L.SCORE.coinsPerPoint, allMet: L.SCORE.allMet, missing: L.SCORE.missing, baseNeeds: L.BASE_NEEDS, startCoins: L.START_COINS }
  };
}
function projectsView(st, isl) {
  return Object.keys(L.PROJECTS).map((pid) => {
    const p = L.PROJECTS[pid];
    return { id: pid, name: p.name, cost: p.cost, pts: p.pts, blurb: p.blurb, once: !!p.once, owned: !!(p.once && isl.built[pid]), canBuy: L.canBuild(st, isl, pid) };
  });
}
function islandFull(st, k) {
  const isl = st.islands[k], ev = st.eventRevealed ? L.curEvent(st) : null;
  return { idx: k, name: isl.name, color: isl.color, inv: isl.inv, pts: isl.pts, built: isl.built, feasts: isl.feasts, last: isl.last, gained: isl.gained, prod: L.prodFor(st, isl, ev) };
}
function viewFor(g, role, idx) {
  const v = common(g), st = g.st;
  v.role = role;
  if (role === 'team') {
    v.me = islandFull(st, idx);
    v.projects = projectsView(st, st.islands[idx]);
    v.offers = g.offers.filter((o) => o.from === idx || o.to === idx).slice(-14).reverse().map((o) => offerView(g, o));
  } else if (role === 'teacher') {
    v.full = st.islands.map((_, k) => islandFull(st, k));
    v.pending = g.offers.filter((o) => o.status === 'pending').length;
    v.undoable = (() => { const t = st.trades[st.trades.length - 1]; return !!(t && t.round === st.round && st.phase === 2); })();
    v.buys = (st.buildLog || []).filter((b) => b.round === st.round).slice(-8).reverse().map((b) => ({ island: st.islands[b.i].name, project: L.PROJECTS[b.pid].name, color: st.islands[b.i].color }));
    v.joinPath = '/play?c=' + g.code;
  }
  return v;
}
function broadcast(g) {
  g.clients.forEach((c) => {
    try { c.res.write('data: ' + JSON.stringify(viewFor(g, c.role, c.idx)) + '\n\n'); } catch (e) { g.clients.delete(c); }
  });
}
function changed(g) { g.touched = now(); save(); broadcast(g); }

/* ---------- auth ---------- */
function auth(g, tok) {
  if (!tok) bad('Missing token', 401);
  if (tok === g.tt) return { role: 'teacher' };
  for (const k of Object.keys(g.teams)) if (g.teams[k] === tok) return { role: 'team', idx: +k };
  bad('Unknown token. Rejoin the game.', 401);
}

/* ---------- teacher actions ---------- */
function teacherAction(g, action, body) {
  const st = g.st;
  if (st.over && action !== 'release' && action !== 'restart') bad('The game is over.');
  switch (action) {
    case 'restart': {
      // Same code, same rounds and timer, teams stay joined, so phones move straight to round 1.
      // Allowed at any point, including mid-round.
      stopTimer(g);
      g.st = L.newState(st.islands.length, st.rounds, null);
      g.offers = [];
      g.timer.left = g.timer.len;
      break;
    }
    case 'reveal':
      if (st.phase !== 0) bad('The event is only revealed at the start of a round.');
      L.revealEvent(st); break;
    case 'advance': {
      const from = st.phase;
      if (from === 0 && !st.eventRevealed) bad('Reveal the event first.');
      if (from === 3 && !st.settled) bad('Pay needs first.');
      if (from === 2) { stopTimer(g); expireOffers(g); }
      if (!L.advance(st)) bad('Cannot advance yet.');
      if (st.phase === 2 && from === 1) resetTimer(g);
      if (st.phase === 0) { g.offers = g.offers.filter((o) => o.status === 'pending'); }
      break;
    }
    case 'settle':
      if (st.phase !== 3) bad('Settling happens in the last phase.');
      L.settleNeeds(st); break;
    case 'timer': {
      if (st.phase !== 2) bad('The timer is for the market.');
      const op = body.op, t = g.timer;
      if (op === 'start') { if (st.locked) { st.locked = false; t.left = Math.max(t.left, 30); } startTimer(g); }
      else if (op === 'pause') stopTimer(g);
      else if (op === 'reset') resetTimer(g);
      else if (op === 'add') {
        const s = Math.max(-300, Math.min(300, Math.round(+body.s || 0)));
        const was = t.running;
        stopTimer(g); t.left = Math.max(0, t.left + s);
        if (t.left > 0 && st.locked) st.locked = false;
        if (was) startTimer(g);
      } else bad('Unknown timer command.');
      break;
    }
    case 'undo':
      if (!L.undoTrade(st)) bad('Nothing to undo.'); break;
    case 'release': {
      const k = +body.idx;
      if (!(k >= 0 && k < st.islands.length)) bad('Unknown island.');
      delete g.teams[k]; break;
    }
    case 'timerlen': {
      const len = Math.max(30, Math.min(900, Math.round(+body.len || 240)));
      g.timer.len = len; if (!g.timer.running && st.phase !== 2) g.timer.left = len; break;
    }
    default: bad('Unknown action.', 404);
  }
}

/* ---------- team actions ---------- */
function cleanItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 2) return null;
  const out = [];
  for (const x of items) {
    if (!x || RESK.indexOf(x.r) < 0) return null;
    const q = Number(x.q);
    if (!Number.isInteger(q) || q < 1 || q > 99) return null;
    out.push({ r: x.r, q });
  }
  if (out.length === 2 && out[0].r === out[1].r) return null;
  return out;
}
function marketOpen(g) {
  const st = g.st;
  if (st.phase !== 2) bad('The market is not open.');
  if (st.locked) bad('Too late. The timer has run out.');
}
function teamAction(g, idx, action, body) {
  const st = g.st, me = st.islands[idx];
  if (st.over) bad('The game is over.');
  if (action === 'offer') {
    marketOpen(g);
    const to = Number(body.to);
    if (!Number.isInteger(to) || to < 0 || to >= st.islands.length || to === idx) bad('Pick another island.');
    const give = cleanItems(body.give), get = cleanItems(body.get);
    if (!give || !get) bad('Each side needs 1 or 2 different items, in whole numbers.');
    if (get.some((h) => give.some((x) => x.r === h.r))) bad('Both sides cannot give the same thing.');
    for (const x of give) if (me.inv[x.r] < x.q) bad('You only have ' + me.inv[x.r] + ' ' + L.LABEL[x.r] + '.');
    if (g.offers.filter((o) => o.from === idx && o.status === 'pending').length >= MAX_PENDING_OUT) bad('You already have ' + MAX_PENDING_OUT + ' offers waiting. Cancel one first.');
    g.offers.push({ id: g.nextOffer++, from: idx, to, give, get, status: 'pending', round: st.round, at: now() });
    if (g.offers.length > 300) g.offers = g.offers.filter((o, i) => o.status === 'pending' || i > g.offers.length - 150);
    return;
  }
  if (action === 'respond') {
    const o = g.offers.find((x) => x.id === Number(body.id));
    if (!o) bad('Offer not found.', 404);
    if (o.status !== 'pending') bad('That offer is no longer open.');
    const act = body.action;
    if (act === 'cancel') { if (o.from !== idx) bad('Not your offer.', 403); o.status = 'cancelled'; return; }
    if (o.to !== idx) bad('Not your offer to answer.', 403);
    if (act === 'decline') { o.status = 'declined'; return; }
    if (act === 'accept') {
      marketOpen(g);
      const err = L.logTrade(st, o.from, o.to, o.give, o.get);
      if (err) { o.status = 'failed'; o.note = err; changed(g); bad(err); }
      o.status = 'done';
      // goods may have moved: other pending offers from these islands may no longer be affordable; they are re-checked on accept
      return;
    }
    bad('Unknown response.');
  }
  if (action === 'buy') {
    if (st.phase !== 3 || !st.settled) bad('Buying opens after needs are paid.');
    const p = L.PROJECTS[body.project];
    if (!p) bad('Unknown project.');
    if (p.once && me.built[body.project]) bad('You already have the ' + p.name + '.');
    if (!L.canBuild(st, me, body.project)) bad('You cannot afford the ' + p.name + ' yet.');
    L.build(st, me, body.project);
    return;
  }
  bad('Unknown action.', 404);
}

function lanAddresses() {
  const out = [], ifs = os.networkInterfaces();
  Object.keys(ifs).forEach((n) => (ifs[n] || []).forEach((a) => { if (a.family === 'IPv4' && !a.internal) out.push(a.address); }));
  return out;
}

/* ---------- http ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.pdf': 'application/pdf' };
function send(res, code, body, headers) {
  const h = Object.assign({ 'Cache-Control': 'no-store' }, headers || {});
  if (typeof body === 'object' && !Buffer.isBuffer(body)) { h['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  res.writeHead(code, h); res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > 20000) { reject(new HttpError(413, 'Too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch (e) { reject(new HttpError(400, 'Bad JSON')); } });
    req.on('error', reject);
  });
}
function serveStatic(res, file) {
  const p = path.join(PUBLIC, file);
  if (!p.startsWith(PUBLIC) || !fs.existsSync(p)) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  send(res, 200, fs.readFileSync(p), { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (req.method === 'GET' && parts.length === 0) return serveStatic(res, 'index.html');
    if (req.method === 'GET' && parts[0] === 'play') return serveStatic(res, 'student.html');
    if (req.method === 'GET' && parts[0] === 'host') return serveStatic(res, 'host.html');
    if (req.method === 'GET' && parts[0] === 'qrcode.js') return serveStatic(res, 'qrcode.js');
    if (req.method === 'GET' && parts[0] === 'theme.css') return serveStatic(res, 'theme.css');
    if (req.method === 'GET' && parts[0] === 'teacher-guide.pdf') return serveStatic(res, 'teacher-guide.pdf');
    if (req.method === 'GET' && parts[0] === 'lan') return send(res, 200, { addresses: lanAddresses(), port: server.address() && server.address().port });
    if (req.method === 'GET' && parts[0] === 'health') return send(res, 200, { ok: true, games: Object.keys(games).length });

    if (parts[0] === 'api') {
      if (req.method === 'POST' && parts[1] === 'create') {
        const body = await readBody(req);
        const g = createGame(body);
        return send(res, 200, { code: g.code, teacherToken: g.tt });
      }
      if (parts[1] === 'g' && parts[2]) {
        const g = games[String(parts[2]).toUpperCase()];
        if (!g) bad('No game with that code.', 404);
        const sub = parts[3];

        if (req.method === 'GET' && sub === 'info') {
          return send(res, 200, { code: g.code, phase: g.st.phase, over: g.st.over, islands: g.st.islands.map((i, k) => ({ idx: k, name: i.name, color: i.color, claimed: !!g.teams[k] })) });
        }
        if (req.method === 'POST' && sub === 'join') {
          const body = await readBody(req), k = Number(body.island);
          if (!Number.isInteger(k) || k < 0 || k >= g.st.islands.length) bad('Pick an island.');
          if (g.teams[k]) bad('That island is already taken. Ask your teacher.', 409);
          g.teams[k] = token(); changed(g);
          return send(res, 200, { token: g.teams[k], idx: k });
        }
        if (req.method === 'GET' && sub === 'stream') {
          const who = auth(g, url.searchParams.get('token'));
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          const c = { res, role: who.role, idx: who.idx };
          g.clients.add(c);
          res.write('retry: 1500\n\ndata: ' + JSON.stringify(viewFor(g, c.role, c.idx)) + '\n\n');
          const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch (e) { /* closed */ } }, 20000);
          req.on('close', () => { clearInterval(hb); g.clients.delete(c); });
          return;
        }
        if (req.method === 'GET' && sub === 'state') {
          const who = auth(g, url.searchParams.get('token'));
          return send(res, 200, viewFor(g, who.role, who.idx));
        }
        if (req.method === 'POST' && (sub === 'teacher' || sub === 'team')) {
          const body = await readBody(req);
          const who = auth(g, req.headers['x-token'] || body.token);
          if (sub === 'teacher') { if (who.role !== 'teacher') bad('Teacher only.', 403); teacherAction(g, parts[4], body); }
          else { if (who.role !== 'team') bad('Teams only.', 403); teamAction(g, who.idx, parts[4], body); }
          changed(g);
          return send(res, 200, { ok: true });
        }
      }
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Server error' });
  }
});

load();
setInterval(() => {
  const cut = now() - GAME_TTL_MS;
  Object.keys(games).forEach((c) => { if (games[c].touched < cut && games[c].clients.size === 0) { stopTimer(games[c]); delete games[c]; save(); } });
}, 600000).unref();

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('Castaway Economy live server running.');
    console.log('  On this computer:  http://localhost:' + PORT);
    lanAddresses().forEach((a) => console.log('  For phones (same wifi): http://' + a + ':' + PORT));
    console.log('Open the "for phones" address on the teacher computer too, so the QR code works.');
  });
}
module.exports = { server, games, createGame };
