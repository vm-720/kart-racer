// Sound: a synthesized engine hum and effect blips, plus the race soundtrack from public/music.

const SONGS = ['aware', 'more', 'lights', 'legacy', 'hold', 'falling', 'drank'];
const MUSIC_MAX = 0.9; // music volume at 100% on the slider

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.music = new window.Audio();
    this.setMusicVolume(0.7);
    this.music.addEventListener('ended', () => this.nextSong());
    // Shuffle once so each session plays the songs in a fresh order
    this.playlist = [...SONGS].sort(() => Math.random() - 0.5);
    this.songIndex = -1;
  }

  // Starts the next song in the playlist and returns its name.
  nextSong() {
    this.songIndex = (this.songIndex + 1) % this.playlist.length;
    const name = this.playlist[this.songIndex];
    this.music.src = `${import.meta.env.BASE_URL}music/${name}.mp3`;
    this.music.muted = this.muted;
    this.music.play().catch(() => {});
    return name;
  }

  // Browsers only allow audio after a click or key press, so call this from the start button.
  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    this.engine = this.ctx.createOscillator();
    this.engine.type = 'sawtooth';
    this.engine2 = this.ctx.createOscillator();
    this.engine2.type = 'square';
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 600;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOn = false;
    this.engine.connect(this.engineFilter);
    this.engine2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.engine.start();
    this.engine2.start();

    // Route the music through a gain node too. Some browsers (iPhone and iPad Safari)
    // ignore an audio element's volume, so the slider only works reliably this way.
    try {
      this.musicGain = this.ctx.createGain();
      this.ctx.createMediaElementSource(this.music).connect(this.musicGain).connect(this.ctx.destination);
      this.setMusicVolume(this.musicLevel);
    } catch {
      this.musicGain = null;
    }
  }

  // level runs from 0 (silent) to 1 (loudest)
  setMusicVolume(level) {
    this.musicLevel = Math.max(0, Math.min(1, level));
    // Ears hear loudness on a curve, so square the level: each step of the slider
    // then sounds like the same change, from silent at 0 to full at 100.
    const gain = this.musicLevel * this.musicLevel * MUSIC_MAX;
    if (this.musicGain) {
      this.music.volume = 1;
      this.musicGain.gain.value = gain;
    } else {
      this.music.volume = gain;
    }
  }

  // The engine hum only plays while you're driving, not in menus or the lobby.
  setEngineActive(on) {
    if (!this.ctx || this.engineOn === on) return;
    this.engineOn = on;
    this.engineGain.gain.setTargetAtTime(on ? 0.06 : 0, this.ctx.currentTime, 0.08);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    this.music.muted = this.muted;
    return this.muted;
  }

  setEngine(speed, boosting) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 55 + Math.abs(speed) * 4.2 + (boosting ? 40 : 0);
    this.engine.frequency.setTargetAtTime(f, t, 0.05);
    this.engine2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(400 + Math.abs(speed) * 30, t, 0.1);
  }

  #tone(freq, dur, { type = 'square', vol = 0.15, slide = 0, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  #noise(dur, { vol = 0.3, freq = 800, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    if (!this.noiseBuf) {
      this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(60, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  play(name) {
    switch (name) {
      case 'hop': return this.#tone(300, 0.12, { slide: 1.8, vol: 0.08 });
      case 'boost': return this.#tone(180, 0.5, { type: 'sawtooth', slide: 3, vol: 0.12 });
      case 'bump': return this.#tone(90, 0.15, { type: 'triangle', vol: 0.25 });
      case 'count': return this.#tone(440, 0.25, { vol: 0.15 });
      case 'go': return this.#tone(880, 0.6, { vol: 0.15 });
      case 'lap':
        this.#tone(660, 0.15, { vol: 0.12 });
        return this.#tone(990, 0.3, { vol: 0.12, delay: 0.15 });
      case 'finish':
        [523, 659, 784, 1047].forEach((f, i) => this.#tone(f, 0.35, { vol: 0.12, delay: i * 0.14 }));
        return;
      case 'box': return this.#tone(1200, 0.12, { type: 'triangle', vol: 0.12, slide: 1.5 });
      case 'roll': return this.#tone(700 + Math.random() * 500, 0.04, { type: 'triangle', vol: 0.05 });
      case 'got':
        this.#tone(784, 0.1, { type: 'triangle', vol: 0.12 });
        return this.#tone(1175, 0.2, { type: 'triangle', vol: 0.12, delay: 0.09 });
      case 'fire':
        this.#noise(0.35, { vol: 0.15, freq: 3000 });
        return this.#tone(220, 0.3, { type: 'sawtooth', slide: 2.5, vol: 0.06 });
      case 'drop': return this.#tone(260, 0.2, { type: 'sine', slide: 0.4, vol: 0.2 });
      case 'boom': return this.#noise(0.6, { vol: 0.45, freq: 1200 });
      case 'spin': return this.#tone(500, 0.8, { type: 'triangle', slide: 0.3, vol: 0.12 });
      case 'shield': return this.#tone(400, 0.4, { type: 'sine', slide: 2, vol: 0.15 });
      case 'pop': return this.#tone(900, 0.15, { type: 'sine', slide: 0.5, vol: 0.18 });
      case 'thunder':
        this.#noise(1.2, { vol: 0.5, freq: 2500 });
        return this.#tone(70, 0.8, { type: 'sawtooth', vol: 0.1 });
      case 'rush':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.#tone(f, 0.15, { type: 'triangle', vol: 0.08, delay: i * 0.06 }));
        return;
      case 'slip': return this.#noise(0.5, { vol: 0.12, freq: 4000 });
      case 'coin':
        this.#tone(988, 0.07, { type: 'square', vol: 0.06 });
        return this.#tone(1319, 0.18, { type: 'square', vol: 0.06, delay: 0.07 });
      case 'launch': return this.#tone(160, 0.35, { type: 'triangle', slide: 2.2, vol: 0.12 });
      case 'trick':
        [660, 880, 1100].forEach((f, i) => this.#tone(f, 0.1, { type: 'triangle', vol: 0.09, delay: i * 0.05 }));
        return;
    }
  }
}
