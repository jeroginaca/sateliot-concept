// Strips the Quaternius cow (CC0) down to the clips the site uses.
// Source: assets/source/Cow.glb → public/models/cow.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, quantize, resample } from '@gltf-transform/functions';

const KEEP = new Set(['Eating', 'Idle', 'Idle_Headlow']);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('assets/source/Cow.glb');
for (const anim of doc.getRoot().listAnimations()) {
  if (KEEP.has(anim.getName())) continue;
  // Samplers own the keyframe accessors; dispose them so prune can drop the data.
  anim.listChannels().forEach((c) => c.dispose());
  anim.listSamplers().forEach((s) => { s.getInput()?.dispose(); s.getOutput()?.dispose(); s.dispose(); });
  anim.dispose();
}
await doc.transform(resample(), dedup(), prune(), quantize());
await io.write('public/models/cow.glb', doc);
console.log('kept', doc.getRoot().listAnimations().map((a) => a.getName()));
