import * as THREE from 'three';
import {
  mulberry32,
  canvasTexture,
  makeWoodTexture,
  makePlankTexture,
  makeStoneTexture,
  makeRoofTexture,
  makeWindowTexture,
  makeGlowTexture,
  createLeafClusterGeometry,
  createFernGeometry,
  makeStoneGeometry,
  mergeStaticMeshes,
  groundHeight,
} from './utils.js';

const DIM = {
  width: 8.6,
  depth: 6.8,
  foundation: 0.55,
  wallTop: 3.78,
  ridge: 5.92,
  eaveX: 5.5,
  roofDepth: 9.5,
  porchTop: 0.73,
  porchDepth: 1.92,
};

function makeEndGrainTexture() {
  return canvasTexture(128, (ctx, w, h) => {
    const random = mulberry32(41);
    ctx.fillStyle = '#b28a61';
    ctx.fillRect(0, 0, w, h);
    for (let r = 58; r > 2; r -= 4 + random() * 4) {
      ctx.strokeStyle = random() > 0.5 ? 'rgba(91,59,33,.55)' : 'rgba(201,161,112,.55)';
      ctx.lineWidth = 1 + random() * 1.2;
      ctx.beginPath();
      ctx.ellipse(w / 2 + (random() - 0.5) * 7, h / 2 + (random() - 0.5) * 5, r * 0.86, r, 0.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(55,34,20,.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2);
    ctx.lineTo(w / 2 + 3, h / 2 + 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(53,34,20,.35)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
  });
}

function makeSignTexture() {
  return canvasTexture(512, (ctx, w, h) => {
    ctx.fillStyle = '#5c402b';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      ctx.strokeStyle = i % 2 ? 'rgba(31,20,13,.12)' : 'rgba(174,128,82,.15)';
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      ctx.moveTo(Math.random() * w, 0);
      ctx.lineTo(Math.random() * w, h);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(225,205,170,.4)';
    ctx.lineWidth = 3;
    ctx.strokeRect(13, 13, w - 26, h - 26);
    ctx.fillStyle = '#d8c7a5';
    ctx.textAlign = 'center';
    ctx.font = '600 45px Georgia, serif';
    ctx.fillText('CABIN', w / 2, h * 0.48);
    ctx.font = '400 54px Georgia, serif';
    ctx.fillText('Nº 09', w / 2, h * 0.76);
  }, { repeat: [1, 1] });
}

function makeMat(capabilities) {
  const anisotropy = capabilities.getMaxAnisotropy();
  const bark = makeWoodTexture(3, 'dark');
  const log = makeWoodTexture(12, 'log');
  const plank = makePlankTexture(9, true);
  const stone = makeStoneTexture(21);
  const roof = makeRoofTexture(33);
  const endGrain = makeEndGrainTexture();
  for (const t of [bark, log, plank, stone, roof, endGrain]) t.anisotropy = Math.min(8, anisotropy);
  log.repeat.set(1.2, 4);
  bark.repeat.set(1, 3);
  plank.repeat.set(1, 1);
  stone.repeat.set(1.4, 2.4);
  roof.repeat.set(2.4, 2.2);

  const cloneLinear = (texture) => {
    const t = texture.clone();
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };

  const mats = {
    log: new THREE.MeshStandardMaterial({
      color: 0x8a6042,
      map: log,
      bumpMap: cloneLinear(log),
      bumpScale: 0.025,
      roughness: 0.88,
      metalness: 0,
      envMapIntensity: 0.25,
    }),
    logDark: new THREE.MeshStandardMaterial({
      color: 0x71503a,
      map: log,
      bumpMap: cloneLinear(log),
      bumpScale: 0.03,
      roughness: 0.92,
      envMapIntensity: 0.22,
    }),
    logWarm: new THREE.MeshStandardMaterial({
      color: 0x9a6d4c,
      map: log,
      roughness: 0.85,
      envMapIntensity: 0.3,
    }),
    bark: new THREE.MeshStandardMaterial({
      color: 0x5f4631,
      map: bark,
      bumpMap: cloneLinear(bark),
      bumpScale: 0.035,
      roughness: 0.95,
    }),
    endGrain: new THREE.MeshStandardMaterial({
      color: 0xd8bd98,
      map: endGrain,
      roughness: 0.8,
    }),
    plank: new THREE.MeshStandardMaterial({
      color: 0x91694a,
      map: plank,
      bumpMap: cloneLinear(plank),
      bumpScale: 0.022,
      roughness: 0.86,
      envMapIntensity: 0.3,
    }),
    plankDark: new THREE.MeshStandardMaterial({
      color: 0x644830,
      map: plank,
      roughness: 0.9,
    }),
    stone: new THREE.MeshStandardMaterial({
      color: 0xb0a899,
      map: stone,
      bumpMap: cloneLinear(stone),
      bumpScale: 0.06,
      roughness: 0.95,
      envMapIntensity: 0.18,
    }),
    stoneDark: new THREE.MeshStandardMaterial({
      color: 0x777166,
      map: stone,
      roughness: 0.97,
    }),
    roof: new THREE.MeshStandardMaterial({
      color: 0x8f9998,
      map: roof,
      bumpMap: cloneLinear(roof),
      bumpScale: 0.045,
      roughness: 0.82,
      metalness: 0.05,
      envMapIntensity: 0.45,
    }),
    trim: new THREE.MeshStandardMaterial({
      color: 0x513724,
      map: plank,
      roughness: 0.9,
    }),
    iron: new THREE.MeshStandardMaterial({
      color: 0x191817,
      roughness: 0.44,
      metalness: 0.75,
    }),
    glass: new THREE.MeshBasicMaterial({
      map: makeWindowTexture(),
      color: new THREE.Color(1.72, 1.12, 0.6),
      fog: true,
      toneMapped: true,
    }),
    glassDim: new THREE.MeshBasicMaterial({
      map: makeWindowTexture(),
      color: new THREE.Color(1.1, 0.74, 0.42),
      fog: true,
      toneMapped: true,
    }),
    lampGlow: new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.15, 1.32, 0.6),
      fog: false,
      toneMapped: true,
    }),
    pot: new THREE.MeshStandardMaterial({ color: 0x88583d, roughness: 0.85 }),
    soil: new THREE.MeshStandardMaterial({ color: 0x2a2118, roughness: 1 }),
    cloth: new THREE.MeshStandardMaterial({ color: 0x8f3f32, roughness: 0.95 }),
    straw: new THREE.MeshStandardMaterial({ color: 0x8d744a, roughness: 0.95 }),
    leaf: new THREE.MeshStandardMaterial({
      color: 0x2d462c,
      roughness: 0.8,
      side: THREE.DoubleSide,
      vertexColors: true,
    }),
    flower: new THREE.MeshStandardMaterial({ color: 0xc9ab6c, roughness: 0.7 }),
    flowerRed: new THREE.MeshStandardMaterial({ color: 0x9d5646, roughness: 0.7 }),
    string: new THREE.MeshBasicMaterial({ color: 0x1a1511 }),
  };
  return mats;
}

