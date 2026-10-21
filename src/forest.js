import * as THREE from 'three';
import {
  mulberry32,
  fbm,
  groundHeight,
  makeWoodTexture,
  makeStoneTexture,
  makeSmokeTexture,
  makePineBoughTexture,
  createPineBoughGeometry,
  createLeafClusterGeometry,
  createBladeGeometry,
  createFernGeometry,
  createGroundLeafGeometry,
  makeStoneGeometry,
  mergeStaticMeshes,
  lakeField,
  enableSnow,
} from './utils.js';

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

class InstanceBatch {
  constructor() {
    this.matrices = [];
    this.colors = [];
  }

  add(matrix, color) {
    this.matrices.push(matrix.clone());
    this.colors.push(color ? color.clone() : null);
  }

  build(geometry, material, { castShadow = true, receiveShadow = true, name = '' } = {}) {
    const count = this.matrices.length;
    if (count === 0) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    for (let i = 0; i < count; i++) {
      mesh.setMatrixAt(i, this.matrices[i]);
      if (this.colors[i]) mesh.setColorAt(i, this.colors[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.frustumCulled = false;
    mesh.name = name;
    return mesh;
  }
}

const tempMatrix = new THREE.Matrix4();
const tempQuat = new THREE.Quaternion();
const tempPos = new THREE.Vector3();
const tempScale = new THREE.Vector3();
const upVec = new THREE.Vector3(0, 1, 0);
const xVec = new THREE.Vector3(1, 0, 0);

function composeMatrix(position, quaternion, scale) {
  return tempMatrix.compose(position, quaternion, scale);
}

function addWind(material, timeUniform, kind = 'leaves') {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = timeUniform;
    shader.vertexShader = `uniform float uWindTime;\n${shader.vertexShader}`;
    if (kind === 'frond') {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 iOrigin = vec3(0.0);
        #endif
        float phase = uWindTime * 0.48 + iOrigin.x * 0.21 + iOrigin.z * 0.16;
        float flex = clamp(position.x, 0.0, 1.4);
        transformed.y += sin(phase + position.x * 1.7) * 0.032 * flex;
        transformed.z += cos(phase * 0.83 + position.x) * 0.022 * flex;
        `
      );
    } else if (kind === 'grass') {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 iOrigin = vec3(0.0);
        #endif
        float phase = uWindTime * 1.1 + iOrigin.x * 0.73 + iOrigin.z * 0.51;
        float flex = smoothstep(0.0, 0.75, position.y);
        transformed.x += sin(phase) * 0.085 * flex;
        transformed.z += cos(phase * 0.87 + 1.4) * 0.05 * flex;
        `
      );
    } else if (kind === 'fern') {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 iOrigin = vec3(0.0);
        #endif
        float phase = uWindTime * 0.75 + iOrigin.x * 0.5 + iOrigin.z * 0.4;
        float flex = clamp(position.y, 0.0, 0.8);
        transformed.x += sin(phase + position.x * 2.0) * 0.065 * flex;
        transformed.z += cos(phase * 0.9 + position.z * 2.0) * 0.04 * flex;
        `
      );
    } else {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 iOrigin = vec3(0.0);
        #endif
        float phase = uWindTime * 0.5 + iOrigin.x * 0.32 + iOrigin.z * 0.27;
        float localFlex = clamp(position.y * 0.32 + 0.55, 0.0, 1.0);
        transformed.x += sin(phase + position.z * 0.8) * 0.035 * localFlex;
        transformed.z += cos(phase * 0.8 + position.x * 0.8) * 0.024 * localFlex;
        `
      );
    }
    material.userData.shader = shader;
  };
  material.customProgramCacheKey = () => `wind-${kind}`;
}

/* ------------------------------------------------------------------ *
 * Forest generation
 * ------------------------------------------------------------------ */

const AUTUMN_PALETTES = [
  ['#b87939', '#d29b4e', '#996331', '#78552f', '#c9853b'],
  ['#a95f33', '#c48643', '#85522f', '#d0a058', '#6b4e31'],
  ['#7d7c3e', '#9b8b45', '#666c37', '#b29a52', '#53602f'],
  ['#b36f34', '#d1a452', '#8b5d32', '#9f7a3a', '#c68b42'],
];

