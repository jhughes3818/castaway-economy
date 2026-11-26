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
- `test.js`: 62 checks (join, offers, locking, buying, a full game, restart, double-click guard). Run `node test.js`.
- `browser-test.py`: optional end-to-end check in a real browser (needs Python Playwright).

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
