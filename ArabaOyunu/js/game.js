import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { DualSense, TriggerFX } from './dualsense.js';

// =====================================================================
//  AÇIK DÜNYA ARABA SÜRME — Three.js + WebHID DualSense
//  Trafik, trafik lambaları, kaldırımlar, hasar/patlama, boost, drift
// =====================================================================

const WORLD = 1400;     // dünya yarı boyutu
const BLOCK = 120;      // şehir blok aralığı
const ROAD_HALF = 9;    // yol yarı genişliği
const LANE = 4.5;       // trafik şerit ofseti
const N = Math.floor(WORLD / BLOCK);

let renderer, scene, camera, composer, bloomPass, labelRenderer;
const clock = new THREE.Clock();
let sun, sunDir;

let gameStarted = false;
const choice = { name: 'Sürücü', color: 0xc1121f, model: 'spor' };
let playerLabel;

// ---- Araç modelleri & renk seçenekleri ----
const MODELS = [
  { key: 'spor', label: 'Spor' },
  { key: 'klasik', label: 'Klasik' },
  { key: 'kamyon', label: 'Kamyon' }
];
const COLORS = [0xc1121f, 0x2a6cff, 0x19c37d, 0xffb020, 0xff4dd2, 0x111418, 0xffffff, 0x8a2be2];

// ---- Çok oyunculu ----
const net = { ws: null, id: null, connected: false, players: new Map(), sendT: 0 };

const buildingBoxes = [];
let car, carContact, boostFlames = [], wheels = [], frontWheels = [], brakeLights = [], damageSmokeAnchor;
const traffic = [];     // AI araçlar
const npcs = [];        // insan + hayvan
const lights = [];      // trafik lambası kafaları
let lightMats = {};     // paylaşılan emissive malzemeler
let particles;
let hud = {};
let minimap, miniCtx;

// Oyuncu araç durumu (velocity tabanlı)
const P = {
  x: 0, z: 30, y: 0, heading: Math.PI, vx: 0, vz: 0,
  steerVis: 0, wheelSpin: 0, onRoad: true,
  health: 100, boost: 100, boosting: false, drifting: false,
  collTimer: 0, exploded: false, respawn: 0, smokeT: 0,
  burning: false, burnT: 0, pull: 0, sputterT: 0, pitch: 0
};
function slopePitch(x, z) {
  const fx = Math.sin(P.heading), fz = Math.cos(P.heading);
  const ahead = terrainHeight(x + fx * 2.5, z + fz * 2.5, P.y);
  const behind = terrainHeight(x - fx * 2.5, z - fz * 2.5, P.y);
  return Math.atan2(ahead - behind, 5);
}
const CAR = {
  accel: 30, reverseMax: 16, brake: 55, maxSpeed: 62, boostMax: 92,
  drag: 0.45, roll: 9, turn: 2.1, gripNormal: 7.5, gripDrift: 1.6, gripOff: 5
};

const input = { throttle: 0, brake: 0, steer: 0, boost: false, drift: false, reset: false, camX: 0 };
const keys = {};
const held = {};        // tuş kenar algılama (basıldı anı)
let camYaw = 0, camFov = 64;
let camMode = 0;        // 0 takip, 1 kaput, 2 sinematik
const CAM_NAMES = ['Takip', 'Kaput', 'Sinematik'];
let score = 0;
const coins = [];       // toplanabilir madeni paralar
const fountains = [];   // çeşme su püskürtme noktaları
const reservedSpots = [];   // yapı alanları (bina/ağaç bunlardan kaçınır)
const waters = [];      // göl/havuz/deniz alanları {x,z,r} — su fiziği için
const roadblocks = [];  // kapalı yol bariyerleri {x,z}
const overpasses = [];  // sürülebilir üstten geçit/köprü yükseklik profilleri
const circleColliders = [];   // göbek adaları {x,z,r}
let carBody = null, carCabin = null;   // oyuncu gövde parçaları (göçük için)

// Deniz + kumsal: +Z kenarında büyük su kütlesi
const SEA = { shore: 1040, water: 1120 };

// Basit ses efektleri (WebAudio) — korna ve para sesi
const sfx = {
  ctx: null,
  ensure() {
    if (!this.ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) this.ctx = new AC(); }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  tone(freq, dur, type = 'square', gain = 0.15) {
    const c = this.ensure(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq; o.connect(g); g.connect(c.destination);
    const t = c.currentTime; g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur);
  },
  honk() { this.tone(330, 0.28, 'sawtooth', 0.22); this.tone(247, 0.28, 'sawtooth', 0.16); },
  ding() { this.tone(880, 0.12, 'sine', 0.22); this.tone(1320, 0.18, 'sine', 0.12); }
};

const ds = new DualSense();

function init() {
  hud = {
    fps: document.getElementById('fps'),
    speed: document.getElementById('speed'),
    gear: document.getElementById('gear'),
    boostFill: document.getElementById('boost-fill'),
    healthFill: document.getElementById('health-fill'),
    dsStatus: document.getElementById('ds-status'),
    score: document.getElementById('score'),
    banner: document.getElementById('banner')
  };
  minimap = document.getElementById('minimap');
  miniCtx = minimap.getContext('2d');

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  document.getElementById('app').appendChild(renderer.domElement);

  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.style.position = 'fixed';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  document.getElementById('app').appendChild(labelRenderer.domElement);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xc4d6ea, 380, 1300);

  camera = new THREE.PerspectiveCamera(camFov, window.innerWidth / window.innerHeight, 0.1, 5000);
  camera.position.set(0, 10, 50);

  setupSkyAndLights();
  buildGround();
  buildSea();
  buildRoads();
  buildSidewalks();
  planLandmarks();
  buildCity();
  buildTrees();
  buildTrafficLights();
  buildJunctionPads();
  buildLandmarks();
  buildCrossings();
  buildRoundabouts();
  buildRoadblocks();
  buildCoins();
  createPlayerCar(choice.model, choice.color);
  buildTraffic();
  buildNPCs();
  particles = new Particles(scene, 1200);
  setupPostFX();
  setupInput();
  setupDualSenseUI();
  setupStartScreen();

  window.addEventListener('resize', onResize);
  renderer.setAnimationLoop(animate);
}

// ---------------------------------------------------------------------
//  GÖKYÜZÜ / IŞIK / ÇEVRE
// ---------------------------------------------------------------------
function setupSkyAndLights() {
  const sky = new Sky();
  sky.scale.setScalar(12000);
  const u = sky.material.uniforms;
  u.turbidity.value = 5; u.rayleigh.value = 2.0;
  u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
  const elevation = 32, azimuth = 135;
  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);
  sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const skyEnv = new Sky(); skyEnv.scale.setScalar(100);
  skyEnv.material.uniforms.turbidity.value = 5;
  skyEnv.material.uniforms.rayleigh.value = 2.0;
  skyEnv.material.uniforms.sunPosition.value.copy(sunDir);
  envScene.add(skyEnv);
  scene.environment = pmrem.fromScene(envScene).texture;

  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x55503f, 0.6));
  sun = new THREE.DirectionalLight(0xfff1d8, 3.2);
  sun.position.copy(sunDir).multiplyScalar(400);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 900;
  const s = 200;
  sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
  sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
  sun.shadow.bias = -0.0004;
  scene.add(sun); scene.add(sun.target);
}

// ---------------------------------------------------------------------
//  DOKULAR
// ---------------------------------------------------------------------
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function grassTex() {
  const c = cv(256, 256), x = c.getContext('2d');
  x.fillStyle = '#4a7530'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 11000; i++) {
    const g = 80 + Math.random() * 80;
    x.fillStyle = `rgba(${28 + Math.random() * 40},${g},${28 + Math.random() * 30},0.5)`;
    x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
function asphaltTex(vertical) {
  const c = cv(128, 256), x = c.getContext('2d');
  x.fillStyle = '#2c2e33'; x.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 4000; i++) { const v = Math.random() * 55; x.fillStyle = `rgba(${v},${v},${v + 6},0.4)`; x.fillRect(Math.random() * 128, Math.random() * 256, 2, 2); }
  // kenar şeritleri
  x.fillStyle = '#d9d9d9'; x.fillRect(6, 0, 4, 256); x.fillRect(118, 0, 4, 256);
  // orta kesik sarı çizgi
  x.fillStyle = '#f2d23a';
  for (let y = 0; y < 256; y += 40) x.fillRect(61, y, 6, 22);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  if (!vertical) t.rotation = Math.PI / 2, t.center.set(0.5, 0.5);
  return t;
}
function buildingTex(hueShift, litChance) {
  const w = 128, h = 256;
  const fc = cv(w, h), fx = fc.getContext('2d');
  const ec = cv(w, h), ex = ec.getContext('2d');
  const r = 45 + hueShift, g = 50 + hueShift, b = 64 + hueShift;
  fx.fillStyle = `rgb(${r},${g},${b})`; fx.fillRect(0, 0, w, h);
  ex.fillStyle = '#000'; ex.fillRect(0, 0, w, h);
  const cols = 5, rows = 10, pad = 5;
  const cw = (w - pad * (cols + 1)) / cols, ch = (h - pad * (rows + 1)) / rows;
  for (let rr = 0; rr < rows; rr++) for (let cc = 0; cc < cols; cc++) {
    const px = pad + cc * (cw + pad), py = pad + rr * (ch + pad);
    fx.fillStyle = '#0c0f13'; fx.fillRect(px, py, cw, ch);
    const lit = Math.random() < litChance;
    const col = lit ? `rgb(255,${(205 + Math.random() * 50) | 0},${(140 + Math.random() * 80) | 0})`
      : `rgb(${(30 + Math.random() * 30) | 0},${(45 + Math.random() * 45) | 0},${(65 + Math.random() * 45) | 0})`;
    fx.fillStyle = col; fx.fillRect(px + 1, py + 1, cw - 2, ch - 2);
    if (lit) { ex.fillStyle = col; ex.fillRect(px + 1, py + 1, cw - 2, ch - 2); }
  }
  const map = new THREE.CanvasTexture(fc), emap = new THREE.CanvasTexture(ec);
  map.colorSpace = emap.colorSpace = THREE.SRGBColorSpace;
  return { map, emap };
}

function sandTex() {
  const c = cv(256, 256), x = c.getContext('2d');
  x.fillStyle = '#d8c48f'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const v = 150 + Math.random() * 80;
    x.fillStyle = `rgba(${v},${(v * 0.86) | 0},${(v * 0.6) | 0},0.45)`;
    x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
function waterMat() {
  return new THREE.MeshStandardMaterial({
    color: 0x235f88, roughness: 0.35, metalness: 0.2,
    transparent: true, opacity: 0.88, emissive: 0x000000, emissiveIntensity: 0
  });
}

// ---------------------------------------------------------------------
//  ZEMİN / YOL / KALDIRIM
// ---------------------------------------------------------------------
function buildGround() {
  const t = grassTex(); t.repeat.set(WORLD / 5, WORLD / 5);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(WORLD * 2, WORLD * 2),
    new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
  m.rotation.x = -Math.PI / 2; m.receiveShadow = true; scene.add(m);
}
function buildRoads() {
  const vTex = asphaltTex(true); vTex.repeat.set(1, WORLD / 6);
  const hTex = asphaltTex(false); hTex.repeat.set(WORLD / 6, 1);
  const vMat = new THREE.MeshStandardMaterial({ map: vTex, roughness: 0.9 });
  const hMat = new THREE.MeshStandardMaterial({ map: hTex, roughness: 0.9 });
  for (let i = -N; i <= N; i++) {
    const p = i * BLOCK;
    const v = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, WORLD * 2), vMat);
    v.rotation.x = -Math.PI / 2; v.position.set(p, 0.02, 0); v.receiveShadow = true; scene.add(v);
    const hm = new THREE.Mesh(new THREE.PlaneGeometry(WORLD * 2, ROAD_HALF * 2), hMat);
    hm.rotation.x = -Math.PI / 2; hm.position.set(0, 0.021, p); hm.receiveShadow = true; scene.add(hm);
  }
}
function buildSidewalks() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.95 });
  const curbW = 3, curbH = 0.35;
  const geoV = new THREE.BoxGeometry(curbW, curbH, WORLD * 2);
  const geoH = new THREE.BoxGeometry(WORLD * 2, curbH, curbW);
  for (let i = -N; i <= N; i++) {
    const p = i * BLOCK;
    for (const s of [-1, 1]) {
      const a = new THREE.Mesh(geoV, mat);
      a.position.set(p + s * (ROAD_HALF + curbW / 2), curbH / 2, 0); a.receiveShadow = true; scene.add(a);
      const b = new THREE.Mesh(geoH, mat);
      b.position.set(0, curbH / 2, p + s * (ROAD_HALF + curbW / 2)); b.receiveShadow = true; scene.add(b);
    }
  }
}
function isOnRoad(x, z) {
  const dv = Math.abs(((x % BLOCK) + BLOCK + BLOCK / 2) % BLOCK - BLOCK / 2);
  const dz = Math.abs(((z % BLOCK) + BLOCK + BLOCK / 2) % BLOCK - BLOCK / 2);
  return dv < ROAD_HALF || dz < ROAD_HALF;
}

