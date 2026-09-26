// Exploded view of the collar: standard modem, standard SIM, nothing exotic.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { COLORS, glowTexture, smooth, lerp } from './common.js';

// ---------------------------------------------------------------------------
// Canvas textures: printed detail is cheaper and crisper than geometry.
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function pcbTexture() {
  return canvasTex(1024, 628, (g, W, H) => {
    g.fillStyle = '#0c3326';
    g.fillRect(0, 0, W, H);
    // Copper traces under the solder mask.
    g.strokeStyle = 'rgba(70, 150, 105, 0.55)';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const trace = (pts, w = 3) => {
      g.lineWidth = w;
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    };
    for (let i = 0; i < 9; i++) trace([[440, 250 + i * 14], [560 + i * 6, 250 + i * 14], [600 + i * 6, 210 + i * 14], [760, 210 + i * 14]], 2.5);
    for (let i = 0; i < 6; i++) trace([[300 - i * 14, 180], [300 - i * 14, 90], [120 - i * 14, 60 + i * 4]], 3);
    for (let i = 0; i < 5; i++) trace([[330, 450 + i * 12], [520, 450 + i * 12], [560, 500 + i * 12], [880, 500 + i * 12]], 2.5);
    trace([[120, 560], [900, 560]], 10); // ground rail
    // Vias.
    for (let i = 0; i < 60; i++) {
      const x = 60 + ((i * 197) % 900), y = 40 + ((i * 131) % 540);
      g.fillStyle = '#c9a45a';
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#0c3326';
      g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.fill();
    }
    // Plated mounting holes in the corners.
    for (const [x, y] of [[34, 34], [W - 34, 34], [34, H - 34], [W - 34, H - 34]]) {
      g.fillStyle = '#d6b465';
      g.beginPath(); g.arc(x, y, 18, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#050608';
      g.beginPath(); g.arc(x, y, 10, 0, Math.PI * 2); g.fill();
    }
    // Pads and edge connector.
    g.fillStyle = '#d6b465';
    for (let i = 0; i < 12; i++) g.fillRect(180 + i * 22, 146, 10, 18);
    for (let i = 0; i < 12; i++) g.fillRect(180 + i * 22, 452, 10, 18);
    for (let i = 0; i < 10; i++) g.fillRect(W - 34, 120 + i * 40, 26, 22);
    // Silkscreen.
    g.strokeStyle = 'rgba(235, 240, 235, 0.75)';
    g.fillStyle = 'rgba(235, 240, 235, 0.8)';
    g.lineWidth = 2;
    g.strokeRect(170, 170, 290, 270); // modem outline
    g.strokeRect(640, 300, 150, 110); // SIM outline
    g.font = '600 22px monospace';
    g.fillText('U1  NB-IoT NTN', 176, 132);
    g.fillText('SIM1', 646, 290);
    g.fillText('J1', W - 80, 110);
    g.font = '500 18px monospace';
    g.fillText('COLLAR-01  REV C', 60, H - 30);
    g.fillText('3GPP R17', W - 200, H - 30);
    g.beginPath(); g.arc(W - 90, H - 90, 12, 0, Math.PI * 2); g.stroke(); // fiducial
  });
}

function modemLabel() {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#ffffff';
    g.font = '700 34px monospace';
    g.fillText('NB-IoT', 24, 72);
    g.font = '500 21px monospace';
    g.fillText('NTN MODULE', 24, 108);
    g.fillText('3GPP REL-17', 24, 138);
    g.globalAlpha = 0.6;
    g.fillRect(24, 170, 150, 2);
    g.beginPath(); g.arc(212, 212, 10, 0, Math.PI * 2); g.fill();
  });
}

