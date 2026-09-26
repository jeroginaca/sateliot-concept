// Every number shown on the site lives here.
//
// `facts` are public company facts — the only claims the site makes.
// `model` holds assumptions for the illustrative orbital model that drives the
// pass scene, the constellation slider and the delivery estimator. They are
// labelled as illustrative wherever they surface.

export const CONFIG = {
  facts: {
    founded: 2018,
    headquarters: 'Barcelona',
    firstSatellitesYear: 2024,
    satellitesLaunched: 6,
    satellitesPlanned: 5,
    satellitesPlannedYear: 2026,
    fullConstellationTarget: '2027/28',
    roadmapSatellites: 100, // shown as "100+"
    messagesPerDay: 1_000_000, // shown as "1,000,000+"
    clients: 400, // shown as "400+"
    countries: 60,
    oceanSharePct: 71, // share of Earth's surface covered by oceans
    standard: '3GPP Release 17',
    technology: 'NB-IoT',
  },

  model: {
    // The sensor on the cow.
    site: { lat: -45.6, lon: -71.4 },
    // Circular, near-polar orbits.
    altitudeKm: 500,
    inclinationDeg: 97.5,
    elevationMaskDeg: 10,
    groundStationMaskDeg: 5,
    // Ground station sites assumed for the model only. These are not claims about real facilities.
    groundStations: [
      { id: 'GS-N', lat: 78.2, lon: 15.4 },
      { id: 'GS-S', lat: -62.2, lon: -58.9 },
    ],
    stepSec: 30,
    // Readings the collar holds before the pass scene begins.
    demoBufferedMessages: 12,
    slider: { min: 6, max: 100 },
    calculator: { minMessages: 1, maxMessages: 96, defaultMessages: 24 },
  },

  render: {
    maxPixelRatioMobile: 1.5,
    maxPixelRatioDesktop: 2,
  },
};

export const constellationPresets = () => {
  const f = CONFIG.facts;
  return [
    { id: 'today', sats: f.satellitesLaunched },
    { id: 'planned', sats: f.satellitesLaunched + f.satellitesPlanned },
    { id: 'roadmap', sats: f.roadmapSatellites },
  ];
};
