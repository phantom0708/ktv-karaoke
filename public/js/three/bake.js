// Merge all static decoration meshes into a few big meshes (one per visually identical material):
// hundreds of draw calls become a handful. Objects that move, toggle, animate or are clicked are kept.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ATTRS = ['position', 'normal', 'uv'];

function signature(m) {
  if (m.userData.keepIdentity || m.isShaderMaterial) return m.uuid; // animated or custom materials stay separate
  const c = (x) => (x ? x.getHex() : '-');
  return [m.type, c(m.color), c(m.emissive), m.map?.uuid, m.gradientMap?.uuid, m.side, m.transparent, m.opacity, m.blending,
    m.metalness, m.roughness, m.sheen, m.envMapIntensity, m.depthWrite, (m.clippingPlanes || []).length].join('|');
}

const allMeshes = (o) => { let ok = true; o.traverse((c) => { if (c !== o && !c.isMesh) ok = false; }); return ok; };

export function bakeStatic(scene, keep) {
  scene.updateMatrixWorld(true);
  const groups = new Map(); const merged = []; const mergedSet = new Set();
  scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    for (let p = o; p; p = p.parent) if (keep.has(p) || p.userData.dynamic) return;
    if (!allMeshes(o) || Array.isArray(o.material)) return; // a light/sprite/label hangs under it: leave it alone
    const key = signature(o.material);
    if (!groups.has(key)) groups.set(key, { material: o.material, geos: [] });
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!ATTRS.includes(name)) g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    g.applyMatrix4(o.matrixWorld);
    groups.get(key).geos.push(g); merged.push(o); mergedSet.add(o);
  });
  // detach merged meshes (children of merged meshes are merged meshes too)
  for (const o of merged) if (o.parent && !mergedSet.has(o.parent)) o.parent.remove(o);
  let count = 0;
  for (const { material, geos } of groups.values()) {
    const geo = mergeGeometries(geos, false); if (!geo) continue;
    const mesh = new THREE.Mesh(geo, material); mesh.castShadow = false; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    mesh.userData.baked = true; scene.add(mesh); count++;
  }
  return { merged: merged.length, meshes: count };
}

// Merge the meshes inside one object (sofa, vase, table…) into one mesh per material, in the object's own space.
// The object itself stays, so it can still be hidden (cut-away), clicked and moved. Parts marked noBake are kept.
export function bakeGroup(group, { shadows = true, shallow = false } = {}) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const groups = new Map(); const merged = new Set();
  group.traverse((o) => {
    if (!o.isMesh || o === group || Array.isArray(o.material)) return;
    for (let p = o; p && p !== group; p = p.parent) if (p.userData.noBake || (shallow && p !== o && !p.isMesh)) return; // shallow: never reach into moving sub-groups
    if (!allMeshes(o)) return;
    const key = signature(o.material);
    if (!groups.has(key)) groups.set(key, { material: o.material, geos: [], ink: !!o.userData.isInk });
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!ATTRS.includes(name)) g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    groups.get(key).geos.push(g); merged.add(o);
  });
  if (merged.size < 3) return group; // nothing worth merging
  for (const o of merged) if (o.parent && !merged.has(o.parent)) o.parent.remove(o);
  for (const { material, geos, ink } of groups.values()) {
    const geo = mergeGeometries(geos, false); if (!geo) continue;
    const m = new THREE.Mesh(geo, material); m.castShadow = shadows && !ink; m.receiveShadow = true;
    if (ink) m.userData.isInk = true;
    group.add(m);
  }
  return group;
}
