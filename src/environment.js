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
    vec3 midDusk = vec3(0.22, 0.32, 0.35);
    vec3 midNight = vec3(0.032, 0.062, 0.091);
    vec3 horizonDusk = vec3(0.27, 0.29, 0.25);
    vec3 horizonNight = vec3(0.055, 0.09, 0.105);

    vec3 zenith = mix(zenithDusk, zenithNight, uNight);
    vec3 mid = mix(midDusk, midNight, uNight);
    vec3 horizonColor = mix(horizonDusk, horizonNight, uNight);
    vec3 color = mix(zenith, mid, smoothstep(0.0, 0.55, up));
    color = mix(color, horizonColor, horizon);

    // Last warm light lingering behind the trees.
    float sunDisc = max(dot(dir, uSunDir), 0.0);
    vec3 sunGlowColor = mix(vec3(1.0, 0.43, 0.17), vec3(0.12, 0.17, 0.22), uNight);
    color += sunGlowColor * (pow(sunDisc, 6.0) * 0.3 + pow(sunDisc, 48.0) * 0.5) * (1.0 - uNight * 0.86);

    // Clouds are subtle, broken streaks reflected in the fog.
    float az = atan(dir.z, dir.x);
    float el = asin(clamp(dir.y, -1.0, 1.0));
    vec2 cloudUV = vec2(az * 1.7 + uTime * 0.0017, el * 5.0 - uTime * 0.0006);
    float cloudField = fbm(cloudUV + fbm(cloudUV * 1.9 + 3.1) * 0.75);
    float clouds = smoothstep(0.48, 0.76, cloudField) * smoothstep(0.04, 0.22, up) * (1.0 - smoothstep(0.72, 0.95, up));
    vec3 cloudColor = mix(vec3(0.24, 0.28, 0.29), vec3(0.032, 0.047, 0.061), uNight);
    cloudColor += sunGlowColor * pow(sunDisc, 3.0) * 0.15;
    color = mix(color, cloudColor, clouds * 0.42);

    // Stars — quiet at dusk, clearer late at night.
    float starField = 0.0;
    if (dir.y > 0.02) {
      vec2 starUV = vec2(az * 52.0, el * 52.0);
      vec2 cell = floor(starUV);
      vec2 local = fract(starUV) - 0.5;
      float h = hash21(cell);
      float twinkle = 0.72 + 0.28 * sin(uTime * (0.8 + h * 2.2) + h * 31.0);
      starField = step(0.987, h) * smoothstep(0.11, 0.01, length(local)) * twinkle;
      starField *= smoothstep(0.02, 0.22, up) * (0.12 + uNight * 0.92);
      starField *= 1.0 - clouds * 0.8;
    }
    color += vec3(0.8, 0.88, 0.96) * starField * 0.9;

    // Moon disc and its soft atmospheric halo.
    float moonDot = max(dot(dir, uMoonDir), 0.0);
    float moonDisc = smoothstep(0.99945, 0.99978, moonDot);
    float moonHalo = pow(moonDot, 260.0) * 0.2 + pow(moonDot, 18.0) * 0.045;
    float moonShade = 0.9 + 0.1 * noise(dir.xz * 90.0);
    color += mix(vec3(1.7, 1.58, 1.32), vec3(1.1, 1.18, 1.3), uNight) * moonDisc * moonShade;
    color += mix(vec3(0.35, 0.43, 0.5), vec3(0.18, 0.25, 0.36), uNight) * moonHalo;

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

function createTerrain(scene) {
  const geometry = new THREE.PlaneGeometry(220, 220, 180, 180);
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
      new THREE.Vector3(-0.2, 0, 7.6),
      new THREE.Vector3(-1.15, 0, 9.8),
      new THREE.Vector3(-0.75, 0, 12.1),
      new THREE.Vector3(1.1, 0, 14.8),
      new THREE.Vector3(1.6, 0, 17.5),
      new THREE.Vector3(0.65, 0, 21.0),
      new THREE.Vector3(2.4, 0, 25.5),
      new THREE.Vector3(1.3, 0, 30.0),
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

export function createEnvironment(scene, renderer) {
  scene.fog = new THREE.FogExp2(0x5b7071, 0.0155);
  scene.background = new THREE.Color(0x1b2b2d);
  scene.environment = createEnvironmentTexture(renderer);

  const sky = createSky(scene);
  const terrain = createTerrain(scene);
  const path = createPath(scene);
  const groundPools = createGroundPools(scene);
  const mist = createMist(scene);
  const backGlow = createBackGlow(scene);

  const moon = new THREE.DirectionalLight(0xb9d0dc, 2.15);
  moon.position.set(22, 34, -42);
  moon.target.position.set(0, 1.8, 0);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -25;
  moon.shadow.camera.right = 25;
  moon.shadow.camera.top = 25;
  moon.shadow.camera.bottom = -25;
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 90;
  moon.shadow.bias = -0.00035;
  moon.shadow.normalBias = 0.035;
  moon.shadow.radius = 2.2;
  scene.add(moon);
  scene.add(moon.target);

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
  };

  const duskFog = new THREE.Color(0x5b7071);
  const nightFog = new THREE.Color(0x26383e);
  const duskHemiSky = new THREE.Color(0x8fabb5);
  const nightHemiSky = new THREE.Color(0x4f6578);
  const duskHemiGround = new THREE.Color(0x2b2d20);
  const nightHemiGround = new THREE.Color(0x121810);

  function update(time, delta) {
    sky.position.copy(scene.userData.camera.position);
    sky.material.uniforms.uTime.value = time;
    sky.material.uniforms.uNight.value = state.night;
    sky.material.uniforms.uFogColor.value.copy(scene.fog.color);

    for (const sprite of mist.sprites) {
      sprite.position.x = sprite.userData.baseX + Math.sin(time * sprite.userData.speed + sprite.userData.phase) * 2.4;
      sprite.material.opacity =
        (0.075 + Math.sin(time * 0.12 + sprite.userData.phase) * 0.02) * (1 - state.night * 0.35);
    }
    backGlow.material.opacity = 0.12 * (1 - state.night * 0.78);
    backGlow.position.y = 8 + Math.sin(time * 0.03) * 0.3;

    const night = state.night;
    moon.intensity = 2.15 - night * 0.62;
    fill.intensity = 0.64 - night * 0.28;
    rim.intensity = 0.64 - night * 0.34;
    hemi.intensity = 0.88 - night * 0.38;
    hemi.color.copy(duskHemiSky).lerp(nightHemiSky, night);
    hemi.groundColor.copy(duskHemiGround).lerp(nightHemiGround, night);
    scene.fog.color.copy(duskFog).lerp(nightFog, night);
    scene.fog.density = 0.0155 + night * 0.002;
    renderer.toneMappingExposure = 1.16 - night * 0.18;
  }

  function setNight(value) {
    state.night = value;
  }

  return {
    sky,
    terrain,
    path,
    moon,
    fill,
    rim,
    hemi,
    mist,
    update,
    setNight,
    pathCurve: path.curve,
    state,
  };
}