function createLogWall(group, mats, options) {
  const { axis, front, count, radius, step, startY, length, zCenter, xCenter } = options;
  const capMaterial = options.capMaterial || mats.endGrain;
  for (let i = 0; i < count; i++) {
    const y = startY + i * step;
    const r = radius * (0.94 + ((i * 37) % 11) * 0.012);
    const geometry = new THREE.CylinderGeometry(r, r * 0.98, length, 10, 1, false);
    const mesh = new THREE.Mesh(geometry, [mats.log, capMaterial, capMaterial]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (axis === 'x') {
      mesh.rotation.z = Math.PI / 2;
      mesh.position.set(xCenter + (i % 2 ? 0.018 : -0.012), y, front ? zCenter + 0.018 : zCenter - 0.018);
    } else {
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(front ? xCenter + 0.018 : xCenter - 0.018, y, zCenter + (i % 2 ? 0.015 : -0.012));
    }
    group.add(mesh);
  }
}

function addBox(parent, size, position, material, options = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  mesh.position.set(position[0], position[1], position[2]);
  if (options.rotation) mesh.rotation.set(options.rotation[0], options.rotation[1], options.rotation[2]);
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  parent.add(mesh);
  return mesh;
}

function addLog(parent, radius, start, end, material, endMaterial, segments = 8) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const geo = new THREE.CylinderGeometry(radius, radius * 0.98, direction.length(), segments, 1, false);
  const mesh = new THREE.Mesh(geo, [material, endMaterial, endMaterial]);
  mesh.position.copy(start).addScaledVector(direction, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function makeWindow(mats, { width = 1.34, height = 1.2, lit = true, flowerBox = true, seed = 1 }) {
  const group = new THREE.Group();
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    lit ? mats.glass : mats.glassDim
  );
  glow.position.z = 0.064;
  group.add(glow);

  const backing = addBox(group, [width + 0.23, height + 0.23, 0.06], [0, 0, -0.005], mats.trim, { castShadow: false });
  backing.receiveShadow = true;

  const frameDepth = 0.09;
  const frameThickness = 0.095;
  addBox(group, [frameThickness, height + 0.12, frameDepth], [-width / 2 - 0.04, 0, 0.095], mats.trim);
  addBox(group, [frameThickness, height + 0.12, frameDepth], [width / 2 + 0.04, 0, 0.095], mats.trim);
  addBox(group, [width + 0.22, frameThickness, frameDepth], [0, height / 2 + 0.055, 0.095], mats.trim);
  addBox(group, [width + 0.22, frameThickness, frameDepth], [0, -height / 2 - 0.055, 0.095], mats.trim);
  addBox(group, [0.066, height, 0.045], [0, 0, 0.11], mats.trim);
  addBox(group, [width, 0.058, 0.045], [0, 0.02, 0.11], mats.trim);

  addBox(group, [width + 0.38, 0.1, 0.3], [0, -height / 2 - 0.15, 0.16], mats.plankDark);
  if (flowerBox) {
    addBox(group, [width + 0.16, 0.23, 0.28], [0, -height / 2 - 0.3, 0.24], mats.plankDark);
    addBox(group, [width + 0.02, 0.11, 0.17], [0, -height / 2 - 0.23, 0.25], mats.soil);
    const leafGeo = createLeafClusterGeometry(seed + 10);
    const leafMat = mats.leaf.clone();
    leafMat.color.set(0x4e5d38);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, 14);
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    const random = mulberry32(seed + 50);
    for (let i = 0; i < 14; i++) {
      const x = (random() - 0.5) * (width - 0.06);
      const s = 0.1 + random() * 0.09;
      matrix.compose(
        new THREE.Vector3(x, -height / 2 - 0.18 + random() * 0.16, 0.27 + (random() - 0.5) * 0.16),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(random(), random() * 3, random())),
        new THREE.Vector3(s, s * 0.8, s)
      );
      leaves.setMatrixAt(i, matrix);
      leaves.setColorAt(i, color.setHSL(0.22 + random() * 0.08, 0.25, 0.3 + random() * 0.12));
    }
    group.add(leaves);
    const flowerGeo = new THREE.SphereGeometry(0.045, 6, 5);
    for (let i = 0; i < 7; i++) {
      const flower = new THREE.Mesh(flowerGeo, i % 3 ? mats.flower : mats.flowerRed);
      flower.position.set((random() - 0.5) * width, -height / 2 - 0.08 + random() * 0.19, 0.26 + (random() - 0.5) * 0.14);
      flower.castShadow = true;
      group.add(flower);
    }
  }
  return group;
}