function simTexture() {
  return canvasTex(256, 192, (g, W, H) => {
    g.fillStyle = '#e8e2d2';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#d8b25a';
    const x0 = 70, y0 = 40, w = 116, h = 112;
    g.fillRect(x0, y0, w, h);
    g.strokeStyle = '#a8812f';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(x0 + w / 2, y0); g.lineTo(x0 + w / 2, y0 + h);
    for (let i = 1; i < 3; i++) { g.moveTo(x0, y0 + (h * i) / 3); g.lineTo(x0 + w, y0 + (h * i) / 3); }
    g.stroke();
  });
}

function flexTexture() {
  return canvasTex(1024, 128, (g, W) => {
    g.fillStyle = '#b8611f';
    g.fillRect(0, 0, W, 128);
    g.strokeStyle = '#f0c07a';
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(20, 100);
    for (let x = 60; x < W - 60; x += 48) {
      g.lineTo(x, 100); g.lineTo(x, 28); g.lineTo(x + 24, 28); g.lineTo(x + 24, 100);
    }
    g.lineTo(W - 20, 100);
    g.stroke();
    g.fillStyle = '#f0c07a';
    g.fillRect(8, 86, 30, 30);
  });
}

function plateTexture() {
  return canvasTex(512, 160, (g) => {
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.font = '600 44px monospace';
    g.fillText('COLLAR-01', 28, 70);
    g.font = '400 24px monospace';
    g.globalAlpha = 0.6;
    g.fillText('NB-IoT · SAT + CELL', 28, 118);
  });
}

function sleeveTexture() {
  // u wraps round the cell, v runs along its axis.
  return canvasTex(512, 512, (g, W, H) => {
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#1a3452'); grad.addColorStop(0.5, '#21426a'); grad.addColorStop(1, '#1a3452');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#e6ebf0';
    g.fillRect(0, H * 0.2, W, H * 0.07);
    g.fillStyle = 'rgba(230, 235, 240, 0.85)';
    for (const u of [0.195, 0.695]) {
      g.save();
      g.translate(W * u, H * 0.62);
      g.rotate(Math.PI / 2);
      g.textAlign = 'center';
      g.font = '700 30px monospace';
      g.fillText('3.6 V  Li-SOCl2', 0, -6);
      g.font = '400 18px monospace';
      g.fillText('PRIMARY CELL · DO NOT RECHARGE', 0, 22);
      g.restore();
    }
  });
}

/** Fine grain for a moulded, bead-blasted plastic finish (linear data). */
function grainTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 190 + Math.random() * 65;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 5);
  return t;
}

/** Rounded rectangle path, centred, for extruded shells and gaskets. */
function roundRect(shape, w, h, r) {
  const x = -w / 2, y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

/** A rounded-rect ring extruded upward (y) from y = 0: walls, gaskets. */
function ringGeometry(ow, oh, or, iw, ih, ir, depth, bevel = 0) {
  const shape = roundRect(new THREE.Shape(), ow, oh, or);
  shape.holes.push(roundRect(new THREE.Path(), iw, ih, ir));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, curveSegments: 10,
    bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, bevel, 0);
  return geo;
}

/** Flat band: a stadium profile lathed round the z axis. */
function strapGeometry(radius, width, thick) {
  const r = thick / 2, cx = radius - r, hw = width / 2 - r;
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI + (Math.PI * i) / 8;
    pts.push(new THREE.Vector2(cx + Math.cos(a) * r, -hw + Math.sin(a) * r));
  }
  for (let i = 0; i <= 8; i++) {
    const a = (Math.PI * i) / 8;
    pts.push(new THREE.Vector2(cx + Math.cos(a) * r, hw + Math.sin(a) * r));
  }
  pts.push(pts[0].clone());
  const geo = new THREE.LatheGeometry(pts, 160);
  geo.rotateX(Math.PI / 2);
  return geo;
}

