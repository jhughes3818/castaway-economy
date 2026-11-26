# Castaway Economy: live version (prototype)

Students join on their own devices. No Google Forms, no sheet, no island codes.

## Run it
    node server.js          # needs Node 18 or newer, no npm install
    # open http://localhost:3000

If phones cannot connect, see "Phones cannot connect" below.

Teacher: open the site, press **Create a game**. A 4 letter code and QR code appear.
Students: open `/play`, type the code, pick an island.

For a real class, put it on a host students can reach (Render, Railway, Fly.io, a school
server). Set `PORT` if the host asks. Games are saved to `data/games.json` (set `DATA_FILE` to
move it); on hosts with a temporary disk a restart can lose a game in progress. Run a single
copy of the server: games live in memory, so two copies behind a load balancer will not see
each other's games. A public server holds at most 300 games at once (`MAX_GAMES`) and limits how
fast one address can create them.

## How a round works
1. Teacher reveals the event, collects production, opens the market.
2. Teams send offers (up to 2 goods each way, coins allowed). The other team presses **Accept**.
   Nothing moves until both agree, so there is nothing to steal.
3. The server timer locks the market at zero. Late offers cannot be sent or accepted.
4. Teacher pays needs. Teams buy projects with a button.

## Files
- `server.js`: the whole backend (HTTP + server-sent events). Teams only ever see their own goods.
- `logic.js`: GENERATED game rules. Rebuild with `python3 build-logic.py path/to/castaway-economy.html`
  after changing the classroom page (it is not in this repository; by default the script looks
  for `../castaway-economy.html`). Rules and balance stay in one place. If you only have this
  repository, edit `logic.js` directly and run the tests.
- `public/index.html`, `student.html`, `host.html`: the three screens.
- `test.js`: 62 checks (join, offers, locking, buying, a full game, restart, double-click guard). Run `node test.js`,
  or `SCALE=2 node test.js` to run them at another year level.
- `test-scale.js`: 99 checks that every scaled amount is base x S and points stay proportional. `npm test` runs everything.
- `sim.js`: bot-simulation balance harness. `node sim.js 3000` compares win share and needs met at scale 1, 2 and 3.
- `browser-test.py`: optional end-to-end check in a real browser (needs Python Playwright).
- `browser-test-scale.js`: a full 6-round game at scale 3 in a real browser (needs Node Playwright).

## Year level (scale)
The teacher picks a year level when creating a game. It sets a scale that is fixed for the whole game:
Years 4 to 6 = x1 (today's game), Years 7 to 8 = x2, Years 9 to 12 = x3. At scale S every amount is
multiplied by S: needs and tax, production (and the boat and well), project costs and points, start
coins, event amounts and the "all needs met" bonus. Two things stay the same on purpose: 2 points lost
per missing unit and 4 coins per point. Because teams hold S times the goods and coins, both already
give S times the points, so every source of points grows together. Halving events round down, so at
odd results scales differ very slightly. The level table is `YEAR_LEVELS` in `logic.js` (and `LEVELS`
in `public/index.html`). Balance has been validated at scale 1 only; see `sim.js`.

## Prototype limits
- 6 islands only (balance has only been tested for 6).
- One team per island (the teacher can release an island so another device can take it).
- With fewer than 6 teams, the empty islands still produce, pay needs and appear in the scores,
  but nobody can send them offers.
- The teacher controls live in the browser that created the game. Opening the teacher link on a
  different device or in a private window will not work.
- No accounts or passwords. Tokens live in the browser, so a student who clears site data must be released and rejoin.
- No practice round, hand entry, or event editor yet.
- Anyone with the 4 letter code can claim a free island; release it from the teacher screen if the wrong person joins.

## Phones cannot connect?
1. `localhost` only works on the computer running the server. On the phone use the
   "For phones" address the server prints when it starts (for example http://192.168.1.20:3000).
2. Open that same address on the teacher computer, so the QR code on the teacher screen points
   phones at the right place. (The teacher screen now fills this in automatically when opened via localhost.)
3. Allow Node through the firewall when Windows or macOS asks (private networks).
4. The phone must be on the same wifi, not a guest network. School networks often block devices
   from talking to each other ("client isolation"). If so, use a hosted version instead.
