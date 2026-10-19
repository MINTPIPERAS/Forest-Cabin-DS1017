import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ------------------------------------------------------------------ *
 * Deterministic random + value noise
 * ------------------------------------------------------------------ */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const fade = (t) => t * t * (3 - 2 * t);

export function valueNoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = fade(x - xi);
  const yf = fade(y - yi);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf;
}

export function fbm(x, y, octaves = 4, lacunarity = 2.03, gain = 0.5) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise(x * frequency, y * frequency) * amplitude;
    total += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return value / total;
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/* ------------------------------------------------------------------ *
 * Terrain height — shared by every scattered object
 * ------------------------------------------------------------------ */

export function groundHeight(x, z) {
  const broad = (fbm(x * 0.028 + 11.2, z * 0.028 - 4.7, 4) - 0.5) * 2.6;
  const small = (fbm(x * 0.11 + 2.0, z * 0.11 + 8.0, 3) - 0.5) * 0.34;
  const dist = Math.hypot(x, z + 1.5);
  const clearing = smoothstep(8.5, 28.0, dist);
  const farRise = smoothstep(24, 62, dist) * 1.8;
  return (broad + small) * (0.16 + clearing * 0.84) + farRise;
}

/* ------------------------------------------------------------------ *
 * Canvas textures
 * ------------------------------------------------------------------ */

export function canvasTexture(size, draw, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = options.width || size;
  canvas.height = options.height || size;
  const ctx = canvas.getContext('2d');
  draw(ctx, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = options.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.anisotropy = options.anisotropy ?? 8;
  if (options.repeat) texture.repeat.set(options.repeat[0], options.repeat[1]);
  texture.needsUpdate = true;
  return texture;
}

function grain(ctx, w, h, random, amount = 0.12, dark = false) {
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (random() - 0.5) * 255 * amount;
    data[i] = clamp(data[i] + n, 0, 255);
    data[i + 1] = clamp(data[i + 1] + n, 0, 255);
    data[i + 2] = clamp(data[i + 2] + n, 0, 255);
  }
  ctx.putImageData(image, 0, 0);
  if (dark) {
    ctx.fillStyle = 'rgba(0,0,0,0.025)';
    ctx.fillRect(0, 0, w, h);
  }
}

function cloneLinearTexture(texture) {
  const clone = texture.clone();
  clone.colorSpace = THREE.NoColorSpace;
  clone.needsUpdate = true;
  return clone;
}

