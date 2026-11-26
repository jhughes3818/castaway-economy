# Castaway Economy: live version (prototype)

Students join on their own devices. No Google Forms, no sheet, no island codes.

## Run it
    node server.js          # needs Node 18 or newer, no npm install
    # open http://localhost:3000

If phones cannot connect, see "Phones cannot connect" below.

Teacher: open the site, press **Create a game**. A 4 letter code and QR code appear.
Students: open `/play`, type the code, pick an island.

For a real class, put it on a host students can reach (Render, Railway, Fly.io, a school
server). Set `PORT` if the host asks. Games are saved to `data/games.json`; on hosts with a
temporary disk a restart can lose a game in progress.

## How a round works
1. Teacher reveals the event, collects production, opens the market.
2. Teams send offers (up to 2 goods each way, coins allowed). The other team presses **Accept**.
   Nothing moves until both agree, so there is nothing to steal.
3. The server timer locks the market at zero. Late offers cannot be sent or accepted.
4. Teacher pays needs. Teams buy projects with a button.

## Files
- `server.js`: the whole backend (HTTP + server-sent events). Teams only ever see their own goods.
- `logic.js`: GENERATED game rules. Rebuild with `python3 build-logic.py` after changing the
  classroom page (`../castaway-economy.html`). Rules and balance stay in one place.
- `public/index.html`, `student.html`, `host.html`: the three screens.
- `test.js`: 53 checks (join, offers, locking, buying, a full game, restart). Run `node test.js`.

## Prototype limits
- 6 islands only (balance has only been tested for 6).
- One team per island (the teacher can release an island so another device can take it).
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