function createRoundWindow(mats) {
  const group = new THREE.Group();
  const backing = new THREE.Mesh(new THREE.CircleGeometry(0.47, 32), mats.trim);
  backing.position.z = 0.01;
  group.add(backing);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.38, 32), mats.glass);
  glow.position.z = 0.05;
  group.add(glow);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.055, 8, 32), mats.trim);
  ring.position.z = 0.06;
  ring.castShadow = true;
  group.add(ring);
  addBox(group, [0.045, 0.68, 0.05], [0, 0, 0.09], mats.trim);
  addBox(group, [0.68, 0.04, 0.05], [0, 0, 0.09], mats.trim);
  return group;
}

function createLantern(mats, scale = 1) {
  const lantern = new THREE.Group();
  const iron = mats.iron;
  const glowMat = mats.lampGlow.clone();
  glowMat.color.setRGB(1.58, 0.94, 0.38);

  addBox(lantern, [0.27, 0.035, 0.27], [0, 0.22, 0], iron);
  addBox(lantern, [0.22, 0.035, 0.22], [0, -0.25, 0], iron);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.43, 4), glowMat);
  glass.rotation.y = Math.PI / 4;
  lantern.add(glass);
  for (const [x, z] of [[-0.13, -0.13], [0.13, -0.13], [-0.13, 0.13], [0.13, 0.13]]) {
    addBox(lantern, [0.025, 0.5, 0.025], [x, -0.02, z], iron);
  }
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.15, 4), iron);
  cap.position.y = 0.31;
  cap.rotation.y = Math.PI / 4;
  cap.castShadow = true;
  lantern.add(cap);
  const top = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.014, 5, 10, Math.PI), iron);
  top.position.y = 0.42;
  top.rotation.z = 0;
  lantern.add(top);
  lantern.scale.setScalar(scale);
  return lantern;
}

function createPostLantern(mats) {
  const group = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.12, 2.3, 8), mats.bark);
  post.position.y = 1.15;
  post.castShadow = true;
  post.receiveShadow = true;
  group.add(post);
  addBox(group, [0.42, 0.1, 0.13], [0.14, 2.2, 0], mats.trim);
  const diagonal = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.045, 0.55, 6), mats.trim);
  diagonal.position.set(0.17, 1.99, 0);
  diagonal.rotation.z = -0.75;
  group.add(diagonal);
  const lantern = createLantern(mats, 0.9);
  lantern.position.set(0.34, 1.78, 0);
  group.add(lantern);
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      color: 0xffb56b,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    })
  );
  glow.scale.setScalar(1.7);
  glow.position.copy(lantern.position);
  group.add(glow);
  return { group, lightPosition: new THREE.Vector3(0.34, 1.78, 0) };
}

function addPlants(group, mats, random) {
  const fernGeo = createFernGeometry(88);
  const fernMat = mats.leaf.clone();
  fernMat.color.set(0xffffff);
  fernMat.vertexColors = true;
  fernMat.side = THREE.DoubleSide;
  const clumps = 26;
  const foliage = new THREE.InstancedMesh(fernGeo, fernMat, clumps);
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  let idx = 0;
  for (let c = 0; c < clumps; c++) {
    const angle = random() * Math.PI * 2;
    const radius = 4.6 + random() * 1.6;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius * 0.72;
    // Keep the approach and windows clear.
    if (z > 3.8 && Math.abs(x) < 2.0) continue;
    const s = 0.75 + random() * 0.7;
    matrix.compose(
      new THREE.Vector3(x, groundHeight(x, z) - groundHeight(0, 0) - 0.02, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, random() * 6.2, 0)),
      new THREE.Vector3(s, s * (0.85 + random() * 0.35), s)
    );
    foliage.setMatrixAt(idx, matrix);
    if (random() < 0.18) {
      foliage.setColorAt(idx, color.setHSL(0.1 + random() * 0.04, 0.34, 0.26 + random() * 0.1));
    } else {
      foliage.setColorAt(idx, color.setHSL(0.22 + random() * 0.08, 0.2 + random() * 0.08, 0.2 + random() * 0.12));
    }
    idx++;
  }
  foliage.count = idx;
  foliage.castShadow = true;
  foliage.receiveShadow = true;
  group.add(foliage);
}