// ---------------------------------------------------------------------
//  ŞEHİR (instanced binalar)
// ---------------------------------------------------------------------
function buildCity() {
  const specs = [];
  for (let bx = -N; bx < N; bx++) for (let bz = -N; bz < N; bz++) {
    const cx = bx * BLOCK + BLOCK / 2, cz = bz * BLOCK + BLOCK / 2;
    if (Math.hypot(cx, cz - 30) < 90) continue;
    if (cz > SEA.shore - 30) continue;   // deniz/kumsal tarafına bina koyma
    // Semt tipi: merkez = gökdelen, orta = orta kat, dış = alçak/geniş
    const dist = Math.hypot(cx, cz);
    const districtT = THREE.MathUtils.clamp(1 - dist / (WORLD * 0.85), 0, 1);
    const count = 1 + (Math.random() * (districtT > 0.4 ? 3 : 4) | 0);
    for (let k = 0; k < count; k++) {
      let w, d, h;
      if (districtT > 0.62) { h = 70 + Math.random() * 150; w = 14 + Math.random() * 20; d = 14 + Math.random() * 20; }
      else if (districtT > 0.32) { h = 28 + Math.random() * 60; w = 16 + Math.random() * 24; d = 16 + Math.random() * 24; }
      else { h = 9 + Math.random() * 22; w = 20 + Math.random() * 34; d = 20 + Math.random() * 34; }
      const px = cx + (Math.random() - 0.5) * (BLOCK - ROAD_HALF * 4 - w);
      const pz = cz + (Math.random() - 0.5) * (BLOCK - ROAD_HALF * 4 - d);
      if (isOnRoad(px, pz) || inReserved(px, pz, Math.max(w, d) / 2)) continue;
      specs.push({ px, pz, w, h, d, v: specs.length % 3 });
      buildingBoxes.push({ minx: px - w / 2, maxx: px + w / 2, minz: pz - d / 2, maxz: pz + d / 2 });
    }
  }
  const variants = [buildingTex(0, 0.55), buildingTex(25, 0.4), buildingTex(-10, 0.65)];
  const geo = new THREE.BoxGeometry(1, 1, 1);
  for (let v = 0; v < 3; v++) {
    const sub = specs.filter(s => s.v === v);
    const mat = new THREE.MeshStandardMaterial({
      map: variants[v].map, emissiveMap: variants[v].emap, emissive: 0xffffff,
      emissiveIntensity: 0.55, roughness: 0.55, metalness: 0.12
    });
    const im = new THREE.InstancedMesh(geo, mat, sub.length);
    im.castShadow = im.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    sub.forEach((s, i) => {
      m.compose(new THREE.Vector3(s.px, s.h / 2, s.pz), q, new THREE.Vector3(s.w, s.h, s.d));
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
    scene.add(im);
  }
}

// ---------------------------------------------------------------------
//  AĞAÇLAR
// ---------------------------------------------------------------------
function buildTrees() {
  const COUNT = 2600;
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 4, 6),
    new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 1 }), COUNT);
  const leaf = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.7, 1),
    new THREE.MeshStandardMaterial({ color: 0x2f7d32, roughness: 0.9, flatShading: true }), COUNT);
  trunk.castShadow = leaf.castShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  let n = 0;
  for (let i = 0; i < COUNT * 3 && n < COUNT; i++) {
    const x = (Math.random() - 0.5) * WORLD * 1.95, z = (Math.random() - 0.5) * WORLD * 1.95;
    if (isOnRoad(x, z) || Math.hypot(x, z - 30) < 60 || inReserved(x, z, 4) || z > SEA.shore - 20) continue;
    const s = 0.7 + Math.random() * 1.0;
    m.compose(new THREE.Vector3(x, 2 * s, z), q, new THREE.Vector3(s, s, s)); trunk.setMatrixAt(n, m);
    m.compose(new THREE.Vector3(x, 4.5 * s, z), q, new THREE.Vector3(s, s, s)); leaf.setMatrixAt(n, m);
    n++;
  }
  trunk.count = leaf.count = n;
  trunk.instanceMatrix.needsUpdate = leaf.instanceMatrix.needsUpdate = true;
  scene.add(trunk, leaf);
}

// ---------------------------------------------------------------------
//  TRAFİK LAMBALARI
// ---------------------------------------------------------------------
function buildTrafficLights() {
  const off = 0.12;
  lightMats = {
    nsR: new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2222, emissiveIntensity: off }),
    nsY: new THREE.MeshStandardMaterial({ color: 0x332600, emissive: 0xffcc22, emissiveIntensity: off }),
    nsG: new THREE.MeshStandardMaterial({ color: 0x003311, emissive: 0x22ff55, emissiveIntensity: off }),
    ewR: new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2222, emissiveIntensity: off }),
    ewY: new THREE.MeshStandardMaterial({ color: 0x332600, emissive: 0xffcc22, emissiveIntensity: off }),
    ewG: new THREE.MeshStandardMaterial({ color: 0x003311, emissive: 0x22ff55, emissiveIntensity: off })
  };
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.7, roughness: 0.5 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.8 });
  const poleGeo = new THREE.CylinderGeometry(0.25, 0.3, 6, 8);
  const armGeo = new THREE.BoxGeometry(0.18, 0.18, 2.2);
  const headGeo = new THREE.BoxGeometry(0.9, 2.4, 0.6);
  const dotGeo = new THREE.SphereGeometry(0.28, 12, 12);
  // Her kavşakta 4 lamba: yaklaşan her şeride bakar (yön sorunu düzeltildi)
  const d = ROAD_HALF + 1.6;
  const corners = [
    { ax: 'ns', x: d, z: d, rot: 0 },          // güneyden gelen (+Z'ye bakar)
    { ax: 'ns', x: -d, z: -d, rot: Math.PI },   // kuzeyden gelen (-Z'ye bakar)
    { ax: 'ew', x: d, z: -d, rot: -Math.PI / 2 },// doğudan gelen (-X'e bakar)
    { ax: 'ew', x: -d, z: d, rot: Math.PI / 2 } // batıdan gelen (+X'e bakar)
  ];
  const limit = 3;
  for (let i = -limit; i <= limit; i++) for (let j = -limit; j <= limit; j++) {
    const ix = i * BLOCK, jz = j * BLOCK;
    for (const set of corners) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(poleGeo, poleMat); pole.position.y = 3; pole.castShadow = true; g.add(pole);
      const arm = new THREE.Mesh(armGeo, poleMat); arm.position.set(0, 5.6, 1.0); g.add(arm);
      const head = new THREE.Mesh(headGeo, headMat); head.position.set(0, 6, 1.0); g.add(head);
      const ns = set.ax === 'ns';
      const rd = new THREE.Mesh(dotGeo, ns ? lightMats.nsR : lightMats.ewR); rd.position.set(0, 6.8, 1.32); g.add(rd);
      const yd = new THREE.Mesh(dotGeo, ns ? lightMats.nsY : lightMats.ewY); yd.position.set(0, 6.0, 1.32); g.add(yd);
      const gd = new THREE.Mesh(dotGeo, ns ? lightMats.nsG : lightMats.ewG); gd.position.set(0, 5.2, 1.32); g.add(gd);
      g.position.set(ix + set.x, 0, jz + set.z);
      g.rotation.y = set.rot;
      scene.add(g);
    }
  }
}
function lightPhase(t) {
  const p = t % 12;
  return {
    nsGreen: p < 5, nsYellow: p >= 5 && p < 6,
    ewGreen: p >= 6 && p < 11, ewYellow: p >= 11,
    nsGo: p < 5.6, ewGo: p >= 6 && p < 11.6
  };
}
function updateTrafficLights(ph) {
  const on = 2.2, off = 0.1;
  lightMats.nsR.emissiveIntensity = (!ph.nsGreen && !ph.nsYellow) ? on : off;
  lightMats.nsY.emissiveIntensity = ph.nsYellow ? on : off;
  lightMats.nsG.emissiveIntensity = ph.nsGreen ? on : off;
  lightMats.ewR.emissiveIntensity = (!ph.ewGreen && !ph.ewYellow) ? on : off;
  lightMats.ewY.emissiveIntensity = ph.ewYellow ? on : off;
  lightMats.ewG.emissiveIntensity = ph.ewGreen ? on : off;
}

