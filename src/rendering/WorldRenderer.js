// ChronoRender: draws the WorldModel with Three.js. It never owns game state;
// every frame it is told the date, the player pose and the NPC snapshot.
//
// World streaming: the terrain, river, road and vegetation are generated
// around the player in a 1.6 km window that is re-centred every 200 m, so
// the deterministic world is effectively unbounded (fixes audit B3).

import * as T from '../../vendor/three/three.module.min.js';
import { terrainHeight, riverCenterX, waterLevel, RIVER_HALF_WIDTH, ROAD_HALF_WIDTH, ROAD_FROM, ROAD_PAVED_FROM } from '../world/WorldModel.js';
import { hourOfDay, dayIndex } from '../core/time.js';
import { hash01 } from '../core/random.js';

const WINDOW = 1600;          // streamed terrain size (m)
const SEGMENTS = 128;
const RECENTER_STEP = 200;
const TREE_RADIUS = 650;
const MAX_TREES = 4000;
const SKY = { clear: 0xaacde3, overcast: 0x9da8ae, fog: 0xb9c1c6, night: 0x0d1626 };

export const WEATHER = ['Derült', 'Borult', 'Köd'];
export function weatherFor(date) {
  const h = hash01('weather', dayIndex(date));
  return h < 0.55 ? 0 : h < 0.85 ? 1 : 2;
}

const STYLE = {
  shelter: { wall: 0x8a6a48, roof: 0x6e5236, roofType: 'cone' },
  windbreak: { wall: 0x7b6040 },
  hearth: { wall: 0x3b3430 },
  cottage: { wall: 0xc8b08a, roof: 0x9a7b45, roofType: 'gable', windows: 0x3d3326 },
  church: { wall: 0xaaa69b, roof: 0x55524c, roofType: 'gable', windows: 0x5a6b78 },
  tower: { wall: 0xa29e93, roof: 0x55524c, roofType: 'pyramid' },
  manor: { wall: 0xb8a27f, roof: 0x6b4a33, roofType: 'gable', windows: 0x46525a },
  villa: { wall: 0xb5835a, roof: 0x4b4f55, roofType: 'gable', windows: 0x6f8ea0 },
  inn: { wall: 0xc9b48a, roof: 0x8c6f3f, roofType: 'gable', windows: 0x3d3326 },
  pub: { wall: 0x9b5a43, roof: 0x494747, roofType: 'gable', windows: 0x6f8ea0 },
  well: { wall: 0x8d8a82, roof: 0x6b4a33 },
  smithy: { wall: 0x7d776c, roof: 0x5c4a36, roofType: 'gable', windows: 0x2b2622 },
  terrace: { wall: 0xa65f48, roof: 0x494747, roofType: 'gable', windows: 0x7298aa },
  modern: { wall: 0xd5d5cf, roof: 0x454e55, roofType: 'flat', windows: 0x7fb3cc },
  factory: { wall: 0x9c5240, roof: 0x3f3d3b, roofType: 'gable', windows: 0x55707f, chimney: true },
  logistics: { wall: 0x9aa3a8, roof: 0x5f676c, roofType: 'flat', windows: 0x88b5c9 },
  pump: { wall: 0x9b5a43, roof: 0x494747, roofType: 'pyramid' },
  windmill: { wall: 0xa0896a, roof: 0x6b4a33, roofType: 'gable' },
  watermill: { wall: 0x958f83, roof: 0x6b4a33, roofType: 'gable', windows: 0x2b2622 },
  bridge: { wall: 0x8a8378 },
};

export class WorldRenderer {
  constructor(container, world) {
    this.world = world;
    this.container = container;
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(70, 1, 0.1, 3000);
    this.renderer = new T.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    container.prepend(this.renderer.domElement);
    this.scene.background = new T.Color(SKY.clear);
    this.scene.fog = new T.FogExp2(SKY.clear, 0.0016);
    this.ambient = new T.HemisphereLight(0xcce5ff, 0x6b6247, 2);
    this.sun = new T.DirectionalLight(0xffe4b7, 2.5);
    this.sun.castShadow = true;
    Object.assign(this.sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, far: 500 });
    this.sun.shadow.mapSize.set(1024, 1024);
    this.scene.add(this.ambient, this.sun, this.sun.target);

