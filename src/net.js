import { Peer } from 'peerjs';

// Online rooms for up to four players, peer to peer.
// The host's browser is the hub: guests connect to the host, and the host relays
// everyone's kart positions to everyone else. A free public PeerJS server is only
// used to introduce players to each other; race traffic goes directly between browsers.

export const MAX_PLAYERS = 4;
export const KART_COLORS = ['#e8433f', '#3f7bff', '#46b85e', '#ffc531', '#c35cff', '#ff8a1f'];
const ID_PREFIX = 'kart-racer-v1-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PING_EVERY = 1000; // ms
const TIMEOUT = 6000; // ms without hearing from someone before we treat them as gone

// `?peer=localhost:9000` points at a local PeerServer, handy for testing.
function peerOptions() {
  const custom = new URLSearchParams(location.search).get('peer');
  if (!custom) return { debug: 0 };
  const [host, port] = custom.split(':');
  return { host, port: Number(port) || 9000, path: '/', secure: false, debug: 0 };
}

function makeCode() {
  let code = '';
  for (let i = 0; i < 5; i++) code += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  return code;
}

function openPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
    peer.once('open', () => resolve(peer));
    peer.once('error', (err) => reject(err));
  });
}

export class Room {
  constructor() {
    this.players = []; // { id, name, color, slot }
    this.handlers = {};
    this.conns = new Map(); // host only: peer id -> connection
    this.lastSeen = new Map(); // peer id -> time we last heard from them
    this.racing = false;
  }

