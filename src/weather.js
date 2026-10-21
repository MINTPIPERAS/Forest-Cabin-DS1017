import * as THREE from 'three';
import { mulberry32 } from './utils.js';

/* ------------------------------------------------------------------ *
 * Rain — GPU-animated streaks in a volume that follows the camera
 * ------------------------------------------------------------------ */

function createRain() {
  const random = mulberry32(551);
  const count = 5200;
  const positions = new Float32Array(count * 2 * 3);
  const seeds = new Float32Array(count * 2 * 3);
  const tips = new Float32Array(count * 2);
  const speeds = new Float32Array(count * 2);

  for (let i = 0; i < count; i++) {
    const sx = random();
    const sy = random();
    const sz = random();
    const speed = 0.55 + random() * 0.5;
    for (let v = 0; v < 2; v++) {
      const index = i * 2 + v;
      positions[index * 3] = 0;
      positions[index * 3 + 1] = 0;
      positions[index * 3 + 2] = 0;
      seeds[index * 3] = sx;
      seeds[index * 3 + 1] = sy;
      seeds[index * 3 + 2] = sz;
      tips[index] = v;
      speeds[index] = speed;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  geometry.setAttribute('aTip', new THREE.BufferAttribute(tips, 1));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uIntensity: { value: 0 },
      uWind: { value: 0.4 },
      uColor: { value: new THREE.Color(0xc6d2d6) },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aSeed;
      attribute float aTip;
      attribute float aSpeed;
      uniform float uTime;
      uniform vec3 uCenter;
      uniform float uIntensity;
      uniform float uWind;
      varying float vFade;

      void main() {
        float areaXZ = 40.0;
        float areaY = 26.0;
        vec3 base;
        base.x = (aSeed.x - 0.5) * areaXZ;
        base.z = (aSeed.z - 0.5) * areaXZ;
        // Fine drizzle: slower fall and much shorter streaks than a downpour.
        float fall = mod(aSeed.y * areaY - uTime * (5.5 + aSpeed * 3.5), areaY);
        base.y = fall - areaY * 0.35;
        base.x += uWind * 1.6 * (1.0 - fall / areaY);
        base.z += uWind * 0.6 * (1.0 - fall / areaY);
        base.x += uCenter.x;
        base.z += uCenter.z;
        base.y += uCenter.y - 2.0;

        vec3 streak = vec3(-uWind * 0.25, 1.0, -uWind * 0.08) * (0.14 + aSpeed * 0.12);
        vec3 p = base + streak * aTip;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;
        // Fade in close, fade out far: the near field stays a soft veil rather
        // than a hard curtain of lines.
        vFade = smoothstep(0.8, 3.2, dist) * smoothstep(40.0, 16.0, dist) * uIntensity;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vFade;
      void main() {
        if (vFade <= 0.001) discard;
        gl_FragColor = vec4(uColor, vFade * 0.16 * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.visible = false;
  lines.renderOrder = 3;
  return lines;
}

/* ------------------------------------------------------------------ *
 * Snow — soft drifting flakes
 * ------------------------------------------------------------------ */

function makeFlakeTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(250,253,255,0.85)');
  gradient.addColorStop(0.75, 'rgba(235,245,252,0.25)');
  gradient.addColorStop(1, 'rgba(230,242,250,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createSnow() {
  const random = mulberry32(882);
  const count = 2400;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = 0;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = 0;
    seeds[i * 4] = random();
    seeds[i * 4 + 1] = random();
    seeds[i * 4 + 2] = random();
    seeds[i * 4 + 3] = random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uIntensity: { value: 0 },
      uWind: { value: 0.4 },
      uMap: { value: makeFlakeTexture() },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.6) },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime;
      uniform vec3 uCenter;
      uniform float uIntensity;
      uniform float uWind;
      uniform float uPixelRatio;
      varying float vAlpha;

      void main() {
        float areaXZ = 36.0;
        float areaY = 22.0;
        vec3 p;
        p.x = (aSeed.x - 0.5) * areaXZ;
        p.z = (aSeed.z - 0.5) * areaXZ;
        float fall = mod(aSeed.y * areaY - uTime * (1.1 + aSeed.w * 1.5), areaY);
        p.y = fall - areaY * 0.3;
        p.x += sin(uTime * (0.35 + aSeed.w * 0.4) + aSeed.x * 21.0) * 1.5 + uWind * 2.4 * (1.0 - fall / areaY);
        p.z += cos(uTime * (0.28 + aSeed.w * 0.35) + aSeed.z * 17.0) * 1.2 + uWind * 0.8 * (1.0 - fall / areaY);
        p += uCenter;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;
        float size = (0.055 + aSeed.w * 0.09) * (320.0 / max(1.0, dist)) * uPixelRatio;
        gl_PointSize = clamp(size, 1.0, 26.0);
        vAlpha = smoothstep(0.8, 3.0, dist) * smoothstep(38.0, 22.0, dist) * uIntensity;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying float vAlpha;
      void main() {
        if (vAlpha <= 0.001) discard;
        vec4 tex = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(vec3(0.96, 0.98, 1.0), tex.a * vAlpha * 0.9);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  points.renderOrder = 3;
  return points;
}

/* ------------------------------------------------------------------ *
 * Public
 * ------------------------------------------------------------------ */

export function createWeather(scene) {
  const rain = createRain();
  const snow = createSnow();
  scene.add(rain);
  scene.add(snow);

  const state = { rain: 0, snow: 0, wind: 0.35 };

  function setWeather(preset) {
    state.rain = preset.rain;
    state.snow = preset.snow;
    state.wind = preset.wind;
    rain.material.uniforms.uIntensity.value = preset.rain;
    rain.material.uniforms.uWind.value = preset.wind;
    snow.material.uniforms.uIntensity.value = preset.snow;
    snow.material.uniforms.uWind.value = preset.wind;
    rain.visible = preset.rain > 0.01;
    snow.visible = preset.snow > 0.01;
  }

  function update(time, camera) {
    if (rain.visible) {
      rain.material.uniforms.uTime.value = time;
      rain.material.uniforms.uCenter.value.copy(camera.position);
    }
    if (snow.visible) {
      snow.material.uniforms.uTime.value = time;
      snow.material.uniforms.uCenter.value.copy(camera.position);
    }
  }

  return { rain, snow, setWeather, update, state };
}