    this.materials = new Map();
    this.center = null;
    this.buildingSig = '';
    this.treeKey = '';
    this.buildingGroup = new T.Group();
    this.npcGroup = new T.Group();
    this.markerGroup = new T.Group();
    this.scene.add(this.buildingGroup, this.npcGroup, this.markerGroup);
    this.npcMeshes = new Map();
    this.createTerrain();
    this.createTrees();
    this.playerAvatar = this.humanoid(0x2c5d78, 0xc99b78);
    this.playerAvatar.visible = false;
    this.scene.add(this.playerAvatar);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  mat(color, opts = {}) {
    const key = color + JSON.stringify(opts);
    if (!this.materials.has(key)) this.materials.set(key, new T.MeshStandardMaterial({ color, roughness: 0.9, ...opts }));
    return this.materials.get(key);
  }

  resize() {
    const w = this.container.clientWidth, h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------- terrain
  createTerrain() {
    const g = new T.PlaneGeometry(WINDOW, WINDOW, SEGMENTS, SEGMENTS);
    g.rotateX(-Math.PI / 2);
    this.groundBase = g.attributes.position.array.slice();
    this.ground = new T.Mesh(g, this.mat(0x789451));
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.water = new T.Mesh(new T.BufferGeometry(), new T.MeshStandardMaterial({ color: 0x3f7393, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.88 }));
    this.road = new T.Mesh(new T.BufferGeometry(), this.mat(0xb39b72));
    this.road.receiveShadow = true;
    this.scene.add(this.water, this.road);
  }

  recenter(cx, cz, date) {
    this.center = { x: cx, z: cz };
    const pos = this.ground.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = this.groundBase[i * 3] + cx, z = this.groundBase[i * 3 + 2] + cz;
      pos.setXYZ(i, x, terrainHeight(x, z), z);
    }
    pos.needsUpdate = true;
    this.ground.geometry.computeVertexNormals();
    this.ground.geometry.computeBoundingSphere();
    // River strip following its centre line.
    const wv = [], idx = [];
    for (let i = 0, z = cz - WINDOW / 2; z <= cz + WINDOW / 2; z += 8, i++) {
      const xc = riverCenterX(z), y = waterLevel(z);
      wv.push(xc - RIVER_HALF_WIDTH - 2, y, z, xc + RIVER_HALF_WIDTH + 2, y, z);
      if (i) idx.push(2 * i - 2, 2 * i, 2 * i - 1, 2 * i - 1, 2 * i, 2 * i + 1);
    }
    const wg = new T.BufferGeometry();
    wg.setAttribute('position', new T.Float32BufferAttribute(wv, 3));
    wg.setIndex(idx); wg.computeVertexNormals();
    this.water.geometry.dispose(); this.water.geometry = wg;
    this.roadKey = '';
    this.updateRoad(date);
  }

  updateRoad(date) {
    const key = date < ROAD_FROM ? 'none' : date < ROAD_PAVED_FROM ? 'dirt' : 'paved';
    if (key === this.roadKey) return;
    this.roadKey = key;
    this.road.visible = key !== 'none';
    this.road.material = this.mat(key === 'paved' ? 0x555b60 : 0xa8916a);
    const v = [], idx = [], cx = this.center.x;
    for (let i = 0, x = cx - WINDOW / 2; x <= cx + WINDOW / 2; x += 4, i++) {
      for (const z of [-ROAD_HALF_WIDTH, ROAD_HALF_WIDTH]) v.push(x, Math.max(terrainHeight(x, z), terrainHeight(x, 0)) + 0.12, z);
      if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(v, 3));
    g.setIndex(idx); g.computeVertexNormals();
    this.road.geometry.dispose(); this.road.geometry = g;
  }

  // --------------------------------------------------------------- trees
  createTrees() {
    const trunk = new T.CylinderGeometry(0.3, 0.45, 4, 6); trunk.translate(0, 2, 0);
    const cone = new T.ConeGeometry(2.8, 7, 7); cone.translate(0, 7, 0);
    const ball = new T.IcosahedronGeometry(3.2, 0); ball.translate(0, 6.5, 0);
    const mk = (g, c) => { const m = new T.InstancedMesh(g, this.mat(c), MAX_TREES); m.castShadow = true; m.count = 0; m.frustumCulled = false; this.scene.add(m); return m; };
    this.trunks = mk(trunk, 0x715137);
    this.cones = mk(cone, 0x365e32);
    this.balls = mk(ball, 0x4d7a3a);
  }

