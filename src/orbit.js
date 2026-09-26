// Simplified orbital model: circular orbits, spherical Earth, no perturbations.
// Good enough to show how pass frequency scales with constellation size.
// Illustrative only, not a service prediction.
import { CONFIG } from './config.js';

const RE = 6371; // km
const MU = 398600.4418; // km^3/s^2
const OMEGA_E = 7.2921159e-5; // rad/s
const D2R = Math.PI / 180;

const M = CONFIG.model;
const A = RE + M.altitudeKm;
export const MEAN_MOTION = Math.sqrt(MU / (A * A * A)); // rad/s
export const PERIOD_SEC = (2 * Math.PI) / MEAN_MOTION;
export const ORBIT_RATIO = A / RE;

// Duration of an overhead pass from horizon to horizon (0° elevation).
export const HORIZON_PASS_SEC = (2 * Math.acos(RE / A)) / MEAN_MOTION;

/** Walker-like layout. Returns [{ raan, m0, inc }]. */
export function layout(n) {
  const planes = Math.max(1, Math.min(12, Math.round(Math.sqrt(n / 1.5))));
  const perPlane = new Array(planes).fill(0);
  for (let i = 0; i < n; i++) perPlane[i % planes]++;
  const idx = new Array(planes).fill(0);
  const sats = [];
  for (let i = 0; i < n; i++) {
    const p = i % planes;
    const j = idx[p]++;
    sats.push({
      plane: p,
      raan: (p * Math.PI) / planes + 0.35,
      m0: (2 * Math.PI * j) / perPlane[p] + (p * 2 * Math.PI) / n + 1.1,
      inc: M.inclinationDeg * D2R,
    });
  }
  return { sats, planes };
}

/** Satellite position in ECI (unit = Earth radii) at t seconds. */
export function satEci(s, t, out = [0, 0, 0]) {
  const u = s.m0 + MEAN_MOTION * t;
  const cu = Math.cos(u), su = Math.sin(u);
  const cO = Math.cos(s.raan), sO = Math.sin(s.raan);
  const ci = Math.cos(s.inc), si = Math.sin(s.inc);
  out[0] = ORBIT_RATIO * (cO * cu - sO * su * ci);
  out[1] = ORBIT_RATIO * (sO * cu + cO * su * ci);
  out[2] = ORBIT_RATIO * (su * si);
  return out;
}

/** Satellite position in the Earth-fixed frame (rotates ECI by -ωt). */
export function satEcef(s, t, out = [0, 0, 0]) {
  satEci(s, t, out);
  const th = -OMEGA_E * t;
  const c = Math.cos(th), sn = Math.sin(th);
  const x = out[0], y = out[1];
  out[0] = c * x - sn * y;
  out[1] = sn * x + c * y;
  return out;
}

