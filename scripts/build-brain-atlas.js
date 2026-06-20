#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  dedup,
  getGLPrimitiveCount,
  joinPrimitives,
  prune,
  quantize,
  reorder,
  simplify,
  weld,
} from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import {
  BRAIN_ATLAS_EXTRAS,
  BRAIN_ATLAS_SOURCE,
  REGION_NODE_PREFIX,
  REGION_NODE_NAMES,
  REGION_SOURCE_NODES,
} from "../web/src/viz/brain/anatomy-manifest.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = resolve(ROOT, "public/assets/brain-atlas.glb");
const localSource = process.argv[2] ? resolve(process.argv[2]) : null;
const MAX_OUTPUT_BYTES = 5_000_000;
const MAX_TRIANGLES = 300_000;
const MAX_DRAW_CALLS = 30;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stats(document) {
  let triangles = 0;
  let drawCalls = 0;
  let vertices = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      triangles += getGLPrimitiveCount(primitive);
      drawCalls += 1;
      vertices += primitive.getAttribute("POSITION")?.getCount() ?? 0;
    }
  }
  return { triangles, drawCalls, vertices };
}

function primitiveSignature(primitive) {
  return [
    primitive.getMaterial()?.getName() ?? "",
    primitive.getMode(),
    primitive.listSemantics().sort().join(","),
  ].join("|");
}

async function loadSource() {
  let bytes;
  if (localSource) {
    bytes = await readFile(localSource);
  } else {
    const response = await fetch(BRAIN_ATLAS_SOURCE.url);
    if (!response.ok) throw new Error(`Atlas download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const actualDigest = digest(bytes);
  if (actualDigest !== BRAIN_ATLAS_SOURCE.sha256) {
    throw new Error(`Atlas SHA-256 mismatch: expected ${BRAIN_ATLAS_SOURCE.sha256}, got ${actualDigest}`);
  }
  return bytes;
}

const workdir = await mkdtemp(resolve(tmpdir(), "neurogram-brain-atlas-"));
try {
  const sourcePath = resolve(workdir, "source.glb");
  await writeFile(sourcePath, await loadSource());

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
  const document = await io.read(sourcePath);
  const root = document.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) throw new Error("Source atlas has no scene");

  const sourceNodes = new Map(root.listNodes().map((node) => [node.getName(), node]));
  const assigned = new Map();
  const regionNodes = new Map();

  scene.setExtras(BRAIN_ATLAS_EXTRAS);
  for (const [region, hemisphereSources] of Object.entries(REGION_SOURCE_NODES)) {
    for (const side of ["L", "R"]) {
      const names = hemisphereSources[side];
      const regionNode = document.createNode(REGION_NODE_NAMES[region][side]);
      regionNode.setExtras({
        neurogramRegion: region,
        hemisphere: side === "L" ? "left" : "right",
        sourceNodeCount: names.length,
      });
      regionNodes.set(`${region}:${side}`, regionNode);
      for (const name of names) {
        if (assigned.has(name)) {
          throw new Error(`${name} is assigned to both ${assigned.get(name)} and ${region}:${side}`);
        }
        if (!name.endsWith(`_${side}`)) throw new Error(`${name} is not a ${side} hemisphere source node`);
        const node = sourceNodes.get(name);
        if (!node?.getMesh()) throw new Error(`Mapped source node is missing or has no mesh: ${name}`);
        assigned.set(name, `${region}:${side}`);
        regionNode.addChild(node);
      }
    }
  }

  for (const child of scene.listChildren()) scene.removeChild(child);
  for (const regionNode of regionNodes.values()) scene.addChild(regionNode);
  await document.transform(prune());
  const selectedOriginal = stats(document);
  await document.transform(dedup(), weld(), simplify({
    simplifier: MeshoptSimplifier,
    ratio: 0.6,
    error: 0.005,
    lockBorder: false,
  }));
  const simplified = stats(document);

  // Collapse each region hemisphere to the fewest compatible primitives, while retaining
  // stable, named nodes for THREE.GLTFLoader.getObjectByName().
  for (const [regionSide, regionNode] of regionNodes) {
    const groups = new Map();
    for (const child of regionNode.listChildren()) {
      for (const primitive of child.getMesh()?.listPrimitives() ?? []) {
        const signature = primitiveSignature(primitive);
        if (!groups.has(signature)) groups.set(signature, []);
        groups.get(signature).push(primitive);
      }
    }
    const mesh = document.createMesh(`${REGION_NODE_PREFIX}${regionSide}:mesh`);
    for (const primitives of groups.values()) {
      mesh.addPrimitive(primitives.length === 1 ? primitives[0] : joinPrimitives(primitives));
    }
    for (const child of regionNode.listChildren()) regionNode.removeChild(child);
    regionNode.setMesh(mesh);
  }

  await MeshoptEncoder.ready;
  await document.transform(
    prune(),
    dedup(),
    reorder({ encoder: MeshoptEncoder }),
    quantize({ quantizePosition: 14, quantizeNormal: 10 }),
    prune(),
  );

  const output = await io.writeBinary(document);
  const outputBytes = output.byteLength;
  const optimized = stats(document);
  if (outputBytes > MAX_OUTPUT_BYTES) {
    throw new Error(`Atlas exceeds ${MAX_OUTPUT_BYTES} bytes: ${outputBytes}`);
  }
  if (optimized.triangles > MAX_TRIANGLES) {
    throw new Error(`Atlas exceeds ${MAX_TRIANGLES} triangles: ${optimized.triangles}`);
  }
  if (optimized.drawCalls > MAX_DRAW_CALLS) {
    throw new Error(`Atlas exceeds ${MAX_DRAW_CALLS} draw calls: ${optimized.drawCalls}`);
  }
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, output);
  console.log(JSON.stringify({
    output: OUTPUT,
    sourceSha256: BRAIN_ATLAS_SOURCE.sha256,
    mappedSourceNodes: assigned.size,
    regions: Object.keys(REGION_SOURCE_NODES).length,
    regionNodes: regionNodes.size,
    selectedOriginal,
    simplifiedBeforeJoin: simplified,
    optimized,
    outputBytes,
  }, null, 2));
} finally {
  await rm(workdir, { recursive: true, force: true });
}
