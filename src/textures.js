import * as THREE from 'three';

// All textures are painted at runtime on canvases, so the game ships with no image files.

function canvasTexture(size, paint, repeat = true) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  paint(canvas.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function speckle(ctx, size, count, colors, maxR = 2) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
    const r = Math.random() * maxR + 0.5;
    ctx.fillRect(Math.random() * size, Math.random() * size, r, r);
  }
}

// Three-step ramp that gives MeshToonMaterial its cel-shaded look.
export function toonGradient() {
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

// lines: false gives plain asphalt, used where a side road blends into the main road
export function asphaltTexture({ lines = true } = {}) {
  return canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = '#5b5d6b';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 9000, ['#525463', '#666879', '#6f7182', '#4c4e5c']);
    if (!lines) return;
    // Dashed centre line
    ctx.fillStyle = 'rgba(255, 248, 231, 0.85)';
    for (let y = 0; y < s; y += 128) ctx.fillRect(s / 2 - 5, y + 20, 10, 64);
    // Lane edge lines
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillRect(14, 0, 8, s);
    ctx.fillRect(s - 22, 0, 8, s);
  });
}

export function grassTexture() {
  return canvasTexture(512, (ctx, s) => {
    // Mowed stripes
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#5fbf4a' : '#6ccb53';
      ctx.fillRect(0, (i * s) / 8, s, s / 8);
    }
    speckle(ctx, s, 6000, ['#57b343', '#79d65e', '#4fa83d', '#86de6b'], 2.5);
  });
}

export function stoneTexture() {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#8f8a9e';
    ctx.fillRect(0, 0, s, s);
    const rows = 4;
    const h = s / rows;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? h : 0;
      for (let x = -h; x < s + h; x += h * 2) {
        const shade = 140 + Math.random() * 40;
        ctx.fillStyle = `rgb(${shade + 10}, ${shade + 6}, ${shade + 26})`;
        ctx.fillRect(x + off + 3, r * h + 3, h * 2 - 6, h - 6);
      }
    }
    speckle(ctx, s, 1500, ['#7d788c', '#a9a4b8']);
  });
}

export function checkerTexture() {
  const tex = canvasTexture(256, (ctx, s) => {
    const n = 8;
    const c = s / n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#1d1b3a' : '#ffffff';
        ctx.fillRect(x * c, y * c, c, c);
      }
  });
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

export function boostTexture() {
  return canvasTexture(256, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, '#ffb000');
    g.addColorStop(1, '#ff5a1f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#fff6c2';
    ctx.strokeStyle = '#1d1b3a';
    ctx.lineWidth = 8;
    for (let i = 0; i < 2; i++) {
      const y = i * (s / 2) + 18;
      ctx.beginPath();
      ctx.moveTo(s * 0.18, y + 90);
      ctx.lineTo(s / 2, y);
      ctx.lineTo(s * 0.82, y + 90);
      ctx.lineTo(s * 0.66, y + 90);
      ctx.lineTo(s / 2, y + 44);
      ctx.lineTo(s * 0.34, y + 90);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  });
}

export function skyTexture() {
  const tex = canvasTexture(512, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, '#3d8bff');
    g.addColorStop(0.55, '#8fd0ff');
    g.addColorStop(1, '#fff1d6');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }, false);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

export function flagTexture(color) {
  return canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#ffc531';
    ctx.beginPath();
    // A simple star emblem
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 18 : 40;
      ctx.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r);
    }
    ctx.fill();
  }, false);
}

// Packed dirt with tyre ruts, for shortcuts across the grass.
export function dirtTexture() {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#a77b4f';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 2600, ['#8c6440', '#b98c5c', '#9a7048', '#c49a68'], 3);
    ctx.fillStyle = 'rgba(80, 55, 30, 0.35)';
    for (const x of [0.28, 0.72]) ctx.fillRect(x * s - 10, 0, 20, s);
  });
}

// Yellow and navy chevrons for jump ramps.
export function rampTexture() {
  return canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#ffc531';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#1d1b3a';
    for (let k = -1; k < 3; k++) {
      ctx.beginPath();
      const y = k * (s / 2);
      ctx.moveTo(0, y + s * 0.5);
      ctx.lineTo(s / 2, y);
      ctx.lineTo(s, y + s * 0.5);
      ctx.lineTo(s, y + s * 0.75);
      ctx.lineTo(s / 2, y + s * 0.25);
      ctx.lineTo(0, y + s * 0.75);
      ctx.fill();
    }
  });
}