// ---------------------------------------------------------------------
//  ÖZEL YAPILAR: belediye, çeşme, park, köprü, anıt, su kulesi
// ---------------------------------------------------------------------
function inReserved(x, z, pad = 0) {
  for (const s of reservedSpots) if (Math.hypot(x - s.x, z - s.z) < s.r + pad) return true;
  return false;
}
function planLandmarks() {
  reservedSpots.push({ type: 'cityhall', x: 180, z: -180, r: 48 });
  reservedSpots.push({ type: 'park', x: -180, z: 180, r: 54 });
  reservedSpots.push({ type: 'park', x: 420, z: 300, r: 54 });
  reservedSpots.push({ type: 'fountain', x: 180, z: 180, r: 14 });
  reservedSpots.push({ type: 'fountain', x: -300, z: -300, r: 14 });
  reservedSpots.push({ type: 'fountain', x: -60, z: -300, r: 14 });
  reservedSpots.push({ type: 'monument', x: 300, z: -60, r: 16 });
  reservedSpots.push({ type: 'monument', x: -420, z: 60, r: 16 });
  reservedSpots.push({ type: 'watertower', x: -300, z: 420, r: 12 });
  reservedSpots.push({ type: 'watertower', x: 540, z: -300, r: 12 });
  reservedSpots.push({ type: 'bridge', x: 240, z: 0, r: 22, dir: 'z' });    // x=240 yolu, z=0 yolunun üstünden
  reservedSpots.push({ type: 'bridge', x: 0, z: 360, r: 22, dir: 'x' });    // z=360 yolu, x=0 yolunun üstünden
  // Göller (blok içlerine sığar, yolları kesmez)
  reservedSpots.push({ type: 'lake', x: -540, z: -60, r: 44 });
  reservedSpots.push({ type: 'lake', x: 60, z: -540, r: 42 });
  reservedSpots.push({ type: 'lake', x: 540, z: 540, r: 40 });
  reservedSpots.push({ type: 'lake', x: -180, z: -420, r: 38 });
  // Ek parklar (çeşitlilik için)
  reservedSpots.push({ type: 'park', x: -540, z: 300, r: 50 });
  reservedSpots.push({ type: 'park', x: 420, z: -420, r: 50 });
}
function buildLandmarks() {
  for (const s of reservedSpots) {
    if (s.type === 'cityhall') buildCityHall(s.x, s.z);
    else if (s.type === 'fountain') buildFountain(s.x, s.z);
    else if (s.type === 'park') buildPark(s.x, s.z, s.r);
    else if (s.type === 'bridge') buildBridge(s.x, s.z, s.dir);
    else if (s.type === 'monument') buildMonument(s.x, s.z);
    else if (s.type === 'watertower') buildWaterTower(s.x, s.z);
    else if (s.type === 'lake') buildLake(s.x, s.z, s.r);
  }
}
function buildLake(cx, cz, r) {
  const water = new THREE.Mesh(new THREE.CircleGeometry(r, 44), waterMat());
  water.rotation.x = -Math.PI / 2; water.position.set(cx, 0.14, cz); water.receiveShadow = true; scene.add(water);
  const sandT = sandTex(); sandT.repeat.set(4, 4);
  const sand = new THREE.Mesh(new THREE.RingGeometry(r - 1, r + 7, 44),
    new THREE.MeshStandardMaterial({ map: sandT, roughness: 1 }));
  sand.rotation.x = -Math.PI / 2; sand.position.set(cx, 0.09, cz); sand.receiveShadow = true; scene.add(sand);
  // kıyıda birkaç kaya
  const rock = new THREE.MeshStandardMaterial({ color: 0x6f6a63, roughness: 1, flatShading: true });
  for (let k = 0; k < 7; k++) {
    const a = Math.random() * Math.PI * 2, rr = r + 2 + Math.random() * 4;
    const s = 0.6 + Math.random() * 1.1;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rock);
    m.position.set(cx + Math.cos(a) * rr, s * 0.4, cz + Math.sin(a) * rr);
    m.rotation.set(Math.random(), Math.random(), Math.random()); m.castShadow = true; scene.add(m);
  }
  waters.push({ x: cx, z: cz, r });
}
function buildSea() {
  const w = waterMat();
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(WORLD * 5, 2400, 1, 1), w);
  sea.rotation.x = -Math.PI / 2; sea.position.set(0, 0.12, SEA.water + 1200); sea.receiveShadow = true; scene.add(sea);
  // Kumsal şeridi
  const sandT = sandTex(); sandT.repeat.set(WORLD / 30, 2);
  const beach = new THREE.Mesh(new THREE.PlaneGeometry(WORLD * 3, SEA.water - SEA.shore + 30),
    new THREE.MeshStandardMaterial({ map: sandT, roughness: 1 }));
  beach.rotation.x = -Math.PI / 2; beach.position.set(0, 0.07, (SEA.shore + SEA.water) / 2); beach.receiveShadow = true; scene.add(beach);
  // İskele
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 });
  const pier = new THREE.Group(); pier.position.set(120, 0, SEA.water);
  for (let i = 0; i < 14; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(5, 0.3, 6), wood);
    plank.position.set(0, 1.5, i * 6); plank.castShadow = plank.receiveShadow = true; pier.add(plank);
    for (const sx of [-2.2, 2.2]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 4, 6), wood); post.position.set(sx, -0.4, i * 6); pier.add(post); }
  }
  // korkuluk
  for (const sx of [-2.4, 2.4]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.6, 14 * 6), wood);
    rail.position.set(sx, 2.0, 13 * 3); pier.add(rail);
  }
  scene.add(pier);
  // Şamandıralar
  for (let k = 0; k < 16; k++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 8),
      new THREE.MeshStandardMaterial({ color: k % 2 ? 0xff5533 : 0xffd24a, roughness: 0.6 }));
    b.position.set((Math.random() - 0.5) * WORLD * 2, 1, SEA.water + 30 + Math.random() * 400); scene.add(b);
  }
}
function buildRoadblocks() {
  // Bazı yol parçalarını kapat: bariyer + koniler (collision kutusu eklenir → araç dolanmak zorunda)
  const barMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xd11414, roughness: 0.7 });
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xff6a00, emissive: 0x551500, emissiveIntensity: 0.3, roughness: 0.6 });
  const placed = [];
  let tries = 0;
  while (placed.length < 14 && tries < 200) {
    tries++;
    const vertical = Math.random() < 0.5;
    const line = (Math.floor(Math.random() * (2 * N - 1)) - (N - 1)) * BLOCK;
    const along = (Math.floor(Math.random() * (2 * N - 1)) - (N - 1)) * BLOCK + BLOCK / 2;
    const x = vertical ? line : along, z = vertical ? along : line;
    if (Math.hypot(x, z - 30) < 120) continue;     // başlangıç yakını olmasın
    if (z > SEA.shore - 40) continue;               // deniz tarafı olmasın
    if (placed.some(p => Math.hypot(p.x - x, p.z - z) < BLOCK)) continue;
    placed.push({ x, z });
    const g = new THREE.Group(); g.position.set(x, 0, z);
    if (!vertical) g.rotation.y = Math.PI / 2;
    // çizgili bariyer
    const bar = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2 - 1, 1.0, 0.5), barMat);
    bar.position.y = 1.1; bar.castShadow = true; g.add(bar);
    for (let s = -3; s <= 3; s++) { const st = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 0.52), stripeMat); st.position.set(s * 2.4, 1.1, 0); g.add(st); }
    for (const sx of [-(ROAD_HALF - 1), ROAD_HALF - 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.1, 0.4), barMat); leg.position.set(sx, 0.55, 0); g.add(leg); }
    // koniler
    for (let k = -2; k <= 2; k++) { const cone = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.0, 10), coneMat); cone.position.set(k * 3.5, 0.5, vertical ? 2 : 2); cone.castShadow = true; g.add(cone); }
    scene.add(g);
    // collision kutusu (ekseni grup rotasyonuna göre dünya koordinatına çevir)
    const halfA = ROAD_HALF, halfB = 1.2;
    const minx = x - (vertical ? halfA : halfB), maxx = x + (vertical ? halfA : halfB);
    const minz = z - (vertical ? halfB : halfA), maxz = z + (vertical ? halfB : halfA);
    buildingBoxes.push({ minx, maxx, minz, maxz });
    roadblocks.push({ x, z });
  }
}

// ---------------------------------------------------------------------
//  YÜKSEKLİK SİSTEMİ — sürülebilir üstten/alttan geçitler
// ---------------------------------------------------------------------
function deckProfile(o, u) {
  const half = o.len / 2;
  if (o.kind === 'sin') {                 // köprü kemeri
    const t = (u + half) / o.len;          // 0..1
    return o.peak * Math.sin(Math.PI * t) + 0.5;
  }
  const a = Math.abs(u), plat = half - o.ramp;   // rampalı düz güverte
  if (a <= plat) return o.peak;
  return o.peak * (half - a) / o.ramp;
}
// O an verilen konum/yükseklikte zemin yüksekliği (güvertedeysen yükseklik, değilsen 0)
function terrainHeight(x, z, curY) {
  for (const o of overpasses) {
    let u, perp;
    if (o.axis === 'z') { u = z - o.cz; perp = x - o.cx; }
    else { u = x - o.cx; perp = z - o.cz; }
    if (Math.abs(perp) > o.width / 2) continue;
    if (Math.abs(u) > o.len / 2) continue;
    const dh = deckProfile(o, u);
    if (Math.abs(curY - dh) < 2.6) return dh;   // bu güvertenin üstündesin
  }
  return 0;
}
function buildOverpass(o) {
  overpasses.push(o);
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x33363c, roughness: 0.92 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xb9b2a4, roughness: 0.85 });
  const colMat = new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.85 });
  const g = new THREE.Group(); scene.add(g);
  const segs = 28, du = o.len / segs;
  for (let i = 0; i < segs; i++) {
    const u = -o.len / 2 + (i + 0.5) * du;
    const y = deckProfile(o, u);
    const slope = Math.atan2(deckProfile(o, u + du) - deckProfile(o, u - du), 2 * du);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(o.axis === 'z' ? o.width : du + 0.4, 0.4, o.axis === 'z' ? du + 0.4 : o.width), deckMat);
    deck.receiveShadow = deck.castShadow = true;
    if (o.axis === 'z') { deck.position.set(o.cx, y + 0.2, o.cz + u); deck.rotation.x = -slope; }
    else { deck.position.set(o.cx + u, y + 0.2, o.cz); deck.rotation.z = slope; }
    g.add(deck);
    for (const sgn of [-1, 1]) {
      const rl = new THREE.Mesh(new THREE.BoxGeometry(o.axis === 'z' ? 0.25 : du + 0.4, 0.7, o.axis === 'z' ? du + 0.4 : 0.25), railMat);
      if (o.axis === 'z') { rl.position.set(o.cx + sgn * o.width / 2, y + 0.75, o.cz + u); rl.rotation.x = -slope; }
      else { rl.position.set(o.cx + u, y + 0.75, o.cz + sgn * o.width / 2); rl.rotation.z = slope; }
      g.add(rl);
    }
  }
  for (let i = 2; i < segs; i += 5) {
    const u = -o.len / 2 + (i + 0.5) * du;
    const y = deckProfile(o, u);
    if (y < 1.6) continue;
    for (const sgn of [-1, 1]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.65, y, 8), colMat);
      col.castShadow = true;
      if (o.axis === 'z') col.position.set(o.cx + sgn * (o.width / 2 + 0.4), y / 2, o.cz + u);
      else col.position.set(o.cx + u, y / 2, o.cz + sgn * (o.width / 2 + 0.4));
      g.add(col);
    }
  }
}
function buildCrossings() {
  // İki sürülebilir üst geçit (rampalı). Altlarındaki dik yol "alttan geçit" olur.
  buildOverpass({ axis: 'x', cx: 0, cz: -240, len: 112, peak: 6.5, ramp: 34, width: ROAD_HALF * 2 - 1, kind: 'ramp' });
  buildOverpass({ axis: 'z', cx: 240, cz: 240, len: 112, peak: 6.5, ramp: 34, width: ROAD_HALF * 2 - 1, kind: 'ramp' });
}

// ---------------------------------------------------------------------
//  GÖBEKLER (roundabout adaları) + YUMUŞAK KAVŞAK DOLGULARI
// ---------------------------------------------------------------------
function buildRoundabout(cx, cz) {
  const g = new THREE.Group(); g.position.set(cx, 0, cz);
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, ROAD_HALF + 2, 32),
    new THREE.MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.95 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.028; g.add(ring);
  const curb = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.5, 24),
    new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.95 })); curb.position.y = 0.25; g.add(curb);
  const grass = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 0.55, 24),
    new THREE.MeshStandardMaterial({ color: 0x3f8f3a, roughness: 1 })); grass.position.y = 0.3; g.add(grass);
  if (Math.random() < 0.5) { const tr = makeParkTree(); tr.position.y = 0.55; tr.traverse(o => o.isMesh && (o.castShadow = true)); g.add(tr); }
  else { const ob = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4.5, 4), new THREE.MeshStandardMaterial({ color: 0xcfc4a8, roughness: 0.8 })); ob.position.y = 2.55; ob.rotation.y = Math.PI / 4; ob.castShadow = true; g.add(ob); }
  const fcol = [0xff5d8f, 0xffd24a, 0xff7b3a, 0xffffff];
  for (let k = 0; k < 10; k++) { const a = k / 10 * 6.28; const f = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 6), new THREE.MeshStandardMaterial({ color: fcol[k % 4] })); f.position.set(Math.cos(a) * 2.4, 0.66, Math.sin(a) * 2.4); g.add(f); }
  scene.add(g);
  circleColliders.push({ x: cx, z: cz, r: 3.4 });
}
function buildRoundabouts() {
  const spots = [[120, 120], [-360, -360], [360, 360], [-480, 120], [120, -360], [-120, -120]];
  for (const [x, z] of spots) buildRoundabout(x, z);
}
function buildJunctionPads() {
  // Kavşaklara asfalt yamalar → köşeler yuvarlanır, ızgara sertliği azalır
  const lim = 8;
  const geo = new THREE.CircleGeometry(ROAD_HALF + 2.5, 22); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.95 });
  const im = new THREE.InstancedMesh(geo, mat, (2 * lim + 1) * (2 * lim + 1)); im.receiveShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
  let n = 0;
  for (let i = -lim; i <= lim; i++) for (let j = -lim; j <= lim; j++) {
    m.compose(new THREE.Vector3(i * BLOCK, 0.025, j * BLOCK), q, s); im.setMatrixAt(n++, m);
  }
  im.count = n; im.instanceMatrix.needsUpdate = true; scene.add(im);
}