function createForestFloorDetails(scene, pathSamples, timeUniform) {
  const group = new THREE.Group();
  group.name = 'forest-floor-details';
  const random = mulberry32(1207);
  const stoneTexture = makeStoneTexture(44);
  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x8b877b,
    map: stoneTexture,
    roughness: 0.98,
    envMapIntensity: 0.16,
  });
  const mossMat = new THREE.MeshStandardMaterial({ color: 0x42522e, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.88,
    side: THREE.DoubleSide,
    envMapIntensity: 0.25,
  });
  const leafGeo = createGroundLeafGeometry();
  const stoneGeo = makeStoneGeometry(14);

  function distanceToPath(x, z) {
    let best = Infinity;
    for (const p of pathSamples) {
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  function blockedByLake(x, z, margin = 1.24) {
    return lakeField(x, z) < margin;
  }

  // Fine grass tufts.
  const grassGeo = createBladeGeometry();
  const grassMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    side: THREE.DoubleSide,
    vertexColors: false,
    envMapIntensity: 0.2,
  });
  addWind(grassMat, timeUniform, 'grass');
  const grassBatch = new InstanceBatch();
  const grassColor = new THREE.Color();
  let attempts = 0;
  while (grassBatch.matrices.length < 3900 && attempts < 22000) {
    attempts++;
    const angle = random() * Math.PI * 2;
    const radius = 5.2 + Math.pow(random(), 0.68) * 32;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (Math.abs(x) < 5.1 && Math.abs(z) < 4.3) continue;
    const pathDist = distanceToPath(x, z);
    if (pathDist < 1.1) continue;
    if (blockedByLake(x, z, 1.3)) continue;
    if (z > 4 && z < 22 && Math.abs(x - z * 0.47) < 2.2) continue;
    const y = groundHeight(x, z);
    let s = 0.42 + random() * 0.64;
    if (z > 15) s *= 0.82;
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler((random() - 0.5) * 0.1, random() * Math.PI * 2, (random() - 0.5) * 0.12)
    );
    composeMatrix(
      new THREE.Vector3(x, y - 0.015, z),
      q,
      new THREE.Vector3(s * (0.85 + random() * 0.3), s, s * (0.85 + random() * 0.3))
    );
    grassColor.setHSL(0.19 + random() * 0.07, 0.17 + random() * 0.13, 0.15 + random() * 0.11);
    if (random() < 0.17) grassColor.setHSL(0.09 + random() * 0.03, 0.24, 0.19 + random() * 0.07);
    grassBatch.add(tempMatrix, grassColor);
  }
  const grass = grassBatch.build(grassGeo, grassMat, { castShadow: false, name: 'grass' });
  group.add(grass);

  // Ferns.
  const fernGeo = createFernGeometry(9);
  const fernMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.9,
    side: THREE.DoubleSide,
    envMapIntensity: 0.24,
  });
  addWind(fernMat, timeUniform, 'fern');
  const fernBatch = new InstanceBatch();
  const fernAnchors = [
    [-7.6, 11.1], [-5.8, 9.8], [4.4, 6.2], [6.3, 4.4], [-9.6, 4.8],
    [8.8, 10.2], [-3.2, 14.8], [3.8, 12.1], [-11.2, 14.6], [11.5, 7.4],
  ];
  for (const [ax, az] of fernAnchors) {
    const count = 4 + Math.floor(random() * 5);
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2;
      const r = random() * 1.35;
      const x = ax + Math.cos(a) * r;
      const z = az + Math.sin(a) * r;
      if (distanceToPath(x, z) < 0.9) continue;
      if (blockedByLake(x, z, 1.34)) continue;
      const p = new THREE.Vector3(x, groundHeight(x, z) - 0.02, z);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, random() * Math.PI * 2, 0));
      const s = 0.65 + random() * 0.75;
      fernBatch.add(
        composeMatrix(p, q, new THREE.Vector3(s, s * (0.8 + random() * 0.4), s)),
        random() < 0.18
          ? new THREE.Color().setHSL(0.1 + random() * 0.04, 0.38, 0.25 + random() * 0.09)
          : new THREE.Color().setHSL(0.26 + random() * 0.035, 0.25, 0.2 + random() * 0.08)
      );
    }
  }
  for (let i = 0; i < 65; i++) {
    const a = random() * Math.PI * 2;
    const r = 7 + random() * 24;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (distanceToPath(x, z) < 1.0) continue;
    if (Math.abs(x) < 5 && Math.abs(z) < 4.1) continue;
    if (blockedByLake(x, z, 1.32)) continue;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, random() * Math.PI * 2, 0));
    const s = 0.4 + random() * 0.5;
    fernBatch.add(
      composeMatrix(new THREE.Vector3(x, groundHeight(x, z) - 0.02, z), q, new THREE.Vector3(s, s, s)),
      new THREE.Color().setHSL(0.25 + random() * 0.04, 0.25, 0.16 + random() * 0.08)
    );
  }
  const ferns = fernBatch.build(fernGeo, fernMat, { castShadow: false, name: 'ferns' });
  group.add(ferns);

  // Path-edge rocks and a handful of larger boulders.
  const rockBatch = new InstanceBatch();
  const rockColor = new THREE.Color();
  for (let i = 0; i < 52; i++) {
    const p = pathSamples[Math.floor(random() * pathSamples.length)];
    const tangentIndex = Math.min(pathSamples.length - 1, Math.floor(random() * pathSamples.length));
    const tangent = pathSamples[Math.min(pathSamples.length - 1, tangentIndex + 1)].clone().sub(pathSamples[tangentIndex]).normalize();
    if (!Number.isFinite(tangent.x) || tangent.lengthSq() < 0.001) tangent.set(0, 0, 1);
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const fromPath = (i % 3 === 0 ? -1 : 1) * (0.85 + random() * 1.8);
    const x = p.x + side.x * fromPath + (random() - 0.5) * 0.6;
    const z = p.z + side.z * fromPath + (random() - 0.5) * 0.6;
    const s = 0.1 + random() * (i % 7 === 0 ? 0.36 : 0.15);
    const y = groundHeight(x, z);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * 0.4, random() * 6.2, random() * 0.3));
    rockBatch.add(
      composeMatrix(new THREE.Vector3(x, y + s * 0.15, z), q, new THREE.Vector3(s * 1.2, s * 0.55, s * 0.9)),
      rockColor.setHSL(0.1, 0.05 + random() * 0.05, 0.27 + random() * 0.16)
    );
  }
  for (let i = 0; i < 24; i++) {
    const a = random() * Math.PI * 2;
    const r = 10 + random() * 25;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (distanceToPath(x, z) < 1.6) continue;
    if (Math.abs(x) < 5 && Math.abs(z) < 4.1) continue;
    if (blockedByLake(x, z, 1.28)) continue;
    const s = 0.2 + random() * 0.55;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * 0.5, random() * 6, random() * 0.5));
    rockBatch.add(
      composeMatrix(
        new THREE.Vector3(x, groundHeight(x, z) + s * 0.18, z),
        q,
        new THREE.Vector3(s * (1.1 + random() * 0.7), s * 0.7, s)
      ),
      rockColor.setHSL(0.1, 0.045, 0.22 + random() * 0.15)
    );
  }
  group.add(rockBatch.build(stoneGeo, stoneMat, { name: 'rocks' }));

  // Smooth stepping stones set into the dirt path.
  const steppingBatch = new InstanceBatch();
  const pathCount = pathSamples.length;
  for (let i = 3; i < pathCount - 2; i += 3) {
    if (random() < 0.16) continue;
    const p = pathSamples[i];
    const tangent = pathSamples[Math.min(pathCount - 1, i + 1)].clone().sub(pathSamples[i - 1]).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const offset = (random() - 0.5) * 0.65;
    const x = p.x + side.x * offset;
    const z = p.z + side.z * offset;
    const s = 0.22 + random() * 0.2;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, random() * 6.2, 0));
    steppingBatch.add(
      composeMatrix(
        new THREE.Vector3(x, groundHeight(x, z) + 0.11, z),
        q,
        new THREE.Vector3(s * 1.2, s * 0.26, s * 0.85)
      ),
      rockColor.setHSL(0.105, 0.055, 0.24 + random() * 0.12)
    );
  }
  group.add(steppingBatch.build(stoneGeo, stoneMat, { castShadow: false, name: 'stepping-stones' }));

  // Fallen leaves: concentrated under the autumn trees, plus windblown trail litter.
  const autumnAnchors = [
    [-8.2, 8.4], [10.2, 2.6], [-14.6, -4], [15.8, -3], [-16, 9], [20, 7],
  ];
  const fallenBatch = new InstanceBatch();
  const leafColor = new THREE.Color();
  for (let i = 0; i < 900; i++) {
    let x;
    let z;
    if (i < 520) {
      const anchor = autumnAnchors[Math.floor(random() * autumnAnchors.length)];
      const a = random() * Math.PI * 2;
      const r = Math.pow(random(), 0.65) * 7;
      x = anchor[0] + Math.cos(a) * r;
      z = anchor[1] + Math.sin(a) * r;
    } else if (i < 710) {
      const p = pathSamples[Math.floor(random() * pathSamples.length)];
      x = p.x + (random() - 0.5) * 7.5;
      z = p.z + (random() - 0.5) * 2.8;
    } else {
      const a = random() * Math.PI * 2;
      const r = 5 + random() * 28;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
    }
    if (Math.abs(x) < 4.5 && Math.abs(z) < 3.9) continue;
    if (blockedByLake(x, z, 1.24)) continue;
    const s = 0.1 + random() * 0.16;
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler((random() - 0.5) * 0.22, random() * Math.PI * 2, (random() - 0.5) * 0.2)
    );
    const palette = AUTUMN_PALETTES[Math.floor(random() * AUTUMN_PALETTES.length)];
    leafColor.set(palette[Math.floor(random() * palette.length)]);
    leafColor.offsetHSL((random() - 0.5) * 0.02, 0, (random() - 0.5) * 0.08);
    fallenBatch.add(
      composeMatrix(new THREE.Vector3(x, groundHeight(x, z) + 0.045, z), q, new THREE.Vector3(s, s, s)),
      leafColor
    );
  }
  group.add(fallenBatch.build(leafGeo, leafMat, { castShadow: false, name: 'fallen-leaves' }));

  // Logs, stumps and moss.
  const bark = makeWoodTexture(62, 'dark');
  bark.repeat.set(2, 5);
  const barkMat = new THREE.MeshStandardMaterial({
    color: 0x5d4734,
    map: bark,
    bumpMap: (() => {
      const t = bark.clone();
      t.colorSpace = THREE.NoColorSpace;
      t.needsUpdate = true;
      return t;
    })(),
    bumpScale: 0.05,
    roughness: 0.98,
  });
  const endMat = new THREE.MeshStandardMaterial({ color: 0x8d7653, roughness: 0.9 });
  const logSpecs = [
    { x: -7.0, z: 12.2, rot: 0.55, len: 3.4, r: 0.3 },
    { x: 11.8, z: 0.8, rot: 1.2, len: 2.8, r: 0.25 },
    { x: -10.4, z: -1.0, rot: -0.4, len: 4.0, r: 0.34 },
    { x: 6.2, z: 11.4, rot: 2.4, len: 2.5, r: 0.2 },
  ];
  const logGroups = [];
  for (const spec of logSpecs) {
    const y = groundHeight(spec.x, spec.z);
    const log = new THREE.Mesh(new THREE.CylinderGeometry(spec.r, spec.r * 0.9, spec.len, 12), [barkMat, endMat, endMat]);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = spec.rot;
    log.position.set(spec.x, y + spec.r * 0.82, spec.z);
    log.castShadow = true;
    log.receiveShadow = true;
    group.add(log);
    logGroups.push({ ...spec, y });
    for (let m = 0; m < 7; m++) {
      const moss = new THREE.Mesh(
        new THREE.SphereGeometry(0.12 + random() * 0.2, 6, 4, 0, Math.PI * 2, 0, Math.PI * 0.5),
        mossMat
      );
      const t = (random() - 0.5) * spec.len;
      moss.position.set(
        spec.x + Math.cos(spec.rot) * t,
        y + spec.r * 1.55 + random() * 0.04,
        spec.z - Math.sin(spec.rot) * t
      );
      moss.scale.set(1.2 + random(), 0.28, 1 + random());
      moss.rotation.y = random() * Math.PI;
      moss.castShadow = true;
      group.add(moss);
    }
  }

  // Stumps.
  for (const [x, z, s] of [[9.7, 8.1, 0.42], [-12.2, 6.4, 0.34], [5.9, -3.6, 0.3]]) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(s, s * 1.13, s * 1.5, 10), [barkMat, endMat, endMat]);
    mesh.position.set(x, groundHeight(x, z) + s * 0.7, z);
    mesh.rotation.y = random() * 3;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Mushroom rings near the logs.
  const stemGeo = new THREE.CylinderGeometry(0.02, 0.028, 1, 6);
  stemGeo.translate(0, 0.5, 0);
  const capGeo = new THREE.SphereGeometry(1, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const capMats = [
    new THREE.MeshStandardMaterial({ color: 0xb8a379, roughness: 0.75 }),
    new THREE.MeshStandardMaterial({ color: 0x8f4d36, roughness: 0.7 }),
    new THREE.MeshStandardMaterial({ color: 0xc1b48d, roughness: 0.8 }),
  ];
  for (const log of logGroups.slice(0, 2)) {
    const count = 6 + Math.floor(random() * 6);
    for (let i = 0; i < count; i++) {
      const t = (random() - 0.5) * log.len * 0.8;
      const bx = log.x + Math.cos(log.rot) * t + (random() - 0.5) * 0.5;
      const bz = log.z - Math.sin(log.rot) * t + (random() - 0.5) * 0.5;
      const h = 0.07 + random() * 0.19;
      const by = groundHeight(bx, bz);
      const stem = new THREE.Mesh(stemGeo, capMats[0]);
      stem.position.set(bx, by, bz);
      stem.scale.set(1, h, 1);
      group.add(stem);
      const cap = new THREE.Mesh(capGeo, capMats[Math.floor(random() * capMats.length)]);
      cap.position.set(bx, by + h, bz);
      cap.scale.set(0.065 + random() * 0.08, 0.045 + random() * 0.04, 0.065 + random() * 0.08);
      cap.castShadow = true;
      group.add(cap);
    }
  }

  mergeStaticMeshes(group);
  scene.add(group);
  return group;
}

