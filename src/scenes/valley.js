// The Patagonian valley: hero, the satellite pass, and the closing scene.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { HORIZON_PASS_SEC } from '../orbit.js';
import { COLORS, glowSprite, starField, mulberry32, clamp, smooth, lerp } from './common.js';

const MASK = CONFIG.model.elevationMaskDeg;
const BUFFER = CONFIG.model.demoBufferedMessages;
const FOOT_R = 6;
const PATH_SCALE = 6;
const BEAM_R = 0.5; // the drawn beam is narrower than the footprint so it reads as a beam

// --- terrain -----------------------------------------------------------------
const rnd = mulberry32(42);
const perm = new Float32Array(512);
for (let i = 0; i < 512; i++) perm[i] = rnd();
function hash(ix, iz) {
  return perm[(((ix * 73856093) ^ (iz * 19349663)) >>> 0) % 512];
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
}
function fbm(x, z) {
  let v = 0, amp = 0.5, f = 1;
  for (let o = 0; o < 4; o++) { v += amp * vnoise(x * f, z * f); f *= 2.03; amp *= 0.5; }
  return v;
}
// Ridged multifractal: sharp crests, soft valleys. Returns roughly 0..1.
function ridged(x, z, octaves = 5) {
  let v = 0, amp = 0.55, f = 1, w = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(vnoise(x * f, z * f) * 2 - 1);
    n *= n * w;
    w = clamp(n * 1.6);
    v += n * amp;
    f *= 2.07;
    amp *= 0.5;
  }
  return v;
}

const HERO_PEAK = { x: 160, z: -1150, r: 300, h: 230 };

export function terrainHeight(x, z) {
  // The valley runs roughly north-south (along z) and meanders.
  const meander = Math.sin(z * 0.01) * 22 + Math.sin(z * 0.023 + 1) * 8;
  const d = Math.abs(x + meander);
  const r = Math.hypot(x, z);
  // Pasture floor: barely rolling.
  let h = (fbm(x * 0.02, z * 0.02) - 0.5) * 3 + (fbm(x * 0.1 + 9, z * 0.1) - 0.5) * 0.5;
  // Valley walls rising into jagged peaks.
  const wall = smooth(40, 240, d);
  h += wall * (15 + 95 * Math.pow(ridged(x * 0.0045 + 11, z * 0.0045 - 3), 1.7));
  // Horizon ranges in every direction, including up and down the valley.
  // Two more ranges at distinct distances so haze separates them into layers.
  // Fewer octaves far away: detail finer than the mesh would alias into streaks.
  h += smooth(500, 1100, r) * 30;
  const mid = Math.exp(-(((r - 820) / 170) ** 2));
  h += mid * (45 + 115 * Math.pow(ridged(x * 0.0028 + 2, z * 0.0028 - 9, 4), 1.5));
  const far = Math.exp(-(((r - 1750) / 380) ** 2)) + smooth(1750, 2300, r);
  h += far * (110 + 250 * Math.pow(ridged(x * 0.0014 - 5, z * 0.0014 + 7, 3), 1.3));
  // One dominant spire behind the cow: the focal point of the skyline.
  const dp = Math.hypot(x - HERO_PEAK.x, z - HERO_PEAK.z);
  if (dp < HERO_PEAK.r) {
    const k = 1 - dp / HERO_PEAK.r;
    h += HERO_PEAK.h * Math.pow(k, 1.7) * (0.8 + 0.35 * ridged(x * 0.01, z * 0.01, 3));
  }
  return h;
}

