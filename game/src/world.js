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

function makeSignTexture(text, bg, fg) {
  // Canvas shop sign: bold capitals on a flat colour panel.
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 96);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, 504, 88);
  ctx.fillStyle = fg;
  ctx.font = '900 52px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSkyDome() {
  // Gradient sky dome: warm orange band low at the horizon, dusk purple
  // above. Fine segments (48x24): the coarse 24x12 dome drew its colour
  // band as a peaked orange triangle at every vanishing point.
  const geo = new THREE.SphereGeometry(900, 48, 24);
  const top = new THREE.Color(COLORS.sky);
  const bottom = new THREE.Color(COLORS.horizon);
  const colors = [];
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 900; // -1..1
    // Orange hugs the horizon (t=0 at/below it, purple by y≈+0.09): a thin
    // sunset band, not a dome that fills half the sky.
    const t = THREE.MathUtils.clamp((y + 0.02) / 0.09, 0, 1);
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
  // Golden hour: low warm sun from the east-southeast, so shadows stretch
  // long toward the beach (west). Sun elevation ~12 degrees.
  const sun = new THREE.DirectionalLight(COLORS.sun, 2.7);
  sun.position.set(240, 55, 120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -260;
  sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260;
  sun.shadow.camera.bottom = -260;
  sun.shadow.camera.far = 700;
  sun.shadow.bias = -0.0004;
  group.add(sun);
  group.add(new THREE.HemisphereLight(0xffc98a, 0x7a5a44, 0.75));
  scene.add(makeSkyDome());
  scene.fog = new THREE.Fog(COLORS.fog, 200, 560);

  // --- Ground -----------------------------------------------------------
  // The ground stops at the water's edge (x=-240): it used to span to
  // x=-480 at y=0, which buried the ocean plane (y=-0.25) underneath it —
  // the ocean never rendered. West of -240 the ocean is the top surface.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(560, CITY_SIZE + 320),
    new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(40, 0, 0);
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
  // Sand is ONLY the strip between the beachfront road and the water
  // (x -238..-218). It used to span half the city, which buried the ocean
  // plane and turned the whole west side into one beige lot.
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(20, CITY_SIZE),
    new THREE.MeshStandardMaterial({ color: COLORS.sand, roughness: 1 }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(-228, 0.03, 0);
  sand.receiveShadow = true;
  group.add(sand);

  const oceanGeo = new THREE.PlaneGeometry(240, CITY_SIZE + 320);
  const oceanMat = new THREE.MeshStandardMaterial({
    color: 0x35b0d8, roughness: 0.25, metalness: 0.1,
    transparent: true, opacity: 0.94,
    emissive: 0x0a4a6a, emissiveIntensity: 1.0,
  });
  const ocean = new THREE.Mesh(oceanGeo, oceanMat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(-HALF_CITY - 120, -0.25, 0);
  group.add(ocean);
  // second deeper band for depth, stretched far west so no void shows
  // past the ocean at the horizon
  const deep = new THREE.Mesh(
    new THREE.PlaneGeometry(300, CITY_SIZE + 320),
    new THREE.MeshStandardMaterial({ color: 0x146a94, roughness: 0.3 }),
  );
  deep.rotation.x = -Math.PI / 2;
  deep.position.set(-HALF_CITY - 360, -0.5, 0);
  group.add(deep);

  // --- Building facades --------------------------------------------------
  // Varied warm/cool facades so blocks read as distinct buildings, not a
  // grey field; dusk lit-window ratio is higher than midday.
  const palettes = ['#c8a887', '#9fb4c4', '#d9c9a8', '#b08a7a', '#8fa8a0', '#c4b8d4', '#e07840', '#5a8a9a', '#d4556a', '#7a9a5a'];
  const facadeMats = palettes.map((p) => new THREE.MeshStandardMaterial({
    map: makeFacadeTexture(rng, p, 0.38), roughness: 0.9,
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
  for (let z = -220; z <= 220; z += 22) {
    // No beach-row palms through the harbor (z 30..90): they stood in the
    // middle of the mission shot, blocking the guards and containers.
    if (z > 30 && z < 90) continue;
    palmSpots.push([BEACH_X - 8 + rng.range(-4, 4), z]);
  }
  // Second row lining the east side of the beachfront road, so the
  // beachfront boulevard reads as a palm avenue from either direction.
  // No palms within 8 m of a sign board: a trunk in front of the panel
  // cut "CORAL HOTEL" and "SUNSET MOTEL" in half.
  for (let z = -208; z <= 220; z += 26) {
    if (Math.abs(z - (-30)) < 8 || Math.abs(z - 40) < 8) continue;
    palmSpots.push([-200 + rng.range(-2, 2), z]);
  }
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

  // --- Named signs + harbor dressing ------------------------------------
  // Freestanding sign boards (posts + lit panel), placed to face the road
  // or the shot camera: the city gets its own names at a glance.
  const signDefs = [
    { text: "MARA'S GARAGE", bg: '#1a2a44', fg: '#ffc233', x: 98, z: 16, ry: Math.PI / 2 },
    { text: 'VICE CLUB', bg: '#5a1a6e', fg: '#ff6ad5', x: -20, z: -46, ry: 0 },
    { text: '24H MART', bg: '#0d5a2e', fg: '#ffffff', x: 58, z: 110, ry: Math.PI },
    { text: 'CORAL HOTEL', bg: '#8a2f2f', fg: '#ffd98a', x: -199, z: -30, ry: 0 },
    { text: 'VICE HARBOR', bg: '#123a4a', fg: '#7fd4ff', x: -220, z: 44, ry: Math.PI / 2 },
    { text: 'SUNSET MOTEL', bg: '#c25a1e', fg: '#ffffff', x: -218, z: 40, ry: Math.PI / 2 },
  ];
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.7, metalness: 0.4 });
  const postGeo = new THREE.BoxGeometry(0.3, 3.4, 0.3);
  for (const s of signDefs) {
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 2.1),
      new THREE.MeshStandardMaterial({ map: makeSignTexture(s.text, s.bg, s.fg), roughness: 0.6, emissive: 0xffffff, emissiveMap: makeSignTexture(s.text, s.bg, s.fg), emissiveIntensity: 0.25 }),
    );
    panel.position.set(s.x, 4.4, s.z);
    panel.rotation.y = s.ry;
    group.add(panel);
    for (const off of [-4.5, 4.5]) {
      const post = new THREE.Mesh(postGeo, postMat);
      // Posts sit under the panel ends, offset along the panel's local X.
      const dx = Math.cos(s.ry) * off;
      const dz = -Math.sin(s.ry) * off;
      post.position.set(s.x + dx, 1.7, s.z + dz);
      group.add(post);
    }
  }

  // Harbor: stacked shipping containers, crates, barrels, a dock pier over
  // the water and a gantry crane — around spawn (-226, 60), west edge.
  const containerCols = [0x8a2f2f, 0x1e5a8a, 0x2e7d5a, 0xc27a1e, 0x5a4a8a];
  const containerGeo = new THREE.BoxGeometry(6, 2.6, 2.6);
  const containerSpots = [
    [-233, 44, 0, 0], [-233, 47.5, 0, 1], [-233, 44, 2.6, 0],
    [-233, 78, 0, 2], [-233, 81.5, 0, 3], [-228, 40, 0, 4],
    [-228, 82, 0, 1], [-236, 62, 0, 2],
  ];
  for (const [cx, cz, cy, ci] of containerSpots) {
    const cont = new THREE.Mesh(containerGeo, new THREE.MeshStandardMaterial({ color: containerCols[ci % containerCols.length], roughness: 0.85, metalness: 0.2 }));
    cont.position.set(cx, 1.3 + cy, cz);
    cont.castShadow = true;
    cont.receiveShadow = true;
    group.add(cont);
    colliders.push({ x: cx, z: cz, hw: 3, hd: 1.3 });
  }
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x9a7a4a, roughness: 1 });
  const crateGeo = new THREE.BoxGeometry(1.6, 1.6, 1.6);
  for (const [cx, cz] of [[-228, 54], [-227, 57], [-229, 66], [-226, 70], [-230, 50], [-224, 62]]) {
    const crate = new THREE.Mesh(crateGeo, crateMat);
    crate.position.set(cx, 0.8, cz);
    crate.rotation.y = rng.range(0, Math.PI);
    crate.castShadow = true;
    group.add(crate);
  }
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x3a6a8a, roughness: 0.7, metalness: 0.3 });
  const barrelGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.1, 10);
  for (const [bx, bz] of [[-231, 56], [-231, 58], [-225, 48], [-227, 74]]) {
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(bx, 0.55, bz);
    barrel.castShadow = true;
    group.add(barrel);
  }
  // Dock pier: planks running west out over the water at z 56..64.
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x7a5a38, roughness: 1 });
  const pier = new THREE.Mesh(new THREE.BoxGeometry(16, 0.5, 8), pierMat);
  pier.position.set(-244, 0.25, 60);
  pier.receiveShadow = true;
  group.add(pier);
  // Gantry crane over the containers: two legs + top beam.
  const craneMat = new THREE.MeshStandardMaterial({ color: 0xc2a01e, roughness: 0.6, metalness: 0.4 });
  for (const lz of [42, 82]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 18, 1.2), craneMat);
    leg.position.set(-234, 9, lz);
    leg.castShadow = true;
    group.add(leg);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 46), craneMat);
  beam.position.set(-234, 18.5, 62);
  beam.castShadow = true;
  group.add(beam);

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