  updateTrees(date) {
    const key = `${this.center.x},${this.center.z},${Math.floor(date)}`;
    if (key === this.treeKey) return;
    this.treeKey = key;
    const trees = this.world.treesNear(this.center.x, this.center.z, TREE_RADIUS, date).slice(0, MAX_TREES);
    const m = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3();
    let nt = 0, nc = 0, nb = 0;
    for (const t of trees) {
      p.set(t.x, terrainHeight(t.x, t.z) - 0.2, t.z); s.setScalar(t.scale);
      m.compose(p, q, s);
      this.trunks.setMatrixAt(nt++, m);
      if (t.kind === 'conifer') this.cones.setMatrixAt(nc++, m); else this.balls.setMatrixAt(nb++, m);
    }
    for (const [mesh, n] of [[this.trunks, nt], [this.cones, nc], [this.balls, nb]]) { mesh.count = n; mesh.instanceMatrix.needsUpdate = true; }
    this.treeCount = nt;
  }

  // ----------------------------------------------------------- buildings
  updateBuildings(date) {
    const list = this.world.buildingsAt(date);
    const sig = list.map(b => b.id).join('|');
    if (sig === this.buildingSig) return;
    this.buildingSig = sig;
    for (const c of [...this.buildingGroup.children]) { c.traverse(o => { if (o.isMesh && o.userData.ownGeo) o.geometry.dispose(); }); this.buildingGroup.remove(c); }
    for (const b of list) this.buildingGroup.add(this.buildingMesh(b));
    this.buildingCount = list.length;
  }