// Polar grid centred on the cow: dense up close, coarse at the horizon.
function buildTerrain(low) {
  const A = low ? 200 : 320; // angular segments
  const R = low ? 80 : 110; // rings
  const RMAX = 2600;
  const pos = new Float32Array((1 + A * R) * 3);
  pos[1] = terrainHeight(0, 0);
  let k = 3;
  for (let i = 1; i <= R; i++) {
    const r = RMAX * Math.pow(i / R, 2.2);
    for (let j = 0; j < A; j++) {
      const t = (j / A) * Math.PI * 2;
      const x = Math.cos(t) * r, z = Math.sin(t) * r;
      pos[k++] = x; pos[k++] = terrainHeight(x, z); pos[k++] = z;
    }
  }
  const idx = [];
  const at = (i, j) => 1 + (i - 1) * A + (j % A);
  for (let j = 0; j < A; j++) idx.push(0, at(1, j + 1), at(1, j));
  for (let i = 1; i < R; i++) {
    for (let j = 0; j < A; j++) {
      const a = at(i, j), b = at(i, j + 1), c = at(i + 1, j), d = at(i + 1, j + 1);
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

const terrainMaterial = (uniforms) =>
  new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uGrass: { value: new THREE.Color('#2b4535') },
      uGrass2: { value: new THREE.Color('#3d5a3f') },
      uRock: { value: new THREE.Color('#5b6476') },
      uRockDark: { value: new THREE.Color('#353c4c') },
      uSnow: { value: new THREE.Color('#cfd8ea') },
      uRim: { value: new THREE.Color('#9fb8ff') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vNormal;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormal = normal;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vNormal;
      uniform vec3 uMoonDir; uniform vec3 uMoon; uniform vec3 uAmbient; uniform vec3 uFog; uniform float uFogDensity;
      uniform vec3 uFoot; uniform float uFootR; uniform float uLink; uniform float uTime; uniform vec3 uSignal;
      uniform vec3 uLedPos; uniform float uLed; uniform vec3 uLedColor;
      uniform vec3 uGrass; uniform vec3 uGrass2; uniform vec3 uRock; uniform vec3 uRockDark; uniform vec3 uSnow; uniform vec3 uRim;
      varying vec3 vWorld;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        // Smooth shading on the pasture, crisp low-poly facets on the mountains.
        vec3 sn = normalize(vNormal);
        vec3 fn = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        vec3 n = normalize(mix(sn, fn, smoothstep(0.06, 0.2, 1.0 - sn.y) * smoothstep(2.0, 10.0, vWorld.y)));
        vec3 L = normalize(uMoonDir);
        vec3 V = normalize(cameraPosition - vWorld);
        float h = vWorld.y;
        float facet = hash(floor(vWorld.xz * 0.08));
        float slope = 1.0 - n.y;

        // Material by slope and altitude: pasture, rock, snow.
        vec3 grass = mix(uGrass, uGrass2, facet * 0.7);
        vec3 rock = mix(uRockDark, uRock, clamp(n.y * 0.9 + facet * 0.25, 0.0, 1.0));
        float rockAmt = clamp(smoothstep(0.16, 0.34, slope) * smoothstep(1.5, 8.0, h) + smoothstep(20.0, 55.0, h), 0.0, 1.0);
        vec3 col = mix(grass, rock, rockAmt);
        float line = 85.0 + (facet - 0.5) * 30.0;
        float snow = smoothstep(line, line + 30.0, h) * smoothstep(0.3, 0.55, n.y);
        snow = max(snow, smoothstep(line + 90.0, line + 170.0, h) * smoothstep(0.1, 0.3, n.y));
        col = mix(col, uSnow, snow);

        // Moonlight, with a little extra bloom on snow and a cool rim on ridges.
        float diff = max(dot(n, L), 0.0);
        vec3 lit = col * (uAmbient + uMoon * diff);
        lit += uMoon * snow * pow(diff, 4.0) * 0.2;
        float rim = pow(1.0 - max(dot(n, V), 0.0), 4.0);
        lit += uRim * rim * 0.12 * smoothstep(15.0, 90.0, h);

        // LED spill on the ground right under the collar.
        float ld = distance(vWorld, uLedPos);
        lit += uLedColor * uLed * 0.35 / (1.0 + ld * ld * 2.5);
        // Satellite footprint.
        float d = distance(vWorld.xz, uFoot.xz);
        float inside = 1.0 - smoothstep(uFootR - 1.5, uFootR, d);
        float ring = smoothstep(uFootR - 1.4, uFootR - 0.3, d) * (1.0 - smoothstep(uFootR - 0.3, uFootR + 0.4, d));
        float scan = smoothstep(0.92, 1.0, sin(d * 0.9 - uTime * 5.0) * 0.5 + 0.5) * inside;
        lit += uSignal * uLink * (inside * 0.06 + ring * 0.8 + scan * 0.12);

        // Aerial perspective: distance haze plus mist pooling in low ground.
        float dist = distance(vWorld, cameraPosition);
        float fog = 1.0 - exp(-dist * uFogDensity);
        float mist = exp(-max(h - 3.0, 0.0) / 22.0) * smoothstep(80.0, 420.0, dist) * 0.6;
        fog = clamp(fog + mist * (1.0 - fog), 0.0, 0.94);
        gl_FragColor = vec4(mix(lit, uFog, fog), 1.0);
        #include <colorspace_fragment>
      }`,
  });

const skyMaterial = (uniforms) =>
  new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uDawn; uniform float uDawnAmt;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(h, 0.45));
        col += uHorizon * 0.7 * exp(-h * 14.0);
        float east = smoothstep(-0.2, 1.0, vDir.x) * (1.0 - smoothstep(0.0, 0.35, h));
        col = mix(col, uDawn, east * uDawnAmt);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });

// --- cow and collar ------------------------------------------------------------
// Rigs expose the same shape: { object, led, ledWorld, update(dt), play(name) }.
// LED glow and light live in the scene and follow `ledWorld`.

/** Quaternius "Cow" (CC0), trimmed by scripts/optimize-cow.mjs. */
export async function loadCow(url) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  return new GLTFLoader().loadAsync(url);
}

const COW_HEIGHT = 1.6; // metres, top of head

function buildCollar() {
  const group = new THREE.Group();
  const strap = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.1, 6, 32),
    new THREE.MeshLambertMaterial({ color: '#26303d' })
  );
  group.add(strap);
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.42, 0.45),
    new THREE.MeshLambertMaterial({ color: '#3b4553' })
  );
  housing.position.y = -1.18;
  group.add(housing);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: COLORS.led }));
  group.add(led);
  return { group, led };
}

// Cool moonlight rim so the cow separates from the background.
const RIM = { uRimColor: { value: new THREE.Color('#a9c0ff') }, uRimStrength: { value: 0.6 } };
function addRim(material) {
  if (material.userData.rim) return;
  material.userData.rim = true;
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, RIM);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor; uniform float uRimStrength;')
      .replace(
        '#include <opaque_fragment>',
        `float rimF = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
        outgoingLight += uRimColor * rimF * uRimStrength * clamp(normal.y + 0.6, 0.0, 1.0);
        #include <opaque_fragment>`
      );
  };
}