  // Everyone pings every second, so a closed tab or dropped connection is noticed quickly.
  #startHeartbeat() {
    this.heartbeat = setInterval(() => {
      const now = Date.now();
      if (this.isHost) {
        this.#relay({ t: 'ping' });
        for (const id of [...this.conns.keys()]) {
          if (now - (this.lastSeen.get(id) || now) > TIMEOUT) {
            this.conns.get(id)?.close();
            this.#dropGuest(id);
          }
        }
      } else {
        if (this.hostConn?.open) this.hostConn.send({ t: 'ping' });
        if (now - (this.lastSeen.get('host') || now) > TIMEOUT) this.#emit('closed', 'Lost connection to the host.');
      }
    }, PING_EVERY);
  }

  on(event, fn) {
    this.handlers[event] = fn;
    return this;
  }

  #emit(event, ...args) {
    this.handlers[event]?.(...args);
  }

  get me() {
    return this.players.find((p) => p.id === this.myId);
  }

  // --- Hosting -------------------------------------------------------------------
  static async host(profile) {
    const room = new Room();
    room.isHost = true;
    // Retry a few times in the unlikely case the code is taken
    for (let attempt = 0; attempt < 4; attempt++) {
      room.code = makeCode();
      try {
        room.peer = await openPeer(ID_PREFIX + room.code);
        break;
      } catch (err) {
        if (err.type !== 'unavailable-id' || attempt === 3) throw err;
      }
    }
    room.myId = room.peer.id;
    room.players = [{ id: room.myId, ...profile, slot: 0 }];
    room.peer.on('connection', (conn) => room.#accept(conn));
    room.peer.on('disconnected', () => room.peer.reconnect());
    room.#startHeartbeat();
    return room;
  }

  #accept(conn) {
    conn.on('open', () => {
      if (this.racing) return this.#reject(conn, 'A race is already running. Try again when it finishes.');
      if (this.players.length >= MAX_PLAYERS) return this.#reject(conn, 'That room is full (4 players).');
      this.conns.set(conn.peer, conn);
      this.lastSeen.set(conn.peer, Date.now());
    });
    conn.on('data', (msg) => this.#hostReceive(conn, msg));
    conn.on('close', () => this.#dropGuest(conn.peer));
    conn.on('error', () => this.#dropGuest(conn.peer));
  }

  #reject(conn, reason) {
    conn.send({ t: 'reject', reason });
    setTimeout(() => conn.close(), 500);
  }

  #hostReceive(conn, msg) {
    if (!this.conns.has(conn.peer)) return;
    this.lastSeen.set(conn.peer, Date.now());
    switch (msg.t) {
      case 'bye':
        conn.close();
        this.#dropGuest(conn.peer);
        break;
      case 'hello': {
        if (this.players.some((p) => p.id === conn.peer)) return;
        const used = new Set(this.players.map((p) => p.slot));
        let slot = 0;
        while (used.has(slot)) slot++;
        // Give each player their own kart color if theirs is already taken
        const taken = new Set(this.players.map((p) => p.color));
        const color = taken.has(msg.color) ? KART_COLORS.find((c) => !taken.has(c)) || msg.color : msg.color;
        this.players.push({ id: conn.peer, name: clean(msg.name), color, slot });
        conn.send({ t: 'welcome', you: conn.peer, code: this.code });
        this.#broadcastLobby();
        break;
      }
      case 'profile': {
        const p = this.players.find((x) => x.id === conn.peer);
        if (p) Object.assign(p, { name: clean(msg.name), color: msg.color });
        this.#broadcastLobby();
        break;
      }
      case 'state':
        this.#relay({ t: 'state', id: conn.peer, s: msg.s }, conn.peer);
        this.#emit('state', conn.peer, msg.s);
        break;
      case 'finish':
        this.#relay({ t: 'finish', id: conn.peer, time: msg.time }, conn.peer);
        this.#emit('finish', conn.peer, msg.time);
        break;
      case 'ev': {
        const ev = { ...msg.ev, from: conn.peer };
        if (msg.to === 'host' || msg.to === this.myId) this.#emit('event', ev);
        else if (msg.to) this.conns.get(msg.to)?.send({ t: 'ev', ev });
        else {
          this.#relay({ t: 'ev', ev }, conn.peer);
          this.#emit('event', ev);
        }
        break;
      }
    }
  }

  #dropGuest(id) {
    if (!this.conns.has(id)) return;
    this.conns.delete(id);
    this.lastSeen.delete(id);
    const before = this.players.length;
    this.players = this.players.filter((p) => p.id !== id);
    if (this.players.length !== before) {
      this.#broadcastLobby();
      this.#emit('left', id);
    }
  }

  #broadcastLobby() {
    this.#relay({ t: 'lobby', players: this.players, racing: this.racing });
    this.#emit('players', this.players);
  }

  #relay(msg, except) {
    for (const [id, conn] of this.conns) if (id !== except && conn.open) conn.send(msg);
  }

  startRace() {
    if (!this.isHost) return;
    this.racing = true;
    this.#relay({ t: 'start', players: this.players });
    this.#emit('start', this.players);
  }

  endRace() {
    if (!this.isHost) return;
    this.racing = false;
    this.#broadcastLobby();
  }

  // --- Joining -------------------------------------------------------------------
  static async join(code, profile) {
    const room = new Room();
    room.isHost = false;
    room.code = code.toUpperCase();
    room.peer = await openPeer();
    room.myId = room.peer.id;
    await new Promise((resolve, reject) => {
      const conn = room.peer.connect(ID_PREFIX + room.code, { reliable: true });
      room.hostConn = conn;
      const timer = setTimeout(() => reject(new Error('Could not reach that room. Check the code and try again.')), 12000);
      room.peer.once('error', (err) => {
        clearTimeout(timer);
        reject(err.type === 'peer-unavailable' ? new Error(`No room called ${room.code} is open right now.`) : err);
      });
      conn.on('open', () => conn.send({ t: 'hello', ...profile }));
      conn.on('data', (msg) => {
        room.lastSeen.set('host', Date.now());
        if (msg.t === 'welcome') {
          clearTimeout(timer);
          resolve();
        } else if (msg.t === 'reject') {
          clearTimeout(timer);
          reject(new Error(msg.reason));
        }
        room.#guestReceive(msg);
      });
      conn.on('close', () => room.#emit('closed', 'The host left the room.'));
    });
    room.#startHeartbeat();
    return room;
  }

  #guestReceive(msg) {
    switch (msg.t) {
      case 'bye':
        this.#emit('closed', 'The host left the room.');
        break;
      case 'lobby':
        this.players = msg.players;
        this.racing = msg.racing;
        this.#emit('players', this.players);
        break;
      case 'start':
        this.players = msg.players;
        this.racing = true;
        this.#emit('start', this.players);
        break;
      case 'state':
        this.#emit('state', msg.id, msg.s);
        break;
      case 'finish':
        this.#emit('finish', msg.id, msg.time);
        break;
      case 'ev':
        this.#emit('event', msg.ev);
        break;
    }
  }

  // --- Both ----------------------------------------------------------------------
  updateProfile(profile) {
    const me = this.me;
    if (me) Object.assign(me, profile);
    if (this.isHost) this.#broadcastLobby();
    else this.hostConn?.send({ t: 'profile', ...profile });
  }

  sendState(s) {
    if (this.isHost) this.#relay({ t: 'state', id: this.myId, s });
    else if (this.hostConn?.open) this.hostConn.send({ t: 'state', s });
  }

  // Item events (boxes, rockets, hits). `to` sends to one player only; 'host' means the host.
  sendEvent(ev, to = null) {
    if (this.isHost) {
      const msg = { t: 'ev', ev: { ...ev, from: this.myId } };
      if (to === 'host' || to === this.myId) this.#emit('event', msg.ev);
      else if (to) this.conns.get(to)?.open && this.conns.get(to).send(msg);
      else this.#relay(msg);
    } else if (this.hostConn?.open) this.hostConn.send({ t: 'ev', ev, to });
  }

  sendFinish(time) {
    if (this.isHost) this.#relay({ t: 'finish', id: this.myId, time });
    else this.hostConn?.send({ t: 'finish', time });
  }

  leave() {
    this.handlers = {};
    clearInterval(this.heartbeat);
    // Say goodbye so the others don't have to wait for the timeout
    try {
      if (this.isHost) this.#relay({ t: 'bye' });
      else if (this.hostConn?.open) this.hostConn.send({ t: 'bye' });
    } catch {
      /* connection already gone */
    }
    const peer = this.peer;
    setTimeout(() => {
      try {
        peer?.destroy();
      } catch {
        /* already closed */
      }
    }, 300);
  }

  get link() {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('room', this.code);
    const peer = new URLSearchParams(location.search).get('peer');
    if (peer) url.searchParams.set('peer', peer);
    return url.toString();
  }
}