/* ------------------------------------------------------------------ *
 * Trees
 * ------------------------------------------------------------------ */
function createTrees(scene, timeUniform, pathSamples) {
  const random = mulberry32(8721);
  const group = new THREE.Group();
  group.name = 'forest';

  const blockedByLake = (x, z, margin = 1.45) => lakeField(x, z) < margin;

  const barkMap = makeWoodTexture(24, 'dark');
  barkMap.repeat.set(1.3, 4.5);
  const barkBump = barkMap.clone();
  barkBump.colorSpace = THREE.NoColorSpace;
  barkBump.needsUpdate = true;
  const barkMat = new THREE.MeshStandardMaterial({
    color: 0x70604b,
    map: barkMap,
    bumpMap: barkBump,
    bumpScale: 0.045,
    roughness: 0.96,
    envMapIntensity: 0.15,
  });
  const trunkGeo = new THREE.CylinderGeometry(0.4, 1, 1, 9, 1);
  trunkGeo.translate(0, 0.5, 0);
  const frondGeo = new THREE.ConeGeometry(0.5, 1, 6, 1, false);
  frondGeo.translate(0, 0.5, 0);
  frondGeo.rotateZ(-Math.PI / 2);
  const cardGeo = createPineBoughGeometry(0.29);
  const pineTexture = makePineBoughTexture(17);

  const pineMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
    alphaTest: 0.14,
    alphaToCoverage: true,
    map: pineTexture,
    envMapIntensity: 0.18,
  });
  addWind(pineMat, timeUniform, 'frond');

  const farPineMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.94,
    metalness: 0,
    flatShading: true,
    envMapIntensity: 0.14,
  });
  addWind(farPineMat, timeUniform, 'frond');

  const leafGeo = createLeafClusterGeometry(6);
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.88,
    flatShading: true,
    envMapIntensity: 0.22,
  });
  addWind(leafMat, timeUniform, 'leaves');

  const leafCardGeo = createGroundLeafGeometry();
  const leafCardMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.82,
    side: THREE.DoubleSide,
    envMapIntensity: 0.25,
  });

  const trunkBatch = new InstanceBatch();
  const pineBatch = new InstanceBatch();
  const farPineBatch = new InstanceBatch();
  const leafBatch = new InstanceBatch();
  const cardBatch = new InstanceBatch();
  const trunkColor = new THREE.Color();
  const leafColor = new THREE.Color();

  const pineData = [];

  const curatedPines = [
    [-8.7, -4.6, 21.5, 0.36, 1],
    [7.8, -8.1, 24, 0.42, 2],
    [-13.1, 1.6, 19, 0.34, 3],
    [14.1, 1.2, 22, 0.38, 4],
    [-14.9, 13.1, 18, 0.3, 5],
    [17.5, 10.6, 20, 0.35, 6],
    [-18.6, 12.2, 23, 0.39, 7],
    [20.2, 15.1, 19, 0.33, 8],
    [-5.6, -18.6, 27, 0.46, 9],
    [4.4, -20.4, 29, 0.48, 10],
    [-20.4, -8.3, 21, 0.35, 11],
    [18.3, -11.2, 25, 0.4, 12],
    [-26, 23, 24, 0.38, 13],
    [27, 22, 23, 0.37, 14],
    [3.7, -31, 32, 0.5, 15],
    [-11.8, -28, 30, 0.47, 16],
    [13.8, -27, 31, 0.48, 17],
    [-26, 0.5, 27, 0.42, 18],
    [28, 5.2, 28, 0.43, 19],
  ];
  for (const p of curatedPines) {
    pineData.push({
      x: p[0],
      z: p[1],
      h: p[2],
      r: p[3],
      seed: p[4],
      far: Math.hypot(p[0], p[1]) > 34,
    });
  }

  function blockedForTree(x, z) {
    if (Math.abs(x) < 5.6 && Math.abs(z) < 4.9) return true;
    if (Math.hypot(x - 9, z - 19) < 4.2) return true;
    // Keep the lake and a generous shoreline clearing free of trunks.
    if (lakeField(x, z) < 1.55) return true;
    // Keep the raised camera position clear so its view is never inside a crown.
    if (Math.hypot(x - 9.8, z - 35.0) < 11) return true;
    for (const p of pathSamples) {
      if ((p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < 3.4 * 3.4) return true;
    }
    return false;
  }

  let attempts = 0;
  while (pineData.length < 60 && attempts < 1000) {
    attempts++;
    const angle = random() * Math.PI * 2;
    const radius = 12 + Math.pow(random(), 0.68) * 25;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius - 2;
    if (blockedForTree(x, z)) continue;
    const h = 15 + random() * 11;
    if (pineData.some((p) => Math.hypot(p.x - x, p.z - z) < 3.2)) continue;
    pineData.push({
      x,
      z,
      h,
      r: 0.25 + random() * 0.17,
      seed: random() * 1000,
      far: Math.hypot(x, z) > 34,
    });
  }
  // Far treeline: thinned out (they sit deep in fog and the extra instances
  // cost triangles without adding visible detail).
  for (let i = 0; i < 88; i++) {
    const angle = random() * Math.PI * 2;
    const radius = 34 + random() * 34;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius - 3;
    if (Math.abs(x - z * 0.47) < 6 && z > 0) continue;
    // Leave the camera's raised vantage and its sightline to the cabin open.
    if (Math.hypot(x - 9.8, z - 35.0) < 15) continue;
    pineData.push({
      x,
      z,
      h: 16 + random() * 16,
      r: 0.3 + random() * 0.2,
      seed: random() * 1000,
      far: false,
    });
  }

  // The far bank opposite the cabin reads as an open field; fill it with a
  // denser stand so the lake is enclosed by forest rather than empty lawn.
  for (let i = 0; i < 70; i++) {
    const angle = -1.15 + random() * 1.5;
    const radius = 24 + random() * 26;
    const x = Math.cos(angle) * radius * 0.9;
    const z = Math.sin(angle) * radius - 2;
    if (lakeField(x, z) < 1.45) continue;
    if (Math.hypot(x - 9.8, z - 35.0) < 14) continue;
    pineData.push({
      x,
      z,
      h: 14 + random() * 13,
      r: 0.24 + random() * 0.16,
      seed: random() * 1000,
      far: false,
    });
  }

  for (const pine of pineData) {
    const rnd = mulberry32(Math.floor(pine.seed * 917 + 13));
    const baseY = groundHeight(pine.x, pine.z);
    const leanX = (rnd() - 0.5) * 0.035;
    const leanZ = (rnd() - 0.5) * 0.035;
    tempQuat.setFromEuler(new THREE.Euler(leanZ, rnd() * Math.PI, -leanX));
    trunkColor.setHSL(0.085 + rnd() * 0.025, 0.15, 0.21 + rnd() * 0.08);
    trunkBatch.add(
      composeMatrix(
        new THREE.Vector3(pine.x, baseY - 0.2, pine.z),
        tempQuat,
        new THREE.Vector3(pine.r, pine.h + 0.5, pine.r)
      ),
      trunkColor
    );

    const branchStart = pine.h * (0.16 + rnd() * 0.05);
    // Distant pines keep a slightly lighter crown, but not so light that the
    // treeline reads as a different, coarser species behind the inner forest.
    const tiers = pine.far ? 10 + Math.floor(rnd() * 3) : 13 + Math.floor(rnd() * 4);
    const maxRadius = pine.h * (0.15 + rnd() * 0.038);
    for (let tier = 0; tier < tiers; tier++) {
      const t = tier / (tiers - 1);
      const y = baseY + branchStart + (t * (pine.h - branchStart - 1.05));
      const canopyRadius = maxRadius * Math.pow(1 - t * 0.94, 0.88) * (0.85 + rnd() * 0.42);
      const fronds = pine.far ? 7 + Math.round((1 - t) * 3) : 9 + Math.round((1 - t) * 3);
      const baseAngle = rnd() * Math.PI * 2 + tier * 0.55;
      for (let i = 0; i < fronds; i++) {
        const a = baseAngle + (i / fronds) * Math.PI * 2 + (rnd() - 0.5) * 0.32;
        const pitch = 0.07 + rnd() * 0.16 + t * 0.05;
        const len = canopyRadius * (0.84 + rnd() * 0.36);
        const dir = new THREE.Vector3(
          Math.cos(a) * Math.cos(pitch),
          -Math.sin(pitch),
          Math.sin(a) * Math.cos(pitch)
        );
        tempQuat.setFromUnitVectors(xVec, dir);
        const roll = new THREE.Quaternion().setFromAxisAngle(xVec, rnd() * Math.PI);
        tempQuat.multiply(roll);
        const origin = new THREE.Vector3(
          pine.x + dir.x * pine.r * 0.55,
          y + (rnd() - 0.5) * 0.22,
          pine.z + dir.z * pine.r * 0.55
        );
        if (pine.far) {
          // Distant pines keep the cheap cone frond — but a "far" tree can end
          // up close to the camera, so the ones near the frame use the detailed
          // needle cards just like the inner forest.
          const near = Math.hypot(pine.x - 9.8, pine.z - 35.0) < 46 || Math.hypot(pine.x, pine.z) < 30;
          if (near) {
            pineBatch.add(
              composeMatrix(origin, tempQuat, new THREE.Vector3(len, len, len)),
              leafColor.setHSL(
                0.29 + rnd() * 0.075,
                0.2 + rnd() * 0.16,
                0.5 + rnd() * 0.22 - t * 0.03
              )
            );
          } else {
            const thick = len * (0.2 + rnd() * 0.12);
            farPineBatch.add(
              composeMatrix(origin, tempQuat, new THREE.Vector3(len, thick * 0.6, thick)),
              leafColor.setHSL(
                0.32 + rnd() * 0.045,
                0.22 + rnd() * 0.12,
                0.15 + rnd() * 0.08 - t * 0.02
              )
            );
          }
        } else {
          pineBatch.add(
            composeMatrix(origin, tempQuat, new THREE.Vector3(len, len, len)),
            leafColor.setHSL(
              0.29 + rnd() * 0.075,
              0.2 + rnd() * 0.16,
              0.54 + rnd() * 0.24 - t * 0.03
            )
          );
        }
      }
      // Two shorter interior boughs break up the whorled symmetry and give
      // the crown a little more body when seen against the fog.
      if (!pine.far && tier < tiers - 2) {
        for (let i = 0; i < 2; i++) {
          const a = baseAngle + (i === 0 ? 0.58 : 2.14) + (rnd() - 0.5) * 0.4;
          const pitch = 0.26 + rnd() * 0.18;
          const len = canopyRadius * (0.4 + rnd() * 0.18);
          const dir = new THREE.Vector3(
            Math.cos(a) * Math.cos(pitch),
            -Math.sin(pitch),
            Math.sin(a) * Math.cos(pitch)
          );
          tempQuat.setFromUnitVectors(xVec, dir);
          pineBatch.add(
            composeMatrix(
              new THREE.Vector3(pine.x, y + (rnd() - 0.5) * 0.28, pine.z),
              tempQuat,
              new THREE.Vector3(len, len, len)
            ),
            leafColor.setHSL(0.31 + rnd() * 0.04, 0.2, 0.38 + rnd() * 0.16)
          );
        }
      }
    }
    // A little tuft at the top so the silhouette ends in needles, not a bare pole.
    for (let i = 0; i < 4; i++) {
      const a = rnd() * 6.2;
      const dir = new THREE.Vector3(Math.cos(a) * 0.55, 0.35, Math.sin(a) * 0.55).normalize();
      tempQuat.setFromUnitVectors(xVec, dir);
      if (pine.far) {
        const near = Math.hypot(pine.x - 9.8, pine.z - 35.0) < 46 || Math.hypot(pine.x, pine.z) < 30;
        if (near) {
          pineBatch.add(
            composeMatrix(
              new THREE.Vector3(pine.x, baseY + pine.h - 0.9, pine.z),
              tempQuat,
              new THREE.Vector3(1.0 + rnd() * 0.7, 1, 1)
            ),
            leafColor.setHSL(0.3 + rnd() * 0.04, 0.24, 0.58 + rnd() * 0.14)
          );
        } else {
          farPineBatch.add(
            composeMatrix(
              new THREE.Vector3(pine.x, baseY + pine.h - 0.7, pine.z),
              tempQuat,
              new THREE.Vector3(0.8 + rnd() * 0.6, 0.3, 0.3)
            ),
            leafColor.setHSL(0.32, 0.27, 0.17 + rnd() * 0.06)
          );
        }
      } else {
        pineBatch.add(
          composeMatrix(
            new THREE.Vector3(pine.x, baseY + pine.h - 0.9, pine.z),
            tempQuat,
            new THREE.Vector3(1.0 + rnd() * 0.7, 1, 1)
          ),
          leafColor.setHSL(0.3 + rnd() * 0.04, 0.24, 0.62 + rnd() * 0.12)
        );
      }
    }
  }

  const deciduousData = [
    { x: -8.2, z: 8.4, h: 12.5, spread: 0.32, palette: 0, seed: 101, hero: true },
    { x: 10.2, z: 2.6, h: 13.5, spread: 0.34, palette: 2, seed: 102, hero: true },
    { x: -14.6, z: -4.0, h: 15, spread: 0.3, palette: 1, seed: 103 },
    { x: 15.8, z: -3.0, h: 16, spread: 0.31, palette: 1, seed: 104 },
    { x: -16.0, z: 9.0, h: 13, spread: 0.3, palette: 0, seed: 105 },
    { x: 20.0, z: 7.0, h: 14, spread: 0.3, palette: 2, seed: 106 },
    { x: -3.0, z: -17.0, h: 15, spread: 0.32, palette: 3, seed: 107 },
    { x: 5.4, z: -18.0, h: 16, spread: 0.3, palette: 0, seed: 108 },
    { x: -22, z: 17, h: 14, spread: 0.3, palette: 1, seed: 109 },
    { x: 22.5, z: 21, h: 13, spread: 0.31, palette: 2, seed: 110 },
  ];

  for (const tree of deciduousData) {
    buildDeciduous(tree, random);
  }
  addPinesToScene();

  function addPinesToScene() {
    const trunks = trunkBatch.build(trunkGeo, barkMat, { name: 'trunks' });
    const needles = pineBatch.build(cardGeo, pineMat, { name: 'pine-boughs' });
    const farNeedles = farPineBatch.build(frondGeo, farPineMat, { name: 'pine-fronds-far' });
    needles.customDepthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: pineTexture,
      alphaTest: 0.16,
      side: THREE.DoubleSide,
    });
    group.add(trunks);
    group.add(needles);
    group.add(farNeedles);
  }

  function buildDeciduous(tree, globalRandom) {
    const rnd = mulberry32(tree.seed * 73 + 9);
    const baseY = groundHeight(tree.x, tree.z);
    const palette = AUTUMN_PALETTES[tree.palette];
    const base = new THREE.Vector3(tree.x, baseY - 0.15, tree.z);
    const lean = new THREE.Vector3((rnd() - 0.5) * 0.9, 0, (rnd() - 0.5) * 0.9);
    const trunkTop = new THREE.Vector3(
      tree.x + lean.x,
      baseY + tree.h * (0.48 + rnd() * 0.07),
      tree.z + lean.z
    );
    const radii = [0.32 + rnd() * 0.12, 0.25, 0.19, 0.14];
    const trunkPoints = [];
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      trunkPoints.push(
        new THREE.Vector3(
          THREE.MathUtils.lerp(base.x, trunkTop.x, t) + Math.sin(t * 4 + tree.seed) * 0.16 * t,
          THREE.MathUtils.lerp(base.y, trunkTop.y, t),
          THREE.MathUtils.lerp(base.z, trunkTop.z, t) + Math.cos(t * 3.4 + tree.seed) * 0.12 * t
        )
      );
    }
    for (let i = 0; i < trunkPoints.length - 1; i++) {
      const start = trunkPoints[i];
      const end = trunkPoints[i + 1];
      const dir = end.clone().sub(start);
      const len = dir.length();
      tempQuat.setFromUnitVectors(upVec, dir.normalize());
      trunkColor.setHSL(0.08 + rnd() * 0.03, 0.13 + rnd() * 0.08, 0.2 + rnd() * 0.07);
      trunkBatch.add(
        composeMatrix(start, tempQuat, new THREE.Vector3(radii[i], len, radii[i])),
        trunkColor
      );
    }

    const tips = [];
    const limbCount = tree.hero ? 6 : 5;
    for (let limb = 0; limb < limbCount; limb++) {
      const t = 0.55 + (limb / Math.max(1, limbCount - 1)) * 0.38;
      const startT = Math.min(0.91, t);
      const a = (limb / limbCount) * Math.PI * 2 + rnd() * 0.6;
      const start = new THREE.Vector3(
        THREE.MathUtils.lerp(base.x, trunkTop.x, startT),
        THREE.MathUtils.lerp(base.y, trunkTop.y, startT),
        THREE.MathUtils.lerp(base.z, trunkTop.z, startT)
      );
      const outward = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const dir = outward.multiplyScalar(0.72).add(new THREE.Vector3(0, 0.55 + rnd() * 0.5, 0)).normalize();
      growBranch(start, dir, tree.h * tree.spread * (0.52 + rnd() * 0.17), 0.14, 2, rnd, tips);
    }
    // Central crown clusters.
    const crownRadius = tree.h * tree.spread;
    const crownCount = tree.hero ? 15 : 9;
    for (let i = 0; i < crownCount; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * crownRadius * 0.82;
      addLeafCluster(
        new THREE.Vector3(
          tree.x + Math.cos(a) * r,
          baseY + tree.h * (0.64 + rnd() * 0.3),
          tree.z + Math.sin(a) * r
        ),
        palette,
        rnd,
        tree.hero ? 1 : 0.82,
        0
      );
    }
    for (const tip of tips) {
      const clusterCount = tree.hero ? 3 : 2;
      for (let i = 0; i < clusterCount; i++) {
        addLeafCluster(
          tip.clone().add(new THREE.Vector3((rnd() - 0.5) * 1.4, (rnd() - 0.5) * 1.0, (rnd() - 0.5) * 1.4)),
          palette,
          rnd,
          tree.hero ? 0.95 : 0.8,
          1
        );
      }
    }

    function growBranch(start, dir, length, radius, depth, rndLocal, tipArray) {
      const end = start.clone().addScaledVector(dir, length);
      tempQuat.setFromUnitVectors(upVec, dir.clone().normalize());
      trunkColor.setHSL(0.075 + rndLocal() * 0.03, 0.14, 0.18 + rndLocal() * 0.08);
      trunkBatch.add(
        composeMatrix(start, tempQuat, new THREE.Vector3(radius, length, radius)),
        trunkColor
      );
      if (depth <= 0) {
        tipArray.push(end);
        return;
      }
      const children = 2 + (rndLocal() > 0.47 ? 1 : 0);
      for (let i = 0; i < children; i++) {
        const yaw = rndLocal() * Math.PI * 2;
        const outward = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
        const newDir = dir
          .clone()
          .multiplyScalar(0.47)
          .add(outward.multiplyScalar(0.52 + rndLocal() * 0.33))
          .add(new THREE.Vector3(0, 0.2 + rndLocal() * 0.35, 0))
          .normalize();
        growBranch(
          end,
          newDir,
          length * (0.56 + rndLocal() * 0.16),
          Math.max(0.022, radius * 0.68),
          depth - 1,
          rndLocal,
          tipArray
        );
      }
    }

    function addLeafCluster(position, paletteLocal, rndLocal, sizeFactor, tipMode) {
      const size = (0.55 + rndLocal() * 0.62) * sizeFactor;
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rndLocal() * 0.5, rndLocal() * Math.PI * 2, rndLocal() * 0.5)
      );
      leafColor.set(paletteLocal[Math.floor(rndLocal() * paletteLocal.length)]);
      leafColor.offsetHSL((rndLocal() - 0.5) * 0.02, (rndLocal() - 0.5) * 0.06, (rndLocal() - 0.5) * 0.08);
      leafBatch.add(
        composeMatrix(
          position,
          q,
          new THREE.Vector3(size * (0.9 + rndLocal() * 0.35), size * (0.65 + rndLocal() * 0.25), size)
        ),
        leafColor
      );
      const cards = tipMode ? 3 : 1;
      for (let i = 0; i < cards; i++) {
        const cardPos = position.clone().add(
          new THREE.Vector3(
            (rndLocal() - 0.5) * size * 1.7,
            (rndLocal() - 0.5) * size * 1.2,
            (rndLocal() - 0.5) * size * 1.7
          )
        );
        const cardQ = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(rndLocal() * Math.PI, rndLocal() * Math.PI * 2, rndLocal() * Math.PI)
        );
        const cs = 0.09 + rndLocal() * 0.12;
        const c = leafColor.clone().offsetHSL(0, 0, (rndLocal() - 0.5) * 0.16);
        cardBatch.add(composeMatrix(cardPos, cardQ, new THREE.Vector3(cs, cs, cs)), c);
      }
    }
  }

  // Distant/understory shrubs and saplings.
  const shrubBatch = new InstanceBatch();
  const shrubMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.94,
    flatShading: false,
    side: THREE.DoubleSide,
    envMapIntensity: 0.14,
  });
  for (let i = 0; i < 90; i++) {
    const a = random() * Math.PI * 2;
    const r = 9 + random() * 25;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.abs(x) < 5.1 && Math.abs(z) < 4.3) continue;
    if (blockedByLake(x, z, 1.3)) continue;
    // Keep the lit lantern post clear: strong warm light turns these into
    // faceted shards at close range.
    if (Math.hypot(x + 2.78, z - 12.15) < 5.0) continue;
    const y = groundHeight(x, z);
    const count = 3 + Math.floor(random() * 4);
    for (let n = 0; n < count; n++) {
      const s = 0.22 + random() * 0.55;
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(random() * 0.4, random() * 6.2, random() * 0.4)
      );
      const c = random() < 0.16
        ? new THREE.Color().setHSL(0.11 + random() * 0.04, 0.3, 0.16 + random() * 0.06)
        : new THREE.Color().setHSL(0.26 + random() * 0.08, 0.18 + random() * 0.1, 0.13 + random() * 0.07);
      shrubBatch.add(
        composeMatrix(
          new THREE.Vector3(x + (random() - 0.5) * 1.5, y + s * 0.45, z + (random() - 0.5) * 1.5),
          q,
          new THREE.Vector3(s, s * 0.7, s)
        ),
        c
      );
    }
  }
  group.add(shrubBatch.build(leafGeo, shrubMat, { name: 'understory' }));

  const leafClusters = leafBatch.build(leafGeo, leafMat, { name: 'canopy-leaves' });
  const leafCards = cardBatch.build(leafCardGeo, leafCardMat, { castShadow: false, name: 'canopy-leaf-cards' });
  group.add(leafClusters);
  group.add(leafCards);

  scene.add(group);
  return {
    group,
    materials: collectMaterials(group),
  };
}

