import * as THREE from 'three';
import {
  groundHeight,
  makeGroundTexture,
  makePathTexture,
  makeFogSheetTexture,
  makeGlowTexture,
  fbm,
  mulberry32,
  canvasTexture,
  createEnvironmentTexture,
  cloneLinearTexture,
  enableSnow,
} from './utils.js';

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vDirection = normalize(worldPosition.xyz - cameraPosition);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uNight;
  uniform float uDay;
  uniform float uOvercast;
  uniform vec3 uMoonDir;
  uniform vec3 uSunDir;
  uniform vec3 uFogColor;
  varying vec3 vDirection;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += noise(p) * a;
      p = p * 2.02 + 7.1;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDirection);
    float up = clamp(dir.y, 0.0, 1.0);
    float horizon = pow(1.0 - up, 2.2);

    vec3 zenithDusk = vec3(0.045, 0.085, 0.105);
    vec3 zenithNight = vec3(0.008, 0.017, 0.033);
    vec3 zenithDay = vec3(0.20, 0.42, 0.64);
    vec3 midDusk = vec3(0.22, 0.32, 0.35);
    vec3 midNight = vec3(0.032, 0.062, 0.091);
    vec3 midDay = vec3(0.44, 0.62, 0.76);
    vec3 horizonDusk = vec3(0.27, 0.29, 0.25);
    vec3 horizonNight = vec3(0.055, 0.09, 0.105);
    vec3 horizonDay = vec3(0.72, 0.79, 0.81);

    // day and night are mutually exclusive; dusk is the base both blend out of.
    vec3 zenith = mix(zenithDusk, zenithNight, uNight);
    zenith = mix(zenith, zenithDay, uDay);
    vec3 mid = mix(midDusk, midNight, uNight);
    mid = mix(mid, midDay, uDay);
    vec3 horizonColor = mix(horizonDusk, horizonNight, uNight);
    horizonColor = mix(horizonColor, horizonDay, uDay);

    vec3 color = mix(zenith, mid, smoothstep(0.0, 0.55, up));
    color = mix(color, horizonColor, horizon);

    // Last warm light lingering behind the trees.
    float sunDisc = max(dot(dir, uSunDir), 0.0);
    vec3 sunGlowColor = mix(vec3(1.0, 0.43, 0.17), vec3(0.12, 0.17, 0.22), uNight);
    sunGlowColor = mix(sunGlowColor, vec3(1.0, 0.94, 0.8), uDay);
    float sunVisibility = (1.0 - uNight * 0.86) * (1.0 - uOvercast * 0.82);
    color += sunGlowColor * (pow(sunDisc, 6.0) * (0.3 + uDay * 0.2) + pow(sunDisc, 48.0) * (0.5 + uDay * 0.6)) * sunVisibility;

    // A visible sun disc on clear days.
    color += vec3(1.9, 1.72, 1.36) * smoothstep(0.9994, 0.9998, sunDisc) * uDay * (1.0 - uOvercast * 0.9);

    // Clouds are subtle, broken streaks reflected in the fog.
    float az = atan(dir.z, dir.x);
    float el = asin(clamp(dir.y, -1.0, 1.0));
    vec2 cloudUV = vec2(az * 1.7 + uTime * 0.0017, el * 5.0 - uTime * 0.0006);
    float cloudField = fbm(cloudUV + fbm(cloudUV * 1.9 + 3.1) * 0.75);
    float cloudThreshold = mix(0.48, 0.14, uOvercast);
    float clouds = smoothstep(cloudThreshold, cloudThreshold + 0.26, cloudField) * smoothstep(0.04, 0.22, up) * (1.0 - smoothstep(0.72, 0.95, up));
    clouds = max(clouds, uOvercast * 0.55 * smoothstep(0.02, 0.3, up));
    vec3 cloudDusk = vec3(0.24, 0.28, 0.29);
    vec3 cloudNight = vec3(0.032, 0.047, 0.061);
    vec3 cloudDay = vec3(0.86, 0.9, 0.93);
    vec3 cloudColor = mix(cloudDusk, cloudNight, uNight);
    cloudColor = mix(cloudColor, cloudDay, uDay);
    cloudColor += sunGlowColor * pow(sunDisc, 3.0) * 0.15;
    color = mix(color, cloudColor, clouds * mix(0.42, 0.86, uOvercast));

    // Stars — quiet at dusk, clearer late at night.
    float starField = 0.0;
    if (dir.y > 0.02) {
      vec2 starUV = vec2(az * 52.0, el * 52.0);
      vec2 cell = floor(starUV);
      vec2 local = fract(starUV) - 0.5;
      float h = hash21(cell);
      float twinkle = 0.72 + 0.28 * sin(uTime * (0.8 + h * 2.2) + h * 31.0);
      starField = step(0.987, h) * smoothstep(0.11, 0.01, length(local)) * twinkle;
      starField *= smoothstep(0.02, 0.22, up) * (0.12 + uNight * 0.92) * (1.0 - uOvercast * 0.9);
      starField *= 1.0 - clouds * 0.8;
    }
    color += vec3(0.8, 0.88, 0.96) * starField * 0.9;

    // Moon disc and its soft atmospheric halo.
    float moonDot = max(dot(dir, uMoonDir), 0.0);
    float moonDisc = smoothstep(0.99945, 0.99978, moonDot);
    float moonHalo = pow(moonDot, 260.0) * 0.2 + pow(moonDot, 18.0) * 0.045;
    float moonShade = 0.9 + 0.1 * noise(dir.xz * 90.0);
    float moonVisibility = 1.0 - uOvercast * 0.9;
    color += mix(vec3(1.7, 1.58, 1.32), vec3(1.1, 1.18, 1.3), uNight) * moonDisc * moonShade * moonVisibility;
    color += mix(vec3(0.35, 0.43, 0.5), vec3(0.18, 0.25, 0.36), uNight) * moonHalo * moonVisibility;

    // Slight dithering prevents colour banding in the enormous sky gradient.
    float dither = (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
    color += dither;

    // Near and below the horizon the sky dissolves into the same haze as the
    // fog, so the far edge of the terrain never shows as a pale band.
    float haze = smoothstep(0.26, -0.06, dir.y);
    color = mix(color, uFogColor, haze * 0.96);

    gl_FragColor = vec4(color, 1.0);
  }