export function makeWoodTexture(seed = 3, tone = 'log') {
  const random = mulberry32(seed);
  const palette =
    tone === 'dark'
      ? ['#3d2b20', '#4d3727', '#5c402c', '#33231a']
      : ['#69452f', '#7a5238', '#8b6042', '#5b3a27'];
  const texture = canvasTexture(
    512,
    (ctx, w, h) => {
      ctx.fillStyle = palette[0];
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 150; i++) {
        const x = random() * w;
        const width = 1 + random() * 7;
        ctx.strokeStyle = palette[Math.floor(random() * palette.length)];
        ctx.globalAlpha = 0.08 + random() * 0.3;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (let y = -10; y < h + 10; y += 8) {
          const wobble = Math.sin(y * 0.02 + i * 2.3) * 3 + Math.sin(y * 0.07 + i) * 1.2;
          if (y === -10) ctx.moveTo(x + wobble, y);
          else ctx.lineTo(x + wobble, y);
        }
        ctx.stroke();
      }
      for (let i = 0; i < 12; i++) {
        const x = random() * w;
        const y = random() * h;
        const radius = 5 + random() * 22;
        ctx.globalAlpha = 0.25;
        for (let r = radius; r > 1; r -= 2.5) {
          ctx.strokeStyle = r % 2 > 1 ? '#2b1a12' : '#9b6a48';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.ellipse(x, y, r * 0.65, r, 0.15, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      grain(ctx, w, h, random, 0.09);
    },
    { repeat: [1, 1] }
  );
  return texture;
}

export function makePlankTexture(seed = 7, warm = true) {
  const random = mulberry32(seed);
  const texture = canvasTexture(
    512,
    (ctx, w, h) => {
      ctx.fillStyle = warm ? '#6d4930' : '#4d3828';
      ctx.fillRect(0, 0, w, h);
      const plankHeight = 64;
      for (let row = 0; row < h / plankHeight; row++) {
        const offset = (row % 2) * 90;
        for (let x = -offset; x < w; x += 180) {
          const shade = 0.82 + random() * 0.3;
          const r = Math.floor((warm ? 111 : 80) * shade);
          const g = Math.floor((warm ? 73 : 56) * shade);
          const b = Math.floor((warm ? 46 : 38) * shade);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(x + 2, row * plankHeight + 2, 176, plankHeight - 4);
          ctx.globalAlpha = 0.25;
          for (let i = 0; i < 10; i++) {
            ctx.strokeStyle = i % 3 === 0 ? '#2e2117' : '#c09068';
            ctx.lineWidth = 0.8 + random();
            ctx.beginPath();
            const yy = row * plankHeight + 7 + random() * (plankHeight - 14);
            for (let xx = x + 4; xx < x + 176; xx += 9) {
              const wy = yy + Math.sin(xx * 0.045 + i) * 2.2;
              if (xx === x + 4) ctx.moveTo(xx, wy);
              else ctx.lineTo(xx, wy);
            }
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = 'rgba(20,12,8,0.55)';
        ctx.fillRect(0, row * plankHeight, w, 2);
      }
      grain(ctx, w, h, random, 0.08);
    },
    { repeat: [1, 1] }
  );
  return texture;
}

export function makeStoneTexture(seed = 21) {
  const random = mulberry32(seed);
  const texture = canvasTexture(512, (ctx, w, h) => {
    ctx.fillStyle = '#3e3d36';
    ctx.fillRect(0, 0, w, h);
    let y = -12;
    while (y < h + 20) {
      const rowH = 38 + random() * 36;
      let x = -20 - random() * 45;
      while (x < w + 30) {
        const sw = 46 + random() * 90;
        const inset = 4 + random() * 4;
        const shade = 0.65 + random() * 0.5;
        const hue = 38 + random() * 18;
        ctx.fillStyle = `hsl(${hue} ${8 + random() * 8}% ${26 * shade + 10}%)`;
        ctx.beginPath();
        const points = 7;
        for (let p = 0; p <= points; p++) {
          const a = (p / points) * Math.PI * 2;
          const rr = 0.72 + random() * 0.2;
          const px = x + sw * 0.5 + Math.cos(a) * sw * 0.5 * rr;
          const py = y + rowH * 0.5 + Math.sin(a) * rowH * 0.48 * rr;
          if (p === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(18,17,14,.55)';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.globalAlpha = 0.22;
        ctx.strokeStyle = '#d1cbb7';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.globalAlpha = 1;
        x += sw + 2 + random() * 8;
      }
      y += rowH + 3;
    }
    for (let i = 0; i < 120; i++) {
      ctx.globalAlpha = 0.05 + random() * 0.1;
      ctx.fillStyle = random() > 0.45 ? '#58643d' : '#b3aa8f';
      ctx.beginPath();
      ctx.arc(random() * w, random() * h, 2 + random() * 14, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    grain(ctx, w, h, random, 0.12);
  });
  return texture;
}

export function makeRoofTexture(seed = 33) {
  const random = mulberry32(seed);
  return canvasTexture(512, (ctx, w, h) => {
    ctx.fillStyle = '#26272a';
    ctx.fillRect(0, 0, w, h);
    const rowH = 34;
    for (let row = 0; row < h / rowH + 1; row++) {
      const offset = (row % 2) * 34;
      for (let x = -offset; x < w; x += 68) {
        const l = 12 + random() * 15;
        ctx.fillStyle = `rgb(${l + 5},${l + 7},${l + 9})`;
        ctx.beginPath();
        ctx.moveTo(x + 1, row * rowH);
        ctx.lineTo(x + 65, row * rowH);
        ctx.lineTo(x + 61, row * rowH + rowH - 2);
        ctx.lineTo(x + 6, row * rowH + rowH - 2);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(6,8,9,.6)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = random() > 0.5 ? '#a6b5ae' : '#a0784a';
        ctx.fillRect(x + 4, row * rowH + 2, 58, 3);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = 'rgba(8,10,11,.55)';
      ctx.fillRect(0, row * rowH + rowH - 3, w, 4);
    }
    for (let i = 0; i < 22; i++) {
      ctx.globalAlpha = 0.06 + random() * 0.12;
      ctx.fillStyle = '#667a48';
      ctx.beginPath();
      ctx.ellipse(random() * w, random() * h, 8 + random() * 28, 3 + random() * 7, random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    grain(ctx, w, h, random, 0.13);
  });
}

export function makeGroundTexture(seed = 61) {
  const random = mulberry32(seed);
  return canvasTexture(
    512,
    (ctx, w, h) => {
      ctx.fillStyle = '#3d412d';
      ctx.fillRect(0, 0, w, h);
      const colors = ['#41462e', '#4b4c33', '#353b28', '#55513a', '#3b4633', '#4c4431', '#625638'];
      for (let i = 0; i < 2400; i++) {
        ctx.fillStyle = colors[Math.floor(random() * colors.length)];
        ctx.globalAlpha = 0.15 + random() * 0.55;
        const radius = 1 + random() * 9;
        ctx.beginPath();
        ctx.ellipse(random() * w, random() * h, radius, radius * (0.35 + random()), random() * 3.14, 0, 6.3);
        ctx.fill();
      }
      ctx.globalAlpha = 0.55;
      for (let i = 0; i < 160; i++) {
        ctx.strokeStyle = random() > 0.35 ? '#2c2a1d' : '#756143';
        ctx.lineWidth = 0.7 + random() * 1.4;
        const x = random() * w;
        const y = random() * h;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (random() - 0.5) * 30, y + (random() - 0.5) * 15);
        ctx.stroke();
      }
      for (let i = 0; i < 70; i++) {
        ctx.fillStyle = random() > 0.4 ? '#73573a' : '#867349';
        ctx.globalAlpha = 0.3 + random() * 0.4;
        ctx.beginPath();
        ctx.ellipse(random() * w, random() * h, 2 + random() * 4, 1 + random() * 2, random() * 3, 0, 6.3);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      grain(ctx, w, h, random, 0.16);
    },
    { repeat: [11, 11] }
  );
}

export function makePathTexture(seed = 91) {
  const random = mulberry32(seed);
  return canvasTexture(
    512,
    (ctx, w, h) => {
      ctx.fillStyle = '#584d3b';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 1500; i++) {
        const g = 55 + random() * 45;
        ctx.fillStyle = `rgba(${g + 15},${g + 6},${g - 8},${0.15 + random() * 0.5})`;
        const r = 0.7 + random() * 5;
        ctx.beginPath();
        ctx.ellipse(random() * w, random() * h, r, r * 0.65, random() * 3, 0, 6.3);
        ctx.fill();
      }
      for (let i = 0; i < 130; i++) {
        const g = 90 + random() * 80;
        ctx.fillStyle = `rgba(${g},${g - 4},${g - 15},${0.35 + random() * 0.45})`;
        const r = 2 + random() * 6;
        ctx.beginPath();
        ctx.ellipse(random() * w, random() * h, r, r * 0.7, random() * 3, 0, 6.3);
        ctx.fill();
      }
      grain(ctx, w, h, random, 0.14);
    },
    { repeat: [2.2, 8] }
  );
}

export function makeWindowTexture() {
  return canvasTexture(256, (ctx, w, h) => {
    const glow = ctx.createRadialGradient(w * 0.52, h * 0.58, 3, w * 0.5, h * 0.55, w * 0.7);
    glow.addColorStop(0, '#ffe0a3');
    glow.addColorStop(0.22, '#ffc471');
    glow.addColorStop(0.62, '#b46d38');
    glow.addColorStop(1, '#39261c');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // Curtains at each edge.
    ctx.fillStyle = 'rgba(63,39,28,.72)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w * 0.21, 0);
    ctx.bezierCurveTo(w * 0.14, h * 0.3, w * 0.24, h * 0.55, w * 0.15, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(54,33,24,.62)';
    ctx.beginPath();
    ctx.moveTo(w, 0);
    ctx.lineTo(w * 0.8, 0);
    ctx.bezierCurveTo(w * 0.87, h * 0.32, w * 0.76, h * 0.58, w * 0.86, h);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    // A table, lamp and a branch in silhouette.
    ctx.fillStyle = 'rgba(44,25,17,.55)';
    ctx.fillRect(w * 0.25, h * 0.76, w * 0.5, h * 0.035);
    ctx.fillRect(w * 0.29, h * 0.79, w * 0.025, h * 0.18);
    ctx.fillRect(w * 0.68, h * 0.79, w * 0.025, h * 0.18);
    ctx.fillStyle = 'rgba(58,32,18,.65)';
    ctx.beginPath();
    ctx.moveTo(w * 0.47, h * 0.76);
    ctx.lineTo(w * 0.53, h * 0.76);
    ctx.lineTo(w * 0.59, h * 0.61);
    ctx.lineTo(w * 0.41, h * 0.61);
    ctx.closePath();
    ctx.fill();
    const lamp = ctx.createRadialGradient(w * 0.5, h * 0.6, 1, w * 0.5, h * 0.6, 28);
    lamp.addColorStop(0, 'rgba(255,240,186,.95)');
    lamp.addColorStop(1, 'rgba(255,201,111,0)');
    ctx.fillStyle = lamp;
    ctx.fillRect(w * 0.3, h * 0.4, w * 0.4, h * 0.4);

    ctx.strokeStyle = 'rgba(42,26,19,.7)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(w * 0.74, h * 0.52);
    ctx.bezierCurveTo(w * 0.67, h * 0.4, w * 0.77, h * 0.24, w * 0.7, h * 0.08);
    ctx.stroke();
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.ellipse(w * (0.7 + (i % 2) * 0.04), h * (0.14 + i * 0.055), 9, 4, i, 0, 6.3);
      ctx.fillStyle = 'rgba(38,48,28,.6)';
      ctx.fill();
    }
  });
}

export function makePineBoughTexture(seed = 17) {
  const random = mulberry32(seed);
  const texture = canvasTexture(
    512,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const centerY = h * 0.5;
      const branchStart = w * 0.025;
      const branchEnd = w * 0.985;
      const twigPath = (x) => centerY + Math.sin((x / w) * Math.PI * 1.4) * h * 0.017 + (x / w) * h * 0.02;

      const drawNeedle = (x1, y1, x2, y2, width, color, alpha) => {
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      };

      // Layered needle sprays, darkest at the bottom of the card.
      const layers = [
        { color: '#314638', width: 2.4, length: 1.25, alpha: 0.9, count: 20 },
        { color: '#5f7861', width: 1.7, length: 1.0, alpha: 0.94, count: 22 },
        { color: '#93a98c', width: 1.05, length: 0.72, alpha: 0.82, count: 18 },
      ];

      for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
        const layer = layers[layerIndex];
        for (let cluster = 0; cluster < layer.count; cluster++) {
          const t = 0.06 + (cluster / (layer.count - 1)) * 0.88;
          const x = branchStart + (branchEnd - branchStart) * t;
          const y = twigPath(x);
          const side = cluster % 2 === 0 ? 1 : -1;
          const twigAngle = (side * (0.5 + random() * 0.48)) + (random() - 0.5) * 0.25;
          const twigLength = (h * 0.22 + h * 0.22 * (1 - t)) * layer.length;
          const tipX = x + Math.cos(twigAngle) * twigLength * 0.6;
          const tipY = y + Math.sin(twigAngle) * twigLength;

          if (layerIndex === 0) {
            ctx.strokeStyle = 'rgba(56,55,40,.72)';
            ctx.globalAlpha = 0.7;
            ctx.lineWidth = 1.9;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(tipX, tipY);
            ctx.stroke();
          }

          const needleCount = layerIndex === 0 ? 13 : layerIndex === 1 ? 11 : 8;
          for (let n = 0; n < needleCount; n++) {
            const nt = 0.1 + (n / needleCount) * 0.9;
            const bx = x + (tipX - x) * nt;
            const by = y + (tipY - y) * nt;
            const fan = (random() - 0.5) * 1.45 + (n / needleCount) * 0.2;
            const needleAngle = twigAngle + fan + (random() > 0.5 ? 0.1 : -0.1);
            const needleLength =
              (h * (0.065 + random() * 0.075)) *
              (1 - t * 0.35) *
              layer.length *
              (0.65 + random() * 0.55);
            drawNeedle(
              bx,
              by,
              bx + Math.cos(needleAngle) * needleLength,
              by + Math.sin(needleAngle) * needleLength * 0.9,
              layer.width * (0.7 + random() * 0.55),
              layer.color,
              layer.alpha * (0.6 + random() * 0.4)
            );
          }
        }
      }

      // Main twig, on top of its own needles.
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = '#4a4433';
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      for (let x = branchStart; x <= branchEnd; x += 4) {
        const y = twigPath(x);
        if (x === branchStart) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = '#88775a';
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      for (let x = branchStart; x <= branchEnd; x += 4) {
        const y = twigPath(x) - 1.2;
        if (x === branchStart) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // A few tiny highlights catch the last light.
      ctx.globalAlpha = 0.3;
      for (let i = 0; i < 32; i++) {
        const x = branchStart + random() * (branchEnd - branchStart);
        const y = twigPath(x) + (random() - 0.5) * h * 0.26;
        ctx.fillStyle = '#d2c9a8';
        ctx.beginPath();
        ctx.arc(x, y, 0.65 + random() * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
    { repeat: [1, 1] }
  );
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  return texture;
}

export function createPineBoughGeometry(width = 0.34) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const planes = 2;
  for (let p = 0; p < planes; p++) {
    const angle = (p / planes) * Math.PI;
    const wy = Math.cos(angle) * width;
    const wz = Math.sin(angle) * width;
    const base = positions.length / 3;
    positions.push(
      0, -wy, -wz,
      0, wy, wz,
      1, wy, wz,
      1, -wy, -wz
    );
    uvs.push(0, 0, 0, 1, 1, 1, 1, 0);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function makeGlowTexture() {
  return canvasTexture(
    128,
    (ctx, w, h) => {
      const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.15, 'rgba(255,244,214,.95)');
      gradient.addColorStop(0.45, 'rgba(255,192,110,.28)');
      gradient.addColorStop(1, 'rgba(255,170,80,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    },
    { linear: true }
  );
}

export function makeSmokeTexture(seed = 7) {
  const random = mulberry32(seed);
  return canvasTexture(
    128,
    (ctx, w, h) => {
      const gradient = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
      gradient.addColorStop(0, 'rgba(230,232,225,.55)');
      gradient.addColorStop(0.45, 'rgba(210,216,210,.28)');
      gradient.addColorStop(1, 'rgba(200,210,205,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 30; i++) {
        const a = random() * Math.PI * 2;
        const r = random() * w * 0.35;
        const g = ctx.createRadialGradient(
          w / 2 + Math.cos(a) * r,
          h / 2 + Math.sin(a) * r,
          0,
          w / 2 + Math.cos(a) * r,
          h / 2 + Math.sin(a) * r,
          w * (0.08 + random() * 0.16)
        );
        g.addColorStop(0, `rgba(235,238,232,${0.04 + random() * 0.08})`);
        g.addColorStop(1, 'rgba(235,238,232,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
    },
    { linear: true }
  );
}

export function makeFogSheetTexture() {
  return canvasTexture(256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 13; i++) {
      const x = w * (0.2 + Math.random() * 0.6);
      const y = h * (0.35 + Math.random() * 0.3);
      const r = 50 + Math.random() * 110;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(205,218,215,.12)');
      g.addColorStop(0.55, 'rgba(190,205,203,.05)');
      g.addColorStop(1, 'rgba(180,200,200,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  });
}

export function makeCardTexture(seed = 5) {
  const random = mulberry32(seed);
  const texture = canvasTexture(64, (ctx, w, h) => {
    ctx.fillStyle = '#6b4a33';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 30; i++) {
      ctx.strokeStyle = random() > 0.5 ? '#8c6748' : '#4b3222';
      ctx.globalAlpha = 0.15 + random() * 0.3;
      ctx.beginPath();
      ctx.moveTo(random() * w, 0);
      ctx.quadraticCurveTo(random() * w, h * 0.5, random() * w, h);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, { width: 64, height: 64 });
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/* ------------------------------------------------------------------ *
 * Geometry helpers
 * ------------------------------------------------------------------ */

export function distortGeometry(geometry, amount, seed = 1, yScale = 1) {
  const random = mulberry32(seed);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = 1 + (random() - 0.5) * amount;
    pos.setXYZ(i, x * n, y * (1 + (random() - 0.5) * amount * yScale), z * n);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export function createLeafClusterGeometry(seed = 1) {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  distortGeometry(geometry, 0.5, seed, 0.8);
  // Flatten the cluster slightly and lift its lower face; reads as a canopy puff.
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setY(i, y * 0.72);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function createBladeGeometry() {
  const geometry = new THREE.BufferGeometry();
  const vertices = [];
  const indices = [];
  const blades = 9;
  for (let b = 0; b < blades; b++) {
    const angle = (b / blades) * Math.PI * 2 + (b % 3) * 0.18;
    const width = 0.018 + (b % 3) * 0.009;
    const height = 0.4 + (b % 5) * 0.12;
    const bendX = Math.cos(angle) * (0.12 + (b % 2) * 0.08);
    const bendZ = Math.sin(angle) * (0.12 + (b % 2) * 0.08);
    const dx = Math.cos(angle) * width;
    const dz = Math.sin(angle) * width;
    const base = vertices.length / 3;
    vertices.push(-dx, 0, -dz, dx, 0, dz, bendX, height, bendZ);
    indices.push(base, base + 1, base + 2);
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createFernGeometry(seed = 8) {
  const random = mulberry32(seed);
  const positions = [];
  const indices = [];
  const colors = [];
  const count = 7;
  const leafColor = new THREE.Color();
  for (let f = 0; f < count; f++) {
    const angle = (f / count) * Math.PI * 2 + random() * 0.4;
    const length = 0.72 + random() * 0.7;
    const segments = 8;
    const base = positions.length / 3;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const stemR = 0.012;
      const x = Math.cos(angle) * length * t;
      const z = Math.sin(angle) * length * t;
      const y = Math.sin(t * Math.PI * 0.82) * 0.55 + 0.02;
      const sideX = Math.cos(angle + Math.PI / 2) * stemR;
      const sideZ = Math.sin(angle + Math.PI / 2) * stemR;
      positions.push(x - sideX, y, z - sideZ, x + sideX, y, z + sideZ);
      const green = leafColor.setHSL(0.25 + random() * 0.04, 0.24, 0.22 + t * 0.1);
      colors.push(green.r, green.g, green.b, green.r, green.g, green.b);
      if (i < segments) {
        const a = base + i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    // Leaflets
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const x = Math.cos(angle) * length * t;
      const z = Math.sin(angle) * length * t;
      const y = Math.sin(t * Math.PI * 0.82) * 0.55 + 0.02;
      const size = (1 - t * 0.65) * (0.12 + random() * 0.06);
      const perp = angle + Math.PI / 2;
      for (const side of [-1, 1]) {
        const px = x + Math.cos(perp) * size * side;
        const pz = z + Math.sin(perp) * size * side;
        const bx = x + Math.cos(angle) * size * 0.25;
        const bz = z + Math.sin(angle) * size * 0.25;
        const ix = x - Math.cos(angle) * size * 0.22;
        const iz = z - Math.sin(angle) * size * 0.22;
        const baseIndex = positions.length / 3;
        positions.push(bx, y, bz, px, y + 0.03, pz, ix, y, iz);
        const c = leafColor.setHSL(0.25 + random() * 0.035, 0.3, 0.2 + random() * 0.11);
        colors.push(c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b);
        indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createGroundLeafGeometry() {
  const geometry = new THREE.BufferGeometry();
  const positions = [
    0, 0, -0.5,
    0.35, 0.015, -0.05,
    0.18, 0.02, 0.5,
    0, 0.025, 0.75,
    -0.18, 0.02, 0.5,
    -0.35, 0.015, -0.05,
  ];
  const indices = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5];
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function makeStoneGeometry(seed = 1) {
  const geometry = new THREE.DodecahedronGeometry(1, 0);
  distortGeometry(geometry, 0.45, seed, 0.4);
  return geometry;
}

export function orientCylinderBetween(mesh, start, end) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  mesh.position.copy(start).addScaledVector(direction, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.scale.set(1, length, 1);
}

export function makeInstanced(geometry, material, count, { castShadow = true, receiveShadow = true } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  return mesh;
}

export function setMatrix(mesh, index, position, rotation, scale) {
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion().setFromEuler(rotation);
  matrix.compose(position, quaternion, scale);
  mesh.setMatrixAt(index, matrix);
}

export function randomPointInRing(random, rMin, rMax, angleMin = 0, angleMax = Math.PI * 2) {
  const angle = angleMin + random() * (angleMax - angleMin);
  const radius = Math.sqrt(rMin * rMin + random() * (rMax * rMax - rMin * rMin));
  return new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
}

/**
 * Bake a large, static hierarchy down to one mesh per material. This keeps the
 * authored detail (and shadows) while cutting hundreds of draw calls.
 */
export function mergeStaticMeshes(root) {
  root.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const batches = new Map();
  const meshes = [];

  root.traverse((object) => {
    if (!object.isMesh || object.isInstancedMesh || object.isSkinnedMesh) return;
    if (!object.geometry || !object.material || object.userData.noMerge) return;
    meshes.push(object);
  });

  const addGeometry = (geometry, material, matrix, object) => {
    const key = [
      material.uuid,
      object.castShadow ? 1 : 0,
      object.receiveShadow ? 1 : 0,
      object.renderOrder,
    ].join('|');
    let batch = batches.get(key);
    if (!batch) {
      batch = {
        material,
        castShadow: object.castShadow,
        receiveShadow: object.receiveShadow,
        renderOrder: object.renderOrder,
        geometries: [],
      };
      batches.set(key, batch);
    }
    const baked = geometry.clone();
    baked.applyMatrix4(matrix);
    batch.geometries.push(baked);
  };

  for (const object of meshes) {
    object.updateWorldMatrix(true, false);
    const matrix = new THREE.Matrix4().multiplyMatrices(rootInverse, object.matrixWorld);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (Array.isArray(object.material) && object.geometry.groups.length) {
      for (const group of object.geometry.groups) {
        const material = object.material[group.materialIndex];
        if (!material) continue;
        let geometry;
        if (object.geometry.index) {
          geometry = object.geometry.clone();
          const source = object.geometry.index;
          const start = group.start;
          const end = Math.min(source.count, start + group.count);
          const subset = new Uint32Array(end - start);
          for (let i = start; i < end; i++) subset[i - start] = source.getX(i);
          geometry.setIndex(new THREE.BufferAttribute(subset, 1));
        } else {
          geometry = object.geometry.clone();
        }
        const nonIndexed = geometry.toNonIndexed ? geometry.toNonIndexed() : geometry;
        if (nonIndexed !== geometry) geometry.dispose();
        addGeometry(nonIndexed, material, matrix, object);
      }
    } else {
      const material = materials[0];
      const nonIndexed = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry;
      addGeometry(nonIndexed, material, matrix, object);
      if (nonIndexed !== object.geometry) {
        // addGeometry clones it; this intermediate copy is no longer needed.
        nonIndexed.dispose();
      }
    }
  }

  for (const object of meshes) {
    object.removeFromParent();
    object.geometry.dispose();
  }

  for (const batch of batches.values()) {
    if (!batch.geometries.length) continue;
    let merged;
    try {
      merged = mergeGeometries(batch.geometries, false);
    } catch (error) {
      console.warn('Could not merge a static batch:', error);
      for (const geometry of batch.geometries) geometry.dispose();
      continue;
    }
    for (const geometry of batch.geometries) geometry.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, batch.material);
    mesh.castShadow = batch.castShadow;
    mesh.receiveShadow = batch.receiveShadow;
    mesh.renderOrder = batch.renderOrder;
    mesh.name = 'merged-static';
    root.add(mesh);
  }
  return root;
}

export function createEnvironmentTexture(renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#182a32');
  gradient.addColorStop(0.42, '#455f66');
  gradient.addColorStop(0.58, '#8a7e6c');
  gradient.addColorStop(0.69, '#b08a68');
  gradient.addColorStop(1, '#1b211c');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 256);
  const glow = ctx.createRadialGradient(150, 150, 2, 150, 150, 160);
  glow.addColorStop(0, 'rgba(255,204,142,.8)');
  glow.addColorStop(1, 'rgba(255,185,110,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 512, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTexture = pmrem.fromEquirectangular(texture).texture;
  texture.dispose();
  pmrem.dispose();
  return envTexture;
}

export { cloneLinearTexture };