export function ecefFromLatLon(lat, lon) {
  const la = lat * D2R, lo = lon * D2R;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

/** Elevation (radians) of an ECEF satellite position seen from an ECEF unit site. */
export function elevation(sat, site) {
  const rx = sat[0] - site[0], ry = sat[1] - site[1], rz = sat[2] - site[2];
  const len = Math.hypot(rx, ry, rz);
  return Math.asin((rx * site[0] + ry * site[1] + rz * site[2]) / len);
}

// ---------------------------------------------------------------------------

const siteCache = new Map();

/**
 * Visibility of the valley site over 24h for an n-satellite constellation.
 * Returns merged pass windows in minutes plus gap stats.
 */
export function siteWindows(n) {
  if (siteCache.has(n)) return siteCache.get(n);
  const { sats } = layout(n);
  const step = M.stepSec;
  const steps = Math.round((24 * 3600) / step);
  const site = ecefFromLatLon(M.site.lat, M.site.lon);
  const mask = M.elevationMaskDeg * D2R;
  const vis = new Uint8Array(steps);
  const p = [0, 0, 0];
  for (let k = 0; k < steps; k++) {
    const t = k * step;
    for (let i = 0; i < sats.length; i++) {
      satEcef(sats[i], t, p);
      if (elevation(p, site) > mask) { vis[k] = 1; break; }
    }
  }
  const windows = toWindows(vis, step);
  const res = { n, windows, ...gapStats(windows) };
  siteCache.set(n, res);
  return res;
}

function toWindows(vis, step) {
  const out = [];
  let start = -1;
  for (let k = 0; k <= vis.length; k++) {
    const v = k < vis.length ? vis[k] : 0;
    if (v && start < 0) start = k;
    if (!v && start >= 0) {
      out.push([(start * step) / 60, (k * step) / 60]);
      start = -1;
    }
  }
  return out;
}

function gapStats(windows) {
  const day = 24 * 60;
  if (!windows.length) return { passes: 0, longestGap: day, coveredPct: 0 };
  let longest = 0, covered = 0;
  for (let i = 0; i < windows.length; i++) {
    const [s, e] = windows[i];
    covered += e - s;
    const next = i + 1 < windows.length ? windows[i + 1][0] : windows[0][0] + day;
    longest = Math.max(longest, next - e);
  }
  return { passes: windows.length, longestGap: longest, coveredPct: (covered / day) * 100 };
}

// ---------------------------------------------------------------------------

const deliveryCache = new Map();

function simulateDelivery(n) {
  if (deliveryCache.has(n)) return deliveryCache.get(n);
  const { sats } = layout(n);
  const step = M.stepSec;
  const steps = Math.round((48 * 3600) / step);
  const site = ecefFromLatLon(M.site.lat, M.site.lon);
  const gs = M.groundStations.map((g) => ecefFromLatLon(g.lat, g.lon));
  const mask = M.elevationMaskDeg * D2R;
  const gsMask = M.groundStationMaskDeg * D2R;
  const up = sats.map(() => new Uint8Array(steps));
  const down = sats.map(() => new Uint8Array(steps));
  const p = [0, 0, 0];
  for (let k = 0; k < steps; k++) {
    const t = k * step;
    for (let i = 0; i < sats.length; i++) {
      satEcef(sats[i], t, p);
      if (elevation(p, site) > mask) up[i][k] = 1;
      for (let g = 0; g < gs.length; g++) {
        if (elevation(p, gs[g]) > gsMask) { down[i][k] = 1; break; }
      }
    }
  }
  const res = { up, down, steps, step };
  deliveryCache.set(n, res);
  return res;
}

/**
 * Messages spread evenly over a day. Each waits for the next pass (uplink),
 * then rides that satellite to its next ground-station contact (downlink).
 */
export function deliveryEstimate(n, messagesPerDay) {
  const { up, down, steps, step } = simulateDelivery(n);
  const daySteps = steps / 2;
  const lat = [];
  const events = new Set();
  const msgs = [];
  for (let m = 0; m < messagesPerDay; m++) {
    const k0 = Math.floor(((m + 0.5) / messagesPerDay) * daySteps);
    let best = null;
    for (let k = k0; k < steps && !best; k++) {
      for (let i = 0; i < up.length; i++) {
        if (!up[i][k]) continue;
        // Uplink to this satellite, then wait for its downlink.
        for (let k2 = k; k2 < steps; k2++) {
          if (down[i][k2]) {
            if (!best || k2 < best.k2) best = { k, k2, i };
            break;
          }
        }
      }
    }
    if (!best) continue;
    // Find the start of that ground contact so batched messages count as one window.
    let ks = best.k2;
    while (ks > 0 && down[best.i][ks - 1]) ks--;
    events.add(`${best.i}:${ks}`);
    const minutes = ((best.k2 - k0) * step) / 60;
    lat.push(minutes);
    msgs.push({ t: (k0 * step) / 60, up: (best.k * step) / 60, down: (best.k2 * step) / 60 });
  }
  lat.sort((a, b) => a - b);
  const q = (x) => lat[Math.min(lat.length - 1, Math.floor(x * lat.length))] ?? 0;
  return {
    median: q(0.5),
    p90: q(0.9),
    worst: lat[lat.length - 1] ?? 0,
    deliveryWindows: events.size,
    msgs,
  };
}
