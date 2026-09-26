// The globe: coverage reveal, store-and-forward relay, constellation, scale.
import * as THREE from 'three';
import { feature } from 'topojson-client';
import { CONFIG } from '../config.js';
import { layout, satEci, satEcef, ecefFromLatLon, elevation, ORBIT_RATIO } from '../orbit.js';
import { COVERAGE } from './coverage-data.js';
import { COLORS, glowSprite, glowTexture, starField, smooth, lerp } from './common.js';

const M = CONFIG.model;
const SAT_R = 1 + (ORBIT_RATIO - 1) * 2.2; // orbit height exaggerated for legibility
const OMEGA_E = 7.2921159e-5;
const MAX_SATS = 120;

/** ECEF unit vector -> scene coordinates (y = north, matches SphereGeometry UVs). */
const toScene = (e, r = 1, out = new THREE.Vector3()) => out.set(e[0] * r, e[2] * r, -e[1] * r);
const latLon = (lat, lon, r = 1) => toScene(ecefFromLatLon(lat, lon), r);

function buildMap(topo, W = 1024, H = 512) {
  const land = document.createElement('canvas');
  land.width = W; land.height = H;
  const g = land.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff';
  const px = (lon) => ((lon + 180) / 360) * W;
  const py = (lat) => ((90 - lat) / 180) * H;
  const geo = feature(topo, topo.objects.land);
  const polys = geo.features.flatMap((f) =>
    f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
  );
  for (const poly of polys) {
    g.beginPath();
    for (const ring of poly) {
      ring.forEach(([lon, lat], i) => (i ? g.lineTo(px(lon), py(lat)) : g.moveTo(px(lon), py(lat))));
      g.closePath();
    }
    g.fill('evenodd');
  }

  const cov = document.createElement('canvas');
  cov.width = W; cov.height = H;
  const c = cov.getContext('2d');
  c.globalCompositeOperation = 'lighter';
  for (const [lat, lon, r, w] of COVERAGE) {
    const rx = (r / 360) * W;
    c.save();
    c.translate(px(lon), py(lat));
    c.scale(1 / Math.max(0.35, Math.cos((lat * Math.PI) / 180)), 1);
    const grad = c.createRadialGradient(0, 0, 0, 0, 0, rx);
    grad.addColorStop(0, `rgba(255,255,255,${w})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = grad;
    c.beginPath();
    c.arc(0, 0, rx, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  const L = g.getImageData(0, 0, W, H).data;
  const C = c.getImageData(0, 0, W, H).data;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    // DataTexture rows start at the bottom; flip so north is up.
    const src = y * W * 4, dst = (H - 1 - y) * W * 4;
    for (let x = 0; x < W * 4; x += 4) {
      const land = L[src + x];
      out[dst + x] = land;
      out[dst + x + 1] = land > 127 ? C[src + x] : 0;
      out[dst + x + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(out, W, H, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function globeMaterial(map, rows) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uReveal: { value: 0 },
      uCovAlpha: { value: 1 },
      uDots: { value: 1 },
      uLandNear: { value: new THREE.Color('#34445f') },
      uRows: { value: rows },
      uOcean: { value: new THREE.Color('#050b16') },
      uLand: { value: new THREE.Color('#1f2a3b') },
      uCov: { value: COLORS.coverage },
      uRim: { value: new THREE.Color('#2a5a8a') },
      uSun: { value: new THREE.Vector3(-0.4, 0.5, 1).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      #define PI 3.14159265
      uniform sampler2D uMap; uniform float uReveal; uniform float uCovAlpha; uniform float uRows; uniform float uDots; uniform vec3 uLandNear;
      uniform vec3 uOcean; uniform vec3 uLand; uniform vec3 uCov; uniform vec3 uRim;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main() {
        float row = floor(vUv.y * uRows);
        float rowLat = ((row + 0.5) / uRows - 0.5) * PI;
        float cols = max(3.0, floor(uRows * 2.0 * cos(rowLat)));
        vec2 cell = vec2(fract(vUv.x * cols), fract(vUv.y * uRows)) - 0.5;
        vec2 cUv = vec2((floor(vUv.x * cols) + 0.5) / cols, (row + 0.5) / uRows);
        vec4 m = texture2D(uMap, cUv);
        float d = length(cell);
        float aa = fwidth(d) * 1.2;
        float dotM = 1.0 - smoothstep(0.3 - aa, 0.3 + aa, d);
        float land = step(0.5, m.r);
        float cov = m.g;
        float thr = 1.0 - uReveal;
        float on = step(0.001, uReveal);
        float covered = land * step(0.03, cov) * step(thr, cov) * on;
        float front = land * step(0.03, cov) * (1.0 - covered) * smoothstep(thr - 0.12, thr, cov) * step(0.001, uReveal);

        float fres = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 2.5);
        vec3 ocean = uOcean + uRim * fres * 0.35;
        vec4 ms = texture2D(uMap, vUv);
        float landSmooth = smoothstep(0.35, 0.65, ms.r);

        // Far: dot-matrix globe.
        vec3 dotCol = mix(ocean, uLand * 0.35, landSmooth * 0.5);
        dotCol = mix(dotCol, uLand, land * dotM * 0.85);
        dotCol = mix(dotCol, uCov * 1.6, covered * dotM * uCovAlpha);
        dotCol += uCov * front * dotM * 0.35 * uCovAlpha;

        // Near: a smooth map whose land tone matches the valley seen from above,
        // so the hand-off from the hero reads as one continuous zoom.
        float covS = ms.g * step(0.03, ms.g) * step(thr, ms.g) * on;
        vec3 smoothCol = mix(ocean, uLandNear, landSmooth);
        smoothCol = mix(smoothCol, uCov * 1.1, covS * landSmooth * uCovAlpha);

        vec3 col = mix(smoothCol, dotCol, uDots);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

function atmosphere() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(1.035, 48, 32),
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color('#3f8fd8') } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - w.xyz);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
        void main() {
          float rim = pow(1.0 - abs(dot(vN, vV)), 3.0);
          gl_FragColor = vec4(uColor, rim * 0.55);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
}

function arcPoints(a, b, n, lift = 0, r = 1) {
  const pts = [];
  const va = a.clone().normalize(), vb = b.clone().normalize();
  const ang = va.angleTo(vb);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const v = new THREE.Vector3()
      .copy(va).multiplyScalar(Math.sin((1 - t) * ang) / Math.sin(ang))
      .addScaledVector(vb, Math.sin(t * ang) / Math.sin(ang));
    pts.push(v.multiplyScalar(r + Math.sin(t * Math.PI) * lift));
  }
  return pts;
}

export function createGlobe({ low, reduced, topo }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#03050a');
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);

  const map = buildMap(topo);
  const mat = globeMaterial(map, low ? 110 : 150);
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, low ? 64 : 96, low ? 48 : 64), mat);
  scene.add(globe);
  scene.add(atmosphere());
  const stars = starField(low ? 700 : 1400, 60);
  scene.add(stars);

  // Site marker (the collar).
  const siteDir = latLon(M.site.lat, M.site.lon);
  const siteEcef = ecefFromLatLon(M.site.lat, M.site.lon);
  const siteMarker = glowSprite(COLORS.led, 0.09);
  siteMarker.position.copy(siteDir).multiplyScalar(1.005);
  scene.add(siteMarker);
  const siteRing = new THREE.Mesh(
    new THREE.RingGeometry(0.03, 0.034, 40),
    new THREE.MeshBasicMaterial({ color: COLORS.led, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })
  );
  siteRing.position.copy(siteDir).multiplyScalar(1.004);
  siteRing.lookAt(siteDir.clone().multiplyScalar(2));
  scene.add(siteRing);

  // Ground stations (model assumptions).
  const gsDirs = M.groundStations.map((g) => latLon(g.lat, g.lon));
  const gsMarkers = gsDirs.map((d) => {
    const s = glowSprite(COLORS.signal, 0.08);
    s.position.copy(d).multiplyScalar(1.005);
    scene.add(s);
    return s;
  });

  // Constellation: points + orbit rings.
  const satGeo = new THREE.BufferGeometry();
  satGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SATS * 3), 3));
  const satPts = new THREE.Points(
    satGeo,
    new THREE.PointsMaterial({
      map: glowTexture(), color: '#e8f4ff', size: 0.26, sizeAttenuation: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
  );
  satPts.frustumCulled = false;
  scene.add(satPts);
  const orbitGroup = new THREE.Group();
  scene.add(orbitGroup);
  const orbitMat = new THREE.LineBasicMaterial({ color: '#8fb6e6', transparent: true, opacity: 0.26, depthWrite: false, blending: THREE.AdditiveBlending });

  // Link line from the site to whichever satellite is overhead.
  const linkGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const linkLine = new THREE.Line(linkGeo, new THREE.LineBasicMaterial({ color: COLORS.signal, transparent: true, opacity: 0 }));
  linkLine.frustumCulled = false;
  scene.add(linkLine);

  let current = { n: -1, sats: [] };
  function setConstellation(n) {
    if (n === current.n) return;
    const { sats, planes } = layout(n);
    current = { n, sats };
    orbitGroup.clear();
    const seen = new Set();
    for (const s of sats) {
      if (seen.has(s.plane)) continue;
      seen.add(s.plane);
      const pts = [];
      const p = [0, 0, 0];
      for (let i = 0; i <= 128; i++) {
        satEci({ ...s, m0: (i / 128) * Math.PI * 2 }, 0, p);
        pts.push(toScene(p, SAT_R / ORBIT_RATIO));
      }
      orbitGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), orbitMat));
    }
    satGeo.setDrawRange(0, n);
    void planes;
  }

  // Store-and-forward relay: a single satellite carrying one message from the site to GS-N.
  const relaySat = new THREE.Group();
  const relayGlow = glowSprite(new THREE.Color('#ffffff'), 0.16);
  relaySat.add(relayGlow);
  const msgDot = glowSprite(COLORS.led, 0.13);
  scene.add(msgDot);
  scene.add(relaySat);
  // The model's southern station: close to the valley, so the whole hand-off
  // (collar → satellite → ground → internet) reads in one frame.
  const GS_I = 1;
  const gsDir = gsDirs[GS_I];
  // The satellite keeps going after the downlink: its path runs past the
  // station along the same great circle (GS_AT = fraction where it's overhead).
  const GS_AT = 1 / 1.7;
  const passAxis = new THREE.Vector3().crossVectors(siteDir, gsDir).normalize();
  const pathEnd = siteDir.clone().applyAxisAngle(passAxis, siteDir.angleTo(gsDir) / GS_AT);
  const path = arcPoints(siteDir, pathEnd, 200, 0, SAT_R);
  const gsIdx = Math.round(GS_AT * (path.length - 1));
  const trailGeo = new THREE.BufferGeometry().setFromPoints(path);
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: COLORS.led, transparent: true, opacity: 0.8 }));
  trail.frustumCulled = false;
  scene.add(trail);
  const downGeo = new THREE.BufferGeometry().setFromPoints([gsDir.clone().multiplyScalar(SAT_R), gsDir.clone()]);
  const downLine = new THREE.Line(downGeo, new THREE.LineBasicMaterial({ color: COLORS.signal, transparent: true, opacity: 0 }));
  scene.add(downLine);
  // Internet leg: ground station back to the farm near the valley.
  const farmDir = latLon(M.site.lat + 1.2, M.site.lon + 2.2);
  const netPts = arcPoints(gsDir, farmDir, 160, 0.08, 1.002);
  const netGeo = new THREE.BufferGeometry().setFromPoints(netPts);
  const netLine = new THREE.Line(netGeo, new THREE.LineDashedMaterial({ color: '#dfe8f5', dashSize: 0.02, gapSize: 0.015, transparent: true, opacity: 0.85 }));
  netLine.computeLineDistances();
  netLine.frustumCulled = false;
  scene.add(netLine);

  const tmp = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  let aspect = 1;
  let viewW = 1, viewH = 1;
  let firstFrame = true;
  let simT = 0;
  const telemetry = { reveal: 0, relayState: 'collar', siteVisible: false };

  const camDir = (lat, lon) => latLon(lat, lon);

  function update({ mode, p, time, dt, sats, exact = false, approach, dive = 0 }) {
    stars.material.uniforms.uTime.value = reduced ? 0 : time;
    const portrait = aspect < 0.9;
    const fit = portrait ? 1.75 / Math.max(0.45, aspect) * 0.55 : 1;
    const pulse = reduced ? 1 : 0.6 + 0.4 * Math.sin(time * 4);
    siteMarker.material.opacity = pulse;
    siteRing.scale.setScalar(reduced ? 1 : 1 + ((time * 0.8) % 1) * 1.6);
    siteRing.material.opacity = reduced ? 0.6 : 0.8 * (1 - ((time * 0.8) % 1));

    const showRelay = mode === 'relay';
    const showConst = mode === 'constellation' || mode === 'scale';
    relaySat.visible = msgDot.visible = trail.visible = downLine.visible = netLine.visible = showRelay;
    gsMarkers.forEach((g, i) => (g.visible = showRelay && i === GS_I));
    satPts.visible = orbitGroup.visible = showConst;
    linkLine.visible = showConst;

    let dist = 4.1, lat = 0, lon = 0, shiftX = 0, shiftY = 0, flare = 1;
    if (mode === 'gap') {
      let zoom = smooth(0, 0.28, p);
      dist = lerp(1.22 / fit, 4.1, zoom);
      if (approach !== undefined) {
        // Hero→globe transition: pull back exponentially from just above the
        // site to where this chapter's own scroll takes over (at `p`).
        const start = 1.22, end = dist * fit;
        dist = (1 + (start - 1) * Math.pow((end - 1) / (start - 1), approach)) / fit;
        zoom *= approach;
      }
      // Settle over South America and stay there: the collar remains in view
      // while coverage paints on around it, so its valley visibly stays dark.
      const turn = smooth(0.05, 0.45, p);
      lat = lerp(M.site.lat, -24, turn);
      lon = lerp(M.site.lon, -52, turn);
      mat.uniforms.uReveal.value = smooth(0.3, 0.75, p);
      mat.uniforms.uCovAlpha.value = 1;
      shiftX = 0.18 * zoom;
      telemetry.reveal = mat.uniforms.uReveal.value;
      if (dive > 0) {
        // Gap→chip: dive straight down onto the collar's amber dot.
        const turn = smooth(0, 0.55, dive);
        lat = lerp(lat, M.site.lat, turn);
        lon = lerp(lon, M.site.lon, turn);
        // Stop while the dot-matrix still reads; the marker flares instead.
        const from = dist * fit, to = 1.6;
        dist = (1 + (from - 1) * Math.pow((to - 1) / (from - 1), dive)) / fit;
        shiftX *= 1 - turn;
        siteMarker.material.opacity = lerp(pulse, 1, turn);
        flare = 1 + 14 * Math.pow(smooth(0.25, 1, dive), 2);
        siteRing.material.opacity *= 1 - smooth(0, 0.3, dive);
      }
    } else if (mode === 'relay') {
      mat.uniforms.uReveal.value = 1;
      mat.uniforms.uCovAlpha.value = 0.35;
      const s = p < 0.72 ? smooth(0.08, 0.72, p) * GS_AT : lerp(GS_AT, 1, (p - 0.72) / 0.28);
      const i = Math.min(path.length - 1, Math.round(s * (path.length - 1)));
      relaySat.position.copy(path[i]);
      trailGeo.setDrawRange(0, i + 1);
      // Message: collar -> satellite (first 8%), rides along, then down to GS.
      const up = smooth(0.0, 0.08, p);
      const down = smooth(0.74, 0.8, p);
      const net = smooth(0.8, 0.93, p);
      if (net > 0) {
        const k = Math.min(netPts.length - 1, Math.round(net * (netPts.length - 1)));
        msgDot.position.copy(netPts[k]);
      } else if (down > 0) {
        msgDot.position.lerpVectors(path[gsIdx], gsDir, down);
      } else {
        msgDot.position.lerpVectors(siteDir, relaySat.position, up);
      }
      netGeo.setDrawRange(0, Math.round(net * netPts.length));
      downLine.material.opacity = down > 0 && net < 1 ? 0.9 : 0;
      telemetry.relayState = p < 0.06 ? 'collar' : down <= 0 ? 'sat' : net <= 0.05 ? 'down' : 'net';
      // One framing for the whole hand-off, drifting gently with scroll.
      dist = lerp(2.75, 2.95, p);
      lat = lerp(-47, -55, p);
      lon = lerp(-70, -62, p);
      shiftX = 0.18;
    } else {
      // constellation / scale
      mat.uniforms.uReveal.value = 1;
      mat.uniforms.uCovAlpha.value = mode === 'scale' ? 0.55 : 0.3;
      // Scale says "already in orbit": always show what's actually launched.
      setConstellation(mode === 'scale' ? CONFIG.facts.satellitesLaunched : sats);
      if (!reduced) simT += dt * (mode === 'scale' ? 90 : 160);
      else simT = 1800;
      const pos = satGeo.attributes.position;
      const e = [0, 0, 0];
      let visSat = -1, bestEl = -1;
      for (let i = 0; i < current.sats.length; i++) {
        satEcef(current.sats[i], simT, e);
        const el = elevation(e, siteEcef);
        if (el > (M.elevationMaskDeg * Math.PI) / 180 && el > bestEl) { bestEl = el; visSat = i; }
        toScene(e, SAT_R / ORBIT_RATIO, tmp);
        pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
      }
      pos.needsUpdate = true;
      orbitGroup.rotation.y = -OMEGA_E * simT;
      telemetry.siteVisible = visSat >= 0;
      linkLine.material.opacity = visSat >= 0 ? 0.9 : 0;
      if (visSat >= 0) {
        const lp = linkGeo.attributes.position;
        lp.setXYZ(0, siteDir.x, siteDir.y, siteDir.z);
        lp.setXYZ(1, pos.getX(visSat), pos.getY(visSat), pos.getZ(visSat));
        lp.needsUpdate = true;
        siteMarker.material.color.copy(COLORS.signal);
      } else siteMarker.material.color.copy(COLORS.led);
      if (mode === 'constellation') {
        dist = 4.3; lat = -28; lon = -62; shiftX = 0.2;
      } else {
        // Slow drift across the Americas and the Atlantic, the collar in view.
        dist = 4.3; lat = -12; lon = reduced ? -55 : -55 + Math.sin(time * 0.08) * 25; shiftX = 0.22;
      }
    }
    if (mode !== 'constellation' && mode !== 'scale') siteMarker.material.color.copy(COLORS.led);

    if (portrait) { shiftY = shiftX ? -0.15 : 0; shiftX = 0; } // clear of the HUD above, the card below
    camPos.copy(camDir(lat, lon)).multiplyScalar(dist * fit);
    const k = reduced || exact || firstFrame ? 1 : 1 - Math.exp(-dt * 5);
    camera.position.lerp(camPos, k);
    camera.lookAt(0, 0, 0);
    firstFrame = false;
    camera.setViewOffset(viewW, viewH, -shiftX * viewW, -shiftY * viewH, viewW, viewH);
    const camDist = camera.position.length();
    mat.uniforms.uDots.value = smooth(1.45, 2.4, camDist);
    const mk = Math.min(0.09, Math.max(0.012, (camDist - 1) * 0.03));
    siteMarker.scale.setScalar(mk * flare);
    siteRing.scale.multiplyScalar(mk / 0.09);
    return telemetry;
  }

  /** Screen positions (px) of the relay actors, for HTML labels. */
  function relayScreen(w, h) {
    const at = (v, r = 1) => {
      tmp.copy(v).multiplyScalar(r).project(camera);
      return { x: (tmp.x * 0.5 + 0.5) * w, y: (-tmp.y * 0.5 + 0.5) * h, visible: tmp.z < 1 };
    };
    return { collar: at(siteDir, 1.005), sat: at(relaySat.position), gs: at(gsDir, 1.005) };
  }

  /** Screen position (px) of the collar site, and whether it faces the camera. */
  function siteScreen(w, h) {
    tmp.copy(siteDir).multiplyScalar(1.005).project(camera);
    const facing = siteDir.dot(camera.position) / camera.position.length() > 0.2;
    return { x: (tmp.x * 0.5 + 0.5) * w, y: (-tmp.y * 0.5 + 0.5) * h, facing };
  }

  return {
    scene,
    camera,
    update,
    siteScreen,
    relayScreen,
    resize(w, h) {
      aspect = w / h; viewW = w; viewH = h;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    setPixel(px) { stars.material.uniforms.uPixel.value = px; },
    snap() { firstFrame = true; },
    telemetry,
  };
}