function modelCow(gltf, reduced) {
  const model = gltf.scene;
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    addRim(o.material);
  });
  const bone = (n) => model.getObjectByName(n);
  const neckBase = bone('Neck1'), neckMid = bone('Neck2'), head = bone('Head'), body = bone('Body') || bone('Torso');

  // Normalise scale, then turn the head to face -x (toward the copy), slightly toward camera.
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  model.scale.setScalar(COW_HEIGHT / new THREE.Box3().setFromObject(model).getSize(v).y);
  model.updateMatrixWorld(true);
  head.getWorldPosition(v);
  body.getWorldPosition(w);
  model.rotation.y = -Math.atan2(v.x - w.x, v.z - w.z) - Math.PI / 2 + 0.35;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  box.getCenter(v);
  model.position.set(-v.x, -box.min.y, -v.z);
  const object = new THREE.Group();
  object.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const actions = Object.fromEntries(gltf.animations.map((c) => [c.name, mixer.clipAction(c)]));
  let current = null;
  function play(name) {
    const next = actions[name];
    if (!next || next === current) return;
    next.reset().play();
    if (current) current.crossFadeTo(next, reduced ? 0 : 0.8, false);
    current = next;
    if (reduced) mixer.update(1.2); // hold a representative pose
  }

  const { group: collar, led } = buildCollar();
  object.add(collar);

  // Measure the neck where the collar sits: take the mesh slice around Neck3
  // (perpendicular to the neck) and keep its centre in bone space, so it
  // follows the animation.
  const ringBone = bone('Neck3');
  object.updateMatrixWorld(true);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const axis = new THREE.Vector3();
  neckMid.getWorldPosition(a);
  head.getWorldPosition(c);
  ringBone.getWorldPosition(b);
  axis.subVectors(c, a).normalize();
  const slice = [];
  model.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    const n = m.geometry.attributes.position.count;
    for (let i = 0; i < n; i++) {
      const p = m.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(m.matrixWorld);
      if (Math.abs(v.subVectors(p, b).dot(axis)) < 0.05) slice.push(p);
    }
  });
  const centre = new THREE.Vector3();
  slice.forEach((p) => centre.add(p));
  centre.divideScalar(Math.max(1, slice.length));
  let radius = 0;
  for (const p of slice) {
    v.subVectors(p, centre);
    v.addScaledVector(axis, -v.dot(axis));
    radius = Math.max(radius, v.length());
  }
  radius = radius ? radius * 1.02 : 0.25;
  const centreLocal = ringBone.worldToLocal(centre.clone());

  const ledWorld = new THREE.Vector3();
  const down = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const inv = new THREE.Matrix4();

  function update(dt) {
    if (!reduced) mixer.update(dt);
    object.updateMatrixWorld(true);
    neckMid.getWorldPosition(a);
    head.getWorldPosition(c);
    // Ring around the neck: normal along the neck, housing hanging underneath.
    axis.subVectors(c, a).normalize();
    down.set(0, -1, 0).addScaledVector(axis, axis.y).normalize();
    up.copy(down).negate();
    side.crossVectors(up, axis);
    basis.makeBasis(side, up, axis);
    inv.copy(object.matrixWorld).invert();
    collar.position.copy(ringBone.localToWorld(b.copy(centreLocal))).applyMatrix4(inv);
    collar.quaternion.setFromRotationMatrix(basis);
    collar.scale.setScalar(radius);
    // LED on the housing face that points toward the camera (+z).
    led.position.set(side.z >= 0 ? 0.29 : -0.29, -1.18, 0);
    collar.updateMatrixWorld(true);
    led.getWorldPosition(ledWorld);
  }
  update(0);
  return { object, led, ledWorld, update, play };
}

function blockCow() {
  const cow = new THREE.Group();
  const hide = new THREE.MeshLambertMaterial({ color: '#4a342a', flatShading: true });
  const box = (w, h, d, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hide);
    mesh.position.set(x, y, z);
    cow.add(mesh);
    return mesh;
  };
  box(1.9, 0.95, 0.82, 0, 1.2, 0);
  for (const [x, z] of [[0.72, 0.28], [0.72, -0.28], [-0.72, 0.28], [-0.72, -0.28]]) box(0.2, 0.82, 0.2, x, 0.41, z);
  box(0.5, 0.55, 0.5, 1.0, 1.35, 0).rotation.z = -0.35;
  box(0.55, 0.52, 0.48, 1.32, 1.52, 0);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshBasicMaterial({ color: COLORS.led }));
  led.position.set(0.93, 1.0, 0.26);
  cow.add(led);
  cow.scale.x = -1; // face left, toward the copy
  cow.rotation.y = -0.2;
  const object = new THREE.Group();
  object.add(cow);
  const ledWorld = new THREE.Vector3();
  return {
    object, led, ledWorld,
    update() { object.updateMatrixWorld(true); led.getWorldPosition(ledWorld); },
    play() {},
  };
}