function buildCityHall(cx, cz) {
  const g = new THREE.Group(); g.position.set(cx, 0, cz);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.7, metalness: 0.05 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xcfc4a8, roughness: 0.8 });
  const colMat = new THREE.MeshStandardMaterial({ color: 0xf2ecdc, roughness: 0.6 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x5a3b46, roughness: 0.8 });
  const W = 44, D = 26, H = 16;
  const base = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wallMat); base.position.y = H / 2; base.castShadow = base.receiveShadow = true; g.add(base);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 2, 1.4, D + 2), roofMat); roof.position.y = H + 0.7; g.add(roof);
  for (let s = 0; s < 3; s++) { const st = new THREE.Mesh(new THREE.BoxGeometry(W + (3 - s) * 4, 1, 8 + (3 - s) * 2), trimMat); st.position.set(0, 0.5 + s, D / 2 + 5 - s * 1.4); st.receiveShadow = true; g.add(st); }
  const colGeo = new THREE.CylinderGeometry(0.95, 0.95, 12, 12);
  for (let k = -4; k <= 4; k++) { const c = new THREE.Mesh(colGeo, colMat); c.position.set(k * 4.7, 6.5, D / 2 + 2.2); c.castShadow = true; g.add(c); }
  const portico = new THREE.Mesh(new THREE.BoxGeometry(W - 2, 1.2, 6), trimMat); portico.position.set(0, 13, D / 2 + 2.2); portico.castShadow = true; g.add(portico);
  // saat kulesi + kubbe
  const tw = new THREE.Mesh(new THREE.BoxGeometry(8, 14, 8), wallMat); tw.position.set(0, H + 7, 0); tw.castShadow = true; g.add(tw);
  const clockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4cc, emissiveIntensity: 0.6 });
  for (const [ox, oz, ry] of [[0, 4.1, 0], [0, -4.1, Math.PI], [4.1, 0, Math.PI / 2], [-4.1, 0, -Math.PI / 2]]) {
    const cl = new THREE.Mesh(new THREE.CircleGeometry(1.9, 24), clockMat); cl.position.set(ox, H + 9, oz); cl.rotation.y = ry; g.add(cl);
  }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(4.6, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), roofMat); dome.position.set(0, H + 14, 0); dome.castShadow = true; g.add(dome);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(0.4, 3.4, 8), new THREE.MeshStandardMaterial({ color: 0xffd24a, metalness: 0.85, roughness: 0.25, emissive: 0x553300, emissiveIntensity: 0.35 })); spire.position.set(0, H + 19, 0); g.add(spire);
  scene.add(g);
  buildingBoxes.push({ minx: cx - W / 2, maxx: cx + W / 2, minz: cz - D / 2, maxz: cz + D / 2 });
}
function buildFountain(cx, cz) {
  const g = new THREE.Group(); g.position.set(cx, 0, cz);
  const stone = new THREE.MeshStandardMaterial({ color: 0xc9c2b2, roughness: 0.85 });
  const water = new THREE.MeshStandardMaterial({ color: 0x3aa0d8, transparent: true, opacity: 0.8, roughness: 0.1, metalness: 0.2, emissive: 0x0a3550, emissiveIntensity: 0.3 });
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.4, 1.4, 28), stone); basin.position.y = 0.7; basin.receiveShadow = true; g.add(basin);
  const wsurf = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.4, 0.2, 28), water); wsurf.position.y = 1.32; g.add(wsurf);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 3, 16), stone); pillar.position.y = 2.6; g.add(pillar);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 0.6, 0.7, 20), stone); bowl.position.y = 4.0; g.add(bowl);
  const w2 = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.15, 20), water); w2.position.y = 4.32; g.add(w2);
  const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 2, 8), water); jet.position.y = 5.4; g.add(jet);
  g.traverse(o => o.isMesh && (o.castShadow = true));
  scene.add(g);
  buildingBoxes.push({ minx: cx - 6, maxx: cx + 6, minz: cz - 6, maxz: cz + 6 });
  fountains.push(new THREE.Vector3(cx, 6.2, cz));
}
function makeBench() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 0.7), wood); seat.position.y = 0.55; g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 0.12), wood); back.position.set(0, 0.9, -0.3); g.add(back);
  for (const sx of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.6), wood); leg.position.set(sx * 1.0, 0.28, 0); g.add(leg); }
  return g;
}
function makeParkTree() {
  const g = new THREE.Group();
  const s = 0.9 + Math.random() * 0.8;
  const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 4, 6), new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 1 })); tr.position.y = 2 * s; tr.scale.set(s, s, s); g.add(tr);
  const lf = new THREE.Mesh(new THREE.IcosahedronGeometry(2.7, 1), new THREE.MeshStandardMaterial({ color: 0x2f7d32, roughness: 0.9, flatShading: true })); lf.position.y = 4.5 * s; lf.scale.set(s, s, s); g.add(lf);
  return g;
}
function buildPark(cx, cz, r) {
  const g = new THREE.Group(); g.position.set(cx, 0, cz);
  const lawn = new THREE.Mesh(new THREE.CircleGeometry(r - 2, 40), new THREE.MeshStandardMaterial({ color: 0x3f8f3a, roughness: 1 }));
  lawn.rotation.x = -Math.PI / 2; lawn.position.y = 0.07; lawn.receiveShadow = true; g.add(lawn);
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x6b4f33, roughness: 0.9 });
  const posts = 30;
  for (let k = 0; k < posts; k++) { const a = k / posts * Math.PI * 2; const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.1, 0.3), fenceMat); p.position.set(Math.cos(a) * (r - 1.5), 0.55, Math.sin(a) * (r - 1.5)); p.castShadow = true; g.add(p); }
  const pond = new THREE.Mesh(new THREE.CircleGeometry(r * 0.3, 28), new THREE.MeshStandardMaterial({ color: 0x2f7fb0, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.9, emissive: 0x06283d, emissiveIntensity: 0.25 }));
  pond.rotation.x = -Math.PI / 2; pond.position.set(r * 0.28, 0.13, -r * 0.22); g.add(pond);
  for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; const b = makeBench(); b.position.set(Math.cos(a) * (r * 0.5), 0, Math.sin(a) * (r * 0.5)); b.rotation.y = -a; b.traverse(o => o.isMesh && (o.castShadow = true)); g.add(b); }
  const flowerColors = [0xff5d8f, 0xffd24a, 0xff7b3a, 0xb46cff, 0xffffff];
  for (let k = 0; k < 70; k++) { const a = Math.random() * Math.PI * 2, rr = Math.random() * (r - 5); const fc = flowerColors[Math.random() * flowerColors.length | 0]; const f = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 6), new THREE.MeshStandardMaterial({ color: fc, emissive: fc, emissiveIntensity: 0.18 })); f.position.set(Math.cos(a) * rr, 0.5, Math.sin(a) * rr); g.add(f); }
  for (let k = 0; k < 11; k++) { const a = Math.random() * Math.PI * 2, rr = r * 0.42 + Math.random() * (r * 0.42); const tr = makeParkTree(); tr.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr); tr.traverse(o => o.isMesh && (o.castShadow = true)); g.add(tr); }
  scene.add(g);
}
function buildBridge(cx, cz, dir) {
  const span = 34, segs = 11, peak = 5.0, deckW = 6;
  const stone = new THREE.MeshStandardMaterial({ color: 0x8d8678, roughness: 0.9 });
  const rail = new THREE.MeshStandardMaterial({ color: 0xb9b2a4, roughness: 0.85 });
  const g = new THREE.Group(); g.position.set(cx, 0, cz);
  const segLen = span / segs + 0.3;
  for (let s = 0; s < segs; s++) {
    const u = (s + 0.5) / segs, along = (u - 0.5) * span;
    const y = peak * Math.sin(Math.PI * u) + 0.6;
    const y2 = peak * Math.sin(Math.PI * (s + 1) / segs), y0 = peak * Math.sin(Math.PI * s / segs);
    const slope = Math.atan2(y2 - y0, span / segs);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(dir === 'z' ? deckW : segLen, 0.5, dir === 'z' ? segLen : deckW), stone);
    deck.castShadow = deck.receiveShadow = true;
    if (dir === 'z') { deck.position.set(0, y, along); deck.rotation.x = -slope; } else { deck.position.set(along, y, 0); deck.rotation.z = slope; }
    g.add(deck);
    for (const sgn of [-1, 1]) {
      const rl = new THREE.Mesh(new THREE.BoxGeometry(dir === 'z' ? 0.2 : segLen, 1.0, dir === 'z' ? segLen : 0.2), rail);
      if (dir === 'z') { rl.position.set(sgn * deckW / 2, y + 0.75, along); rl.rotation.x = -slope; } else { rl.position.set(along, y + 0.75, sgn * deckW / 2); rl.rotation.z = slope; }
      g.add(rl);
    }
  }
  // yan destek kolonları (yola engel olmaz; güvertenin dışına yerleşir)
  for (const along of [-span * 0.28, span * 0.28]) {
    const u = (along / span) + 0.5;
    const y = peak * Math.sin(Math.PI * u) + 0.6;
    for (const sgn of [-1, 1]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, y, 8), stone);
      if (dir === 'z') col.position.set(sgn * (deckW / 2 + 0.4), y / 2, along);
      else col.position.set(along, y / 2, sgn * (deckW / 2 + 0.4));
      col.castShadow = true; g.add(col);
    }
  }
  scene.add(g);
  // sürülebilir hale getir: araç kemerin üstünden geçer, yol altından devam eder
  overpasses.push({ axis: dir, cx, cz, len: span, peak, ramp: 0, width: deckW, kind: 'sin' });
}
function buildMonument(cx, cz) {
  const g = new THREE.Group(); g.position.set(cx, 0, cz);
  const stone = new THREE.MeshStandardMaterial({ color: 0x9a8f7a, roughness: 0.9 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(6, 2, 6), stone); base.position.y = 1; g.add(base);
  const base2 = new THREE.Mesh(new THREE.BoxGeometry(4, 1.4, 4), stone); base2.position.y = 2.7; g.add(base2);
  const obelisk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 1.4, 16, 4), stone); obelisk.position.y = 11; obelisk.rotation.y = Math.PI / 4; g.add(obelisk);
  const gold = new THREE.Mesh(new THREE.ConeGeometry(1.0, 2.4, 4), new THREE.MeshStandardMaterial({ color: 0xffd24a, metalness: 0.85, roughness: 0.25, emissive: 0x553300, emissiveIntensity: 0.35 })); gold.position.y = 20.2; gold.rotation.y = Math.PI / 4; g.add(gold);
  g.traverse(o => o.isMesh && (o.castShadow = true));
  scene.add(g);
  buildingBoxes.push({ minx: cx - 3, maxx: cx + 3, minz: cz - 3, maxz: cz + 3 });
}
function buildWaterTower(cx, cz) {
  const g = new THREE.Group(); g.position.set(cx, 0, cz);
  const steel = new THREE.MeshStandardMaterial({ color: 0x7d8a93, metalness: 0.6, roughness: 0.5 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x4a525a, metalness: 0.5, roughness: 0.6 });
  for (const [sx, sz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 14, 8), legMat); l.position.set(sx, 7, sz); g.add(l); }
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 5, 20), steel); tank.position.y = 16.5; g.add(tank);
  const top = new THREE.Mesh(new THREE.ConeGeometry(5.4, 3, 20), steel); top.position.y = 20.5; g.add(top);
  const bot = new THREE.Mesh(new THREE.ConeGeometry(5, 3, 20), steel); bot.position.y = 12.8; bot.rotation.x = Math.PI; g.add(bot);
  g.traverse(o => o.isMesh && (o.castShadow = true));
  scene.add(g);
  buildingBoxes.push({ minx: cx - 3.5, maxx: cx + 3.5, minz: cz - 3.5, maxz: cz + 3.5 });
}

// ---------------------------------------------------------------------
//  TOPLANABİLİR PARALAR (yeni mekanik)
// ---------------------------------------------------------------------
function coinSpot() {
  let x, z, t = 0;
  do { x = (Math.random() - 0.5) * WORLD * 1.7; z = (Math.random() - 0.5) * WORLD * 1.7; t++; } while ((!isOnRoad(x, z) || inReserved(x, z, 3) || z > SEA.shore - 30) && t < 40);
  return { x, z };
}
function buildCoins() {
  const geo = new THREE.CylinderGeometry(0.9, 0.9, 0.18, 20); geo.rotateX(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffd24a, metalness: 0.9, roughness: 0.25, emissive: 0x554400, emissiveIntensity: 0.6 });
  for (let i = 0; i < 48; i++) { const m = new THREE.Mesh(geo, mat); const s = coinSpot(); m.position.set(s.x, 1.2, s.z); m.castShadow = true; scene.add(m); coins.push(m); }
}
function updateCoins(dt) {
  const t = clock.elapsedTime;
  for (const c of coins) {
    c.rotation.y += dt * 3;
    c.position.y = 1.2 + Math.sin(t * 3 + c.position.x * 0.1) * 0.18;
    if (Math.hypot(c.position.x - P.x, c.position.z - P.z) < 3.4) {
      score++; sfx.ding();
      particles.emit(new THREE.Vector3(c.position.x, 1.5, c.position.z), 14, { color: new THREE.Color(1, 0.85, 0.3), speed: 6, up: 4, life: 0.5, spread: 0.5 });
      const s = coinSpot(); c.position.set(s.x, 1.2, s.z);
    }
  }
}
function updateFountains() {
  for (const f of fountains) {
    particles.emit(f, 2, { color: new THREE.Color(0.5, 0.78, 1.0), speed: 2.2, up: 6.5, life: 1.0, spread: 0.25 });
  }
}
function doHorn() {
  sfx.honk();
  for (const n of npcs) {
    const dx = n.group.position.x - P.x, dz = n.group.position.z - P.z, d = Math.hypot(dx, dz);
    if (d < 24) { n.heading = Math.atan2(dx, dz); n.scare = 1.3; }
  }
}