`;

function createSky(scene) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uNight: { value: 0 },
      uDay: { value: 0 },
      uOvercast: { value: 0 },
      uMoonDir: { value: new THREE.Vector3(0.33, 0.58, -0.73).normalize() },
      uSunDir: { value: new THREE.Vector3(-0.72, 0.12, -0.59).normalize() },
      uFogColor: { value: new THREE.Color(0x5b7071) },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const geometry = new THREE.SphereGeometry(260, 48, 32);
  const sky = new THREE.Mesh(geometry, material);
  sky.renderOrder = -100;
  sky.frustumCulled = false;
  scene.add(sky);
  return sky;
}

function createTerrain(scene, snowUniform) {
  // A denser grid than the rest of the scene needs, because the lake shoreline
  // is where the terrain crosses the water plane: coarse triangles there turn
  // a smooth bank into visible straight segments.
  const geometry = new THREE.PlaneGeometry(220, 220, 320, 320);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const colors = [];
  const color = new THREE.Color();
  const random = mulberry32(73);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = groundHeight(x, z);
    position.setY(i, y);
    const dist = Math.hypot(x, z);
    const patch = fbm(x * 0.12 + 5, z * 0.12 - 8, 3);
    const edge = THREE.MathUtils.smoothstep(dist, 7, 30);
    color.setHSL(
      0.105 + patch * 0.035,
      0.16 + patch * 0.09,
      0.18 + patch * 0.06 + (1 - edge) * 0.035
    );
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const groundTexture = makeGroundTexture(61);
  groundTexture.repeat.set(19, 19);
  const material = new THREE.MeshStandardMaterial({
    map: groundTexture,
    bumpMap: cloneLinearTexture(groundTexture),
    bumpScale: 0.06,
    roughness: 0.97,
    metalness: 0,
    vertexColors: true,
    envMapIntensity: 0.18,
  });
  const ground = new THREE.Mesh(geometry, material);
  ground.receiveShadow = true;
  ground.castShadow = false;
  ground.name = 'forest-floor';
  if (snowUniform) enableSnow(material, snowUniform);
  scene.add(ground);

  // A very low-detail apron hides the horizon seam beyond the detailed terrain.
  const farGeometry = new THREE.PlaneGeometry(700, 700, 24, 24);
  farGeometry.rotateX(-Math.PI / 2);
  const farPositions = farGeometry.attributes.position;
  for (let i = 0; i < farPositions.count; i++) {
    const x = farPositions.getX(i);
    const z = farPositions.getZ(i);
    farPositions.setY(i, groundHeight(x, z) - 0.6);
  }
  farGeometry.computeVertexNormals();
  const farMaterial = new THREE.MeshStandardMaterial({
    color: 0x28301f,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.06,
  });
  const farGround = new THREE.Mesh(farGeometry, farMaterial);
  farGround.receiveShadow = false;
  farGround.name = 'far-forest-floor';
  scene.add(farGround);
  return ground;
}

function createPathAlphaTexture() {
  const texture = canvasTexture(256, (ctx, w, h) => {
    const random = mulberry32(168);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.1, 'rgba(28,28,28,.4)');
    gradient.addColorStop(0.24, 'rgba(180,180,180,.9)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.76, 'rgba(180,180,180,.9)');
    gradient.addColorStop(0.9, 'rgba(28,28,28,.4)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const x = random() > 0.5 ? random() * w * 0.28 : w - random() * w * 0.28;
      const y = random() * h;
      const r = 2 + random() * 12;
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, { linear: true });
  texture.colorSpace = THREE.NoColorSpace;
  texture.repeat.set(1, 2.7);
  return texture;
}

function createPath(scene) {
  const curve = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(0.1, 0, 6.2),
      new THREE.Vector3(-0.6, 0, 6.9),
      new THREE.Vector3(-0.9, 0, 8.0),
      new THREE.Vector3(-0.2, 0, 9.0),
      new THREE.Vector3(1.4, 0, 9.6),
      new THREE.Vector3(3.2, 0, 9.8),
      new THREE.Vector3(5.2, 0, 9.9),
      new THREE.Vector3(7.0, 0, 9.9),
      new THREE.Vector3(8.4, 0, 9.9),
      new THREE.Vector3(9.0, 0, 9.9),
    ],
    false,
    'catmullrom',
    0.42
  );
  curve.arcLengthDivisions = 160;
  const segments = 150;
  const across = 7;
  const positions = [];
  const uvs = [];
  const indices = [];
  const random = mulberry32(91);
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, point);
    curve.getTangentAt(t, tangent);
    tangent.y = 0;
    tangent.normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const width = 1.38 + Math.sin(t * 10.2) * 0.22 + fbm(t * 12, 3.1, 3) * 0.42;
    for (let j = 0; j <= across; j++) {
      const acrossT = j / across;
      const offset = (acrossT - 0.5) * 2;
      const wobble = (fbm(t * 15 + j * 4.3, j * 1.7, 2) - 0.5) * 0.3;
      const x = point.x + side.x * (offset * width + wobble);
      const z = point.z + side.z * (offset * width + wobble);
      const y = groundHeight(x, z) + 0.045 + (1 - Math.abs(offset)) * 0.028;
      positions.push(x, y, z);
      uvs.push(acrossT, t);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < across; j++) {
      const a = i * (across + 1) + j;
      const b = a + 1;
      const c = a + across + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const map = makePathTexture(91);
  const bump = cloneLinearTexture(map);
  const alphaMap = createPathAlphaTexture();
  map.repeat.set(1.6, 9);
  bump.repeat.set(1.6, 9);
  const material = new THREE.MeshStandardMaterial({
    map,
    bumpMap: bump,
    bumpScale: 0.035,
    alphaMap,
    transparent: true,
    alphaTest: 0.12,
    depthWrite: true,
    roughness: 0.99,
    color: 0xd0c1a8,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const path = new THREE.Mesh(geometry, material);
  path.receiveShadow = true;
  path.castShadow = false;
  scene.add(path);
  return { mesh: path, curve };
}

function createGroundPools(scene) {
  const group = new THREE.Group();
  const pools = [
    { x: -2.0, z: 12.2, w: 5.4, h: 3.8, opacity: 0.13 },
    { x: 0.15, z: 8.3, w: 4.4, h: 3.2, opacity: 0.1 },
    { x: 0.05, z: 6.2, w: 3.5, h: 2.4, opacity: 0.07 },
  ];
  for (const pool of pools) {
    const material = new THREE.MeshBasicMaterial({
      map: makeGlowTexture(),
      color: 0xffb979,
      transparent: true,
      opacity: pool.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
      toneMapped: true,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pool.w, pool.h), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pool.x, groundHeight(pool.x, pool.z) + 0.065, pool.z);
    mesh.renderOrder = 1;
    group.add(mesh);
  }
  scene.add(group);
  return group;
}

function createMist(scene) {
  const texture = makeFogSheetTexture();
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  const group = new THREE.Group();
  const random = mulberry32(404);
  const sprites = [];
  for (let i = 0; i < 12; i++) {
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      color: i % 4 === 0 ? 0xc7c5b7 : 0xa7bac0,
      transparent: true,
      opacity: 0.08 + random() * 0.1,
      depthWrite: false,
      blending: THREE.NormalBlending,
      fog: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    const angle = -0.2 + (i / 12) * Math.PI * 1.4;
    const radius = 17 + random() * 26;
    sprite.position.set(
      Math.cos(angle) * radius + (random() - 0.5) * 8,
      2.2 + random() * 4.4,
      -Math.sin(angle) * radius - 6 + (random() - 0.5) * 4
    );
    sprite.scale.set(15 + random() * 22, 4.5 + random() * 5.5, 1);
    sprite.userData.baseX = sprite.position.x;
    sprite.userData.speed = 0.1 + random() * 0.16;
    sprite.userData.phase = random() * Math.PI * 2;
    group.add(sprite);
    sprites.push(sprite);
  }
  scene.add(group);
  return { group, sprites };
}

function createBackGlow(scene) {
  // Warm light leaking through the trees behind the cabin, like a vanishing sun.
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      color: 0xe5a069,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    })
  );
  glow.position.set(-30, 8, -38);
  glow.scale.set(54, 34, 1);
  scene.add(glow);
  return glow;
}

export const TIME_PRESETS = {
  day: {
    key: 'day',
    label: '白天',
    night: 0,
    day: 1,
    moonColor: 0xfff1d6,
    moonIntensity: 4.6,
    moonPosition: new THREE.Vector3(-28, 38, 26),
    fillColor: 0x9fc0d8,
    fillIntensity: 0.85,
    rimColor: 0xffd9a8,
    rimIntensity: 0.62,
    hemiSky: 0xa9c8dd,
    hemiGround: 0x5c5c44,
    hemiIntensity: 1.55,
    fogColor: 0xa9bcc0,
    fogDensity: 0.0092,
    exposure: 1.16,
    skySun: new THREE.Vector3(-0.55, 0.55, 0.62).normalize(),
    sunColor: 0xfff1d0,
    waterSky: new THREE.Color(0x63798a),
    waterHorizon: new THREE.Color(0x8b8d84),
    waterDeep: new THREE.Color(0x183238),
    waterShallow: new THREE.Color(0x36534f),
    waterSun: 1.15,
    lamp: 0.55,
    windowGlow: new THREE.Color(0.62, 0.44, 0.26),
    bloom: 0.24,
    stars: 0,
  },
  dusk: {
    key: 'dusk',
    label: '黄昏',
    night: 0,
    day: 0,
    moonColor: 0xb9d0dc,
    moonIntensity: 2.15,
    moonPosition: new THREE.Vector3(22, 34, -42),
    fillColor: 0x94adb8,
    fillIntensity: 0.64,
    rimColor: 0xdfae7b,
    rimIntensity: 0.64,
    hemiSky: 0x8fabb5,
    hemiGround: 0x2d3021,
    hemiIntensity: 0.88,
    fogColor: 0x5b7071,
    fogDensity: 0.0155,
    exposure: 1.16,
    skySun: new THREE.Vector3(-0.72, 0.12, -0.59).normalize(),
    sunColor: 0xffc18a,
    waterSky: new THREE.Color(0x3d5560),
    waterHorizon: new THREE.Color(0x6d6a60),
    waterDeep: new THREE.Color(0x0d1c21),
    waterShallow: new THREE.Color(0x243b3a),
    waterSun: 0.8,
    lamp: 1,
    windowGlow: new THREE.Color(1.72, 1.12, 0.6),
    bloom: 0.44,
    stars: 0.1,
  },
  night: {
    key: 'night',
    label: '夜晚',
    night: 1,
    day: 0,
    moonColor: 0x9fb9d6,
    moonIntensity: 1.35,
    moonPosition: new THREE.Vector3(26, 40, -30),
    fillColor: 0x6d8aa4,
    fillIntensity: 0.3,
    rimColor: 0x8f7a5c,
    rimIntensity: 0.22,
    hemiSky: 0x4f6578,
    hemiGround: 0x121810,
    hemiIntensity: 0.5,
    fogColor: 0x26383e,
    fogDensity: 0.0175,
    exposure: 0.98,
    skySun: new THREE.Vector3(0.33, 0.58, -0.73).normalize(),
    sunColor: 0xa8c4dd,
    waterSky: new THREE.Color(0x2f4658),
    waterHorizon: new THREE.Color(0x4b5c62),
    waterDeep: new THREE.Color(0x0c1a20),
    waterShallow: new THREE.Color(0x1d3338),
    waterSun: 0.5,
    lamp: 1.35,
    windowGlow: new THREE.Color(2.24, 1.42, 0.75),
    bloom: 0.57,
    stars: 1,
  },
};

export const WEATHER_PRESETS = {
  clear: {
    key: 'clear',
    label: '晴',
    rain: 0,
    snow: 0,
    overcast: 0,
    wind: 0.35,
    fogBoost: 0,
    mistOpacity: 1,
    exposureBoost: 0,
    snowCover: 0,
  },
  rain: {
    key: 'rain',
    label: '雨',
    rain: 1,
    snow: 0,
    overcast: 0.88,
    wind: 0.5,
    fogBoost: 0.009,
    mistOpacity: 1.9,
    exposureBoost: -0.1,
    snowCover: 0,
  },
  snow: {
    key: 'snow',
    label: '雪',
    rain: 0,
    snow: 1,
    overcast: 0.68,
    wind: 0.5,
    fogBoost: 0.006,
    mistOpacity: 0.8,
    exposureBoost: 0.05,
    snowCover: 1,
  },
};

export function createEnvironment(scene, renderer, { snowUniform } = {}) {
  scene.fog = new THREE.FogExp2(0x5b7071, 0.0155);
  scene.background = new THREE.Color(0x1b2b2d);
  scene.environment = createEnvironmentTexture(renderer);

  const sky = createSky(scene);
  const terrain = createTerrain(scene, snowUniform);
  const path = createPath(scene);
  const groundPools = createGroundPools(scene);
  const mist = createMist(scene);
  const backGlow = createBackGlow(scene);

  const sun = new THREE.DirectionalLight(0xb9d0dc, 2.15);
  sun.position.copy(TIME_PRESETS.dusk.moonPosition);
  sun.target.position.set(0, 1.8, 0);
  sun.castShadow = true;
  // 1024 with a tighter frustum keeps shadow detail where it matters (the
  // cabin clearing) while cutting the shadow pass cost by 4x.
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -22;
  sun.shadow.camera.right = 22;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 2.2;
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0x94adb8, 0.64);
  fill.position.set(-18, 12, 20);
  fill.target.position.set(0, 2, 0);
  scene.add(fill);
  scene.add(fill.target);

  const rim = new THREE.DirectionalLight(0xdfae7b, 0.64);
  rim.position.set(-32, 14, -28);
  rim.target.position.set(0, 2.5, 0);
  scene.add(rim);
  scene.add(rim.target);

  const hemi = new THREE.HemisphereLight(0x8fabb5, 0x2d3021, 0.88);
  scene.add(hemi);

  const state = {
    night: 0,
    day: 0,
    overcast: 0,
    rain: 0,
    snow: 0,
    wind: 0.35,
    timeKey: 'dusk',
    weatherKey: 'clear',
    lampFactor: 1,
    fogDensity: 0.0155,
  };

  const colorScratch = new THREE.Color();
  const current = {
    night: 0,
    day: 0,
    overcast: 0,
    rain: 0,
    snow: 0,
    wind: 0.35,
    exposure: 1.16,
    fogDensity: 0.0155,
    sunIntensity: 2.15,
    fillIntensity: 0.64,
    rimIntensity: 0.64,
    hemiIntensity: 0.88,
    lamp: 1,
    fogColor: new THREE.Color(0x5b7071),
    hemiSky: new THREE.Color(0x8fabb5),
    hemiGround: new THREE.Color(0x2d3021),
    sunColor: new THREE.Color(0xb9d0dc),
    fillColor: new THREE.Color(0x94adb8),
    rimColor: new THREE.Color(0xdfae7b),
    skySun: new THREE.Vector3(-0.72, 0.12, -0.59).normalize(),
    sunPosition: TIME_PRESETS.dusk.moonPosition.clone(),
    mist: 1,
  };

  const targets = {
    night: 0,
    day: 0,
    overcast: 0,
    rain: 0,
    snow: 0,
    wind: 0.35,
    exposure: 1.16,
    fogDensity: 0.0155,
    sunIntensity: 2.15,
    fillIntensity: 0.64,
    rimIntensity: 0.64,
    hemiIntensity: 0.88,
    lamp: 1,
    fogColor: new THREE.Color(0x5b7071),
    hemiSky: new THREE.Color(0x8fabb5),
    hemiGround: new THREE.Color(0x2d3021),
    sunColor: new THREE.Color(0xb9d0dc),
    fillColor: new THREE.Color(0x94adb8),
    rimColor: new THREE.Color(0xdfae7b),
    skySun: new THREE.Vector3(-0.72, 0.12, -0.59).normalize(),
    sunPosition: TIME_PRESETS.dusk.moonPosition.clone(),
    mist: 1,
  };

  function computeTargets() {
    const time = TIME_PRESETS[state.timeKey];
    const weather = WEATHER_PRESETS[state.weatherKey];
    const overcast = weather.overcast;
    const day = time.day;
    const night = time.night;

    targets.night = night;
    targets.day = day;
    targets.overcast = overcast;
    targets.rain = weather.rain;
    targets.snow = weather.snow;
    targets.wind = weather.wind;
    targets.lamp = time.lamp;
    targets.mist = weather.mistOpacity;

    targets.sunIntensity = time.moonIntensity * (1 - overcast * (day > 0.5 ? 0.72 : 0.42));
    targets.fillIntensity = time.fillIntensity * (1 - overcast * 0.2);
    targets.rimIntensity = time.rimIntensity * (1 - overcast * 0.5);
    targets.hemiIntensity = time.hemiIntensity * (1 - overcast * 0.1);
    targets.exposure = time.exposure + weather.exposureBoost;
    targets.fogDensity = time.fogDensity + weather.fogBoost;

    targets.sunColor.setHex(time.moonColor);
    targets.fillColor.setHex(time.fillColor);
    targets.rimColor.setHex(time.rimColor);
    targets.hemiSky.setHex(time.hemiSky);
    targets.hemiGround.setHex(time.hemiGround);
    targets.fogColor.setHex(time.fogColor);
    if (overcast > 0.4) {
      colorScratch.setHex(weather.snow > 0.5 ? 0x8d9aa2 : 0x5c6b70);
      targets.fogColor.lerp(colorScratch, overcast * (day > 0.5 ? 0.55 : 0.32));
    }
    targets.skySun.copy(time.skySun);
    targets.sunPosition.copy(time.moonPosition);
  }

  function lerpInto(target, key, value) {
    if (typeof value === 'number') {
      current[key] += (value - current[key]) * 0.035;
      return;
    }
    if (value.isColor) {
      current[key].lerp(value, 0.035);
      return;
    }
    if (value.isVector3) {
      current[key].lerp(value, 0.035);
    }
  }

  function updateTransitions() {
    lerpInto(targets, 'night', targets.night);
    lerpInto(targets, 'day', targets.day);
    lerpInto(targets, 'overcast', targets.overcast);
    lerpInto(targets, 'rain', targets.rain);
    lerpInto(targets, 'snow', targets.snow);
    lerpInto(targets, 'wind', targets.wind);
    lerpInto(targets, 'exposure', targets.exposure);
    lerpInto(targets, 'fogDensity', targets.fogDensity);
    lerpInto(targets, 'sunIntensity', targets.sunIntensity);
    lerpInto(targets, 'fillIntensity', targets.fillIntensity);
    lerpInto(targets, 'rimIntensity', targets.rimIntensity);
    lerpInto(targets, 'hemiIntensity', targets.hemiIntensity);
    lerpInto(targets, 'lamp', targets.lamp);
    lerpInto(targets, 'mist', targets.mist);
    lerpInto(targets, 'fogColor', targets.fogColor);
    lerpInto(targets, 'hemiSky', targets.hemiSky);
    lerpInto(targets, 'hemiGround', targets.hemiGround);
    lerpInto(targets, 'sunColor', targets.sunColor);
    lerpInto(targets, 'fillColor', targets.fillColor);
    lerpInto(targets, 'rimColor', targets.rimColor);
    lerpInto(targets, 'skySun', targets.skySun);
    lerpInto(targets, 'sunPosition', targets.sunPosition);

    state.night = current.night;
    state.day = current.day;
    state.overcast = current.overcast;
    state.rain = current.rain;
    state.snow = current.snow;
    state.wind = current.wind;
    state.lampFactor = current.lamp;
    state.fogDensity = current.fogDensity;

    sky.material.uniforms.uNight.value = current.night;
    sky.material.uniforms.uDay.value = current.day;
    sky.material.uniforms.uOvercast.value = current.overcast;
    sky.material.uniforms.uSunDir.value.copy(current.skySun);

    sun.color.copy(current.sunColor);
    sun.intensity = current.sunIntensity;
    sun.position.copy(current.sunPosition);

    fill.color.copy(current.fillColor);
    fill.intensity = current.fillIntensity;
    rim.color.copy(current.rimColor);
    rim.intensity = current.rimIntensity;
    hemi.color.copy(current.hemiSky);
    hemi.groundColor.copy(current.hemiGround);
    hemi.intensity = current.hemiIntensity;

    scene.fog.color.copy(current.fogColor);
    scene.fog.density = current.fogDensity;
    renderer.toneMappingExposure = current.exposure;

    if (snowUniform) snowUniform.value = current.snow;

    backGlow.material.opacity =
      0.12 * (1 - current.night * 0.78) * (1 - current.overcast * 0.7);
  }

  function update(time, delta) {
    updateTransitions();

    sky.position.copy(scene.userData.camera.position);
    sky.material.uniforms.uTime.value = time;
    sky.material.uniforms.uFogColor.value.copy(scene.fog.color);

    for (const sprite of mist.sprites) {
      sprite.position.x = sprite.userData.baseX + Math.sin(time * sprite.userData.speed + sprite.userData.phase) * 2.4;
      const base = 0.075 + Math.sin(time * 0.12 + sprite.userData.phase) * 0.02;
      sprite.material.opacity =
        base * (1 - current.night * 0.35) * current.mist * (1 - current.rain * 0.2);
    }
    backGlow.position.y = 8 + Math.sin(time * 0.03) * 0.3;
  }

  function setTime(key) {
    if (!TIME_PRESETS[key]) return;
    state.timeKey = key;
    computeTargets();
  }

  function setWeather(key) {
    if (!WEATHER_PRESETS[key]) return;
    state.weatherKey = key;
    computeTargets();
  }

  computeTargets();
  // Start settled on the initial preset rather than easing in from defaults.
  for (const key of Object.keys(targets)) {
    const target = targets[key];
    const value = current[key];
    if (typeof target === 'number') current[key] = target;
    else if (target.isColor || target.isVector3) value.copy(target);
  }
  updateTransitions();

  return {
    sky,
    terrain,
    path,
    sun,
    moon: sun,
    fill,
    rim,
    hemi,
    mist,
    update,
    setTime,
    setWeather,
    pathCurve: path.curve,
    state,
    preset: TIME_PRESETS[state.timeKey],
    presets: { time: TIME_PRESETS, weather: WEATHER_PRESETS },
  };
}