// Pasture detail around the cow: grass tufts, rocks, and a fence line.
// Nothing is placed right in front of the hero camera.
const CAM_CLEAR = { x: -1.4, z: 8.5, r: 3 };
function buildGroundDetail(low, uniforms) {
  const group = new THREE.Group();
  const rand = mulberry32(9);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const e = new THREE.Euler();
  const c = new THREE.Color();

  group.add(buildGrass(low, uniforms, rand));

  // Rocks: squashed icosahedra.
  const rocks = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshLambertMaterial({ color: '#4d5566', flatShading: true }),
    low ? 40 : 80
  );
  const maxRocks = rocks.count;
  let rockCount = 0;
  for (let i = 0; i < maxRocks * 2 && rockCount < maxRocks; i++) {
    const r = 9 + Math.pow(rand(), 1.5) * 110;
    const t = rand() * Math.PI * 2;
    const x = Math.cos(t) * r, z = Math.sin(t) * r;
    if (Math.hypot(x - CAM_CLEAR.x, z - CAM_CLEAR.z) < CAM_CLEAR.r * 2.5) continue;
    const s = (0.2 + Math.pow(rand(), 2) * 1.2) * smooth(4, 40, r) + 0.15;
    p.set(x, terrainHeight(x, z) - s * 0.25, z);
    q.setFromEuler(e.set(rand(), rand() * 6, rand()));
    sc.set(s * (0.8 + rand() * 0.6), s * (0.4 + rand() * 0.4), s * (0.8 + rand() * 0.6));
    rocks.setMatrixAt(rockCount++, m4.compose(p, q, sc));
  }
  rocks.count = rockCount;
  group.add(rocks);

  // Fence: leaning posts and two sagging wires, behind the cow.
  const from = new THREE.Vector3(-46, 0, -16), to = new THREE.Vector3(38, 0, -9);
  const count = Math.floor(from.distanceTo(to) / 3.4);
  const posts = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.11, 1.3, 0.11),
    new THREE.MeshLambertMaterial({ color: '#4b3f36' }),
    count + 1
  );
  const tops = [];
  for (let i = 0; i <= count; i++) {
    p.lerpVectors(from, to, i / count);
    p.z += (rand() - 0.5) * 0.6;
    const y = terrainHeight(p.x, p.z);
    q.setFromEuler(e.set((rand() - 0.5) * 0.12, rand(), (rand() - 0.5) * 0.12));
    posts.setMatrixAt(i, m4.compose(new THREE.Vector3(p.x, y + 0.5, p.z), q, sc.set(1, 0.85 + rand() * 0.3, 1)));
    tops.push(new THREE.Vector3(p.x, y, p.z));
  }
  group.add(posts);
  const wireMat = new THREE.LineBasicMaterial({ color: '#8a93a6', transparent: true, opacity: 0.45 });
  for (const hgt of [0.72, 1.02]) {
    const pts = [];
    for (let i = 0; i < tops.length - 1; i++) {
      for (let k = 0; k < 4; k++) {
        const t = k / 4;
        const v = new THREE.Vector3().lerpVectors(tops[i], tops[i + 1], t);
        v.y += hgt - Math.sin(t * Math.PI) * 0.06;
        pts.push(v);
      }
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat));
  }
  return group;
}