// ---------------------------------------------------------------------
//  ARAÇ MODELLERİ
// ---------------------------------------------------------------------
function makeCarMesh(color, isPlayer) {
  const g = new THREE.Group();
  const bodyMat = isPlayer
    ? new THREE.MeshPhysicalMaterial({ color, metalness: 0.85, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1 })
    : new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.4 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x10141a, metalness: 0.5, roughness: 0.08, transparent: true, opacity: 0.85 });
  // Oyuncu aracında segmentli gövde → çarpışmada göçük açılabilir
  const bodyGeo = isPlayer ? new THREE.BoxGeometry(2.0, 0.6, 4.4, 6, 4, 12) : new THREE.BoxGeometry(2.0, 0.6, 4.4);
  const cabinGeo = isPlayer ? new THREE.BoxGeometry(1.7, 0.62, 2.0, 5, 4, 6) : new THREE.BoxGeometry(1.7, 0.62, 2.0);
  const body = new THREE.Mesh(bodyGeo, bodyMat); body.position.y = 0.65; body.castShadow = true; g.add(body);
  const lower = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.35, 4.5), new THREE.MeshStandardMaterial({ color: 0x1c1e20, roughness: 0.7 })); lower.position.y = 0.35; g.add(lower);
  const cabin = new THREE.Mesh(cabinGeo, bodyMat); cabin.position.set(0, 1.16, -0.15); cabin.castShadow = true; g.add(cabin);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.56, 2.02), glassMat); glass.position.set(0, 1.17, -0.15); g.add(glass);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2cc, emissiveIntensity: 1.5 });
  for (const sx of [-0.6, 0.6]) { const hl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.1), headMat); hl.position.set(sx, 0.7, 2.22); g.add(hl); }
  const bl = [];
  for (const sx of [-0.6, 0.6]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.1), new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff0000, emissiveIntensity: 0.4 })); b.position.set(sx, 0.7, -2.22); g.add(b); bl.push(b); }
  const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 16); wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.85 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xcfcfcf, metalness: 1, roughness: 0.25 });
  const wh = [], fw = [];
  for (const [wx, wz] of [[-1.05, -1.4], [1.05, -1.4], [-1.05, 1.4], [1.05, 1.4]]) {
    const wg = new THREE.Group();
    const w = new THREE.Mesh(wheelGeo, wheelMat); w.castShadow = true; wg.add(w);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.42, 8), hubMat); hub.rotation.z = Math.PI / 2; wg.add(hub);
    wg.position.set(wx, 0.55, wz); g.add(wg); wh.push(wg); if (wz > 0) fw.push(wg);
  }
  return { group: g, brakeLights: bl, wheels: wh, frontWheels: fw, body, cabin, half: { x: 1.1, z: 2.3 } };
}
function makeTruckMesh(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.5 });
  const trailerMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.3, roughness: 0.6 });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 3), mat); cab.position.set(0, 1.7, 3.2); cab.castShadow = true; g.add(cab);
  const trailer = new THREE.Mesh(new THREE.BoxGeometry(2.8, 3.0, 8), trailerMat); trailer.position.set(0, 2.0, -2.5); trailer.castShadow = true; g.add(trailer);
  const wGeo = new THREE.CylinderGeometry(0.7, 0.7, 0.5, 14); wGeo.rotateZ(Math.PI / 2);
  const wMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.85 });
  for (const [wx, wz] of [[-1.3, 3.5], [1.3, 3.5], [-1.4, -1], [1.4, -1], [-1.4, -4], [1.4, -4]]) {
    const w = new THREE.Mesh(wGeo, wMat); w.position.set(wx, 0.7, wz); w.castShadow = true; g.add(w);
  }
  return { group: g, brakeLights: [], wheels: [], frontWheels: [], half: { x: 1.5, z: 6 } };
}
function makeBusMesh(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x10202a, metalness: 0.4, roughness: 0.1, transparent: true, opacity: 0.85 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.0, 10), mat); body.position.y = 1.9; body.castShadow = true; g.add(body);
  const win = new THREE.Mesh(new THREE.BoxGeometry(2.62, 1.0, 8.4), glass); win.position.set(0, 2.6, -0.4); g.add(win);
  const wGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.45, 14); wGeo.rotateZ(Math.PI / 2);
  const wMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.85 });
  for (const [wx, wz] of [[-1.3, 3], [1.3, 3], [-1.3, -3], [1.3, -3]]) { const w = new THREE.Mesh(wGeo, wMat); w.position.set(wx, 0.6, wz); w.castShadow = true; g.add(w); }
  return { group: g, brakeLights: [], wheels: [], frontWheels: [], half: { x: 1.4, z: 5 } };
}

// ---------------------------------------------------------------------
//  OYUNCU ARAÇ
// ---------------------------------------------------------------------
function buildModel(model, color, isPlayer) {
  return model === 'kamyon' ? makeTruckMesh(color) : makeCarMesh(color, isPlayer && model === 'spor' ? true : isPlayer);
}
function makeLabel(text, me) {
  const div = document.createElement('div');
  div.className = 'car-label' + (me ? ' me' : '');
  div.textContent = text;
  const o = new CSS2DObject(div);
  o.position.set(0, 2.7, 0);
  return o;
}
function disposeLabel(label) {
  if (!label) return;
  label.removeFromParent();
  const el = label.element;
  if (el && el.parentNode) el.parentNode.removeChild(el);
}
function createPlayerCar(model, color) {
  if (playerLabel) { disposeLabel(playerLabel); playerLabel = null; }
  if (car) { scene.remove(car); }
  if (carContact) scene.remove(carContact);
  boostFlames = [];
  const built = buildModel(model, color, true);
  car = built.group; wheels = built.wheels; frontWheels = built.frontWheels; brakeLights = built.brakeLights;
  carBody = built.body || null; carCabin = built.cabin || null;
  car.position.set(P.x, 0, P.z); car.rotation.y = P.heading; scene.add(car);

  const flameMat = new THREE.MeshBasicMaterial({ color: 0x44aaff, transparent: true, opacity: 0.9 });
  for (const sx of [-0.5, 0.5]) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.4, 8), flameMat.clone());
    f.rotation.x = Math.PI / 2; f.position.set(sx, 0.6, -2.6); f.visible = false; car.add(f); boostFlames.push(f);
  }
  const cTex = (() => { const c = cv(128, 128), x = c.getContext('2d'); const gr = x.createRadialGradient(64, 64, 8, 64, 64, 60); gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
  carContact = new THREE.Mesh(new THREE.PlaneGeometry(6, 7), new THREE.MeshBasicMaterial({ map: cTex, transparent: true, depthWrite: false }));
  carContact.rotation.x = -Math.PI / 2; carContact.position.y = 0.05; scene.add(carContact);
  damageSmokeAnchor = new THREE.Object3D(); damageSmokeAnchor.position.set(0, 0.8, -1.5); car.add(damageSmokeAnchor);

  playerLabel = makeLabel(choice.name, true);
  car.add(playerLabel);
}

// ---------------------------------------------------------------------
//  TRAFİK (AI araçlar)
// ---------------------------------------------------------------------
function buildTraffic() {
  const carColors = [0x2255cc, 0xdddddd, 0x222222, 0xcc8800, 0x118844, 0x991133, 0xefefef, 0x33aacc, 0xff5d3a];
  const busColors = [0xff7b2e, 0x2e8bff, 0x39b54a, 0xcc2244];
  const total = 165;
  for (let i = 0; i < total; i++) {
    const rnd = Math.random();
    let built, kind;
    if (rnd < 0.13) { built = makeTruckMesh(0x3366aa); kind = 'truck'; }
    else if (rnd < 0.24) { built = makeBusMesh(busColors[Math.random() * busColors.length | 0]); kind = 'bus'; }
    else { built = makeCarMesh(carColors[Math.random() * carColors.length | 0], false); kind = 'car'; }
    const axis = Math.random() < 0.5 ? 'v' : 'h';
    const line = (Math.floor(Math.random() * (2 * N + 1)) - N) * BLOCK;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const speed = (kind === 'car' ? 14 : 9) + Math.random() * 8;
    let along = (Math.random() - 0.5) * WORLD * 1.8;
    const v = {
      ...built, axis, line, dir, speed, along, kind,
      half: built.half
    };
    placeTraffic(v);
    scene.add(built.group);
    traffic.push(v);
  }
}
function placeTraffic(v) {
  const lane = v.dir * LANE;
  if (v.axis === 'v') {
    v.group.position.set(v.line + lane, 0, v.along);
    v.group.rotation.y = v.dir > 0 ? 0 : Math.PI;
  } else {
    v.group.position.set(v.along, 0, v.line - lane);
    v.group.rotation.y = v.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
}
function updateTraffic(dt, ph) {
  const lim = WORLD * 0.96;
  const seaLim = SEA.shore - 14;   // dikey trafik denize girmesin
  for (const v of traffic) {
    const hi = v.axis === 'v' ? seaLim : lim;
    // bir sonraki kavşağa olan mesafe (durma için)
    let stop = false;
    const go = v.axis === 'v' ? ph.nsGo : ph.ewGo;
    if (!go) {
      const next = Math.round(v.along / BLOCK) * BLOCK;
      const ahead = (next - v.along) * v.dir;
      if (ahead > 1 && ahead < 12) stop = true;
    }
    if (!stop) v.along += v.speed * v.dir * dt;
    if (v.along > hi) v.along = -lim;
    if (v.along < -lim) v.along = hi;
    placeTraffic(v);
    // tekerlek dönüşü
    const spin = v.speed * dt * 1.5;
    for (const w of v.wheels) w.children[0] && (w.children[0].rotation.x += spin);
  }
}

// ---------------------------------------------------------------------
//  NPC: insan (az) + hayvan (çok)
// ---------------------------------------------------------------------
function makePerson() {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.6, 0.5), roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe0ac69, roughness: 0.8 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.3), cloth); torso.position.y = 1.1; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), skin); head.position.y = 1.65; g.add(head);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x223044, roughness: 0.9 });
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.18), legMat); legL.position.set(-0.13, 0.55, 0); g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.13; g.add(legR);
  g.traverse(o => o.isMesh && (o.castShadow = true));
  return { group: g, legL, legR, type: 'person' };
}
function makeAnimal() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: Math.random() < 0.5 ? 0x8b5a2b : 0xcccccc, roughness: 0.9 });
  g.add(meshAt(new THREE.BoxGeometry(0.9, 0.45, 0.4), mat, 0, 0.55, 0));
  g.add(meshAt(new THREE.BoxGeometry(0.35, 0.35, 0.32), mat, 0.6, 0.7, 0));
  g.add(meshAt(new THREE.BoxGeometry(0.4, 0.1, 0.1), mat, -0.6, 0.65, 0));
  const legGeo = new THREE.BoxGeometry(0.12, 0.5, 0.12), legs = [];
  for (const [lx, lz] of [[0.35, 0.18], [0.35, -0.18], [-0.35, 0.18], [-0.35, -0.18]]) { const l = meshAt(legGeo, mat, lx, 0.3, lz); g.add(l); legs.push(l); }
  g.traverse(o => o.isMesh && (o.castShadow = true));
  return { group: g, legs, type: 'animal' };
}
function meshAt(geo, mat, x, y, z) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; }
function spawnPos() {
  let x, z, t = 0;
  do { x = (Math.random() - 0.5) * WORLD * 1.7; z = (Math.random() - 0.5) * WORLD * 1.7; t++; } while ((isOnRoad(x, z) || z > SEA.shore - 30) && t < 20);
  return { x, z };
}
function buildNPCs() {
  for (let i = 0; i < 46; i++) { const p = makePerson(), s = spawnPos(); p.group.position.set(s.x, 0, s.z); p.heading = Math.random() * 6.28; p.speed = 1 + Math.random() * 1.4; p.phase = Math.random() * 6; p.scare = 0; scene.add(p.group); npcs.push(p); }
  for (let i = 0; i < 74; i++) { const a = makeAnimal(), s = spawnPos(); a.group.position.set(s.x, 0, s.z); a.heading = Math.random() * 6.28; a.speed = 2 + Math.random() * 3; a.phase = Math.random() * 6; a.scare = 0; scene.add(a.group); npcs.push(a); }
}
function updateNPCs(dt, t) {
  for (const n of npcs) {
    const g = n.group, dx = g.position.x - P.x, dz = g.position.z - P.z, dist = Math.hypot(dx, dz);
    let mv = n.speed;
    const spd = Math.hypot(P.vx, P.vz);
    if (n.scare > 0) { n.scare -= dt; mv = n.speed * (n.type === 'animal' ? 3.4 : 2.8); }
    else if (dist < 18 && spd > 4) { n.heading = Math.atan2(dx, dz); mv = n.speed * (n.type === 'animal' ? 2.6 : 2.0); }
    else if (Math.random() < 0.01) n.heading += (Math.random() - 0.5) * 1.5;
    g.position.x += Math.sin(n.heading) * mv * dt;
    g.position.z += Math.cos(n.heading) * mv * dt;
    const lim = WORLD * 0.95;
    if (Math.abs(g.position.x) > lim) { n.heading = -n.heading; g.position.x = Math.sign(g.position.x) * lim; }
    if (Math.abs(g.position.z) > lim) { n.heading = Math.PI - n.heading; g.position.z = Math.sign(g.position.z) * lim; }
    g.rotation.y = n.heading;
    const sw = Math.sin(t * 8 + n.phase) * 0.5 * (mv / n.speed);
    if (n.type === 'person') { n.legL.rotation.x = sw; n.legR.rotation.x = -sw; }
    else { n.legs[0].rotation.x = sw; n.legs[3].rotation.x = sw; n.legs[1].rotation.x = -sw; n.legs[2].rotation.x = -sw; }
  }
}