function collectMaterials(root) {
  const materials = new Set();
  root.traverse((object) => {
    if (!object.material) return;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) materials.add(material);
  });
  return [...materials];
}

/* ------------------------------------------------------------------ *
 * Atmosphere
 * ------------------------------------------------------------------ */

function createSmoke(scene, origin, timeUniform, nightUniform) {
  const random = mulberry32(221);
  const texture = makeSmokeTexture(7);
  const group = new THREE.Group();
  group.name = 'chimney-smoke';
  group.position.copy(origin);
  scene.add(group);
  const puffs = [];
  const count = 32;

  for (let i = 0; i < count; i++) {
    const cool = random() > 0.28;
    const material = new THREE.SpriteMaterial({
      map: texture,
      color: cool ? 0x96988e : 0xaaa093,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: true,
      rotation: random() * Math.PI * 2,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.setScalar(1);
    sprite.renderOrder = 2;
    group.add(sprite);
    puffs.push({
      sprite,
      phase: random(),
      speed: 0.024 + random() * 0.015,
      offsetX: (random() - 0.5) * 0.25,
      offsetZ: (random() - 0.5) * 0.25,
      growth: 1.5 + random() * 1.2,
      sway: 0.25 + random() * 0.45,
      spin: (random() - 0.5) * 0.18,
      brightness: 0.8 + random() * 0.28,
    });
  }

  function update(time, night) {
    for (const puff of puffs) {
      const life = (time * puff.speed + puff.phase) % 1;
      const sprite = puff.sprite;
      const swirl = Math.sin(life * 5.2 + puff.phase * 19.0);
      sprite.position.x =
        puff.offsetX + swirl * puff.sway * life + life * 1.55 + life * life * 2.2;
      sprite.position.y = life * (2.75 + puff.growth * 0.32);
      sprite.position.z =
        puff.offsetZ + Math.cos(life * 4.1 + puff.phase * 13.0) * puff.sway * 0.7 * life - life * 0.35;
      const scale = (0.7 + life * (2.9 + puff.growth)) * (1 - Math.pow(life, 6) * 0.35);
      sprite.scale.set(scale, scale * 0.88, 1);
      sprite.material.rotation = puff.phase * 6.2 + life * puff.spin * 5;
      sprite.material.opacity =
        Math.pow(Math.sin(life * Math.PI), 1.15) *
        0.065 *
        puff.brightness *
        (1 - night * 0.24);
    }
  }

  return { group, puffs, update };
}

function createFireflies(scene, timeUniform, nightUniform) {
  const count = 130;
  const random = mulberry32(661);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let x;
    let z;
    if (i < 50) {
      const a = random() * Math.PI * 2;
      const r = 4.5 + random() * 11;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
    } else {
      const t = random();
      x = -1 + t * 2.2 + (random() - 0.5) * 4.5;
      z = 7 + random() * 19;
    }
    positions[i * 3] = x;
    positions[i * 3 + 1] = 0.65 + random() * 2.8 + groundHeight(x, z);
    positions[i * 3 + 2] = z;
    seeds[i] = random();
    sizes[i] = 0.075 + random() * 0.12;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: timeUniform,
      uNight: nightUniform,
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.75) },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      attribute float aSize;
      uniform float uTime;
      uniform float uNight;
      uniform float uPixelRatio;
      varying float vBlink;
      void main() {
        float phase = aSeed * 6.28318;
        float speed = 0.28 + aSeed * 0.45;
        vec3 p = position;
        p.x += sin(uTime * speed + phase) * 0.9 + sin(uTime * 0.17 + phase * 2.3) * 0.4;
        p.z += cos(uTime * speed * 0.83 + phase) * 0.8;
        p.y += sin(uTime * 0.42 + phase * 1.7) * 0.34;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float blink = pow(max(0.0, sin(uTime * (0.6 + aSeed * 0.9) + phase * 3.0)), 3.5);
        vBlink = blink;
        float distFade = smoothstep(34.0, 4.0, -mv.z);
        float visibility = mix(0.44, 1.0, uNight) * distFade;
        gl_PointSize = max(1.0, aSize * (300.0 / max(1.0, -mv.z)) * uPixelRatio) * (0.65 + blink * 0.35);
        gl_PointSize *= visibility;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vBlink;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        float core = smoothstep(0.28, 0.0, d);
        float halo = smoothstep(0.5, 0.0, d) * 0.4;
        float alpha = (core + halo) * (0.35 + vBlink * 0.65);
        vec3 color = mix(vec3(1.0, 0.63, 0.24), vec3(1.0, 0.9, 0.58), core);
        gl_FragColor = vec4(color * 1.8, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
  return points;
}

function createFallingLeaves(scene) {
  const count = 38;
  const random = mulberry32(1309);
  const geometry = createGroundLeafGeometry();
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.86,
    side: THREE.DoubleSide,
    envMapIntensity: 0.25,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.name = 'falling-leaves';
  const anchors = [
    [-8.2, 8.4, 4.4],
    [10.2, 2.6, 4.8],
    [-5.4, 5.8, 1.8],
    [6.4, 8.0, 3.2],
    [0.8, 8.8, 2.6],
    [-12.0, 2.0, 4.2],
  ];
  const leaves = [];
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const palette = AUTUMN_PALETTES.flat();
  for (let i = 0; i < count; i++) {
    const anchor = anchors[Math.floor(random() * anchors.length)];
    const leaf = {
      x: anchor[0] + (random() - 0.5) * anchor[2] * 2,
      z: anchor[1] + (random() - 0.5) * anchor[2] * 1.5,
      y: 1.5 + random() * 10,
      ceiling: 8 + random() * 5,
      speed: 0.17 + random() * 0.26,
      sway: 0.3 + random() * 0.55,
      phase: random() * Math.PI * 2,
      swaySpeed: 0.35 + random() * 0.5,
      spinX: (random() - 0.5) * 1.4,
      spinY: (random() - 0.5) * 1.8,
      spinZ: (random() - 0.5) * 1.2,
      rotX: random() * 6.2,
      rotY: random() * 6.2,
      rotZ: random() * 6.2,
      size: 0.12 + random() * 0.12,
      color: new THREE.Color(palette[Math.floor(random() * palette.length)]),
    };
    leaf.y = Math.min(leaf.y, leaf.ceiling - 0.2);
    leaves.push(leaf);
    mesh.setColorAt(i, leaf.color);
    matrix.compose(
      position.set(leaf.x, leaf.y, leaf.z),
      quaternion.setFromEuler(euler.set(leaf.rotX, leaf.rotY, leaf.rotZ)),
      scale.setScalar(leaf.size)
    );
    mesh.setMatrixAt(i, matrix);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
  let lastTime = 0;

  return {
    mesh,
    update(time) {
      const dt = Math.min(0.05, Math.max(0, time - lastTime));
      lastTime = time;
      if (dt === 0) return;
      for (let i = 0; i < leaves.length; i++) {
        const leaf = leaves[i];
        leaf.y -= leaf.speed * dt;
        leaf.x += Math.sin(time * leaf.swaySpeed + leaf.phase) * leaf.sway * dt;
        leaf.z += Math.cos(time * leaf.swaySpeed * 0.7 + leaf.phase) * leaf.sway * 0.45 * dt;
        if (leaf.y < groundHeight(leaf.x, leaf.z) + 0.08) {
          leaf.y = leaf.ceiling;
          leaf.x += (Math.random() - 0.5) * 2.5;
          leaf.z += (Math.random() - 0.5) * 2.0;
        }
        leaf.rotX += leaf.spinX * dt;
        leaf.rotY += leaf.spinY * dt;
        leaf.rotZ += leaf.spinZ * dt;
        matrix.compose(
          position.set(leaf.x, leaf.y, leaf.z),
          quaternion.setFromEuler(euler.set(leaf.rotX, leaf.rotY, leaf.rotZ)),
          scale.setScalar(leaf.size)
        );
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

function createDustMotes(scene, timeUniform, nightUniform) {
  const count = 80;
  const random = mulberry32(772);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = -4 + random() * 9;
    positions[i * 3 + 1] = 0.8 + random() * 3.4;
    positions[i * 3 + 2] = 3.3 + random() * 4.5;
    seeds[i] = random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: timeUniform, uNight: nightUniform },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      uniform float uNight;
      varying float vAlpha;
      void main() {
        float phase = aSeed * 6.2831;
        vec3 p = position;
        p.x += sin(uTime * (0.14 + aSeed * 0.12) + phase) * 1.1;
        p.y += sin(uTime * 0.17 + phase * 1.5) * 0.35;
        p.z += cos(uTime * 0.11 + phase) * 0.7;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (10.0 + aSeed * 8.0) / max(1.0, -mv.z) * 2.2;
        vAlpha = mix(0.22, 0.65, uNight) * (0.35 + 0.65 * pow(max(0.0, sin(uTime * 0.7 + phase)), 2.0));
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vAlpha;
        gl_FragColor = vec4(vec3(1.0, 0.72, 0.38) * 1.5, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
  return points;
}

/* ------------------------------------------------------------------ *
 * Public
 * ------------------------------------------------------------------ */

export function createForest(scene, timeUniform, pathCurve, smokeOrigin, { snowUniform } = {}) {
  const pathSamples = pathCurve.getPoints(90);
  pathSamples.forEach((p) => {
    p.y = groundHeight(p.x, p.z);
  });
  const nightUniform = { value: 0 };
  const trees = createTrees(scene, timeUniform, pathSamples);
  createForestFloorDetails(scene, pathSamples, timeUniform);
  if (snowUniform) {
    for (const material of trees.materials) enableSnow(material, snowUniform);
  }
  const smoke = createSmoke(scene, smokeOrigin, timeUniform, nightUniform);
  const fireflies = createFireflies(scene, timeUniform, nightUniform);
  const dust = createDustMotes(scene, timeUniform, nightUniform);
  const fallingLeaves = createFallingLeaves(scene);

  return {
    pathSamples,
    smoke,
    fireflies,
    dust,
    fallingLeaves,
    setNight(value) {
      nightUniform.value = value;
    },
    update() {
      smoke.update(timeUniform.value, nightUniform.value);
      fallingLeaves.update(timeUniform.value);
    },
  };
}