// Grass: thousands of thin tapered blades, dark at the root, moonlit at the tip,
// swaying in the wind. Density is patchy so it reads as pasture, not carpet.
function buildGrass(low, uniforms, rand) {
  const S = 4;
  const verts = [];
  for (let i = 0; i < S; i++) {
    const t = i / S;
    const w = 0.022 * Math.pow(1 - t, 0.8);
    verts.push(-w, t, 0, w, t, 0);
  }
  verts.push(0, 1, 0);
  const index = [];
  for (let i = 0; i < S - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  index.push((S - 1) * 2, (S - 1) * 2 + 1, S * 2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(index);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: uniforms.uTime,
      uFog: uniforms.uFog,
      uFogDensity: uniforms.uFogDensity,
      uLedPos: uniforms.uLedPos,
      uLed: uniforms.uLed,
      uLedColor: uniforms.uLedColor,
      uMoonTint: { value: new THREE.Color('#7f95c9') },
      uRoot: { value: new THREE.Color('#050b09') },
    },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying float vT; varying vec3 vWorld; varying vec3 vTint;
      void main() {
        vT = position.y;
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        float h = length(instanceMatrix[1].xyz);
        float phase = uTime * 1.6 + w.x * 0.35 + w.z * 0.22;
        float gust = sin(phase) * 0.6 + sin(phase * 0.37 + 1.3) * 0.4;
        float bend = vT * vT * h;
        w.x += (0.05 + gust * 0.09) * bend;
        w.z += gust * 0.04 * bend;
        vWorld = w.xyz;
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #else
          vTint = vec3(0.06, 0.1, 0.06);
        #endif
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uFog; uniform float uFogDensity; uniform vec3 uMoonTint; uniform vec3 uRoot;
      uniform vec3 uLedPos; uniform float uLed; uniform vec3 uLedColor;
      varying float vT; varying vec3 vWorld; varying vec3 vTint;
      void main() {
        vec3 col = mix(uRoot, vTint, smoothstep(0.0, 0.9, vT));
        col += uMoonTint * pow(vT, 3.0) * 0.08;
        float ld = distance(vWorld, uLedPos);
        col += uLedColor * uLed * 0.45 * (0.25 + vT) / (1.0 + ld * ld * 3.0);
        float fog = 1.0 - exp(-distance(vWorld, cameraPosition) * uFogDensity);
        gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
        #include <colorspace_fragment>
      }`,
  });

  const max = low ? 12000 : 34000;
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.frustumCulled = false;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const e = new THREE.Euler(), c = new THREE.Color();
  let n = 0;
  for (let i = 0; i < max * 4 && n < max; i++) {
    const r = 0.9 + Math.pow(rand(), 1.35) * 75;
    const t = rand() * Math.PI * 2;
    const x = Math.cos(t) * r, z = Math.sin(t) * r;
    // Patchy clumps that thin out with distance.
    const dens = smooth(0.3, 0.62, fbm(x * 0.09 + 3, z * 0.09)) * (1 - smooth(35, 75, r));
    if (rand() > dens * 0.9 + 0.08) continue;
    if (Math.hypot(x - CAM_CLEAR.x, z - CAM_CLEAR.z) < CAM_CLEAR.r) continue;
    const y = terrainHeight(x, z);
    if (y > 4) continue;
    p.set(x, y - 0.01, z);
    q.setFromEuler(e.set((rand() - 0.5) * 0.45, rand() * Math.PI, (rand() - 0.5) * 0.45));
    // Shorter right around the hooves so the legs stay readable.
    const hgt = (0.09 + Math.pow(rand(), 2.2) * 0.24) * (0.7 + dens * 0.5) * (0.45 + 0.55 * smooth(0.8, 3.5, r));
    const wid = 0.8 + rand() * 0.6;
    mesh.setMatrixAt(n, m4.compose(p, q, sc.set(wid, hgt, wid)));
    mesh.setColorAt(n, c.setHSL(0.24 + rand() * 0.08, 0.28 + rand() * 0.14, 0.07 + rand() * 0.07));
    n++;
  }
  mesh.count = n;
  return mesh;
}

function buildSatellite() {
  const sat = new THREE.Group();
  const bus = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 1.6, 2.4),
    new THREE.MeshLambertMaterial({ color: '#c9a86a', emissive: '#3a2e18' })
  );
  sat.add(bus);
  const panelMat = new THREE.MeshLambertMaterial({ color: '#1c2a55', emissive: '#0d1733' });
  for (const s of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(5, 0.08, 1.9), panelMat);
    panel.position.x = s * 3.4;
    sat.add(panel);
  }
  const glow = glowSprite(new THREE.Color('#dfe9ff'), 14, 0.7);
  sat.add(glow);
  const strobe = glowSprite(COLORS.signal, 6, 0);
  strobe.position.y = -1;
  sat.add(strobe);
  sat.scale.setScalar(1.2 * PATH_SCALE);
  return { sat, glow, strobe };
}

function buildCone() {
  const geo = new THREE.ConeGeometry(1, 1, 48, 1, true);
  geo.translate(0, -0.5, 0); // apex at origin, base at y = -1
  const mat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 }, uColor: { value: COLORS.signal } },
    vertexShader: /* glsl */ `
      varying float vT; varying vec3 vN; varying vec3 vV;
      void main() {
        vT = -position.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity; uniform float uTime; uniform vec3 uColor;
      varying float vT; varying vec3 vN; varying vec3 vV;
      void main() {
        float edge = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float bands = smoothstep(0.75, 1.0, sin(vT * 26.0 + uTime * 5.0) * 0.5 + 0.5);
        float a = (0.03 + 0.22 * pow(edge, 2.0) + bands * 0.04) * smoothstep(0.0, 0.25, vT) * uOpacity;
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

// --- scene ------------------------------------------------------------------
export function createValley({ low, reduced, cowGltf }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 3000);

  const fogColor = new THREE.Color('#2c4270');
  const skyU = {
    uZenith: { value: new THREE.Color('#040812') },
    uHorizon: { value: fogColor.clone() },
    uDawn: { value: new THREE.Color('#3b2a3e') },
    uDawnAmt: { value: 0 },
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), skyMaterial(skyU));
  sky.frustumCulled = false;
  scene.add(sky);
  const stars = starField(low ? 900 : 1800, 1400, { upperOnly: true });
  scene.add(stars);
  const moonDisc = new THREE.Group();
  const disc = glowSprite(new THREE.Color('#f1f4ff'), 60, 0.95);
  const halo = glowSprite(new THREE.Color('#9fb4ff'), 420, 0.35);
  moonDisc.add(halo, disc);
  moonDisc.position.set(-0.45, 0.42, -0.79).normalize().multiplyScalar(1300);
  stars.add(moonDisc); // follows the camera with the stars

  const cowY = terrainHeight(0, 0);
  const rig = cowGltf ? modelCow(cowGltf, reduced) : blockCow();
  rig.object.position.set(0, cowY - 0.05, 0);
  scene.add(rig.object);
  rig.update(0);
  const { led, ledWorld } = rig;
  // The LED is the focal point: a hot core, a soft halo, and a pulse on the ground.
  const glow = glowSprite(COLORS.led, 0.55);
  const ledCore = glowSprite(new THREE.Color('#ffe6bf'), 0.14);
  for (const g of [glow, ledCore]) { g.material.depthTest = false; g.renderOrder = 10; }
  const pulse = new THREE.Mesh(
    new THREE.RingGeometry(0.92, 1, 64),
    new THREE.MeshBasicMaterial({ color: COLORS.led, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
  );
  pulse.rotation.x = -Math.PI / 2;
  const light = new THREE.PointLight(COLORS.led, 0, 2.5, 2);
  scene.add(glow, ledCore, pulse, light);

  const moonDir = new THREE.Vector3(-0.6, 0.55, 0.3).normalize();
  const tU = {
    uMoonDir: { value: moonDir },
    uMoon: { value: new THREE.Color('#8fa4d6').multiplyScalar(1.5) },
    uAmbient: { value: new THREE.Color('#1c2842').multiplyScalar(1.25) },
    uFog: { value: fogColor },
    uFogDensity: { value: 0.00105 },
    uFoot: { value: new THREE.Vector3(0, 0, -9999) },
    uFootR: { value: FOOT_R },
    uLink: { value: 0 },
    uTime: { value: 0 },
    uSignal: { value: COLORS.signal },
    uLedPos: { value: ledWorld },
    uLed: { value: 0 },
    uLedColor: { value: COLORS.led },
  };
  const terrain = new THREE.Mesh(buildTerrain(low), terrainMaterial(tU));
  scene.add(terrain);
  scene.add(buildGroundDetail(low, tU));

  scene.add(new THREE.HemisphereLight('#8ea3d4', '#141824', 1.5));
  scene.fog = new THREE.FogExp2(fogColor, 0.0011);
  const moon = new THREE.DirectionalLight('#b8c8ff', 2.8);
  moon.position.copy(moonDir).multiplyScalar(50);
  scene.add(moon);

  const { sat, glow: satGlow, strobe } = buildSatellite();
  scene.add(sat);
  const cone = buildCone();
  scene.add(cone);

  const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const beam = new THREE.Line(
    beamGeo,
    new THREE.LineBasicMaterial({ color: COLORS.signal, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  beam.frustumCulled = false;
  scene.add(beam);

  const packets = [];
  for (let i = 0; i < BUFFER; i++) {
    const s = glowSprite(COLORS.signal, 3.2, 0);
    s.visible = false;
    scene.add(s);
    packets.push(s);
  }

  // Satellite path, parameterised by passTime (0..1).
  const satPos = (p, out = new THREE.Vector3()) => {
    // A low, far arc so the collar and the whole pass share one frame.
    const th = lerp(-0.1, Math.PI + 0.1, p);
    // Far enough out that the ridgeline hides it until it clears the mask.
    const S = PATH_SCALE;
    out.set(170 * S * Math.cos(th), 92 * S * Math.sin(th) - 10 * S, -(120 + 60 * (1 - Math.sin(th))) * S);
    return out;
  };
  const elevationAt = (p) => {
    const s = satPos(p);
    const dx = s.x - ledWorld.x, dy = s.y - ledWorld.y, dz = s.z - ledWorld.z;
    return (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
  };

  // Link window derived from the path itself, so the HUD and the visuals agree.
  let linkIn = 1, linkOut = 0, peak = 0;
  for (let p = 0; p <= 1; p += 0.001) {
    const el = elevationAt(p);
    peak = Math.max(peak, el);
    if (el > MASK + 2 && p < linkIn) linkIn = p;
    if (el > MASK) linkOut = p;
  }
  const travel = 0.035;
  const span = linkOut - linkIn - travel - 0.04;
  const departures = Array.from({ length: BUFFER }, (_, i) => linkIn + 0.015 + (i / BUFFER) * span * 0.85);

  const tmp = new THREE.Vector3();
  const foot = new THREE.Vector3();
  const target = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  let lastArrived = 0;
  let aspect = 1;
  let firstFrame = true;

  const telemetry = { el: 0, link: 'below', buffered: BUFFER, onboard: 0, clock: 0, arrivedNow: false, bars: 0 };

  function setupPass(p, time) {
    satPos(p, sat.position);
    sat.lookAt(ledWorld);
    const el = elevationAt(p);
    telemetry.el = el;
    telemetry.clock = p * HORIZON_PASS_SEC;

    let link = 'below';
    if (el > 0) link = 'search';
    if (el > MASK) link = 'acq';
    if (p >= linkIn && p <= linkOut) link = 'up';
    if (p > linkOut && el > 0) link = 'lost';
    if (p > linkOut && el <= 0) link = 'below';
    telemetry.link = link;

    const vis = smooth(-2, 6, el);
    satGlow.material.opacity = 0.75 * vis;
    strobe.material.opacity = link === 'up' ? 0.6 + 0.4 * Math.sin(time * 9) : 0;

    // Footprint: slides across the valley, covering the collar while linked.
    const horiz = tmp.set(sat.position.x - ledWorld.x, 0, sat.position.z - ledWorld.z);
    const hl = horiz.length() || 1;
    const k = (Math.cos((el * Math.PI) / 180) * FOOT_R * 1.05) / hl;
    foot.set(ledWorld.x + horiz.x * k, 0, ledWorld.z + horiz.z * k);
    tU.uFoot.value.copy(foot);
    const linkAmt = smooth(0, MASK, el);
    tU.uLink.value = linkAmt;

    // Cone from satellite to footprint.
    // The drawn beam lands on the collar itself.
    foot.copy(ledWorld);
    cone.position.copy(sat.position);
    target.subVectors(foot, sat.position);
    const len = target.length();
    target.normalize();
    cone.quaternion.setFromUnitVectors(tmp.set(0, -1, 0), target);
    cone.scale.set(BEAM_R, len, BEAM_R);
    cone.material.uniforms.uOpacity.value = linkAmt * (link === 'up' ? 1 : 0.55);
    cone.visible = el > 0;

    // Packets travel up the beam.
    let arrived = 0, inFlight = 0;
    for (let i = 0; i < BUFFER; i++) {
      const t = (p - departures[i]) / travel;
      const s = packets[i];
      if (t >= 1) arrived++;
      if (t > 0 && t < 1) {
        inFlight++;
        const e = t * t * (3 - 2 * t);
        s.position.lerpVectors(ledWorld, sat.position, e);
        // Sized by distance so a packet stays a readable dot all the way up.
        s.scale.setScalar(0.9 + s.position.distanceTo(camera.position) * 0.035);
        s.material.opacity = Math.sin(t * Math.PI) * 0.9 + 0.1;
        s.visible = true;
      } else s.visible = false;
    }
    telemetry.buffered = BUFFER - arrived - inFlight;
    telemetry.onboard = arrived;
    telemetry.arrivedNow = arrived > lastArrived;
    lastArrived = arrived;
    telemetry.bars = link === 'up' ? 4 : link === 'acq' ? 2 : link === 'search' || link === 'lost' ? 1 : 0;

    const beamOn = link === 'up' ? 0.5 : 0;
    beam.material.opacity = beamOn;
    const bp = beamGeo.attributes.position;
    bp.setXYZ(0, ledWorld.x, ledWorld.y, ledWorld.z);
    bp.setXYZ(1, sat.position.x, sat.position.y, sat.position.z);
    bp.needsUpdate = true;
    return { transmitting: inFlight > 0 };
  }

  function update({ mode, p, passTime, time, dt, exact = false, rise = 0, arrive = 1 }) {
    stars.material.uniforms.uTime.value = reduced ? 0 : time;
    tU.uTime.value = reduced ? 0 : time;
    const portrait = aspect < 0.9;
    // Animate first so the collar LED (ledWorld) is current for the camera.
    rig.play(mode === 'pass' ? 'Idle' : 'Eating');
    rig.update(dt);

    let transmitting = false;
    if (mode === 'pass') {
      ({ transmitting } = setupPass(passTime, time));
      skyU.uDawnAmt.value = 0;
      // Low shot beside the cow looking up the valley: the collar sits in the
      // lower right, the satellite crosses the sky above it.
      camera.fov = portrait ? 80 : 52;
      const cx = ledWorld.x + (portrait ? 1.5 : -3.5);
      const cz = ledWorld.z + (portrait ? 10 : 9);
      camPos.set(cx, Math.max(terrainHeight(cx, cz), cowY) + 1.5, cz);
      camTarget.set(
        ledWorld.x + (portrait ? 0 : -6) + (sat.position.x / PATH_SCALE) * (portrait ? 0.05 : 0.025),
        cowY + (portrait ? 5.5 : 11), // portrait: keep the cow above the text card
        ledWorld.z - 40
      );
    } else if (mode === 'final') {
      // Closing scene: a slow loop of passes in the background, dawn coming up.
      const loop = reduced ? 0.5 : (time * 0.035) % 1;
      ({ transmitting } = setupPass(loop, time));
      skyU.uDawnAmt.value = 0.55;
      camera.fov = portrait ? 70 : 50;
      if (portrait) {
        camPos.set(-1, cowY + 2.5, 16);
        camTarget.set(-0.6, cowY + 6, 0);
      } else {
        camPos.set(-6 + p * 2, cowY + 2.4, 15);
        camTarget.set(-5, cowY + 4.5 + p, 0);
      }
    } else {
      // Hero: close on the collar, night, no satellite.
      setupPass(0, time);
      sat.visible = false;
      cone.visible = false;
      tU.uLink.value = 0;
      skyU.uDawnAmt.value = 0;
      const e = smooth(0, 0.45, p);
      if (portrait) {
        camPos.set(lerp(0.6, 0, e), cowY + lerp(0.9, 2.0, e), lerp(8.5, 13, e));
        camTarget.set(lerp(-0.2, -0.6, e), cowY + lerp(0.5, 4.5, e), 0);
      } else {
        camPos.set(lerp(-1.4, -2, e), cowY + lerp(0.9, 2.4, e), lerp(8.5, 13, e));
        camTarget.set(lerp(-2.0, -3.4, e), cowY + lerp(1.0, 5, e), lerp(0, -5, e));
      }
      // Ascent: rise straight up over the collar, turning to look down, so the
      // LED sits at screen centre when the globe takes over (see main.js blend).
      // `rise` (0..1) comes from the hero→globe transition in main.js.
      ascent = rise;
      const over = smooth(0, 0.3, rise);
      camPos.x = lerp(camPos.x, ledWorld.x, over);
      camPos.z = lerp(camPos.z, ledWorld.z + 0.001, over);
      // Exponential climb: the zoom feels like one constant speed.
      const above = camPos.y - cowY;
      camPos.y = cowY + above * Math.pow(ASCENT_TOP / above, rise);
      camTarget.lerp(ledWorld, over);
      camera.fov = lerp(portrait ? 60 : 40, 50, over);
      camera.up.set(0, 1, 0).lerp(tmp.set(0, 0, -1), over).normalize();
    }
    if (mode === 'pass' && arrive < 1) {
      // Chip→pass: start right on the collar LED (where the exploded collar's
      // LED was) and pull back exponentially to the pass framing.
      const dir = tmp.subVectors(camPos, ledWorld);
      const full = dir.length();
      const near = 0.45;
      dir.normalize();
      camPos.copy(ledWorld).addScaledVector(dir, near * Math.pow(full / near, arrive));
      // Blend the view direction (not the target point, which is ~50 m out)
      // so the LED stays centred until the pull-back is well under way.
      const s = smooth(0.1, 1, arrive);
      const d0 = target.subVectors(ledWorld, camPos).normalize();
      const d1 = camTarget.sub(camPos).normalize();
      d0.lerp(d1, s).normalize();
      camTarget.copy(camPos).add(d0);
    }
    if (mode !== 'hero') { ascent = 0; camera.up.set(0, 1, 0); }
    // Haze thins as the camera climbs so the valley stays readable from above.
    tU.uFogDensity.value = lerp(FOG, FOG * 0.2, ascent);
    scene.fog.density = lerp(0.0011, 0.0002, ascent);
    if (mode !== 'hero') sat.visible = true;
    camera.updateProjectionMatrix();

    glow.position.copy(ledWorld);
    ledCore.position.copy(ledWorld);
    light.position.copy(ledWorld).add(tmp.set(0, 0.1, 0.25));

    // LED: heartbeat blink, flashes signal-green while transmitting.
    let ledOn;
    if (reduced) ledOn = 0.8;
    else {
      const ph = (time % 2.4) / 2.4;
      ledOn = ph < 0.06 ? 1 : ph > 0.12 && ph < 0.16 ? 0.7 : 0.32;
    }
    if (transmitting && !reduced) ledOn = 0.4 + 0.6 * (Math.sin(time * 30) > 0 ? 1 : 0);
    const ledColor = transmitting ? COLORS.signal : COLORS.led;
    led.material.color.copy(ledColor);
    glow.material.color.copy(ledColor);
    glow.material.opacity = ledOn * 0.85;
    // During the ascent the LED keeps a constant size on screen.
    const keep = Math.max(1, camera.position.distanceTo(ledWorld) / 9);
    glow.scale.setScalar(keep * (mode === 'hero' ? 0.8 : mode === 'final' ? 1.8 : 1.1) * (0.8 + ledOn * 0.3));
    ledCore.material.opacity = 0.55 + ledOn * 0.45;
    ledCore.scale.setScalar(keep * (mode === 'hero' ? 0.14 : mode === 'final' ? 0.28 : 0.22));
    light.color.copy(ledColor);
    light.intensity = ledOn * 0.3;
    // Ground pulse on each heartbeat (hero and closing scene only).
    const beat = ((time % 2.4) / 2.4) / 0.55;
    pulse.visible = !reduced && mode !== 'pass' && beat < 1 && ascent < 0.05;
    if (pulse.visible) {
      const e = 1 - Math.pow(1 - beat, 3);
      pulse.position.set(ledWorld.x, terrainHeight(ledWorld.x, ledWorld.z) + 0.04, ledWorld.z);
      pulse.scale.setScalar(lerp(0.3, 3.2, e));
      pulse.material.opacity = Math.pow(1 - beat, 2) * 0.55;
      pulse.material.color.copy(ledColor);
    }
    tU.uLed.value = ledOn;
    tU.uLedColor.value = ledColor;

    // Camera easing (skipped for reduced motion).
    const k = reduced || exact || firstFrame ? 1 : 1 - Math.exp(-dt * 6);
    camera.position.lerp(camPos, k);
    cameraTarget.lerp(camTarget, k);
    camera.lookAt(cameraTarget);
    firstFrame = false;
    sky.position.copy(camera.position);
    stars.position.copy(camera.position);
    return telemetry;
  }
  const cameraTarget = new THREE.Vector3(0, cowY + 1, 0);
  const ASCENT_TOP = 2600;
  const FOG = tU.uFogDensity.value;
  let ascent = 0;
  
  const proj = new THREE.Vector3();
  /** Screen positions (px) of the collar and the satellite, for HTML labels. */
  function passScreen(w, h) {
    const at = (v) => {
      proj.copy(v).project(camera);
      return { x: (proj.x * 0.5 + 0.5) * w, y: (-proj.y * 0.5 + 0.5) * h, visible: proj.z < 1 && Math.abs(proj.x) < 1.1 && Math.abs(proj.y) < 1.1 };
    };
    return { collar: at(ledWorld), sat: at(sat.position) };
  }

  return {
    scene,
    camera,
    update,
    passScreen,
    resize(w, h) { aspect = w / h; camera.aspect = aspect; camera.updateProjectionMatrix(); },
    setPixel(px) { stars.material.uniforms.uPixel.value = px; },
    snap() { firstFrame = true; },
    telemetry,
    rig,
    passMeta: { linkIn, linkOut, peak },
  };
}