// ---------------------------------------------------------------------
//  PARÇACIKLAR (patlama / kıvılcım / duman)
// ---------------------------------------------------------------------
class Particles {
  constructor(scene, max) {
    this.max = max; this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const tex = (() => { const c = cv(64, 64), x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
    this.mat = new THREE.PointsMaterial({ size: 2.4, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(this.geo, this.mat); this.points.frustumCulled = false; scene.add(this.points);
    this.head = 0;
  }
  emit(p, n, opt) {
    for (let k = 0; k < n; k++) {
      const i = this.head; this.head = (this.head + 1) % this.max; const i3 = i * 3;
      this.pos[i3] = p.x + (Math.random() - 0.5) * (opt.spread || 0.5);
      this.pos[i3 + 1] = p.y + (Math.random() - 0.5) * (opt.spread || 0.5);
      this.pos[i3 + 2] = p.z + (Math.random() - 0.5) * (opt.spread || 0.5);
      const sp = opt.speed || 8;
      this.vel[i3] = (Math.random() - 0.5) * sp;
      this.vel[i3 + 1] = (opt.up || 0) + Math.random() * sp * 0.6;
      this.vel[i3 + 2] = (Math.random() - 0.5) * sp;
      const c = opt.color; this.col[i3] = c.r; this.col[i3 + 1] = c.g; this.col[i3 + 2] = c.b;
      this.life[i] = this.maxLife[i] = opt.life || 0.8;
    }
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; continue; }
      this.life[i] -= dt; const i3 = i * 3;
      this.vel[i3 + 1] -= 9 * dt * 0.5;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      this.col[i3] *= 0.96; this.col[i3 + 1] *= 0.96; this.col[i3 + 2] *= 0.96;
      if (this.pos[i3 + 1] < 0.1) this.vel[i3 + 1] = Math.abs(this.vel[i3 + 1]) * 0.3;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------
//  POST-FX
// ---------------------------------------------------------------------
function setupPostFX() {
  try {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.32, 0.6, 0.92);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
  } catch (e) { console.warn('PostFX kapalı', e); composer = null; }
}

// ---------------------------------------------------------------------
//  GİRDİ
// ---------------------------------------------------------------------
function setupInput() {
  window.addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'Space') e.preventDefault(); });
  window.addEventListener('keyup', e => { keys[e.code] = false; });
}
function pollInput() {
  let th = 0, br = 0, st = 0, boost = false, drift = false, reset = false, camX = 0;
  if (keys['KeyW'] || keys['ArrowUp']) th = 1;
  if (keys['KeyS'] || keys['ArrowDown']) br = 1;
  if (keys['KeyA'] || keys['ArrowLeft']) st -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) st += 1;
  if (keys['Space']) boost = true;
  if (keys['ShiftLeft'] || keys['ShiftRight']) drift = true;
  if (keys['KeyR']) reset = true;

  if (ds.connected) {
    const i = ds.input;
    th = Math.max(th, i.r2); br = Math.max(br, i.l2);
    st += i.lx;
    if (i.circle) boost = true;
    if (i.square) drift = true;
    if (i.triangle) reset = true;
    camX = i.rx;
  } else {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      th = Math.max(th, p.buttons[7] ? p.buttons[7].value : 0);
      br = Math.max(br, p.buttons[6] ? p.buttons[6].value : 0);
      if (Math.abs(p.axes[0] || 0) > 0.12) st += p.axes[0];
      if (p.buttons[1] && p.buttons[1].pressed) boost = true;   // ◯
      if (p.buttons[2] && p.buttons[2].pressed) drift = true;   // ☐
      if (p.buttons[3] && p.buttons[3].pressed) reset = true;   // △
      if (Math.abs(p.axes[2] || 0) > 0.15) camX = p.axes[2];
      break;
    }
  }
  input.throttle = THREE.MathUtils.clamp(th, 0, 1);
  input.brake = THREE.MathUtils.clamp(br, 0, 1);
  input.steer = THREE.MathUtils.clamp(st, -1, 1);
  input.boost = boost; input.drift = drift; input.reset = reset; input.camX = camX;

  // korna (H / L1) ve kamera modu (C / R1) — basıldığı an tetiklenir
  const hornNow = !!keys['KeyH'] || (ds.connected && !!ds.input.l1);
  if (hornNow && !held.horn) doHorn();
  held.horn = hornNow;
  const camNow = !!keys['KeyC'] || (ds.connected && !!ds.input.r1);
  if (camNow && !held.cam) { camMode = (camMode + 1) % 3; banner('📷 Kamera: ' + CAM_NAMES[camMode], 1.2); }
  held.cam = camNow;
}

// ---------------------------------------------------------------------
//  ARAÇ FİZİĞİ (velocity tabanlı + drift + boost + hasar)
// ---------------------------------------------------------------------
function updateCar(dt) {
  if (P.exploded) {
    P.respawn -= dt;
    if (P.respawn <= 0) respawnCar();
    car.visible = false; carContact.visible = false;
    return;
  }
  if (P.burning) {
    P.burnT -= dt;
    // araç sarsılıyor
    car.visible = true; carContact.visible = true;
    car.position.set(P.x + (Math.random() - 0.5) * 0.22, P.y, P.z + (Math.random() - 0.5) * 0.22);
    car.rotation.z = (Math.random() - 0.5) * 0.07;
    // büyüyen alevler + kara duman
    const grow = 1 - P.burnT / 1.4; // 0 -> 1
    const fire = new THREE.Vector3(P.x, 1.0, P.z);
    particles.emit(fire, 4 + Math.round(grow * 4), { color: new THREE.Color(1, 0.4 + Math.random() * 0.35, 0.08), speed: 4 + grow * 4, up: 5, life: 0.5, spread: 0.9 + grow });
    particles.emit(new THREE.Vector3(P.x, 1.7, P.z), 3 + Math.round(grow * 3), { color: new THREE.Color(0.05, 0.05, 0.06), speed: 1.5, up: 4 + grow * 2, life: 1.3, spread: 1.0 + grow });
    if (P.burnT <= 0) explodeCar();
    return;
  }
  car.visible = true; carContact.visible = true;
  P.onRoad = isOnRoad(P.x, P.z);
  // suya girdi mi? (göl veya deniz) → ağır direnç, kontrol kaybı, su sıçraması
  let inWater = P.z > SEA.water - 4;
  if (!inWater) for (const w of waters) { if (Math.hypot(P.x - w.x, P.z - w.z) < w.r) { inWater = true; break; } }
  // hasar aşınması 0..1 (gidişat zorlaşması)
  const wear = 1 - P.health / 100;

  const h = P.heading;
  const fx = Math.sin(h), fz = Math.cos(h);
  const rx = Math.cos(h), rz = -Math.sin(h);
  let vf = P.vx * fx + P.vz * fz;   // ileri hız
  let vl = P.vx * rx + P.vz * rz;   // yanal hız

  // boost
  P.boosting = input.boost && P.boost > 1 && vf > -1;
  if (P.boosting) P.boost = Math.max(0, P.boost - 34 * dt);
  else P.boost = Math.min(100, P.boost + 14 * dt);
  // hasar arttıkça motor güçten düşer, üst hız azalır
  const accel = CAR.accel * (P.boosting ? 2.1 : 1) * (1 - 0.32 * wear);
  const maxV = (P.boosting ? CAR.boostMax : CAR.maxSpeed) * (1 - 0.33 * wear);

  // ağır hasarda motor teklemesi
  let throttle = input.throttle;
  if (wear > 0.5) { P.sputterT -= dt; if (P.sputterT <= 0) { P.sputterT = 0.25 + Math.random() * 0.4; if (Math.random() < (wear - 0.5) * 1.4) throttle *= 0.25; } }

  if (throttle > 0) vf += accel * throttle * dt;
  if (input.brake > 0) {
    if (vf > 0.5) vf -= CAR.brake * input.brake * dt;
    else vf -= CAR.accel * 0.6 * input.brake * dt;
  }
  // sürüklenme & yuvarlanma (suda çok ağır direnç)
  const dragC = inWater ? CAR.drag + 9 : (P.onRoad ? CAR.drag : CAR.drag + 1.2);
  vf -= vf * dragC * dt * 0.18;
  if (inWater) {
    vf *= (1 - Math.min(1, 2.4 * dt));   // suda hızla yavaşla
    if (Math.abs(vf) > 1 && Math.random() < 0.8)
      particles.emit(new THREE.Vector3(P.x + (Math.random() - 0.5) * 3, 0.4, P.z + (Math.random() - 0.5) * 3), 3, { color: new THREE.Color(0.7, 0.85, 1.0), speed: 3, up: 4, life: 0.5, spread: 0.6 });
  }
  if (input.throttle === 0 && input.brake === 0) {
    const r = CAR.roll * dt;
    vf = vf > 0 ? Math.max(0, vf - r) : Math.min(0, vf + r);
  }
  vf = THREE.MathUtils.clamp(vf, -CAR.reverseMax, maxV);

  // drift / yanal tutuş
  P.drifting = input.drift && Math.abs(vf) > 6;
  const grip = P.drifting ? CAR.gripDrift : (P.onRoad ? CAR.gripNormal : CAR.gripOff);
  vl -= vl * Math.min(1, grip * dt);

  // direksiyon (DÜZELTİLDİ: sağ = sağa) — hasarda tepki azalır
  const speedFactor = THREE.MathUtils.clamp(Math.abs(vf) / 9, 0, 1);
  const authority = (P.drifting ? 1.5 : 1.0) * (1 - 0.28 * wear);
  P.heading -= input.steer * CAR.turn * speedFactor * Math.sign(vf || 1) * authority * dt;
  // hasarlı araç bir tarafa çeker (jant/aks eğrilmesi hissi)
  if (P.pull !== 0) P.heading += P.pull * wear * 0.6 * speedFactor * Math.sign(vf || 1) * dt;
  P.steerVis = THREE.MathUtils.lerp(P.steerVis, input.steer, 0.2);

  // hız vektörünü yeniden kur
  P.vx = fx * vf + rx * vl;
  P.vz = fz * vf + rz * vl;

  // patinaj (görsel + haptik)
  P.wheelSpin = THREE.MathUtils.lerp(P.wheelSpin, (input.throttle > 0.7 && Math.abs(vf) < 10) || P.drifting ? 1 : 0, 0.2);

  // konum + çarpışma
  let nx = P.x + P.vx * dt, nz = P.z + P.vz * dt;
  const speed = Math.hypot(P.vx, P.vz);
  const hit = resolveCollision(nx, nz);
  if (hit.collided) {
    P.x = hit.x; P.z = hit.z;
    P.vx *= 0.2; P.vz *= 0.2;
    applyDamage(speed * 0.9, hit.point);
  } else { P.x = nx; P.z = nz; }

  // trafik araçlarıyla çarpışma
  collideTraffic(speed);

  // dünya sınırı
  const lim = WORLD * 0.98;
  if (Math.abs(P.x) > lim) { P.x = Math.sign(P.x) * lim; P.vx *= -0.3; }
  if (Math.abs(P.z) > lim) { P.z = Math.sign(P.z) * lim; P.vz *= -0.3; }

  // yükseklik: üst geçit/köprü güvertesini takip et, kenardan düşünce yerçekimi
  const ty = terrainHeight(P.x, P.z, P.y);
  if (ty > P.y) P.y = Math.min(ty, P.y + 45 * dt);
  else P.y = Math.max(ty, P.y - 30 * dt);
  // güverte eğimine göre aracı hafifçe öne/arkaya yatır
  P.pitch = THREE.MathUtils.lerp(P.pitch || 0, P.y > 0.3 ? -slopePitch(P.x, P.z) : 0, 0.15);

  if (P.collTimer > 0) P.collTimer -= dt;
  if (input.reset) respawnCar();

  // hasar dumanı — cana göre artar (hafif gri → koyu, yoğun + alev dilleri)
  if (P.health < 70) {
    const dmg = THREE.MathUtils.clamp((70 - P.health) / 70, 0, 1); // 0..1
    P.smokeT -= dt;
    if (P.smokeT <= 0) {
      P.smokeT = 0.13 - dmg * 0.11; // hasar arttıkça sıklaşır
      const wp = damageSmokeAnchor.getWorldPosition(new THREE.Vector3());
      const n = 1 + Math.round(dmg * 4);
      const tone = 0.2 - dmg * 0.14; // hasar arttıkça koyulaşır
      particles.emit(wp, n, { color: new THREE.Color(tone, tone, tone + 0.02), speed: 1.2 + dmg * 1.4, up: 2.2 + dmg * 1.6, life: 1.0 + dmg * 0.7, spread: 0.5 + dmg * 0.6 });
      if (dmg > 0.7 && Math.random() < 0.5) {
        particles.emit(wp, 2, { color: new THREE.Color(1, 0.5, 0.12), speed: 2, up: 2.5, life: 0.4, spread: 0.3 });
      }
    }
  }

  // görsel güncelle
  car.position.set(P.x, P.y, P.z); car.rotation.y = P.heading; car.rotation.x = P.pitch;
  carContact.position.set(P.x, P.y + 0.05, P.z); carContact.visible = P.y < 0.4;
  const spin = vf * dt * 1.8;
  for (const w of wheels) { w.children[0].rotation.x += spin; w.children[1].rotation.x += spin; }
  for (const fw of frontWheels) fw.rotation.y = -P.steerVis * 0.5;
  const braking = input.brake > 0.05;
  for (const b of brakeLights) b.material.emissiveIntensity = braking ? 3 : 0.4;
  for (const f of boostFlames) { f.visible = P.boosting; if (P.boosting) f.scale.z = 0.8 + Math.random() * 0.6; }
}

