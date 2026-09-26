# Sateliot concept redesign (unofficial)

A scroll-driven three.js concept site. It is not affiliated with Sateliot.

```
npm install
npm run dev      # http://localhost:5188 via .claude/launch.json, or vite's default port
npm run build
```

- **Numbers**: all company facts are in `src/config.js` → `CONFIG.facts`. The illustrative orbital-model assumptions are in `CONFIG.model`.
- **Copy (EN/ES)**: `src/i18n.js`.
- **Chapters**: `src/main.js` (`chapters`, `hudSpecs`). `state.passTime` drives the pass scene.
- **Scenes**: `src/scenes/valley.js` (hero, pass, closing), `globe.js` (coverage, relay, constellation, scale), `collar.js` (exploded view).
- **Model**: `src/orbit.js` computes pass windows and delivery estimates for the constellation slider and the estimator.
- **Cow**: "Cow" from Quaternius's Animated Animal Pack (CC0). The original is `assets/source/Cow.glb`; run `node scripts/optimize-cow.mjs` to regenerate `public/models/cow.glb` (it keeps only the Eating, Idle and Idle_Headlow clips). If the file fails to load, the scene falls back to a simple block cow.
