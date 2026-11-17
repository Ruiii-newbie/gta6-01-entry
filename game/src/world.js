// Vice Coast — procedural city.
// Grid of roads, building blocks with canvas window facades, beach + ocean
// on the west edge, palms, street props, sun + sky + fog. Deterministic
// from WORLD_SEED. Flat ground (y = 0).
import * as THREE from 'three';
import {
  CITY_SIZE, HALF_CITY, BLOCK, ROAD_WIDTH, ROAD_LINES, BLOCK_CENTERS,
  WORLD_SEED, BEACH_X, WATER_X, COLORS,
} from './config.js';
import { RNG } from './random.js';
import { G } from './state.js';

const ROAD_HALF = ROAD_WIDTH / 2;

function makeFacadeTexture(rng, base, lit) {
  // Canvas-generated window facade: lit/unlit window grid on a tinted wall.
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 256);
  // subtle vertical shading
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)');
  grad.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 256);
  const cols = 5;
  const rows = 10;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const wx = 8 + x * 24;
      const wy = 10 + y * 24;
      const on = rng.next() < lit;
      ctx.fillStyle = on ? '#ffd98a' : '#2c3e50';
      ctx.fillRect(wx, wy, 16, 14);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(wx, wy, 16, 3);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRoadTexture() {
  // Asphalt with a dashed centre line and edge lines; repeats along the road.
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#33363b';
  ctx.fillRect(0, 0, 64, 128);
  // speckle
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * 64, Math.random() * 128, 2, 2);
  }
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(4, 0, 2, 128);
  ctx.fillRect(58, 0, 2, 128);
  ctx.fillStyle = '#f7d154';
  ctx.fillRect(30, 8, 4, 48);
  ctx.fillRect(30, 72, 4, 48);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSkyDome() {
  // Gradient sky dome: warm horizon, blue zenith.
  const geo = new THREE.SphereGeometry(900, 24, 12);
  const top = new THREE.Color(COLORS.sky);
  const bottom = new THREE.Color(COLORS.horizon);
  const colors = [];
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 900; // -1..1
    const t = THREE.MathUtils.clamp((y + 0.08) / 0.9, 0, 1);
    const col = bottom.clone().lerp(top, t);
    colors.push(col.r, col.g, col.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.renderOrder = -10;
  return dome;
}

export function buildWorld(scene) {
  const rng = new RNG(WORLD_SEED);
  const group = new THREE.Group();
  group.name = 'vice-coast-city';
  scene.add(group);

  const buildings = [];
  const colliders = [];

  // --- Lights, sky, fog -------------------------------------------------
  const sun = new THREE.DirectionalLight(COLORS.sun, 2.4);
  sun.position.set(160, 220, 90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -260;
  sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260;
  sun.shadow.camera.bottom = -260;
  sun.shadow.camera.far = 700;
  sun.shadow.bias = -0.0004;
  group.add(sun);
  group.add(new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5a, 0.85));
  scene.add(makeSkyDome());
  scene.fog = new THREE.Fog(COLORS.fog, 200, 560);

  // --- Ground -----------------------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY_SIZE + 320, CITY_SIZE + 320),
    new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(-80, 0, 0); // extend further west under the ocean
  ground.receiveShadow = true;
  group.add(ground);

  // --- Roads ------------------------------------------------------------
  const roadTex = makeRoadTexture();
  for (const line of ROAD_LINES) {
    for (const horizontal of [true, false]) {
      const tex = roadTex.clone();
      tex.needsUpdate = true;
      tex.repeat.set(1, CITY_SIZE / 16);
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
      const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, CITY_SIZE), mat);
      road.rotation.x = -Math.PI / 2;
      if (horizontal) {
        road.rotation.z = Math.PI / 2;
        road.position.set(0, 0.02, line);
      } else {
        road.position.set(line, 0.02, 0);
      }
      road.receiveShadow = true;
      group.add(road);
    }
  }

  // --- Beach + ocean (west edge) ----------------------------------------
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF_CITY - BEACH_X + 26, CITY_SIZE),
    new THREE.MeshStandardMaterial({ color: COLORS.sand, roughness: 1 }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set((BEACH_X - HALF_CITY) / 2 - 13, 0.03, 0);
  sand.receiveShadow = true;
  group.add(sand);

  const oceanGeo = new THREE.PlaneGeometry(220, CITY_SIZE + 320);
  const oceanMat = new THREE.MeshStandardMaterial({
    color: COLORS.ocean, roughness: 0.35, metalness: 0.1,
    transparent: true, opacity: 0.94,
  });
  const ocean = new THREE.Mesh(oceanGeo, oceanMat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(-HALF_CITY - 110, -0.25, 0);
  group.add(ocean);
  // second deeper band for depth
  const deep = new THREE.Mesh(
    new THREE.PlaneGeometry(120, CITY_SIZE + 320),
    new THREE.MeshStandardMaterial({ color: COLORS.oceanDeep, roughness: 0.3 }),
  );
  deep.rotation.x = -Math.PI / 2;
  deep.position.set(-HALF_CITY - 270, -0.5, 0);
  group.add(deep);

  // --- Building facades --------------------------------------------------
  const palettes = ['#c8a887', '#9fb4c4', '#d9c9a8', '#b08a7a', '#8fa8a0', '#c4b8d4'];
  const facadeMats = palettes.map((p) => new THREE.MeshStandardMaterial({
    map: makeFacadeTexture(rng, p, 0.22), roughness: 0.9,
  }));
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x6b6f75, roughness: 1 });
  const acMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.8, metalness: 0.3 });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const acGeo = new THREE.BoxGeometry(2, 1, 2);
  const antennaGeo = new THREE.CylinderGeometry(0.08, 0.12, 6, 6);
  const antennaMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6, metalness: 0.6 });

  function addBuilding(x, z, w, d, h) {
    const mat = facadeMats[Math.floor(rng.next() * facadeMats.length)];
    const mesh = new THREE.Mesh(boxGeo, mat);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    // rooftop slab
    const roof = new THREE.Mesh(boxGeo, roofMat);
    roof.scale.set(w + 0.4, 0.5, d + 0.4);
    roof.position.set(x, h + 0.25, z);
    group.add(roof);
    // rooftop AC unit / antenna
    if (rng.chance(0.6)) {
      const ac = new THREE.Mesh(acGeo, acMat);
      ac.position.set(x + rng.range(-w / 4, w / 4), h + 1, z + rng.range(-d / 4, d / 4));
      ac.castShadow = true;
      group.add(ac);
    }
    if (rng.chance(0.35)) {
      const ant = new THREE.Mesh(antennaGeo, antennaMat);
      ant.position.set(x + rng.range(-w / 3, w / 3), h + 3.5, z + rng.range(-d / 3, d / 3));
      group.add(ant);
    }
    buildings.push({ x, z, w, d, h });
    colliders.push({ x, z, hw: w / 2, hd: d / 2 });
  }

  const sidewalkMat = new THREE.MeshStandardMaterial({ color: COLORS.sidewalk, roughness: 1 });
  const parkMat = new THREE.MeshStandardMaterial({ color: 0x6f9a52, roughness: 1 });
  const slabGeo = new THREE.BoxGeometry(BLOCK, 0.3, BLOCK);

  for (const bx of BLOCK_CENTERS) {
    for (const bz of BLOCK_CENTERS) {
      const downtown = Math.abs(bx) < 80 && Math.abs(bz) < 80;
      // sidewalk slab under every block
      const slab = new THREE.Mesh(slabGeo, rng.chance(0.14) ? parkMat : sidewalkMat);
      slab.position.set(bx, 0.15, bz);
      slab.receiveShadow = true;
      group.add(slab);

      if (rng.chance(0.14)) {
        // park block: palms only, no buildings
        continue;
      }
      const hBase = downtown ? rng.range(20, 40) : rng.range(8, 22);
      const style = rng.next();
      if (style < 0.45) {
        // one big tower
        addBuilding(bx, bz, rng.range(26, 34), rng.range(26, 34), hBase);
      } else if (style < 0.8) {
        // two slabs
        addBuilding(bx - 9, bz, rng.range(16, 20), rng.range(26, 32), hBase * rng.range(0.6, 1));
        addBuilding(bx + 9, bz, rng.range(16, 20), rng.range(26, 32), hBase * rng.range(0.6, 1));
      } else {
        // four small shops
        for (const [ox, oz] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) {
          addBuilding(bx + ox, bz + oz, rng.range(13, 16), rng.range(13, 16), rng.range(8, 14));
        }
      }
    }
  }

  // --- Palm trees (instanced) -------------------------------------------
  const palmSpots = [];
  for (let z = -220; z <= 220; z += 22) palmSpots.push([BEACH_X - 8 + rng.range(-4, 4), z]);
  for (let i = 0; i < 40; i++) {
    // scattered palms in parks / along roads
    const bx = BLOCK_CENTERS[Math.floor(rng.next() * BLOCK_CENTERS.length)];
    const bz = BLOCK_CENTERS[Math.floor(rng.next() * BLOCK_CENTERS.length)];
    palmSpots.push([bx + rng.range(-17, 17), bz + rng.range(-17, 17)]);
  }
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 5, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: COLORS.palmTrunk, roughness: 1 });
  const crownGeo = new THREE.ConeGeometry(2.4, 2.2, 7);
  const crownMat = new THREE.MeshStandardMaterial({ color: COLORS.palmLeaf, roughness: 0.9 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmSpots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, palmSpots.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const eul = new THREE.Euler();
  palmSpots.forEach(([x, z], i) => {
    const lean = rng.range(-0.08, 0.08);
    eul.set(lean, rng.range(0, Math.PI * 2), lean * 0.5);
    q.setFromEuler(eul);
    m4.compose(new THREE.Vector3(x, 2.5, z), q, new THREE.Vector3(1, 1, 1));
    trunks.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(x, 5.6, z), q, new THREE.Vector3(1, 0.8, 1));
    crowns.setMatrixAt(i, m4);
  });
  trunks.castShadow = true;
  crowns.castShadow = true;
  group.add(trunks);
  group.add(crowns);

  // --- Street lamps (instanced) -----------------------------------------
  const lampSpots = [];
  for (const line of ROAD_LINES) {
    for (let t = -220; t <= 220; t += 52) {
      lampSpots.push([line + 7.5, t]);
      lampSpots.push([line - 7.5, t + 26]);
    }
  }
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 6, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: COLORS.lampPole, roughness: 0.7, metalness: 0.4 });
  const headGeo = new THREE.BoxGeometry(0.5, 0.25, 1.4);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x444444, emissive: 0xffdf9a, emissiveIntensity: 0.7, roughness: 0.5,
  });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampSpots.length);
  const heads = new THREE.InstancedMesh(headGeo, headMat, lampSpots.length);
  lampSpots.forEach(([x, z], i) => {
    m4.compose(new THREE.Vector3(x, 3, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    poles.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(x, 6.1, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    heads.setMatrixAt(i, m4);
  });
  group.add(poles);
  group.add(heads);

  // --- Hydrants (instanced, small colliders) ----------------------------
  const hydGeo = new THREE.CylinderGeometry(0.3, 0.35, 0.9, 8);
  const hydMat = new THREE.MeshStandardMaterial({ color: COLORS.hydrant, roughness: 0.6 });
  const hydSpots = [];
  for (let i = 0; i < 24; i++) {
    const line = ROAD_LINES[Math.floor(rng.next() * ROAD_LINES.length)];
    const t = rng.range(-220, 220);
    hydSpots.push(rng.chance(0.5) ? [line + 7.2, t] : [t, line + 7.2]);
  }
  const hydrants = new THREE.InstancedMesh(hydGeo, hydMat, hydSpots.length);
  hydSpots.forEach(([x, z], i) => {
    m4.compose(new THREE.Vector3(x, 0.45, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    hydrants.setMatrixAt(i, m4);
    colliders.push({ x, z, hw: 0.4, hd: 0.4 });
  });
  group.add(hydrants);

  // --- Collision / road queries ------------------------------------------
  function isBlocked(x, z, r = 0.6) {
    if (x < WATER_X + 2 || x > HALF_CITY - 2 || z < -HALF_CITY + 2 || z > HALF_CITY - 2) return true;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      const dx = Math.max(Math.abs(x - c.x) - c.hw, 0);
      const dz = Math.max(Math.abs(z - c.z) - c.hd, 0);
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  function roadAt(x, z) {
    if (Math.abs(x) > HALF_CITY || Math.abs(z) > HALF_CITY) return false;
    for (const line of ROAD_LINES) {
      if (Math.abs(x - line) <= ROAD_HALF || Math.abs(z - line) <= ROAD_HALF) return true;
    }
    return false;
  }

  const world = {
    group,
    buildings,
    colliders,
    ocean,
    spawnPoints: {
      player: [0, 20],
      garage: [104, 8],
      harbor: [-226, 60],
      pickup: [52, 104],
    },
    isBlocked,
    roadAt,
  };
  G.world = world;
  return world;
}