function resolveCollision(nx, nz) {
  for (const c of circleColliders) {
    const dx = nx - c.x, dz = nz - c.z, d = Math.hypot(dx, dz), rr = c.r + 1.1;
    if (d < rr) { const n = Math.max(0.001, d); return { collided: true, x: c.x + dx / n * rr, z: c.z + dz / n * rr, point: new THREE.Vector3(nx, 0.8, nz) }; }
  }
  for (const b of buildingBoxes) {
    if (nx > b.minx - 1.1 && nx < b.maxx + 1.1 && nz > b.minz - 1.1 && nz < b.maxz + 1.1) {
      // en küçük nüfuziyet ekseninde dışarı it
      const penL = nx - (b.minx - 1.1), penR = (b.maxx + 1.1) - nx;
      const penD = nz - (b.minz - 1.1), penU = (b.maxz + 1.1) - nz;
      const minX = Math.min(penL, penR), minZ = Math.min(penD, penU);
      let x = P.x, z = P.z;
      if (minX < minZ) x = penL < penR ? b.minx - 1.1 : b.maxx + 1.1;
      else z = penD < penU ? b.minz - 1.1 : b.maxz + 1.1;
      return { collided: true, x, z, point: new THREE.Vector3(nx, 0.8, nz) };
    }
  }
  return { collided: false };
}
function collideTraffic(speed) {
  for (const v of traffic) {
    const dx = v.group.position.x - P.x, dz = v.group.position.z - P.z;
    const d = Math.hypot(dx, dz);
    const rad = 2.2 + v.half.z * 0.5;
    if (d < rad) {
      const n = Math.max(0.001, d), ux = dx / n, uz = dz / n;
      // oyuncuyu geri it
      P.x -= ux * (rad - d); P.z -= uz * (rad - d);
      P.vx -= ux * speed * 0.4; P.vz -= uz * speed * 0.4;
      // trafiği savur
      v.along += (v.axis === 'v' ? uz : ux) * 6 * v.dir;
      applyDamage(speed * 0.7, new THREE.Vector3(P.x + ux, 0.9, P.z + uz));
      if (speed > 22) particles.emit(new THREE.Vector3(P.x + ux, 1, P.z + uz), 18, { color: new THREE.Color(1, 0.5, 0.1), speed: 9, up: 4, life: 0.6, spread: 0.8 });
    }
  }
}
function applyDamage(amount, point) {
  if (P.collTimer > 0.2) return; // kısa süre içinde tekrar sayma
  P.collTimer = 0.35;
  const dmg = amount * 0.5;
  P.health = Math.max(0, P.health - dmg);
  // ilk ciddi hasarda aracın çekiş yönünü belirle (gidişat bozulur)
  if (P.pull === 0 && P.health < 80) P.pull = Math.random() < 0.5 ? -1 : 1;
  if (point) {
    particles.emit(point, 10, { color: new THREE.Color(1, 0.8, 0.3), speed: 7, up: 3, life: 0.4, spread: 0.5 });
    dentCar(point, dmg);   // görünür göçük aç
  }
  if (P.health <= 0 && !P.exploded && !P.burning) startBurning();
}
// Çarpma noktasının çevresindeki gövde köşelerini içeri göçürür
function dentCar(point, amount) {
  const str = THREE.MathUtils.clamp(amount * 0.05, 0.05, 0.6);
  for (const mesh of [carBody, carCabin]) {
    if (!mesh) continue;
    mesh.updateWorldMatrix(true, false);
    const lp = mesh.worldToLocal(point.clone());
    const pos = mesh.geometry.attributes.position;
    const radius = 1.5;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
      const d = Math.hypot(vx - lp.x, vy - lp.y, vz - lp.z);
      if (d >= radius) continue;
      const fall = 1 - d / radius;
      const k = str * fall;
      const len = Math.hypot(vx, vy, vz) || 1;   // köşeyi merkeze (içeri) doğru çek
      pos.setXYZ(i,
        vx - (vx / len) * k + (Math.random() - 0.5) * k * 0.5,
        vy - (vy / len) * k + (Math.random() - 0.5) * k * 0.5,
        vz - (vz / len) * k + (Math.random() - 0.5) * k * 0.5);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }
}
function startBurning() {
  P.burning = true; P.burnT = 1.4; P.vx = P.vz = 0;
  banner('🔥 Araç alev aldı!', 1.4);
}
function explodeCar() {
  P.burning = false; P.exploded = true; P.respawn = 2.8;
  car.rotation.z = 0;
  const p = new THREE.Vector3(P.x, 1.1, P.z);
  // parlak çekirdek
  particles.emit(p, 90, { color: new THREE.Color(1, 0.97, 0.72), speed: 11, up: 6, life: 0.45, spread: 0.6 });
  // turuncu ateş topu
  particles.emit(p, 240, { color: new THREE.Color(1, 0.5, 0.12), speed: 26, up: 12, life: 1.3, spread: 1.7 });
  // dış kızıl alev
  particles.emit(p, 150, { color: new THREE.Color(0.9, 0.22, 0.05), speed: 18, up: 8, life: 1.1, spread: 2.1 });
  // yükselen kara duman
  particles.emit(new THREE.Vector3(P.x, 2.3, P.z), 110, { color: new THREE.Color(0.05, 0.05, 0.06), speed: 6, up: 9, life: 2.0, spread: 1.9 });
  // saçılan kıvılcım/enkaz
  particles.emit(p, 70, { color: new THREE.Color(1, 0.8, 0.3), speed: 32, up: 2, life: 0.7, spread: 0.4 });
  banner('💥 ARAÇ PATLADI — yeniden doğuluyor…', 2.4);
}
function respawnCar() {
  P.x = 0; P.z = 30; P.heading = Math.PI; P.vx = P.vz = 0;
  P.health = 100; P.boost = 100; P.exploded = false; P.burning = false; P.burnT = 0; P.collTimer = 0;
  P.pull = 0; P.sputterT = 0; P.y = 0; P.pitch = 0;
  createPlayerCar(choice.model, choice.color);   // göçükleri temizlemek için aracı yenile
  if (car) { car.rotation.z = 0; car.rotation.x = 0; }
}

let bannerT = 0;
function banner(text, time) { hud.banner.textContent = text; hud.banner.style.opacity = '1'; bannerT = time; }

// ---------------------------------------------------------------------
//  KAMERA
// ---------------------------------------------------------------------
function updateCamera(dt) {
  const spd = Math.hypot(P.vx, P.vz);
  if (camMode === 1) {
    // kaput kamerası (birinci şahıs)
    const hx = P.x + Math.sin(P.heading) * 2.6, hz = P.z + Math.cos(P.heading) * 2.6;
    camera.position.lerp(new THREE.Vector3(hx, 1.5 + P.y, hz), 0.5);
    camera.lookAt(P.x + Math.sin(P.heading) * 24, 1.3 + P.y, P.z + Math.cos(P.heading) * 24);
  } else {
    camYaw = THREE.MathUtils.lerp(camYaw, input.camX * 0.8, 0.1);
    const a = P.heading + camYaw;
    const dist = camMode === 2 ? 20 : 12.5, hgt = (camMode === 2 ? 11 : 6.8) + P.y;
    const desired = new THREE.Vector3(P.x - Math.sin(a) * dist, hgt, P.z - Math.cos(a) * dist);
    camera.position.lerp(desired, 1 - Math.pow(0.0015, dt));
    camera.lookAt(P.x + Math.sin(P.heading) * 6, 1.5 + P.y, P.z + Math.cos(P.heading) * 6);
  }
  // hıza göre FOV (hız hissi)
  const targetFov = 64 + Math.min(18, spd * 0.35) + (P.boosting ? 6 : 0);
  camFov = THREE.MathUtils.lerp(camFov, targetFov, 0.08);
  camera.fov = camFov; camera.updateProjectionMatrix();
  sun.position.copy(sunDir).multiplyScalar(400).add(new THREE.Vector3(P.x, 0, P.z));
  sun.target.position.set(P.x, 0, P.z);
}

