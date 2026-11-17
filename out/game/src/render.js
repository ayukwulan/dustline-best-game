import * as THREE from 'three';
import { mulberry32, lerp, eyeY, clamp } from './util.js';
import { COLLIDERS, SITES, POLES } from './world.js';
import { weaponOf } from './weapons.js';

const AMBER = 0xffbd59, TEAL = 0x55d9ce;
const cube = new THREE.BoxGeometry(1, 1, 1);
const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.82, ...extra });
const metal = material(0x242b30, { metalness: 0.65, roughness: 0.43 });
const palette = {
  wall: material(0x697275), warehouse: material(0x626970),
  rust: material(0xa54d35, { metalness: 0.28 }), teal: material(0x3e7677, { metalness: 0.28 }),
  crate: material(0xa18860), barrel: material(0x78674a, { metalness: 0.4 }),
};
function box(parent, width, height, depth, x, y, z, mat) {
  const mesh = new THREE.Mesh(cube, mat);
  mesh.scale.set(width, height, depth); mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}
function canvasTexture(width, height, paint) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  paint(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function groundTexture() {
  const random = mulberry32(927);
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#42494a'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 18000; i++) {
      const shade = random() > 0.6 ? 140 : 10;
      ctx.fillStyle = `rgba(${shade},${shade},${shade},0.09)`;
      ctx.fillRect(random() * w, random() * h, 1 + random() * 2, 1 + random() * 2);
    }
    ctx.strokeStyle = '#2e3535'; ctx.lineWidth = 2;
    for (let x = 0; x < w; x += 128) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let z = 0; z < h; z += 128) { ctx.beginPath(); ctx.moveTo(0, z); ctx.lineTo(w, z); ctx.stroke(); }
    for (let i = 0; i < 55; i++) {
      ctx.fillStyle = 'rgba(16,24,25,0.14)';
      ctx.beginPath(); ctx.ellipse(random() * w, random() * h, 5 + random() * 35, 3 + random() * 18, random() * 3, 0, 7); ctx.fill();
    }
  });
}
function signTexture(text, color = '#edc581', background = '#19272a') {
  return canvasTexture(512, 128, ctx => {
    ctx.fillStyle = background; ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.strokeRect(8, 8, 496, 112);
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 46px monospace'; ctx.fillText(text, 256, 67);
  });
}

