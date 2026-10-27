# Kart Racer

A browser kart racer to play with friends. Original characters, items and tracks with that classic kart-racing feel.

## Play

The game lives at **https://vm-720.github.io/kart-racer/**.

**Racing friends:** click *Race friends*, then send the link (or the 5-letter room code) to up to 3 friends.
When everyone is in the lobby, the host clicks *Start race*. Connections are peer to peer: a free public
PeerJS server only introduces the players, then race data goes straight between browsers.

| Action | Keyboard | Controller |
| --- | --- | --- |
| Accelerate | W / ↑ | A or RT |
| Brake / reverse | S / ↓ | B or LT |
| Steer | A D / ← → | Left stick |
| Hop and drift | Space / Shift | LB / RB |
| Use item | E / F | X |
| Respawn | R | Y |
| Mute / next song | M / N | |
| Music volume | - / + | |

Hold drift while turning. Sparks go blue, then orange, then purple; let go for a mini-turbo.
Drive through the "?" boxes for an item; racers further back get stronger ones. Tuck in close behind
another kart for a moment to catch their slipstream and get a burst of speed.
Phones and tablets get on-screen buttons.

## Roadmap

1. **Drivable prototype** (done): one kart, drifting, boosts, the Castle Cloverleaf track, laps and timing.
2. **Online races for up to 4** (done): create a room, share the link, race.
3. **Characters, items and tracks** (in progress): item boxes, 10 items, drafting and a rear-view mirror are in.
   Next: ramps and tricks, coins, shortcuts and split paths, then the Space and Cave tracks and the driver cast.
4. **Polish and launch**: menus, character select, sound, hosting.

## Developing

```sh
npm install
npm run dev      # local server with hot reload
npm run build    # production build in dist/
```

To test online play without the public PeerJS server, run a local one
(`npx peerjs --port 9000`) and open the game with `?peer=localhost:9000`.

Code map:

- `src/physics.js` – kart movement, drifting, walls and lap counting (no rendering, so it can run on a server later)
- `src/track.js` – turns a centre line into a road, curbs, walls and boost pads
- `src/tracks/castle.js` – Castle Cloverleaf layout and scenery
- `src/kart.js` – the kart model, drift sparks, boost flames and item effects (shield, spin-outs)
- `src/items.js` – item boxes, item odds by race position, rockets, oil slicks and hit detection
- `src/net.js` – online rooms: hosting, joining, relaying kart positions
- `src/main.js` – game loop, camera, HUD, menus, lobby and race flow
- `public/music/` – race soundtrack