// ---------------------------------------------------------------------
//  DUALSENSE GERİBİLDİRİM
// ---------------------------------------------------------------------
function updateDualSense() {
  if (!ds.connected) return;
  const spd = Math.hypot(P.vx, P.vz);
  const ratio = THREE.MathUtils.clamp(spd / CAR.maxSpeed, 0, 1);
  const moving = spd > 0.6;

  // Lightbar
  let r, g, b;
  if (P.exploded || P.collTimer > 0.15) { r = 255; g = 20; b = 0; }
  else if (P.boosting) { r = 80; g = 120; b = 255; }
  else if (P.drifting) { r = 255; g = 60; b = 200; }
  else if (!P.onRoad) { r = 255; g = 120; b = 0; }
  else { const c = new THREE.Color().setHSL((1 - ratio) * 0.5, 1, 0.5); r = c.r * 255; g = c.g * 255; b = c.b * 255; }
  ds.setLightbar(r, g, b);

  // Adaptive trigger R2 (gaz)
  if (P.boosting) ds.setRightTrigger(TriggerFX.vibration(0, 8, 50));
  else if (P.wheelSpin > 0.35) ds.setRightTrigger(TriggerFX.vibration(2, 6, 32));
  else if (moving) ds.setRightTrigger(TriggerFX.feedback(Math.round(ratio * 6), Math.round(2 + ratio * 5)));
  else ds.setRightTrigger(TriggerFX.off());

  // Adaptive trigger L2 (fren)
  if (input.brake > 0.5 && spd > 14) ds.setLeftTrigger(TriggerFX.vibration(0, 6, 26)); // ABS
  else if (input.brake > 0.05) ds.setLeftTrigger(TriggerFX.weapon(3, 7, 8));            // sert pedal
  else ds.setLeftTrigger(TriggerFX.off());

  // Haptik titreşim (boştayken sıfır)
  let strong = 0, weak = 0;
  if (moving) {
    weak = 0.03 + ratio * 0.12;
    if (!P.onRoad) strong += 0.18 + ratio * 0.3;
    if (P.wheelSpin > 0.35) weak += 0.28;
    if (P.drifting) { strong += 0.25; weak += 0.2; }
    if (P.boosting) { strong += 0.2; weak += 0.25; }
  }
  if (P.collTimer > 0.15) strong = 1;
  if (P.exploded) { strong = 1; weak = 1; }
  ds.setRumble(strong, weak);

  // Player LED = vites
  const gear = Math.min(5, Math.floor(ratio * 5) + 1);
  ds.setPlayerLeds([0x01, 0x03, 0x07, 0x0f, 0x1f][gear - 1]);

  ds.flush();
}
function setupDualSenseUI() {
  const btn = document.getElementById('connect-ds');
  ds.onStatus = t => hud.dsStatus.textContent = t;
  if (!ds.supported) { hud.dsStatus.textContent = 'WebHID yok — Chrome/Edge gerekli (oyun yine oynanır).'; btn.disabled = true; }
  btn.addEventListener('click', async () => {
    try { btn.textContent = 'Bağlanıyor…'; await ds.connect(); btn.textContent = 'DualSense bağlı ✓'; btn.classList.add('ok'); }
    catch (e) { hud.dsStatus.textContent = 'Hata: ' + e.message; btn.textContent = 'DualSense bağla'; }
  });
}

// ---------------------------------------------------------------------
//  BAŞLANGIÇ EKRANI (isim / araç / renk / çok oyunculu)
// ---------------------------------------------------------------------
function setupStartScreen() {
  const modelList = document.getElementById('model-list');
  const colorList = document.getElementById('color-list');
  const nameInput = document.getElementById('name-input');
  const serverInput = document.getElementById('server-input');
  const startStatus = document.getElementById('start-status');
  nameInput.value = 'Sürücü' + (Math.random() * 900 + 100 | 0);

  MODELS.forEach((m, i) => {
    const b = document.createElement('button');
    b.textContent = m.label; b.dataset.key = m.key;
    if (m.key === choice.model) b.classList.add('sel');
    b.onclick = () => { choice.model = m.key; [...modelList.children].forEach(c => c.classList.remove('sel')); b.classList.add('sel'); createPlayerCar(choice.model, choice.color); };
    modelList.appendChild(b);
  });
  COLORS.forEach((col, i) => {
    const s = document.createElement('div');
    s.className = 'swatch'; s.style.background = '#' + col.toString(16).padStart(6, '0');
    if (col === choice.color) s.classList.add('sel');
    s.onclick = () => { choice.color = col; [...colorList.children].forEach(c => c.classList.remove('sel')); s.classList.add('sel'); createPlayerCar(choice.model, choice.color); };
    colorList.appendChild(s);
  });

  const begin = (multi) => {
    choice.name = (nameInput.value || 'Sürücü').slice(0, 14);
    createPlayerCar(choice.model, choice.color);
    document.getElementById('start').style.display = 'none';
    gameStarted = true;
    clock.getDelta(); // birikmiş süreyi at
    if (multi) connectMultiplayer(serverInput.value.trim(), startStatus);
  };
  document.getElementById('play-solo').onclick = () => begin(false);
  document.getElementById('play-multi').onclick = () => begin(true);
}

// ---------------------------------------------------------------------
//  ÇOK OYUNCULU İSTEMCİ (WebSocket relay)
// ---------------------------------------------------------------------
function connectMultiplayer(url, statusEl) {
  if (!url) return;
  try {
    const ws = new WebSocket(url);
    net.ws = ws;
    ws.onopen = () => {
      net.connected = true;
      ws.send(JSON.stringify({ type: 'join', name: choice.name, color: choice.color, model: choice.model }));
      banner('🌐 Çok oyunculuya bağlanıldı', 2);
    };
    ws.onclose = () => { net.connected = false; banner('Çok oyunculu bağlantısı kapandı', 2); clearRemotes(); };
    ws.onerror = () => { if (statusEl) statusEl.textContent = 'Sunucuya bağlanılamadı (yine de oynayabilirsin).'; };
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      handleNetMessage(msg);
    };
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Geçersiz sunucu adresi.';
  }
}
function handleNetMessage(msg) {
  switch (msg.type) {
    case 'welcome':
      net.id = msg.id;
      (msg.players || []).forEach(p => { if (p.id !== net.id) addRemote(p); });
      break;
    case 'join':
      if (msg.id !== net.id) addRemote(msg);
      break;
    case 'state':
      if (msg.id !== net.id) updateRemote(msg);
      break;
    case 'leave':
      removeRemote(msg.id);
      break;
  }
}
function addRemote(p) {
  if (net.players.has(p.id)) return;
  const built = buildModel(p.model || 'klasik', p.color ?? 0x888888, false);
  const label = makeLabel(p.name || 'Oyuncu', false);
  built.group.add(label);
  built.group.position.set(p.x || 0, 0, p.z || 0);
  scene.add(built.group);
  net.players.set(p.id, { group: built.group, label, tx: p.x || 0, tz: p.z || 0, th: p.h || 0, wheels: built.wheels });
}
function updateRemote(p) {
  const r = net.players.get(p.id);
  if (!r) { addRemote(p); return; }
  r.tx = p.x; r.tz = p.z; r.th = p.h;
}
function removeRemote(id) { const r = net.players.get(id); if (r) { disposeLabel(r.label); scene.remove(r.group); net.players.delete(id); } }
function clearRemotes() { for (const id of [...net.players.keys()]) removeRemote(id); }
function updateRemotes(dt) {
  for (const r of net.players.values()) {
    r.group.position.x = THREE.MathUtils.lerp(r.group.position.x, r.tx, 0.18);
    r.group.position.z = THREE.MathUtils.lerp(r.group.position.z, r.tz, 0.18);
    let d = r.th - r.group.rotation.y;
    while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    r.group.rotation.y += d * 0.18;
  }
}
function sendState(dt) {
  if (!net.connected || !net.ws || net.ws.readyState !== 1) return;
  net.sendT -= dt;
  if (net.sendT > 0) return;
  net.sendT = 0.055;
  net.ws.send(JSON.stringify({ type: 'state', x: +P.x.toFixed(2), z: +P.z.toFixed(2), h: +P.heading.toFixed(3), hp: P.health | 0 }));
}

// ---------------------------------------------------------------------
//  MİNİHARİTA
// ---------------------------------------------------------------------
function drawMinimap() {
  const W = minimap.width, H = minimap.height, R = 240; // gösterilen yarıçap (dünya birimi)
  miniCtx.clearRect(0, 0, W, H);
  miniCtx.fillStyle = 'rgba(10,16,24,0.7)'; miniCtx.fillRect(0, 0, W, H);
  const sc = W / (R * 2);
  const toX = wx => W / 2 + (wx - P.x) * sc;
  const toY = wz => H / 2 + (wz - P.z) * sc;
  // deniz
  miniCtx.fillStyle = '#1f5e8c';
  const seaY = toY(SEA.water);
  if (seaY < H) miniCtx.fillRect(0, Math.max(0, seaY), W, H - Math.max(0, seaY));
  // yollar
  miniCtx.strokeStyle = '#3a4658'; miniCtx.lineWidth = 3;
  for (let i = -N; i <= N; i++) {
    const p = i * BLOCK;
    miniCtx.beginPath(); miniCtx.moveTo(toX(p), 0); miniCtx.lineTo(toX(p), H); miniCtx.stroke();
    miniCtx.beginPath(); miniCtx.moveTo(0, toY(p)); miniCtx.lineTo(W, toY(p)); miniCtx.stroke();
  }
  // göller
  miniCtx.fillStyle = '#2f86c4';
  for (const w of waters) { miniCtx.beginPath(); miniCtx.arc(toX(w.x), toY(w.z), Math.max(2, w.r * sc), 0, 6.28); miniCtx.fill(); }
  // kapalı yollar
  miniCtx.fillStyle = '#ff5a1f';
  for (const rb of roadblocks) { const x = toX(rb.x), y = toY(rb.z); if (x > 0 && x < W && y > 0 && y < H) miniCtx.fillRect(x - 2, y - 2, 4, 4); }
  // geçitler (açık gri kalın çizgi)
  miniCtx.strokeStyle = '#cdd6e0'; miniCtx.lineWidth = 4;
  for (const o of overpasses) {
    miniCtx.beginPath();
    if (o.axis === 'z') { miniCtx.moveTo(toX(o.cx), toY(o.cz - o.len / 2)); miniCtx.lineTo(toX(o.cx), toY(o.cz + o.len / 2)); }
    else { miniCtx.moveTo(toX(o.cx - o.len / 2), toY(o.cz)); miniCtx.lineTo(toX(o.cx + o.len / 2), toY(o.cz)); }
    miniCtx.stroke();
  }
  // göbekler
  miniCtx.fillStyle = '#56d364';
  for (const c of circleColliders) { const x = toX(c.x), y = toY(c.z); if (x > 0 && x < W && y > 0 && y < H) { miniCtx.beginPath(); miniCtx.arc(x, y, 3, 0, 6.28); miniCtx.fill(); } }
  // trafik
  miniCtx.fillStyle = '#ffd24a';
  for (const v of traffic) { const x = toX(v.group.position.x), y = toY(v.group.position.z); if (x > 0 && x < W && y > 0 && y < H) miniCtx.fillRect(x - 1.5, y - 1.5, 3, 3); }
  // oyuncu (ok)
  miniCtx.save(); miniCtx.translate(W / 2, H / 2); miniCtx.rotate(-P.heading);
  miniCtx.fillStyle = '#ff3b3b'; miniCtx.beginPath(); miniCtx.moveTo(0, -7); miniCtx.lineTo(5, 6); miniCtx.lineTo(-5, 6); miniCtx.closePath(); miniCtx.fill();
  miniCtx.restore();
}

// ---------------------------------------------------------------------
//  ANA DÖNGÜ
// ---------------------------------------------------------------------
let fpsAcc = 0, fpsCnt = 0;
function animate() {
  let dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const ph = lightPhase(t);

  updateTrafficLights(ph);
  updateTraffic(dt, ph);
  updateNPCs(dt, t);
  updateFountains();
  particles.update(dt);
  updateRemotes(dt);

  if (gameStarted) {
    pollInput();
    updateCar(dt);
    updateCoins(dt);
    updateCamera(dt);
    updateDualSense();
    sendState(dt);
  } else {
    // başlamadan önce: araç etrafında yavaş yörünge
    const a = t * 0.25;
    camera.position.set(P.x + Math.sin(a) * 16, 7, P.z + Math.cos(a) * 16);
    camera.lookAt(P.x, 1.4, P.z);
    carContact.position.set(P.x, 0.05, P.z);
  }

  if (composer) composer.render(); else renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  drawMinimap();

  // HUD
  fpsAcc += dt; fpsCnt++;
  if (fpsAcc > 0.5) { hud.fps.textContent = Math.round(fpsCnt / fpsAcc); fpsAcc = 0; fpsCnt = 0; }
  document.getElementById('pcount').textContent = 1 + net.players.size;
  if (hud.score) hud.score.textContent = score;
  const spd = Math.hypot(P.vx, P.vz);
  hud.speed.textContent = Math.round(spd * 7.5);
  const vf = P.vx * Math.sin(P.heading) + P.vz * Math.cos(P.heading);
  hud.gear.textContent = vf < -0.6 ? 'R' : Math.min(6, Math.floor((spd / CAR.maxSpeed) * 6) + 1);
  hud.boostFill.style.width = P.boost + '%';
  hud.healthFill.style.width = P.health + '%';
  hud.healthFill.style.background = P.health > 50 ? '#39d98a' : (P.health > 22 ? '#ffb020' : '#ff4d4d');
  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) hud.banner.style.opacity = '0'; }
}
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
}

// tüm sınıf/fonksiyon tanımları yüklendikten sonra başlat
init();