function clean(name) {
  return String(name || 'Racer').replace(/[<>&"]/g, '').trim().slice(0, 14) || 'Racer';
}

// Kart state packed into a small array for sending ~20 times a second.
export function packState(s) {
  const flags =
    (s.drifting ? 1 : 0) | (s.driftDir > 0 ? 2 : 0) | (s.boost > 0 ? 4 : 0) | (s.grounded ? 8 : 0) |
    (s.spin > 0 ? 16 : 0) | (s.shrink > 0 ? 32 : 0) | (s.shield > 0 ? 64 : 0) | (s.star > 0 ? 128 : 0) | (s.slip > 0 ? 256 : 0);
  return [
    +s.x.toFixed(2), +s.z.toFixed(2), +s.y.toFixed(2), +s.ground.toFixed(2),
    +s.heading.toFixed(3), +s.speed.toFixed(1), flags, +s.driftCharge.toFixed(2), s.lap, s.trackIndex,
    +s.offset.toFixed(2),
  ];
}

export function unpackState(a) {
  return {
    x: a[0], z: a[1], y: a[2], ground: a[3], heading: a[4], speed: a[5],
    drifting: !!(a[6] & 1), driftDir: a[6] & 1 ? (a[6] & 2 ? 1 : -1) : 0,
    boost: a[6] & 4 ? 1 : 0, grounded: !!(a[6] & 8), driftCharge: a[7], lap: a[8], trackIndex: a[9],
    spin: a[6] & 16 ? 1 : 0, shrink: a[6] & 32 ? 1 : 0, shield: a[6] & 64 ? 1 : 0, star: a[6] & 128 ? 1 : 0,
    slip: a[6] & 256 ? 1 : 0, offset: a[10] ?? 0,
  };
}