function addPottedPlant(group, mats, position, scale = 1) {
  const plant = new THREE.Group();
  plant.position.copy(position);
  plant.scale.setScalar(scale);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.3, 10), mats.pot);
  pot.position.y = 0.15;
  pot.castShadow = true;
  pot.receiveShadow = true;
  plant.add(pot);
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.025, 10), mats.soil);
  soil.position.y = 0.3;
  plant.add(soil);
  const random = mulberry32(74 + Math.round(position.x * 10));
  const leafGeo = createLeafClusterGeometry(5);
  const leafMat = mats.leaf.clone();
  leafMat.color.set(0x40583a);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, 9);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 9; i++) {
    const s = 0.11 + random() * 0.08;
    const angle = (i / 9) * Math.PI * 2;
    matrix.compose(
      new THREE.Vector3(Math.cos(angle) * 0.16 * random(), 0.38 + random() * 0.33, Math.sin(angle) * 0.16 * random()),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(random(), random() * 6, random())),
      new THREE.Vector3(s * 0.7, s * 1.4, s * 0.7)
    );
    leaves.setMatrixAt(i, matrix);
  }
  leaves.castShadow = true;
  plant.add(leaves);
  group.add(plant);
  return plant;
}

function createBench(mats) {
  const bench = new THREE.Group();
  const random = mulberry32(122);
  for (let i = 0; i < 4; i++) {
    addBox(bench, [1.25, 0.055, 0.13], [0, 0.5, -0.19 + i * 0.14], mats.plank, { castShadow: true });
  }
  for (let i = 0; i < 3; i++) {
    addBox(bench, [1.25, 0.12, 0.045], [0, 0.75 + i * 0.16, -0.35 - i * 0.012], mats.plank);
  }
  addBox(bench, [0.1, 0.54, 0.62], [-0.53, 0.26, 0], mats.plankDark);
  addBox(bench, [0.1, 0.54, 0.62], [0.53, 0.26, 0], mats.plankDark);
  addBox(bench, [0.09, 0.65, 0.08], [-0.5, 0.78, -0.37], mats.plankDark);
  addBox(bench, [0.09, 0.65, 0.08], [0.5, 0.78, -0.37], mats.plankDark);
  const blanket = addBox(bench, [0.55, 0.08, 0.48], [-0.25, 0.57, 0.02], mats.cloth, {
    rotation: [0, 0.08, 0],
  });
  blanket.castShadow = true;
  for (let i = 0; i < 6; i++) {
    addBox(bench, [0.5, 0.012, 0.03], [-0.25 + (random() - 0.5) * 0.12, 0.615, -0.15 + i * 0.06], mats.cloth, {
      castShadow: false,
    });
  }
  return bench;
}

function addWoodpile(parent, mats) {
  const pile = new THREE.Group();
  const random = mulberry32(202);
  const count = 31;
  let index = 0;
  for (let row = 0; row < 6; row++) {
    const inRow = 6 - Math.floor(row / 2);
    for (let col = 0; col < inRow; col++) {
      if (index >= count) break;
      const radius = 0.09 + random() * 0.022;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.75 + random() * 0.14, 9), [
        mats.bark,
        mats.endGrain,
        mats.endGrain,
      ]);
      log.rotation.x = Math.PI / 2;
      log.position.set(
        (col - (inRow - 1) / 2) * 0.22 + (random() - 0.5) * 0.02,
        0.1 + row * 0.18,
        (random() - 0.5) * 0.08
      );
      log.rotation.z = (random() - 0.5) * 0.06;
      log.castShadow = true;
      log.receiveShadow = true;
      pile.add(log);
      index++;
    }
  }
  parent.add(pile);
  return pile;
}

function addAxeAndStump(parent, mats) {
  const group = new THREE.Group();
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.54, 0.58, 11), [mats.bark, mats.endGrain, mats.endGrain]);
  stump.position.y = 0.29;
  stump.rotation.y = 0.4;
  stump.castShadow = true;
  stump.receiveShadow = true;
  group.add(stump);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.036, 1.15, 7), mats.plankDark);
  handle.position.set(0.1, 0.9, 0.05);
  handle.rotation.z = 0.45;
  handle.rotation.x = 0.2;
  handle.castShadow = true;
  group.add(handle);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.07), mats.iron);
  head.position.set(-0.22, 1.3, 0.18);
  head.rotation.z = 0.45;
  head.rotation.x = 0.2;
  head.castShadow = true;
  group.add(head);
  const chipGeo = new THREE.BoxGeometry(0.15, 0.02, 0.06);
  const random = mulberry32(162);
  for (let i = 0; i < 12; i++) {
    const chip = new THREE.Mesh(chipGeo, mats.endGrain);
    const a = random() * Math.PI * 2;
    const r = 0.5 + random() * 0.9;
    chip.position.set(Math.cos(a) * r, 0.02 + random() * 0.03, Math.sin(a) * r);
    chip.rotation.y = random() * Math.PI;
    chip.rotation.z = (random() - 0.5) * 0.4;
    group.add(chip);
  }
  parent.add(group);
  return group;
}

function addFence(parent, mats) {
  const random = mulberry32(310);
  const start = new THREE.Vector3(-8.0, 0, 4.8);
  const end = new THREE.Vector3(-7.1, 0, 11.5);
  const posts = 3;
  const postPositions = [];
  for (let i = 0; i < posts; i++) {
    const t = i / (posts - 1);
    const p = start.clone().lerp(end, t);
    p.x += Math.sin(t * 5) * 0.25;
    p.y = 0.6;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 1.4, 7), mats.bark);
    post.position.copy(p);
    post.rotation.z = (random() - 0.5) * 0.08;
    post.rotation.x = (random() - 0.5) * 0.06;
    post.castShadow = true;
    post.receiveShadow = true;
    parent.add(post);
    postPositions.push(p.clone());
  }
  for (let i = 0; i < posts - 1; i++) {
    for (let level = 0; level < 2; level++) {
      const a = postPositions[i].clone();
      const b = postPositions[i + 1].clone();
      a.y = 0.72 + level * 0.4;
      b.y = 0.72 + level * 0.4;
      a.x += 0.06;
      b.x -= 0.06;
      addLog(parent, 0.055, a, b, mats.bark, mats.endGrain, 6);
    }
  }
}

