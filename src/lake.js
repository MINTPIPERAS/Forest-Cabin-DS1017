import * as THREE from 'three';
import {
  LAKE,
  lakeField,
  groundHeight,
  mulberry32,
  makeWoodTexture,
  makeGlowTexture,
  makeStoneGeometry,
  createLeafClusterGeometry,
  canvasTexture,
  clamp,
  smoothstep,
  LAKE_BOUNDARY_GLSL,
} from './utils.js';

/* ------------------------------------------------------------------ *
 * Lake surface
 * ------------------------------------------------------------------ */

const DOCK = {
  x: 8.6,
  z: 10.6,
  length: 10.0,
  width: 1.9,
  deckY: LAKE.waterY + 0.78,
  rotation: -0.06,
};

const WATER_VERTEX = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const WATER_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uSkyColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform float uSunIntensity;
  uniform float uRain;
  uniform float uSnow;
  uniform float uWind;
  uniform float uFogDensity;
  uniform vec3 uFogColor;
  uniform vec3 uLampA;
  uniform vec3 uLampB;
  uniform float uLampIntensity;
  uniform vec3 uCameraPos;
  uniform float uNight;
  uniform vec2 uLakeCenter;
  uniform vec2 uLakeRadius;
  varying vec3 vWorldPos;
  varying vec2 vUv;

  ${LAKE_BOUNDARY_GLSL}

  float lakeFieldGLSL(vec2 p) {
    vec2 d = (p - uLakeCenter) / uLakeRadius;
    float shape = lakeBoundaryGLSL(d.x);
    if (shape < 0.012) return 10.0;
    return abs(d.y) / shape;
  }

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  // Value noise with a smoother hash. The classic sin-hash bands badly on
  // large, low-frequency surfaces such as this lake.
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += noise(p) * a;
      p = p * 2.03 + 5.7;
      a *= 0.5;
    }
    return v;
  }

  // Expanding rings from raindrops.
  float rainRipples(vec2 p, float t) {
    vec2 cell = floor(p * 1.9);
    vec2 local = fract(p * 1.9) - 0.5;
    float h = hash21(cell);
    float phase = fract(t * (0.55 + h * 0.45) + h);
    float r = length(local);
    float ring = sin((r - phase * 0.52) * 42.0) * 0.5 + 0.5;
    float fade = smoothstep(0.52, 0.0, r) * (1.0 - phase) * (1.0 - phase);
    return ring * fade * step(0.35, h);
  }

  void main() {
    vec2 p = vWorldPos.xz;
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    float dist = length(uCameraPos.xz - p);

    // Layered surface normal: long swells, fine chop, and rain disturbance.
    // The slope stays small — water is nearly flat, and large slopes make the
    // reflection snap between sky bands instead of shimmering. Frequencies are
    // kept low enough that the surface still reads as water from above.
    float chop = mix(0.06, 0.2, uWind);
    float t = uTime;
    vec2 n1 = vec2(fbm(p * 0.22 + vec2(t * 0.035, t * 0.021)), fbm(p * 0.2 + vec2(-t * 0.028, t * 0.031) + 7.3));
    vec2 n2 = vec2(fbm(p * 0.6 + vec2(-t * 0.09, t * 0.06)), fbm(p * 0.55 + vec2(t * 0.07, -t * 0.08) + 3.1));
    vec2 n3 = vec2(fbm(p * 1.5 + vec2(t * 0.22, -t * 0.18)), fbm(p * 1.4 + vec2(-t * 0.2, -t * 0.23) + 9.7));
    vec2 slope = (n1 - 0.5) * 0.3 + (n2 - 0.5) * 0.18 + (n3 - 0.5) * 0.08;
    slope *= chop;

    float ripples = rainRipples(p, t) * uRain;
    slope += vec2(ripples, ripples * 0.6) * 0.03;

    vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));

    // Reflection: mirror the view about a flat surface, then nudge it with the
    // wave normal. Sampling the sky gradient straight from the perturbed normal
    // bands the lake, so the wave detail stays subtle.
    vec3 flatReflected = reflect(-viewDir, vec3(0.0, 1.0, 0.0));
    vec3 waveReflected = reflect(-viewDir, normal);
    vec3 reflected = normalize(mix(flatReflected, waveReflected, 0.34));
    float skyMix = clamp(flatReflected.y * 1.7 + 0.2, 0.0, 1.0);
    vec3 reflection = mix(uHorizonColor, uSkyColor, skyMix);
    // Keep the reflection tinted rather than mirror-bright: it reads as water,
    // not a pale sheet, under a bright sky.
    reflection *= 0.52;

    // Fresnel — the lake reads dark from above, mirror-like near the horizon.
    float fresnel = pow(1.0 - clamp(dot(viewDir, normal), 0.0, 1.0), 4.0);
    fresnel = clamp(0.08 + fresnel * 0.66, 0.08, 0.74);

    // Depth shading toward the shore.
    float shoreField = lakeFieldGLSL(vWorldPos.xz);
    float shore = smoothstep(0.15, 1.02, shoreField);
    vec3 bodyColor = mix(uDeepColor, uShallowColor, shore * 0.82);

    // A darker rim right at the bank reads as the bank shadow and gives the
    // lake a defined edge instead of fading straight into the grass.
    float bankShade = smoothstep(0.78, 1.03, shoreField);
    bodyColor *= 1.0 - bankShade * 0.35;

    // Underwater light shafts near the banks.
    float bands = fbm(p * 0.19 + vec2(t * 0.015, 0.0));
    bodyColor += uShallowColor * smoothstep(0.62, 0.95, bands) * shore * 0.1;

    // Wind streaks: long, soft bands of calmer water across the surface.
    float streak = fbm(p * vec2(0.055, 0.42) + vec2(t * 0.012, 0.0));
    float streakMask = smoothstep(0.46, 0.78, streak) * (1.0 - shore * 0.6);
    bodyColor = mix(bodyColor, uShallowColor * 1.35, streakMask * 0.28);

    vec3 color = mix(bodyColor, reflection, fresnel);

    // Sun / moon glitter path — driven by the flat reflection so it stays a
    // narrow, believable streak rather than striping the whole lake.
    vec3 halfVec = normalize(uSunDirection + viewDir);
    float spec = pow(max(dot(normal, halfVec), 0.0), mix(240.0, 680.0, uSunIntensity));
    float pathMask = smoothstep(0.72, 1.0, 1.0 - abs(flatReflected.x) * 3.2);
    color += uSunColor * spec * uSunIntensity * (0.35 + pathMask * 1.5);

    // Warm reflections from the cabin windows and the dock lantern. Use a
    // fine, noisy shimmer: a low-frequency sine here reads as painted stripes.
    float lampA = exp(-dist * 0.055) * uLampIntensity;
    float lampB = exp(-dist * 0.16) * uLampIntensity;
    float shimmer =
      noise(p * 2.1 + vec2(t * 0.5, t * 0.36)) *
      noise(p * 3.7 - vec2(t * 0.42, t * 0.31) + 5.1);
    color += vec3(1.0, 0.58, 0.24) * lampA * 0.075 * shimmer;
    color += vec3(1.0, 0.62, 0.3) * lampB * 0.05 * shimmer;

    // Snow / rain mute the surface.
    color = mix(color, color * vec3(0.92, 0.95, 0.98), uSnow * 0.5);
    color = mix(color, uFogColor, clamp(uRain * 0.22, 0.0, 0.35));

    // Exponential fog to match the scene.
    float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    color = mix(color, uFogColor, clamp(fogFactor, 0.0, 1.0));

    // Dither to avoid 8-bit banding across the large, smooth water gradient.
    float dither = (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
    color += dither;

    gl_FragColor = vec4(color, 1.0);
  }