  box(group, w, h, d, color, x, y, z) {
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), this.mat(color));
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; m.userData.ownGeo = true;
    group.add(m); return m;
  }

  buildingMesh(b) {
    const s = STYLE[b.style] || STYLE.cottage;
    const g = new T.Group();
    g.userData.buildingId = b.id;
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([i, j]) => terrainHeight(b.x + i * b.w / 2, b.z + j * b.d / 2));
    const y0 = b.style === 'bridge' ? Math.max(terrainHeight(b.x - b.w / 2, b.z), terrainHeight(b.x + b.w / 2, b.z)) : Math.min(...corners);
    g.position.set(b.x, y0, b.z);
    const front = b.z > 0 ? -1 : 1; // doors face the road
    if (b.style === 'shelter') {
      const m = new T.Mesh(new T.ConeGeometry(b.w / 2, b.h, 7), this.mat(s.wall)); m.position.y = b.h / 2; m.castShadow = true; m.userData.ownGeo = true; g.add(m);
      return g;
    }
    if (b.style === 'hearth') {
      this.box(g, b.w, b.h, b.d, s.wall, 0, b.h / 2, 0);
      const fire = new T.Mesh(new T.ConeGeometry(0.35, 0.8, 6), new T.MeshBasicMaterial({ color: 0xff8a2a })); fire.position.y = b.h + 0.35; fire.userData.ownGeo = true; g.add(fire);
      return g;
    }
    if (b.style === 'bridge') { this.box(g, b.w, b.h, b.d, s.wall, 0, b.h / 2 + 0.1, 0); return g; }
    const foundation = Math.max(...corners) - y0;
    const h = b.h + foundation;
    if (b.style === 'well') {
      const m = new T.Mesh(new T.CylinderGeometry(b.w / 2, b.w / 2, 1 + foundation, 10), this.mat(s.wall)); m.position.y = (1 + foundation) / 2; m.userData.ownGeo = true; m.castShadow = true; g.add(m);
      for (const sx of [-1, 1]) this.box(g, 0.12, 2.2, 0.12, 0x5c4a36, sx * b.w / 2 * 0.8, 1.1 + foundation, 0);
      this.box(g, b.w * 1.2, 0.15, b.d * 0.8, s.roof, 0, 2.3 + foundation, 0);
      return g;
    }
    this.box(g, b.w, h, b.d, s.wall, 0, h / 2, 0);
    if (s.roofType === 'gable') this.gable(g, b.w, b.d, h, b.h * 0.45, s.roof);
    else if (s.roofType === 'pyramid') { const r = new T.Mesh(new T.ConeGeometry(Math.max(b.w, b.d) * 0.75, b.h * 0.5, 4), this.mat(s.roof)); r.rotation.y = Math.PI / 4; r.position.y = h + b.h * 0.25; r.castShadow = true; r.userData.ownGeo = true; g.add(r); }
    else if (s.roofType === 'flat') this.box(g, b.w + 0.4, 0.4, b.d + 0.4, s.roof, 0, h + 0.2, 0);
    if (s.windows) {
      const fz = front * (b.d / 2 + 0.06);
      this.box(g, 1.2, 2.2, 0.12, 0x59432e, 0, foundation + 1.1, fz);
      const n = Math.max(1, Math.floor(b.w / 6));
      for (let i = 0; i < n; i++) for (const side of [-1, 1]) {
        const wx = side * (1.8 + i * (b.w / 2 - 2) / n);
        if (Math.abs(wx) < b.w / 2 - 0.6) this.box(g, 1.1, 1.2, 0.12, s.windows, wx, foundation + Math.min(b.h * 0.6, 2.6), fz);
      }
    }
    if (s.chimney) { const c = new T.Mesh(new T.CylinderGeometry(0.8, 1, b.h * 2.2, 10), this.mat(0x7d3f30)); c.position.set(b.w / 2 - 2, b.h * 1.1, -front * (b.d / 2 - 2)); c.castShadow = true; c.userData.ownGeo = true; g.add(c); }
    if (b.style === 'windmill') {
      const sails = new T.Group(); sails.position.set(0, h * 0.8, front * (b.d / 2 + 0.4));
      for (let i = 0; i < 4; i++) { const sail = this.box(sails, 0.9, 7, 0.1, 0xe8e2d0, 0, 3.5, 0); sail.parent.remove(sail); const arm = new T.Group(); arm.rotation.z = (i * Math.PI) / 2; arm.add(sail); sails.add(arm); }
      sails.userData.spin = true; g.add(sails);
    }
    if (b.style === 'watermill') { const wheel = new T.Mesh(new T.CylinderGeometry(2.6, 2.6, 0.8, 14), this.mat(0x5c4a36)); wheel.rotation.z = Math.PI / 2; wheel.position.set(-b.w / 2 - 0.5, 1.5, 0); wheel.userData.ownGeo = true; wheel.userData.spinX = true; g.add(wheel); }
    return g;
  }

  gable(group, w, d, baseY, rise, color) {
    const s = new T.Shape();
    s.moveTo(-w / 2 - 0.4, 0); s.lineTo(w / 2 + 0.4, 0); s.lineTo(0, rise); s.closePath();
    const geo = new T.ExtrudeGeometry(s, { depth: d + 0.8, bevelEnabled: false });
    geo.translate(0, 0, -(d + 0.8) / 2);
    const m = new T.Mesh(geo, this.mat(color)); m.position.y = baseY; m.castShadow = true; m.userData.ownGeo = true;
    group.add(m);
  }

  // ---------------------------------------------------------- characters
  humanoid(cloth, skin) {
    const m = new T.Group();
    const part = (geo, col, px, py) => { const q = new T.Mesh(geo, this.mat(col)); q.position.set(px, py, 0); q.castShadow = true; m.add(q); return q; };
    part(new T.BoxGeometry(0.44, 0.62, 0.25), cloth, 0, 1.12);
    part(new T.SphereGeometry(0.15, 12, 8), skin, 0, 1.65);
    m.userData.legs = [-1, 1].map(side => part(new T.BoxGeometry(0.15, 0.7, 0.17), 0x49423a, side * 0.12, 0.38));
    for (const side of [-1, 1]) part(new T.BoxGeometry(0.13, 0.55, 0.15), cloth, side * 0.3, 1.1);
    return m;
  }

  clothFor(npc, date) {
    const palette = date < 0 ? [0x7a5a3a, 0x6e5236] : date < 1600 ? [0x806344, 0x6d6a4f, 0x8a4f3a, 0x5d5a6b] : date < 1950 ? [0x3f3f46, 0x5a4636, 0x2f3d4f, 0x6b2f2f] : [0x426c93, 0x8a2f4a, 0x3f7a5a, 0xd0a040, 0x555555];
    return palette[Math.floor(hash01('cloth', npc.id) * palette.length)];
  }

  updateNPCs(npcs, date, dt) {
    const seen = new Set();
    for (const n of npcs) {
      if (!n.visible) continue;
      seen.add(n.id);
      let m = this.npcMeshes.get(n.id);
      if (!m) {
        m = this.humanoid(this.clothFor(n, date), [0xc99b78, 0xa8765a, 0xe0b896, 0x7a5236][Math.floor(hash01('skin', n.id) * 4)]);
        const scale = n.age < 14 ? 0.55 + n.age * 0.03 : 1;
        m.scale.setScalar(scale);
        m.position.set(n.x, terrainHeight(n.x, n.z), n.z);
        this.npcGroup.add(m); this.npcMeshes.set(n.id, m);
      }
      const dx = n.x - m.position.x, dz = n.z - m.position.z, dist = Math.hypot(dx, dz);
      const k = dist > 30 ? 1 : Math.min(1, dt * 2);
      m.position.x += dx * k; m.position.z += dz * k;
      m.position.y = terrainHeight(m.position.x, m.position.z);
      if (dist > 0.05) m.rotation.y = Math.atan2(dx, dz);
      const walk = Math.min(1, dist * 2);
      m.userData.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(performance.now() / 160 + i * Math.PI) * 0.5 * walk; });
    }
    for (const [id, m] of this.npcMeshes) if (!seen.has(id)) { this.npcGroup.remove(m); this.npcMeshes.delete(id); }
  }

  npcPosition(id) { const m = this.npcMeshes.get(id); return m ? m.position : null; }

  // ------------------------------------------------------------- markers
  updateMarkers(anchors, dt) {
    const sig = anchors.map(a => a.id + ':' + a.usable).join('|');
    if (sig !== this.markerSig) {
      this.markerSig = sig;
      for (const c of [...this.markerGroup.children]) { c.material.dispose(); this.markerGroup.remove(c); }
      this.markerGeo ||= new T.OctahedronGeometry(0.65);
      for (const a of anchors) {
        const b = this.world.getObject(a.objectId);
        if (!b) continue;
        const m = new T.Mesh(this.markerGeo, new T.MeshBasicMaterial({ color: a.usable ? 0x55eaff : 0xff7a55, transparent: true, opacity: a.usable ? 1 : 0.45 }));
        m.position.set(b.x, terrainHeight(b.x, b.z) + b.h + (b.style === 'tower' ? 10 : 6), b.z);
        m.visible = a.visible !== false;
        this.markerGroup.add(m);
      }
    }
    for (const m of this.markerGroup.children) m.rotation.y += dt;
  }

  // --------------------------------------------------------------- frame
  update({ date, player, npcs, anchors, thirdPerson, dt }) {
    if (!this.center || Math.abs(player.x - this.center.x) > RECENTER_STEP || Math.abs(player.z - this.center.z) > RECENTER_STEP) {
      this.recenter(Math.round(player.x / RECENTER_STEP) * RECENTER_STEP, Math.round(player.z / RECENTER_STEP) * RECENTER_STEP, date);
    }
    this.updateRoad(date);
    this.updateTrees(date);
    this.updateBuildings(date);
    this.updateNPCs(npcs, date, dt);
    this.updateMarkers(anchors, dt);
    this.buildingGroup.traverse(o => { if (o.userData.spin) o.rotation.z += dt * 0.6; if (o.userData.spinX) o.rotation.x += dt * 0.8; });
    this.ground.material = this.mat(date < 1000 ? 0x5f7f45 : 0x789451);

    const eyeY = terrainHeight(player.x, player.z) + 1.7;
    this.playerAvatar.visible = thirdPerson;
    if (thirdPerson) {
      this.playerAvatar.position.set(player.x, eyeY - 1.7, player.z);
      this.playerAvatar.rotation.y = player.yaw + Math.PI;
      const back = 5;
      const cx = player.x + Math.sin(player.yaw) * back * Math.cos(player.pitch), cz = player.z + Math.cos(player.yaw) * back * Math.cos(player.pitch);
      this.camera.position.set(cx, Math.max(terrainHeight(cx, cz) + 0.5, eyeY + 0.6 - Math.sin(player.pitch) * back), cz);
      this.camera.lookAt(player.x, eyeY, player.z);
    } else {
      this.camera.position.set(player.x, eyeY, player.z);
      this.camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    }
    this.light(date);
    this.sun.target.position.set(player.x, 0, player.z);
    this.renderer.render(this.scene, this.camera);
  }

  light(date) {
    const hour = hourOfDay(date), weather = weatherFor(date);
    const daylight = Math.max(0.06, Math.sin(((hour - 6) * Math.PI) / 12));
    const sky = new T.Color(daylight < 0.15 ? SKY.night : [SKY.clear, SKY.overcast, SKY.fog][weather]);
    if (daylight >= 0.15 && daylight < 0.35) sky.lerp(new T.Color(0xe0a070), 0.35);
    this.scene.background = sky;
    this.scene.fog.color.copy(sky);
    this.scene.fog.density = [0.0016, 0.003, 0.012][weather];
    this.ambient.intensity = 0.25 + daylight * 1.75 * (weather === 1 ? 0.8 : 1);
    this.sun.intensity = daylight * 2.5 * (weather === 0 ? 1 : 0.35);
    const px = this.sun.target.position.x, pz = this.sun.target.position.z;
    this.sun.position.set(px + Math.cos((hour * Math.PI) / 12) * 120, Math.max(5, daylight * 150), pz + 70);
    this.weather = weather;
  }
}