export function createCabin(renderer) {
  const group = new THREE.Group();
  group.name = 'cabin';
  const mats = makeMat(renderer.capabilities);
  const random = mulberry32(917);
  const lights = { interior: [], porch: null, lantern: null, windowGlow: [] };

  const W = DIM.width;
  const D = DIM.depth;
  const frontZ = D / 2;
  const sideX = W / 2;
  const startY = DIM.foundation + 0.18;

  // Masonry base.
  addBox(group, [W + 0.35, 0.72, D + 0.35], [0, 0.2, 0], mats.stoneDark);
  addBox(group, [W + 0.1, 0.48, D + 0.1], [0, 0.42, 0], mats.stone);
  const sideLogCap = new THREE.MeshStandardMaterial({ color: 0x20150f, roughness: 1 });
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2;
    const stoneGeo = makeStoneGeometry(i + 3);
    const stone = new THREE.Mesh(stoneGeo, i % 4 ? mats.stone : mats.stoneDark);
    const rx = (W / 2 + 0.23) * Math.cos(angle);
    const rz = (D / 2 + 0.23) * Math.sin(angle);
    stone.position.set(rx, 0.16 + (i % 3) * 0.08, rz);
    stone.scale.set(0.28 + random() * 0.14, 0.23 + random() * 0.12, 0.3 + random() * 0.16);
    stone.rotation.set(random(), random() * 3, random() * 0.3);
    stone.castShadow = true;
    stone.receiveShadow = true;
    group.add(stone);
  }

  // Dark interior/backing volume prevents any daylight leaks between logs.
  addBox(group, [W - 0.1, DIM.wallTop - 0.5, D - 0.1], [0, (DIM.wallTop + 0.5) / 2, 0], new THREE.MeshBasicMaterial({ color: 0x120d0a }), {
    castShadow: false,
    receiveShadow: false,
  });

  const logCount = 11;
  const logStep = 0.29;
  createLogWall(group, mats, {
    axis: 'x',
    front: true,
    count: logCount,
    radius: 0.165,
    step: logStep,
    startY,
    length: W + 0.7,
    zCenter: frontZ,
  });
  createLogWall(group, mats, {
    axis: 'x',
    front: false,
    count: logCount,
    radius: 0.165,
    step: logStep,
    startY,
    length: W + 0.7,
    zCenter: -frontZ,
  });
  createLogWall(group, mats, {
    axis: 'z',
    front: true,
    count: logCount,
    radius: 0.162,
    step: logStep,
    startY,
    length: D - 0.4,
    xCenter: sideX,
    capMaterial: sideLogCap,
  });
  createLogWall(group, mats, {
    axis: 'z',
    front: false,
    count: logCount,
    radius: 0.162,
    step: logStep,
    startY,
    length: D - 0.4,
    xCenter: -sideX,
    capMaterial: sideLogCap,
  });

  // Top plates.
  addBox(group, [W + 0.9, 0.17, 0.28], [0, DIM.wallTop - 0.02, frontZ + 0.02], mats.logDark);
  addBox(group, [W + 0.9, 0.17, 0.28], [0, DIM.wallTop - 0.02, -frontZ - 0.02], mats.logDark);

  // Gable geometry (front/back), with natural horizontal cladding.
  const gableHeight = DIM.ridge - DIM.wallTop;
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-W / 2, 0);
  gableShape.lineTo(W / 2, 0);
  gableShape.lineTo(0, gableHeight);
  gableShape.closePath();
  const gableGeo = new THREE.ExtrudeGeometry(gableShape, { depth: 0.18, bevelEnabled: false });
  for (const [z, rotationY] of [[frontZ, 0], [-frontZ - 0.18, Math.PI]]) {
    const gable = new THREE.Mesh(gableGeo, mats.logDark);
    gable.position.set(0, DIM.wallTop, z);
    gable.rotation.y = rotationY;
    gable.castShadow = true;
    gable.receiveShadow = true;
    group.add(gable);
  }
  // Cladding lines on gable faces suggest smaller logs.
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    const y = DIM.wallTop + t * gableHeight;
    const half = (W / 2) * (1 - t);
    for (const z of [frontZ + 0.205, -frontZ - 0.205]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(half * 1.9, 0.055, 0.035), mats.trim);
      beam.position.set(0, y, z);
      beam.castShadow = false;
      group.add(beam);
    }
  }

  // Roof panels.
  const run = DIM.eaveX;
  const rise = DIM.ridge - 3.72;
  const angle = Math.atan2(rise, run);
  const slopeLength = Math.sqrt(run * run + rise * rise) + 0.12;
  for (const side of [-1, 1]) {
    const panel = addBox(
      group,
      [slopeLength, 0.18, DIM.roofDepth],
      [side * run * 0.5, 3.72 + rise * 0.5, 0],
      mats.roof,
      { rotation: [0, 0, side * -angle] }
    );
    panel.name = 'roofPanel';
    panel.castShadow = true;
    panel.receiveShadow = true;
  }
  // Ridge cap.
  addBox(group, [0.26, 0.2, DIM.roofDepth * 0.97], [0, DIM.ridge + 0.1, 0], mats.trim);
  // Barge boards along the gable edges.
  for (const z of [DIM.roofDepth / 2 - 0.02, -DIM.roofDepth / 2 + 0.02]) {
    for (const side of [-1, 1]) {
      const board = addBox(group, [slopeLength + 0.1, 0.27, 0.12], [side * run * 0.5, 3.72 + rise * 0.5 - 0.04, z], mats.trim, {
        rotation: [0, 0, side * -angle],
      });
      board.castShadow = true;
    }
  }
  // Eave fascia.
  for (const side of [-1, 1]) {
    addBox(group, [0.12, 0.22, DIM.roofDepth], [side * (run + 0.02), 3.68, 0], mats.trim, { castShadow: false });
  }
  // Porch floor.
  addBox(group, [W + 0.82, 0.18, DIM.porchDepth], [0, DIM.porchTop - 0.09, frontZ + DIM.porchDepth / 2 - 0.02], mats.plank);
  addBox(group, [W + 0.9, 0.25, 0.28], [0, DIM.porchTop - 0.25, frontZ + DIM.porchDepth - 0.07], mats.plankDark);
  // Porch posts / foundation piers.
  for (const x of [-(W / 2 + 0.34), (W / 2 + 0.34)]) {
    addBox(group, [0.4, 0.55, 0.4], [x, 0.27, frontZ + DIM.porchDepth - 0.22], mats.stoneDark);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 3.15, 8), mats.logDark);
    post.position.set(x, DIM.porchTop + 1.55, frontZ + DIM.porchDepth - 0.22);
    post.castShadow = true;
    post.receiveShadow = true;
    group.add(post);
    const footing = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.23, 8), mats.endGrain);
    footing.position.set(x, DIM.porchTop + 0.1, frontZ + DIM.porchDepth - 0.22);
    group.add(footing);
  }
  // Support beam under roof, plus braces.
  addLog(group, 0.11, new THREE.Vector3(-W / 2 - 0.46, DIM.porchTop + 3.08, frontZ + DIM.porchDepth - 0.22), new THREE.Vector3(W / 2 + 0.46, DIM.porchTop + 3.08, frontZ + DIM.porchDepth - 0.22), mats.logDark, mats.endGrain);
  for (const x of [-(W / 2 + 0.34), (W / 2 + 0.34)]) {
    const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.085, 0.9, 7), mats.logDark);
    brace.position.set(x * 0.91, DIM.porchTop + 2.58, frontZ + DIM.porchDepth - 0.24);
    brace.rotation.z = x > 0 ? 0.7 : -0.7;
    brace.castShadow = true;
    group.add(brace);
  }

  // Steps.
  for (let i = 0; i < 3; i++) {
    const top = DIM.porchTop - i * 0.18;
    const stone = addBox(
      group,
      [2.55, 0.22 + i * 0.17, 0.58],
      [0, top - (0.11 + i * 0.085), frontZ + DIM.porchDepth + 0.26 + i * 0.42],
      mats.stone,
      { castShadow: true }
    );
    stone.receiveShadow = true;
  }
  addBox(group, [2.9, 0.08, 0.82], [0, DIM.porchTop + 0.005, frontZ + DIM.porchDepth - 0.32], mats.stoneDark, {
    castShadow: false,
  });
  // Doormat.
  addBox(group, [1.18, 0.025, 0.64], [0.05, DIM.porchTop + 0.02, frontZ + 0.9], mats.straw, { castShadow: false });

  // Railings.
  for (const side of [-1, 1]) {
    const innerX = side * 1.62;
    const outerX = side * (W / 2 + 0.21);
    for (let i = 0; i < 2; i++) {
      const t = i / 1;
      const x = innerX + (outerX - innerX) * t;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.95, 7), mats.logDark);
      post.position.set(x, DIM.porchTop + 0.48, frontZ + DIM.porchDepth - 0.18);
      post.castShadow = true;
      group.add(post);
    }
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, Math.abs(outerX - innerX) + 0.18, 7), mats.logDark);
    rail.rotation.z = Math.PI / 2;
    rail.position.set((innerX + outerX) / 2, DIM.porchTop + 0.93, frontZ + DIM.porchDepth - 0.18);
    rail.castShadow = true;
    group.add(rail);
    const lowerRail = rail.clone();
    lowerRail.position.y = DIM.porchTop + 0.45;
    lowerRail.scale.z = 0.72;
    group.add(lowerRail);
  }

  // Door assembly.
  const doorGroup = new THREE.Group();
  doorGroup.position.set(0.05, DIM.porchTop + 1.1, frontZ + 0.23);
  addBox(doorGroup, [1.28, 2.35, 0.1], [0, 0.02, 0], mats.trim);
  addBox(doorGroup, [1.08, 2.16, 0.095], [0, -0.01, 0.075], mats.plankDark);
  for (let i = 0; i < 5; i++) {
    addBox(doorGroup, [0.16, 2.12, 0.035], [-0.42 + i * 0.21, -0.01, 0.13], i % 2 ? mats.plank : mats.logWarm);
  }
  addBox(doorGroup, [1.12, 0.11, 0.06], [0, -0.72, 0.15], mats.iron);
  addBox(doorGroup, [1.12, 0.09, 0.06], [0, 0.66, 0.15], mats.iron);
  // Small warm window in the door.
  const doorGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.46), mats.glass);
  doorGlass.position.set(0, 0.52, 0.17);
  doorGroup.add(doorGlass);
  addBox(doorGroup, [0.5, 0.56, 0.04], [0, 0.52, 0.14], mats.trim, { castShadow: false });
  // Handle.
  const handle = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), mats.iron);
  handle.position.set(-0.36, -0.42, 0.19);
  handle.castShadow = true;
  doorGroup.add(handle);
  const handlePlate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.03), mats.iron);
  handlePlate.position.set(-0.36, -0.43, 0.16);
  doorGroup.add(handlePlate);
  // Wreath.
  const wreath = new THREE.Group();
  const wreathRing = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.075, 6, 18), new THREE.MeshStandardMaterial({ color: 0x2c412b, roughness: 0.95 }));
  wreathRing.castShadow = true;
  wreath.add(wreathRing);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.16, 4), new THREE.MeshStandardMaterial({ color: i % 3 ? 0x395035 : 0x526044, roughness: 0.9 }));
    leaf.position.set(Math.cos(a) * 0.23, Math.sin(a) * 0.23, 0.05);
    leaf.rotation.z = a;
    wreath.add(leaf);
  }
  wreath.position.set(0, 0.75, 0.25);
  wreath.scale.setScalar(1.18);
  doorGroup.add(wreath);
  group.add(doorGroup);

  // Windows.
  const leftWindow = makeWindow(mats, { width: 1.38, height: 1.22, lit: true, flowerBox: true, seed: 2 });
  leftWindow.position.set(-2.32, 2.17, frontZ + 0.22);
  group.add(leftWindow);
  const rightWindow = makeWindow(mats, { width: 1.38, height: 1.22, lit: true, flowerBox: true, seed: 6 });
  rightWindow.position.set(2.32, 2.17, frontZ + 0.22);
  group.add(rightWindow);
  const sideWindow = makeWindow(mats, { width: 1.28, height: 1.16, lit: true, flowerBox: false, seed: 9 });
  sideWindow.position.set(sideX + 0.23, 2.15, 0.5);
  sideWindow.rotation.y = Math.PI / 2;
  group.add(sideWindow);
  const backWindow = makeWindow(mats, { width: 1.2, height: 1.1, lit: false, flowerBox: false, seed: 12 });
  backWindow.position.set(-2.1, 2.15, -frontZ - 0.22);
  backWindow.rotation.y = Math.PI;
  group.add(backWindow);
  const roundWindow = createRoundWindow(mats);
  roundWindow.position.set(0.8, 4.77, frontZ + 0.23);
  group.add(roundWindow);

  // A porch bench, pots, lantern.
  const bench = createBench(mats);
  bench.position.set(3.08, DIM.porchTop, frontZ + DIM.porchDepth - 0.52);
  bench.rotation.y = 0.06;
  group.add(bench);
  addPottedPlant(group, mats, new THREE.Vector3(-1.15, DIM.porchTop, frontZ + 0.5), 0.95);
  addPottedPlant(group, mats, new THREE.Vector3(1.1, DIM.porchTop, frontZ + 0.54), 0.8);

  const hangingLantern = createLantern(mats, 1.1);
  hangingLantern.position.set(-0.92, 3.0, frontZ + DIM.porchDepth - 0.45);
  group.add(hangingLantern);
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 5), mats.iron);
  chain.position.set(-0.92, 3.35, frontZ + DIM.porchDepth - 0.45);
  group.add(chain);

  // Small string of warm fairy lights under the porch beam.
  const bulbGeo = new THREE.SphereGeometry(0.038, 8, 6);
  for (let i = 0; i < 7; i++) {
    const x = -3.95 + i * 1.18;
    const y = DIM.porchTop + 2.88 - Math.sin((i / 6) * Math.PI) * 0.18;
    const bulb = new THREE.Mesh(bulbGeo, mats.lampGlow);
    bulb.position.set(x, y, frontZ + DIM.porchDepth - 0.24);
    group.add(bulb);
    if (i < 6) {
      const nextX = -3.95 + (i + 1) * 1.18;
      const nextY = DIM.porchTop + 2.88 - Math.sin(((i + 1) / 6) * Math.PI) * 0.18;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(x, y, frontZ + DIM.porchDepth - 0.24),
        new THREE.Vector3((x + nextX) / 2, Math.min(y, nextY) - 0.08, frontZ + DIM.porchDepth - 0.24),
        new THREE.Vector3(nextX, nextY, frontZ + DIM.porchDepth - 0.24),
      ]);
      const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 5, 0.007, 4, false), mats.string);
      group.add(wire);
    }
  }

  // Chimney.
  const chimneyX = 2.55;
  const chimneyZ = 0.3;
  const chimneyBottom = -0.05;
  const chimneyTop = 6.55;
  addBox(group, [1.08, chimneyTop - chimneyBottom, 1.0], [chimneyX, chimneyBottom + (chimneyTop - chimneyBottom) / 2, chimneyZ], mats.stone);
  addBox(group, [1.22, 0.24, 1.14], [chimneyX, 5.02, chimneyZ], mats.stoneDark);
  addBox(group, [1.18, 0.22, 1.1], [chimneyX, chimneyTop - 0.12, chimneyZ], mats.stoneDark);
  addBox(group, [0.86, 0.36, 0.86], [chimneyX, chimneyTop + 0.16, chimneyZ], mats.iron);
  const chimneyPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.23, 0.65, 10), mats.iron);
  chimneyPipe.position.set(chimneyX, chimneyTop + 0.62, chimneyZ);
  chimneyPipe.castShadow = true;
  group.add(chimneyPipe);
  // Flashing at roof intersection.
  const flash = addBox(group, [1.3, 0.04, 1.22], [chimneyX, 4.65, chimneyZ], mats.iron, {
    rotation: [0, 0, -angle * 0.4],
    castShadow: false,
  });
  flash.receiveShadow = true;
  // Some protruding stones for silhouette.
  for (let i = 0; i < 9; i++) {
    const stone = new THREE.Mesh(makeStoneGeometry(70 + i), i % 3 ? mats.stone : mats.stoneDark);
    const face = i % 2 ? 1 : -1;
    stone.position.set(
      chimneyX + face * (0.55 + random() * 0.05),
      1.2 + random() * 4.4,
      chimneyZ + (random() - 0.5) * 0.8
    );
    stone.scale.set(0.16 + random() * 0.13, 0.14 + random() * 0.12, 0.22 + random() * 0.12);
    stone.rotation.set(random() * 2, random() * 2, random() * 2);
    stone.castShadow = true;
    group.add(stone);
  }

  // Roof moss and a few fallen leaves.
  for (let i = 0; i < 12; i++) {
    const side = i % 2 ? 1 : -1;
    const moss = new THREE.Mesh(
      new THREE.CircleGeometry(0.18 + random() * 0.38, 9),
      new THREE.MeshStandardMaterial({ color: 0x435231, roughness: 1, transparent: true, opacity: 0.6, depthWrite: false })
    );
    moss.position.set(side * (2 + random() * 2.6), 4.03 + random() * 1.2, -3.4 + random() * 6.5);
    moss.rotation.set(-Math.PI / 2 + side * angle, random(), random() * 0.4);
    group.add(moss);
  }

  // Exterior details.
  addWoodpile(group, mats).position.set(-5.35, 0.03, 2.7);
  addAxeAndStump(group, mats).position.set(-5.9, 0.02, 6.45);
  addFence(group, mats);

  const postLantern = createPostLantern(mats);
  postLantern.group.position.set(-2.78, 0.02, 12.15);
  group.add(postLantern.group);

  const sign = new THREE.Group();
  const signPost = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.065, 1.3, 6), mats.bark);
  signPost.position.y = 0.6;
  signPost.castShadow = true;
  sign.add(signPost);
  const signBoard = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.53, 0.055), new THREE.MeshStandardMaterial({
    map: makeSignTexture(),
    roughness: 0.9,
  }));
  signBoard.position.set(0.06, 1.12, 0.035);
  signBoard.rotation.z = -0.045;
  signBoard.castShadow = true;
  sign.add(signBoard);
  sign.position.set(-2.4, 0.02, 8.4);
  sign.rotation.y = 0.27;
  group.add(sign);

  addPlants(group, mats, random);

  // Lighting — kept in a few broad, soft sources for a filmic falloff.
  const porchLight = new THREE.PointLight(0xffa85c, 12.5, 13, 2);
  porchLight.position.set(-0.55, 3.05, frontZ + 1.65);
  porchLight.castShadow = false;
  group.add(porchLight);
  lights.porch = porchLight;

  const lanternLight = new THREE.PointLight(0xff9a4f, 9.5, 12, 2);
  lanternLight.position.copy(postLantern.lightPosition).add(postLantern.group.position);
  lanternLight.position.y += 0.8;
  group.add(lanternLight);
  lights.lantern = lanternLight;

  // A low, soft pool of window light reaching down the approach path.
  const pathSpill = new THREE.PointLight(0xffb274, 8, 12, 2);
  pathSpill.position.set(0.25, 0.9, 8.4);
  group.add(pathSpill);
  lights.interior.push(pathSpill);

  for (const [x, z, intensity] of [[-2.32, frontZ + 0.8, 5.5], [2.32, frontZ + 0.8, 5.5], [sideX + 0.7, 0.5, 3.0]]) {
    const windowLight = new THREE.PointLight(0xffb26d, intensity, 7, 2);
    windowLight.position.set(x, 2.22, z);
    group.add(windowLight);
    lights.interior.push(windowLight);
  }

  // Hanging lantern glow billboard.
  const lanternGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      color: 0xffaf65,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    })
  );
  lanternGlow.scale.setScalar(1.45);
  lanternGlow.position.set(-0.92, 3.0, frontZ + DIM.porchDepth - 0.4);
  group.add(lanternGlow);

  // Door/window glow cards add a faint halo without extra lights.
  for (const [x, y, z, s] of [[-2.32, 2.17, frontZ + 0.45, 2.7], [2.32, 2.17, frontZ + 0.45, 2.7]]) {
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture(),
        color: 0xffad67,
        transparent: true,
        opacity: 0.13,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: true,
      })
    );
    halo.scale.setScalar(s);
    halo.position.set(x, y, z);
    group.add(halo);
  }

  group.userData = {
    lights,
    smokeOrigin: new THREE.Vector3(chimneyX, chimneyTop + 0.95, chimneyZ),
    material: mats,
    dims: DIM,
    porchLanternPosition: new THREE.Vector3(-0.92, 3.0, frontZ + DIM.porchDepth - 0.4),
  };

  mergeStaticMeshes(group);
  return group;
}