`;

function createLakeMesh() {
  // Build a generous rectangular sheet covering the whole basin, then keep only
  // the triangles that actually sit below the waterline. The visible shoreline
  // is therefore produced by the terrain, never by the mesh border, so it can
  // never show up as a straight segment.
  const cellsX = 150;
  const cellsZ = 110;
  const pad = 1.55;
  const minX = LAKE.x - LAKE.rx * pad;
  const maxX = LAKE.x + LAKE.rx * pad;
  const minZ = LAKE.z - LAKE.rz * pad;
  const maxZ = LAKE.z + LAKE.rz * pad;
  const stepX = (maxX - minX) / cellsX;
  const stepZ = (maxZ - minZ) / cellsZ;

  const positions = [];
  const uvs = [];
  const indices = [];
  const random = mulberry32(311);

  // Sample once per grid vertex.
  const heights = new Float32Array((cellsX + 1) * (cellsZ + 1));
  for (let iz = 0; iz <= cellsZ; iz++) {
    for (let ix = 0; ix <= cellsX; ix++) {
      const x = minX + ix * stepX;
      const z = minZ + iz * stepZ;
      heights[iz * (cellsX + 1) + ix] = groundHeight(x, z);
    }
  }

  const vertexIndex = new Int32Array((cellsX + 1) * (cellsZ + 1)).fill(-1);
  const getVertex = (ix, iz) => {
    const key = iz * (cellsX + 1) + ix;
    if (vertexIndex[key] !== -1) return vertexIndex[key];
    // Jitter interior vertices slightly so the submerged sheet's own triangles
    // never align into visible rows.
    const jitterX = (random() - 0.5) * stepX * 0.35;
    const jitterZ = (random() - 0.5) * stepZ * 0.35;
    const x = minX + ix * stepX + jitterX;
    const z = minZ + iz * stepZ + jitterZ;
    const index = positions.length / 3;
    positions.push(x, LAKE.waterY, z);
    uvs.push(ix / cellsX, iz / cellsZ);
    vertexIndex[key] = index;
    return index;
  };

  const waterline = LAKE.waterY + 0.02;
  for (let iz = 0; iz < cellsZ; iz++) {
    for (let ix = 0; ix < cellsX; ix++) {
      const h00 = heights[iz * (cellsX + 1) + ix];
      const h10 = heights[iz * (cellsX + 1) + ix + 1];
      const h01 = heights[(iz + 1) * (cellsX + 1) + ix];
      const h11 = heights[(iz + 1) * (cellsX + 1) + ix + 1];
      const under = (h) => h < waterline;
      const a = under(h00);
      const b = under(h10);
      const c = under(h01);
      const d = under(h11);
      // Skip cells that are entirely dry; cells touching the bank are kept so
      // the sheet tucks a little way under the terrain.
      if (!a && !b && !c && !d) continue;
      const v00 = getVertex(ix, iz);
      const v10 = getVertex(ix + 1, iz);
      const v01 = getVertex(ix, iz + 1);
      const v11 = getVertex(ix + 1, iz + 1);
      indices.push(v00, v01, v10, v10, v01, v11);
    }
  }

  // Snap every boundary vertex onto the actual waterline. Without this the
  // kept-cell border follows the grid, which reads as a straight pale edge
  // wherever a run of cells ends against the bank.
  const posAttr = positions;
  const boundary = new Set();
  const indexCount = indices.length;
  const edgeUse = new Map();
  for (let i = 0; i < indexCount; i += 3) {
    const tri = [indices[i], indices[i + 1], indices[i + 2]];
    for (let e = 0; e < 3; e++) {
      const p = tri[e];
      const q = tri[(e + 1) % 3];
      const key = p < q ? `${p}_${q}` : `${q}_${p}`;
      edgeUse.set(key, (edgeUse.get(key) || 0) + 1);
    }
  }
  for (const [key, count] of edgeUse) {
    if (count !== 1) continue;
    const [p, q] = key.split('_').map(Number);
    boundary.add(p);
    boundary.add(q);
  }
  for (const vi of boundary) {
    const x = posAttr[vi * 3];
    const z = posAttr[vi * 3 + 2];
    // March toward the lake centre until we reach dry land, then step back to
    // the last submerged point: that is the waterline along this ray.
    const dx = LAKE.x - x;
    const dz = LAKE.z - z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = dx / len;
    const nz = dz / len;
    let inside = 0;
    for (let s = 0; s <= 8; s += 0.4) {
      const px = x + nx * s;
      const pz = z + nz * s;
      if (groundHeight(px, pz) < waterline) inside = s;
      else break;
    }
    if (inside > 0) {
      posAttr[vi * 3] = x + nx * inside;
      posAttr[vi * 3 + 2] = z + nz * inside;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDeepColor: { value: new THREE.Color(0x0b1b20) },
      uShallowColor: { value: new THREE.Color(0x2a4744) },
      uSkyColor: { value: new THREE.Color(0x7f9aa4) },
      uHorizonColor: { value: new THREE.Color(0xb3a58f) },
      uSunDirection: { value: new THREE.Vector3(0.3, 0.55, -0.7).normalize() },
      uSunColor: { value: new THREE.Color(0xffd2a0) },
      uSunIntensity: { value: 0.8 },
      uRain: { value: 0 },
      uSnow: { value: 0 },
      uWind: { value: 0.4 },
      uFogDensity: { value: 0.0155 },
      uFogColor: { value: new THREE.Color(0x5b7071) },
      uLampA: { value: new THREE.Vector3(0.3, 1.2, 5.5) },
      uLampB: { value: new THREE.Vector3(-1.5, 1.6, 17.5) },
      uLampIntensity: { value: 1 },
      uCameraPos: { value: new THREE.Vector3() },
      uNight: { value: 0 },
      uLakeCenter: { value: new THREE.Vector2(LAKE.x, LAKE.z) },
      uLakeRadius: { value: new THREE.Vector2(LAKE.rx, LAKE.rz) },
    },
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, 0, 0);
  mesh.rotation.y = 0;
  mesh.receiveShadow = false;
  mesh.name = 'lake-surface';
  return mesh;
}

/* ------------------------------------------------------------------ *
 * Reeds and shoreline dressing
 * ------------------------------------------------------------------ */

function createReeds(random) {
  const positions = [];
  const colors = [];
  const indices = [];
  const count = 900;
  const color = new THREE.Color();
  let bladeIndex = 0;

  const addBlade = (x, z, height, width, lean, angle, hueShift) => {
    const base = positions.length / 3;
    const dx = Math.cos(angle) * width;
    const dz = Math.sin(angle) * width;
    const tipX = x + Math.cos(angle + lean) * height * 0.16;
    const tipZ = z + Math.sin(angle + lean) * height * 0.16;
    positions.push(x - dx, 0, z - dz, x + dx, 0, z + dz, tipX, height, tipZ);
    color.setHSL(0.13 + hueShift, 0.22 + Math.random() * 0.12, 0.24 + Math.random() * 0.14);
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b);
    indices.push(base, base + 1, base + 2);
    bladeIndex++;
  };

  let guard = 0;
  while (bladeIndex < count && guard < 20000) {
    guard++;
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random());
    const x = LAKE.x + Math.cos(angle) * radius * LAKE.rx * 1.12;
    const z = LAKE.z + Math.sin(angle) * radius * LAKE.rz * 1.12;
    const field = lakeField(x, z);
    if (field < 0.94 || field > 1.13) continue;
    const y = LAKE.waterY - 0.06;
    const clusterSize = 3 + Math.floor(random() * 5);
    for (let i = 0; i < clusterSize && bladeIndex < count; i++) {
      const h = 0.5 + random() * 1.15;
      const w = 0.014 + random() * 0.02;
      addBlade(
        x + (random() - 0.5) * 0.5,
        z + (random() - 0.5) * 0.5,
        h,
        w,
        (random() - 0.5) * 0.8,
        random() * Math.PI,
        random() * 0.04
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    side: THREE.DoubleSide,
    envMapIntensity: 0.2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = LAKE.waterY;
  mesh.name = 'lake-reeds';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

function createShoreStones(random) {
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x837f74, roughness: 0.96, envMapIntensity: 0.2 });
  const darkStoneMat = new THREE.MeshStandardMaterial({ color: 0x635f56, roughness: 0.98 });
  const stoneGeo = makeStoneGeometry(51);
  const total = 620;
  const lightBatch = new THREE.InstancedMesh(stoneGeo, stoneMat, total);
  const darkBatch = new THREE.InstancedMesh(stoneGeo, darkStoneMat, total);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  let lightIndex = 0;
  let darkIndex = 0;

  // Walk the shoreline once, laying stones side by side so the lake reads as
  // ringed by a continuous stone border rather than a few scattered rocks.
  const steps = 340;
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    // Slight radial jitter keeps the ring organic.
    const jitter = (random() - 0.5) * 0.035;
    const edge = 1.055 + jitter;
    const x = LAKE.x + Math.cos(angle) * LAKE.rx * edge;
    const z = LAKE.z + Math.sin(angle) * LAKE.rz * edge;
    // Leave a gap where the dock meets the shore.
    if (Math.hypot(x - DOCK.x, z - DOCK.z) < 2.6) continue;

    const stonesHere = 2 + Math.floor(random() * 2);
    for (let n = 0; n < stonesHere; n++) {
      const a2 = angle + (random() - 0.5) * 0.03;
      const spread = 0.86 + random() * 0.3;
      const sx = LAKE.x + Math.cos(a2) * LAKE.rx * edge * spread + (random() - 0.5) * 0.22;
      const sz = LAKE.z + Math.sin(a2) * LAKE.rz * edge * spread + (random() - 0.5) * 0.22;
      const s = 0.16 + Math.pow(random(), 1.6) * 0.42;
      const groundY = LAKE.waterY - 0.04;
      position.set(sx, groundY + s * 0.1, sz);
      quaternion.setFromEuler(new THREE.Euler(random() * 0.5, random() * 6.2, random() * 0.45));
      scale.set(s * (1.15 + random() * 0.75), s * (0.42 + random() * 0.2), s * (0.9 + random() * 0.4));
      matrix.compose(position, quaternion, scale);
      if (random() > 0.45) {
        lightBatch.setMatrixAt(lightIndex++, matrix);
      } else {
        darkBatch.setMatrixAt(darkIndex++, matrix);
      }
    }
  }
  lightBatch.count = lightIndex;
  darkBatch.count = darkIndex;
  for (const batch of [lightBatch, darkBatch]) {
    batch.castShadow = true;
    batch.receiveShadow = true;
    batch.name = 'shore-stones';
    group.add(batch);
  }
  return group;
}

/* ------------------------------------------------------------------ *
 * Wooden dock
 * ------------------------------------------------------------------ */


function createDock() {
  const group = new THREE.Group();
  group.name = 'dock';
  const random = mulberry32(4321);
  const plankTex = makeWoodTexture(88, 'log');
  plankTex.repeat.set(1, 1);
  const plankMat = new THREE.MeshStandardMaterial({
    color: 0x9a7550,
    map: plankTex,
    roughness: 0.92,
    envMapIntensity: 0.25,
  });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x5a4230, roughness: 0.96 });
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x8a7a5c, roughness: 1 });

  // Deck planks laid across the walkway, with a little irregularity.
  const plankCount = 30;
  const spacing = DOCK.length / plankCount;
  const planks = new THREE.Group();
  for (let i = 0; i < plankCount; i++) {
    const plank = new THREE.Mesh(
      new THREE.BoxGeometry(DOCK.width + (random() - 0.5) * 0.12, 0.085, spacing * 0.82),
      plankMat
    );
    plank.position.set(
      (random() - 0.5) * 0.06,
      DOCK.deckY + (random() - 0.5) * 0.012,
      -DOCK.length / 2 + i * spacing + spacing / 2
    );
    plank.rotation.y = (random() - 0.5) * 0.012;
    plank.castShadow = true;
    plank.receiveShadow = true;
    planks.add(plank);
  }
  group.add(planks);

  // Two long stringers under the deck.
  for (const side of [-1, 1]) {
    const stringer = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.2, DOCK.length + 0.3),
      postMat
    );
    stringer.position.set(side * (DOCK.width / 2 - 0.12), DOCK.deckY - 0.14, 0);
    stringer.castShadow = true;
    stringer.receiveShadow = true;
    group.add(stringer);
  }

  // Pilings, taller at the lake end for the mooring posts.
  const pilingPositions = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    const z = -DOCK.length / 2 + t * DOCK.length;
    for (const side of [-1, 1]) {
      if (i > 0 && i < 5 && side === 1) continue;
      pilingPositions.push({ x: side * (DOCK.width / 2 - 0.09), z, tall: t > 0.72 });
    }
  }
  for (const p of pilingPositions) {
    const height = p.tall ? 1.55 : 1.35;
    const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.11, height, 7), postMat);
    pile.position.set(p.x, DOCK.deckY + 0.42 - height / 2, p.z);
    pile.rotation.z = (random() - 0.5) * 0.03;
    pile.castShadow = true;
    pile.receiveShadow = true;
    group.add(pile);
    if (p.tall) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 7), plankMat);
      cap.position.set(p.x, DOCK.deckY + 1.22, p.z);
      group.add(cap);
    }
  }

  // Cross bracing near the water end.
  for (const side of [-1, 1]) {
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 1.4), postMat);
    brace.position.set(side * (DOCK.width / 2 - 0.09), DOCK.waterY + 0.35, DOCK.length / 2 - 1.1);
    brace.rotation.x = 0.6;
    group.add(brace);
  }

  // Mooring rope looped around a piling.
  const ropeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(DOCK.width / 2 - 0.09, DOCK.deckY + 0.36, DOCK.length / 2 - 0.4),
    new THREE.Vector3(DOCK.width / 2 + 0.3, DOCK.deckY + 0.12, DOCK.length / 2 - 0.5),
    new THREE.Vector3(DOCK.width / 2 + 0.36, LAKE.waterY + 0.12, DOCK.length / 2 - 0.72),
    new THREE.Vector3(DOCK.width / 2 + 0.02, LAKE.waterY + 0.02, DOCK.length / 2 - 0.85),
  ]);
  const rope = new THREE.Mesh(new THREE.TubeGeometry(ropeCurve, 18, 0.022, 5, false), ropeMat);
  group.add(rope);

  // Lantern mounted on the tall piling at the end of the dock. A short bracket
  // reaches out from the post so the lamp is visibly attached rather than
  // floating in mid-air.
  const postX = DOCK.width / 2 - 0.09;
  const postZ = DOCK.length / 2 - 0.1;
  const lampX = postX - 0.34;
  const lampY = DOCK.deckY + 0.92;
  const lanternGroup = new THREE.Group();

  // Upright post that carries the lantern above the deck.
  const lampPost = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 1.15, 7), postMat);
  lampPost.position.set(postX, DOCK.deckY + 0.58, postZ);
  lampPost.castShadow = true;
  lanternGroup.add(lampPost);

  // Horizontal bracket from the post to the lamp.
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.42, 6), postMat);
  arm.rotation.z = Math.PI / 2;
  arm.position.set((postX + lampX) / 2, lampY + 0.32, postZ);
  arm.castShadow = true;
  lanternGroup.add(arm);

  // Diagonal brace under the bracket.
  const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.4, 5), postMat);
  brace.position.set((postX + lampX) / 2, lampY + 0.14, postZ);
  brace.rotation.z = Math.PI / 4;
  lanternGroup.add(brace);

  // Hanging hook from the bracket down to the lamp.
  const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.28, 5), postMat);
  hook.position.set(lampX, lampY + 0.18, postZ);
  lanternGroup.add(hook);

  const lampBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.13, 0.3, 4),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 1.15, 0.5), fog: false })
  );
  lampBody.rotation.y = Math.PI / 4;
  lampBody.position.set(lampX, lampY, postZ);
  lanternGroup.add(lampBody);

  const lampCap = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.12, 4), postMat);
  lampCap.rotation.y = Math.PI / 4;
  lampCap.position.set(lampX, lampY + 0.2, postZ);
  lanternGroup.add(lampCap);

  const lampGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      color: 0xffb26a,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    })
  );
  lampGlow.scale.setScalar(1.5);
  lampGlow.position.set(lampX, lampY, postZ);
  lanternGroup.add(lampGlow);
  group.add(lanternGroup);

  const lampLight = new THREE.PointLight(0xffa961, 5.5, 9, 2);
  lampLight.position.set(lampX, lampY, postZ);
  group.add(lampLight);

  // Position the whole dock so the near end rests on the shore. The shore has
  // been carved down toward the water, so follow the actual ground height at
  // the root instead of assuming y = 0.
  const shoreY = groundHeight(DOCK.x, DOCK.z);
  group.position.set(DOCK.x, shoreY - 0.06, DOCK.z);
  group.rotation.y = DOCK.rotation;
  group.updateMatrixWorld(true);

  // Pilings must reach bed, not float: extend each one downward until it meets
  // the terrain under it.
  for (const object of group.children) {
    if (!object.isMesh) continue;
    if (object.geometry?.type !== 'CylinderGeometry') continue;
    // Only the vertical piles (not the horizontal arm or braces).
    if (object.rotation.z !== 0 || object.rotation.x !== 0) continue;
    const world = new THREE.Vector3();
    object.getWorldPosition(world);
    const ground = groundHeight(world.x, world.z);
    const bottom = world.y - (object.geometry.parameters.height * object.scale.y) / 2;
    if (bottom > ground) {
      const extra = bottom - ground + 0.15;
      object.scale.y += extra / object.geometry.parameters.height;
      object.position.y -= extra / 2 / 1;
    }
  }
  group.updateMatrixWorld(true);

  const lampWorld = new THREE.Vector3(lampX, lampY, postZ);
  group.localToWorld(lampWorld);

  return { group, lampLight, lampWorld };
}

function createRowboat() {
  const boat = new THREE.Group();
  boat.name = 'rowboat';
  const random = mulberry32(77);
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x6b4b33, roughness: 0.9, side: THREE.DoubleSide });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x9b7a52, roughness: 0.85 });
  const innerMat = new THREE.MeshStandardMaterial({ color: 0x4a3423, roughness: 0.95, side: THREE.DoubleSide });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.9 });

  // Hull: only the lower half of a sphere, with its equator sitting at the
  // gunwale. That way the hull narrows as it goes underwater instead of
  // reaching its widest point at the waterline and reading as a second ring.
  const hullGeo = new THREE.SphereGeometry(1, 22, 12, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5);
  hullGeo.scale(0.74, 0.9, 1.82);
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.position.y = 0.6;
  hull.castShadow = true;
  hull.receiveShadow = true;
  boat.add(hull);

  // Interior floor, sitting just under the gunwale so the boat reads as hollow.
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 20), floorMat);
  floor.scale.set(0.62, 0.06, 1.6);
  floor.position.y = 0.46;
  floor.receiveShadow = true;
  boat.add(floor);

  // Inner side walls.
  const wallGeo = new THREE.CylinderGeometry(1, 0.92, 1, 22, 1, true);
  wallGeo.scale(0.68, 0.34, 1.7);
  const walls = new THREE.Mesh(wallGeo, innerMat);
  walls.position.y = 0.5;
  boat.add(walls);

  // Gunwale rail around the rim.
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.055, 7, 34), trimMat);
  rim.rotation.x = Math.PI / 2;
  rim.scale.set(0.74, 1.82, 1);
  rim.position.y = 0.66;
  rim.castShadow = true;
  boat.add(rim);

  for (const z of [-0.95, 0.5]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.075, 0.34), trimMat);
    seat.position.set(0, 0.55, z);
    seat.castShadow = true;
    boat.add(seat);
  }
  for (const side of [-1, 1]) {
    const oar = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.04, 2.15, 6), trimMat);
    oar.rotation.z = Math.PI / 2.4;
    oar.rotation.y = side * 0.16;
    oar.position.set(side * 0.52, 0.66, 0.12);
    oar.castShadow = true;
    boat.add(oar);
  }
  const lantern = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.085, 0.2, 4),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.9, 0.4), fog: false })
  );
  lantern.position.set(0.2, 0.72, -1.05);
  boat.add(lantern);

  // The hull's lowest point sits just under the waterline, so it reads as
  // floating rather than submerged.
  boat.position.set(5.0, LAKE.waterY - 0.02, 17.6);
  boat.rotation.y = 0.95;
  boat.rotation.z = 0.03;
  boat.userData.baseY = boat.position.y;
  boat.userData.baseRotZ = boat.rotation.z;
  boat.userData.phase = random() * Math.PI * 2;
  return boat;
}

/* ------------------------------------------------------------------ *
 * Quiet corners at the lake tips
 * ------------------------------------------------------------------ */

function createTipBench(mats) {
  const bench = new THREE.Group();
  const plankMat = mats.plank;
  const postMat = mats.plankDark;
  // Seat slats.
  for (let i = 0; i < 3; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.06, 0.15), plankMat);
    slat.position.set(0, 0.46, -0.16 + i * 0.16);
    slat.castShadow = true;
    slat.receiveShadow = true;
    bench.add(slat);
  }
  // Back slats.
  for (let i = 0; i < 2; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.13, 0.05), plankMat);
    slat.position.set(0, 0.7 + i * 0.18, -0.28);
    slat.castShadow = true;
    bench.add(slat);
  }
  // Legs and back uprights.
  for (const x of [-0.56, 0.56]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.46, 0.42), postMat);
    leg.position.set(x, 0.23, -0.02);
    leg.castShadow = true;
    bench.add(leg);
    const upright = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, 0.07), postMat);
    upright.position.set(x, 0.66, -0.3);
    upright.rotation.x = -0.12;
    upright.castShadow = true;
    bench.add(upright);
  }
  return bench;
}

function createTipDecorations(random, terrain) {
  const group = new THREE.Group();
  group.name = 'lake-tip-decor';
  const wood = makeWoodTexture(31, 'log');
  wood.repeat.set(1, 2);
  const plankMat = new THREE.MeshStandardMaterial({
    color: 0x8a6647,
    map: wood,
    roughness: 0.9,
    envMapIntensity: 0.22,
  });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x4f3a29, roughness: 0.94 });
  const materials = { plank: plankMat, plankDark: postMat };

  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x7d7a6f, roughness: 0.97 });
  const stoneGeo = makeStoneGeometry(140);

  // Sample the actual rendered terrain with a downward ray. The analytic
  // groundHeight() is the source of the mesh, but the mesh interpolates between
  // vertices, so props placed analytically can hover on a slope. Raycasting the
  // real surface guarantees they sit on it.
  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const probe = new THREE.Vector3();
  const surfaceY = (x, z) => {
    if (!terrain) return groundHeight(x, z);
    probe.set(x, 60, z);
    raycaster.set(probe, down);
    const hits = raycaster.intersectObject(terrain, false);
    return hits.length ? hits[0].point.y : groundHeight(x, z);
  };

  // Each tip gets a small clearing: a bench facing the water, a few boulders,
  // a lantern, and clumps of reeds/ferns to soften the geometry.
  const tips = [
    { x: -18.4, z: 20.4, rot: 1.35, lantern: true },
    { x: 20.8, z: 26.2, rot: -1.82, lantern: false },
  ];

  for (const tip of tips) {
    // The two tips sit on noticeably uneven ground, so a single group anchor
    // can never work: props on the uphill side would float while downhill ones
    // sink. Every prop below is therefore placed in world space on its own
    // sampled surface height.
    const clearing = new THREE.Group();
    clearing.position.set(0, 0, 0);
    clearing.rotation.y = 0;

    const cos = Math.cos(tip.rot);
    const sin = Math.sin(tip.rot);
    const toWorld = (bx, bz) => ({
      x: tip.x + cos * bx + sin * bz,
      z: tip.z - sin * bx + cos * bz,
    });

    const bench = createTipBench(materials);
    // Sit the bench on the lowest ground under its own footprint so no leg
    // floats, and face it toward the water.
    const benchPoints = [[0, -0.3], [-0.56, 0], [0.56, 0], [-0.56, -0.3], [0.56, -0.3]];
    let benchY = Infinity;
    for (const [bx, bz] of benchPoints) {
      const w = toWorld(bx, bz);
      benchY = Math.min(benchY, surfaceY(w.x, w.z));
    }
    const benchW = toWorld(0, 0);
    bench.position.set(benchW.x, benchY, benchW.z);
    bench.rotation.y = tip.rot;
    clearing.add(bench);

    // Boulders scattered around the clearing, each grounded on its own sample.
    let placed = 0;
    let guard = 0;
    while (placed < 7 && guard < 40) {
      guard++;
      const a = random() * Math.PI * 2;
      const r = 1.2 + random() * 2.4;
      const bx = Math.cos(a) * r;
      const bz = Math.sin(a) * r;
      const w = toWorld(bx, bz);
      const ground = surfaceY(w.x, w.z);
      if (ground < LAKE.waterY + 0.1) continue;
      const s = 0.18 + Math.pow(random(), 1.6) * 0.5;
      const stone = new THREE.Mesh(stoneGeo, placed % 3 ? stoneMat : materials.plankDark);
      stone.position.set(w.x, ground + s * 0.16, w.z);
      stone.scale.set(s * 1.25, s * 0.7, s);
      stone.rotation.set(random() * 0.4, random() * 6.2, random() * 0.3);
      stone.castShadow = true;
      stone.receiveShadow = true;
      clearing.add(stone);
      placed++;
    }

    // Low shrub clumps.
    const shrubGeo = createLeafClusterGeometry(51);
    const shrubMat = new THREE.MeshStandardMaterial({
      color: 0x3c5232,
      roughness: 0.92,
      flatShading: true,
    });
    const shrubs = new THREE.InstancedMesh(shrubGeo, shrubMat, 10);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    let shrubCount = 0;
    let shrubGuard = 0;
    while (shrubCount < 10 && shrubGuard < 50) {
      shrubGuard++;
      const a = random() * Math.PI * 2;
      const r = 1.0 + random() * 2.6;
      const bx = Math.cos(a) * r;
      const bz = Math.sin(a) * r;
      const w = toWorld(bx, bz);
      const ground = surfaceY(w.x, w.z);
      if (ground < LAKE.waterY + 0.1) continue;
      const s = 0.22 + random() * 0.34;
      quat.setFromEuler(new THREE.Euler(random() * 0.3, random() * 6.2, random() * 0.3));
      matrix.compose(
        new THREE.Vector3(w.x, ground + s * 0.28, w.z),
        quat,
        new THREE.Vector3(s, s * 0.7, s)
      );
      shrubs.setMatrixAt(shrubCount, matrix);
      shrubCount++;
    }
    shrubs.count = shrubCount;
    shrubs.castShadow = true;
    shrubs.receiveShadow = true;
    clearing.add(shrubs);

    // A small lantern post on one tip, marking the path's end. Its base follows
    // the ground under the post so the pole never floats.
    if (tip.lantern) {
      const postW = toWorld(-1.1, 0.5);
      const postGround = surfaceY(postW.x, postW.z);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.85, 7), postMat);
      post.position.set(postW.x, postGround + 0.92, postW.z);
      post.castShadow = true;
      clearing.add(post);
      const armW = toWorld(-0.95, 0.5);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 6), postMat);
      arm.rotation.y = tip.rot;
      arm.rotation.z = Math.PI / 2;
      arm.position.set(armW.x, postGround + 1.72, armW.z);
      clearing.add(arm);
      const lampW = toWorld(-0.78, 0.5);
      const lamp = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.11, 0.24, 4),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 1.02, 0.44), fog: false })
      );
      lamp.rotation.y = Math.PI / 4;
      lamp.position.set(lampW.x, postGround + 1.56, lampW.z);
      clearing.add(lamp);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: makeGlowTexture(),
          color: 0xffb26a,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          fog: true,
        })
      );
      glow.scale.setScalar(1.3);
      glow.position.copy(lamp.position);
      clearing.add(glow);
      const light = new THREE.PointLight(0xffa961, 3.2, 7, 2);
      light.position.set(lampW.x, postGround + 1.56, lampW.z);
      clearing.add(light);
    }

    group.add(clearing);
  }

  return group;
}

/* ------------------------------------------------------------------ *
 * Public
 * ------------------------------------------------------------------ */

export function createLake(scene, timeUniform) {
  const random = mulberry32(9091);
  const lake = createLakeMesh();
  scene.add(lake);
  const reeds = createReeds(random);
  scene.add(reeds);
  scene.add(createShoreStones(random));
  const terrain = scene.getObjectByName('forest-floor');
  scene.add(createTipDecorations(random, terrain));
  const dock = createDock();
  scene.add(dock.group);
  const boat = createRowboat();
  scene.add(boat);

  const material = lake.material;
  const cameraPosition = new THREE.Vector3();

  return {
    mesh: lake,
    reeds,
    dock,
    boat,
    material,
    lampWorld: dock.lampWorld,
    setTimeOfDay(preset) {
      const uniforms = material.uniforms;
      uniforms.uSkyColor.value.copy(preset.waterSky);
      uniforms.uHorizonColor.value.copy(preset.waterHorizon);
      uniforms.uDeepColor.value.copy(preset.waterDeep);
      uniforms.uShallowColor.value.copy(preset.waterShallow);
      uniforms.uSunColor.value.setHex(preset.sunColor);
      uniforms.uSunDirection.value.copy(preset.skySun);
      uniforms.uSunIntensity.value = preset.waterSun;
      uniforms.uNight.value = preset.night;
    },
    setWeather(state) {
      const uniforms = material.uniforms;
      uniforms.uRain.value = state.rain;
      uniforms.uSnow.value = state.snow;
      uniforms.uWind.value = state.wind;
      uniforms.uFogDensity.value = state.fogDensity;
      uniforms.uFogColor.value.copy(state.fogColor);
      uniforms.uLampIntensity.value = state.lampIntensity;
    },
    update(time, camera, night, weather) {
      cameraPosition.copy(camera.position);
      material.uniforms.uTime.value = time;
      material.uniforms.uCameraPos.value.copy(cameraPosition);

      // Gentle bobbing keeps the moored boat alive.
      boat.position.y =
        boat.userData.baseY +
        Math.sin(time * 0.55 + boat.userData.phase) * 0.035 * (0.6 + weather.wind);
      boat.rotation.z =
        boat.userData.baseRotZ + Math.sin(time * 0.42 + boat.userData.phase) * 0.035;
      boat.rotation.x = Math.sin(time * 0.31 + boat.userData.phase * 1.7) * 0.018;

      // Reeds sway with the weather.
      reeds.rotation.z = Math.sin(time * 0.7) * 0.006 * weather.wind;
      reeds.rotation.x = Math.cos(time * 0.55) * 0.004 * weather.wind;
    },
  };
}