export class Renderer {
  constructor(host, seed) {
    this.random = mulberry32(seed + 9000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    host.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x8b7370, 42, 145);
    this.camera = new THREE.PerspectiveCamera(76, innerWidth / innerHeight, 0.08, 220);
    this.camera.rotation.order = 'YXZ';
    this.agents = new Map(); this.smokes = new Map(); this.grenadeMeshes = new Map();
    this.shake = 0; this.kick = 0; this.flashTime = 0;
    this.buildSky(); this.buildYard(); this.buildViewmodel(); this.buildEffects();
  }
  buildSky() {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(190, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color(0x243b56) }, horizon: { value: new THREE.Color(0xd99b7b) } },
      vertexShader: 'varying vec3 pos; void main(){pos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 pos; void main(){float h=clamp(normalize(pos).y*2.4,0.0,1.0);gl_FragColor=vec4(mix(horizon,top,pow(h,0.65)),1.0);}',
    }));
    this.scene.add(sky);
    const sun = new THREE.DirectionalLight(0xffc490, 3.1);
    sun.position.set(-35, 27, -32); sun.castShadow = true;
    Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 35, bottom: -35, near: 1, far: 110 });
    sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.035;
    this.scene.add(sun, new THREE.HemisphereLight(0xb4c9e4, 0x383331, 1.6));
    const disc = new THREE.Mesh(new THREE.SphereGeometry(3.8, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd0a0 }));
    disc.position.set(-91, 18, -132); this.scene.add(disc);
  }
  buildYard() {
    const texture = groundTexture(); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(8, 5.5);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(64, 44), material(0xffffff, { map: texture, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);
    const trim = material(0xaba69a), darkTrim = material(0x293c3e);
    COLLIDERS.forEach((c, i) => {
      const w = c.x2 - c.x1, h = c.y2 - c.y1, d = c.z2 - c.z1;
      const x = (c.x1 + c.x2) / 2, z = (c.z1 + c.z2) / 2;
      const mesh = box(this.scene, w, h, d, x, h / 2, z, palette[c.material]);
      mesh.castShadow = mesh.receiveShadow = true;
      if (c.material === 'rust' || c.material === 'teal') {
        box(this.scene, w + 0.05, 0.09, d + 0.05, x, h - 0.08, z, trim);
        box(this.scene, w + 0.04, 0.09, d + 0.04, x, 0.12, z, darkTrim);
        for (let offset = 0.3; offset < w; offset += 0.46) {
          box(this.scene, 0.065, h - 0.3, 0.055, c.x1 + offset, h / 2, c.z2 + 0.025, palette[c.material]);
          box(this.scene, 0.065, h - 0.3, 0.055, c.x1 + offset, h / 2, c.z1 - 0.025, palette[c.material]);
        }
        for (let offset = 0.25; offset < d; offset += 0.46) {
          box(this.scene, 0.055, h - 0.3, 0.065, c.x1 - 0.025, h / 2, c.z1 + offset, palette[c.material]);
          box(this.scene, 0.055, h - 0.3, 0.065, c.x2 + 0.025, h / 2, c.z1 + offset, palette[c.material]);
        }
        const label = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(3.4, w - 0.3), 0.72), new THREE.MeshBasicMaterial({ map: signTexture(c.label), side: THREE.DoubleSide }));
        label.position.set(x, h * 0.59, c.z2 + 0.06); this.scene.add(label);
      } else if (c.material === 'crate' || c.material === 'barrel') {
        for (const level of [0.12, h - 0.12]) box(this.scene, w + 0.025, 0.09, d + 0.025, x, level, z, darkTrim);
        for (const side of [-1, 1]) box(this.scene, 0.12, h, d + 0.035, x + side * (w / 2 - 0.08), h / 2, z, darkTrim);
        const brace = box(this.scene, 0.1, Math.hypot(h - 0.2, w - 0.2), 0.06, x, h / 2, c.z2 + 0.03, trim);
        brace.rotation.z = -Math.atan2(w - 0.2, h - 0.2);
      } else {
        box(this.scene, w + 0.02, 0.18, d + 0.02, x, h - 0.08, z, darkTrim);
        if (w > 10) {
          for (let offset = 0.5; offset < w; offset += 3) box(this.scene, 0.08, h - 0.3, d + 0.035, c.x1 + offset, h / 2, z, darkTrim);
        }
      }
    });
    const line = new THREE.MeshBasicMaterial({ color: 0xba9856, transparent: true, opacity: 0.45 });
    for (const x of [-11, 11]) {
      for (let z = -19; z < 20; z += 3) box(this.scene, 0.1, 0.015, 1.8, x, 0.014, z, line);
    }
    for (const [key, site] of Object.entries(SITES)) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(site.r - 0.16, site.r, 64), new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(site.x, 0.023, site.z); this.scene.add(ring);
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.1), new THREE.MeshBasicMaterial({ transparent: true, map: canvasTexture(128, 128, ctx => {
        ctx.clearRect(0, 0, 128, 128); ctx.font = 'bold 104px sans-serif'; ctx.fillStyle = '#e9b66b'; ctx.textAlign = 'center'; ctx.fillText(key, 64, 106);
      }), depthWrite: false }));
      decal.rotation.x = -Math.PI / 2; decal.position.set(site.x, 0.025, site.z); this.scene.add(decal);
    }
    const warehouseSign = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1.2), new THREE.MeshBasicMaterial({ map: signTexture('A / WAREHOUSE') }));
    warehouseSign.position.set(-23, 3.8, -1.97); this.scene.add(warehouseSign);
    for (const [x, z] of POLES) {
      box(this.scene, 0.12, 8, 0.12, x, 4, z, metal);
      box(this.scene, 1.8, 0.1, 0.25, x, 8, z, metal);
      box(this.scene, 1.45, 0.12, 0.22, x, 7.9, z, material(0xffdfa9, { emissive: 0xffc47d, emissiveIntensity: 3 }));
      const flood = new THREE.PointLight(0xffd09c, 90, 24, 2); flood.position.set(x, 7, z); this.scene.add(flood);
    }
    // Silhouette cranes and grain elevators sit outside the playable wall.
    const silhouette = material(0x34414c);
    for (let i = 0; i < 14; i++) {
      const x = -75 + i * 11, height = 8 + this.random() * 13;
      box(this.scene, 7, height, 9, x, height / 2, -46 - this.random() * 8, silhouette);
    }
    for (const x of [-39, 35]) {
      box(this.scene, 0.8, 24, 0.8, x, 12, -34, silhouette);
      box(this.scene, 24, 0.6, 0.7, x + 7, 23, -34, silhouette);
      box(this.scene, 0.08, 15, 0.08, x + 17, 15.5, -34, silhouette);
    }
    this.bomb = new THREE.Group();
    box(this.bomb, 0.55, 0.24, 0.38, 0, 0.12, 0, metal);
    box(this.bomb, 0.4, 0.06, 0.2, 0, 0.27, 0, material(0x68756b));
    this.bombLamp = box(this.bomb, 0.08, 0.04, 0.08, 0.14, 0.315, 0, material(AMBER, { emissive: AMBER, emissiveIntensity: 3 }));
    this.scene.add(this.bomb);
  }
  makeAgentMesh(agent) {
    const root = new THREE.Group(), color = agent.team === 'sable' ? AMBER : TEAL;
    const vest = material(color), cloth = material(0x303e46), boots = material(0x171e23);
    const luminous = material(color, { emissive: color, emissiveIntensity: 0.5 });
    const legs = [-1, 1].map(side => {
      const pivot = new THREE.Group(); pivot.position.set(side * 0.14, 0.85, 0);
      box(pivot, 0.2, 0.68, 0.22, 0, -0.34, 0, cloth);
      box(pivot, 0.22, 0.15, 0.32, 0, -0.76, -0.04, boots);
      root.add(pivot); return pivot;
    });
    box(root, 0.58, 0.66, 0.32, 0, 1.15, 0, cloth);
    box(root, 0.6, 0.42, 0.36, 0, 1.2, -0.02, vest);
    for (const x of [-0.16, 0, 0.16]) box(root, 0.12, 0.15, 0.085, x, 1.15, -0.23, boots);
    box(root, 0.35, 0.33, 0.34, 0, 1.65, 0, cloth);
    box(root, 0.38, 0.1, 0.055, 0, 1.66, -0.18, luminous);
    box(root, 0.4, 0.1, 0.38, 0, 1.8, 0, boots);
    for (const x of [-0.35, 0.35]) {
      const arm = box(root, 0.18, 0.47, 0.18, x, 1.22, -0.16, cloth); arm.rotation.x = -0.85;
      box(root, 0.18, 0.13, 0.2, x, 1.38, -0.1, vest);
    }
    box(root, 0.1, 0.14, 0.8, 0.2, 1.25, -0.38, metal);
    const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), new THREE.MeshBasicMaterial({ color }));
    marker.position.y = 2.03; root.add(marker);
    root.traverse(child => { if (child.isMesh) child.castShadow = true; });
    this.scene.add(root);
    return { root, legs, marker };
  }
  buildViewmodel() {
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.02, 10);
    this.viewScene.add(new THREE.HemisphereLight(0xdce6f3, 0x4f3e30, 2.4));
    const light = new THREE.DirectionalLight(0xffd5a2, 3); light.position.set(-2, 3, 2); this.viewScene.add(light);
    this.vm = new THREE.Group(); this.vm.scale.setScalar(0.85); this.viewScene.add(this.vm); this.vmWeapon = null;
    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xffdc8a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    this.flash = new THREE.Mesh(new THREE.OctahedronGeometry(0.1), this.flashMat);
    this.flashLight = new THREE.PointLight(0xffa742, 0, 3);
  }
  updateViewmodel(weapon) {
    if (this.vmWeapon === weapon.id) return;
    this.vmWeapon = weapon.id;
    this.vm.clear();
    const accent = material(AMBER, { metalness: 0.4 });
    const lightMetal = material(0x7b898e, { metalness: 0.7, roughness: 0.35 });
    const long = weapon.id !== 'pistol';
    box(this.vm, 0.105, 0.115, long ? 0.42 : 0.24, 0, 0, -0.07, metal);
    box(this.vm, 0.12, 0.025, long ? 0.36 : 0.2, 0, 0.07, -0.07, lightMetal);
    const barrelLength = long ? weapon.length * 0.38 : 0.08;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.021, barrelLength, 10), metal);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.005, -0.27 - barrelLength / 2); this.vm.add(barrel);
    this.muzzleZ = -0.28 - barrelLength;
    const grip = box(this.vm, 0.07, 0.18, 0.085, 0, -0.13, 0.09, metal); grip.rotation.x = 0.22;
    box(this.vm, 0.1, 0.02, 0.12, 0, -0.04, -0.16, accent);
    if (long) {
      box(this.vm, 0.07, 0.2, 0.11, 0, -0.13, -0.09, metal);
      box(this.vm, 0.085, 0.1, 0.21, 0, -0.02, 0.23, metal);
      for (let i = 0; i < 5; i++) box(this.vm, 0.112, 0.018, 0.016, 0, 0.085, -0.24 + i * 0.05, lightMetal);
    }
    if (weapon.id === 'sniper') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.27, 12), metal);
      scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.13, -0.04); this.vm.add(scope);
    } else {
      box(this.vm, 0.018, 0.042, 0.035, -0.033, 0.1, 0.035, accent);
      box(this.vm, 0.018, 0.042, 0.035, 0.033, 0.1, 0.035, accent);
      box(this.vm, 0.014, 0.04, 0.028, 0, 0.1, long ? -0.25 : -0.16, accent);
    }
    const glove = material(0x3f4b4d), sleeve = material(0x9b784b);
    box(this.vm, 0.1, 0.12, 0.12, 0.045, -0.105, 0.11, glove);
    const arm = box(this.vm, 0.13, 0.13, 0.36, 0.12, -0.15, 0.3, sleeve); arm.rotation.y = -0.2;
    if (long) box(this.vm, 0.12, 0.08, 0.17, -0.02, -0.07, -0.25, glove);
    this.flash.position.set(0, 0, this.muzzleZ - 0.07); this.vm.add(this.flash);
    this.flashLight.position.copy(this.flash.position); this.vm.add(this.flashLight);
  }
  buildEffects() {
    this.tracerCursor = 0;
    this.tracers = Array.from({ length: 40 }, () => {
      const mesh = box(this.scene, 0.012, 0.012, 1, 0, -100, 0, new THREE.MeshBasicMaterial({ color: 0xffd086, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      mesh.visible = false; return { mesh, life: 0 };
    });
    this.particles = Array.from({ length: 300 }, () => ({ life: 0, vx: 0, vy: 0, vz: 0 }));
    this.positions = new Float32Array(900); this.colors = new Float32Array(900); this.particleCursor = 0;
    for (let i = 1; i < 900; i += 3) this.positions[i] = -100;
    this.particleGeometry = new THREE.BufferGeometry();
    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.particleGeometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(this.particleGeometry, new THREE.PointsMaterial({ size: 0.085, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false }));
    this.points.frustumCulled = false; this.scene.add(this.points);
    this.boom = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshBasicMaterial({ color: 0xffbc69, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.boom.visible = false; this.boomLife = 0; this.scene.add(this.boom);
    this.boomLight = new THREE.PointLight(0xffa245, 0, 24); this.scene.add(this.boomLight);
  }
  particlesAt(x, y, z, count, blood = false, speed = 3) {
    if (![x, y, z].every(Number.isFinite)) return;
    for (let i = 0; i < count; i++) {
      const index = this.particleCursor++ % this.particles.length, p = this.particles[index];
      Object.assign(p, { life: 0.4 + this.random() * 0.45, vx: (this.random() - 0.5) * speed, vy: this.random() * speed, vz: (this.random() - 0.5) * speed });
      this.positions.set([x, y, z], index * 3);
      this.colors.set(blood ? [0.64, 0.18, 0.1] : [1, 0.68, 0.26], index * 3);
    }
    this.particleGeometry.attributes.color.needsUpdate = true;
  }
  event(event, S) {
    if (event.type === 'shot') {
      if (event.agent.isPlayer) { this.kick = 1; this.flashTime = 0.055; }
      else this.particlesAt(event.agent.x - Math.sin(event.agent.yaw) * 0.65, eyeY(event.agent) - 0.3, event.agent.z - Math.cos(event.agent.yaw) * 0.65, 3, false, 0.5);
    } else if (event.type === 'tracer') {
      const length = Math.hypot(event.end.x - event.start.x, event.end.y - event.start.y, event.end.z - event.start.z);
      if (length < 0.05) return;
      const t = this.tracers[this.tracerCursor++ % this.tracers.length];
      t.mesh.position.set((event.start.x + event.end.x) / 2, (event.start.y + event.end.y) / 2, (event.start.z + event.end.z) / 2);
      t.mesh.scale.z = length; t.mesh.lookAt(event.end.x, event.end.y, event.end.z);
      t.mesh.visible = true; t.life = 0.065;
    } else if (event.type === 'impact') this.particlesAt(event.x, event.y, event.z, event.blood ? 7 : 5, event.blood);
    else if (event.type === 'explosion') {
      this.boom.position.set(event.x, event.y + 0.2, event.z); this.boomLight.position.copy(this.boom.position);
      this.boomLife = 0.65; this.boom.visible = true;
      this.shake = 0.65 / (1 + Math.hypot(event.x - S.player.x, event.z - S.player.z) * 0.05);
      this.particlesAt(event.x, event.y, event.z, 70, false, 9);
    }
  }
  makeSmoke(grenade) {
    const random = mulberry32(grenade.id + 771), group = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0x9eaeb3, transparent: true, opacity: 0.64, depthWrite: false });
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat);
      const angle = random() * Math.PI * 2, distance = random() * 2.3;
      mesh.position.set(Math.sin(angle) * distance, 0.8 + random() * 1.3, Math.cos(angle) * distance);
      mesh.scale.setScalar(1.9 + random() * 0.7); group.add(mesh);
    }
    group.position.set(grenade.x, grenade.y, grenade.z); this.scene.add(group);
    return group;
  }
  clearRound() {
    for (const t of this.tracers) { t.life = 0; t.mesh.visible = false; }
    for (const [id, mesh] of this.smokes) this.removeEffect(mesh);
    for (const [id, mesh] of this.grenadeMeshes) this.removeEffect(mesh);
    this.smokes.clear(); this.grenadeMeshes.clear(); this.boomLife = 0;
    this.particles.forEach((p, i) => { p.life = 0; this.positions[i * 3 + 1] = -100; });
    this.shake = 0; this.kick = 0; this.flashTime = 0;
  }
  removeEffect(mesh) {
    this.scene.remove(mesh);
    const geometries = new Set(), materials = new Set();
    mesh.traverse(part => { if (part.isMesh) { geometries.add(part.geometry); materials.add(part.material); } });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
  }
  draw(S, dt) {
    const p = S.player;
    this.shake = Math.max(0, this.shake - dt);
    if (S.camera) {
      this.camera.position.set(...S.camera.position);
      this.camera.lookAt(...S.camera.target); this.camera.fov = S.camera.fov;
    } else {
      const shake = this.shake * this.shake * 0.13;
      const bob = p.alive && Math.hypot(p.vx, p.vz) > 0.5 ? Math.sin(p.walk * 2) * 0.012 : 0;
      this.camera.position.set(p.x + Math.sin(S.time * 89) * shake, p.alive ? eyeY(p) + bob : 0.75, p.z);
      this.camera.rotation.set(p.pitch + p.recoil, p.yaw, Math.cos(S.time * 79) * shake);
      const fov = p.ads ? weaponOf(p).adsFov || 56 : 76;
      this.camera.fov = dt === 0 ? fov : lerp(this.camera.fov, fov, 1 - Math.exp(-dt * 13));
    }
    this.camera.updateProjectionMatrix();
    for (const a of S.agents) {
      if (a.isPlayer) continue;
      if (!this.agents.has(a.id)) this.agents.set(a.id, this.makeAgentMesh(a));
      const { root, legs, marker } = this.agents.get(a.id);
      root.position.set(a.x, a.y, a.z); root.rotation.set(0, a.yaw, 0);
      root.scale.y = a.crouched && a.alive ? 0.67 : 1;
      if (!a.alive) {
        root.rotation.z = clamp((S.time - a.diedAt) * 4, 0, 1.5); root.position.y = 0.05;
      }
      marker.visible = a.alive;
      legs[0].rotation.x = a.alive ? Math.sin(a.walk) * 0.42 : 0;
      legs[1].rotation.x = -legs[0].rotation.x;
    }
    this.bomb.visible = S.bomb.state === 'dropped' || S.bomb.state === 'planted';
    this.bomb.position.set(S.bomb.x, 0, S.bomb.z);
    this.bombLamp.material.emissiveIntensity = Math.sin(S.time * (S.bomb.state === 'planted' ? 14 : 4)) > 0 ? 4 : 0.2;
    for (const g of S.grenades) {
      if (g.phase === 'burst' && g.kind === 'smoke') {
        if (!this.smokes.has(g.id)) this.smokes.set(g.id, this.makeSmoke(g));
        const cloud = this.smokes.get(g.id); cloud.scale.setScalar(Math.min(1, 0.4 + g.age * 2));
        cloud.rotation.y = g.age * 0.04;
        cloud.children[0].material.opacity = 0.64 * Math.min(1, (14 - g.age) / 2);
      } else if (g.phase === 'fly') {
        if (!this.grenadeMeshes.has(g.id)) {
          const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11), material(g.kind === 'he' ? AMBER : TEAL));
          this.scene.add(mesh); this.grenadeMeshes.set(g.id, mesh);
        }
        const mesh = this.grenadeMeshes.get(g.id); mesh.position.set(g.x, g.y, g.z); mesh.rotation.set(g.age * 5, g.age * 3, 0);
      }
    }
    for (const [id, cloud] of this.smokes) if (!S.grenades.some(g => g.id === id)) { this.removeEffect(cloud); this.smokes.delete(id); }
    for (const [id, mesh] of this.grenadeMeshes) if (!S.grenades.some(g => g.id === id && g.phase === 'fly')) { this.removeEffect(mesh); this.grenadeMeshes.delete(id); }
    for (const t of this.tracers) { t.life = Math.max(0, t.life - dt); t.mesh.visible = t.life > 0; t.mesh.material.opacity = t.life / 0.065; }
    this.particles.forEach((particle, i) => {
      if (particle.life <= 0) return;
      particle.life -= dt; particle.vy -= dt * 6;
      this.positions[i * 3] += particle.vx * dt; this.positions[i * 3 + 1] += particle.vy * dt; this.positions[i * 3 + 2] += particle.vz * dt;
      const near = Math.hypot(this.positions[i * 3] - this.camera.position.x, this.positions[i * 3 + 1] - this.camera.position.y, this.positions[i * 3 + 2] - this.camera.position.z) < 0.6;
      if (particle.life <= 0 || near) { this.positions[i * 3 + 1] = -100; particle.life = 0; }
    });
    this.particleGeometry.attributes.position.needsUpdate = true;
    this.boomLife = Math.max(0, this.boomLife - dt);
    this.boom.visible = this.boomLife > 0; this.boom.scale.setScalar(0.4 + (0.65 - this.boomLife) * 12);
    this.boom.material.opacity = this.boomLife * 0.65; this.boomLight.intensity = this.boomLife * 240;
    this.updateViewmodel(weaponOf(p));
    this.kick = Math.max(0, this.kick - dt * 8); this.flashTime = Math.max(0, this.flashTime - dt);
    const reloadDip = p.reloading ? Math.sin((1 - p.reloading / p.reloadDuration) * Math.PI) : 0;
    this.vm.position.set(p.ads ? 0 : 0.24, (p.ads ? -0.085 : -0.22) - reloadDip * 0.22 + Math.sin(p.walk) * 0.006, -0.68 + this.kick * 0.06);
    this.vm.rotation.set(this.kick * 0.08 - reloadDip * 0.3, -reloadDip * 0.2, -reloadDip * 0.2);
    this.flashMat.opacity = this.flashTime > 0 ? 0.9 : 0; this.flashLight.intensity = this.flashTime > 0 ? 4 : 0;
    this.flash.rotation.z = S.time * 11;
    this.renderer.clear(); this.renderer.render(this.scene, this.camera);
    if (p.alive && S.phase !== 'menu' && !S.camera) { this.renderer.clearDepth(); this.renderer.render(this.viewScene, this.viewCamera); }
  }
  resize() {
    this.camera.aspect = this.viewCamera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix(); this.viewCamera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }
  stop() { this.renderer.dispose(); }
}