export function createCollar({ reduced, renderer }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#05070c');
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 100);

  // Soft studio reflections: plastic and metal need something to reflect.
  if (renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.32;
    pmrem.dispose();
  }

  scene.add(new THREE.HemisphereLight('#9fb4d8', '#07080b', 0.45));
  const key = new THREE.DirectionalLight('#fff4e6', 2.4);
  key.position.set(3, 6, 4);
  scene.add(key);
  // Soft shadows ground the parts on each other, closed and exploded.
  if (renderer) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -2.4, right: 2.4, top: 2.4, bottom: -2.4, near: 1, far: 16 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.015;
    key.shadow.radius = 4;
  }
  const fill = new THREE.DirectionalLight('#8fb0e0', 0.6);
  fill.position.set(-5, 1, 3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(COLORS.signal, 2.2);
  rim.position.set(-3, 3, -5);
  scene.add(rim);

  const root = new THREE.Group();
  scene.add(root);

  const grain = grainTexture();
  const plastic = (color, extra = {}) => new THREE.MeshPhysicalMaterial({
    color, roughness: 0.5, roughnessMap: grain, bumpMap: grain, bumpScale: 0.35,
    clearcoat: 0.35, clearcoatRoughness: 0.4, sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color('#8fa6c8'),
    ...extra,
  });
  const metal = (color, roughness = 0.3) => new THREE.MeshStandardMaterial({ color, metalness: 1, roughness });
  const matte = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });

  // Strap: a flat TPU band the housing hangs from.
  const strap = new THREE.Mesh(
    strapGeometry(2.1, 0.62, 0.09),
    new THREE.MeshPhysicalMaterial({ color: '#1b222c', roughness: 0.62, clearcoat: 0.25, clearcoatRoughness: 0.5, transparent: true })
  );

  const layers = [];
  const addLayer = (obj, baseY, spread) => {
    obj.position.y = baseY;
    root.add(obj);
    layers.push({ obj, baseY, spread });
    return obj;
  };
  const corners = [[-0.72, -0.4], [0.72, -0.4], [-0.72, 0.4], [0.72, 0.4]];

  // Bottom housing: a tray with screw bosses and strap lugs.
  const shellGroup = new THREE.Group();
  const shellMat = plastic('#2a323f');
  // Hollow tray: walls, a base, and a darker moulded floor inside.
  const walls = new THREE.Mesh(ringGeometry(1.66, 1.01, 0.12, 1.52, 0.87, 0.06, 0.4, 0.02), shellMat);
  walls.position.y = -0.23;
  shellGroup.add(walls);
  const base = new THREE.Mesh(new RoundedBoxGeometry(1.7, 0.08, 1.05, 3, 0.04), shellMat);
  base.position.y = -0.19;
  shellGroup.add(base);
  const innerMat = matte('#12161c', { roughness: 0.8 });
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(roundRect(new THREE.Shape(), 1.52, 0.87, 0.06), 8), innerMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.149;
  shellGroup.add(floor);
  // Battery cradle ribs.
  for (const x of [-0.42, 0, 0.42]) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.8), innerMat);
    rib.position.set(x, -0.13, 0);
    shellGroup.add(rib);
  }
  // Screw bosses moulded into the corners, with pilot holes.
  const holeMat = matte('#050608', { roughness: 1 });
  for (const [x, z] of corners) {
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.38, 20), shellMat);
    boss.position.set(x, 0.04, z);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.018, 16), holeMat);
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(x, 0.231, z);
    shellGroup.add(boss, hole);
  }
  // Silicone gasket seated on the rim: the enclosure is sealed.
  const gasket = new THREE.Mesh(
    ringGeometry(1.6, 0.95, 0.09, 1.56, 0.91, 0.07, 0.014),
    new THREE.MeshStandardMaterial({ color: '#c7652c', roughness: 0.75 })
  );
  gasket.position.y = 0.23;
  shellGroup.add(gasket);
  for (const s of [-1, 1]) {
    // Strap loop: a moulded eyelet the band threads through.
    const loop = roundRect(new THREE.Shape(), 0.8, 0.22, 0.08);
    loop.holes.push(roundRect(new THREE.Path(), 0.68, 0.11, 0.045));
    const lg = new THREE.ExtrudeGeometry(loop, { depth: 0.1, curveSegments: 10, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 3 });
    lg.translate(0, 0, -0.05);
    lg.rotateY(Math.PI / 2);
    const lug = new THREE.Mesh(lg, shellMat);
    lug.position.set(s * 0.9, -0.06, 0);
    shellGroup.add(lug);
  }
  // The strap runs through the lugs and travels with the base.
  strap.position.y = 2.0;
  shellGroup.add(strap);
  addLayer(shellGroup, -0.02, -1.4);

  // Battery: two sleeved cells with metal caps.
  const battery = new THREE.Group();
  const sleeve = new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: sleeveTexture(), roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2 });
  const capMat = metal('#b8c0c8', 0.25);
  for (const z of [-0.2, 0.2]) {
    const cell = new THREE.Group();
    cell.add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.12, 36), sleeve));
    for (const s of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 28), capMat);
      cap.position.y = s * 0.58;
      cell.add(cap);
    }
    const nub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), capMat);
    nub.position.y = 0.61;
    cell.add(nub);
    cell.rotation.z = Math.PI / 2;
    cell.position.z = z;
    battery.add(cell);
    // Nickel solder tab on the negative end, where the lead is soldered.
    const tab = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.13, 0.07), metal('#cfd5da', 0.35));
    tab.position.set(0.605, 0.04, z);
    const solder = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), metal('#d9dde0', 0.2));
    solder.position.set(0.612, 0.07, z);
    battery.add(tab, solder);
  }
  addLayer(battery, 0.02, -0.65);

  // PCB: printed board, shielded modem, SIM, passives.
  const pcb = new THREE.Group();
  const edge = matte('#0a2a1f');
  // Solder mask with a conformal coat: a thin glossy layer over the print.
  const boardTop = new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: pcbTexture(), roughness: 0.55, clearcoat: 0.9, clearcoatRoughness: 0.12 });
  pcb.add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.035, 0.92), [edge, edge, boardTop, edge, edge, edge]));

  const modem = new THREE.Group();
  modem.position.set(-0.4, 0.05, -0.02);
  modem.add(new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.06, 0.42, 2, 0.008), metal('#aeb6bf', 0.32)));
  const labelTex = modemLabel();
  const modemLabelMat = new THREE.MeshStandardMaterial({
    color: '#2b3038', map: labelTex, transparent: true, roughness: 0.5,
    emissive: COLORS.signal, emissiveMap: labelTex, emissiveIntensity: 0,
  });
  const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), modemLabelMat);
  lbl.rotation.x = -Math.PI / 2;
  lbl.position.y = 0.031;
  modem.add(lbl);
  // Signal outline round the module, lit when the modem is the subject.
  const outlineMat = new THREE.MeshBasicMaterial({ color: COLORS.signal, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const outline = new THREE.Mesh(new THREE.RingGeometry(0.31, 0.325, 4, 1, Math.PI / 4), outlineMat);
  outline.rotation.x = -Math.PI / 2;
  outline.position.y = -0.012;
  modem.add(outline);
  pcb.add(modem);

  const sim = new THREE.Group();
  sim.position.set(0.3, 0.03, 0.08);
  sim.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.018, 0.16), metal('#9aa3ad', 0.4)));
  const simBody = matte('#e8e2d2');
  const card = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.006, 0.12), [
    simBody, simBody, matte('#ffffff', { map: simTexture(), roughness: 0.35, metalness: 0.2 }), simBody, simBody, simBody,
  ]);
  card.position.y = 0.012;
  sim.add(card);
  pcb.add(sim);

  const partMat = matte('#15181d', { roughness: 0.4 });
  for (const [x, z, w, h, d] of [
    [0.05, -0.28, 0.16, 0.035, 0.16], // MCU
    [0.28, -0.3, 0.08, 0.025, 0.06],
    [0.46, -0.28, 0.1, 0.03, 0.05],
    [0.58, 0.3, 0.06, 0.03, 0.06],
    [-0.02, 0.3, 0.1, 0.03, 0.08],
  ]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), partMat);
    m.position.set(x, 0.0175 + h / 2, z);
    pcb.add(m);
  }
  const passiveMat = matte('#8a7a5c', { roughness: 0.5 });
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.014, 0.016), passiveMat);
    m.position.set(0.12 + (i % 7) * 0.05, 0.025, -0.1 + Math.floor(i / 7) * 0.05);
    pcb.add(m);
  }
  // Battery connector the leads plug into.
  const jst = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.11), matte('#e9e4d6', { roughness: 0.5 }));
  jst.position.set(0.66, 0.0375, 0.3);
  pcb.add(jst);
  const ufl = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.025, 16), metal('#d5b56a', 0.3));
  ufl.position.set(-0.64, 0.03, -0.36);
  pcb.add(ufl);
  addLayer(pcb, 0.2, 0);

  // Flex antenna: polyimide with a printed meander trace.
  const antenna = new THREE.Mesh(
    new THREE.BoxGeometry(1.35, 0.008, 0.16),
    new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: flexTexture(), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15 })
  );
  antenna.position.z = -0.3;
  const antennaWrap = new THREE.Group();
  antennaWrap.add(antenna);
  addLayer(antennaWrap, 0.28, 0.6);

  // Top cover: printed plate, screws, flush LED light pipe.
  const cover = new THREE.Group();
  cover.add(new THREE.Mesh(new RoundedBoxGeometry(1.7, 0.2, 1.05, 4, 0.1), plastic('#353f4e', { roughness: 0.35, clearcoat: 0.7 })));
  // Nameplate: a satin metal insert set into a moulded frame on the lid.
  const plateAt = new THREE.Vector3(-0.3, 0.1, 0.2);
  const frame = new THREE.Mesh(
    ringGeometry(0.76, 0.3, 0.06, 0.7, 0.245, 0.035, 0.004, 0.003),
    plastic('#3b4555', { roughness: 0.3, clearcoat: 0.8 })
  );
  frame.position.copy(plateAt).setY(0.098);
  cover.add(frame);
  const insert = new THREE.Mesh(
    new THREE.ShapeGeometry(roundRect(new THREE.Shape(), 0.7, 0.245, 0.035), 8),
    new THREE.MeshPhysicalMaterial({ color: '#232a34', metalness: 0.7, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 })
  );
  insert.rotation.x = -Math.PI / 2;
  insert.position.copy(plateAt).setY(0.1008);
  cover.add(insert);
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.62, 0.194),
    new THREE.MeshStandardMaterial({ color: '#e3e9f1', map: plateTexture(), transparent: true, roughness: 0.4, metalness: 0.3 })
  );
  plate.rotation.x = -Math.PI / 2;
  plate.position.copy(plateAt).setY(0.1014);
  cover.add(plate);
  const screwMat = metal('#8a939e', 0.35), slotMat = matte('#20252c');
  for (const [x, z] of corners) {
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.015, 16), screwMat);
    head.position.set(x, 0.1, z);
    cover.add(head);
    for (const a of [0.6, 0.6 + Math.PI / 2]) {
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.004, 0.009), slotMat);
      slot.position.set(x, 0.107, z);
      slot.rotation.y = a;
      cover.add(slot);
    }
  }

  const ledAt = new THREE.Vector3(0.52, 0.1, 0.28);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.01, 10, 32), metal('#6d7784', 0.3));
  bezel.material.transparent = true; // faded in after the globe→chip handoff
  bezel.rotation.x = Math.PI / 2;
  bezel.position.copy(ledAt).setY(0.101);
  cover.add(bezel);
  const ledMat = new THREE.MeshStandardMaterial({ color: '#3a2a12', emissive: COLORS.led, emissiveIntensity: 1, roughness: 0.2, transparent: true });
  const led = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.01, 28), ledMat);
  led.position.copy(ledAt).setY(0.101);
  cover.add(led);
  // Light spilling across the cover (lies flat, so it never clips).
  const haloMat = new THREE.MeshBasicMaterial({
    map: glowTexture(), color: COLORS.led, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), haloMat);
  halo.rotation.x = -Math.PI / 2;
  halo.position.copy(ledAt).setY(0.103);
  cover.add(halo);
  // Small bloom just above the lens.
  const bloom = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: COLORS.led, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  bloom.scale.setScalar(0.2);
  bloom.position.copy(ledAt).setY(0.12);
  cover.add(bloom);
  const ledLight = new THREE.PointLight(COLORS.led, 0.3, 0.9, 2);
  ledLight.position.copy(ledAt).setY(0.2);
  cover.add(ledLight);
  addLayer(cover, 0.31, 1.3);

  // Cables: coax from the modem's u.FL to the flex antenna, and the battery
  // leads to the board. Rebuilt when the explode amount changes so they stretch.
  const cables = [
    { from: [pcb, -0.64, 0.045, -0.36], to: [antennaWrap, -0.66, 0, -0.3], out: -1, r: 0.009, mat: matte('#1a1d22', { roughness: 0.45 }) },
    { from: [battery, 0.62, 0.07, 0.2], to: [pcb, 0.7, 0.04, 0.27], out: 1, r: 0.008, mat: matte('#b3261e', { roughness: 0.4 }) },
    { from: [battery, 0.62, 0.07, -0.2], to: [pcb, 0.7, 0.04, 0.33], out: 1, r: 0.008, mat: matte('#16181c', { roughness: 0.4 }) },
  ].map((c) => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), c.mat);
    mesh.castShadow = true;
    root.add(mesh);
    return { ...c, mesh };
  });
  let cableE = -1;
  const pa = new THREE.Vector3(), pb = new THREE.Vector3();
  function updateCables(e) {
    if (Math.abs(e - cableE) < 0.002) return;
    cableE = e;
    for (const c of cables) {
      const [oa, ...a] = c.from, [ob, ...b] = c.to;
      pa.set(a[0], a[1], a[2]).add(oa.position);
      pb.set(b[0], b[1], b[2]).add(ob.position);
      const slack = 0.1 + Math.abs(pa.y - pb.y) * 0.25;
      const curve = new THREE.CatmullRomCurve3([
        pa.clone(),
        pa.clone().add(new THREE.Vector3(c.out * slack, 0.02, 0)),
        pb.clone().add(new THREE.Vector3(c.out * slack, -0.02, 0)),
        pb.clone(),
      ]);
      c.mesh.geometry.dispose();
      c.mesh.geometry = new THREE.TubeGeometry(curve, 32, c.r, 6, false);
    }
  }

  root.traverse((o) => {
    if (!o.isMesh || o.material.transparent || o === strap) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });

  // Label anchors: world positions the page projects to place HTML labels.
  const anchors = [
    { key: 'chip.lbl.cover', obj: led },
    { key: 'chip.lbl.antenna', obj: antenna, offset: new THREE.Vector3(0.68, 0, 0) },
    { key: 'chip.lbl.modem', obj: modem, primary: true },
    { key: 'chip.lbl.sim', obj: sim, offset: new THREE.Vector3(0.12, 0, 0.1) },
    { key: 'chip.lbl.battery', obj: battery, offset: new THREE.Vector3(0.62, 0, 0.2) },
    { key: 'chip.lbl.shell', obj: shellGroup, offset: new THREE.Vector3(0.85, 0, 0) },
  ];

  let aspect = 1, vw = 1, vh = 1, offX = 0, offY = 0;
  const v = new THREE.Vector3();
  const camPos = new THREE.Vector3(), target = new THREE.Vector3(), ledWorld = new THREE.Vector3(), dir = new THREE.Vector3();
  function update({ p, time, intro = 1, close = 0, ledVis = 1 }) {
    // `close` (chip→pass) snaps the parts back together before the push-in.
    const e = smooth(0.12, 0.6, p) * (1 - smooth(0, 1, close));
    for (const l of layers) l.obj.position.y = l.baseY + l.spread * e;
    root.rotation.y = lerp(-0.9, -0.35, p) + (reduced ? 0 : Math.sin(time * 0.3) * 0.04);
    root.rotation.x = lerp(0.1, 0.32, e);
    // The strap steps back once the parts separate, so it never hides them.
    strap.material.opacity = 1 - smooth(0.05, 0.4, e);
    strap.material.depthWrite = strap.material.opacity > 0.99;
    strap.visible = strap.material.opacity > 0.01;
    updateCables(e);

    const focus = smooth(0.45, 0.7, p);
    const breathe = reduced ? 0.8 : 0.6 + 0.4 * Math.sin(time * 3);
    modemLabelMat.emissiveIntensity = focus * breathe * 1.2;
    outlineMat.opacity = focus * breathe * 0.9;

    // Heartbeat: a quick flash that decays over a dim idle glow.
    let level = reduced ? 0.8 : 0.3 + 0.7 * Math.exp(-(time % 2.4) * 5);

    const portrait = aspect < 0.9;
    camera.fov = portrait ? 52 : 34;
    camPos.set(0, lerp(1.4, 1.0, e), lerp(6.5, 8.2, e) * (portrait ? 1.25 : 1));
    target.set(0, lerp(0.6, 0.15, e), 0);
    let off = 1;
    if (intro < 1) {
      // Globe→chip: start right on the LED (where the globe's amber dot was)
      // and pull back exponentially to the chapter's framing. Chip→pass runs
      // the same move backwards, into the LED.
      root.updateMatrixWorld();
      led.getWorldPosition(ledWorld);
      dir.subVectors(camPos, ledWorld);
      const full = dir.length();
      const near = 0.4;
      dir.normalize();
      camPos.copy(ledWorld).addScaledVector(dir, near * Math.pow(full / near, intro));
      const s = smooth(0, 1, intro);
      target.lerpVectors(ledWorld, target, s);
      off = s;
      level = lerp(1, level, smooth(0.6, 1, intro));
    }
    // ledVis: the whole light (lens, ring, glow) masked out and faded back in.
    ledMat.opacity = bezel.material.opacity = ledVis;
    led.visible = bezel.visible = ledVis > 0.001;
    level *= ledVis;
    ledMat.emissiveIntensity = 0.6 + level * 2.2;
    haloMat.opacity = (0.15 + level * 0.55) * ledVis;
    bloom.material.opacity = (0.25 + level * 0.75) * ledVis;
    ledLight.intensity = level * 0.5;

    camera.position.copy(camPos);
    camera.lookAt(target);
    camera.setViewOffset(vw, vh, offX * off, offY * off, vw, vh);
    camera.updateProjectionMatrix();
    return { explode: e };
  }

  /** Screen positions (px) of label anchors. */
  function labelPositions(w, h) {
    scene.updateMatrixWorld();
    return anchors.map((a) => {
      a.obj.getWorldPosition(v);
      if (a.offset) v.add(a.offset.clone().applyQuaternion(root.quaternion));
      v.project(camera);
      return { key: a.key, primary: !!a.primary, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
    });
  }

  return {
    scene,
    camera,
    update,
    labelPositions,
    resize(w, h) {
      aspect = w / h; vw = w; vh = h;
      offX = aspect > 0.9 ? -w * 0.16 : w * 0.18;
      offY = aspect > 0.9 ? 0 : h * 0.14;
      camera.aspect = aspect;
      camera.setViewOffset(w, h, offX, offY, w, h);
      camera.updateProjectionMatrix();
    },
    setPixel() {},
    snap() {},
  };
}
